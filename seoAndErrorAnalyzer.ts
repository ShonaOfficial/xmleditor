import type { ParsedTemplateInfo } from '../types/blogger';
import {
  autoFixBloggerXmlOffline,
  validateBloggerXmlOffline,
  type XmlValidationResult,
} from './xmlOfflineTools';

export interface LiveBlogFingerprint {
  sourceUrl: string;
  blogTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  blogId: string;
  isBloggerPowered: boolean;
  generator: string;
  skinThemeName?: string;
  footerText?: string;
  sectionIds: string[];
  widgets: Array<{ id: string; type: string }>;
  widgetPlacements?: Array<{ sectionId: string; widgetId: string; widgetType: string }>;
  cssVarNames: string[];
  themeSignatureTokens?: string[];
  fontFamilies?: string[];
  gaIds: string[];
  adsenseClients: string[];
  gscVerification: string;
}

export interface TemplateMatchComparison {
  verdict: 'same' | 'partial' | 'different';
  similarityPercent: number;
  cssMatchPercent: number;
  headline: string;
  summary: string;
  matchedWidgets: string[];
  onlyInLiveWidgets: string[];
  onlyInXmlWidgets: string[];
  matchedSections: string[];
  onlyInLiveSections: string[];
  onlyInXmlSections: string[];
  matchedCssVars: string[];
  matchedSignatureTokens: string[];
  matchedFonts: string[];
  mismatchReasons: string[];
  titleSimilarity: boolean;
}

const STANDARD_WIDGET_IDS = new Set(['header1', 'blog1', 'attribution1', 'navbar1']);
const STANDARD_SECTION_IDS = new Set(['header', 'main', 'sidebar', 'footer']);

export function compareBlogWithActiveTemplate(
  live: LiveBlogFingerprint,
  parsedInfo: ParsedTemplateInfo,
  xmlSource: string
): TemplateMatchComparison {
  const xmlWidgetIds = new Set(parsedInfo.widgets.map((w) => w.id.toLowerCase()));
  const xmlWidgetMap = new Map(parsedInfo.widgets.map((w) => [w.id.toLowerCase(), w.id]));
  const liveWidgetMap = new Map(live.widgets.map((w) => [w.id.toLowerCase(), w.id]));

  const matchedWidgets: string[] = [];
  const onlyInLiveWidgets: string[] = [];
  const onlyInXmlWidgets: string[] = [];

  for (const [lowerId, origId] of liveWidgetMap.entries()) {
    if (xmlWidgetIds.has(lowerId)) matchedWidgets.push(origId);
    else onlyInLiveWidgets.push(origId);
  }
  for (const [lowerId, origId] of xmlWidgetMap.entries()) {
    if (!liveWidgetMap.has(lowerId)) onlyInXmlWidgets.push(origId);
  }

  const xmlSectionMap = new Map(parsedInfo.sections.map((s) => [s.id.toLowerCase(), s.id]));
  const liveSectionMap = new Map(live.sectionIds.map((id) => [id.toLowerCase(), id]));
  const matchedSections: string[] = [];
  const onlyInLiveSections: string[] = [];
  const onlyInXmlSections: string[] = [];

  for (const [lowerId, origId] of liveSectionMap.entries()) {
    if (xmlSectionMap.has(lowerId)) matchedSections.push(origId);
    else onlyInLiveSections.push(origId);
  }
  for (const [lowerId, origId] of xmlSectionMap.entries()) {
    if (!liveSectionMap.has(lowerId)) onlyInXmlSections.push(origId);
  }

  // 1. Forensic CSS / DOM Signature Tokens (40%)
  const xmlSigTokens = new Set((parsedInfo.themeSignatureTokens || []).map((t) => t.toLowerCase()));
  const liveSigTokens = new Set((live.themeSignatureTokens || []).map((t) => t.toLowerCase()));
  const matchedSignatureTokens = Array.from(liveSigTokens).filter((t) => xmlSigTokens.has(t));
  const sigUnionSize = new Set([...xmlSigTokens, ...liveSigTokens]).size;
  const sigMinSize = Math.min(xmlSigTokens.size, liveSigTokens.size);
  // Dice-weighted score handles minified vs unminified CSS safely
  const sigScore =
    sigMinSize > 0
      ? (matchedSignatureTokens.length / sigMinSize) * 0.6 +
        (sigUnionSize > 0 ? (matchedSignatureTokens.length / sigUnionSize) * 0.4 : 0)
      : 0;
  const cssMatchPercent = sigUnionSize > 0
    ? Math.round((matchedSignatureTokens.length / Math.max(1, sigMinSize)) * 100)
    : 0;

  // 2. Structural Placement & Custom Widgets/Sections (25% — ignoring generic Header1/Blog1/main/sidebar)
  const xmlPlacements = new Set(
    parsedInfo.widgets.map((w) => `${w.sectionId.toLowerCase()}::${w.id.toLowerCase()}`)
  );
  const livePlacements = (live.widgetPlacements || []).map(
    (p) => `${p.sectionId.toLowerCase()}::${p.widgetId.toLowerCase()}`
  );
  const placementMatches = livePlacements.filter((p) => xmlPlacements.has(p)).length;

  const customLiveWidgets = Array.from(liveWidgetMap.keys()).filter((id) => !STANDARD_WIDGET_IDS.has(id));
  const customXmlWidgets = Array.from(xmlWidgetIds).filter((id) => !STANDARD_WIDGET_IDS.has(id));
  const customWidgetMatches = customLiveWidgets.filter((id) => xmlWidgetIds.has(id)).length;
  const customWidgetUnion = new Set([...customLiveWidgets, ...customXmlWidgets]).size;

  const customLiveSections = Array.from(liveSectionMap.keys()).filter((id) => !STANDARD_SECTION_IDS.has(id));
  const customXmlSections = Array.from(xmlSectionMap.keys()).filter((id) => !STANDARD_SECTION_IDS.has(id));
  const customSectionMatches = customLiveSections.filter((id) => xmlSectionMap.has(id)).length;
  const customSectionUnion = new Set([...customLiveSections, ...customXmlSections]).size;

  const placementScore =
    Math.max(xmlPlacements.size, livePlacements.length) > 0
      ? placementMatches / new Set([...xmlPlacements, ...livePlacements]).size
      : 0;
  const customWidgetScore =
    customWidgetUnion > 0
      ? customWidgetMatches / customWidgetUnion
      : matchedWidgets.length / Math.max(1, new Set([...liveWidgetMap.keys(), ...xmlWidgetIds]).size);
  const customSectionScore =
    customSectionUnion > 0
      ? customSectionMatches / customSectionUnion
      : matchedSections.length / Math.max(1, new Set([...liveSectionMap.keys(), ...xmlSectionMap.keys()]).size);

  const structureScore = customWidgetScore * 0.45 + customSectionScore * 0.35 + placementScore * 0.2;

  // 3. CSS Custom Properties (--var) (15%)
  const xmlCssVars = new Set(parsedInfo.cssCustomProperties.map((p) => p.name.toLowerCase()));
  const matchedCssVars = live.cssVarNames.filter((v) => xmlCssVars.has(v.toLowerCase()));
  const cssUnion = new Set([...live.cssVarNames.map((v) => v.toLowerCase()), ...xmlCssVars]).size;
  const cssVarScore = cssUnion > 0 ? matchedCssVars.length / cssUnion : 0;

  // 4. Font Families (10%)
  const xmlFonts = new Set((parsedInfo.fontFamiliesUsed || []).map((f) => f.toLowerCase()));
  const liveFonts = new Set((live.fontFamilies || []).map((f) => f.toLowerCase()));
  const matchedFonts = Array.from(liveFonts).filter((f) => xmlFonts.has(f));
  const fontUnion = new Set([...xmlFonts, ...liveFonts]).size;
  const fontScore = fontUnion > 0 ? matchedFonts.length / fontUnion : 0;

  // 5. Metadata, Theme Name, Analytics & AdSense IDs (10%)
  const liveTitleClean = live.blogTitle.toLowerCase().trim();
  const xmlTitleClean = parsedInfo.templateTitle.toLowerCase().trim();
  const titleSimilarity =
    Boolean(liveTitleClean && xmlTitleClean) &&
    (liveTitleClean.includes(xmlTitleClean) ||
      xmlTitleClean.includes(liveTitleClean) ||
      xmlSource.toLowerCase().includes(liveTitleClean));

  const liveSkinName = (live.skinThemeName || '').toLowerCase().trim();
  const skinNameMatches =
    Boolean(liveSkinName && xmlTitleClean) &&
    (liveSkinName.includes(xmlTitleClean) || xmlTitleClean.includes(liveSkinName));

  const hasExactAdsenseOrGaMatch =
    live.adsenseClients.some((id) => xmlSource.includes(id)) ||
    live.gaIds.some((id) => xmlSource.includes(id));

  const metaScore =
    (hasExactAdsenseOrGaMatch ? 0.5 : 0) +
    (skinNameMatches ? 0.3 : 0) +
    (titleSimilarity ? 0.2 : 0);

  // Combine only across available signals
  let weighted = 0;
  let weightSum = 0;
  if (sigUnionSize > 0) {
    weighted += Math.min(1, sigScore) * 0.4;
    weightSum += 0.4;
  }
  if (liveWidgetMap.size > 0 || xmlWidgetIds.size > 0) {
    weighted += structureScore * 0.25;
    weightSum += 0.25;
  }
  if (cssUnion > 0) {
    weighted += cssVarScore * 0.15;
    weightSum += 0.15;
  }
  if (fontUnion > 0) {
    weighted += fontScore * 0.1;
    weightSum += 0.1;
  }
  weighted += metaScore * 0.1;
  weightSum += 0.1;

  let similarityPercent = weightSum > 0 ? Math.round((weighted / weightSum) * 100) : 0;
  const mismatchReasons: string[] = [];

  if (matchedSignatureTokens.length === 0 && sigMinSize > 0) {
    mismatchReasons.push('Tidak ada selektor class/ID CSS khusus yang cocok di antara keduanya.');
  } else if (sigMinSize >= 6 && cssMatchPercent < 20) {
    mismatchReasons.push(`Kecocokan pola class/ID CSS khusus sangat rendah (${cssMatchPercent}%).`);
  }

  if (customWidgetUnion > 0 && customWidgetMatches === 0 && matchedWidgets.length > 0) {
    mismatchReasons.push(
      `Hanya ID standar Blogger (${matchedWidgets.join(', ')}) yang sama, sedangkan widget kustom tidak cocok.`
    );
  }
  if (onlyInLiveSections.length > 0 || onlyInXmlSections.length > 0) {
    mismatchReasons.push(
      `Tata letak section berbeda (${onlyInLiveSections.length} hanya di blog live, ${onlyInXmlSections.length} hanya di XML).`
    );
  }
  if (fontUnion > 0 && matchedFonts.length === 0) {
    mismatchReasons.push('Tipografi / Google Fonts antara blog live dan XML tidak sama.');
  }

  // Anti-False-Positive Guard: prevent two unrelated Blogger themes from scoring "partial" or "same"
  // just because both contain Header1, Blog1, main, or sidebar.
  const onlyGenericMatch =
    sigMinSize >= 5 &&
    cssMatchPercent < 18 &&
    customWidgetMatches === 0 &&
    customSectionMatches === 0 &&
    !hasExactAdsenseOrGaMatch;

  if (onlyGenericMatch) {
    similarityPercent = Math.min(similarityPercent, 28);
  }

  let verdict: 'same' | 'partial' | 'different' = 'different';
  let headline = 'Template BERBEDA dengan URL Blogspot';
  let summary =
    'Pola CSS, struktur section/widget khusus, dan tipografi blog live tidak cocok dengan template XML aktif.';

  if (similarityPercent >= 68 && !(sigMinSize >= 5 && cssMatchPercent < 22)) {
    verdict = 'same';
    headline = 'SAMA / COCOK dengan Template XML Aktif';
    summary =
      'Selektor CSS, susunan section/widget, variabel tema, dan font pada blog live selaras dengan template XML ini.';
  } else if (similarityPercent >= 34 && !onlyGenericMatch) {
    verdict = 'partial';
    headline = 'MIRIP SEBAGIAN (Ada Modifikasi Gadget / Versi)';
    summary =
      'Sebagian ciri tema dan struktur dasar cocok, namun ada perbedaan gadget, CSS, atau versi revisi antara blog live dan file XML ini.';
  }

  return {
    verdict,
    similarityPercent: Math.max(0, Math.min(100, similarityPercent)),
    cssMatchPercent,
    headline,
    summary,
    matchedWidgets,
    onlyInLiveWidgets,
    onlyInXmlWidgets,
    matchedSections,
    onlyInLiveSections,
    onlyInXmlSections,
    matchedCssVars,
    matchedSignatureTokens: matchedSignatureTokens.slice(0, 12),
    matchedFonts,
    mismatchReasons,
    titleSimilarity,
  };
}

export interface DetectionCheckItem {
  id: string;
  label: string;
  status: 'found' | 'warning' | 'missing';
  detail: string;
  detectedValues?: string[];
  line?: number;
}

export interface SeoMonetizationReport {
  metaSeo: DetectionCheckItem[];
  googleAnalytics: DetectionCheckItem[];
  googleSearch: DetectionCheckItem[];
  seoShopping: DetectionCheckItem[];
  googleAdsense: DetectionCheckItem[];
  counts: {
    found: number;
    warning: number;
    missing: number;
  };
  hasAdsenseXmlSyntaxRisk: boolean;
}

function buildSeoLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAtSeoStarts(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, lo);
}

export function analyzeSeoMonetizationOffline(
  xml: string,
  parsedInfo: ParsedTemplateInfo
): SeoMonetizationReport {
  const lineStarts = buildSeoLineStarts(xml);
  const findLineForPattern = (source: string, regex: RegExp): number | undefined => {
    const m = regex.exec(source);
    if (!m) return undefined;
    return lineAtSeoStarts(lineStarts, m.index);
  };

  // 1. Meta SEO & Social Tags
  const hasTitleTag = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(xml);
  const hasDynamicTitle = /<title\b[^>]*>[\s\S]*?(?:data:blog\.pageTitle|data:blog\.pageName|b:if)[\s\S]*?<\/title>/i.test(xml);
  const hasMetaDesc = /<meta\b[^>]*(?:name=["']description["']|expr:content=["'][^"']*metaDescription)/i.test(xml);
  const hasCanonical = /<link\b[^>]*rel=["']canonical["']/i.test(xml);
  const hasRobotsNoindex = /<meta\b[^>]*name=["']robots["'][^>]*noindex/i.test(xml);
  const hasOg = /property=["']og:(?:title|description|image|type)["']/i.test(xml);
  const hasTwitterCard = /name=["']twitter:(?:card|title|description|image)["']/i.test(xml);
  const hasFavicon = /<link\b[^>]*rel=["'](?:shortcut\s+)?icon["']/i.test(xml);

  const metaSeo: DetectionCheckItem[] = [
    {
      id: 'title-tag',
      label: 'Tag <title> SEO Dinamis Blogger',
      status: hasDynamicTitle ? 'found' : hasTitleTag ? 'warning' : 'missing',
      detail: hasDynamicTitle
        ? 'Menggunakan ekspresi dinamis Blogger (judul artikel otomatis muncul di tab & Google Search).'
        : hasTitleTag
          ? 'Tag <title> ada namun tampak statis (belum memakai <data:blog.pageTitle/>).'
          : 'Tag <title> belum ditemukan di <head>.',
      line: findLineForPattern(xml, /<title\b/i),
    },
    {
      id: 'meta-description',
      label: 'Meta Description (<meta name="description">)',
      status: hasMetaDesc ? 'found' : 'missing',
      detail: hasMetaDesc
        ? 'Meta description terdeteksi untuk cuplikan ringkasan hasil pencarian Google.'
        : 'Belum ada tag meta description (disarankan memakai data:blog.metaDescription).',
      line: findLineForPattern(xml, /name=["']description["']/i),
    },
    {
      id: 'viewport',
      label: 'Mobile Friendly Viewport',
      status: parsedInfo.hasViewportMeta ? 'found' : 'missing',
      detail: parsedInfo.hasViewportMeta
        ? 'Meta viewport responsif terpasang untuk skor Mobile Usability Google.'
        : 'Meta name="viewport" belum ditemukan. Tampilan ponsel dapat mengecil otomatis.',
      line: findLineForPattern(xml, /name=["']viewport["']/i),
    },
    {
      id: 'canonical',
      label: 'Link Canonical (Anti Konten Ganda)',
      status: hasCanonical ? 'found' : 'warning',
      detail: hasCanonical
        ? 'Rel canonical terpasang agar URL ?m=1 maupun parameter tidak dianggap duplikat.'
        : 'Link rel="canonical" belum terdeteksi eksplisit di <head>.',
      line: findLineForPattern(xml, /rel=["']canonical["']/i),
    },
    {
      id: 'og-twitter',
      label: 'OpenGraph & Twitter Share Cards',
      status: hasOg && hasTwitterCard ? 'found' : hasOg || hasTwitterCard ? 'warning' : 'missing',
      detail:
        hasOg && hasTwitterCard
          ? 'OpenGraph (og:*) dan Twitter Card lengkap untuk pratinjau WhatsApp/Facebook/X.'
          : hasOg
            ? 'OpenGraph ditemukan, namun Twitter Card belum lengkap.'
            : 'Belum ditemukan meta og:title / og:image untuk pratinjau berbagi tautan.',
      line: findLineForPattern(xml, /property=["']og:/i),
    },
    {
      id: 'robots-favicon',
      label: 'Robots Indexing & Favicon',
      status: hasRobotsNoindex ? 'warning' : hasFavicon ? 'found' : 'warning',
      detail: hasRobotsNoindex
        ? 'Terdeteksi meta robots mengandung "noindex". Pastikan hanya aktif di halaman pencarian/arsip, bukan artikel utama.'
        : hasFavicon
          ? 'Tidak ada blokir noindex global dan favicon terpasang.'
          : 'Favicon (<link rel="icon">) belum didefinisikan eksplisit.',
    },
  ];

  // 2. Google Analytics
  const ga4Matches = Array.from(new Set(xml.match(/\bG-[A-Z0-9]{6,12}\b/g) || []));
  const uaMatches = Array.from(new Set(xml.match(/\bUA-\d{4,10}-\d{1,4}\b/g) || []));
  const gtmMatches = Array.from(new Set(xml.match(/\bGTM-[A-Z0-9]{5,10}\b/g) || []));
  const hasBloggerAnalyticsVar = /data:blog\.analyticsAccountNumber/i.test(xml);
  const hasGtagScript = /googletagmanager\.com\/gtag\/js|google-analytics\.com\/analytics\.js/i.test(xml);
  const hasAnalyticsXmlAmpRisk = /googletagmanager\.com\/gtag\/js\?[^"'\s>]*&(?!amp;)/i.test(xml);

  const googleAnalytics: DetectionCheckItem[] = [
    {
      id: 'ga4',
      label: 'Google Analytics 4 (GA4 / gtag.js)',
      status: ga4Matches.length > 0 || hasBloggerAnalyticsVar ? 'found' : 'missing',
      detail:
        ga4Matches.length > 0
          ? `ID Pengukuran GA4 terdeteksi (${ga4Matches.join(', ')}).`
          : hasBloggerAnalyticsVar
            ? 'Memakai variabel bawaan Setelan Blogger (<data:blog.analyticsAccountNumber/>).'
            : 'Belum ada ID GA4 (G-XXXXXXXX) ataupun skrip gtag.js di dalam XML.',
      detectedValues: ga4Matches,
      line: findLineForPattern(xml, /\bG-[A-Z0-9]{6,12}\b|analyticsAccountNumber/i),
    },
    {
      id: 'gtm-ua',
      label: 'Google Tag Manager (GTM) & Universal Analytics',
      status: gtmMatches.length > 0 ? 'found' : uaMatches.length > 0 ? 'warning' : 'missing',
      detail:
        gtmMatches.length > 0
          ? `Kontainer Google Tag Manager aktif (${gtmMatches.join(', ')}).`
          : uaMatches.length > 0
            ? `Ditemukan kode Universal Analytics lama (${uaMatches.join(', ')}) yang sudah digantikan GA4.`
            : 'Tidak ada kontainer GTM terpasang.',
      detectedValues: [...gtmMatches, ...uaMatches],
    },
    {
      id: 'ga-xml-safety',
      label: 'Kompatibilitas XML Skrip Analytics',
      status: hasAnalyticsXmlAmpRisk ? 'warning' : hasGtagScript ? 'found' : 'found',
      detail: hasAnalyticsXmlAmpRisk
        ? 'Terdeteksi "&" mentah pada URL script gtag.js yang dapat ditolak oleh Studio Blogger (gunakan &amp;).'
        : 'Tidak ada masalah sintaks XML pada blok Google Analytics.',
    },
  ];

  // 3. Google Search & Structured Data
  const gscMetaMatch =
    /<meta\b[^>]*name=["']google-site-verification["'][^>]*content=["']([^"']+)["']/i.exec(xml) ||
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']google-site-verification["']/i.exec(xml);
  const hasAllHeadContent = /name=["']all-head-content["']/i.test(xml);
  const hasArticleSchema =
    /"@type"\s*:\s*["'](?:BlogPosting|NewsArticle|Article)["']|itemtype=["']https?:\/\/schema\.org\/(?:BlogPosting|NewsArticle|Article)["']/i.test(xml);
  const hasBreadcrumbSchema =
    /"@type"\s*:\s*["']BreadcrumbList["']|itemtype=["']https?:\/\/schema\.org\/BreadcrumbList["']/i.test(xml);
  const hasSearchActionSchema = /"@type"\s*:\s*["']WebSite["']|SearchAction/i.test(xml);

  const googleSearch: DetectionCheckItem[] = [
    {
      id: 'gsc-verify',
      label: 'Verifikasi Google Search Console',
      status: gscMetaMatch ? 'found' : 'missing',
      detail: gscMetaMatch
        ? `Meta verifikasi Google Search Console terpasang (${gscMetaMatch[1]}).`
        : 'Belum ditemukan meta tag google-site-verification di <head>.',
      detectedValues: gscMetaMatch ? [gscMetaMatch[1]] : undefined,
      line: findLineForPattern(xml, /google-site-verification/i),
    },
    {
      id: 'all-head-content',
      label: 'Include Wajib Blogger (all-head-content)',
      status: hasAllHeadContent ? 'found' : 'warning',
      detail: hasAllHeadContent
        ? 'Tag <b:include data="blog" name="all-head-content"/> aktif (otomatis menyuplai feed RSS & metadata Blogger).'
        : 'Tag all-head-content tidak ditemukan; sebagian meta otomatis Google/Blogger mungkin tidak tergenerate.',
      line: findLineForPattern(xml, /all-head-content/i),
    },
    {
      id: 'article-schema',
      label: 'Rich Results Google Search (Article / BlogPosting)',
      status: hasArticleSchema ? 'found' : 'missing',
      detail: hasArticleSchema
        ? 'Structured Data Article / BlogPosting terdeteksi untuk tampilan tanggal, penulis, dan gambar di Google Search.'
        : 'Belum ada JSON-LD atau Microdata Article / BlogPosting.',
      line: findLineForPattern(xml, /BlogPosting|NewsArticle|schema\.org\/Article/i),
    },
    {
      id: 'breadcrumb-searchaction',
      label: 'BreadcrumbList & Kotak Pencarian Sitelinks',
      status: hasBreadcrumbSchema || hasSearchActionSchema ? 'found' : 'missing',
      detail:
        hasBreadcrumbSchema && hasSearchActionSchema
          ? 'Schema BreadcrumbList dan WebSite SearchAction terdeteksi.'
          : hasBreadcrumbSchema
            ? 'BreadcrumbList aktif (WebSite SearchAction opsional belum ada).'
            : hasSearchActionSchema
              ? 'WebSite SearchAction aktif (BreadcrumbList belum ada).'
              : 'Belum terdeteksi schema BreadcrumbList maupun WebSite SearchAction.',
    },
  ];

  // 4. SEO Shopping / Produk E-Commerce
  const hasProductSchema =
    /"@type"\s*:\s*["']Product["']|itemtype=["']https?:\/\/schema\.org\/Product["']/i.test(xml);
  const hasOfferPrice =
    /"@type"\s*:\s*["'](?:Offer|AggregateOffer)["']|\bpriceCurrency\b|\bitemprop=["']price["']/i.test(xml);
  const hasRatingSchema =
    /"@type"\s*:\s*["']AggregateRating["']|\bratingValue\b/i.test(xml);
  const hasProductOg = /property=["']og:type["'][^>]*content=["']product["']|product:price:/i.test(xml);
  const hasShopCta = /wa\.me\/|api\.whatsapp\.com|add-to-cart|keranjang|checkout|tokopedia|shopee/i.test(xml);

  const seoShopping: DetectionCheckItem[] = [
    {
      id: 'product-schema',
      label: 'Schema.org Product (Google Shopping Rich Snippet)',
      status: hasProductSchema ? 'found' : 'missing',
      detail: hasProductSchema
        ? 'Skema Product terdeteksi untuk menampilkan info produk pada tab Google Shopping & Search.'
        : 'Belum ada skema JSON-LD / Microdata Product (gunakan tombol sisip di bawah jika blog ini berupa toko online).',
      line: findLineForPattern(xml, /schema\.org\/Product|"@type"\s*:\s*["']Product["']/i),
    },
    {
      id: 'offer-price',
      label: 'Data Harga, Mata Uang & Ketersediaan (Offer / Price)',
      status: hasOfferPrice ? 'found' : 'missing',
      detail: hasOfferPrice
        ? 'Atribut Offer / priceCurrency / availability terdeteksi.'
        : 'Belum ditemukan struktur harga (Offer / priceCurrency / price).',
    },
    {
      id: 'rating-og-product',
      label: 'Ulasan Bintang (AggregateRating) & Meta Produk',
      status: hasRatingSchema || hasProductOg ? 'found' : hasShopCta ? 'warning' : 'missing',
      detail:
        hasRatingSchema || hasProductOg
          ? 'Metadata ulasan bintang / OpenGraph produk aktif.'
          : hasShopCta
            ? 'Template memiliki tombol transaksi/WhatsApp/Marketplace namun belum dilengkapi AggregateRating untuk Google Shopping.'
            : 'Belum ada skema ulasan produk maupun meta product:price.',
    },
  ];

  // 5. Google AdSense
  const adsenseClients = Array.from(new Set(xml.match(/\bca-pub-\d{10,20}\b/gi) || []));
  const adSlots = Array.from(
    new Set(
      Array.from(xml.matchAll(/data-ad-slot\s*=\s*["'](\d+)["']/gi)).map((m) => m[1])
    )
  );
  const hasAutoAdsScript = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(xml);
  const adsenseWidgets = parsedInfo.widgets.filter((w) => w.type.toLowerCase() === 'adsense');
  const hasInsUnit = /<ins\b[^>]*class\s*=\s*["'][^"']*adsbygoogle/i.test(xml);

  const adsenseHasUnclosedAsync = /<script\b[^>]*adsbygoogle[^>]*\sasync(?=\s|>)(?![^>]*async\s*=)/i.test(xml);
  const adsenseHasRawAmp = /adsbygoogle\.js\?[^"'\s>]*&(?!amp;)/i.test(xml);
  const adsenseHasUnclosedIns = /<ins\b[^>]*adsbygoogle[^>]*>\s*(?!<\/ins>)/i.test(xml);
  const hasAdsenseXmlSyntaxRisk = adsenseHasUnclosedAsync || adsenseHasRawAmp || adsenseHasUnclosedIns;

  const googleAdsense: DetectionCheckItem[] = [
    {
      id: 'adsense-pub',
      label: 'Publisher ID & Auto Ads Google AdSense',
      status: adsenseClients.length > 0 || hasAutoAdsScript ? 'found' : 'missing',
      detail:
        adsenseClients.length > 0
          ? `Publisher ID terdeteksi: ${adsenseClients.join(', ')}${hasAutoAdsScript ? ' + skrip Auto Ads aktif' : ''}.`
          : hasAutoAdsScript
            ? 'Skrip adsbygoogle.js ditemukan namun Publisher ID ca-pub belum terbaca eksplisit.'
            : 'Belum ada skrip atau Publisher ID Google AdSense (ca-pub-...) di dalam template XML.',
      detectedValues: adsenseClients,
      line: findLineForPattern(xml, /ca-pub-|adsbygoogle/i),
    },
    {
      id: 'adsense-slots',
      label: 'Unit Iklan Manual (<ins class="adsbygoogle">) & Gadget AdSense',
      status: hasInsUnit || adsenseWidgets.length > 0 ? 'found' : 'missing',
      detail:
        hasInsUnit || adsenseWidgets.length > 0
          ? `Terdeteksi ${adSlots.length} slot unit iklan manual dan ${adsenseWidgets.length} widget <b:widget type='AdSense'>.`
          : 'Belum ada unit iklan <ins class="adsbygoogle"> atau gadget AdSense.',
      detectedValues: adSlots.map((s) => `Slot: ${s}`),
    },
    {
      id: 'adsense-xhtml',
      label: 'Validitas XML Blogger untuk Kode AdSense',
      status: hasAdsenseXmlSyntaxRisk ? 'warning' : 'found',
      detail: hasAdsenseXmlSyntaxRisk
        ? 'Peringatan: Skrip AdSense mengandung atribut "async" tanpa nilai (async="async") atau "&" mentah pada URL ?client=ca-pub yang membuat Studio Blogger gagal menyimpan template.'
        : 'Struktur kode AdSense aman untuk parser XML Studio Blogger.',
    },
  ];

  const allItems = [
    ...metaSeo,
    ...googleAnalytics,
    ...googleSearch,
    ...seoShopping,
    ...googleAdsense,
  ];
  const counts = {
    found: allItems.filter((i) => i.status === 'found').length,
    warning: allItems.filter((i) => i.status === 'warning').length,
    missing: allItems.filter((i) => i.status === 'missing').length,
  };

  return {
    metaSeo,
    googleAnalytics,
    googleSearch,
    seoShopping,
    googleAdsense,
    counts,
    hasAdsenseXmlSyntaxRisk,
  };
}

export function injectSeoMetaStarterIntoXml(xml: string): string {
  if (!/<\/head>/i.test(xml)) return xml;
  const snippets: string[] = [];
  if (!/rel=["']canonical["']/i.test(xml)) {
    snippets.push(`  <link expr:href='data:blog.canonicalUrl' rel='canonical'/>`);
  }
  if (!/name=["']description["']/i.test(xml)) {
    snippets.push(
      `  <b:if cond='data:blog.metaDescription'>\n    <meta expr:content='data:blog.metaDescription' name='description'/>\n  </b:if>`
    );
  }
  if (!/property=["']og:title["']/i.test(xml)) {
    snippets.push(
      `  <meta expr:content='data:blog.pageTitle' property='og:title'/>\n  <meta content='article' property='og:type'/>\n  <meta expr:content='data:blog.canonicalUrl' property='og:url'/>`
    );
  }
  if (!/BlogPosting|NewsArticle|schema\.org\/Article/i.test(xml)) {
    snippets.push(`  <b:if cond='data:view.isPost'>
    <script type='application/ld+json'>
    //<![CDATA[
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "<data:blog.pageName/>",
      "url": "<data:blog.canonicalUrl/>"
    }
    //]]>
    </script>
  </b:if>`);
  }
  if (snippets.length === 0) return xml;
  return xml.replace(/<\/head>/i, () => `\n${snippets.join('\n')}\n</head>`);
}

export function injectProductSchemaStarterIntoXml(xml: string): string {
  if (/"@type"\s*:\s*["']Product["']/i.test(xml) || !/<\/head>/i.test(xml)) return xml;
  const productLdJson = `
  <!-- Skema SEO Shopping / Google Merchant Product -->
  <b:if cond='data:view.isPost'>
    <script type='application/ld+json'>
    //<![CDATA[
    {
      "@context": "https://schema.org/",
      "@type": "Product",
      "name": "<data:blog.pageName/>",
      "description": "<data:blog.metaDescription/>",
      "offers": {
        "@type": "Offer",
        "priceCurrency": "IDR",
        "price": "150000",
        "availability": "https://schema.org/InStock",
        "url": "<data:blog.canonicalUrl/>"
      }
    }
    //]]>
    </script>
  </b:if>
`;
  return xml.replace(/<\/head>/i, () => `${productLdJson}</head>`);
}

export function fixAdsenseXhtmlComplianceInXml(xml: string): string {
  let out = xml;
  // 1. Fix valueless async and crossorigin attributes on <script> tags
  out = out.replace(/<script\b([^>]*)>/gi, (full, attrs: string) => {
    let next = attrs.replace(/(\s)async(?=\s|$)(?!\s*=)/gi, "$1async='async'");
    next = next.replace(/(\s)crossorigin(?=\s|$)(?!\s*=)/gi, "$1crossorigin='anonymous'");
    next = next.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
    return next === attrs ? full : `<script${next}>`;
  });
  // 2. Ensure <ins class="adsbygoogle".../> is never self-closing in XHTML Blogger output
  out = out.replace(/<ins\b([^>]*?)\s*\/>/gi, (full, attrs: string) => {
    if (!/adsbygoogle/i.test(attrs)) return full;
    return `<ins${attrs}></ins>`;
  });
  return out;
}

export type AdsenseUnitFormat =
  | 'responsive'
  | 'leaderboard'
  | 'sidebar'
  | 'in-article'
  | 'multiplex';

export type AdsensePlacementTarget =
  | { kind: 'head-auto-ads' }
  | { kind: 'section-html-ins'; sectionId: string }
  | { kind: 'section-native-adsense'; sectionId: string }
  | { kind: 'post-body-before' }
  | { kind: 'post-body-after' };

export interface NormalizedAdsensePubId {
  valid: boolean;
  caPub: string;
  pub: string;
  numeric: string;
}

export function normalizeAdsensePublisherId(input: string): NormalizedAdsensePubId {
  const cleaned = input.trim().toLowerCase();
  const digitsMatch = /(?:ca-pub-|pub-)?(\d{10,20})/.exec(cleaned);
  if (!digitsMatch) {
    return {
      valid: false,
      caPub: 'ca-pub-0000000000000000',
      pub: 'pub-0000000000000000',
      numeric: '',
    };
  }
  const numeric = digitsMatch[1];
  return {
    valid: true,
    caPub: `ca-pub-${numeric}`,
    pub: `pub-${numeric}`,
    numeric,
  };
}

export interface AdsenseTemplateOverview {
  clients: string[];
  slots: string[];
  hasMetaAccount: boolean;
  hasAutoAdsScript: boolean;
  adsenseWidgetCount: number;
  insUnitCount: number;
  hasPostBodyTag: boolean;
}

export function detectAdsenseOverviewInXml(
  xml: string,
  parsedInfo: ParsedTemplateInfo
): AdsenseTemplateOverview {
  const clients = Array.from(new Set(xml.match(/\bca-pub-\d{10,20}\b/gi) || []));
  const slots = Array.from(
    new Set(Array.from(xml.matchAll(/data-ad-slot\s*=\s*["'](\d+)["']/gi)).map((m) => m[1]))
  );
  const hasMetaAccount =
    /<meta\b[^>]*name\s*=\s*["']google-adsense-account["'][^>]*>/i.test(xml);
  const hasAutoAdsScript =
    /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(xml);
  const adsenseWidgetCount = parsedInfo.widgets.filter(
    (w) => w.type.toLowerCase() === 'adsense'
  ).length;
  const insUnitCount = (
    xml.match(/<ins\b[^>]*class\s*=\s*["'][^"']*adsbygoogle/gi) || []
  ).length;
  const hasPostBodyTag = /<data:post\.body\s*\/?>/i.test(xml);

  return {
    clients,
    slots,
    hasMetaAccount,
    hasAutoAdsScript,
    adsenseWidgetCount,
    insUnitCount,
    hasPostBodyTag,
  };
}

export function generateAdsTxtContent(publisherInput: string): string {
  const norm = normalizeAdsensePublisherId(publisherInput);
  return `google.com, ${norm.pub}, DIRECT, f08c47fec0942fa0`;
}

function buildAdsenseInsSnippet(opts: {
  caPub: string;
  slotId?: string;
  format: AdsenseUnitFormat;
  onlyOnPosts?: boolean;
  indent?: string;
}): string {
  const indent = opts.indent ?? '';
  const cleanSlot = (opts.slotId || '').replace(/\D+/g, '') || '1234567890';
  let attrs = '';
  let wrapStyle = 'margin:16px auto;text-align:center;clear:both;';

  if (opts.format === 'leaderboard') {
    attrs = `class='adsbygoogle' data-ad-client='${opts.caPub}' data-ad-slot='${cleanSlot}' style='display:inline-block;width:728px;height:90px;max-width:100%'`;
  } else if (opts.format === 'sidebar') {
    attrs = `class='adsbygoogle' data-ad-client='${opts.caPub}' data-ad-slot='${cleanSlot}' style='display:inline-block;width:300px;height:250px;max-width:100%'`;
  } else if (opts.format === 'in-article') {
    attrs = `class='adsbygoogle' data-ad-client='${opts.caPub}' data-ad-format='fluid' data-ad-layout='in-article' data-ad-slot='${cleanSlot}' style='display:block;text-align:center;'`;
    wrapStyle = 'margin:20px auto;text-align:center;clear:both;';
  } else if (opts.format === 'multiplex') {
    attrs = `class='adsbygoogle' data-ad-client='${opts.caPub}' data-ad-format='autorelaxed' data-ad-slot='${cleanSlot}' style='display:block'`;
  } else {
    attrs = `class='adsbygoogle' data-ad-client='${opts.caPub}' data-ad-format='auto' data-ad-slot='${cleanSlot}' data-full-width-responsive='true' style='display:block'`;
  }

  const coreLines = [
    `${indent}<div class='adsense-slot-box' style='${wrapStyle}'>`,
    `${indent}  <ins ${attrs}></ins>`,
    `${indent}  <script>`,
    `${indent}  //<![CDATA[`,
    `${indent}  (adsbygoogle = window.adsbygoogle || []).push({});`,
    `${indent}  //]]>`,
    `${indent}  </script>`,
    `${indent}</div>`,
  ];

  if (opts.onlyOnPosts) {
    return [
      `${indent}<b:if cond='data:view.isPost'>`,
      ...coreLines.map((l) => `  ${l}`),
      `${indent}</b:if>`,
    ].join('\n');
  }

  return coreLines.join('\n');
}

export interface AdsenseInjectionConfig {
  publisherId: string;
  slotId?: string;
  format: AdsenseUnitFormat;
  target: AdsensePlacementTarget;
  includeHeadMeta?: boolean;
  includeHeadAutoAds?: boolean;
  onlyOnPosts?: boolean;
  widgetTitle?: string;
}

export function buildAdsensePreviewSnippet(config: AdsenseInjectionConfig): string {
  const norm = normalizeAdsensePublisherId(config.publisherId);
  const caPub = norm.caPub;

  if (config.target.kind === 'head-auto-ads') {
    const lines: string[] = ['<!-- Google AdSense Verifikasi & Auto Ads -->'];
    if (config.includeHeadMeta !== false) {
      lines.push(`<meta content='${caPub}' name='google-adsense-account'/>`);
    }
    if (config.includeHeadAutoAds !== false) {
      lines.push(
        `<script async='async' crossorigin='anonymous' src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${caPub}'></script>`
      );
    }
    return lines.join('\n');
  }

  if (config.target.kind === 'section-native-adsense') {
    const title = (config.widgetTitle || 'Iklan AdSense').replace(/'/g, '&#39;');
    const cleanSlot = (config.slotId || '').replace(/\D+/g, '');
    return [
      `<b:widget id='AdSense1' locked='false' title='${title}' type='AdSense' visible='true'>`,
      `  <b:widget-setting name='adClient'>${caPub}</b:widget-setting>`,
      ...(cleanSlot ? [`  <b:widget-setting name='adSlot'>${cleanSlot}</b:widget-setting>`] : []),
      `  <b:widget-setting name='adFormat'>${config.format}</b:widget-setting>`,
      `  <b:includable id='main'>`,
      buildAdsenseInsSnippet({
        caPub,
        slotId: config.slotId,
        format: config.format,
        onlyOnPosts: config.onlyOnPosts,
        indent: '    ',
      }),
      `  </b:includable>`,
      `</b:widget>`,
    ].join('\n');
  }

  if (config.target.kind === 'section-html-ins') {
    const title = (config.widgetTitle || 'Unit Iklan AdSense').replace(/'/g, '&#39;');
    return [
      `<b:widget id='HTML_Ad1' locked='false' title='${title}' type='HTML' visible='true'>`,
      `  <b:includable id='main'>`,
      buildAdsenseInsSnippet({
        caPub,
        slotId: config.slotId,
        format: config.format,
        onlyOnPosts: config.onlyOnPosts,
        indent: '    ',
      }),
      `  </b:includable>`,
      `</b:widget>`,
    ].join('\n');
  }

  return buildAdsenseInsSnippet({
    caPub,
    slotId: config.slotId,
    format: config.format,
    onlyOnPosts: config.onlyOnPosts ?? true,
    indent: '',
  });
}

export function injectAdsenseIntoXml(
  xml: string,
  config: AdsenseInjectionConfig
): { nextXml: string; summary: string; changed: boolean } {
  const norm = normalizeAdsensePublisherId(config.publisherId);
  if (!norm.valid) {
    return {
      nextXml: xml,
      summary: 'Masukkan Publisher ID AdSense yang valid (format ca-pub-1234567890123456 atau 16 digit angka).',
      changed: false,
    };
  }

  const caPub = norm.caPub;
  let out = fixAdsenseXhtmlComplianceInXml(xml);
  const actions: string[] = [];

  const ensureHeadVerificationAndScript = (
    wantMeta: boolean,
    wantScript: boolean
  ) => {
    if (!/<\/head>/i.test(out)) return;
    const headAdditions: string[] = [];

    if (wantMeta) {
      const metaRe = /<meta\b[^>]*name\s*=\s*["']google-adsense-account["'][^>]*\/?>/i;
      if (metaRe.test(out)) {
        out = out.replace(
          metaRe,
          `<meta content='${caPub}' name='google-adsense-account'/>`
        );
        actions.push(`Memperbarui meta google-adsense-account (${caPub})`);
      } else {
        headAdditions.push(`  <meta content='${caPub}' name='google-adsense-account'/>`);
        actions.push(`Menambahkan meta google-adsense-account (${caPub})`);
      }
    }

    if (wantScript) {
      const autoScriptRe =
        /<script\b[^>]*src\s*=\s*["'][^"']*pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^"']*["'][^>]*>(?:\s*<\/script>)?/i;
      const cleanScriptTag = `<script async='async' crossorigin='anonymous' src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${caPub}'></script>`;
      if (autoScriptRe.test(out)) {
        out = out.replace(autoScriptRe, cleanScriptTag);
        actions.push('Memperbarui skrip Auto Ads adsbygoogle.js di <head> (XHTML valid)');
      } else {
        headAdditions.push(`  ${cleanScriptTag}`);
        actions.push('Menyisipkan skrip Auto Ads adsbygoogle.js ke <head>');
      }
    }

    if (headAdditions.length > 0) {
      out = out.replace(
        /<\/head>/i,
        () => `\n  <!-- Google AdSense Verification & Auto Ads -->\n${headAdditions.join('\n')}\n</head>`
      );
    }
  };

  if (config.target.kind === 'head-auto-ads') {
    ensureHeadVerificationAndScript(
      config.includeHeadMeta !== false,
      config.includeHeadAutoAds !== false
    );
  } else {
    // When placing an ad unit in body, ensure adsbygoogle.js loader exists in <head>
    const hasLoader = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(out);
    if (!hasLoader) {
      ensureHeadVerificationAndScript(config.includeHeadMeta ?? true, true);
    } else if (config.includeHeadMeta) {
      ensureHeadVerificationAndScript(true, false);
    }

    const existingWidgetIds = new Set(
      Array.from(out.matchAll(/<b:widget\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1])
    );
    const nextUniqueId = (prefix: string) => {
      let num = 1;
      while (existingWidgetIds.has(`${prefix}${num}`)) num++;
      const id = `${prefix}${num}`;
      existingWidgetIds.add(id);
      return id;
    };

    if (
      config.target.kind === 'section-html-ins' ||
      config.target.kind === 'section-native-adsense'
    ) {
      const targetSec = config.target.sectionId;
      const escapedSec = targetSec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const secRegex = new RegExp(
        `(<b:section\\b[^>]*\\bid\\s*=\\s*["']${escapedSec}["'][^>]*)(?:/>|>([\\s\\S]*?)(<\\/b:section>))`,
        'i'
      );

      if (!secRegex.test(out)) {
        return {
          nextXml: xml,
          summary: `Section #${targetSec} tidak ditemukan di dalam XML.`,
          changed: false,
        };
      }

      const isNative = config.target.kind === 'section-native-adsense';
      const wId = nextUniqueId(isNative ? 'AdSense' : 'HTML_Ad');
      const safeTitle = (
        config.widgetTitle?.trim() || (isNative ? 'Iklan AdSense' : 'Unit Iklan AdSense')
      )
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const innerIns = buildAdsenseInsSnippet({
        caPub,
        slotId: config.slotId,
        format: config.format,
        onlyOnPosts: config.onlyOnPosts,
        indent: '      ',
      });
      const cleanSlot = (config.slotId || '').replace(/\D+/g, '');

      const widgetBlock = isNative
        ? [
            `  <b:widget id='${wId}' locked='false' title='${safeTitle}' type='AdSense' visible='true'>`,
            `    <b:widget-setting name='adClient'>${caPub}</b:widget-setting>`,
            ...(cleanSlot ? [`    <b:widget-setting name='adSlot'>${cleanSlot}</b:widget-setting>`] : []),
            `    <b:widget-setting name='adFormat'>${config.format}</b:widget-setting>`,
            `    <b:includable id='main'>`,
            innerIns,
            `    </b:includable>`,
            `  </b:widget>`,
          ].join('\n') + '\n'
        : [
            `  <b:widget id='${wId}' locked='false' title='${safeTitle}' type='HTML' visible='true'>`,
            `    <b:includable id='main'>`,
            innerIns,
            `    </b:includable>`,
            `  </b:widget>`,
          ].join('\n') + '\n';

      out = out.replace(secRegex, (full, openPart: string, inner?: string, closeTag?: string) => {
        if (full.endsWith('/>')) {
          return `${openPart}>\n${widgetBlock}</b:section>`;
        }
        const prefix = inner && !inner.endsWith('\n') ? `${inner}\n` : inner ?? '\n';
        return `${openPart}>${prefix}${widgetBlock}${closeTag ?? '</b:section>'}`;
      });

      actions.push(
        `Memasang widget AdSense ${wId} (${config.format}) ke section #${targetSec}`
      );
    } else if (
      config.target.kind === 'post-body-before' ||
      config.target.kind === 'post-body-after'
    ) {
      const postBodyRe = /<data:post\.body\s*\/?>/i;
      if (!postBodyRe.test(out)) {
        return {
          nextXml: xml,
          summary: 'Tag <data:post.body/> tidak ditemukan di template XML ini; pilih penempatan ke <b:section>.',
          changed: false,
        };
      }
      const snippet = buildAdsenseInsSnippet({
        caPub,
        slotId: config.slotId,
        format: config.format,
        onlyOnPosts: config.onlyOnPosts ?? true,
        indent: '  ',
      });
      const isBefore = config.target.kind === 'post-body-before';
      out = out.replace(postBodyRe, (match) =>
        isBefore ? `${snippet}\n${match}` : `${match}\n${snippet}`
      );
      actions.push(
        `Menyisipkan unit iklan ${config.format} ${isBefore ? 'sebelum' : 'sesudah'} <data:post.body/>`
      );
    }
  }

  return {
    nextXml: out,
    summary:
      actions.length > 0
        ? actions.join(' • ')
        : 'Konfigurasi Google AdSense sudah terpasang dan diperbarui.',
    changed: out !== xml,
  };
}

export interface BloggerErrorDiagnosis {
  id: string;
  category: string;
  title: string;
  severity: 'error' | 'warning';
  explanation: string;
  extractedLine: number | null;
  extractedColumn: number | null;
  extractedToken: string | null;
  stepsToFix: string[];
  canAutoFix: boolean;
  codeContext: Array<{ lineNumber: number; text: string; isTarget: boolean }>;
  xmlValidation: XmlValidationResult;
}

function buildCodeContext(xml: string, targetLine: number | null) {
  if (!targetLine || targetLine < 1) return [];
  const start = Math.max(1, targetLine - 3);
  const end = targetLine + 3;
  const ctx: Array<{ lineNumber: number; text: string; isTarget: boolean }> = [];
  let currentLine = 1;
  let lineStart = 0;
  const len = xml.length;

  for (let i = 0; i <= len; i++) {
    if (i === len || xml.charCodeAt(i) === 10) {
      if (currentLine >= start && currentLine <= end) {
        let lineEnd = i;
        if (lineEnd > lineStart && xml.charCodeAt(lineEnd - 1) === 13) lineEnd--;
        ctx.push({
          lineNumber: currentLine,
          text: xml.slice(lineStart, lineEnd),
          isTarget: currentLine === targetLine,
        });
        if (currentLine >= end) break;
      }
      currentLine++;
      lineStart = i + 1;
    }
  }
  return ctx;
}

export function diagnoseBloggerStudioErrorOffline(
  errorText: string,
  xml: string,
  precomputedValidation?: XmlValidationResult
): BloggerErrorDiagnosis {
  const clean = errorText.trim();
  const xmlValidation = precomputedValidation ?? validateBloggerXmlOffline(xml);

  const lineMatch =
    /lineNumber\s*[:=]\s*(\d+)|line\s+(\d+)|baris\s+(\d+)/i.exec(clean);
  const colMatch = /columnNumber\s*[:=]\s*(\d+)|column\s+(\d+)|kolom\s+(\d+)/i.exec(clean);
  const extractedLine = lineMatch
    ? Number.parseInt(lineMatch[1] || lineMatch[2] || lineMatch[3], 10)
    : xmlValidation.issues[0]?.line ?? null;
  const extractedColumn = colMatch
    ? Number.parseInt(colMatch[1] || colMatch[2] || colMatch[3], 10)
    : null;

  const quotedTokens = Array.from(clean.matchAll(/["']([^"']{1,60})["']/g)).map((m) => m[1]);
  const extractedToken = quotedTokens[0] ?? null;

  const codeContext = buildCodeContext(xml, extractedLine);

  // Rule 1: Entity must end with ';' (unescaped '&')
  if (/reference to entity|must end with the ['"];['"] delimiter/i.test(clean)) {
    return {
      id: 'unescaped-entity',
      category: 'Entitas XML / Karakter "&"',
      title: `Karakter "&" mentah belum diubah menjadi "&amp;"${extractedToken ? ` (sekitar "${extractedToken}")` : ''}`,
      severity: 'error',
      explanation:
        'Studio Blogger memakai parser XML ketat. Tanda "&" pada URL (seperti Google Fonts, AdSense, parameter ?a=1&b=2, atau JavaScript di luar CDATA) terbaca sebagai entitas XML yang rusak.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Ganti "&" di dalam URL/atribut HTML menjadi "&amp;".',
        'Atau bungkus blok <script> / <style> dengan /*<![CDATA[*/ ... /*]]>*/.',
        'Klik tombol "Perbaiki Otomatis (Offline)" di bawah untuk memperbaiki semua "&" sekaligus.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 2: Boolean attribute missing '=' (e.g. AdSense async or crossorigin)
  if (/Attribute name\s*["']([^"']+)["']\s*associated with an element type|must be followed by the ['"]?\s*=\s*['"]? character/i.test(clean)) {
    const attrName = extractedToken || 'async';
    return {
      id: 'boolean-attr',
      category: 'Atribut Boolean XHTML',
      title: `Atribut "${attrName}" tidak memiliki tanda "=" dan nilai`,
      severity: 'error',
      explanation: `Di HTML5 Anda bisa menulis <script ${attrName}>, namun di XML Studio Blogger setiap atribut wajib memiliki nilai, misalnya ${attrName}='${attrName}' (sering terjadi saat menempel kode AdSense atau Google Analytics).`,
      extractedLine,
      extractedColumn,
      extractedToken: attrName,
      stepsToFix: [
        `Ubah atribut "${attrName}" menjadi ${attrName}='${attrName}' (atau crossorigin='anonymous' untuk crossorigin).`,
        'Klik tombol "Perbaiki Otomatis (Offline)" untuk memperbaiki semua atribut boolean sekaligus.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 3: Unclosed tag / matching end-tag
  if (/must be terminated by the matching end-tag/i.test(clean)) {
    const tag = extractedToken || 'tag';
    const isVoid = ['meta', 'link', 'img', 'br', 'hr', 'input'].includes(tag.toLowerCase());
    return {
      id: 'unclosed-tag',
      category: 'Tag Tidak Tertutup',
      title: `Tag <${tag}> belum ditutup dengan benar`,
      severity: 'error',
      explanation: isVoid
        ? `Tag tunggal HTML <${tag}> pada XML Blogger wajib ditutup sendiri dengan "/>" di bagian ujungnya, bukan ">" saja.`
        : `Ada tag pembuka <${tag}> yang lupa ditutup dengan </${tag}> atau tag penutupnya berada di urutan yang salah.`,
      extractedLine,
      extractedColumn,
      extractedToken: tag,
      stepsToFix: isVoid
        ? [
            `Ubah <${tag} ...> menjadi <${tag} .../> pada baris ${extractedLine ?? 'terkait'}.`,
            'Klik "Perbaiki Otomatis (Offline)" untuk menutup otomatis seluruh tag meta/link/img/br/hr.',
          ]
        : [
            `Periksa pasangan pembuka <${tag}> dan penutup </${tag}> di sekitar baris ${extractedLine ?? 'terkait'}.`,
            'Pastikan tidak ada tag anak di dalamnya yang belum ditutup.',
          ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 4: Content must consist of well-formed character data or markup
  if (/well-formed character data or markup/i.test(clean)) {
    return {
      id: 'bad-cdata-or-lt',
      category: 'Kode JavaScript/CSS di Luar CDATA',
      title: 'Terdapat simbol "<" atau "&" mentah di luar blok <![CDATA[...]]>',
      severity: 'error',
      explanation:
        'Parser Blogger menemukan karakter "<" (misalnya operator a < b dalam JavaScript atau kode CSS) yang tidak dibungkus <![CDATA[...]]>.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Bungkus kode JavaScript dengan //<![CDATA[ ... //]]> atau /*<![CDATA[*/ ... /*]]>*/.',
        'Atau klik "Perbaiki Otomatis (Offline)" untuk membungkus blok <script>/<style>/<b:skin> yang belum terlindungi.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 5: Duplicate widget / section ID
  if (/More than one widget was found with id|Duplicate widget|duplicate.*section/i.test(clean)) {
    return {
      id: 'duplicate-widget',
      category: 'Duplikat ID Widget / Section Blogger',
      title: `Terdapat lebih dari satu <b:widget> atau <b:section> dengan ID sama${extractedToken ? ` (${extractedToken})` : ''}`,
      severity: 'error',
      explanation:
        'Blogger melarang dua widget atau section memiliki atribut id="..." yang identik (misalnya sama-sama HTML1 atau Blog1) di dalam satu template.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Klik tombol "Perbaiki Otomatis (One-Click Fix)" untuk menomori ulang ID duplikat secara aman.',
        'Atau ubah ID widget ganda di tab Editor XML / Tree Explorer.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 5b: Quote collisions in b:if cond or expr:* attributes
  if (/Open quote is expected for attribute|Element type .* must be followed by either attribute specifications/i.test(clean)) {
    return {
      id: 'quote-collision',
      category: 'Benturan Kutip Atribut cond / expr:*',
      title: 'Tanda kutip di dalam atribut cond atau expr:* bertabrakan dengan kutip pembungkus',
      severity: 'error',
      explanation:
        'Sering terjadi pada <b:if cond=\'data:view.isLabel == \'News\'\'> atau expr:src="..." saat kutip di dalam ekspresi memakai jenis kutip yang sama dengan pembungkus atribut.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Ganti pembungkus luar dengan tanda kutip berbeda (misal cond="...") atau escape kutip dalam menjadi &quot; / &#39;.',
        'Klik "Perbaiki Otomatis (One-Click Fix)" untuk memperbaiki seluruh benturan kutip cond & expr:* secara otomatis.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 6: Double hyphen inside XML comments
  if (/string\s*["']--["']\s*is not permitted within comments/i.test(clean)) {
    return {
      id: 'comment-double-hyphen',
      category: 'Komentar XML Tidak Valid',
      title: 'Tanda "--" terlarang ditemukan di dalam komentar <!-- ... -->',
      severity: 'error',
      explanation:
        'Spesifikasi XML melarang karakter dua strip berturut-turut ("--") di dalam blok komentar <!-- ... --> (sering terjadi saat menonaktifkan kode dengan komentar).',
      extractedLine,
      extractedColumn,
      extractedToken: '--',
      stepsToFix: [
        'Hapus tanda "--" ekstra di dalam komentar <!-- ... --> atau ganti menjadi "- -".',
        'Klik "Perbaiki Otomatis (Offline)" untuk menormalkan "--" di dalam semua komentar XML.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 7: Duplicate attribute on same tag
  if (/Attribute\s*["'][^"']+["']\s*was already specified for element/i.test(clean)) {
    return {
      id: 'duplicate-attr',
      category: 'Atribut Ganda pada Tag',
      title: `Atribut ${extractedToken ? `"${extractedToken}"` : ''} tertulis dua kali dalam satu tag`,
      severity: 'error',
      explanation:
        'Satu tag HTML/Blogger tidak boleh memiliki nama atribut yang sama lebih dari satu kali (contoh: dua buah class="..." atau rel="..." dalam satu tag).',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        `Periksa baris ${extractedLine ?? 'terkait'} dan gabungkan atau hapus atribut ${extractedToken || 'ganda'} yang berulang.`,
      ],
      canAutoFix: false,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 8: Missing namespace b: / data: / expr:
  if (/prefix\s*["'](?:b|data|expr)["']\s*for element.*is not bound/i.test(clean)) {
    return {
      id: 'unbound-namespace',
      category: 'Namespace Blogger Hilang',
      title: 'Namespace xmlns:b / xmlns:data / xmlns:expr belum terdaftar di tag <html>',
      severity: 'error',
      explanation:
        'Tag khusus Blogger seperti <b:section> atau <data:post.title/> dipakai, tetapi deklarasi xmlns:b / xmlns:data / xmlns:expr tidak ada pada tag pembuka <html>.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Tambahkan xmlns:b, xmlns:data, dan xmlns:expr pada tag <html>.',
        'Klik "Perbaiki Otomatis (Offline)" untuk melengkapinya otomatis.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 9: Skin / Section / Widget structural Blogger errors
  if (/one and only one skin|b:skin|b:section|b:widget/i.test(clean)) {
    return {
      id: 'blogger-structure',
      category: 'Struktur Khusus Blogger',
      title: 'Aturan Struktur <b:skin> / <b:section> / <b:widget> Blogger',
      severity: 'error',
      explanation:
        'Blogger mensyaratkan minimal dan maksimal satu blok <b:skin>, serta setiap <b:widget> harus berada di dalam <b:section> dengan ID unik.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Pastikan hanya ada 1 pasang <b:skin><![CDATA[ ... ]]></b:skin> di <head>.',
        'Pastikan tidak ada <b:widget> yang berdiri sendiri di luar <b:section>.',
        'Gunakan menu Tata Letak untuk memeriksa struktur section & widget.',
      ],
      canAutoFix: false,
      codeContext,
      xmlValidation,
    };
  }

  // Rule 10: Premature end of file / root element
  if (/Premature end of file|start and end within the same entity/i.test(clean)) {
    return {
      id: 'premature-eof',
      category: 'Dokumen XML Terpotong',
      title: 'Kode XML terpotong atau tag penutup </body> / </html> hilang',
      severity: 'error',
      explanation:
        'Parser mencapai akhir file sebelum semua tag XML ditutup, atau blok <![CDATA[ / komentar <!-- belum ditutup.',
      extractedLine,
      extractedColumn,
      extractedToken,
      stepsToFix: [
        'Periksa bagian paling bawah template apakah ditutup dengan </body></html>.',
        'Klik "Perbaiki Otomatis (Offline)" untuk menutup tag atau blok CDATA yang masih terbuka.',
      ],
      canAutoFix: true,
      codeContext,
      xmlValidation,
    };
  }

  // Fallback general diagnosis combining offline validator findings
  return {
    id: 'general-xml-error',
    category: 'Pemeriksaan Sintaks Offline',
    title: clean
      ? 'Analisis Pesan Error Studio Blogger'
      : 'Tempel Notifikasi Error dari Studio Blogger',
    severity: xmlValidation.isValid ? 'warning' : 'error',
    explanation:
      xmlValidation.issues.length > 0
        ? `Ditemukan ${xmlValidation.issues.length} potensi masalah sintaks di kode XML aktif (masalah teratas: ${xmlValidation.issues[0].message}).`
        : 'Pesan error dikenali sebagai pemeriksaan umum. Tempel baris pesan lengkap (termasuk org.xml.sax.SAXParseException atau lineNumber) agar baris penyebab dapat ditandai tepat.',
    extractedLine,
    extractedColumn,
    extractedToken,
    stepsToFix:
      xmlValidation.issues.length > 0
        ? xmlValidation.issues.slice(0, 4).map((i) => `Baris ${i.line}: ${i.message}`)
        : [
            'Salin seluruh teks kotak merah error dari Edit HTML Studio Blogger lalu tempel di kolom kiri.',
            'Periksa juga tab Editor XML untuk menjalankan validator offline penuh.',
          ],
    canAutoFix: xmlValidation.issues.some((i) => i.autoFixable),
    codeContext,
    xmlValidation,
  };
}

export function applyErrorSpecificOfflineFix(xml: string): {
  fixedXml: string;
  fixesApplied: string[];
} {
  let out = xml;
  const extraFixes: string[] = [];

  // Fix '--' inside XML comments <!-- ... -->
  let commentHyphenFixes = 0;
  out = out.replace(/<!--([\s\S]*?)-->/g, (full, inner: string) => {
    if (!inner.includes('--')) return full;
    commentHyphenFixes++;
    return `<!--${inner.replace(/--+/g, '- -')}-->`;
  });
  if (commentHyphenFixes > 0) {
    extraFixes.push(`Menghilangkan "--" terlarang di ${commentHyphenFixes} komentar XML <!-- ... -->`);
  }

  // Fix valueless crossorigin on <script> / <link>
  let crossFixes = 0;
  out = out.replace(/<(script|link)\b([^>]*?)(\/?)>/gi, (full, tag: string, attrs: string, slash: string) => {
    if (!/\scrossorigin(?=\s|$)(?!\s*=)/i.test(attrs)) return full;
    crossFixes++;
    const nextAttrs = attrs.replace(/(\s)crossorigin(?=\s|$)(?!\s*=)/gi, "$1crossorigin='anonymous'");
    return `<${tag}${nextAttrs}${slash}>`;
  });
  if (crossFixes > 0) {
    extraFixes.push(`Memperbaiki ${crossFixes} atribut crossorigin ke format XHTML`);
  }

  const baseResult = autoFixBloggerXmlOffline(out);
  return {
    fixedXml: baseResult.fixedXml,
    fixesApplied: [...extraFixes, ...baseResult.fixesApplied],
  };
}
