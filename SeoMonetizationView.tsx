import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Layout,
  Loader2,
  PlusCircle,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  WifiOff,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import type { ParsedTemplateInfo } from '../types/blogger';
import {
  analyzeSeoMonetizationOffline,
  buildAdsensePreviewSnippet,
  detectAdsenseOverviewInXml,
  fixAdsenseXhtmlComplianceInXml,
  generateAdsTxtContent,
  injectAdsenseIntoXml,
  injectProductSchemaStarterIntoXml,
  injectSeoMetaStarterIntoXml,
  normalizeAdsensePublisherId,
  type AdsenseInjectionConfig,
  type AdsenseUnitFormat,
  type DetectionCheckItem,
} from '../lib/seoAndErrorAnalyzer';
import { summarizeSeoWithOfflineAi } from '../lib/offlineAiEngine';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';
import {
  buildExternalSeoServiceCatalog,
  deriveBlogEndpoints,
  detectPublicBlogUrlFromXml,
  normalizePublicBlogUrl,
  type ExternalSeoServiceLink,
  type LiveSeoSubmitApiResponse,
} from '../lib/seoSubmissionServices';
import { AdsenseSlotRenderer } from './AdsenseSlotRenderer';
import type { SiteAdsenseConfig } from '../types/adsense';

interface SeoMonetizationViewProps {
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  onUpdateXml: (nextXml: string, feedbackMessage: string) => void;
  isOfflineMode?: boolean;
  onSwitchToOnline?: () => void;
  initialBlogUrl?: string | null;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
  defaultAdsensePubId?: string;
  siteAdsense?: {
    config: SiteAdsenseConfig;
    shouldRenderLiveAds: boolean;
    isAdmin: boolean;
  };
}

const SEO_BLOG_URL_STORAGE_KEY = 'temaloka_seo_blog_url_v1';

type ServiceCategoryFilter = 'all' | ExternalSeoServiceLink['category'];

export const SeoMonetizationView: React.FC<SeoMonetizationViewProps> = ({
  xml,
  parsedInfo,
  offlineAi,
  onUpdateXml,
  isOfflineMode = false,
  onSwitchToOnline,
  initialBlogUrl,
  onNotify,
  defaultAdsensePubId = '',
  siteAdsense,
}) => {
  const report = useMemo(
    () => analyzeSeoMonetizationOffline(xml, parsedInfo),
    [xml, parsedInfo]
  );

  const aiSummary = useMemo(
    () => summarizeSeoWithOfflineAi(report, parsedInfo),
    [report, parsedInfo]
  );

  const xmlDetectedUrl = useMemo(() => detectPublicBlogUrlFromXml(xml), [xml]);

  const [blogUrlInput, setBlogUrlInput] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SEO_BLOG_URL_STORAGE_KEY);
      if (saved && normalizePublicBlogUrl(saved).ok) return saved;
    } catch {
      // ignore storage failure
    }
    if (initialBlogUrl && normalizePublicBlogUrl(initialBlogUrl).ok) {
      return initialBlogUrl;
    }
    return '';
  });
  const [articleUrlInput, setArticleUrlInput] = useState<string>('');
  const [indexNowKey, setIndexNowKey] = useState<string>('');
  const [serviceFilter, setServiceFilter] = useState<ServiceCategoryFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [liveSubmitResponse, setLiveSubmitResponse] =
    useState<LiveSeoSubmitApiResponse | null>(null);

  // Google AdSense Studio States
  const adsenseOverview = useMemo(
    () => detectAdsenseOverviewInXml(xml, parsedInfo),
    [xml, parsedInfo]
  );
  const [adsenseTab, setAdsenseTab] = useState<'head' | 'unit' | 'adstxt'>('head');
  const [adsensePubInput, setAdsensePubInput] = useState<string>(
    () => adsenseOverview.clients[0] || defaultAdsensePubId || ''
  );
  const [adsenseSlotInput, setAdsenseSlotInput] = useState<string>('');
  const [adsenseFormat, setAdsenseFormat] = useState<AdsenseUnitFormat>('responsive');
  const [adsenseTargetKind, setAdsenseTargetKind] = useState<
    'section-html-ins' | 'section-native-adsense' | 'post-body-before' | 'post-body-after'
  >('section-html-ins');
  const [adsenseSectionId, setAdsenseSectionId] = useState<string>(
    () =>
      parsedInfo.sections.find((s) => /sidebar|main|footer|header/i.test(s.id))?.id ||
      parsedInfo.sections[0]?.id ||
      ''
  );
  const [adsenseWidgetTitle, setAdsenseWidgetTitle] = useState<string>('Sponsor');
  const [includeHeadMeta, setIncludeHeadMeta] = useState<boolean>(true);
  const [includeHeadAutoAds, setIncludeHeadAutoAds] = useState<boolean>(true);
  const [onlyOnPosts, setOnlyOnPosts] = useState<boolean>(false);

  useEffect(() => {
    if (!adsensePubInput.trim()) {
      const candidate = adsenseOverview.clients[0] || defaultAdsensePubId;
      if (candidate) {
        setAdsensePubInput(candidate);
      }
    }
  }, [adsenseOverview.clients, defaultAdsensePubId, adsensePubInput]);

  useEffect(() => {
    if (
      parsedInfo.sections.length > 0 &&
      !parsedInfo.sections.some((s) => s.id === adsenseSectionId)
    ) {
      setAdsenseSectionId(
        parsedInfo.sections.find((s) => /sidebar|main|footer|header/i.test(s.id))?.id ||
          parsedInfo.sections[0].id
      );
    }
  }, [parsedInfo.sections, adsenseSectionId]);

  const normalizedPub = useMemo(
    () => normalizeAdsensePublisherId(adsensePubInput),
    [adsensePubInput]
  );

  const adsenseConfig = useMemo<AdsenseInjectionConfig>(() => {
    if (adsenseTab === 'head') {
      return {
        publisherId: adsensePubInput,
        slotId: adsenseSlotInput,
        format: adsenseFormat,
        target: { kind: 'head-auto-ads' },
        includeHeadMeta,
        includeHeadAutoAds,
      };
    }

    if (adsenseTargetKind === 'post-body-before' || adsenseTargetKind === 'post-body-after') {
      return {
        publisherId: adsensePubInput,
        slotId: adsenseSlotInput,
        format: adsenseFormat,
        target: { kind: adsenseTargetKind },
        onlyOnPosts,
      };
    }

    return {
      publisherId: adsensePubInput,
      slotId: adsenseSlotInput,
      format: adsenseFormat,
      target: {
        kind: adsenseTargetKind,
        sectionId: adsenseSectionId || parsedInfo.sections[0]?.id || 'sidebar',
      },
      onlyOnPosts,
      widgetTitle: adsenseWidgetTitle,
      includeHeadMeta: true,
    };
  }, [
    adsenseTab,
    adsensePubInput,
    adsenseSlotInput,
    adsenseFormat,
    adsenseTargetKind,
    adsenseSectionId,
    parsedInfo.sections,
    adsenseWidgetTitle,
    includeHeadMeta,
    includeHeadAutoAds,
    onlyOnPosts,
  ]);

  const adsenseSnippetPreview = useMemo(
    () => buildAdsensePreviewSnippet(adsenseConfig),
    [adsenseConfig]
  );
  const adsTxtPreview = useMemo(
    () => generateAdsTxtContent(adsensePubInput),
    [adsensePubInput]
  );

  useEffect(() => {
    try {
      if (blogUrlInput.trim()) {
        localStorage.setItem(SEO_BLOG_URL_STORAGE_KEY, blogUrlInput.trim());
      } else {
        localStorage.removeItem(SEO_BLOG_URL_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [blogUrlInput]);

  useEffect(() => {
    if (!blogUrlInput.trim() && initialBlogUrl && normalizePublicBlogUrl(initialBlogUrl).ok) {
      setBlogUrlInput(initialBlogUrl);
    }
  }, [initialBlogUrl, blogUrlInput]);

  const parsedBlog = useMemo(() => normalizePublicBlogUrl(blogUrlInput), [blogUrlInput]);

  const derivedEndpoints = useMemo(() => {
    if (!parsedBlog.ok) return null;
    return deriveBlogEndpoints(parsedBlog.origin, articleUrlInput);
  }, [parsedBlog, articleUrlInput]);

  const externalServices = useMemo(() => {
    if (!parsedBlog.ok || !derivedEndpoints) return [];
    return buildExternalSeoServiceCatalog(
      parsedBlog.origin,
      parsedBlog.hostname,
      derivedEndpoints.targetUrl,
      derivedEndpoints.sitemapXml,
      derivedEndpoints.atomFeed
    );
  }, [parsedBlog, derivedEndpoints]);

  const filteredServices = useMemo(() => {
    if (serviceFilter === 'all') return externalServices;
    return externalServices.filter((s) => s.category === serviceFilter);
  }, [externalServices, serviceFilter]);

  const handleCopy = (id: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  const handleLiveExternalSubmit = async () => {
    if (!parsedBlog.ok) {
      setSubmitError(parsedBlog.error);
      return;
    }
    if (isOfflineMode) {
      setSubmitError(
        'Mode Offline sedang aktif. Aktifkan Mode Online terlebih dahulu untuk mengirim permintaan langsung ke server eksternal.'
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await fetch('/api/seo/submit-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogUrl: parsedBlog.baseUrl,
          articleUrl: articleUrlInput.trim() || undefined,
          indexNowKey: indexNowKey.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      setLiveSubmitResponse(data as LiveSeoSubmitApiResponse);
      const okCount = (data.results || []).filter((r: { ok: boolean }) => r.ok).length;
      onNotify?.(
        `Pengiriman & verifikasi eksternal selesai: ${okCount}/${(data.results || []).length} layanan merespons sukses.`,
        okCount > 0 ? 'success' : 'info'
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal menghubungi server layanan eksternal.';
      setSubmitError(msg);
      onNotify?.(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStatusIcon = (status: DetectionCheckItem['status']) => {
    if (status === 'found') {
      return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />;
    }
    if (status === 'warning') {
      return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />;
    }
    return <XCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />;
  };

  const renderGroup = (
    title: string,
    subtitle: string,
    icon: React.ReactNode,
    items: DetectionCheckItem[],
    actionButton?: React.ReactNode
  ) => (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900">{title}</h3>
            <p className="text-[11px] text-slate-500">{subtitle}</p>
          </div>
        </div>
        {actionButton}
      </div>

      <div className="divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.id} className="px-4 sm:px-5 py-3 flex items-start gap-3">
            {renderStatusIcon(item.status)}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">{item.label}</span>
                {item.line && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    Baris {item.line}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{item.detail}</p>
              {item.detectedValues && item.detectedValues.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {item.detectedValues.map((val) => (
                    <code
                      key={val}
                      className="text-[11px] font-mono bg-slate-100 border border-slate-200 text-slate-800 px-2 py-0.5 rounded"
                    >
                      {val}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex-1 flex flex-col bg-[#F8FAFC] overflow-hidden">
      <OfflineAiRuntimeBar
        controller={offlineAi}
        page="seo"
        xml={xml}
        parsedInfo={parsedInfo}
        seoReport={report}
      />

      {/* Header Summary */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">
            SEO, Add URL ke Mesin Pencari, Analytics, Shopping &amp; AdSense
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Daftarkan URL publik blog ke Google Search Console &amp; layanan eksternal resmi, serta audit struktur XML secara lokal.
          </p>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-xs font-medium tabular-nums shrink-0">
          <span className="text-emerald-700">{report.counts.found} Terpasang</span>
          <span className="text-amber-700">{report.counts.warning} Perhatian</span>
          <span className="text-slate-500">{report.counts.missing} Belum Ada</span>
        </div>
      </div>

      {/* Scrollable Report Body */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Add URL to External Search Engines & Services */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
                  <Send className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                    Add URL Blog ke Semua Layanan Search &amp; Webmaster Resmi
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Terhubung langsung ke domain eksternal resmi (Google Search Console, Bing, Yandex, Naver, Seznam, WebSub, Ping-O-Matic, Archive.org) — bukan sumber lokal web.
                  </p>
                </div>
              </div>
              {xmlDetectedUrl && xmlDetectedUrl !== blogUrlInput && (
                <button
                  type="button"
                  onClick={() => setBlogUrlInput(xmlDetectedUrl)}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Pakai URL dari XML ({xmlDetectedUrl})
                </button>
              )}
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Blog URL Input Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-6 space-y-1">
                  <label
                    htmlFor="seo-public-blog-url"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    URL Blog Publik Anda (Wajib domain publik https://...)
                  </label>
                  <div className="relative">
                    <input
                      id="seo-public-blog-url"
                      type="url"
                      value={blogUrlInput}
                      onChange={(e) => {
                        setBlogUrlInput(e.target.value);
                        setSubmitError(null);
                      }}
                      placeholder="https://namablog.blogspot.com atau https://www.domainanda.com"
                      className="w-full px-3 py-2 pr-8 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10"
                    />
                    {blogUrlInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setBlogUrlInput('');
                          setLiveSubmitResponse(null);
                          setSubmitError(null);
                        }}
                        aria-label="Hapus URL blog"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="md:col-span-6 space-y-1">
                  <label
                    htmlFor="seo-article-url"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    URL Artikel Spesifik (Opsional — untuk uji Rich Results / IndexNow)
                  </label>
                  <div className="relative">
                    <input
                      id="seo-article-url"
                      type="url"
                      value={articleUrlInput}
                      onChange={(e) => setArticleUrlInput(e.target.value)}
                      placeholder="https://namablog.blogspot.com/2026/11/judul-artikel.html"
                      className="w-full px-3 py-2 pr-8 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                    {articleUrlInput && (
                      <button
                        type="button"
                        onClick={() => setArticleUrlInput('')}
                        aria-label="Hapus URL artikel"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Optional IndexNow Key + Live Submit Action */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pt-1">
                <div className="flex-1 space-y-1">
                  <label
                    htmlFor="seo-indexnow-key"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    Kunci API IndexNow (Opsional — untuk Custom Domain dengan file &lt;key&gt;.txt di root)
                  </label>
                  <input
                    id="seo-indexnow-key"
                    type="text"
                    value={indexNowKey}
                    onChange={(e) => setIndexNowKey(e.target.value)}
                    placeholder="Kosongkan jika memakai *.blogspot.com (otomatis pakai Google WebSub & Ping-O-Matic)"
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {isOfflineMode && onSwitchToOnline && (
                    <button
                      type="button"
                      onClick={onSwitchToOnline}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
                    >
                      <WifiOff className="w-3.5 h-3.5" />
                      <span>Aktifkan Mode Online</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleLiveExternalSubmit}
                    disabled={!parsedBlog.ok || isSubmitting || isOfflineMode}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isSubmitting
                        ? 'Mengirim ke Server Eksternal...'
                        : 'Kirim Ping & Verifikasi Live ke Server Eksternal'}
                    </span>
                  </button>
                </div>
              </div>

              {blogUrlInput.trim() && !parsedBlog.ok && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {parsedBlog.error}
                </div>
              )}

              {submitError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {submitError}
                </div>
              )}

              {/* Live Server External Submission Results */}
              {liveSubmitResponse && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      Respon Nyata dari Server Eksternal ({liveSubmitResponse.blogOrigin})
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Target: {liveSubmitResponse.targetUrl}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {liveSubmitResponse.results.map((resItem) => (
                      <div
                        key={resItem.id}
                        className="p-2.5 rounded-lg bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {resItem.ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-slate-900">
                              {resItem.serviceName}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {resItem.method} &middot; HTTP {resItem.statusCode ?? 'ERR'} &middot;{' '}
                              {resItem.latencyMs}ms
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-blue-700 truncate">
                            {resItem.endpointUrl}
                          </div>
                          <p className="text-xs text-slate-600">{resItem.summary}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Derived Real External Blog Endpoints + Direct Service Catalog */}
              {parsedBlog.ok && derivedEndpoints && (
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  {/* Derived URLs for Copy/Paste into Consoles */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Tautan Sitemap &amp; Feed Publik Blog Anda (Siap Salin ke Webmaster Console)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {(
                        [
                          ['sitemap', 'Sitemap Utama XML', derivedEndpoints.sitemapXml],
                          ['atom', 'Feed Atom (Blogger)', derivedEndpoints.atomFeed],
                          ['rss', 'Feed RSS', derivedEndpoints.rssFeed],
                          ['robots', 'Robots.txt', derivedEndpoints.robotsTxt],
                          ['pages', 'Sitemap Halaman', derivedEndpoints.sitemapPagesXml],
                        ] as const
                      ).map(([key, label, urlVal]) => (
                        <div
                          key={key}
                          className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase">
                              {label}
                            </div>
                            <div className="text-[11px] font-mono text-slate-800 truncate">
                              {urlVal}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy(`ep-${key}`, urlVal)}
                            title={`Salin ${label}`}
                            className="p-1.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900 shrink-0 cursor-pointer"
                          >
                            {copiedId === `ep-${key}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* External Services Filter */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900">
                      Direktori Add URL &amp; Uji Layanan Eksternal ({filteredServices.length} Layanan)
                    </div>
                    <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
                      {(
                        [
                          ['all', 'Semua Layanan'],
                          ['search-console', 'Google Search & Mesin Pencari'],
                          ['diagnostics', 'Uji Schema, Speed & Sosial'],
                          ['archive-feed', 'Arsip & Feed Publik'],
                        ] as const
                      ).map(([catKey, catLabel]) => (
                        <button
                          key={catKey}
                          type="button"
                          onClick={() => setServiceFilter(catKey)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                            serviceFilter === catKey
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {catLabel}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* External Service Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredServices.map((svc) => (
                      <div
                        key={svc.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-colors flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-xs font-semibold text-slate-900 leading-snug">
                              {svc.name}
                            </h4>
                            <span className="text-[10px] font-mono text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded shrink-0">
                              {svc.provider}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-relaxed">
                            {svc.description}
                          </p>
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            Sumber Eksternal: {svc.endpointDisplay}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          {svc.recommendedPayloadValue ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  `payload-${svc.id}`,
                                  svc.recommendedPayloadValue || ''
                                )
                              }
                              className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              {copiedId === `payload-${svc.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>
                                {copiedId === `payload-${svc.id}`
                                  ? 'Tersalin'
                                  : `Salin ${svc.recommendedPayloadLabel || 'URL'}`}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleCopy(`link-${svc.id}`, svc.url)}
                              className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              {copiedId === `link-${svc.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>{copiedId === `link-${svc.id}` ? 'Tersalin' : 'Salin Tautan'}</span>
                            </button>
                          )}

                          <a
                            href={svc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1 whitespace-nowrap"
                          >
                            <span>Buka Layanan</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!blogUrlInput.trim() && (
                <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-600">
                  Masukkan URL blog publik Anda di kolom di atas (mis.{' '}
                  <span className="font-mono text-slate-900">https://namablog.blogspot.com</span>) untuk menghasilkan seluruh tautan pendaftaran{' '}
                  <strong>Google Search Console</strong>, <strong>Bing/DuckDuckGo/Yahoo</strong>,{' '}
                  <strong>Yandex</strong>, <strong>Naver</strong>, <strong>Sitemap XML</strong>, dan mengirim ping langsung ke server eksternal resmi.
                </div>
              )}
            </div>
          </section>

          {/* AI Offline Priority Synthesis */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                Ringkasan Prioritas AI Offline
              </h3>
              <span
                className={`text-xs font-semibold ${
                  aiSummary.verdict === 'siap'
                    ? 'text-emerald-700'
                    : aiSummary.verdict === 'perlu-optimasi'
                      ? 'text-amber-700'
                      : 'text-red-700'
                }`}
              >
                {aiSummary.verdict === 'siap'
                  ? 'Siap Publikasi'
                  : aiSummary.verdict === 'perlu-optimasi'
                    ? 'Perlu Optimasi'
                    : 'Perhatian Penting'}
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">{aiSummary.headline}</p>
            {aiSummary.priorityActions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {aiSummary.priorityActions.map((act, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1"
                  >
                    <div className="text-[11px] font-mono font-semibold text-blue-700 uppercase">
                      {act.area}
                    </div>
                    <div className="text-xs font-semibold text-slate-900">{act.title}</div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{act.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {renderGroup(
            'Meta SEO & Kartu Sosial',
            'Judul dinamis Blogger, Meta Description, Mobile Viewport, Canonical, & OpenGraph',
            <Globe className="w-4 h-4 text-blue-600" />,
            report.metaSeo,
            <button
              type="button"
              onClick={() => {
                const nextXml = injectSeoMetaStarterIntoXml(xml);
                if (nextXml === xml) {
                  onUpdateXml(xml, 'Tag Meta SEO dasar & BlogPosting sudah lengkap di <head>.');
                } else {
                  onUpdateXml(
                    nextXml,
                    'Tag Meta SEO dasar (Canonical, Description, OpenGraph, BlogPosting) disisipkan ke <head>.'
                  );
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Lengkapi Meta SEO Dasar</span>
            </button>
          )}

          {renderGroup(
            'Google Analytics & Tag Manager',
            'Deteksi GA4 (G-...), Universal Analytics (UA-...), GTM, dan variabel pelacakan Blogger',
            <BarChart3 className="w-4 h-4 text-indigo-600" />,
            report.googleAnalytics
          )}

          {renderGroup(
            'Google Search & Structured Data',
            'Verifikasi Google Search Console, all-head-content, Article/BlogPosting, & BreadcrumbList',
            <Search className="w-4 h-4 text-emerald-600" />,
            report.googleSearch
          )}

          {renderGroup(
            'SEO Shopping & Google Merchant (Produk)',
            'Deteksi skema JSON-LD / Microdata Product, Offer, harga IDR/USD, ulasan bintang, & meta toko',
            <ShoppingBag className="w-4 h-4 text-amber-600" />,
            report.seoShopping,
            <button
              type="button"
              onClick={() => {
                const nextXml = injectProductSchemaStarterIntoXml(xml);
                if (nextXml === xml) {
                  onUpdateXml(xml, 'Skema Product JSON-LD sudah ada di dalam template.');
                } else {
                  onUpdateXml(
                    nextXml,
                    'Template JSON-LD Product (SEO Shopping) berhasil disisipkan ke <head>.'
                  );
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Sisipkan JSON-LD Product</span>
            </button>
          )}

          {renderGroup(
            'Google AdSense & Validitas XML Iklan',
            'Deteksi ca-pub-..., adsbygoogle.js, unit <ins>, gadget AdSense, serta error async/& di Studio Blogger',
            <DollarSign className="w-4 h-4 text-emerald-700" />,
            report.googleAdsense,
            report.hasAdsenseXmlSyntaxRisk ? (
              <button
                type="button"
                onClick={() => {
                  const nextXml = fixAdsenseXhtmlComplianceInXml(xml);
                  onUpdateXml(
                    nextXml,
                    'Kode skrip AdSense diamankan ke format XHTML Blogger (async &amp; crossorigin).'
                  );
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Amankan Skrip AdSense ke XML</span>
              </button>
            ) : undefined
          )}

          {/* Interactive Google AdSense Manager & XML Injector */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-emerald-50/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                    Pasang &amp; Kelola Google AdSense (XHTML Valid Studio Blogger)
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Sisipkan Auto Ads, meta verifikasi <span className="font-mono">google-adsense-account</span>, unit iklan responsif/in-article, dan file <span className="font-mono">ads.txt</span> langsung ke template XML + pratinjau langsung.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
                <span className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-700">
                  {adsenseOverview.clients[0] || 'Belum ada ca-pub'}
                </span>
                <span className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-700">
                  {adsenseOverview.insUnitCount + adsenseOverview.adsenseWidgetCount} Slot Iklan
                </span>
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Publisher ID + Tabs Row */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                <div className="lg:col-span-5 space-y-1">
                  <label
                    htmlFor="adsense-publisher-id"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    Publisher ID Google AdSense (ca-pub-...)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="adsense-publisher-id"
                      type="text"
                      value={adsensePubInput}
                      onChange={(e) => setAdsensePubInput(e.target.value)}
                      placeholder="ca-pub-1234567890123456"
                      className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                    />
                    {!adsensePubInput.trim() && (
                      <button
                        type="button"
                        onClick={() => setAdsensePubInput('ca-pub-3940256099942544')}
                        title="Isi contoh Publisher ID uji coba untuk pratinjau tata letak"
                        className="px-2.5 py-2 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Contoh ID
                      </button>
                    )}
                  </div>
                  {adsensePubInput.trim() && !normalizedPub.valid && (
                    <p className="text-[11px] text-amber-700">
                      Format Publisher ID minimal 10 digit angka (contoh: ca-pub-1234567890123456).
                    </p>
                  )}
                </div>

                <div className="lg:col-span-7 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAdsenseTab('head')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      adsenseTab === 'head'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Auto Ads &amp; Verifikasi &lt;head&gt;</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdsenseTab('unit')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      adsenseTab === 'unit'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Layout className="w-3.5 h-3.5" />
                    <span>Pasang Unit Iklan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdsenseTab('adstxt')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      adsenseTab === 'adstxt'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Generator ads.txt</span>
                  </button>
                </div>
              </div>

              {/* Tab 1: Auto Ads & Head Verification */}
              {adsenseTab === 'head' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeHeadMeta}
                        onChange={(e) => setIncludeHeadMeta(e.target.checked)}
                        className="rounded border-slate-300 accent-emerald-600"
                      />
                      <span>
                        Meta Verifikasi <code className="font-mono text-[11px]">google-adsense-account</code>
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeHeadAutoAds}
                        onChange={(e) => setIncludeHeadAutoAds(e.target.checked)}
                        className="rounded border-slate-300 accent-emerald-600"
                      />
                      <span>
                        Skrip Auto Ads <code className="font-mono text-[11px]">adsbygoogle.js</code> (format XHTML <code className="font-mono text-[11px]">async=&apos;async&apos;</code>)
                      </span>
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Semua skrip otomatis dikonversi ke format XHTML Blogger (<span className="font-mono">async=&apos;async&apos; crossorigin=&apos;anonymous&apos;</span>) agar lolos saat disimpan di menu Edit HTML Blogger tanpa error <span className="font-mono">SAXParseException</span>.
                  </p>
                </div>
              )}

              {/* Tab 2: Ad Unit Placement */}
              {adsenseTab === 'unit' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Format Unit Iklan
                      </label>
                      <select
                        value={adsenseFormat}
                        onChange={(e) => setAdsenseFormat(e.target.value as AdsenseUnitFormat)}
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                      >
                        <option value="responsive">Display Auto Responsive</option>
                        <option value="leaderboard">Banner Header 728x90</option>
                        <option value="sidebar">Sidebar Kotak 300x250</option>
                        <option value="in-article">Iklan Dalam Artikel (In-Article)</option>
                        <option value="multiplex">Multiplex (Grid Rekomendasi)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Lokasi Penempatan XML
                      </label>
                      <select
                        value={adsenseTargetKind}
                        onChange={(e) =>
                          setAdsenseTargetKind(
                            e.target.value as
                              | 'section-html-ins'
                              | 'section-native-adsense'
                              | 'post-body-before'
                              | 'post-body-after'
                          )
                        }
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                      >
                        <option value="section-html-ins">Widget HTML + &lt;ins&gt; di Section</option>
                        <option value="section-native-adsense">Widget AdSense Native di Section</option>
                        <option
                          value="post-body-before"
                          disabled={!adsenseOverview.hasPostBodyTag}
                        >
                          Atas Isi Artikel (&lt;data:post.body/&gt;)
                        </option>
                        <option
                          value="post-body-after"
                          disabled={!adsenseOverview.hasPostBodyTag}
                        >
                          Bawah Isi Artikel (&lt;data:post.body/&gt;)
                        </option>
                      </select>
                    </div>

                    {(adsenseTargetKind === 'section-html-ins' ||
                      adsenseTargetKind === 'section-native-adsense') && (
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Target &lt;b:section&gt;
                        </label>
                        <select
                          value={adsenseSectionId}
                          onChange={(e) => setAdsenseSectionId(e.target.value)}
                          className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                        >
                          {parsedInfo.sections.length === 0 ? (
                            <option value="sidebar">sidebar (belum ada section)</option>
                          ) : (
                            parsedInfo.sections.map((sec) => (
                              <option key={sec.id} value={sec.id}>
                                #{sec.id} ({sec.widgetCount} gadget)
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Ad Slot ID (data-ad-slot)
                      </label>
                      <input
                        type="text"
                        value={adsenseSlotInput}
                        onChange={(e) => setAdsenseSlotInput(e.target.value)}
                        placeholder="Opsional, mis. 1234567890"
                        className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {(adsenseTargetKind === 'section-html-ins' ||
                      adsenseTargetKind === 'section-native-adsense') && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-700">
                          Judul Widget:
                        </span>
                        <input
                          type="text"
                          value={adsenseWidgetTitle}
                          onChange={(e) => setAdsenseWidgetTitle(e.target.value)}
                          placeholder="Iklan / Sponsor"
                          className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-900 w-44"
                        />
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyOnPosts}
                        onChange={(e) => setOnlyOnPosts(e.target.checked)}
                        className="rounded border-slate-300 accent-emerald-600"
                      />
                      <span>
                        Tampilkan hanya di halaman artikel (<code className="font-mono text-[11px]">data:view.isPost</code>)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Tab 3: ads.txt Generator */}
              {adsenseTab === 'adstxt' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-900">
                      Isi File <code className="font-mono">ads.txt</code> Blogger Resmi
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-900 text-emerald-300 font-mono text-xs overflow-x-auto">
                      {adsTxtPreview}
                    </pre>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Di Dashboard Blogger, buka <strong>Setelan &rarr; Monetisasi &rarr; Aktifkan ads.txt kustom</strong>, lalu tempel baris di atas dan klik Simpan.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!normalizedPub.valid}
                      onClick={() => {
                        handleCopy('ads-txt-copy', adsTxtPreview);
                        onNotify?.('Isi ads.txt berhasil disalin ke clipboard.', 'success');
                      }}
                      className="px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedId === 'ads-txt-copy' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedId === 'ads-txt-copy' ? 'Tersalin!' : 'Salin ads.txt'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!normalizedPub.valid}
                      onClick={() => {
                        const blob = new Blob([adsTxtPreview + '\n'], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'ads.txt';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50 border border-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh ads.txt</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Live XML Snippet & Apply Controls for head / unit tabs */}
              {adsenseTab !== 'adstxt' && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700">
                      Pratinjau Potongan XML AdSense Siap Pasang:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        handleCopy('adsense-xml-snippet', adsenseSnippetPreview);
                        onNotify?.('Kode XML AdSense berhasil disalin.', 'success');
                      }}
                      className="text-[11px] font-medium text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {copiedId === 'adsense-xml-snippet' ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>
                        {copiedId === 'adsense-xml-snippet' ? 'Tersalin' : 'Salin Kode XML'}
                      </span>
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] max-h-48 overflow-auto whitespace-pre-wrap break-all">
                    {adsenseSnippetPreview}
                  </pre>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <p className="text-[11px] text-slate-500">
                      Klik pasang untuk langsung menambahkan ke template XML Anda dan melihat posisi slot iklan di tab <strong>Pratinjau</strong>.
                    </p>
                    <button
                      type="button"
                      disabled={!normalizedPub.valid}
                      onClick={() => {
                        const res = injectAdsenseIntoXml(xml, adsenseConfig);
                        if (!res.changed) {
                          onNotify?.(res.summary, 'info');
                        } else {
                          onUpdateXml(res.nextXml, res.summary);
                        }
                      }}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>
                        {adsenseTab === 'head'
                          ? 'Pasang Auto Ads & Meta ke <head>'
                          : 'Pasang Unit Iklan ke Template XML'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {siteAdsense && (
            <AdsenseSlotRenderer
              slotKey="footerSlot"
              config={siteAdsense.config}
              shouldRenderLiveAds={siteAdsense.shouldRenderLiveAds}
              isAdmin={siteAdsense.isAdmin}
              className="pt-2"
            />
          )}
        </div>
      </div>
    </div>
  );
};
