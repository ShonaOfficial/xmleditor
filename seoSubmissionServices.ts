export type NormalizedBlogUrlResult =
  | {
      ok: true;
      origin: string;
      baseUrl: string;
      hostname: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface DerivedBlogEndpoints {
  origin: string;
  targetUrl: string;
  sitemapXml: string;
  sitemapPagesXml: string;
  atomFeed: string;
  rssFeed: string;
  robotsTxt: string;
}

export interface ExternalSeoServiceLink {
  id: string;
  name: string;
  provider: string;
  category: 'search-console' | 'diagnostics' | 'archive-feed';
  description: string;
  url: string;
  endpointDisplay: string;
  recommendedPayloadLabel?: string;
  recommendedPayloadValue?: string;
}

export interface LiveSeoSubmitResultItem {
  id: string;
  serviceName: string;
  endpointUrl: string;
  method: 'GET' | 'POST';
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  summary: string;
}

export interface LiveSeoSubmitApiResponse {
  blogOrigin: string;
  targetUrl: string;
  sitemapUrl: string;
  atomFeedUrl: string;
  rssFeedUrl: string;
  liveVerify: {
    blogStatus: number | null;
    sitemapStatus: number | null;
    robotsStatus: number | null;
    sitemapUrlCount: number;
    hasGoogleVerificationMeta: boolean;
    liveTitle: string;
  };
  results: LiveSeoSubmitResultItem[];
}

export function normalizePublicBlogUrl(rawInput: string): NormalizedBlogUrlResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: 'Masukkan alamat URL blog terlebih dahulu.' };
  }

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    return {
      ok: false,
      error: 'Format URL tidak valid. Contoh: https://namablog.blogspot.com',
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Hanya protokol HTTP atau HTTPS yang didukung.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    !host.includes('.')
  ) {
    return {
      ok: false,
      error: 'Gunakan domain publik yang valid (mis. namablog.blogspot.com atau domain kustom).',
    };
  }

  return {
    ok: true,
    origin: parsed.origin,
    baseUrl: `${parsed.origin}/`,
    hostname: parsed.hostname,
  };
}

export function detectPublicBlogUrlFromXml(xml: string): string | null {
  const candidates: string[] = [];
  const patterns = [
    /<link\b[^>]*rel=["']canonical["'][^>]*href=["'](https?:\/\/[^"']+)["']/gi,
    /<meta\b[^>]*property=["']og:url["'][^>]*content=["'](https?:\/\/[^"']+)["']/gi,
    /https?:\/\/[a-z0-9-]+\.blogspot\.[a-z.]+/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const candidate = (m[1] || m[0] || '').trim();
      if (!candidate) continue;
      if (/example\.com|namablog|placeholder|youtube\.com|blogger\.com\/feeds|schema\.org/i.test(candidate)) {
        continue;
      }
      candidates.push(candidate);
    }
  }

  for (const raw of candidates) {
    const res = normalizePublicBlogUrl(raw);
    if (res.ok) return res.origin;
  }

  return null;
}

export function deriveBlogEndpoints(
  origin: string,
  articleUrlInput?: string
): DerivedBlogEndpoints {
  let targetUrl = `${origin}/`;
  const trimmedArt = (articleUrlInput || '').trim();
  if (trimmedArt) {
    const withProto = /^https?:\/\//i.test(trimmedArt)
      ? trimmedArt
      : `${origin}${trimmedArt.startsWith('/') ? '' : '/'}${trimmedArt}`;
    try {
      const u = new URL(withProto);
      if (['http:', 'https:'].includes(u.protocol)) {
        targetUrl = u.toString();
      }
    } catch {
      // ignore invalid article URL
    }
  }

  return {
    origin,
    targetUrl,
    sitemapXml: `${origin}/sitemap.xml`,
    sitemapPagesXml: `${origin}/sitemap-pages.xml`,
    atomFeed: `${origin}/feeds/posts/default`,
    rssFeed: `${origin}/feeds/posts/default?alt=rss`,
    robotsTxt: `${origin}/robots.txt`,
  };
}

export function buildExternalSeoServiceCatalog(
  origin: string,
  hostname: string,
  targetUrl: string,
  sitemapXml: string,
  atomFeed: string
): ExternalSeoServiceLink[] {
  const encodedOrigin = encodeURIComponent(origin);
  const encodedTarget = encodeURIComponent(targetUrl);
  const encodedSitemap = encodeURIComponent(sitemapXml);
  const encodedFeed = encodeURIComponent(atomFeed);

  return [
    {
      id: 'gsc-inspect',
      name: 'Google Search Console — Inspeksi & Indeks URL',
      provider: 'Google',
      category: 'search-console',
      description:
        'Buka properti Search Console untuk menguji URL artikel/beranda dan meminta pengindeksan Google secara resmi.',
      url: `https://search.google.com/search-console/inspect?resource_id=${encodedOrigin}`,
      endpointDisplay: 'search.google.com/search-console',
      recommendedPayloadLabel: 'URL Target',
      recommendedPayloadValue: targetUrl,
    },
    {
      id: 'gsc-sitemaps',
      name: 'Google Search Console — Kirim Sitemap XML',
      provider: 'Google',
      category: 'search-console',
      description:
        'Daftarkan sitemap.xml Blogger ke Google Search Console agar seluruh artikel terindeks berkala.',
      url: `https://search.google.com/search-console/sitemaps?resource_id=${encodedOrigin}`,
      endpointDisplay: 'search.google.com/search-console/sitemaps',
      recommendedPayloadLabel: 'URL Sitemap',
      recommendedPayloadValue: sitemapXml,
    },
    {
      id: 'bing-webmaster',
      name: 'Bing Webmaster Tools (Bing, DuckDuckGo, Yahoo)',
      provider: 'Microsoft Bing',
      category: 'search-console',
      description:
        'Kirim situs dan sitemap Blogspot untuk mempercepat pengindeksan di Bing, Yahoo, dan DuckDuckGo.',
      url: `https://www.bing.com/webmasters/home?siteUrl=${encodedOrigin}`,
      endpointDisplay: 'bing.com/webmasters',
      recommendedPayloadLabel: 'URL Sitemap',
      recommendedPayloadValue: sitemapXml,
    },
    {
      id: 'yandex-webmaster',
      name: 'Yandex Webmaster — Verifikasi & Sitemap',
      provider: 'Yandex',
      category: 'search-console',
      description:
        'Daftarkan domain blog ke Yandex Search Console lengkap dengan URL sitemap otomatis.',
      url: `https://webmaster.yandex.com/sites/add/?hostName=${encodeURIComponent(hostname)}`,
      endpointDisplay: 'webmaster.yandex.com/sites/add',
      recommendedPayloadLabel: 'URL Sitemap',
      recommendedPayloadValue: sitemapXml,
    },
    {
      id: 'rich-results-test',
      name: 'Google Rich Results Test (Schema JSON-LD)',
      provider: 'Google',
      category: 'diagnostics',
      description:
        'Uji validitas structured data BlogPosting, BreadcrumbList, dan Product pada halaman blog live.',
      url: `https://search.google.com/test/rich-results?url=${encodedTarget}`,
      endpointDisplay: 'search.google.com/test/rich-results',
      recommendedPayloadLabel: 'URL Uji',
      recommendedPayloadValue: targetUrl,
    },
    {
      id: 'pagespeed-insights',
      name: 'Google PageSpeed Insights & Core Web Vitals',
      provider: 'Google',
      category: 'diagnostics',
      description:
        'Analisis skor LCP, CLS, INP, dan optimasi CSS/JS blog secara langsung di server Google.',
      url: `https://pagespeed.web.dev/analysis?url=${encodedTarget}`,
      endpointDisplay: 'pagespeed.web.dev',
      recommendedPayloadLabel: 'URL Uji',
      recommendedPayloadValue: targetUrl,
    },
    {
      id: 'og-debugger',
      name: 'Meta / Facebook Sharing Debugger',
      provider: 'Meta',
      category: 'diagnostics',
      description:
        'Pratinjau kartu OpenGraph (og:title, og:description, og:image) saat tautan blog dibagikan ke media sosial.',
      url: `https://developers.facebook.com/tools/debug/?q=${encodedTarget}`,
      endpointDisplay: 'developers.facebook.com/tools/debug',
      recommendedPayloadLabel: 'URL Target',
      recommendedPayloadValue: targetUrl,
    },
    {
      id: 'wayback-archive',
      name: 'Internet Archive — Simpan & Cek Arsip URL',
      provider: 'Archive.org',
      category: 'archive-feed',
      description:
        'Simpan snapshot halaman blog publik ke Wayback Machine untuk cadangan historis.',
      url: `https://web.archive.org/save/${targetUrl}`,
      endpointDisplay: 'web.archive.org/save',
      recommendedPayloadLabel: 'URL Target',
      recommendedPayloadValue: targetUrl,
    },
    {
      id: 'pubsubhubbub',
      name: 'Google WebSub Hub Diagnostics (Atom Feed)',
      provider: 'WebSub',
      category: 'archive-feed',
      description:
        'Periksa status distribusi real-time Atom Feed Blogger melalui hub pubsubhubbub.appspot.com.',
      url: `https://pubsubhubbub.appspot.com/topic-details?hub.url=${encodedFeed}`,
      endpointDisplay: `pubsubhubbub.appspot.com (Feed)`,
      recommendedPayloadLabel: 'URL Feed Atom',
      recommendedPayloadValue: atomFeed,
    },
    {
      id: 'feed-validator',
      name: 'W3C Feed Validation Service',
      provider: 'W3C',
      category: 'archive-feed',
      description:
        'Validasi struktur Atom/RSS feed blog agar terbaca sempurna oleh agregator dan Google News.',
      url: `https://validator.w3.org/feed/check.cgi?url=${encodedFeed}`,
      endpointDisplay: `validator.w3.org/feed (${sitemapXml ? 'RSS/Atom' : ''})`,
      recommendedPayloadLabel: 'URL Feed Atom',
      recommendedPayloadValue: atomFeed,
    },
  ];
}
