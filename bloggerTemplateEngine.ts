import type {
  BloggerVariable,
  DevicePreset,
  PreviewPageType,
  SampleBlogData,
  SamplePost,
} from '../types/blogger';

export interface AstAttr {
  name: string;
  value: string;
}

export type AstNode =
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | {
      kind: 'element';
      tagName: string;
      lowerTag: string;
      attrs: AstAttr[];
      children: AstNode[];
      selfClosing: boolean;
    };

const VOID_OR_SELF_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
  'b:else',
  'b:elseif',
  'b:include',
  'b:attr',
  'b:class',
  'b:eval',
  'b:widget-setting',
]);

export function decodeXmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  return input
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num: string) => {
      const code = Number(num);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : _;
    })
    .replace(/&amp;/g, '&');
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolvePreviewAssetUrl(url: string): string {
  if (!url) return '';
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return url;
}

export function buildEditorialCoverSvgUri(
  title: string,
  category: string,
  index = 0
): string {
  const palettes = [
    ['#1e3a8a', '#2563eb', '#93c5fd', '#eff6ff'],
    ['#064e3b', '#059669', '#6ee7b7', '#ecfdf5'],
    ['#312e81', '#4f46e5', '#a5b4fc', '#eef2ff'],
    ['#7c2d12', '#ea580c', '#fdba74', '#fff7ed'],
  ];
  const [dark, mid, light, tint] = palettes[Math.abs(index) % palettes.length];
  const safeCat = escapeHtmlText((category || 'Blogspot').slice(0, 24).toUpperCase());
  const safeTitle = escapeHtmlText((title || 'Artikel Unggulan').slice(0, 42));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${dark}"/>
      <stop offset="100%" stop-color="${mid}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <circle cx="670" cy="90" r="150" fill="${light}" fill-opacity="0.16"/>
  <circle cx="130" cy="390" r="180" fill="${tint}" fill-opacity="0.1"/>
  <rect x="48" y="54" width="180" height="30" rx="6" fill="${tint}" fill-opacity="0.2"/>
  <text x="64" y="74" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="${tint}" letter-spacing="1.2">${safeCat}</text>
  <rect x="48" y="300" width="704" height="96" rx="12" fill="#0f172a" fill-opacity="0.28"/>
  <text x="72" y="344" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${safeTitle}</text>
  <text x="72" y="374" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="${tint}" fill-opacity="0.9">Pratinjau Gambar Sampul · TemaLoka Studio</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildAuthorAvatarSvgUri(authorName: string): string {
  const initials = (authorName || 'TL')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'TL';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="64" fill="#1e293b"/>
  <circle cx="64" cy="48" r="22" fill="#60a5fa" fill-opacity="0.3"/>
  <text x="64" y="75" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="700" fill="#ffffff">${escapeHtmlText(initials)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function ensureRealisticSampleData(raw: SampleBlogData): SampleBlogData {
  const blogTitle = raw.blogTitle?.trim() || 'Jurnal TemaLoka Indonesia';
  const blogDescription =
    raw.blogDescription?.trim() ||
    'Catatan desain web, tutorial template Blogger XML, dan tips optimasi performa blog.';
  const authorName = raw.authorName?.trim() || 'Tim Editorial';
  const authorBio =
    raw.authorBio?.trim() ||
    'Penulis & perancang antarmuka Blogger modern yang ringan dan responsif.';
  const authorAvatar =
    resolvePreviewAssetUrl(raw.authorAvatar?.trim() || '') ||
    buildAuthorAvatarSvgUri(authorName);

  const fallbackPosts: SamplePost[] = [
    {
      id: 'post-1',
      title: 'Panduan Struktur Blogger Layout v3 yang Bersih dan Mudah Dirawat',
      snippet:
        'Pelajari cara menyusun section, widget, dan variabel b:skin agar tema Blogspot Anda tetap ringan dan valid di Editor.',
      bodyHtml:
        '<p>Template Blogger modern dibangun di atas struktur XML yang rapi dengan pemisahan jelas antara <code>&lt;b:skin&gt;</code>, tata letak dashboard, dan widget modular.</p><h3>Mengapa Validitas XML Penting?</h3><p>Setiap atribut dan tag Blogger harus tertutup dengan benar agar pratinjau maupun hasil terbit tetap konsisten di layar desktop dan ponsel.</p>',
      author: authorName,
      date: '18 Nov 2026',
      category: 'Blogger XML',
      readTime: '5 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Panduan Struktur Blogger Layout v3',
        'Blogger XML',
        0
      ),
      commentsCount: 8,
    },
    {
      id: 'post-2',
      title: 'Tips Mengurangi CSS Mati dan Skrip Duplikat pada Tema Blogspot',
      snippet:
        'Aturan CSS yang tidak pernah dipanggil di markup hanya menambah ukuran XML tanpa dampak visual.',
      bodyHtml:
        '<p>Menghapus selektor usang dan pustaka eksternal ganda dapat memangkas ukuran unduhan awal secara signifikan serta memperbaiki skor Core Web Vitals.</p>',
      author: authorName,
      date: '14 Nov 2026',
      category: 'SEO & Performa',
      readTime: '4 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Optimasi CSS & Skrip Tema Blogspot',
        'SEO & Performa',
        1
      ),
      commentsCount: 5,
    },
    {
      id: 'post-3',
      title: 'Menata Hirarki Tipografi Editorial agar Nyaman Dibaca di Ponsel',
      snippet:
        'Keseimbangan antara ukuran huruf dasar, tinggi baris, dan rasio kontras warna sangat menentukan kenyamanan pembaca.',
      bodyHtml:
        '<p>Gunakan ukuran huruf minimal 16px pada badan artikel dengan tinggi baris 1.65 agar mata pembaca tidak cepat lelah di layar sempit.</p>',
      author: authorName,
      date: '09 Nov 2026',
      category: 'Desain UI',
      readTime: '4 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Tipografi Editorial Responsif Mobile',
        'Desain UI',
        2
      ),
      commentsCount: 3,
    },
    {
      id: 'post-4',
      title: 'Strategi Navigasi Label dan Widget Sidebar Tanpa Membuat Layout Penuh',
      snippet:
        'Susun widget PopularPosts, Label, dan kotak pencarian secara proporsional agar halaman utama tetap rapi.',
      bodyHtml:
        '<p>Sidebar yang ringkas membantu pengunjung menemukan topik populer lebih cepat tanpa mengganggu fokus baca pada kolom utama.</p>',
      author: authorName,
      date: '04 Nov 2026',
      category: 'Produktivitas',
      readTime: '3 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Navigasi Label & Tata Letak Sidebar',
        'Produktivitas',
        3
      ),
      commentsCount: 2,
    },
  ];

  const sourcePosts = raw.posts && raw.posts.length > 0 ? raw.posts : fallbackPosts;
  const normalizedPosts = sourcePosts.map((p, idx) => ({
    ...p,
    title: p.title?.trim() || `Artikel Contoh #${idx + 1}`,
    snippet:
      p.snippet?.trim() ||
      'Ringkasan artikel pratinjau template Blogspot untuk memastikan elemen kartu dan tata letak tampil penuh.',
    bodyHtml:
      p.bodyHtml?.trim() ||
      `<p>${escapeHtmlText(p.snippet || 'Isi artikel pratinjau template Blogger XML.')}</p>`,
    author: p.author?.trim() || authorName,
    date: p.date?.trim() || '18 Nov 2026',
    category: p.category?.trim() || 'Umum',
    readTime: p.readTime?.trim() || '4 mnt baca',
    imageUrl:
      resolvePreviewAssetUrl(p.imageUrl?.trim() || '') ||
      buildEditorialCoverSvgUri(p.title || `Artikel ${idx + 1}`, p.category || 'Blog', idx),
    commentsCount: typeof p.commentsCount === 'number' ? p.commentsCount : 3,
  }));

  const navLinks =
    raw.navLinks && raw.navLinks.length > 0
      ? raw.navLinks
      : [
          { label: 'Beranda' },
          { label: 'Blogger XML', category: 'Blogger XML' },
          { label: 'Desain UI', category: 'Desain UI' },
          { label: 'SEO & Performa', category: 'SEO & Performa' },
        ];

  const labels =
    raw.labels && raw.labels.length > 0
      ? raw.labels
      : [
          { name: 'Blogger XML', count: 14 },
          { name: 'Desain UI', count: 9 },
          { name: 'SEO & Performa', count: 7 },
          { name: 'Produktivitas', count: 5 },
        ];

  return {
    blogTitle,
    blogDescription,
    authorName,
    authorBio,
    authorAvatar,
    navLinks,
    labels,
    posts: normalizedPosts,
  };
}

function parseAttributes(rawAttrs: string): AstAttr[] {
  const attrs: AstAttr[] = [];
  let i = 0;
  const len = rawAttrs.length;
  while (i < len) {
    while (i < len && /\s/.test(rawAttrs[i])) i++;
    if (i >= len) break;
    if (rawAttrs[i] === '/') {
      i++;
      continue;
    }
    const nameStart = i;
    while (i < len && !/[\s=/>]/.test(rawAttrs[i])) i++;
    const name = rawAttrs.slice(nameStart, i);
    if (!name) {
      i++;
      continue;
    }
    while (i < len && /\s/.test(rawAttrs[i])) i++;
    let value = '';
    if (rawAttrs[i] === '=') {
      i++;
      while (i < len && /\s/.test(rawAttrs[i])) i++;
      const quote = rawAttrs[i];
      if (quote === '"' || quote === "'") {
        i++;
        const valStart = i;
        while (i < len && rawAttrs[i] !== quote) i++;
        value = decodeXmlEntities(rawAttrs.slice(valStart, i));
        if (rawAttrs[i] === quote) i++;
      } else {
        const valStart = i;
        while (i < len && !/[\s>]/.test(rawAttrs[i])) i++;
        value = decodeXmlEntities(rawAttrs.slice(valStart, i));
      }
    } else {
      value = name;
    }
    attrs.push({ name, value });
  }
  return attrs;
}

/**
 * Quote-aware XML/HTML AST parser that handles nested Blogger tags (<b:if>, <b:loop>, <b:section>, <b:widget>)
 * even when attribute expressions contain '>' or '<' inside quotes.
 */
export function parseBloggerAst(markup: string): AstNode[] {
  const rootChildren: AstNode[] = [];
  const stack: Array<{ tagName: string; lowerTag: string; children: AstNode[] }> = [
    { tagName: '__root__', lowerTag: '__root__', children: rootChildren },
  ];

  const len = markup.length;
  let pos = 0;

  const currentChildren = () => stack[stack.length - 1].children;

  while (pos < len) {
    const ltIdx = markup.indexOf('<', pos);
    if (ltIdx === -1) {
      const trailing = markup.slice(pos);
      if (trailing) currentChildren().push({ kind: 'text', text: trailing });
      break;
    }

    if (ltIdx > pos) {
      currentChildren().push({ kind: 'text', text: markup.slice(pos, ltIdx) });
    }

    // Comment
    if (markup.startsWith('<!--', ltIdx)) {
      const endComment = markup.indexOf('-->', ltIdx + 4);
      if (endComment === -1) {
        currentChildren().push({ kind: 'comment', text: markup.slice(ltIdx) });
        break;
      }
      currentChildren().push({ kind: 'comment', text: markup.slice(ltIdx, endComment + 3) });
      pos = endComment + 3;
      continue;
    }

    // CDATA
    if (markup.startsWith('<![CDATA[', ltIdx)) {
      const endCdata = markup.indexOf(']]>', ltIdx + 9);
      if (endCdata === -1) {
        currentChildren().push({ kind: 'text', text: markup.slice(ltIdx + 9) });
        break;
      }
      currentChildren().push({ kind: 'text', text: markup.slice(ltIdx + 9, endCdata) });
      pos = endCdata + 3;
      continue;
    }

    // DOCTYPE / Processing instruction
    if (markup.startsWith('<!', ltIdx) || markup.startsWith('<?', ltIdx)) {
      const gtIdx = markup.indexOf('>', ltIdx + 2);
      if (gtIdx === -1) break;
      pos = gtIdx + 1;
      continue;
    }

    // Scan tag header respecting quoted attributes
    let scan = ltIdx + 1;
    let inQuote: '"' | "'" | null = null;
    while (scan < len) {
      const ch = markup[scan];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else {
        if (ch === '"' || ch === "'") inQuote = ch;
        else if (ch === '>') break;
      }
      scan++;
    }

    if (scan >= len) {
      currentChildren().push({ kind: 'text', text: markup.slice(ltIdx) });
      break;
    }

    const rawInside = markup.slice(ltIdx + 1, scan).trim();
    pos = scan + 1;

    if (!rawInside) continue;

    // Closing tag </tag>
    if (rawInside.startsWith('/')) {
      const closeTag = rawInside.slice(1).trim().split(/\s+/)[0].toLowerCase();
      if (!closeTag) continue;
      // Find matching open tag in stack
      let matchIdx = -1;
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].lowerTag === closeTag) {
          matchIdx = s;
          break;
        }
      }
      if (matchIdx !== -1) {
        while (stack.length > matchIdx) {
          stack.pop();
        }
      }
      continue;
    }

    // Opening or self-closing tag
    const selfClosingSyntax = rawInside.endsWith('/');
    const cleanedInside = selfClosingSyntax ? rawInside.slice(0, -1).trim() : rawInside;
    const tagMatch = /^([a-zA-Z0-9:_-]+)([\s\S]*)$/.exec(cleanedInside);
    if (!tagMatch) {
      currentChildren().push({ kind: 'text', text: markup.slice(ltIdx, pos) });
      continue;
    }

    const tagName = tagMatch[1];
    const lowerTag = tagName.toLowerCase();
    const rawAttrStr = tagMatch[2] || '';
    const attrs = parseAttributes(rawAttrStr);

    // Special raw text tags (<script>, <style>, <textarea>)
    if (!selfClosingSyntax && (lowerTag === 'script' || lowerTag === 'style')) {
      const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
      const closeMatch = closeRe.exec(markup.slice(pos));
      let rawInner = '';
      if (closeMatch) {
        rawInner = markup.slice(pos, pos + closeMatch.index);
        pos = pos + closeMatch.index + closeMatch[0].length;
      }
      currentChildren().push({
        kind: 'element',
        tagName,
        lowerTag,
        attrs,
        children: rawInner ? [{ kind: 'text', text: rawInner }] : [],
        selfClosing: false,
      });
      continue;
    }

    const isVoid =
      selfClosingSyntax ||
      VOID_OR_SELF_TAGS.has(lowerTag) ||
      lowerTag.startsWith('data:');

    const elNode: AstNode = {
      kind: 'element',
      tagName,
      lowerTag,
      attrs,
      children: [],
      selfClosing: isVoid,
    };

    currentChildren().push(elNode);

    if (!isVoid) {
      stack.push({ tagName, lowerTag, children: elNode.children });
    }
  }

  return rootChildren;
}

// ============================================================================
// CSP-Safe Blogger Expression Evaluator
// ============================================================================

type ExprToken =
  | { type: 'str'; val: string }
  | { type: 'num'; val: number }
  | { type: 'id'; val: string }
  | { type: 'op'; val: string }
  | { type: 'punc'; val: string };

function tokenizeExpr(expr: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // String literal
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      let buf = '';
      while (i < len && expr[i] !== q) {
        if (expr[i] === '\\' && i + 1 < len) {
          i++;
          buf += expr[i];
        } else {
          buf += expr[i];
        }
        i++;
      }
      if (expr[i] === q) i++;
      tokens.push({ type: 'str', val: buf });
      continue;
    }

    // Number
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < len && /[0-9]/.test(expr[i + 1]))) {
      const start = i;
      while (i < len && /[0-9.]/.test(expr[i])) i++;
      tokens.push({ type: 'num', val: Number(expr.slice(start, i)) });
      continue;
    }

    // Multi-char operators
    const three = expr.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      tokens.push({ type: 'op', val: three });
      i += 3;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (
      two === '==' ||
      two === '!=' ||
      two === '<=' ||
      two === '>=' ||
      two === '&&' ||
      two === '||' ||
      two === '=>'
    ) {
      tokens.push({ type: 'op', val: two });
      i += 2;
      continue;
    }

    if ('+-*/%<>!?:'.includes(ch)) {
      tokens.push({ type: 'op', val: ch });
      i++;
      continue;
    }

    if ('()[]{},.'.includes(ch)) {
      tokens.push({ type: 'punc', val: ch });
      i++;
      continue;
    }

    // Identifier (includes `data:foo` or `b:foo` style prefixes on first segment)
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_$-]/.test(expr[i])) i++;
      // Allow `data:` prefix as part of identifier token
      if (expr[i] === ':' && expr.slice(start, i) === 'data') {
        i++;
        while (i < len && /[a-zA-Z0-9_$-]/.test(expr[i])) i++;
      }
      tokens.push({ type: 'id', val: expr.slice(start, i) });
      continue;
    }

    i++;
  }

  return tokens;
}

export interface BloggerScope {
  data: Record<string, unknown>;
  locals: Record<string, unknown>;
}

function isTruthyBlogger(val: unknown): boolean {
  if (val === null || val === undefined || val === false || val === 0 || val === '') {
    return false;
  }
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function resolveIdentifier(name: string, scope: BloggerScope): unknown {
  if (name === 'true') return true;
  if (name === 'false') return false;
  if (name === 'null') return null;
  if (name === 'undefined') return undefined;

  if (name.startsWith('data:')) {
    const sub = name.slice(5);
    if (sub in scope.locals) return scope.locals[sub];
    if (sub in scope.data) return scope.data[sub];
    if (sub === 'this') return scope.locals.this ?? scope.data.this;
    return undefined;
  }

  if (name in scope.locals) return scope.locals[name];
  if (name in scope.data) return scope.data[name];
  return undefined;
}

function getPropertyValue(target: unknown, prop: string): unknown {
  if (target === null || target === undefined) {
    if (prop === 'empty') return true;
    if (prop === 'notEmpty' || prop === 'any') return false;
    if (prop === 'length' || prop === 'size') return 0;
    return undefined;
  }

  if (Array.isArray(target)) {
    if (prop === 'length' || prop === 'size') return target.length;
    if (prop === 'empty') return target.length === 0;
    if (prop === 'notEmpty' || prop === 'any') return target.length > 0;
    if (prop === 'first') return target[0];
    if (prop === 'last') return target[target.length - 1];
    const idx = Number(prop);
    if (!Number.isNaN(idx)) return target[idx];
    return undefined;
  }

  if (typeof target === 'string') {
    if (prop === 'length' || prop === 'size') return target.length;
    if (prop === 'empty') return target.length === 0;
    if (prop === 'notEmpty') return target.length > 0;
    if (prop === 'isImage') return target.length > 0;
    if (prop === 'escaped') return escapeHtmlText(target);
    if (prop === 'urlEscaped') return encodeURIComponent(target);
    if (prop === 'jsEscaped') return JSON.stringify(target).slice(1, -1);
    return undefined;
  }

  if (typeof target === 'object') {
    const rec = target as Record<string, unknown>;
    if (prop in rec) return rec[prop];
    if (prop === 'empty') return Object.keys(rec).length === 0;
    if (prop === 'notEmpty') return Object.keys(rec).length > 0;
    if (prop === 'size') return Object.keys(rec).length;
    if (prop === 'url' && '__urlString' in rec) return rec.__urlString;
  }

  return undefined;
}

export function evalBloggerExpression(rawExpr: string, scope: BloggerScope): unknown {
  const expr = decodeXmlEntities(rawExpr || '').trim();
  if (!expr) return undefined;

  // Handle special `view.url.params.KEY` or wrapped string url object safely
  const tokens = tokenizeExpr(expr);
  if (tokens.length === 0) return undefined;

  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];

  const matchOp = (...ops: string[]) => {
    const t = peek();
    if (!t) return false;
    if (t.type === 'op' && ops.includes(t.val)) return true;
    if (t.type === 'id' && ops.includes(t.val.toLowerCase())) return true;
    return false;
  };

  const matchPunc = (p: string) => {
    const t = peek();
    return Boolean(t && t.type === 'punc' && t.val === p);
  };

  function parseTernary(): unknown {
    const cond = parseOr();
    if (matchOp('?')) {
      consume();
      const whenTrue = parseTernary();
      if (matchOp(':')) consume();
      const whenFalse = parseTernary();
      return isTruthyBlogger(cond) ? whenTrue : whenFalse;
    }
    return cond;
  }

  function parseOr(): unknown {
    let left = parseAnd();
    while (matchOp('||', 'or')) {
      consume();
      const right = parseAnd();
      left = isTruthyBlogger(left) ? left : right;
    }
    return left;
  }

  function parseAnd(): unknown {
    let left = parseMembership();
    while (matchOp('&&', 'and')) {
      consume();
      const right = parseMembership();
      left = isTruthyBlogger(left) ? right : false;
    }
    return left;
  }

  function parseMembership(): unknown {
    const left = parseEquality();
    const t = peek();
    if (t && t.type === 'id') {
      const lower = t.val.toLowerCase();
      if (lower === 'in') {
        consume();
        const right = parseEquality();
        if (Array.isArray(right)) return right.includes(left);
        if (typeof right === 'string') return right.includes(String(left ?? ''));
        if (right && typeof right === 'object') return String(left ?? '') in (right as object);
        return false;
      }
      if (lower === 'contains') {
        consume();
        const right = parseEquality();
        if (Array.isArray(left)) return left.includes(right);
        return String(left ?? '').includes(String(right ?? ''));
      }
      const nextTok = tokens[cursor + 1];
      if (lower === 'not' && nextTok?.type === 'id' && nextTok.val.toLowerCase() === 'in') {
        consume();
        consume();
        const right = parseEquality();
        if (Array.isArray(right)) return !right.includes(left);
        if (typeof right === 'string') return !right.includes(String(left ?? ''));
        return true;
      }
    }
    return left;
  }

  function parseEquality(): unknown {
    let left = parseRelational();
    while (matchOp('==', '!=', '===', '!==', 'eq', 'neq')) {
      const op = String(consume().val).toLowerCase();
      const right = parseRelational();
      const l = left && typeof left === 'object' && '__urlString' in (left as object) ? (left as { __urlString: string }).__urlString : left;
      const r = right && typeof right === 'object' && '__urlString' in (right as object) ? (right as { __urlString: string }).__urlString : right;
      if (op === '==' || op === 'eq') left = l == r; // eslint-disable-line eqeqeq
      else if (op === '===' ) left = l === r;
      else if (op === '!=' || op === 'neq') left = l != r; // eslint-disable-line eqeqeq
      else left = l !== r;
    }
    return left;
  }

  function parseRelational(): unknown {
    let left = parseRange();
    while (matchOp('<', '<=', '>', '>=', 'lt', 'lte', 'gt', 'gte')) {
      const op = String(consume().val).toLowerCase();
      const right = parseRange();
      const l = Number(left);
      const r = Number(right);
      if (op === '<' || op === 'lt') left = l < r;
      else if (op === '<=' || op === 'lte') left = l <= r;
      else if (op === '>' || op === 'gt') left = l > r;
      else left = l >= r;
    }
    return left;
  }

  function parseRange(): unknown {
    const left = parseAdditive();
    const t = peek();
    if (t && t.type === 'id' && t.val.toLowerCase() === 'to') {
      consume();
      const right = parseAdditive();
      const start = Math.floor(Number(left));
      const end = Math.floor(Number(right));
      if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
      const arr: number[] = [];
      const step = start <= end ? 1 : -1;
      const limit = Math.min(50, Math.abs(end - start) + 1);
      for (let k = 0; k < limit; k++) {
        arr.push(start + k * step);
      }
      return arr;
    }
    return left;
  }

  function parseAdditive(): unknown {
    let left = parseMultiplicative();
    while (matchOp('+', '-')) {
      const op = consume().val;
      const right = parseMultiplicative();
      if (op === '+') {
        if (typeof left === 'number' && typeof right === 'number') {
          left = left + right;
        } else {
          left = `${left ?? ''}${right ?? ''}`;
        }
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  }

  function parseMultiplicative(): unknown {
    let left = parseUnary();
    while (matchOp('*', '/', '%')) {
      const op = consume().val;
      const right = parseUnary();
      if (op === '*') left = Number(left) * Number(right);
      else if (op === '/') left = Number(right) === 0 ? 0 : Number(left) / Number(right);
      else left = Number(right) === 0 ? 0 : Number(left) % Number(right);
    }
    return left;
  }

  function parseUnary(): unknown {
    if (matchOp('!', 'not')) {
      consume();
      return !isTruthyBlogger(parseUnary());
    }
    if (matchOp('-')) {
      consume();
      return -Number(parseUnary());
    }
    return parsePostfix();
  }

  function parseLambdaOrArg(): unknown {
    // Detect `x => ...` inside array method calls like .filter(p => ...)
    const t0 = peek();
    const t1 = tokens[cursor + 1];
    if (t0?.type === 'id' && t1?.type === 'op' && t1.val === '=>') {
      const paramName = consume().val;
      consume(); // '=>'
      const startLambdaCursor = cursor;
      // Skip to matching ',' or ')' at depth 0 to grab lambda tokens boundary
      let depth = 0;
      while (cursor < tokens.length) {
        const tk = tokens[cursor];
        if (tk.type === 'punc' && (tk.val === '(' || tk.val === '[' || tk.val === '{')) depth++;
        else if (tk.type === 'punc' && (tk.val === ')' || tk.val === ']' || tk.val === '}')) {
          if (depth === 0) break;
          depth--;
        } else if (tk.type === 'punc' && tk.val === ',' && depth === 0) {
          break;
        }
        cursor++;
      }
      const endLambdaCursor = cursor;
      const lambdaSlice = tokens.slice(startLambdaCursor, endLambdaCursor);
      return (item: unknown) => {
        const childScope: BloggerScope = {
          data: scope.data,
          locals: { ...scope.locals, [paramName]: item },
        };
        const subExpr = lambdaSlice
          .map((tok) => (tok.type === 'str' ? JSON.stringify(tok.val) : String(tok.val)))
          .join(' ');
        return evalBloggerExpression(subExpr, childScope);
      };
    }
    return parseTernary();
  }

  function invokeMemberMethod(target: unknown, method: string, args: unknown[]): unknown {
    if (Array.isArray(target)) {
      const pred = typeof args[0] === 'function' ? (args[0] as (x: unknown) => unknown) : null;
      if (method === 'filter' && pred) return target.filter((item) => isTruthyBlogger(pred(item)));
      if (method === 'map' && pred) return target.map((item) => pred(item));
      if (method === 'any') return pred ? target.some((item) => isTruthyBlogger(pred(item))) : target.length > 0;
      if (method === 'all' && pred) return target.every((item) => isTruthyBlogger(pred(item)));
      if (method === 'count') return pred ? target.filter((item) => isTruthyBlogger(pred(item))).length : target.length;
      if (method === 'slice') return target.slice(Number(args[0] || 0), args[1] !== undefined ? Number(args[1]) : undefined);
      if (method === 'join') return target.join(String(args[0] ?? ', '));
      return undefined;
    }
    const str = String(target ?? '');
    if (method === 'contains') return str.includes(String(args[0] ?? ''));
    if (method === 'startsWith') return str.startsWith(String(args[0] ?? ''));
    if (method === 'endsWith') return str.endsWith(String(args[0] ?? ''));
    if (method === 'toLowerCase') return str.toLowerCase();
    if (method === 'toUpperCase') return str.toUpperCase();
    if (method === 'trim') return str.trim();
    return undefined;
  }

  function invokeGlobalFunction(name: string, args: unknown[]): unknown {
    if (name === 'resizeImage') {
      const imgUrl = String(args[0] ?? '').trim();
      return imgUrl || buildEditorialCoverSvgUri('Pratinjau Gambar', 'Media', 0);
    }
    if (name === 'sourceSet') {
      const imgUrl = String(args[0] ?? '').trim();
      return imgUrl || '';
    }
    if (name === 'snippet') {
      const raw = String(args[0] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const optsObj = args[1] && typeof args[1] === 'object' ? (args[1] as { length?: number }) : {};
      const maxLen = typeof optsObj.length === 'number' ? optsObj.length : 140;
      return raw.length > maxLen ? `${raw.slice(0, maxLen).trim()}...` : raw;
    }
    if (name === 'escapeHtml') return escapeHtmlText(String(args[0] ?? ''));
    if (name === 'escapeUrl') return encodeURIComponent(String(args[0] ?? ''));
    if (name === 'escapeJs') return JSON.stringify(String(args[0] ?? '')).slice(1, -1);
    if (name === 'escapeCss') return String(args[0] ?? '');
    if (name === 'has' && Array.isArray(args[0])) return args[0].includes(args[1]);
    return undefined;
  }

  function parsePostfix(): unknown {
    const firstTok = peek();
    let val = parsePrimary();
    let lastMemberName = firstTok?.type === 'id' ? firstTok.val : '';

    while (cursor < tokens.length) {
      if (matchPunc('.')) {
        consume();
        const propTok = peek();
        if (!propTok || propTok.type !== 'id') break;
        consume();
        const propName = propTok.val;
        if (matchPunc('(')) {
          consume();
          const args: unknown[] = [];
          while (cursor < tokens.length && !matchPunc(')')) {
            args.push(parseLambdaOrArg());
            if (matchPunc(',')) consume();
            else break;
          }
          if (matchPunc(')')) consume();
          val = invokeMemberMethod(val, propName, args);
          lastMemberName = propName;
        } else {
          val = getPropertyValue(val, propName);
          lastMemberName = propName;
        }
        continue;
      }

      if (matchPunc('[')) {
        consume();
        const idxVal = parseTernary();
        if (matchPunc(']')) consume();
        val = getPropertyValue(val, String(idxVal ?? ''));
        continue;
      }

      if (matchPunc('(')) {
        consume();
        const args: unknown[] = [];
        while (cursor < tokens.length && !matchPunc(')')) {
          args.push(parseLambdaOrArg());
          if (matchPunc(',')) consume();
          else break;
        }
        if (matchPunc(')')) consume();
        val = invokeGlobalFunction(lastMemberName, args);
        continue;
      }

      break;
    }

    return val;
  }

  function parsePrimary(): unknown {
    const t = peek();
    if (!t) return undefined;

    if (t.type === 'str') {
      consume();
      return t.val;
    }
    if (t.type === 'num') {
      consume();
      return t.val;
    }
    if (t.type === 'id') {
      consume();
      return resolveIdentifier(t.val, scope);
    }
    if (matchPunc('(')) {
      consume();
      const inner = parseTernary();
      if (matchPunc(')')) consume();
      return inner;
    }
    if (matchPunc('[')) {
      consume();
      const items: unknown[] = [];
      while (cursor < tokens.length && !matchPunc(']')) {
        items.push(parseTernary());
        if (matchPunc(',')) consume();
        else break;
      }
      if (matchPunc(']')) consume();
      return items;
    }
    if (matchPunc('{')) {
      consume();
      const obj: Record<string, unknown> = {};
      while (cursor < tokens.length && !matchPunc('}')) {
        const keyTok = peek();
        if (!keyTok) break;
        const key = keyTok.type === 'str' || keyTok.type === 'id' ? consume().val : '';
        if (matchOp(':')) consume();
        const v = parseTernary();
        if (key) obj[key] = v;
        if (matchPunc(',')) consume();
        else break;
      }
      if (matchPunc('}')) consume();
      return obj;
    }

    consume();
    return undefined;
  }

  try {
    return parseTernary();
  } catch {
    return undefined;
  }
}

function unwrapUrlValue(val: unknown): string {
  if (val && typeof val === 'object' && '__urlString' in (val as object)) {
    return String((val as { __urlString: unknown }).__urlString ?? '');
  }
  return val === undefined || val === null ? '' : String(val);
}

// ============================================================================
// Context Builder & AST Renderer
// ============================================================================

export interface WidgetFallbackFn {
  (
    widgetType: string,
    widgetId: string,
    widgetTitle: string,
    widgetInnerXml: string
  ): string;
}

export interface BloggerRenderContext {
  sampleData: SampleBlogData;
  pageType: PreviewPageType;
  activePostId: string;
  activeCategory: string | null;
  device: DevicePreset;
  previewQueryParams: Record<string, string>;
  variableMap: Record<string, string>;
  globalIncludables: Record<string, AstNode[]>;
  defaultMarkupsByType: Record<string, Record<string, AstNode[]>>;
  renderWidgetFallback: WidgetFallbackFn;
  includeDepth: number;
}

function makeBloggerPostObject(post: SamplePost, authorAvatar: string, isLast: boolean) {
  const labelObj = {
    name: post.category,
    url: `#label-${encodeURIComponent(post.category)}`,
    isLast: true,
  };
  return {
    id: post.id,
    title: post.title,
    url: `#post-${post.id}`,
    link: `#post-${post.id}`,
    canonicalUrl: `#post-${post.id}`,
    snippet: post.snippet,
    snippets: {
      short: post.snippet.slice(0, 110),
      long: post.snippet,
    },
    body: post.bodyHtml,
    author: {
      name: post.author,
      profileUrl: '#author',
      authorPhoto: { url: authorAvatar, width: 64, height: 64 },
    },
    date: post.date,
    dateHeader: post.date,
    timestamp: post.date,
    timestampISO8601: '2026-11-18T08:00:00Z',
    lastUpdated: post.date,
    featuredImage: post.imageUrl,
    firstImageUrl: post.imageUrl,
    thumbnailUrl: post.imageUrl,
    labels: [labelObj],
    numComments: post.commentsCount,
    numberOfComments: post.commentsCount,
    numberOfCommentsLabel: `${post.commentsCount} Komentar`,
    allowComments: true,
    allowNewComments: true,
    hasJumpLink: true,
    jumpText: 'Baca Selengkapnya',
    isFirstPost: false,
    isLastPost: isLast,
    comments: [
      {
        id: `c-${post.id}-1`,
        author: 'Rina Kusuma',
        body: 'Artikel yang sangat jelas dan membantu merapikan struktur XML template saya.',
        timestamp: '19 Nov 2026',
        authorAvatarSrc: buildAuthorAvatarSvgUri('Rina Kusuma'),
      },
      {
        id: `c-${post.id}-2`,
        author: 'Bagas Pratama',
        body: 'Tata letaknya langsung terlihat bersih di perangkat mobile maupun desktop.',
        timestamp: '20 Nov 2026',
        authorAvatarSrc: buildAuthorAvatarSvgUri('Bagas Pratama'),
      },
    ],
  };
}

export function createBaseBloggerData(
  ctx: BloggerRenderContext
): Record<string, unknown> {
  const { sampleData, pageType, activePostId, activeCategory, device, previewQueryParams, variableMap } = ctx;
  const searchQ =
    previewQueryParams.q ||
    previewQueryParams.query ||
    previewQueryParams.search ||
    '';

  const mappedPageType =
    pageType === 'item' || pageType === 'post'
      ? 'item'
      : pageType === 'page'
        ? 'static_page'
        : pageType === 'archive'
          ? 'archive'
          : 'index';

  const filteredPosts = activeCategory
    ? sampleData.posts.filter(
        (p) => p.category.toLowerCase() === activeCategory.toLowerCase()
      )
    : sampleData.posts;

  const listPosts =
    mappedPageType === 'item' || mappedPageType === 'static_page'
      ? [
          sampleData.posts.find((p) => p.id === activePostId) ||
            sampleData.posts[0],
        ].filter(Boolean)
      : filteredPosts.length > 0
        ? filteredPosts
        : sampleData.posts;

  const postObjects = listPosts.map((p, i) =>
    makeBloggerPostObject(p, sampleData.authorAvatar, i === listPosts.length - 1)
  );
  if (postObjects[0]) postObjects[0].isFirstPost = true;

  const activePostObj = postObjects[0] || makeBloggerPostObject(sampleData.posts[0], sampleData.authorAvatar, true);

  const linkObjects = sampleData.navLinks.map((lnk) => ({
    title: lnk.label,
    name: lnk.label,
    href: lnk.category ? `#label-${encodeURIComponent(lnk.category)}` : '#home',
    url: lnk.category ? `#label-${encodeURIComponent(lnk.category)}` : '#home',
    isCurrentPage:
      (!lnk.category && pageType === 'index' && !activeCategory) ||
      Boolean(activeCategory && lnk.category === activeCategory),
    isSelected:
      (!lnk.category && pageType === 'index' && !activeCategory) ||
      Boolean(activeCategory && lnk.category === activeCategory),
  }));

  const labelObjects = sampleData.labels.map((lbl, i) => ({
    name: lbl.name,
    url: `#label-${encodeURIComponent(lbl.name)}`,
    count: lbl.count,
    cssSize: 12 + (i % 4),
  }));

  const isMobile = device === 'mobile';
  const currentUrl =
    mappedPageType === 'item'
      ? `https://pratinjau-lokal.blogspot.com/2026/11/${activePostObj.id}.html`
      : 'https://pratinjau-lokal.blogspot.com/';

  return {
    blog: {
      title: sampleData.blogTitle,
      pageTitle:
        mappedPageType === 'item'
          ? `${activePostObj.title} - ${sampleData.blogTitle}`
          : sampleData.blogTitle,
      pageName:
        mappedPageType === 'item'
          ? activePostObj.title
          : activeCategory || sampleData.blogTitle,
      description: sampleData.blogDescription,
      metaDescription: sampleData.blogDescription,
      homepageUrl: '#home',
      url: currentUrl,
      canonicalUrl: currentUrl,
      canonicalHomepageUrl: '#home',
      pageType: mappedPageType,
      isMobile,
      isMobileRequest: isMobile,
      searchQuery: searchQ,
      searchLabel: activeCategory || '',
      locale: 'id',
      languageDirection: 'ltr',
      encoding: 'UTF-8',
      headerImageUrl: '',
      adultContent: false,
      blogspotCommentUrl: '#comment-form',
      feedLinks: [{ url: '#feed', name: 'Atom', mimeType: 'application/atom+xml' }],
    },
    view: {
      isHomepage: pageType === 'index' && !activeCategory && !searchQ,
      isMultipleItems: mappedPageType === 'index' || mappedPageType === 'archive',
      isSingleItem: mappedPageType === 'item' || mappedPageType === 'static_page',
      isPost: mappedPageType === 'item',
      isPage: mappedPageType === 'static_page',
      isArchive: mappedPageType === 'archive',
      isLabelSearch: Boolean(activeCategory),
      isSearch: Boolean(searchQ || activeCategory),
      isError: false,
      isPreview: true,
      isLayoutMode: false,
      title:
        mappedPageType === 'item'
          ? activePostObj.title
          : activeCategory || sampleData.blogTitle,
      description: sampleData.blogDescription,
      url: {
        __urlString: currentUrl,
        params: previewQueryParams,
      },
      search: {
        label: activeCategory || '',
        query: searchQ,
        resultsMessage: activeCategory
          ? `Menampilkan artikel berlabel ${activeCategory}`
          : searchQ
            ? `Hasil pencarian untuk "${searchQ}"`
            : '',
      },
      archive: {
        year: 2026,
        month: 11,
        rangeMessage: 'November 2026',
      },
      featuredImage: activePostObj.featuredImage,
    },
    skin: {
      vars: variableMap,
    },
    vars: variableMap,
    posts: postObjects,
    post: activePostObj,
    links: linkObjects,
    labels: labelObjects,
    numPosts: postObjects.length,
    olderPageUrl: '#older',
    newerPageUrl: '#newer',
    title: sampleData.blogTitle,
    description: sampleData.blogDescription,
    features: {
      all: true,
      lazyLoad: false,
      comments: true,
      postSummaries: true,
    },
    messages: {
      home: 'Beranda',
      readMore: 'Baca Selengkapnya',
      olderPosts: 'Postingan Lama',
      newerPosts: 'Postingan Baru',
      noTitle: 'Tanpa Judul',
      search: 'Cari',
      searchBlog: 'Cari di blog ini',
      postAComment: 'Tulis Komentar',
      comments: 'Komentar',
      by: 'Oleh',
      postedBy: 'Ditulis oleh',
      showAll: 'Tampilkan semua',
      archive: 'Arsip',
      labels: 'Label',
      popularPosts: 'Artikel Populer',
      subscribe: 'Langganan',
      poweredByBlogger: 'Diberdayakan oleh TemaLoka Preview',
    },
    allBylineItems: [
      { name: 'author', label: 'Oleh' },
      { name: 'timestamp', label: 'Tanggal' },
      { name: 'labels', label: 'Label' },
    ],
  };
}

function getAttrFromList(attrs: AstAttr[], name: string): string | undefined {
  const lower = name.toLowerCase();
  const found = attrs.find((a) => a.name.toLowerCase() === lower);
  return found?.value;
}

function getAttrCaseInsensitive(attrs: AstAttr[], name: string): AstAttr | undefined {
  const lower = name.toLowerCase();
  return attrs.find((a) => a.name.toLowerCase() === lower);
}

/**
 * Extracts <b:defaultmarkups> and top-level <b:includable> definitions from an XML AST.
 */
export function collectGlobalIncludables(astNodes: AstNode[]): {
  globalIncludables: Record<string, AstNode[]>;
  defaultMarkupsByType: Record<string, Record<string, AstNode[]>>;
} {
  const globalIncludables: Record<string, AstNode[]> = {};
  const defaultMarkupsByType: Record<string, Record<string, AstNode[]>> = {};

  const walk = (nodes: AstNode[], inWidget: boolean) => {
    for (const n of nodes) {
      if (n.kind !== 'element') continue;
      if (n.lowerTag === 'b:defaultmarkups') {
        for (const child of n.children) {
          if (child.kind === 'element' && child.lowerTag === 'b:defaultmarkup') {
            const typeAttr = getAttrFromList(child.attrs, 'type') || 'Common';
            if (!defaultMarkupsByType[typeAttr]) defaultMarkupsByType[typeAttr] = {};
            for (const inc of child.children) {
              if (inc.kind === 'element' && inc.lowerTag === 'b:includable') {
                const incId = getAttrFromList(inc.attrs, 'id');
                if (incId) defaultMarkupsByType[typeAttr][incId] = inc.children;
              }
            }
          }
        }
        continue;
      }
      if (n.lowerTag === 'b:includable' && !inWidget) {
        const incId = getAttrFromList(n.attrs, 'id');
        if (incId) globalIncludables[incId] = n.children;
        continue;
      }
      if (n.lowerTag === 'b:widget') {
        walk(n.children, true);
      } else {
        walk(n.children, inWidget);
      }
    }
  };

  walk(astNodes, false);
  return { globalIncludables, defaultMarkupsByType };
}

function serializeAttrMap(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    parts.push(`${k}="${escapeHtmlText(v)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function evaluateElementModifiers(
  node: Extract<AstNode, { kind: 'element' }>,
  scope: BloggerScope
): { attrs: Record<string, string>; remainingChildren: AstNode[] } {
  const attrMap: Record<string, string> = {};
  const extraClasses: string[] = [];

  for (const attr of node.attrs) {
    if (attr.name.toLowerCase().startsWith('expr:')) {
      const targetName = attr.name.slice(5);
      const evaluated = unwrapUrlValue(evalBloggerExpression(attr.value, scope));
      if (evaluated !== '') {
        attrMap[targetName] = evaluated;
      }
    } else if (!attr.name.toLowerCase().startsWith('b:')) {
      attrMap[attr.name] = attr.value;
    }
  }

  const remainingChildren: AstNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'element' && child.lowerTag === 'b:attr') {
      const condAttr = getAttrFromList(child.attrs, 'cond');
      if (condAttr !== undefined && !isTruthyBlogger(evalBloggerExpression(condAttr, scope))) {
        continue;
      }
      const attrName =
        getAttrFromList(child.attrs, 'name') ||
        unwrapUrlValue(evalBloggerExpression(getAttrFromList(child.attrs, 'expr:name') || '', scope));
      const exprVal = getAttrFromList(child.attrs, 'expr:value');
      const staticVal = getAttrFromList(child.attrs, 'value');
      const resolved =
        exprVal !== undefined
          ? unwrapUrlValue(evalBloggerExpression(exprVal, scope))
          : staticVal ?? '';
      if (attrName) {
        if (attrName.toLowerCase() === 'class') {
          if (resolved) extraClasses.push(resolved);
        } else {
          attrMap[attrName] = resolved;
        }
      }
      continue;
    }

    if (child.kind === 'element' && child.lowerTag === 'b:class') {
      const condAttr = getAttrFromList(child.attrs, 'cond');
      if (condAttr !== undefined && !isTruthyBlogger(evalBloggerExpression(condAttr, scope))) {
        continue;
      }
      const exprName = getAttrFromList(child.attrs, 'expr:name');
      const staticName = getAttrFromList(child.attrs, 'name');
      const cls =
        exprName !== undefined
          ? unwrapUrlValue(evalBloggerExpression(exprName, scope))
          : staticName ?? '';
      if (cls) extraClasses.push(cls);
      continue;
    }

    remainingChildren.push(child);
  }

  if (extraClasses.length > 0) {
    attrMap.class = [attrMap.class, ...extraClasses].filter(Boolean).join(' ').trim();
  }

  return { attrs: attrMap, remainingChildren };
}

function serializeAstRawHtml(nodes: AstNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === 'text') return n.text;
      if (n.kind === 'comment') return n.text;
      const attrsStr = n.attrs
        .map((a) => `${a.name}="${escapeHtmlText(a.value)}"`)
        .join(' ');
      const open = `<${n.tagName}${attrsStr ? ` ${attrsStr}` : ''}`;
      if (n.selfClosing) return `${open}/>`;
      return `${open}>${serializeAstRawHtml(n.children)}</${n.tagName}>`;
    })
    .join('');
}

const RAW_HTML_DATA_KEYS = new Set([
  'data:post.body',
  'data:content',
  'data:post.snippet',
  'data:widget.content',
]);

export function evaluateBloggerAst(
  nodes: AstNode[],
  scope: BloggerScope,
  ctx: BloggerRenderContext,
  widgetIncludables: Record<string, AstNode[]> = {},
  currentWidgetType = 'Common'
): { html: string; usedSuper: boolean } {
  const out: string[] = [];
  let usedSuper = false;

  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push(node.text);
      continue;
    }
    if (node.kind === 'comment') {
      continue;
    }

    const tag = node.lowerTag;

    // Skip template declaration blocks & scripts inside body
    if (
      tag === 'b:defaultmarkups' ||
      tag === 'b:defaultmarkup' ||
      tag === 'b:includable' ||
      tag === 'b:widget-setting' ||
      tag === 'script'
    ) {
      continue;
    }

    // <b:if cond='...'> ... <b:elseif cond='...'/> ... <b:else/> ... </b:if>
    if (tag === 'b:if') {
      const condAttr = getAttrFromList(node.attrs, 'cond') ?? '';
      const branches: Array<{ cond: string | null; nodes: AstNode[] }> = [
        { cond: condAttr, nodes: [] },
      ];
      for (const ch of node.children) {
        if (ch.kind === 'element' && ch.lowerTag === 'b:elseif') {
          branches.push({
            cond: getAttrFromList(ch.attrs, 'cond') ?? 'false',
            nodes: [],
          });
        } else if (ch.kind === 'element' && ch.lowerTag === 'b:else') {
          branches.push({ cond: null, nodes: [] });
        } else {
          branches[branches.length - 1].nodes.push(ch);
        }
      }

      for (const br of branches) {
        const match =
          br.cond === null || isTruthyBlogger(evalBloggerExpression(br.cond, scope));
        if (match) {
          const res = evaluateBloggerAst(
            br.nodes,
            scope,
            ctx,
            widgetIncludables,
            currentWidgetType
          );
          out.push(res.html);
          if (res.usedSuper) usedSuper = true;
          break;
        }
      }
      continue;
    }

    // <b:switch var='...'> <b:case value='...'/> ... <b:default/> ... </b:switch>
    if (tag === 'b:switch') {
      const varExpr = getAttrFromList(node.attrs, 'var') || getAttrFromList(node.attrs, 'expr') || '';
      const switchVal = evalBloggerExpression(varExpr, scope);
      const cases: Array<{ isDefault: boolean; matchExpr: string; nodes: AstNode[] }> = [];

      for (const ch of node.children) {
        if (ch.kind === 'element' && ch.lowerTag === 'b:case') {
          const valExpr = getAttrFromList(ch.attrs, 'value') ?? '';
          const caseNodes = ch.selfClosing ? [] : ch.children;
          cases.push({ isDefault: false, matchExpr: valExpr, nodes: [...caseNodes] });
        } else if (ch.kind === 'element' && ch.lowerTag === 'b:default') {
          const defNodes = ch.selfClosing ? [] : ch.children;
          cases.push({ isDefault: true, matchExpr: '', nodes: [...defNodes] });
        } else if (cases.length > 0) {
          cases[cases.length - 1].nodes.push(ch);
        }
      }

      let matchedNodes: AstNode[] | null = null;
      for (const c of cases) {
        if (c.isDefault) continue;
        const caseVal = evalBloggerExpression(c.matchExpr, scope);
        if (caseVal == switchVal) { // eslint-disable-line eqeqeq
          matchedNodes = c.nodes;
          break;
        }
      }
      if (!matchedNodes) {
        const def = cases.find((c) => c.isDefault);
        if (def) matchedNodes = def.nodes;
      }
      if (matchedNodes) {
        const res = evaluateBloggerAst(
          matchedNodes,
          scope,
          ctx,
          widgetIncludables,
          currentWidgetType
        );
        out.push(res.html);
        if (res.usedSuper) usedSuper = true;
      }
      continue;
    }

    // <b:loop values='...' var='...' index='...'>
    if (tag === 'b:loop') {
      const valuesExpr = getAttrFromList(node.attrs, 'values') || '';
      const varName = getAttrFromList(node.attrs, 'var') || 'item';
      const indexName = getAttrFromList(node.attrs, 'index');
      const evaluatedValues = evalBloggerExpression(valuesExpr, scope);
      const items = Array.isArray(evaluatedValues)
        ? evaluatedValues
        : evaluatedValues && typeof evaluatedValues === 'object'
          ? Object.values(evaluatedValues as Record<string, unknown>)
          : [];

      const maxItems = Math.min(items.length, 60);
      for (let i = 0; i < maxItems; i++) {
        const itemLocals: Record<string, unknown> = {
          ...scope.locals,
          [varName]: items[i],
          i,
        };
        if (indexName) itemLocals[indexName] = i;
        const childScope: BloggerScope = {
          data: scope.data,
          locals: itemLocals,
        };
        const res = evaluateBloggerAst(
          node.children,
          childScope,
          ctx,
          widgetIncludables,
          currentWidgetType
        );
        out.push(res.html);
        if (res.usedSuper) usedSuper = true;
      }
      continue;
    }

    // <b:with value='...' var='...'>
    if (tag === 'b:with') {
      const valExpr = getAttrFromList(node.attrs, 'value') || '';
      const varName = getAttrFromList(node.attrs, 'var') || 'item';
      const val = evalBloggerExpression(valExpr, scope);
      const childScope: BloggerScope = {
        data: scope.data,
        locals: { ...scope.locals, [varName]: val },
      };
      const res = evaluateBloggerAst(
        node.children,
        childScope,
        ctx,
        widgetIncludables,
        currentWidgetType
      );
      out.push(res.html);
      if (res.usedSuper) usedSuper = true;
      continue;
    }

    // <b:include name='...' data='...' cond='...'/>
    if (tag === 'b:include') {
      const condAttr = getAttrFromList(node.attrs, 'cond');
      if (condAttr !== undefined && !isTruthyBlogger(evalBloggerExpression(condAttr, scope))) {
        continue;
      }
      const rawName = getAttrFromList(node.attrs, 'name') || '';
      const exprName = getAttrFromList(node.attrs, 'expr:name');
      const incName = exprName
        ? unwrapUrlValue(evalBloggerExpression(exprName, scope))
        : rawName;

      if (!incName) continue;
      if (
        incName === 'quickedit' ||
        incName === 'all-head-content' ||
        incName === 'postMetadataJSON'
      ) {
        continue;
      }
      if (incName.startsWith('super.')) {
        usedSuper = true;
        continue;
      }
      if (ctx.includeDepth >= 18) continue;

      const targetNodes =
        widgetIncludables[incName] ||
        ctx.defaultMarkupsByType[currentWidgetType]?.[incName] ||
        ctx.defaultMarkupsByType.Common?.[incName] ||
        ctx.globalIncludables[incName];

      if (!targetNodes) {
        if (
          incName === 'main' ||
          (currentWidgetType.toLowerCase() === 'blog' && (incName === 'posts' || incName === 'postList'))
        ) {
          usedSuper = true;
        }
        continue;
      }

      const dataExpr = getAttrFromList(node.attrs, 'data');
      let nextLocals = { ...scope.locals };
      if (dataExpr) {
        const resolvedData = evalBloggerExpression(dataExpr, scope);
        if (resolvedData && typeof resolvedData === 'object' && !Array.isArray(resolvedData)) {
          nextLocals = { ...nextLocals, ...(resolvedData as Record<string, unknown>), this: resolvedData };
        } else {
          nextLocals.this = resolvedData;
        }
      }

      const nestedCtx: BloggerRenderContext = {
        ...ctx,
        includeDepth: ctx.includeDepth + 1,
      };
      const res = evaluateBloggerAst(
        targetNodes,
        { data: scope.data, locals: nextLocals },
        nestedCtx,
        widgetIncludables,
        currentWidgetType
      );
      out.push(res.html);
      if (res.usedSuper) usedSuper = true;
      continue;
    }

    // <b:tag name='...' cond='...'>
    if (tag === 'b:tag') {
      const condAttr = getAttrFromList(node.attrs, 'cond');
      const condPass =
        condAttr === undefined || isTruthyBlogger(evalBloggerExpression(condAttr, scope));
      const { attrs, remainingChildren } = evaluateElementModifiers(node, scope);
      const inner = evaluateBloggerAst(
        remainingChildren,
        scope,
        ctx,
        widgetIncludables,
        currentWidgetType
      );
      if (inner.usedSuper) usedSuper = true;
      const dynTag =
        attrs.name ||
        getAttrFromList(node.attrs, 'name') ||
        'div';
      delete attrs.name;
      if (!condPass) {
        out.push(inner.html);
      } else {
        out.push(`<${dynTag}${serializeAttrMap(attrs)}>${inner.html}</${dynTag}>`);
      }
      continue;
    }

    // <b:eval expr='...'/>
    if (tag === 'b:eval') {
      const exprAttr = getAttrFromList(node.attrs, 'expr') || '';
      const val = unwrapUrlValue(evalBloggerExpression(exprAttr, scope));
      out.push(escapeHtmlText(val));
      continue;
    }

    // <data:.../>
    if (tag.startsWith('data:')) {
      const val = unwrapUrlValue(evalBloggerExpression(node.tagName, scope));
      if (RAW_HTML_DATA_KEYS.has(tag)) {
        out.push(val);
      } else {
        out.push(escapeHtmlText(val));
      }
      continue;
    }

    // <b:section ...>
    if (tag === 'b:section') {
      const condAttr = getAttrFromList(node.attrs, 'cond');
      if (condAttr !== undefined && !isTruthyBlogger(evalBloggerExpression(condAttr, scope))) {
        continue;
      }
      const { attrs, remainingChildren } = evaluateElementModifiers(node, scope);
      const secId = attrs.id || 'section';
      const secClass = attrs.class ? `section ${attrs.class}` : 'section';
      attrs.id = secId;
      attrs.class = secClass;
      const inner = evaluateBloggerAst(
        remainingChildren,
        scope,
        ctx,
        widgetIncludables,
        currentWidgetType
      );
      if (inner.usedSuper) usedSuper = true;
      out.push(`<div${serializeAttrMap(attrs)}>${inner.html}</div>`);
      continue;
    }

    // <b:widget ...>
    if (tag === 'b:widget') {
      const condAttr = getAttrFromList(node.attrs, 'cond');
      if (condAttr !== undefined && !isTruthyBlogger(evalBloggerExpression(condAttr, scope))) {
        continue;
      }
      const visibleAttr = getAttrFromList(node.attrs, 'visible');
      if (visibleAttr && visibleAttr.toLowerCase() === 'false') {
        continue;
      }

      const wId = getAttrFromList(node.attrs, 'id') || 'Widget1';
      const wType = getAttrFromList(node.attrs, 'type') || 'HTML';
      const wTitle = getAttrFromList(node.attrs, 'title') || '';

      // Extract widget-settings and widget-local includables
      const widgetSettings: Record<string, string> = {};
      const localIncludables: Record<string, AstNode[]> = {};
      for (const ch of node.children) {
        if (ch.kind !== 'element') continue;
        if (ch.lowerTag === 'b:widget-setting') {
          const stName = getAttrFromList(ch.attrs, 'name');
          if (stName) widgetSettings[stName] = serializeAstRawHtml(ch.children).trim();
        } else if (ch.lowerTag === 'b:includable') {
          const incId = getAttrFromList(ch.attrs, 'id');
          if (incId) localIncludables[incId] = ch.children;
        }
      }

      const mainIncNodes = localIncludables.main;
      const rawWidgetInner = serializeAstRawHtml(node.children);

      if (mainIncNodes && mainIncNodes.length > 0) {
        const settingContent =
          widgetSettings.content ||
          widgetSettings.copyright ||
          widgetSettings.text ||
          widgetSettings.description ||
          widgetSettings.html ||
          '';

        const widgetScope: BloggerScope = {
          data: {
            ...scope.data,
            widget: {
              id: wId,
              instanceId: wId,
              type: wType,
              title: wTitle || wType,
              version: getAttrFromList(node.attrs, 'version') || '2',
            },
            title: wTitle || (wType.toLowerCase() === 'header' ? ctx.sampleData.blogTitle : ''),
            content:
              settingContent ||
              (wType.toLowerCase() === 'attribution'
                ? `&copy; 2026 ${escapeHtmlText(ctx.sampleData.blogTitle)}`
                : ''),
            description: ctx.sampleData.blogDescription,
          },
          locals: { ...scope.locals },
        };

        const evaluated = evaluateBloggerAst(
          mainIncNodes,
          widgetScope,
          ctx,
          localIncludables,
          wType
        );

        const strippedText = evaluated.html
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .trim();
        const hasRichMedia = /<(?:img|svg|form|input|article|ul|ol|table|ins)\b/i.test(evaluated.html);

        if (!evaluated.usedSuper && (strippedText.length > 0 || hasRichMedia)) {
          const extraWrapClass = `widget ${escapeHtmlText(wType)}`;
          out.push(
            `<div class="${extraWrapClass}" id="${escapeHtmlText(wId)}" data-version="2">${evaluated.html}</div>`
          );
          continue;
        }
      }

      // Clean realistic fallback when widget is self-closing, calls super.main, or rendered empty
      out.push(ctx.renderWidgetFallback(wType, wId, wTitle, rawWidgetInner));
      continue;
    }

    // Standard HTML Element
    const { attrs, remainingChildren } = evaluateElementModifiers(node, scope);

    // Promote lazy-load image attributes & fill empty <img> src with realistic fallback
    if (tag === 'img') {
      const lazySrc = attrs['data-src'] || attrs['data-original'] || attrs['data-lazy-src'];
      const curSrc = (attrs.src || '').trim();
      const isPlaceholderPixel =
        !curSrc ||
        curSrc.startsWith('data:image/gif;base64,R0lGOD') ||
        curSrc === '#' ||
        curSrc.includes('blank.gif');
      if (lazySrc && isPlaceholderPixel) {
        attrs.src = resolvePreviewAssetUrl(lazySrc);
      } else if (curSrc) {
        attrs.src = resolvePreviewAssetUrl(curSrc);
      } else {
        attrs.src = buildEditorialCoverSvgUri(
          attrs.alt || 'Pratinjau Gambar',
          ctx.sampleData.blogTitle,
          0
        );
      }
      if (!attrs.loading) attrs.loading = 'lazy';
    }

    // Ensure preview links trigger navigation actions cleanly
    if (tag === 'a' && attrs.href) {
      const href = attrs.href;
      if (href.startsWith('#post-') && !attrs['data-tl-action']) {
        attrs['data-tl-action'] = 'post';
        attrs['data-tl-post-id'] = href.slice(6);
      } else if (href.startsWith('#label-') && !attrs['data-tl-action']) {
        attrs['data-tl-action'] = 'category';
        try {
          attrs['data-tl-category'] = decodeURIComponent(href.slice(7));
        } catch {
          attrs['data-tl-category'] = href.slice(7);
        }
      } else if (href === '#home' && !attrs['data-tl-action']) {
        attrs['data-tl-action'] = 'home';
      }
    }

    const inner = node.selfClosing || VOID_OR_SELF_TAGS.has(tag)
      ? { html: '', usedSuper: false }
      : evaluateBloggerAst(
          remainingChildren,
          scope,
          ctx,
          widgetIncludables,
          currentWidgetType
        );
    if (inner.usedSuper) usedSuper = true;

    // Render clean offline preview card for Google AdSense <ins class="adsbygoogle"> slots
    if (
      tag === 'ins' &&
      /\badsbygoogle\b/i.test(attrs.class || '') &&
      !inner.html.trim()
    ) {
      attrs.class = `${attrs.class || 'adsbygoogle'} tl-adsense-preview-slot`.trim();
      const adClient = attrs['data-ad-client'] || 'ca-pub-0000000000000000';
      const adSlot = attrs['data-ad-slot'] || '';
      const adFormat = attrs['data-ad-format'] || '';
      const adLayout = attrs['data-ad-layout'] || '';
      const rawStyle = attrs.style || '';
      const formatLabel =
        adLayout === 'in-article'
          ? 'In-Article Fluid'
          : adFormat === 'autorelaxed'
            ? 'Multiplex Grid'
            : /728px/.test(rawStyle)
              ? 'Display 728x90'
              : /300px/.test(rawStyle)
                ? 'Sidebar 300x250'
                : 'Auto Responsive';

      const attrString = serializeAttrMap(attrs);
      const badgeHtml =
        `<div class="tl-adsense-inner">` +
        `<span class="tl-adsense-badge">Google AdSense</span>` +
        `<strong class="tl-adsense-title">${escapeHtmlText(formatLabel)}</strong>` +
        `<span class="tl-adsense-meta">${escapeHtmlText(adClient)}${adSlot ? ` &middot; Slot ${escapeHtmlText(adSlot)}` : ''}</span>` +
        `</div>`;
      out.push(`<ins${attrString}>${badgeHtml}</ins>`);
      continue;
    }

    const attrString = serializeAttrMap(attrs);
    if (node.selfClosing || VOID_OR_SELF_TAGS.has(tag)) {
      out.push(`<${node.tagName}${attrString}/>`);
      continue;
    }

    out.push(`<${node.tagName}${attrString}>${inner.html}</${node.tagName}>`);
  }

  return { html: out.join(''), usedSuper };
}

export function extractBodyAttrsFromAst(
  xml: string,
  scope: BloggerScope
): Record<string, string> {
  const bodyOpenMatch = /<body\b([^>]*)>/i.exec(xml);
  if (!bodyOpenMatch) return {};
  const attrs = parseAttributes(bodyOpenMatch[1] || '');
  const map: Record<string, string> = {};
  for (const a of attrs) {
    if (a.name.toLowerCase().startsWith('expr:')) {
      const target = a.name.slice(5);
      const val = unwrapUrlValue(evalBloggerExpression(a.value, scope));
      if (val) map[target] = val;
    } else if (!a.name.toLowerCase().startsWith('b:')) {
      map[a.name] = a.value;
    }
  }
  return map;
}

export function buildSkinVariableMap(
  variableValues: Record<string, string>,
  parsedVars: BloggerVariable[]
): Record<string, string> {
  const valueMap: Record<string, string> = {};
  for (const v of parsedVars) {
    valueMap[v.name] = variableValues[v.name] ?? v.value ?? v.defaultValue;
  }
  for (const [k, val] of Object.entries(variableValues)) {
    valueMap[k] = val;
  }
  return valueMap;
}

function findElementByTag(nodes: AstNode[], lowerTag: string): Extract<AstNode, { kind: 'element' }> | null {
  for (const n of nodes) {
    if (n.kind !== 'element') continue;
    if (n.lowerTag === lowerTag) return n;
    const found = findElementByTag(n.children, lowerTag);
    if (found) return found;
  }
  return null;
}

export function renderBloggerBodyFromXml(
  xml: string,
  baseCtx: Omit<BloggerRenderContext, 'globalIncludables' | 'defaultMarkupsByType' | 'includeDepth'>
): { hasBody: boolean; bodyAttrsString: string; bodyHtml: string } {
  const fullAst = parseBloggerAst(xml);
  const { globalIncludables, defaultMarkupsByType } = collectGlobalIncludables(fullAst);

  const ctx: BloggerRenderContext = {
    ...baseCtx,
    globalIncludables,
    defaultMarkupsByType,
    includeDepth: 0,
  };

  const baseData = createBaseBloggerData(ctx);
  const baseScope: BloggerScope = { data: baseData, locals: {} };

  const bodyNode = findElementByTag(fullAst, 'body');
  if (!bodyNode) {
    return { hasBody: false, bodyAttrsString: '', bodyHtml: '' };
  }

  const { attrs: bodyAttrs, remainingChildren } = evaluateElementModifiers(bodyNode, baseScope);
  const bodyAttrsString = serializeAttrMap(bodyAttrs);
  const rendered = evaluateBloggerAst(remainingChildren, baseScope, ctx);

  return {
    hasBody: true,
    bodyAttrsString,
    bodyHtml: rendered.html,
  };
}

