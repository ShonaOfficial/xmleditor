import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp as initializeAdminApp, getApps as getAdminApps, getApp as getAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

interface FirebaseAppletConfigInfo {
  projectId: string | null;
  firestoreDatabaseId: string;
  apiKey: string | null;
}

function readFirebaseAppletConfig(): FirebaseAppletConfigInfo {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      return { projectId: null, firestoreDatabaseId: '(default)', apiKey: null };
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      projectId?: string;
      firestoreDatabaseId?: string;
      apiKey?: string;
    };
    const id = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    const dbId =
      typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId.trim()
        ? parsed.firestoreDatabaseId.trim()
        : '(default)';
    const apiKey = typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : null;
    if (!id || id === 'remixed-project-id') {
      return { projectId: null, firestoreDatabaseId: '(default)', apiKey: null };
    }
    return { projectId: id, firestoreDatabaseId: dbId, apiKey };
  } catch {
    return { projectId: null, firestoreDatabaseId: '(default)', apiKey: null };
  }
}

const FIREBASE_APPLET_CONFIG = readFirebaseAppletConfig();
const FIREBASE_PROJECT_ID = FIREBASE_APPLET_CONFIG.projectId;
const firebaseAdminApp = FIREBASE_PROJECT_ID
  ? getAdminApps().length
    ? getAdminApp()
    : initializeAdminApp({ projectId: FIREBASE_PROJECT_ID })
  : null;

const CALLABLE_GEMINI_MODELS = new Set(['gemini-3.1-flash-lite']);
const PRO_GEMINI_MODELS = new Set(['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon']);
const DAILY_GEMINI_QUOTA_LIMIT = 25;
const uidDailyQuotaMap = new Map<string, number>();

function getUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface VerifiedGeminiRequest {
  uid: string;
  email: string;
  model: 'gemini-3.1-flash-lite';
  quota: {
    dateKey: string;
    usedCount: number;
    dailyLimit: number;
    remaining: number;
  };
}

async function verifyAndChargeGeminiRequest(
  req: express.Request,
  res: express.Response,
  options?: { consumeQuota?: boolean }
): Promise<VerifiedGeminiRequest | null> {
  if (!firebaseAdminApp) {
    res.status(503).json({
      error: 'Autentikasi Firebase belum terkonfigurasi di server.',
    });
    return null;
  }

  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match?.[1]) {
    res.status(401).json({
      error: 'Login Google diperlukan untuk menjalankan mesin AI Gemini.',
      code: 'AUTH_REQUIRED',
    });
    return null;
  }

  let uid = '';
  let email = '';
  try {
    const decoded = await getAdminAuth(firebaseAdminApp).verifyIdToken(match[1]);
    if (!decoded.email_verified) {
      res.status(403).json({
        error: 'Akun Google Anda belum terverifikasi.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return null;
    }
    uid = decoded.uid;
    email = decoded.email || '';
  } catch {
    res.status(401).json({
      error: 'Sesi Login Google tidak valid atau telah kedaluwarsa. Silakan masuk ulang.',
      code: 'INVALID_TOKEN',
    });
    return null;
  }

  const requestedModel =
    typeof req.body?.model === 'string' && req.body.model.trim()
      ? req.body.model.trim()
      : 'gemini-3.1-flash-lite';
  if (PRO_GEMINI_MODELS.has(requestedModel)) {
    res.status(403).json({
      error: `Model "${requestedModel}" membutuhkan akun Gemini yang Pro.`,
      code: 'PRO_MODEL_REQUIRED',
    });
    return null;
  }

  const model: 'gemini-3.1-flash-lite' = CALLABLE_GEMINI_MODELS.has(requestedModel)
    ? (requestedModel as 'gemini-3.1-flash-lite')
    : 'gemini-3.1-flash-lite';

  const dateKey = getUtcDateKey();
  const bucketKey = `${uid}:${dateKey}`;
  const currentUsed = uidDailyQuotaMap.get(bucketKey) ?? 0;

  if (options?.consumeQuota !== false) {
    if (currentUsed >= DAILY_GEMINI_QUOTA_LIMIT) {
      res.status(429).json({
        error: `Batas kuota harian Gemini untuk akun ini telah tercapai (${DAILY_GEMINI_QUOTA_LIMIT}/${DAILY_GEMINI_QUOTA_LIMIT}). Beralihlah ke AI Lokal di perangkat Anda agar tetap dapat bekerja tanpa limit server.`,
        code: 'DAILY_QUOTA_EXCEEDED',
        quota: {
          dateKey,
          usedCount: currentUsed,
          dailyLimit: DAILY_GEMINI_QUOTA_LIMIT,
          remaining: 0,
        },
      });
      return null;
    }
    const nextUsed = currentUsed + 1;
    uidDailyQuotaMap.set(bucketKey, nextUsed);
    return {
      uid,
      email,
      model,
      quota: {
        dateKey,
        usedCount: nextUsed,
        dailyLimit: DAILY_GEMINI_QUOTA_LIMIT,
        remaining: Math.max(0, DAILY_GEMINI_QUOTA_LIMIT - nextUsed),
      },
    };
  }

  return {
    uid,
    email,
    model,
    quota: {
      dateKey,
      usedCount: currentUsed,
      dailyLimit: DAILY_GEMINI_QUOTA_LIMIT,
      remaining: Math.max(0, DAILY_GEMINI_QUOTA_LIMIT - currentUsed),
    },
  };
}

function getGeminiErrorResponse(err: unknown, fallbackMessage: string): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || fallbackMessage);
  if (/RESOURCE_EXHAUSTED|429/i.test(raw)) {
    return {
      status: 429,
      message:
        'Batas permintaan Gemini API tercapai sementara. Coba lagi sebentar, pilih model Flash Lite, atau alihkan ke AI Lokal.',
    };
  }
  if (/PERMISSION_DENIED|API_KEY_INVALID|403|400/i.test(raw) && /key|permission|api/i.test(raw)) {
    return {
      status: 403,
      message: 'API key Gemini pada Settings > Secrets tidak valid atau belum aktif.',
    };
  }
  return {
    status: 500,
    message: raw || fallbackMessage,
  };
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi pada Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '::' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80:') ||
    lower.startsWith('::ffff:127.') ||
    lower.startsWith('::ffff:10.') ||
    lower.startsWith('::ffff:192.168.') ||
    lower.startsWith('::ffff:169.254.')
  ) {
    return true;
  }
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function normalizeXmlSourceUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  // Auto-convert GitHub blob URLs to raw.githubusercontent.com
  const ghBlobMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i.exec(trimmed);
  if (ghBlobMatch) {
    const [, owner, repo, rest] = ghBlobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
  }
  return trimmed;
}

function convertLiveBlogHtmlToXml(html: string, sourceUrl: string): string {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = (titleMatch?.[1] || 'Pratinjau Blog').replace(/[<>&]/g, '').trim();

  const styleMatches: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRegex.exec(html)) !== null) {
    if (m[1] && m[1].trim().length > 0 && styleMatches.join('\n').length < 180000) {
      styleMatches.push(m[1].trim());
    }
  }

  const linkMatches: string[] = [];
  const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
  while ((m = linkRegex.exec(html)) !== null) {
    const hrefMatch = /href=["']([^"']+)["']/i.exec(m[0]);
    if (hrefMatch?.[1]) {
      const resolved = new URL(hrefMatch[1], sourceUrl).toString().replace(/&/g, '&amp;');
      linkMatches.push(`<link rel="stylesheet" href="${resolved}" />`);
    }
  }

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const rawBody = bodyMatch?.[1] || '<div class="post"><h2 class="post-title"><data:post.title/></h2><div class="post-body"><data:post.body/></div></div>';

  // Strip scripts from fetched HTML for safe sandboxed preview
  const safeBody = rawBody.replace(/<script[\s\S]*?<\/script>/gi, '');

  const combinedSkin = styleMatches.join('\n\n').replace(/\]\]>/g, ']]&gt;');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:css='false' b:defaultwidgetversion='2' b:layoutsVersion='3' xmlns='http://www.w3.org/1999/xhtml' xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta content='width=device-width, initial-scale=1' name='viewport'/>
  <title>${title}</title>
  ${linkMatches.join('\n  ')}
  <b:skin><![CDATA[
    <Variable name="body.background" description="Background" type="color" default="#ffffff" value="#ffffff"/>
    <Variable name="body.text.color" description="Text Color" type="color" default="#1e293b" value="#1e293b"/>
    <Variable name="keycolor" description="Accent Color" type="color" default="#2563eb" value="#2563eb"/>
${combinedSkin}
  ]]></b:skin>
</head>
<body>
  <div id="temaloka-imported-live-wrapper" data-source="${sourceUrl.replace(/"/g, '&quot;')}">
    ${safeBody}
  </div>
</body>
</html>`;
}

// 1. Fetch XML from URL (bypassing browser CORS)
app.post('/api/fetch-xml', async (req, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Masukkan URL file XML atau alamat blog terlebih dahulu.' });
      return;
    }

    const normalizedUrl = normalizeXmlSourceUrl(rawUrl);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      res.status(400).json({ error: 'Format URL tidak valid. Pastikan diawali https:// atau http://' });
      return;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: 'Hanya protokol HTTP dan HTTPS yang didukung.' });
      return;
    }

    if (isBlockedHostname(parsedUrl.hostname)) {
      res.status(403).json({ error: 'Akses ke alamat jaringan lokal tidak diizinkan.' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaPreviewer/1.0)',
        Accept: 'application/xml, text/xml, text/html, text/plain;q=0.9, */*;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(502).json({
        error: `Gagal mengunduh dari URL (${response.status} ${response.statusText}). Pastikan tautan bersifat publik.`,
      });
      return;
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    const looksLikeBloggerXml =
      text.includes('<b:skin') ||
      text.includes('<b:section') ||
      text.includes('xmlns:b=') ||
      (text.trimStart().startsWith('<?xml') && !text.includes('<!DOCTYPE html><html'));

    if (looksLikeBloggerXml) {
      res.json({
        xml: text,
        sourceUrl: parsedUrl.toString(),
        contentType,
        convertedFromLiveSite: false,
      });
      return;
    }

    // If it's a live Blogspot/HTML page, convert it into an editable preview wrapper
    if (text.includes('<html') || text.includes('<body') || contentType.includes('text/html')) {
      const convertedXml = convertLiveBlogHtmlToXml(text, parsedUrl.toString());
      const visualPreviewHtml = buildSafeVisualIframeHtml(text, parsedUrl.toString());
      res.json({
        xml: convertedXml,
        visualPreviewHtml,
        sourceUrl: parsedUrl.toString(),
        contentType,
        convertedFromLiveSite: true,
      });
      return;
    }

    res.status(422).json({
      error: 'Konten dari URL tersebut tidak dikenali sebagai template XML Blogger atau halaman web.',
    });
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Waktu pengambilan URL habis (timeout 15 detik).'
      : err instanceof Error
        ? err.message
        : 'Terjadi kesalahan saat mengambil URL.';
    res.status(500).json({ error: message });
  }
});

const GENERIC_SIGNATURE_TOKENS = new Set([
  'widget', 'widget-content', 'section', 'blog', 'header', 'footer', 'main', 'sidebar',
  'post', 'posts', 'post-outer', 'post-title', 'post-body', 'post-meta', 'post-footer',
  'clear', 'clearfix', 'container', 'wrapper', 'content', 'title', 'description',
  'html', 'label', 'popularposts', 'pagelist', 'attribution', 'featuredpost', 'blogsearch',
  'hfeed', 'hentry', 'entry-title', 'entry-content', 'status-msg-wrap', 'jump-link',
  'active', 'selected', 'hidden', 'show', 'open', 'item', 'list', 'nav', 'menu', 'btn',
  'blog-posts', 'date-header', 'comments', 'comment', 'feed-links', 'quickedit',
  'navbar', 'no-items', 'widget-item-control', 'item-thumbnail', 'item-title',
]);

function buildSafeVisualIframeHtml(html: string, sourceUrl: string): string {
  let originBase = sourceUrl;
  try {
    const u = new URL(sourceUrl);
    originBase = `${u.origin}/`;
  } catch {
    // keep sourceUrl fallback
  }

  let safe = html
    // Remove scripts, meta refresh/frame headers, prefetch hints, autoplay media, and inline event handlers
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>|<\/noscript>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["']?(?:X-Frame-Options|Content-Security-Policy|refresh)["']?[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["']?(?:prefetch|prerender|modulepreload|dns-prefetch|preconnect)["']?[^>]*>/gi, '')
    .replace(/\s+autoplay(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  const isolationHeadTags = [
    `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; connect-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none';" />`,
    `<base href="${originBase.replace(/"/g, '&quot;')}" target="_blank" />`,
  ].join('\n');

  if (/<head\b[^>]*>/i.test(safe)) {
    safe = safe.replace(/<head\b[^>]*>/i, (m) => `${m}\n${isolationHeadTags}`);
  } else {
    safe = `${isolationHeadTags}\n${safe}`;
  }
  return safe;
}

function extractLiveBlogFingerprint(html: string, sourceUrl: string) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const blogTitle = (titleMatch?.[1] || '').replace(/\s+/g, ' ').trim();

  const metaDescMatch =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html) ||
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  const metaDescription = (metaDescMatch?.[1] || '').trim();

  const canonicalMatch =
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i.exec(html) ||
    /<link[^>]+href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i.exec(html);
  const canonicalUrl = (canonicalMatch?.[1] || '').trim();

  const blogIdMatch =
    /(?:blogId['":\s=]+['"]?|blogger\.com\/feeds\/)(\d{12,24})/i.exec(html);
  const blogId = blogIdMatch?.[1] || '';

  const isBloggerPowered =
    /blogger\.com\/static|blogspot\.com|_WidgetManager|widget-content|data-version=/i.test(html);

  // Extract theme/skin name if commented inside <style>
  const styleBlocks: string[] = [];
  const styleBlockRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleBlockRegex.exec(html)) !== null) {
    if (m[1]) styleBlocks.push(m[1]);
  }
  const combinedCss = styleBlocks.join('\n');
  const skinNameMatch = /(?:Template Name|Theme Name|Blogger Template Style[\s\S]{0,120}?Name)\s*:\s*([^\n\r*]+)/i.exec(
    combinedCss
  );
  const skinThemeName = (skinNameMatch?.[1] || '').trim();

  // Extract section IDs + sequential widget placements
  const sectionMatches: Array<{ id: string; index: number }> = [];
  const secTagRegex = /<(?:div|section|header|footer|aside|main)\b([^>]*\bclass=["'][^"']*\bsection\b[^"']*["'][^>]*)>/gi;
  while ((m = secTagRegex.exec(html)) !== null) {
    const idM = /\bid=["']([^"']+)["']/i.exec(m[1]);
    if (idM?.[1]) {
      sectionMatches.push({ id: idM[1], index: m.index });
    }
  }
  const sectionIds = Array.from(new Set(sectionMatches.map((s) => s.id)));

  const widgets: Array<{ id: string; type: string }> = [];
  const widgetPlacements: Array<{ sectionId: string; widgetId: string; widgetType: string }> = [];
  const seenWidgetIds = new Set<string>();
  const widgetTagRegex = /<div\b([^>]*\bclass=["'][^"']*\bwidget\b[^"']*["'][^>]*)>/gi;
  while ((m = widgetTagRegex.exec(html)) !== null) {
    const attrs = m[1];
    const idM = /\bid=["']([^"']+)["']/i.exec(attrs);
    const classM = /\bclass=["']([^"']+)["']/i.exec(attrs);
    const wId = idM?.[1] || '';
    if (!wId || seenWidgetIds.has(wId)) continue;
    seenWidgetIds.add(wId);
    const classes = (classM?.[1] || '').split(/\s+/).filter(Boolean);
    const widgetIdx = classes.findIndex((c) => c.toLowerCase() === 'widget');
    const wType =
      widgetIdx >= 0 && classes[widgetIdx + 1]
        ? classes[widgetIdx + 1]
        : classes.find((c) => c !== 'widget') || 'Unknown';
    widgets.push({ id: wId, type: wType });

    // Nearest preceding section container
    let parentSec = '';
    for (let i = sectionMatches.length - 1; i >= 0; i--) {
      if (sectionMatches[i].index < m.index) {
        parentSec = sectionMatches[i].id;
        break;
      }
    }
    widgetPlacements.push({ sectionId: parentSec, widgetId: wId, widgetType: wType });
  }

  // Extract CSS Custom Properties (--var)
  const cssVarNames = new Set<string>();
  const cssVarRegex = /(--[a-zA-Z0-9_-]{2,})\s*:/g;
  while ((m = cssVarRegex.exec(html)) !== null) {
    if (cssVarNames.size >= 80) break;
    cssVarNames.add(m[1]);
  }

  // Extract Forensic Theme Signature Tokens (custom CSS selectors & body class/IDs)
  const sigCounts = new Map<string, number>();
  const selectorRegex = /(?:^|[\s,}])([.#][a-zA-Z_-][a-zA-Z0-9_-]{2,})/g;
  while ((m = selectorRegex.exec(combinedCss)) !== null) {
    const tok = m[1].slice(1).toLowerCase();
    if (!GENERIC_SIGNATURE_TOKENS.has(tok)) {
      sigCounts.set(tok, (sigCounts.get(tok) || 0) + 1);
    }
  }
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) {
    const attrTokRegex = /\b(?:id|class)\s*=\s*["']([^"']+)["']/gi;
    while ((m = attrTokRegex.exec(bodyMatch[1])) !== null) {
      for (const part of m[1].split(/\s+/)) {
        const cleanTok = part.trim().toLowerCase();
        if (
          cleanTok.length >= 3 &&
          !GENERIC_SIGNATURE_TOKENS.has(cleanTok) &&
          !cleanTok.includes(':')
        ) {
          sigCounts.set(cleanTok, (sigCounts.get(cleanTok) || 0) + 1);
        }
      }
    }
  }
  const themeSignatureTokens = Array.from(sigCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
    .map(([tok]) => tok);

  // Extract Font Families used in CSS & Google Fonts links
  const fontSet = new Set<string>();
  const fontCssRegex = /font-family\s*:\s*([^;}{]+)/gi;
  while ((m = fontCssRegex.exec(combinedCss)) !== null) {
    const primary = m[1].split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    if (primary && !['sans-serif', 'serif', 'monospace', 'system-ui', 'inherit'].includes(primary)) {
      fontSet.add(primary);
    }
  }
  const gfRegex = /fonts\.googleapis\.com\/css2?\?[^"'\s>]+/gi;
  while ((m = gfRegex.exec(html)) !== null) {
    const famMatches = m[0].matchAll(/family=([^:&]+)/gi);
    for (const fm of famMatches) {
      try {
        fontSet.add(decodeURIComponent(fm[1].replace(/\+/g, ' ')).split(':')[0].toLowerCase().trim());
      } catch {
        // ignore malformed font url
      }
    }
  }

  // Extract footer snippet
  const footerMatch =
    /<footer\b[^>]*>([\s\S]{0,1200})<\/footer>/i.exec(html) ||
    /<div\b[^>]*id=["']footer[^"']*["'][^>]*>([\s\S]{0,1200})<\/div>/i.exec(html);
  const footerText = footerMatch
    ? footerMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    : '';

  const gaIds = Array.from(
    new Set(html.match(/\b(?:G-[A-Z0-9]{6,12}|UA-\d{4,10}-\d{1,4}|GTM-[A-Z0-9]{5,10})\b/g) || [])
  );
  const adsenseClients = Array.from(
    new Set(html.match(/\bca-pub-\d{10,20}\b/g) || [])
  );
  const gscMatch =
    /<meta[^>]+name=["']google-site-verification["'][^>]*content=["']([^"']+)["']/i.exec(html);

  const generatorMatch = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i.exec(html);

  return {
    sourceUrl,
    blogTitle,
    metaDescription,
    canonicalUrl,
    blogId,
    isBloggerPowered,
    generator: generatorMatch?.[1] || '',
    skinThemeName,
    footerText,
    sectionIds,
    widgets,
    widgetPlacements,
    cssVarNames: Array.from(cssVarNames),
    themeSignatureTokens,
    fontFamilies: Array.from(fontSet),
    gaIds,
    adsenseClients,
    gscVerification: gscMatch?.[1] || '',
  };
}

// 1b. Compare a live Blogspot URL against currently edited template
app.post('/api/compare-blogspot-url', async (req, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Masukkan alamat URL Blogspot terlebih dahulu.' });
      return;
    }

    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(withProtocol);
    } catch {
      res.status(400).json({ error: 'Format URL blog tidak valid.' });
      return;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: 'Hanya protokol HTTP dan HTTPS yang didukung.' });
      return;
    }

    if (isBlockedHostname(parsedUrl.hostname)) {
      res.status(403).json({ error: 'Akses ke alamat jaringan lokal tidak diizinkan.' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaVerifier/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(502).json({
        error: `Gagal membuka URL blog (${response.status} ${response.statusText}). Pastikan blog bersifat publik.`,
      });
      return;
    }

    const html = await response.text();
    const fingerprint = extractLiveBlogFingerprint(html, parsedUrl.toString());
    const visualPreviewHtml = buildSafeVisualIframeHtml(html, parsedUrl.toString());
    res.json({ fingerprint, visualPreviewHtml });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Waktu pemeriksaan URL blog habis (timeout 15 detik).'
        : err instanceof Error
          ? err.message
          : 'Gagal memeriksa alamat Blogspot.';
    res.status(500).json({ error: message });
  }
});

// 1b-2. Test a URL + Query String / Query Parameters live for Konsol URL
app.post('/api/test-query-url', async (req, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Masukkan URL lengkap beserta Query String terlebih dahulu.' });
      return;
    }
    if (rawUrl.length > 2048) {
      res.status(400).json({ error: 'URL uji terlalu panjang (maksimal 2048 karakter).' });
      return;
    }

    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let currentUrl: URL;
    try {
      currentUrl = new URL(withProtocol);
    } catch {
      res.status(400).json({ error: 'Format URL atau Query String tidak valid.' });
      return;
    }

    if (!['http:', 'https:'].includes(currentUrl.protocol)) {
      res.status(400).json({ error: 'Hanya protokol HTTP dan HTTPS yang diizinkan.' });
      return;
    }
    if (isBlockedHostname(currentUrl.hostname)) {
      res.status(403).json({ error: 'Akses ke alamat jaringan lokal atau privat tidak diizinkan.' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const t0 = Date.now();
    let response: Response | null = null;
    let redirects = 0;

    try {
      while (redirects <= 2) {
        response = await fetch(currentUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaQueryTester/1.0)',
            Accept: 'application/json,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;
          const nextUrl = new URL(location, currentUrl);
          if (!['http:', 'https:'].includes(nextUrl.protocol) || isBlockedHostname(nextUrl.hostname)) {
            res.status(403).json({
              error: 'Redirect menuju protokol atau alamat jaringan yang tidak diizinkan.',
            });
            return;
          }
          currentUrl = nextUrl;
          redirects++;
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!response) {
      res.status(502).json({ error: 'Tidak ada respons dari server tujuan.' });
      return;
    }

    const latencyMs = Date.now() - t0;
    const contentType = response.headers.get('content-type') || 'unknown';

    // Read up to 256 KB safely
    const reader = response.body?.getReader();
    let totalBytes = 0;
    const chunks: Uint8Array[] = [];
    const maxPreviewBytes = 256 * 1024;
    if (reader) {
      while (totalBytes < maxPreviewBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        totalBytes += value.byteLength;
      }
      if (totalBytes >= maxPreviewBytes) {
        await reader.cancel().catch(() => {});
      }
    }
    const merged = new Uint8Array(Math.min(totalBytes, maxPreviewBytes));
    let offset = 0;
    for (const c of chunks) {
      const sliceLen = Math.min(c.byteLength, merged.byteLength - offset);
      if (sliceLen <= 0) break;
      merged.set(c.subarray(0, sliceLen), offset);
      offset += sliceLen;
    }
    const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(merged);

    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(bodyText);
    const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 160) : null;

    let jsonSummary: string | null = null;
    if (/json/i.test(contentType) || bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
      try {
        const parsedJson = JSON.parse(bodyText);
        if (Array.isArray(parsedJson)) {
          jsonSummary = `Array JSON (${parsedJson.length} item)`;
        } else if (parsedJson && typeof parsedJson === 'object') {
          const keys = Object.keys(parsedJson as Record<string, unknown>);
          const feedObj = (parsedJson as Record<string, unknown>).feed as
            | { entry?: unknown[]; openSearch$totalResults?: { $t?: string } }
            | undefined;
          if (feedObj && Array.isArray(feedObj.entry)) {
            jsonSummary = `Blogger JSON Feed: ${feedObj.entry.length} entri tampil${
              feedObj.openSearch$totalResults?.$t
                ? ` (Total: ${feedObj.openSearch$totalResults.$t})`
                : ''
            }`;
          } else {
            jsonSummary = `Objek JSON (${keys.slice(0, 6).join(', ')})`;
          }
        }
      } catch {
        // Non-strict JSON / JSONP response
      }
    }

    const queryParams = Array.from(currentUrl.searchParams.entries()).map(([key, value]) => ({
      key,
      value,
    }));

    res.json({
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      finalUrl: currentUrl.toString(),
      redirected: redirects > 0,
      contentType,
      latencyMs,
      byteSize: totalBytes,
      queryParams,
      pageTitle,
      jsonSummary,
      bodySnippet: bodyText.slice(0, 1600),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Waktu uji query URL habis (timeout 12 detik).'
        : err instanceof Error
          ? err.message
          : 'Gagal menguji URL dan Query String.';
    res.status(500).json({ error: message });
  }
});

function escapeXmlEntity(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 1c. Real external SEO URL verification, WebSub (PubSubHubbub), Ping-O-Matic, Wayback & IndexNow submission
app.post('/api/seo/submit-url', async (req, res) => {
  try {
    const rawBlogUrl = typeof req.body?.blogUrl === 'string' ? req.body.blogUrl.trim() : '';
    const rawArticleUrl = typeof req.body?.articleUrl === 'string' ? req.body.articleUrl.trim() : '';
    const indexNowKey = typeof req.body?.indexNowKey === 'string' ? req.body.indexNowKey.trim() : '';

    if (!rawBlogUrl) {
      res.status(400).json({ error: 'Masukkan URL blog publik terlebih dahulu.' });
      return;
    }

    const withProtocol = /^https?:\/\//i.test(rawBlogUrl) ? rawBlogUrl : `https://${rawBlogUrl}`;
    let parsedBlogUrl: URL;
    try {
      parsedBlogUrl = new URL(withProtocol);
    } catch {
      res.status(400).json({ error: 'Format URL blog tidak valid.' });
      return;
    }

    if (!['http:', 'https:'].includes(parsedBlogUrl.protocol)) {
      res.status(400).json({ error: 'Hanya protokol HTTP/HTTPS publik yang diizinkan.' });
      return;
    }
    if (isBlockedHostname(parsedBlogUrl.hostname)) {
      res.status(403).json({
        error: 'URL jaringan lokal/internal tidak diperbolehkan. Gunakan URL blog publik.',
      });
      return;
    }

    let targetUrl = `${parsedBlogUrl.origin}/`;
    if (rawArticleUrl) {
      const artWithProto = /^https?:\/\//i.test(rawArticleUrl)
        ? rawArticleUrl
        : `https://${rawArticleUrl}`;
      try {
        const parsedArt = new URL(artWithProto);
        if (
          ['http:', 'https:'].includes(parsedArt.protocol) &&
          !isBlockedHostname(parsedArt.hostname)
        ) {
          targetUrl = parsedArt.toString();
        }
      } catch {
        // Fallback cleanly to blog origin if article URL malformed
      }
    }

    const blogOrigin = parsedBlogUrl.origin;
    const blogHomeUrl = `${blogOrigin}/`;
    const sitemapUrl = `${blogOrigin}/sitemap.xml`;
    const robotsUrl = `${blogOrigin}/robots.txt`;
    const atomFeedUrl = `${blogOrigin}/feeds/posts/default`;
    const rssFeedUrl = `${blogOrigin}/feeds/posts/default?alt=rss`;

    const timedFetch = async (
      url: string,
      init: RequestInit = {},
      timeoutMs = 10000
    ): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    interface ExternalSubmitResult {
      id: string;
      serviceName: string;
      endpointUrl: string;
      method: 'GET' | 'POST';
      ok: boolean;
      statusCode: number | null;
      latencyMs: number;
      summary: string;
    }

    // 1) Live external blog, sitemap.xml, and robots.txt verification
    let blogStatus: number | null = null;
    let sitemapStatus: number | null = null;
    let robotsStatus: number | null = null;
    let sitemapUrlCount = 0;
    let hasGoogleVerificationMeta = false;
    let liveTitle = parsedBlogUrl.hostname;

    const liveVerifyStart = Date.now();
    const [blogRes, sitemapRes, robotsRes] = await Promise.allSettled([
      timedFetch(blogHomeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaSeoChecker/1.0)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      }),
      timedFetch(sitemapUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaSeoChecker/1.0)',
          Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        },
      }),
      timedFetch(robotsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaSeoChecker/1.0)',
        },
      }),
    ]);

    if (blogRes.status === 'fulfilled') {
      blogStatus = blogRes.value.status;
      if (blogRes.value.ok) {
        const html = await blogRes.value.text();
        const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        if (titleM?.[1]) liveTitle = titleM[1].replace(/\s+/g, ' ').trim();
        hasGoogleVerificationMeta =
          /name=["']google-site-verification["']/i.test(html);
      }
    }
    if (sitemapRes.status === 'fulfilled') {
      sitemapStatus = sitemapRes.value.status;
      if (sitemapRes.value.ok) {
        const smText = await sitemapRes.value.text();
        sitemapUrlCount = (smText.match(/<loc>/gi) || []).length;
      }
    }
    if (robotsRes.status === 'fulfilled') {
      robotsStatus = robotsRes.value.status;
    }

    const results: ExternalSubmitResult[] = [];

    results.push({
      id: 'live-verify',
      serviceName: 'Verifikasi Publik Live Blog & Sitemap XML',
      endpointUrl: sitemapUrl,
      method: 'GET',
      ok: Boolean(blogStatus && blogStatus < 400 && sitemapStatus && sitemapStatus < 400),
      statusCode: sitemapStatus ?? blogStatus,
      latencyMs: Date.now() - liveVerifyStart,
      summary: `Blog HTTP ${blogStatus ?? 'Gagal'} · Sitemap.xml HTTP ${sitemapStatus ?? 'Gagal'} (${sitemapUrlCount} URL ditemukan) · robots.txt HTTP ${robotsStatus ?? 'Gagal'}${hasGoogleVerificationMeta ? ' · Meta GSC terpasang' : ''}`,
    });

    // 2) Google Official WebSub / PubSubHubbub Hub
    const webSubStart = Date.now();
    try {
      const wsResp = await timedFetch('https://pubsubhubbub.appspot.com/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'hub.mode': 'publish',
          'hub.url': atomFeedUrl,
        }).toString(),
      });
      const wsBody = await wsResp.text();
      results.push({
        id: 'google-websub',
        serviceName: 'Google WebSub / PubSubHubbub Hub',
        endpointUrl: 'https://pubsubhubbub.appspot.com/',
        method: 'POST',
        ok: wsResp.ok,
        statusCode: wsResp.status,
        latencyMs: Date.now() - webSubStart,
        summary: wsResp.ok
          ? `Notifikasi pembaruan feed (${atomFeedUrl}) diterima hub Google resmi (HTTP ${wsResp.status}).`
          : `Hub mengembalikan HTTP ${wsResp.status}: ${wsBody.slice(0, 140)}`,
      });
    } catch (e) {
      results.push({
        id: 'google-websub',
        serviceName: 'Google WebSub / PubSubHubbub Hub',
        endpointUrl: 'https://pubsubhubbub.appspot.com/',
        method: 'POST',
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - webSubStart,
        summary: e instanceof Error ? e.message : 'Gagal menghubungi pubsubhubbub.appspot.com.',
      });
    }

    // 3) Ping-O-Matic XML-RPC Blog Update Ping (dispatches to multiple external blog search aggregators)
    const pingStart = Date.now();
    try {
      const xmlRpcPayload = `<?xml version="1.0"?>
<methodCall>
  <methodName>weblogUpdates.extendedPing</methodName>
  <params>
    <param><value>${escapeXmlEntity(liveTitle)}</value></param>
    <param><value>${escapeXmlEntity(blogHomeUrl)}</value></param>
    <param><value>${escapeXmlEntity(targetUrl)}</value></param>
    <param><value>${escapeXmlEntity(rssFeedUrl)}</value></param>
  </params>
</methodCall>`;
      const pingResp = await timedFetch('https://rpc.pingomatic.com/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'User-Agent': 'TemaLokaSeoSubmitter/1.0',
        },
        body: xmlRpcPayload,
      });
      const pingBody = await pingResp.text();
      const flError = /<name>flerror<\/name>\s*<value>\s*<boolean>1<\/boolean>/i.test(pingBody);
      const msgMatch = /<name>message<\/name>\s*<value>\s*(?:<string>)?([^<]+)/i.exec(pingBody);
      results.push({
        id: 'pingomatic',
        serviceName: 'Ping-O-Matic RPC (Agregator Blog Eksternal)',
        endpointUrl: 'https://rpc.pingomatic.com/',
        method: 'POST',
        ok: pingResp.ok && !flError,
        statusCode: pingResp.status,
        latencyMs: Date.now() - pingStart,
        summary: msgMatch?.[1]?.trim() || `Respon HTTP ${pingResp.status} dari rpc.pingomatic.com`,
      });
    } catch (e) {
      results.push({
        id: 'pingomatic',
        serviceName: 'Ping-O-Matic RPC (Agregator Blog Eksternal)',
        endpointUrl: 'https://rpc.pingomatic.com/',
        method: 'POST',
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - pingStart,
        summary: e instanceof Error ? e.message : 'Gagal menghubungi rpc.pingomatic.com.',
      });
    }

    // 4) Internet Archive Wayback Machine Snapshot Save
    const wbStart = Date.now();
    const wbEndpoint = `https://web.archive.org/save/${targetUrl}`;
    try {
      const wbResp = await timedFetch(
        wbEndpoint,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TemaLokaSeoSubmitter/1.0)',
          },
        },
        12000
      );
      const contentLoc = wbResp.headers.get('content-location') || wbResp.headers.get('location') || '';
      results.push({
        id: 'wayback-save',
        serviceName: 'Internet Archive (Wayback Machine Save)',
        endpointUrl: wbEndpoint,
        method: 'GET',
        ok: wbResp.ok || wbResp.status === 302,
        statusCode: wbResp.status,
        latencyMs: Date.now() - wbStart,
        summary:
          wbResp.ok || wbResp.status === 302
            ? `Permintaan arsip halaman dikirim ke web.archive.org (HTTP ${wbResp.status}${contentLoc ? ` · ${contentLoc}` : ''}).`
            : `web.archive.org merespons HTTP ${wbResp.status}.`,
      });
    } catch (e) {
      results.push({
        id: 'wayback-save',
        serviceName: 'Internet Archive (Wayback Machine Save)',
        endpointUrl: wbEndpoint,
        method: 'GET',
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - wbStart,
        summary: e instanceof Error ? e.message : 'Timeout atau gagal menghubungi web.archive.org.',
      });
    }

    // 5) Real IndexNow API (Bing + Yandex + Seznam + Naver) when user provides custom domain key
    if (indexNowKey) {
      const idxEndpoints = [
        { id: 'indexnow-global', name: 'IndexNow Global Hub', url: 'https://api.indexnow.org/indexnow' },
        { id: 'indexnow-bing', name: 'Microsoft Bing IndexNow', url: 'https://www.bing.com/indexnow' },
        { id: 'indexnow-yandex', name: 'Yandex IndexNow', url: 'https://yandex.com/indexnow' },
      ];
      const payload = {
        host: parsedBlogUrl.hostname,
        key: indexNowKey,
        keyLocation: `${blogOrigin}/${indexNowKey}.txt`,
        urlList: Array.from(new Set([targetUrl, blogHomeUrl])),
      };

      await Promise.all(
        idxEndpoints.map(async (ep) => {
          const st = Date.now();
          try {
            const resp = await timedFetch(ep.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              body: JSON.stringify(payload),
            });
            const bodyTxt = await resp.text();
            results.push({
              id: ep.id,
              serviceName: ep.name,
              endpointUrl: ep.url,
              method: 'POST',
              ok: resp.ok || resp.status === 202,
              statusCode: resp.status,
              latencyMs: Date.now() - st,
              summary:
                resp.ok || resp.status === 202
                  ? `Diterima oleh ${ep.name} (HTTP ${resp.status}).`
                  : `HTTP ${resp.status}: ${(bodyTxt || 'Pastikan file kunci <key>.txt dapat diakses publik pada root domain').slice(0, 160)}`,
            });
          } catch (e) {
            results.push({
              id: ep.id,
              serviceName: ep.name,
              endpointUrl: ep.url,
              method: 'POST',
              ok: false,
              statusCode: null,
              latencyMs: Date.now() - st,
              summary: e instanceof Error ? e.message : `Gagal menghubungi ${ep.url}.`,
            });
          }
        })
      );
    }

    res.json({
      blogOrigin,
      targetUrl,
      sitemapUrl,
      atomFeedUrl,
      rssFeedUrl,
      liveVerify: {
        blogStatus,
        sitemapStatus,
        robotsStatus,
        sitemapUrlCount,
        hasGoogleVerificationMeta,
        liveTitle,
      },
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Gagal memproses pengiriman URL ke layanan eksternal.',
    });
  }
});

// 1b. Check per-account Gemini quota status
app.post('/api/ai/quota-status', async (req, res) => {
  const verified = await verifyAndChargeGeminiRequest(req, res, { consumeQuota: false });
  if (!verified) return;
  res.json({ quota: verified.quota, model: verified.model });
});

// 2. AI Theme Designer (Palette + Fonts + Variable Updates + Custom CSS)
app.post('/api/ai/generate-theme', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const currentVariables = Array.isArray(req.body?.currentVariables) ? req.body.currentVariables : [];

    if (!prompt) {
      res.status(400).json({ error: 'Tuliskan deskripsi tema atau nuansa yang diinginkan.' });
      return;
    }

    const ai = getGeminiClient();

    const varListText = currentVariables
      .slice(0, 60)
      .map((v: { name?: string; description?: string; type?: string; value?: string }) =>
        `- ${v.name} (${v.type || 'string'}): "${v.description || ''}" = ${v.value || ''}`
      )
      .join('\n');

    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Rancang tema Blogspot berdasarkan permintaan pengguna berikut:
"${prompt}"

Variabel XML yang tersedia di template saat ini:
${varListText || '(Tidak ada variabel XML khusus, gunakan palet global dan customCss)'}

Aturan desain wajib:
1. Pastikan rasio kontras teks terhadap latar belakang memenuhi WCAG AA (minimal 4.5:1).
2. Pilih kombinasi 1 font judul (headingFont) dan 1 font isi (bodyFont) dari daftar Google Fonts populer seperti: Plus Jakarta Sans, DM Sans, Outfit, Bricolage Grotesque, Playfair Display, Fraunces, Cormorant Garamond, Lora, Source Serif 4, Merriweather, Manrope, Work Sans, Oswald, JetBrains Mono.
3. Jika ada variabel XML bertipe color yang cocok (misalnya background, text, link, accent, header), masukkan ke variableUpdates dengan nilai hex #RRGGBB yang valid.
4. Sertakan customCss singkat yang bersih untuk mempercantik tombol, kartu artikel, kutipan, dan navigasi sesuai nuansa yang diminta (tanpa merusak tata letak responsif).
5. Berikan rationale singkat dalam bahasa Indonesia yang jelas.`,
      config: {
        systemInstruction: 'Anda adalah desainer UI/UX dan pakar template XML Blogger/Blogspot profesional. Jawab selalu dalam JSON terstruktur sesuai skema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            themeName: { type: Type.STRING, description: 'Nama singkat konsep tema dalam Bahasa Indonesia' },
            rationale: { type: Type.STRING, description: 'Penjelasan singkat pemilihan warna dan font' },
            colors: {
              type: Type.OBJECT,
              properties: {
                background: { type: Type.STRING },
                surface: { type: Type.STRING },
                primary: { type: Type.STRING },
                heading: { type: Type.STRING },
                text: { type: Type.STRING },
                mutedText: { type: Type.STRING },
                link: { type: Type.STRING },
                headerBg: { type: Type.STRING },
                headerText: { type: Type.STRING },
                border: { type: Type.STRING },
              },
              required: ['background', 'surface', 'primary', 'heading', 'text', 'mutedText', 'link', 'headerBg', 'headerText', 'border'],
            },
            fonts: {
              type: Type.OBJECT,
              properties: {
                headingFont: { type: Type.STRING },
                bodyFont: { type: Type.STRING },
                baseFontSize: { type: Type.NUMBER },
                lineHeight: { type: Type.NUMBER },
                headingWeight: { type: Type.NUMBER },
                borderRadius: { type: Type.NUMBER },
              },
              required: ['headingFont', 'bodyFont', 'baseFontSize', 'lineHeight', 'headingWeight', 'borderRadius'],
            },
            variableUpdates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  value: { type: Type.STRING },
                },
                required: ['name', 'value'],
              },
            },
            customCss: { type: Type.STRING },
          },
          required: ['themeName', 'rationale', 'colors', 'fonts', 'variableUpdates', 'customCss'],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim());
    res.json({ ...data, modelUsed: verified.model, quota: verified.quota });
  } catch (err) {
    console.error('AI generate-theme error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal menghasilkan tema AI.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 3. AI Natural-Language CSS Modifier
app.post('/api/ai/custom-css', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
    const currentCustomCss = typeof req.body?.currentCustomCss === 'string' ? req.body.currentCustomCss : '';
    const templateSummary = typeof req.body?.templateSummary === 'string' ? req.body.templateSummary : '';

    if (!instruction) {
      res.status(400).json({ error: 'Masukkan instruksi modifikasi tampilan terlebih dahulu.' });
      return;
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Instruksi pengguna untuk memodifikasi tampilan template Blogspot:
"${instruction}"

Konteks struktur template saat ini:
${templateSummary}

CSS kustom yang sudah ada sebelumnya:
${currentCustomCss || '(Kosong)'}

Tugas Anda:
Hasilkan kode CSS lengkap yang menggabungkan penyesuaian sebelumnya (kecuali jika bertentangan dengan instruksi baru) dengan aturan CSS baru yang rapi dan responsif untuk elemen Blogger standar (.Header, .PageList, .post-outer, .post, .post-title, .post-body, .jump-link a, .sidebar-container .widget, .Label a, .PopularPosts, .footer-outer).
Jangan sertakan tag <style> atau </style>. Kembalikan CSS murni dan ringkasan perubahan dalam Bahasa Indonesia.`,
      config: {
        systemInstruction: 'Anda adalah front-end engineer spesialis tema Blogger/Blogspot. Kembalikan JSON valid.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            css: { type: Type.STRING, description: 'Kode CSS siap pakai tanpa tag <style>' },
            explanation: { type: Type.STRING, description: 'Penjelasan singkat perubahan CSS dalam Bahasa Indonesia' },
          },
          required: ['css', 'explanation'],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim());
    res.json({ ...data, modelUsed: verified.model, quota: verified.quota });
  } catch (err) {
    console.error('AI custom-css error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal membuat CSS kustom dengan AI.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 4. AI Sample Blog Content Generator
app.post('/api/ai/sample-content', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
    if (!topic) {
      res.status(400).json({ error: 'Masukkan topik blog untuk membuat konten sampel.' });
      return;
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Buat konten pratinjau blog Blogspot yang sangat realistis dalam Bahasa Indonesia untuk topik:
"${topic}"

Buat:
- blogTitle: Nama blog yang menarik dan natural
- blogDescription: Deskripsi singkat 1 kalimat
- authorName: Nama penulis yang natural
- authorBio: Bio singkat 1-2 kalimat
- navLinks: 4 tautan menu navigasi (Beranda + 3 kategori relevan)
- labels: 5 label/kategori beserta jumlah artikelnya
- posts: 4 artikel lengkap. Untuk setiap artikel sertakan:
  - title (judul menarik, tidak klise)
  - snippet (ringkasan 2 kalimat)
  - bodyHtml (isi artikel HTML yang kaya: 3 paragraf <p>, 1 subjudul <h3>, dan 1 kutipan <blockquote> agar tampilan halaman artikel dapat diuji secara menyeluruh)
  - category (1 kata/frasa kategori)
  - readTime (contoh: "4 mnt baca")
  - date (contoh: "14 Nov 2026")`,
      config: {
        systemInstruction: 'Anda adalah editor media dan penulis blog profesional berbahasa Indonesia.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            blogTitle: { type: Type.STRING },
            blogDescription: { type: Type.STRING },
            authorName: { type: Type.STRING },
            authorBio: { type: Type.STRING },
            navLinks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  category: { type: Type.STRING },
                },
                required: ['label'],
              },
            },
            labels: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  count: { type: Type.NUMBER },
                },
                required: ['name', 'count'],
              },
            },
            posts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  snippet: { type: Type.STRING },
                  bodyHtml: { type: Type.STRING },
                  category: { type: Type.STRING },
                  readTime: { type: Type.STRING },
                  date: { type: Type.STRING },
                },
                required: ['title', 'snippet', 'bodyHtml', 'category', 'readTime', 'date'],
              },
            },
          },
          required: ['blogTitle', 'blogDescription', 'authorName', 'authorBio', 'navLinks', 'labels', 'posts'],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim());
    res.json({ ...data, modelUsed: verified.model, quota: verified.quota });
  } catch (err) {
    console.error('AI sample-content error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal membuat konten sampel dengan AI.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 5. AI XML Diagnostics & Auto-Fix
app.post('/api/ai/diagnose-xml', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const xmlSnippet = typeof req.body?.xmlSnippet === 'string' ? req.body.xmlSnippet.slice(0, 24000) : '';
    const stats = req.body?.stats || {};

    if (!xmlSnippet) {
      res.status(400).json({ error: 'Tidak ada kode XML untuk dianalisis.' });
      return;
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Audit struktur dan kualitas template XML Blogger berikut.
Statistik terdeteksi:
- Jumlah Variable: ${stats.variables ?? 0}
- Jumlah b:section: ${stats.sections ?? 0}
- Jumlah b:widget: ${stats.widgets ?? 0}
- Meta viewport responsif: ${stats.hasViewportMeta ? 'Ada' : 'Tidak ada'}
- Tag b:skin: ${stats.hasSkin ? 'Ada' : 'Tidak ada'}

Cuplikan kode XML (bagian awal & CSS):
${xmlSnippet}

Berikan:
1. summary: Ringkasan kondisi template dalam 2 kalimat Bahasa Indonesia.
2. items: 4-5 temuan konkret (severity: "good" | "warning" | "fixable") mencakup responsivitas perangkat seluler, keterbacaan tipografi, kelengkapan tag Blogger, dan aksesibilitas kontras.
3. suggestedCssFix: Blok CSS perbaikan responsivitas & keterbacaan yang aman diterapkan ke template ini (tanpa tag <style>).`,
      config: {
        systemInstruction: 'Anda adalah arsitek template Blogger/Blogspot yang fokus pada performa, responsivitas, dan keterbacaan.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['category', 'severity', 'title', 'detail'],
              },
            },
            suggestedCssFix: { type: Type.STRING },
          },
          required: ['summary', 'items', 'suggestedCssFix'],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim());
    res.json({ ...data, modelUsed: verified.model, quota: verified.quota });
  } catch (err) {
    console.error('AI diagnose-xml error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal menganalisis template XML.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 6. AI Forensic Signature & Watermark Detection
app.post('/api/ai/detect-ai-signature', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const xmlExcerpt =
      typeof req.body?.xmlExcerpt === 'string' ? req.body.xmlExcerpt.slice(0, 22000) : '';
    const staticSummary =
      typeof req.body?.staticSummary === 'string' ? req.body.staticSummary.slice(0, 2000) : '';

    if (!xmlExcerpt.trim()) {
      res.status(400).json({ error: 'Tidak ada cuplikan template XML untuk dianalisis.' });
      return;
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Anda adalah analis forensik kode template Blogger/Blogspot XML.
Periksa apakah template XML ini dibuat, dihasilkan, atau ditandatangani oleh AI (ChatGPT/OpenAI, Claude/Anthropic, Gemini/AI Studio, DeepSeek, Copilot, Qwen, Grok, Cursor, Windsurf, v0, Bolt.new, Lovable, atau AI lainnya) berdasarkan:
- Komentar XML/HTML/CSS/JS, catatan panduan untuk pengguna, atau header pembuat/generator.
- Tag <meta>, atribut data-*, JSON-LD, kredit footer, nama variabel, atau pola kode generik khas LLM.
- Petunjuk tersirat atau penulisan ulang tanda tangan AI dalam bahasa apa pun (Indonesia/Inggris/dll).

Ringkasan pemindaian awal deterministik:
${staticSummary || 'Belum ada ringkasan.'}

Cuplikan Template XML:
${xmlExcerpt}

Berikan hasil JSON terstruktur dengan:
1. isAiSigned: boolean (true jika kuat dibuat/dibantu/ditandatangani AI).
2. confidenceScore: angka 0-100.
3. verdictLabel: label singkat Bahasa Indonesia (mis. "Ditandatangani ChatGPT / AI", "Kemungkinan Dibantu AI", atau "Tidak Terdeteksi Tanda Tangan AI").
4. detectedTools: array nama alat/model AI yang teridentifikasi (kosong jika tidak ada).
5. reasoning: penjelasan ringkas 2-3 kalimat dalam Bahasa Indonesia.
6. extraSignatures: maksimal 6 temuan potongan kode (snippet persis seperti di XML jika ada) yang mencurigakan sebagai tanda tangan atau jejak AI.`,
      config: {
        systemInstruction:
          'Anda adalah analis forensik kode XML Blogger yang objektif. Hanya kutip snippet yang benar-benar muncul pada cuplikan XML yang diberikan.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isAiSigned: { type: Type.BOOLEAN },
            confidenceScore: { type: Type.NUMBER },
            verdictLabel: { type: Type.STRING },
            detectedTools: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            reasoning: { type: Type.STRING },
            extraSignatures: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  snippet: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  suspectedTool: { type: Type.STRING },
                  zone: { type: Type.STRING },
                },
                required: ['snippet', 'reason', 'suspectedTool', 'zone'],
              },
            },
          },
          required: [
            'isAiSigned',
            'confidenceScore',
            'verdictLabel',
            'detectedTools',
            'reasoning',
            'extraSignatures',
          ],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim());
    res.json({ ...data, modelUsed: verified.model, quota: verified.quota });
  } catch (err) {
    console.error('AI detect-ai-signature error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal menjalankan analisis forensik tanda tangan AI.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 7. Unified Feature Audit for every Workspace Tab (Preview, Layout, SEO, Errors, Editor, Inspector, Console)
app.post('/api/ai/feature-audit', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const page = typeof req.body?.page === 'string' ? req.body.page.slice(0, 32) : 'preview';
    const contextSummary =
      typeof req.body?.contextSummary === 'string' ? req.body.contextSummary.slice(0, 12000) : '';

    if (!contextSummary.trim()) {
      res.status(400).json({ error: 'Ringkasan konteks template tidak tersedia.' });
      return;
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Anda adalah asisten pakar TemaLoka untuk tab "${page}".
Berdasarkan konteks template XML Blogger aktif berikut, berikan ringkasan audit singkat, 3-4 poin temuan & saran perbaikan konkret dalam Bahasa Indonesia, dan opsional CSS perbaikan responsif (jika relevan dengan tab preview/layout/seo).

Konteks Template:
${contextSummary}`,
      config: {
        systemInstruction:
          'Anda adalah konsultan teknis template Blogger XML (Blogspot). Jawab ringkas, akurat, dalam JSON valid.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            highlights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            suggestedCss: { type: Type.STRING },
          },
          required: ['summary', 'highlights'],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim());
    res.json({
      page,
      engineLabel: `Gemini (${verified.model})`,
      summary: data.summary || 'Analisis Gemini selesai.',
      highlights: Array.isArray(data.highlights) ? data.highlights : [],
      suggestedCss: typeof data.suggestedCss === 'string' && data.suggestedCss.trim() ? data.suggestedCss.trim() : undefined,
      quota: verified.quota,
    });
  } catch (err) {
    console.error('AI feature-audit error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal menjalankan audit fitur dengan Gemini.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 8. Unified Multi-Turn AI Chat connected to active XML Template & Workspace
app.post('/api/ai/chat', async (req, res) => {
  try {
    const verified = await verifyAndChargeGeminiRequest(req, res);
    if (!verified) return;

    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 8000) : '';
    const activePage = typeof req.body?.activePage === 'string' ? req.body.activePage.slice(0, 32) : 'preview';
    const templateContext =
      typeof req.body?.templateContext === 'string' ? req.body.templateContext.slice(0, 80000) : '';
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const rawAttachedParts = Array.isArray(req.body?.attachedParts) ? req.body.attachedParts : [];

    if (!message) {
      res.status(400).json({ error: 'Tuliskan pertanyaan atau perintah untuk AI terlebih dahulu.' });
      return;
    }

    // Build full untruncated attached XML splitter parts (up to ~1.5M chars safely within Gemini 1M-token window)
    const MAX_ATTACHED_TOTAL_CHARS = 1_500_000;
    let totalAttachedChars = 0;
    const attachedBlocks: string[] = [];
    for (let i = 0; i < rawAttachedParts.length && i < 60; i++) {
      const part = rawAttachedParts[i] as {
        index?: number;
        total?: number;
        filename?: string;
        title?: string;
        lineCount?: number;
        byteSize?: number;
        content?: string;
      };
      if (!part || typeof part.content !== 'string' || !part.content) continue;
      if (totalAttachedChars + part.content.length > MAX_ATTACHED_TOTAL_CHARS) {
        res.status(413).json({
          error: `Total lampiran bagian XML melebihi batas sekali kirim (~1.5 MB teks). Pilih sebagian bagian XML di XML Splitter lalu kirim bertahap agar tidak ada kode yang terpotong.`,
        });
        return;
      }
      totalAttachedChars += part.content.length;
      const partIdx = typeof part.index === 'number' ? part.index : i + 1;
      const partTot = typeof part.total === 'number' ? part.total : rawAttachedParts.length;
      const fileLabel = typeof part.filename === 'string' ? part.filename.slice(0, 140) : `bagian-${partIdx}.xml`;
      const titleLabel = typeof part.title === 'string' ? part.title.slice(0, 140) : `Bagian #${partIdx}`;
      const lineInfo = typeof part.lineCount === 'number' ? `${part.lineCount} baris` : '';
      const kbInfo = typeof part.byteSize === 'number' ? `${(part.byteSize / 1024).toFixed(1)} KB` : '';
      const metaParen = [lineInfo, kbInfo].filter(Boolean).join(', ');
      attachedBlocks.push(
        `--- BAGIAN #${partIdx}/${partTot} | ${fileLabel} | ${titleLabel}${metaParen ? ` (${metaParen})` : ''} ---\n${part.content}\n--- AKHIR BAGIAN #${partIdx}/${partTot} ---`
      );
    }

    const historyLines = rawHistory
      .slice(-10)
      .map((item: { role?: string; content?: string }) => {
        const roleLabel = item?.role === 'assistant' ? 'Asisten' : 'Pengguna';
        const text = typeof item?.content === 'string' ? item.content.slice(0, 1500) : '';
        return text ? `${roleLabel}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    const attachedSection =
      attachedBlocks.length > 0
        ? `\n\n=== LAMPIRAN BAGIAN XML UTUH DARI XML SPLITTER (${attachedBlocks.length} BAGIAN, TIDAK TERPOTONG) ===\n${attachedBlocks.join('\n\n')}\n=== AKHIR LAMPIRAN XML UTUH ===`
        : '';

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: verified.model,
      contents: `Tab aktif pengguna saat ini: ${activePage}

Ringkasan & konteks template XML Blogger yang sedang dibuka:
${templateContext || '(Belum ada konteks XML khusus)'}${attachedSection}

${historyLines ? `Riwayat percakapan sebelumnya:\n${historyLines}\n\n` : ''}Pertanyaan / Perintah Terbaru Pengguna:
${message}`,
      config: {
        systemInstruction:
          'Anda adalah Asisten AI resmi di dalam studio TemaLoka (editor & inspector template XML Blogspot/Blogger). ' +
          'Jawab dalam Bahasa Indonesia yang jelas, terstruktur, dan langsung merujuk ke detail template XML aktif (nama section, widget, variable, CSS, JS, parameter URL, SEO/AdSense, atau error XML) bila tersedia. ' +
          'Jika pengguna melampirkan BAGIAN XML UTUH dari XML Splitter, baca seluruh isi bagian tersebut secara lengkap dari awal sampai akhir tanpa mengabaikan baris akhir maupun CDATA. ' +
          'Jika pengguna meminta perbaikan CSS atau gaya tampilan, sertakan kode CSS bersih di dalam blok ```css ... ``` (tanpa tag <style>) agar pengguna bisa menerapkannya dengan satu klik.',
      },
    });

    const reply = (response.text ?? '').trim() || 'Maaf, tidak ada jawaban teks yang dihasilkan.';
    const cssMatch = /```css\s*([\s\S]*?)```/i.exec(reply);
    const suggestedCss = cssMatch?.[1]?.trim() || undefined;

    res.json({
      reply,
      suggestedCss,
      engineLabel: `Gemini (${verified.model})`,
      modelId: verified.model,
      quota: verified.quota,
    });
  } catch (err) {
    console.error('AI chat error:', err);
    const formatted = getGeminiErrorResponse(err, 'Gagal memproses pesan Chat AI.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

interface AdsTxtCacheEntry {
  content: string;
  expiresAt: number;
}

let adsTxtCache: AdsTxtCacheEntry | null = null;
const ADS_TXT_CACHE_TTL_MS = 15_000;

function extractPubDigitsFromPublisherId(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length >= 10 && digits.length <= 24) {
    return `pub-${digits}`;
  }
  return '';
}

async function resolveDynamicAdsTxt(): Promise<string> {
  if (adsTxtCache && adsTxtCache.expiresAt > Date.now()) {
    return adsTxtCache.content;
  }

  const fallbackDisabled = '# ads.txt belum dikonfigurasi di Panel Admin AdSense (/?admin).\n';
  const { projectId, firestoreDatabaseId, apiKey } = FIREBASE_APPLET_CONFIG;
  if (!projectId || !apiKey) {
    return fallbackDisabled;
  }

  try {
    const endpoint =
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/databases/${encodeURIComponent(firestoreDatabaseId)}` +
      `/documents/appConfig/adsense?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return fallbackDisabled;
    }

    const docData = (await response.json()) as {
      fields?: {
        adsenseEnabled?: { booleanValue?: boolean };
        adsTxtContent?: { stringValue?: string };
        publisherId?: { stringValue?: string };
      };
    };

    const fields = docData?.fields;
    if (!fields) {
      return fallbackDisabled;
    }

    const enabled = fields.adsenseEnabled?.booleanValue === true;
    const rawAdsTxt = (fields.adsTxtContent?.stringValue ?? '').replace(/\r\n?/g, '\n').trim();
    const rawPubId = (fields.publisherId?.stringValue ?? '').trim();

    let resolved = fallbackDisabled;
    if (!enabled) {
      resolved = '# AdSense saat ini dinonaktifkan oleh admin di Pengaturan AdSense (/?admin).\n';
    } else if (rawAdsTxt) {
      resolved = `${rawAdsTxt}\n`;
    } else {
      const pubToken = extractPubDigitsFromPublisherId(rawPubId);
      if (pubToken) {
        resolved = `google.com, ${pubToken}, DIRECT, f08c47fec0942fa0\n`;
      }
    }

    adsTxtCache = {
      content: resolved,
      expiresAt: Date.now() + ADS_TXT_CACHE_TTL_MS,
    };
    return resolved;
  } catch {
    return adsTxtCache?.content ?? fallbackDisabled;
  }
}

app.get('/ads.txt', async (_req, res) => {
  const content = await resolveDynamicAdsTxt();
  res.setHeader('Cache-Control', 'public, max-age=15');
  res.type('text/plain; charset=utf-8').send(content);
});

async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });

    if (hmrDisabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await vite.transformRequest('/@vite/client');
          if (!result) return next();
          const code = result.code
            .replace(
              'transport.connect(createHMRHandler(handleMessage));',
              '/* HMR WebSocket disabled */'
            )
            .replace(
              'else throw new SendBeforeConnectError("send was called before connect");',
              'else return; /* HMR disabled */'
            )
            .replace(
              'else throw new SendBeforeConnectError("invoke was called before connect");',
              'else return; /* HMR disabled */'
            );
          res.type('application/javascript').send(code);
        } catch (err) {
          next(err);
        }
      });

      app.get('/@vite-plugin-pwa/pwa-entry-point-loaded', (_req, res) => {
        res
          .type('application/javascript')
          .send(
            'export default function registerDevSW() {\n  /* HMR disabled: service worker is registered via virtual:pwa-register */\n}\n'
          );
      });
    }

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TemaLoka server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
