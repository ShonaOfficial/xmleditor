import React, { useRef, useState } from 'react';
import {
  FileUp,
  Globe,
  Palette,
  Type as TypeIcon,
  Wand2,
  RotateCcw,
  Loader2,
  Check,
  AlertCircle,
  FileCode2,
  ShieldCheck,
  BadgeCheck,
  BookOpen,
  Wrench,
  CheckCircle2,
  History,
  Bot,
  Scissors,
} from 'lucide-react';
import type {
  AiDiagnosticResult,
  BloggerVariable,
  FontCustomization,
  ParsedTemplateInfo,
  SampleBlogData,
  ThemePaletteOverrides,
} from '../types/blogger';
import {
  COLOR_PALETTE_PRESETS,
  FONT_OPTIONS,
  TEMPLATE_PRESETS,
} from '../data/presets';
import {
  compareBlogWithActiveTemplate,
  type LiveBlogFingerprint,
  type TemplateMatchComparison,
} from '../lib/seoAndErrorAnalyzer';
import {
  diagnoseXmlOfflineAi,
  generateCustomCssOfflineAi,
  generateSampleContentOfflineAi,
  generateThemeOfflineAi,
} from '../lib/offlineAiEngine';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { runJsonPromptOnLocalServer } from '../lib/offlineAiRuntime';
import { parseTemplateIdentityFromXml } from '../lib/templateIdentity';
import { TemplateIdentityModal } from './TemplateIdentityModal';
import type { PreviewVisualMode } from './PreviewCanvas';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import { AiEngineSelectorCard } from './AiEngineSelectorCard';
import { getGeminiModelOption } from '../lib/aiEngineCatalog';
import { AdsenseSlotRenderer } from './AdsenseSlotRenderer';
import type { SiteAdsenseConfig } from '../types/adsense';

export type SidebarTab = 'sumber' | 'warna' | 'font' | 'ai';

interface SidebarControlsProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  xml: string;
  activePresetId: string | null;
  sourceLabel: string;
  parsedInfo: ParsedTemplateInfo;
  variableValues: Record<string, string>;
  onVariableChange: (name: string, value: string) => void;
  colors: ThemePaletteOverrides;
  onColorsChange: (next: ThemePaletteOverrides) => void;
  fonts: FontCustomization;
  onFontsChange: (next: FontCustomization) => void;
  customCss: string;
  onCustomCssChange: (css: string) => void;
  onSelectPreset: (presetId: string) => void;
  onLoadXmlContent: (
    xml: string,
    label: string,
    presetId?: string | null,
    originalBytes?: number | null
  ) => void;
  cssVarValues: Record<string, string>;
  onCssVarChange: (key: string, value: string) => void;
  sampleData: SampleBlogData;
  onSampleDataChange: (next: SampleBlogData) => void;
  xmlIssuesCount: number;
  onAutoFixOffline: () => void;
  onOpenEditor: () => void;
  onSetUserBlogVisual: (url: string, visualHtml: string, switchMode?: PreviewVisualMode) => void;
  onOpenPreview?: () => void;
  offlineAi: OfflineAiController;
  isOfflineMode?: boolean;
  onSwitchToOnline?: () => void;
  onUpdateXml?: (nextXml: string, feedbackMessage: string) => void;
  onOpenSnapshots?: () => void;
  snapshotCount?: number;
  onOpenSplitter?: () => void;
  sharedBlogUrl?: string;
  onSharedBlogUrlChange?: (url: string) => void;
  onBlogFingerprintFetched?: (
    url: string,
    fingerprint: LiveBlogFingerprint,
    comparison: TemplateMatchComparison,
    visualHtml?: string | null
  ) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
  siteAdsense?: {
    config: SiteAdsenseConfig;
    shouldRenderLiveAds: boolean;
    isAdmin: boolean;
  };
}

export const SidebarControls: React.FC<SidebarControlsProps> = ({
  activeTab,
  onTabChange,
  xml,
  activePresetId,
  sourceLabel,
  parsedInfo,
  variableValues,
  onVariableChange,
  colors,
  onColorsChange,
  fonts,
  onFontsChange,
  customCss,
  onCustomCssChange,
  onSelectPreset,
  onLoadXmlContent,
  cssVarValues,
  onCssVarChange,
  sampleData,
  onSampleDataChange,
  xmlIssuesCount,
  onAutoFixOffline,
  onOpenEditor,
  onSetUserBlogVisual,
  onOpenPreview,
  offlineAi,
  isOfflineMode: appOfflineMode = false,
  onSwitchToOnline,
  onUpdateXml,
  onOpenSnapshots,
  snapshotCount = 0,
  onOpenSplitter,
  sharedBlogUrl,
  onSharedBlogUrlChange,
  onBlogFingerprintFetched,
  onNotify,
  siteAdsense,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Compare live Blogspot URL vs currently edited template (synced 1:1 with Konsol URL when sharedBlogUrl is passed)
  const [localVerifyUrl, setLocalVerifyUrl] = useState('');
  const verifyUrlInput = sharedBlogUrl !== undefined ? sharedBlogUrl : localVerifyUrl;
  const setVerifyUrlInput = (nextUrl: string) => {
    if (onSharedBlogUrlChange) {
      onSharedBlogUrlChange(nextUrl);
    } else {
      setLocalVerifyUrl(nextUrl);
    }
  };
  const [isVerifyingUrl, setIsVerifyingUrl] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<TemplateMatchComparison | null>(null);
  const [verifiedSourceUrl, setVerifiedSourceUrl] = useState<string | null>(null);
  const [verifiedVisualHtml, setVerifiedVisualHtml] = useState<string | null>(null);

  // Unified Hybrid AI Controller
  const {
    user,
    engineMode,
    geminiModel,
    signInWithGoogle,
    authorizedGeminiFetch,
    setChatOpen,
  } = useAuthAndAi();
  const activeGeminiMeta = getGeminiModelOption(geminiModel);
  const [aiThemePrompt, setAiThemePrompt] = useState('');
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
  const [aiThemeFeedback, setAiThemeFeedback] = useState<string | null>(null);

  const [aiCssPrompt, setAiCssPrompt] = useState('');
  const [isGeneratingCss, setIsGeneratingCss] = useState(false);
  const [aiCssFeedback, setAiCssFeedback] = useState<string | null>(null);

  const [aiTopicPrompt, setAiTopicPrompt] = useState('');
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);

  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<AiDiagnosticResult | null>(null);

  const colorVariables: BloggerVariable[] = parsedInfo.variables.filter(
    (v) => v.type.toLowerCase() === 'color' || /^#[0-9a-f]{3,8}$/i.test(v.value)
  );
  const fontVariables: BloggerVariable[] = parsedInfo.variables.filter(
    (v) => v.type.toLowerCase() === 'font'
  );
  const lengthVariables: BloggerVariable[] = parsedInfo.variables.filter(
    (v) =>
      v.type.toLowerCase() === 'length' ||
      (/width|size|padding|margin|radius|gap|height|spacing/i.test(v.name) &&
        /^-?\d+(?:\.\d+)?(?:px|em|rem|%)$/i.test(v.value.trim()) &&
        v.type.toLowerCase() !== 'color' &&
        v.type.toLowerCase() !== 'font')
  );

  const handleFetchFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    if (appOfflineMode) {
      const msg = 'Mode Offline sedang aktif. Beralih ke Mode Online untuk mengambil URL baru.';
      setUrlError(msg);
      onNotify(msg, 'info');
      return;
    }
    setIsFetchingUrl(true);
    setUrlError(null);

    try {
      const res = await fetch('/api/fetch-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memuat template dari URL.');
      }
      const hostname = new URL(data.sourceUrl).hostname;
      onLoadXmlContent(
        data.xml,
        data.convertedFromLiveSite ? `Situs: ${hostname}` : `URL: ${hostname}`,
        null
      );
      if (data.visualPreviewHtml) {
        onSetUserBlogVisual(data.sourceUrl, data.visualPreviewHtml, 'user-site');
      }
      onNotify(
        data.convertedFromLiveSite
          ? `Halaman visual asli & XML wrapper dari ${hostname} berhasil dimuat.`
          : `Template XML dari ${hostname} berhasil dimuat.`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil URL.';
      setUrlError(msg);
      onNotify(msg, 'error');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleVerifyBlogspotMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyUrlInput.trim()) return;
    if (appOfflineMode) {
      const msg = 'Mode Offline sedang aktif. Aktifkan Mode Online untuk mengecek URL Blogspot live.';
      setVerifyError(msg);
      onNotify(msg, 'info');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const msg = 'Pemeriksaan alamat Blogspot live memerlukan koneksi internet.';
      setVerifyError(msg);
      onNotify(msg, 'error');
      return;
    }

    setIsVerifyingUrl(true);
    setVerifyError(null);
    setVerifyResult(null);
    setVerifiedVisualHtml(null);

    try {
      const res = await fetch('/api/compare-blogspot-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: verifyUrlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memeriksa alamat Blogspot.');
      }
      const comparison = compareBlogWithActiveTemplate(
        data.fingerprint,
        parsedInfo,
        xml
      );
      setVerifyResult(comparison);
      setVerifiedSourceUrl(data.fingerprint.sourceUrl);
      if (data.visualPreviewHtml) {
        setVerifiedVisualHtml(data.visualPreviewHtml);
        onSetUserBlogVisual(data.fingerprint.sourceUrl, data.visualPreviewHtml, 'split');
      }
      onBlogFingerprintFetched?.(
        data.fingerprint.sourceUrl,
        data.fingerprint,
        comparison,
        data.visualPreviewHtml || null
      );
      onNotify(comparison.headline, comparison.verdict === 'same' ? 'success' : 'info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mencocokkan URL blog.';
      setVerifyError(msg);
      onNotify(msg, 'error');
    } finally {
      setIsVerifyingUrl(false);
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      onNotify('Harap pilih file template Blogger berekstensi .xml yang valid.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) {
        onNotify('File XML kosong atau tidak dapat dibaca.', 'error');
        return;
      }
      onLoadXmlContent(content, `File: ${file.name}`, null, file.size);
      onNotify(
        `File ${file.name} (${(file.size / 1024).toFixed(1)} KB) berhasil dimuat.`,
        'success'
      );
    };
    reader.onerror = () => {
      onNotify('Gagal membaca file dari perangkat Anda.', 'error');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const applyGeneratedThemeData = (data: {
    themeName: string;
    rationale: string;
    colors?: Partial<ThemePaletteOverrides>;
    fonts?: Partial<FontCustomization>;
    variableUpdates?: Array<{ name: string; value: string }>;
    customCss?: string;
  }) => {
    if (data.colors) {
      onColorsChange({
        ...colors,
        enabled: true,
        ...data.colors,
      });
    }
    if (data.fonts) {
      onFontsChange({
        ...fonts,
        enabled: true,
        headingFont: data.fonts.headingFont || fonts.headingFont,
        bodyFont: data.fonts.bodyFont || fonts.bodyFont,
        baseFontSize: Number(data.fonts.baseFontSize) || fonts.baseFontSize,
        lineHeight: Number(data.fonts.lineHeight) || fonts.lineHeight,
        headingWeight: Number(data.fonts.headingWeight) || fonts.headingWeight,
        borderRadius: Number(data.fonts.borderRadius) ?? fonts.borderRadius,
      });
    }
    if (Array.isArray(data.variableUpdates)) {
      for (const item of data.variableUpdates) {
        if (item?.name && item?.value) {
          onVariableChange(item.name, item.value);
        }
      }
    }
    if (typeof data.customCss === 'string' && data.customCss.trim()) {
      onCustomCssChange(data.customCss.trim());
    }
    setAiThemeFeedback(`${data.themeName}: ${data.rationale}`);
    onNotify(`Tema "${data.themeName}" langsung diterapkan ke pratinjau.`, 'success');
  };

  const handleAiGenerateTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiThemePrompt.trim()) return;
    setIsGeneratingTheme(true);
    setAiThemeFeedback(null);

    const varsPayload = parsedInfo.variables.map((v) => ({
      name: v.name,
      description: v.description,
      type: v.type,
      value: variableValues[v.name] ?? v.value,
    }));

    const isOfflineMode =
      appOfflineMode ||
      engineMode === 'local' ||
      (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOfflineMode) {
      if (offlineAi.config.runtime !== 'builtin') {
        try {
          const { jsonText, engineLabel } = await runJsonPromptOnLocalServer(
            offlineAi.config,
            'Buat palet tema Blogger XML JSON: { "themeName": string, "rationale": string, "colors": { "background": hex, "surface": hex, "primary": hex, "heading": hex, "text": hex, "link": hex, "headerBg": hex, "headerText": hex, "border": hex }, "fonts": { "headingFont": string, "bodyFont": string, "baseFontSize": number, "lineHeight": number, "headingWeight": number, "borderRadius": number }, "customCss": string }',
            `Desain tema untuk: ${aiThemePrompt.trim()}. Template: ${parsedInfo.templateTitle}.`
          );
          const parsed = JSON.parse(jsonText);
          applyGeneratedThemeData({
            ...parsed,
            rationale: `[${engineLabel}] ${parsed.rationale || ''}`,
          });
          setIsGeneratingTheme(false);
          return;
        } catch {
          // Automatic instant fallback to built-in TemaLoka Offline AI
        }
      }
      const localTheme = generateThemeOfflineAi(aiThemePrompt.trim(), varsPayload);
      applyGeneratedThemeData(localTheme);
      setIsGeneratingTheme(false);
      return;
    }

    if (!user) {
      setIsGeneratingTheme(false);
      onNotify('Login Google diperlukan untuk memakai Gemini Cloud.', 'info');
      void signInWithGoogle();
      return;
    }

    try {
      const data = await authorizedGeminiFetch<Parameters<typeof applyGeneratedThemeData>[0]>(
        '/api/ai/generate-theme',
        {
          prompt: aiThemePrompt.trim(),
          currentVariables: varsPayload,
          templateSummary: parsedInfo.templateTitle,
        }
      );
      applyGeneratedThemeData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Koneksi Gemini gagal.';
      const fallbackTheme = generateThemeOfflineAi(aiThemePrompt.trim(), varsPayload);
      applyGeneratedThemeData(fallbackTheme);
      onNotify(`${msg} — dialihkan ke AI Lokal sebagai cadangan.`, 'info');
    } finally {
      setIsGeneratingTheme(false);
    }
  };

  const handleAiCustomCss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiCssPrompt.trim()) return;
    setIsGeneratingCss(true);
    setAiCssFeedback(null);

    const isOfflineMode =
      appOfflineMode ||
      engineMode === 'local' ||
      (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOfflineMode) {
      if (offlineAi.config.runtime !== 'builtin') {
        try {
          const { jsonText, engineLabel } = await runJsonPromptOnLocalServer(
            offlineAi.config,
            'Hasilkan JSON { "css": string, "explanation": string } untuk CSS tambahan Blogger.',
            `Instruksi: ${aiCssPrompt.trim()}\nCSS saat ini:\n${customCss.slice(0, 2000)}`
          );
          const parsed = JSON.parse(jsonText) as { css?: string; explanation?: string };
          if (typeof parsed.css === 'string') {
            onCustomCssChange(parsed.css.trim());
            setAiCssFeedback(`[${engineLabel}] ${parsed.explanation || 'CSS diperbarui.'}`);
            onNotify(`CSS dari ${engineLabel} diterapkan real-time.`, 'success');
            setIsGeneratingCss(false);
            return;
          }
        } catch {
          // fallback below
        }
      }
      const localCss = generateCustomCssOfflineAi(aiCssPrompt.trim(), customCss);
      onCustomCssChange(localCss.css);
      setAiCssFeedback(localCss.explanation);
      onNotify('Modifikasi CSS AI Lokal diterapkan secara real-time.', 'success');
      setIsGeneratingCss(false);
      return;
    }

    if (!user) {
      setIsGeneratingCss(false);
      onNotify('Login Google diperlukan untuk memakai Gemini Cloud.', 'info');
      void signInWithGoogle();
      return;
    }

    try {
      const data = await authorizedGeminiFetch<{ css?: string; explanation?: string }>(
        '/api/ai/custom-css',
        {
          instruction: aiCssPrompt.trim(),
          currentCustomCss: customCss,
          templateSummary: `Judul: ${parsedInfo.templateTitle}, Section: ${parsedInfo.sections.map((s) => s.id).join(', ')}`,
        }
      );

      if (typeof data.css === 'string') {
        onCustomCssChange(data.css.trim());
      }
      setAiCssFeedback(data.explanation || 'CSS berhasil diperbarui.');
      onNotify(`Modifikasi CSS (${activeGeminiMeta.shortLabel}) diterapkan real-time.`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Gemini.';
      const fallbackCss = generateCustomCssOfflineAi(aiCssPrompt.trim(), customCss);
      onCustomCssChange(fallbackCss.css);
      setAiCssFeedback(fallbackCss.explanation);
      onNotify(`${msg} — AI Lokal mengambil alih CSS secara lokal.`, 'info');
    } finally {
      setIsGeneratingCss(false);
    }
  };

  const applySampleContentPayload = (data: {
    blogTitle?: string;
    blogDescription?: string;
    authorName?: string;
    authorBio?: string;
    navLinks?: Array<string | { label: string; category?: string }>;
    labels?: Array<string | { name: string; count: number }>;
    posts?: Array<{
      title: string;
      snippet: string;
      bodyHtml: string;
      category: string;
      readTime: string;
      date: string;
    }>;
  }) => {
    const imagePool = sampleData.posts.map((p) => p.imageUrl);
    const mappedPosts = (data.posts || []).map((p, idx) => ({
      id: `ai-post-${idx + 1}`,
      title: p.title,
      snippet: p.snippet,
      bodyHtml: p.bodyHtml,
      author: data.authorName || sampleData.authorName,
      date: p.date || '16 Nov 2026',
      category: p.category || 'Umum',
      readTime: p.readTime || '4 mnt baca',
      imageUrl: imagePool[idx % imagePool.length] || '',
      commentsCount: 4 + idx * 3,
    }));

    const normalizedNavLinks = data.navLinks?.length
      ? data.navLinks.map((item) =>
          typeof item === 'string' ? { label: item } : item
        )
      : sampleData.navLinks;

    const normalizedLabels = data.labels?.length
      ? data.labels.map((item, idx) =>
          typeof item === 'string' ? { name: item, count: Math.max(3, 12 - idx * 2) } : item
        )
      : sampleData.labels;

    onSampleDataChange({
      blogTitle: data.blogTitle || sampleData.blogTitle,
      blogDescription: data.blogDescription || sampleData.blogDescription,
      authorName: data.authorName || sampleData.authorName,
      authorBio: data.authorBio || sampleData.authorBio,
      authorAvatar: sampleData.authorAvatar,
      navLinks: normalizedNavLinks,
      labels: normalizedLabels,
      posts: mappedPosts.length ? mappedPosts : sampleData.posts,
    });
    onNotify(`Konten sampel topik "${aiTopicPrompt.trim()}" berhasil diterapkan.`, 'success');
  };

  const handleAiSampleContent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopicPrompt.trim()) return;
    setIsGeneratingContent(true);

    const isOfflineMode =
      appOfflineMode ||
      engineMode === 'local' ||
      (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOfflineMode) {
      if (offlineAi.config.runtime !== 'builtin') {
        try {
          const { jsonText } = await runJsonPromptOnLocalServer(
            offlineAi.config,
            'Hasilkan JSON { "blogTitle": string, "blogDescription": string, "authorName": string, "authorBio": string, "navLinks": string[], "labels": string[], "posts": [{ "title": string, "snippet": string, "bodyHtml": string, "category": string, "readTime": string, "date": string }] } berisi 3 artikel Bahasa Indonesia.',
            `Topik blog: ${aiTopicPrompt.trim()}`
          );
          const parsed = JSON.parse(jsonText);
          if (Array.isArray(parsed.posts) && parsed.posts.length > 0) {
            applySampleContentPayload(parsed);
            setIsGeneratingContent(false);
            return;
          }
        } catch {
          // fallback below
        }
      }
      const localSample = generateSampleContentOfflineAi(aiTopicPrompt.trim());
      applySampleContentPayload(localSample);
      setIsGeneratingContent(false);
      return;
    }

    if (!user) {
      setIsGeneratingContent(false);
      onNotify('Login Google diperlukan untuk memakai Gemini Cloud.', 'info');
      void signInWithGoogle();
      return;
    }

    try {
      const data = await authorizedGeminiFetch<Parameters<typeof applySampleContentPayload>[0]>(
        '/api/ai/sample-content',
        { topic: aiTopicPrompt.trim() }
      );
      applySampleContentPayload(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat konten sampel.';
      onNotify(`${msg} — memakai konten sampel AI Lokal.`, 'info');
      const fallbackSample = generateSampleContentOfflineAi(aiTopicPrompt.trim());
      applySampleContentPayload(fallbackSample);
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setIsDiagnosing(true);
    const isOfflineMode =
      appOfflineMode ||
      engineMode === 'local' ||
      (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOfflineMode) {
      if (offlineAi.config.runtime !== 'builtin') {
        try {
          const { jsonText, engineLabel } = await runJsonPromptOnLocalServer(
            offlineAi.config,
            'Audit template Blogger JSON: { "summary": string, "items": [{ "category": string, "title": string, "detail": string, "severity": "good" | "warning" | "fixable" }], "suggestedCssFix": string }',
            `Template: ${parsedInfo.templateTitle}, Sections: ${parsedInfo.sections.length}, Widgets: ${parsedInfo.widgets.length}, CSS Ganda: ${parsedInfo.redundancyReport.totalDuplicateCssCount}, JS Ganda: ${parsedInfo.redundancyReport.totalDuplicateJsCount}, CSS Mati: ${parsedInfo.redundancyReport.unusedCssRules.length}.\nCSS:\n${parsedInfo.rawSkinCss.slice(0, 4000)}`
          );
          const parsed = JSON.parse(jsonText) as AiDiagnosticResult;
          if (parsed?.summary && Array.isArray(parsed.items)) {
            setDiagnosticResult({
              ...parsed,
              summary: `[${engineLabel}] ${parsed.summary}`,
            });
            setIsDiagnosing(false);
            return;
          }
        } catch {
          // fallback below
        }
      }
      const localDiag = diagnoseXmlOfflineAi(parsedInfo, xml);
      setDiagnosticResult(localDiag);
      setIsDiagnosing(false);
      return;
    }

    if (!user) {
      setIsDiagnosing(false);
      onNotify('Login Google diperlukan untuk memakai Gemini Cloud.', 'info');
      void signInWithGoogle();
      return;
    }

    try {
      const data = await authorizedGeminiFetch<AiDiagnosticResult>(
        '/api/ai/diagnose-xml',
        {
          xmlSnippet: parsedInfo.rawSkinCss.slice(0, 12000),
          stats: {
            variables: parsedInfo.variables.length,
            sections: parsedInfo.sections.length,
            widgets: parsedInfo.widgets.length,
            hasViewportMeta: parsedInfo.hasViewportMeta,
            hasSkin: parsedInfo.hasSkin,
          },
        }
      );
      setDiagnosticResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menganalisis XML.';
      onNotify(`${msg} — memakai diagnosa AI Lokal.`, 'info');
      const fallbackDiag = diagnoseXmlOfflineAi(parsedInfo, xml);
      setDiagnosticResult(fallbackDiag);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const tabs: Array<{ id: SidebarTab; label: string; icon: React.ReactNode }> = [
    { id: 'sumber', label: 'Sumber', icon: <FileCode2 className="w-4 h-4" /> },
    { id: 'warna', label: 'Warna', icon: <Palette className="w-4 h-4" /> },
    { id: 'font', label: 'Font', icon: <TypeIcon className="w-4 h-4" /> },
    { id: 'ai', label: 'AI Studio', icon: <Wand2 className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-full lg:w-[360px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
      {/* Segmented Workspace Tabs */}
      <div className="p-3 border-b border-slate-200 bg-slate-50/70">
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/70 rounded-lg">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Control Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'sumber' && (
          <>
            {/* Active source summary */}
            <div className="pb-4 border-b border-slate-100 space-y-2.5">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-slate-500">Template Aktif</span>
                  {onUpdateXml && (
                    <button
                      type="button"
                      onClick={() => setIdentityModalOpen(true)}
                      className="flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                    >
                      <BadgeCheck className="w-3.5 h-3.5" />
                      <span>Atur Identitas</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {parsedInfo.templateTitle}
                  </div>
                  {(() => {
                    const idInfo = parseTemplateIdentityFromXml(xml);
                    return idInfo.version ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 rounded shrink-0">
                        v{idInfo.version.replace(/^v/i, '')}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span className="truncate max-w-[160px]">{sourceLabel}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>{parsedInfo.sections.length} section</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>{parsedInfo.widgets.length} widget</span>
                </div>
              </div>

              {xmlIssuesCount > 0 ? (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                  <div className="text-[11px] font-medium text-amber-900 tabular-nums">
                    Terdeteksi {xmlIssuesCount} masalah sintaks XML (offline).
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onAutoFixOffline}
                      className="flex-1 py-1.5 px-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-medium rounded flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Wrench className="w-3 h-3" />
                      <span>Auto-Fix Offline</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenEditor}
                      className="py-1.5 px-2.5 bg-white border border-amber-300 hover:bg-amber-100/60 text-amber-900 text-[11px] font-medium rounded cursor-pointer"
                    >
                      Detail
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-emerald-700 pt-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Sintaks XML valid (offline)</span>
                  </span>
                  <button
                    type="button"
                    onClick={onOpenEditor}
                    className="text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Escape &amp; CDATA &rarr;
                  </button>
                </div>
              )}

              {onOpenSnapshots && (
                <button
                  type="button"
                  onClick={onOpenSnapshots}
                  className="w-full py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-medium flex items-center justify-between gap-2 cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-blue-600" />
                    <span>Riwayat Snapshot Lokal (IndexedDB)</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    {snapshotCount} tersimpan
                  </span>
                </button>
              )}

              {onOpenSplitter && (
                <button
                  type="button"
                  onClick={onOpenSplitter}
                  className="w-full py-2 px-3 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 text-blue-900 text-xs font-medium flex items-center justify-between gap-2 cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5 text-blue-600" />
                    <span>XML Splitter &amp; Penyatu XML</span>
                  </span>
                  <span className="text-[11px] font-semibold text-blue-700">
                    Pecah / Gabung &rarr;
                  </span>
                </button>
              )}
            </div>

            {/* Load via URL */}
            <section className="space-y-2.5">
              <label htmlFor="xml-url-input" className="block text-xs font-semibold text-slate-800">
                Muat dari URL XML atau Alamat Blogspot
              </label>
              <form onSubmit={handleFetchFromUrl} className="space-y-2">
                <div className="relative">
                  <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="xml-url-input"
                    type="url"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    placeholder="https://raw.githubusercontent.com/.../theme.xml"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isFetchingUrl || !urlInput.trim()}
                  className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isFetchingUrl ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Mengambil Template...</span>
                    </>
                  ) : (
                    <span>Muat Pratinjau dari URL</span>
                  )}
                </button>
              </form>
              {appOfflineMode && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-[11px] text-amber-900">
                  <span>Mode Offline aktif — muat URL baru dijeda.</span>
                  {onSwitchToOnline && (
                    <button
                      type="button"
                      onClick={onSwitchToOnline}
                      className="px-2 py-1 bg-amber-900 text-white rounded font-medium shrink-0 cursor-pointer hover:bg-amber-800"
                    >
                      Aktifkan Online
                    </button>
                  )}
                </div>
              )}
              {urlError && (
                <div className="flex items-start gap-2 text-xs text-red-600 pt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{urlError}</span>
                </div>
              )}
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Mendukung tautan file <span className="font-mono">.xml</span> langsung, tautan GitHub, maupun URL blog <span className="font-mono">.blogspot.com</span> tanpa login.
              </p>
            </section>

            {/* Compare Live Blogspot URL vs Currently Edited XML */}
            <section className="space-y-2.5 pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-800">
                Cek Kecocokan URL Blogspot vs XML Ini
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Masukkan alamat Blogspot Anda untuk mengecek apakah blog live memakai template yang sama dengan XML yang sedang diedit.
              </p>
              <form onSubmit={handleVerifyBlogspotMatch} className="space-y-2">
                <input
                  type="text"
                  value={verifyUrlInput}
                  onChange={(e) => {
                    setVerifyUrlInput(e.target.value);
                    if (verifyError) setVerifyError(null);
                  }}
                  placeholder="https://namabloganda.blogspot.com"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={isVerifyingUrl || !verifyUrlInput.trim()}
                  className="w-full py-2 px-3 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isVerifyingUrl ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Mencocokkan Struktur...</span>
                    </>
                  ) : (
                    <span>Periksa Kecocokan Template</span>
                  )}
                </button>
              </form>

              {verifyError && (
                <div className="flex items-start gap-2 text-xs text-red-600 pt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verifyResult && (
                <div
                  className={`p-3 rounded-lg border space-y-2 ${
                    verifyResult.verdict === 'same'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                      : verifyResult.verdict === 'partial'
                        ? 'bg-amber-50 border-amber-200 text-amber-950'
                        : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{verifyResult.headline}</span>
                    <span className="font-mono tabular-nums text-xs font-bold shrink-0">
                      {verifyResult.similarityPercent}%
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90">{verifyResult.summary}</p>
                  <div className="text-[11px] font-mono tabular-nums space-y-0.5 pt-1 border-t border-black/10">
                    <div>
                      Kecocokan CSS Tema: {verifyResult.cssMatchPercent}% ({verifyResult.matchedSignatureTokens.length} token)
                    </div>
                    <div>
                      Widget cocok: {verifyResult.matchedWidgets.length} &middot; Hanya di blog:{' '}
                      {verifyResult.onlyInLiveWidgets.length} &middot; Hanya di XML:{' '}
                      {verifyResult.onlyInXmlWidgets.length}
                    </div>
                    <div>
                      Section cocok: {verifyResult.matchedSections.length} &middot; Font cocok:{' '}
                      {verifyResult.matchedFonts.length} &middot; CSS Vars:{' '}
                      {verifyResult.matchedCssVars.length}
                    </div>
                  </div>
                  {verifyResult.mismatchReasons.length > 0 && (
                    <ul className="text-[11px] leading-snug list-disc pl-4 space-y-0.5 opacity-90">
                      {verifyResult.mismatchReasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {verifiedVisualHtml && verifiedSourceUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          onSetUserBlogVisual(verifiedSourceUrl, verifiedVisualHtml, 'user-site');
                          onOpenPreview?.();
                        }}
                        className="px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded cursor-pointer"
                      >
                        Lihat Iframe Visual &rarr;
                      </button>
                    )}
                    {verifyResult.verdict === 'different' && verifiedSourceUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setUrlInput(verifiedSourceUrl);
                          onNotify('URL disalin ke kotak "Muat dari URL" di atas.', 'info');
                        }}
                        className="text-[11px] font-semibold underline cursor-pointer"
                      >
                        Salin ke Muat URL
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Upload XML File */}
            <section className="space-y-2.5 pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-800">Unggah File XML Langsung</div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                }}
                className={`border border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
                }`}
              >
                <FileUp className="w-5 h-5 text-slate-500 mx-auto mb-1.5" />
                <div className="text-xs font-medium text-slate-800">
                  Klik untuk pilih atau seret file .xml
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Diproses lokal instan di browser Anda
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </section>

            {/* Built-in Presets */}
            <section className="space-y-2.5 pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-800">Template Bawaan Siap Uji</div>
              <div className="space-y-2">
                {TEMPLATE_PRESETS.map((preset) => {
                  const isActive = activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onSelectPreset(preset.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                        isActive
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">{preset.name}</span>
                        <span className="text-[11px] text-slate-500">{preset.category}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {activeTab === 'warna' && (
          <>
            {/* Curated Color Palettes */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Palet Instan</span>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={colors.enabled}
                    onChange={(e) => onColorsChange({ ...colors, enabled: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Aktifkan</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {COLOR_PALETTE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      onColorsChange({
                        enabled: true,
                        ...preset.palette,
                      })
                    }
                    className="text-left p-2.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className="w-3.5 h-3.5 rounded-sm border border-black/10"
                        style={{ backgroundColor: preset.palette.background }}
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-sm border border-black/10"
                        style={{ backgroundColor: preset.palette.headerBg }}
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-sm border border-black/10"
                        style={{ backgroundColor: preset.palette.primary }}
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-sm border border-black/10"
                        style={{ backgroundColor: preset.palette.heading }}
                      />
                    </div>
                    <div className="text-xs font-semibold text-slate-900 truncate">{preset.name}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* Real-time Global Color Pickers */}
            <section className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Warna Tema Real-Time</span>
                {colors.enabled && (
                  <button
                    type="button"
                    onClick={() => onColorsChange({ ...colors, enabled: false })}
                    className="text-[11px] text-slate-500 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Asli XML</span>
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {(
                  [
                    ['background', 'Latar Belakang'],
                    ['surface', 'Permukaan Kartu'],
                    ['primary', 'Aksen & Tombol'],
                    ['heading', 'Teks Judul'],
                    ['text', 'Teks Paragraf'],
                    ['link', 'Warna Tautan'],
                    ['headerBg', 'Latar Header'],
                    ['headerText', 'Teks Header'],
                    ['border', 'Garis Batas'],
                  ] as Array<[keyof Omit<ThemePaletteOverrides, 'enabled'>, string]>
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs text-slate-700">{label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={colors[key]}
                        onChange={(e) =>
                          onColorsChange({
                            ...colors,
                            enabled: true,
                            [key]: e.target.value,
                          })
                        }
                        className="w-20 px-2 py-1 text-[11px] font-mono tabular-nums border border-slate-200 rounded text-slate-800 bg-slate-50"
                      />
                      <input
                        type="color"
                        value={/^#[0-9a-f]{6}$/i.test(colors[key]) ? colors[key] : '#1d4ed8'}
                        onChange={(e) =>
                          onColorsChange({
                            ...colors,
                            enabled: true,
                            [key]: e.target.value,
                          })
                        }
                        aria-label={label}
                        className="w-7 h-7 p-0.5 rounded border border-slate-200 bg-white cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Native XML <Variable type="color"> */}
            {colorVariables.length > 0 && (
              <section className="space-y-2.5 pt-4 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-800">
                  Variabel Warna XML ({colorVariables.length})
                </div>
                <div className="space-y-2">
                  {colorVariables.map((v) => {
                    const currentVal = variableValues[v.name] ?? v.value;
                    const isModified = currentVal !== v.value;
                    return (
                      <div key={v.name} className="flex items-center justify-between gap-2 py-1">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-800 truncate">{v.description}</div>
                          <div className="text-[10px] font-mono text-slate-400 truncate">{v.name}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isModified && (
                            <button
                              type="button"
                              onClick={() => onVariableChange(v.name, v.value)}
                              title={`Reset ke bawaan (${v.value})`}
                              aria-label={`Reset ${v.name}`}
                              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) => onVariableChange(v.name, e.target.value)}
                            className="w-20 px-2 py-1 text-[11px] font-mono tabular-nums border border-slate-200 rounded bg-slate-50"
                          />
                          <input
                            type="color"
                            value={/^#[0-9a-f]{6}$/i.test(currentVal) ? currentVal : '#334155'}
                            onChange={(e) => onVariableChange(v.name, e.target.value)}
                            aria-label={v.description}
                            className="w-7 h-7 p-0.5 rounded border border-slate-200 bg-white cursor-pointer"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* CSS Custom Properties (--var) colors */}
            {parsedInfo.cssCustomProperties.filter((p) => p.valueType === 'color').length > 0 && (
              <section className="space-y-2.5 pt-4 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-800">
                  CSS Variables Warna (
                  {parsedInfo.cssCustomProperties.filter((p) => p.valueType === 'color').length})
                </div>
                <div className="space-y-2">
                  {parsedInfo.cssCustomProperties
                    .filter((p) => p.valueType === 'color')
                    .slice(0, 20)
                    .map((prop) => {
                      const key = `${prop.selector}::${prop.name}`;
                      const currentVal = cssVarValues[key] ?? prop.value;
                      return (
                        <div key={key} className="flex items-center justify-between gap-2 py-1">
                          <div className="min-w-0">
                            <div className="text-xs font-mono text-slate-800 truncate">
                              {prop.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              {prop.selector}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="text"
                              value={currentVal}
                              onChange={(e) => onCssVarChange(key, e.target.value)}
                              className="w-20 px-2 py-1 text-[11px] font-mono tabular-nums border border-slate-200 rounded bg-slate-50"
                            />
                            <input
                              type="color"
                              value={/^#[0-9a-f]{6}$/i.test(currentVal) ? currentVal : '#334155'}
                              onChange={(e) => onCssVarChange(key, e.target.value)}
                              aria-label={prop.name}
                              className="w-7 h-7 p-0.5 rounded border border-slate-200 bg-white cursor-pointer"
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === 'font' && (
          <>
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Kustomisasi Tipografi</span>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fonts.enabled}
                    onChange={(e) => onFontsChange({ ...fonts, enabled: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Aktifkan</span>
                </label>
              </div>

              {/* Heading Font */}
              <div className="space-y-1.5">
                <label htmlFor="heading-font-select" className="block text-xs font-medium text-slate-700">
                  Font Judul &amp; Header
                </label>
                <select
                  id="heading-font-select"
                  value={fonts.headingFont}
                  onChange={(e) =>
                    onFontsChange({ ...fonts, enabled: true, headingFont: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name} ({f.vibe})
                    </option>
                  ))}
                </select>
              </div>

              {/* Body Font */}
              <div className="space-y-1.5">
                <label htmlFor="body-font-select" className="block text-xs font-medium text-slate-700">
                  Font Artikel &amp; Paragraf
                </label>
                <select
                  id="body-font-select"
                  value={fonts.bodyFont}
                  onChange={(e) =>
                    onFontsChange({ ...fonts, enabled: true, bodyFont: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name} ({f.vibe})
                    </option>
                  ))}
                </select>
              </div>

              {/* Sliders */}
              <div className="space-y-3.5 pt-3 border-t border-slate-100">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700">Ukuran Teks Dasar</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {fonts.baseFontSize} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={13}
                    max={20}
                    step={1}
                    value={fonts.baseFontSize}
                    onChange={(e) =>
                      onFontsChange({ ...fonts, enabled: true, baseFontSize: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700">Tinggi Baris (Line Height)</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {fonts.lineHeight.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.35}
                    max={2.0}
                    step={0.05}
                    value={fonts.lineHeight}
                    onChange={(e) =>
                      onFontsChange({ ...fonts, enabled: true, lineHeight: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700">Ketebalan Judul</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {fonts.headingWeight}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={800}
                    step={100}
                    value={fonts.headingWeight}
                    onChange={(e) =>
                      onFontsChange({
                        ...fonts,
                        enabled: true,
                        headingWeight: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700">Jarak Huruf (Tracking)</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {fonts.letterSpacing > 0 ? `+${fonts.letterSpacing}` : fonts.letterSpacing} em
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-0.03}
                    max={0.06}
                    step={0.01}
                    value={fonts.letterSpacing}
                    onChange={(e) =>
                      onFontsChange({
                        ...fonts,
                        enabled: true,
                        letterSpacing: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700">Kelengkungan Sudut Kartu</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {fonts.borderRadius} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={2}
                    value={fonts.borderRadius}
                    onChange={(e) =>
                      onFontsChange({
                        ...fonts,
                        enabled: true,
                        borderRadius: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              </div>
            </section>

            {/* Native XML <Variable type="font"> */}
            {fontVariables.length > 0 && (
              <section className="space-y-3 pt-4 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-800">
                  Variabel Font &lt;b:skin&gt; ({fontVariables.length})
                </div>
                <div className="space-y-3">
                  {fontVariables.map((v) => {
                    const currentVal = variableValues[v.name] ?? v.value;
                    const isModified = currentVal !== v.value;
                    return (
                      <div key={v.name} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-800 truncate">
                              {v.description || v.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              {v.name}
                            </div>
                          </div>
                          {isModified && (
                            <button
                              type="button"
                              onClick={() => onVariableChange(v.name, v.value)}
                              title={`Reset ke bawaan (${v.value})`}
                              className="text-[10px] text-slate-500 hover:text-slate-900 flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reset</span>
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <select
                            aria-label={`Pilih preset font ${v.name}`}
                            value={
                              FONT_OPTIONS.some((f) => currentVal.includes(f.name))
                                ? FONT_OPTIONS.find((f) => currentVal.includes(f.name))?.name || ''
                                : ''
                            }
                            onChange={(e) => {
                              const picked = FONT_OPTIONS.find((f) => f.name === e.target.value);
                              if (!picked) return;
                              const cssFontStack = `'${picked.name}', ${picked.category}`;
                              const sizePrefix = currentVal.match(/^(?:bold|normal|italic|\d+)\s+\d+px\s+/i)?.[0] || '';
                              onVariableChange(
                                v.name,
                                sizePrefix ? `${sizePrefix}${cssFontStack}` : `normal 400 15px ${cssFontStack}`
                              );
                            }}
                            className="w-32 shrink-0 px-2 py-1.5 text-[11px] bg-white border border-slate-200 rounded-lg text-slate-800"
                          >
                            <option value="">Preset Font...</option>
                            {FONT_OPTIONS.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) => onVariableChange(v.name, e.target.value)}
                            className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Native XML <Variable type="length"> */}
            {lengthVariables.length > 0 && (
              <section className="space-y-3 pt-4 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-800">
                  Variabel Ukuran &amp; Dimensi &lt;b:skin&gt; ({lengthVariables.length})
                </div>
                <div className="space-y-3">
                  {lengthVariables.map((v) => {
                    const currentVal = (variableValues[v.name] ?? v.value).trim();
                    const parsedNum = Number.parseFloat(currentVal);
                    const unitMatch = currentVal.match(/(px|em|rem|%)$/i);
                    const unit = unitMatch?.[1] || 'px';
                    const parsedMin = v.min ? Number.parseFloat(v.min) : Number.NaN;
                    const parsedMax = v.max ? Number.parseFloat(v.max) : Number.NaN;
                    const baseNum = Number.isFinite(parsedNum) ? parsedNum : 16;
                    const sliderMin = Number.isFinite(parsedMin)
                      ? parsedMin
                      : baseNum >= 300
                        ? 240
                        : 0;
                    const sliderMax = Number.isFinite(parsedMax)
                      ? parsedMax
                      : baseNum >= 600
                        ? 1600
                        : baseNum >= 200
                          ? 600
                          : Math.max(80, Math.round(baseNum * 2));
                    const step = unit === 'em' || unit === 'rem' ? 0.1 : 1;
                    const isModified = currentVal !== v.value.trim();

                    return (
                      <div key={v.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-800 truncate" title={v.name}>
                            {v.description || v.name}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isModified && (
                              <button
                                type="button"
                                onClick={() => onVariableChange(v.name, v.value)}
                                title={`Reset ke bawaan (${v.value})`}
                                className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                            <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-900">
                              {currentVal}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={sliderMin}
                            max={Math.max(sliderMin + step, sliderMax)}
                            step={step}
                            value={Math.min(
                              Math.max(sliderMin, baseNum),
                              Math.max(sliderMin + step, sliderMax)
                            )}
                            onChange={(e) => onVariableChange(v.name, `${e.target.value}${unit}`)}
                            aria-label={`Slider ${v.description || v.name}`}
                            className="flex-1 accent-blue-600 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) => onVariableChange(v.name, e.target.value)}
                            className="w-16 px-2 py-1 text-[11px] font-mono tabular-nums bg-slate-50 border border-slate-200 rounded text-slate-800"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === 'ai' && (
          <>
            {/* Hybrid AI Engine Selector + Open Chat AI */}
            <section className="space-y-2.5">
              <AiEngineSelectorCard
                offlineAi={offlineAi}
                isOfflineMode={appOfflineMode}
              />
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Buka Kolom Chat AI</span>
              </button>
            </section>

            {/* 1. AI Theme Designer */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Desainer Tema AI</span>
                <span className="text-[11px] text-slate-500">
                  {appOfflineMode || engineMode === 'local'
                    ? `${offlineAi.activeMeta.shortName} · 0 Kuota`
                    : `${activeGeminiMeta.shortLabel}`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Deskripsikan nuansa, industri, atau warna blog yang Anda bayangkan. AI akan mengatur palet, font, dan gaya CSS sekaligus.
              </p>
              <form onSubmit={handleAiGenerateTheme} className="space-y-2">
                <textarea
                  rows={3}
                  value={aiThemePrompt}
                  onChange={(e) => setAiThemePrompt(e.target.value)}
                  placeholder="Contoh: Majalah kuliner malam bergaya editorial hangat dengan teks gading dan aksen tembaga..."
                  className="w-full p-2.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-none"
                />
                <button
                  type="submit"
                  disabled={isGeneratingTheme || !aiThemePrompt.trim()}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isGeneratingTheme ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Merancang Tema...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Terapkan Desain Tema AI</span>
                    </>
                  )}
                </button>
              </form>
              {aiThemeFeedback && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 leading-relaxed">
                  {aiThemeFeedback}
                </div>
              )}
            </section>

            {/* 2. AI CSS Tweaker */}
            <section className="space-y-2.5 pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-900">Ubah Tata Letak &amp; CSS via AI</div>
              <form onSubmit={handleAiCustomCss} className="space-y-2">
                <input
                  type="text"
                  value={aiCssPrompt}
                  onChange={(e) => setAiCssPrompt(e.target.value)}
                  placeholder="Contoh: Buat bayangan kartu lembut dan tombol lebih tegas"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={isGeneratingCss || !aiCssPrompt.trim()}
                  className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isGeneratingCss ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Menulis CSS...</span>
                    </>
                  ) : (
                    <span>Ubah Gaya dengan AI</span>
                  )}
                </button>
              </form>
              {aiCssFeedback && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                  {aiCssFeedback}
                </div>
              )}
            </section>

            {/* 3. AI Sample Content Generator */}
            <section className="space-y-2.5 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                <span>Isi Artikel Pratinjau AI</span>
              </div>
              <form onSubmit={handleAiSampleContent} className="space-y-2">
                <input
                  type="text"
                  value={aiTopicPrompt}
                  onChange={(e) => setAiTopicPrompt(e.target.value)}
                  placeholder="Topik blog: mis. Otomotif Listrik, Resep Nusantara..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={isGeneratingContent || !aiTopicPrompt.trim()}
                  className="w-full py-2 px-4 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isGeneratingContent ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyusun Artikel...</span>
                    </>
                  ) : (
                    <span>Buat Konten Sampel Realistis</span>
                  )}
                </button>
              </form>
            </section>

            {/* 4. AI Template Diagnostics */}
            <section className="space-y-2.5 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                <span>Audit Template XML AI</span>
              </div>
              <button
                type="button"
                onClick={handleRunDiagnostics}
                disabled={isDiagnosing}
                className="w-full py-2 px-4 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isDiagnosing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Memeriksa Template...</span>
                  </>
                ) : (
                  <span>Periksa Responsivitas &amp; Kontras</span>
                )}
              </button>

              {diagnosticResult && (
                <div className="space-y-2.5 pt-1">
                  <p className="text-[11px] text-slate-700 leading-relaxed">
                    {diagnosticResult.summary}
                  </p>
                  <div className="space-y-2">
                    {diagnosticResult.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-900">
                            {item.title}
                          </span>
                          <span
                            className={`text-[10px] font-medium ${
                              item.severity === 'good'
                                ? 'text-emerald-700'
                                : item.severity === 'warning'
                                  ? 'text-amber-700'
                                  : 'text-blue-700'
                            }`}
                          >
                            {item.severity === 'good'
                              ? 'Baik'
                              : item.severity === 'warning'
                                ? 'Perlu Perhatian'
                                : 'Dapat Diperbaiki'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                  {diagnosticResult.suggestedCssFix && (
                    <button
                      type="button"
                      onClick={() => {
                        onCustomCssChange(
                          [customCss, diagnosticResult.suggestedCssFix].filter(Boolean).join('\n\n')
                        );
                        onNotify('Perbaikan CSS dari audit AI telah diterapkan.', 'success');
                      }}
                      className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Terapkan Perbaikan CSS Otomatis</span>
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {siteAdsense && (
          <AdsenseSlotRenderer
            slotKey="sidebarSlot"
            config={siteAdsense.config}
            shouldRenderLiveAds={siteAdsense.shouldRenderLiveAds}
            isAdmin={siteAdsense.isAdmin}
            className="pt-2 border-t border-slate-100"
          />
        )}
      </div>

      {onUpdateXml && (
        <TemplateIdentityModal
          isOpen={identityModalOpen}
          xml={xml}
          onClose={() => setIdentityModalOpen(false)}
          onSaveXml={(nextXml, id) => {
            onUpdateXml(
              nextXml,
              `Identitas template "${id.name || parsedInfo.templateTitle}"${id.version ? ` v${id.version}` : ''} diperbarui di XML.`
            );
          }}
        />
      )}
    </aside>
  );
};
