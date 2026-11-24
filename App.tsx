import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Download,
  Maximize2,
  Minimize2,
  MoreVertical,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  COLOR_PALETTE_PRESETS,
  DEFAULT_SAMPLE_BLOG,
  TEMPLATE_PRESETS,
} from './data/presets';
import {
  parseBloggerXml,
  compileBloggerPreviewHtml,
  downloadXmlFile,
  exportModifiedBloggerXml,
  getUtf8ByteLength,
} from './lib/bloggerCompiler';
import { validateBloggerXmlOffline } from './lib/xmlOfflineTools';
import { detectAiSignaturesInXml } from './lib/aiSignatureDetector';
import {
  LARGE_FILE_VALIDATION_THRESHOLD_BYTES,
  runIterativeAutoFixWorker,
  type WorkerProgressInfo,
} from './lib/xmlWorkerEngine';
import type {
  DevConsoleLevel,
  DevConsoleLogEntry,
  DevicePreset,
  FontCustomization,
  PreviewPageType,
  SampleBlogData,
  ThemePaletteOverrides,
} from './types/blogger';
import type {
  LiveBlogFingerprint,
  TemplateMatchComparison,
} from './lib/seoAndErrorAnalyzer';
import { SidebarControls, type SidebarTab } from './components/SidebarControls';
import { PreviewCanvas, type PreviewVisualMode } from './components/PreviewCanvas';
import { XmlEditorView } from './components/XmlEditorView';
import { VariableInspectorView } from './components/VariableInspectorView';
import { BloggerLayoutView } from './components/BloggerLayoutView';
import { SeoMonetizationView } from './components/SeoMonetizationView';
import { BloggerErrorAnalyzerView } from './components/BloggerErrorAnalyzerView';
import {
  UrlConsoleView,
  type PendingConsoleInjection,
} from './components/UrlConsoleView';
import { XmlSplitterMergerView } from './components/XmlSplitterMergerView';
import { ExportModal } from './components/ExportModal';
import { SnapshotHistoryDrawer } from './components/SnapshotHistoryDrawer';
import {
  clearAllXmlSnapshots,
  deleteXmlSnapshot,
  listXmlSnapshots,
  saveXmlSnapshot,
  type SnapshotCategory,
  type XmlSnapshotRecord,
} from './lib/snapshotStore';
import {
  OfflineIndicator,
  OfflineSyncReloadButton,
  OnlineOfflineToggle,
  PWAInstallButton,
} from './components/PWAControls';
import { OfflineAiRuntimeModal } from './components/OfflineAiRuntimeBar';
import { useOfflineAiRuntime } from './hooks/useOfflineAiRuntime';
import { useAppOfflineMode } from './hooks/usePWA';
import { AuthAndAiProvider, useAuthAndAi } from './contexts/AuthAndAiContext';
import { GoogleAccountButton } from './components/GoogleAccountButton';
import { AiChatDrawer } from './components/AiChatDrawer';
import { CloudNotepadDrawer } from './components/CloudNotepadDrawer';
import { useCloudNotepad } from './hooks/useCloudNotepad';
import { useSiteAdsense } from './hooks/useSiteAdsense';
import { AdminAdsensePanel } from './components/AdminAdsensePanel';
import { AdsenseSlotRenderer } from './components/AdsenseSlotRenderer';

type WorkspaceView =
  | 'preview'
  | 'layout'
  | 'seo'
  | 'errors'
  | 'editor'
  | 'splitter'
  | 'variables'
  | 'console';

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

const OFFLINE_STORAGE_KEY = 'temaloka_offline_workspace_v1';
const SHONA_IDENTITY_MIGRATED_KEY = 'temaloka_shona_identity_migrated_v1';

const DEFAULT_COLORS: ThemePaletteOverrides = {
  enabled: false,
  ...COLOR_PALETTE_PRESETS[0].palette,
};

const DEFAULT_FONTS: FontCustomization = {
  enabled: false,
  headingFont: 'Fraunces',
  bodyFont: 'DM Sans',
  monoFont: 'JetBrains Mono',
  baseFontSize: 16,
  lineHeight: 1.65,
  headingWeight: 700,
  letterSpacing: 0,
  borderRadius: 12,
};

interface SavedWorkspaceState {
  xmlSource?: string;
  initialUploadBytes?: number | null;
  activePresetId?: string | null;
  sourceLabel?: string;
  variableValues?: Record<string, string>;
  cssVarValues?: Record<string, string>;
  colorReplacements?: Record<string, string>;
  colors?: ThemePaletteOverrides;
  fonts?: FontCustomization;
  customCss?: string;
  userBlogVisualHtml?: string | null;
  userBlogVisualUrl?: string | null;
  sharedBlogUrl?: string;
}

function loadInitialWorkspace(): SavedWorkspaceState {
  try {
    const raw = localStorage.getItem(OFFLINE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedWorkspaceState;

    if (localStorage.getItem(SHONA_IDENTITY_MIGRATED_KEY) !== '1') {
      if (typeof parsed.xmlSource === 'string') {
        const legacyHeaderPattern =
          /Template Name:\s*Jurnal Aksara\s*\r?\nAuthor:\s*TemaLoka Presets/;
        if (legacyHeaderPattern.test(parsed.xmlSource)) {
          parsed.xmlSource = parsed.xmlSource.replace(
            legacyHeaderPattern,
            'Template Name: Shona Official\nAuthor: Shona Official\nURL: https://www.youtube.com/@ShonaOfficial'
          );
          localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(parsed));
        }
      }
      localStorage.setItem(SHONA_IDENTITY_MIGRATED_KEY, '1');
    }

    return parsed;
  } catch {
    return {};
  }
}

const WORKSPACE_TABS: Array<[WorkspaceView, string]> = [
  ['preview', 'Pratinjau'],
  ['layout', 'Tata Letak'],
  ['seo', 'SEO & Iklan'],
  ['errors', 'Diagnosa Error'],
  ['editor', 'Editor XML'],
  ['splitter', 'Splitter XML'],
  ['variables', 'Inspektor'],
  ['console', 'Konsol URL'],
];

export default function App() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <AuthAndAiProvider onNotify={notify}>
      <TemaLokaWorkspace toast={toast} setToast={setToast} notify={notify} />
    </AuthAndAiProvider>
  );
}

function TemaLokaWorkspace({
  toast,
  setToast,
  notify,
}: {
  toast: ToastState | null;
  setToast: React.Dispatch<React.SetStateAction<ToastState | null>>;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const initialPreset = TEMPLATE_PRESETS[0];
  const saved = useMemo(() => loadInitialWorkspace(), []);
  const { user, authReady, engineMode, quota, isChatOpen, setChatOpen, toggleChatOpen } =
    useAuthAndAi();

  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('preview');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('sumber');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreRef = useRef<HTMLDivElement>(null);

  const [xmlSource, setXmlSource] = useState<string>(saved.xmlSource || initialPreset.xml);
  const [initialUploadBytes, setInitialUploadBytes] = useState<number | null>(() =>
    saved.initialUploadBytes !== undefined
      ? saved.initialUploadBytes
      : getUtf8ByteLength(saved.xmlSource || initialPreset.xml)
  );
  const [activePresetId, setActivePresetId] = useState<string | null>(
    saved.activePresetId !== undefined ? saved.activePresetId : initialPreset.id
  );
  const [sourceLabel, setSourceLabel] = useState<string>(
    saved.sourceLabel || `Preset: ${initialPreset.name}`
  );

  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    saved.variableValues || {}
  );
  const [cssVarValues, setCssVarValues] = useState<Record<string, string>>(
    saved.cssVarValues || {}
  );
  const [colorReplacements, setColorReplacements] = useState<Record<string, string>>(
    saved.colorReplacements || {}
  );
  const [colors, setColors] = useState<ThemePaletteOverrides>(saved.colors || DEFAULT_COLORS);
  const [fonts, setFonts] = useState<FontCustomization>(saved.fonts || DEFAULT_FONTS);
  const [customCss, setCustomCss] = useState<string>(saved.customCss || '');

  const [device, setDevice] = useState<DevicePreset>('desktop');
  const [isLandscape, setIsLandscape] = useState(false);
  const [zoom, setZoom] = useState<'fit' | 1 | 0.75>('fit');
  const [pageType, setPageType] = useState<PreviewPageType>('index');
  const [activePostId, setActivePostId] = useState<string>(DEFAULT_SAMPLE_BLOG.posts[0].id);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sampleData, setSampleData] = useState<SampleBlogData>(DEFAULT_SAMPLE_BLOG);

  const [editorFocusLine, setEditorFocusLine] = useState<number | null>(null);
  const [userBlogVisualHtml, setUserBlogVisualHtml] = useState<string | null>(
    saved.userBlogVisualHtml || null
  );
  const [userBlogVisualUrl, setUserBlogVisualUrl] = useState<string | null>(
    saved.userBlogVisualUrl || null
  );
  const [sharedBlogUrl, setSharedBlogUrl] = useState<string>(
    saved.sharedBlogUrl ?? saved.userBlogVisualUrl ?? ''
  );
  const [liveBlogFingerprint, setLiveBlogFingerprint] = useState<LiveBlogFingerprint | null>(null);
  const [liveBlogComparison, setLiveBlogComparison] = useState<TemplateMatchComparison | null>(null);
  const [previewQueryParams, setPreviewQueryParams] = useState<Record<string, string>>({});
  const [previewConsoleLogs, setPreviewConsoleLogs] = useState<DevConsoleLogEntry[]>([]);
  const [pendingConsolePayload, setPendingConsolePayload] =
    useState<PendingConsoleInjection | null>(null);
  const [previewVisualMode, setPreviewVisualMode] = useState<PreviewVisualMode>('xml');
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<XmlSnapshotRecord[]>([]);
  const [snapshotDrawerOpen, setSnapshotDrawerOpen] = useState(false);
  const [notepadOpen, setNotepadOpen] = useState(false);
  const offlineAi = useOfflineAiRuntime();
  const { isOfflineMode, setOfflineMode } = useAppOfflineMode();
  const siteAdsense = useSiteAdsense(user, authReady, isOfflineMode);

  const checkAdminUrl = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return (
      params.has('admin') ||
      window.location.pathname === '/admin' ||
      window.location.hash === '#admin'
    );
  }, []);

  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => checkAdminUrl());

  useEffect(() => {
    const syncAdminRoute = () => setIsAdminRoute(checkAdminUrl());
    window.addEventListener('popstate', syncAdminRoute);
    window.addEventListener('hashchange', syncAdminRoute);
    return () => {
      window.removeEventListener('popstate', syncAdminRoute);
      window.removeEventListener('hashchange', syncAdminRoute);
    };
  }, [checkAdminUrl]);

  const openAdminRoute = useCallback(() => {
    setMobileMoreOpen(false);
    setMobileSidebarOpen(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.search = '?admin';
      url.hash = '';
      window.history.pushState({}, '', `${url.pathname}${url.search}`);
    }
    setIsAdminRoute(true);
  }, []);

  const closeAdminRoute = useCallback(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('admin');
      if (url.pathname === '/admin') url.pathname = '/';
      if (url.hash === '#admin') url.hash = '';
      window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setIsAdminRoute(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setMobileMoreOpen(false);
    setMobileSidebarOpen(false);
    setIsFullscreen((prev) => {
      const next = !prev;
      if (next) {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    const onOutsideMore = (e: MouseEvent) => {
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(e.target as Node)) {
        setMobileMoreOpen(false);
      }
    };
    if (mobileMoreOpen) {
      document.addEventListener('mousedown', onOutsideMore);
    }
    return () => document.removeEventListener('mousedown', onOutsideMore);
  }, [mobileMoreOpen]);

  const refreshSnapshots = useCallback(() => {
    listXmlSnapshots()
      .then((items) => setSnapshots(items))
      .catch(() => {});
  }, []);

  const recordSnapshot = useCallback(
    (
      xmlText: string,
      label: string,
      category: SnapshotCategory = 'auto',
      force = false
    ) => {
      if (!xmlText.trim()) return;
      void saveXmlSnapshot({ xml: xmlText, label, category, force })
        .then(() => refreshSnapshots())
        .catch(() => {});
    },
    [refreshSnapshots]
  );

  useEffect(() => {
    refreshSnapshots();
    recordSnapshot(
      xmlSource,
      `Awal Sesi (${sourceLabel})`,
      'auto',
      false
    );
    // Run once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitchToOnline = useCallback(() => {
    const res = setOfflineMode(false);
    if (!res.changed && res.reason === 'no-network') {
      notify(
        'Koneksi internet perangkat terputus. Hubungkan jaringan terlebih dahulu untuk masuk Mode Online.',
        'error'
      );
      return;
    }
    notify(
      'Mode Online aktif. Halaman dapat memuat font CDN, URL Blogspot langsung, dan sinkronisasi.',
      'success'
    );
  }, [notify, setOfflineMode]);

  const [debouncedXml, setDebouncedXml] = useState<string>(xmlSource);
  const [globalFixProgress, setGlobalFixProgress] = useState<WorkerProgressInfo | null>(null);
  const globalFixCancelRef = React.useRef<(() => void) | null>(null);

  useEffect(() => {
    if (xmlSource.length <= LARGE_FILE_VALIDATION_THRESHOLD_BYTES) {
      setDebouncedXml(xmlSource);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedXml(xmlSource);
    }, 750);
    return () => clearTimeout(timer);
  }, [xmlSource]);

  // Persist current workspace offline to localStorage (skip oversized >1.5MB XML to prevent freeze/quota overflow)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (xmlSource.length > 1_500_000) return;
        const payload: SavedWorkspaceState = {
          xmlSource,
          initialUploadBytes,
          activePresetId,
          sourceLabel,
          variableValues,
          cssVarValues,
          colorReplacements,
          colors,
          fonts,
          customCss,
          userBlogVisualUrl,
          sharedBlogUrl,
          userBlogVisualHtml:
            userBlogVisualHtml && userBlogVisualHtml.length < 350000 ? userBlogVisualHtml : null,
        };
        localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Ignore quota exceeded for oversized templates
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    xmlSource,
    initialUploadBytes,
    activePresetId,
    sourceLabel,
    variableValues,
    cssVarValues,
    colorReplacements,
    colors,
    fonts,
    customCss,
    userBlogVisualHtml,
    userBlogVisualUrl,
    sharedBlogUrl,
  ]);

  // Listen to interactive clicks & console output inside the sandboxed Blogspot preview iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;

      if (payload.source === 'temaloka-preview') {
        if (payload.action === 'home') {
          setPageType('index');
          setActiveCategory(null);
        } else if (payload.action === 'post' && payload.postId) {
          setActivePostId(payload.postId);
          setPageType('item');
        } else if (payload.action === 'category' && payload.category) {
          setActiveCategory(payload.category);
          setPageType('archive');
        } else if (payload.action === 'apply-query' && payload.params && typeof payload.params === 'object') {
          const nextMap: Record<string, string> = {};
          for (const [k, v] of Object.entries(payload.params as Record<string, unknown>)) {
            if (k && typeof v === 'string') nextMap[k] = v;
          }
          setPreviewQueryParams(nextMap);
          const qStr = new URLSearchParams(nextMap).toString();
          notify(
            qStr ? `Parameter URL (?${qStr}) diterapkan ke Pratinjau.` : 'Parameter URL pratinjau dikosongkan.',
            'info'
          );
        }
      } else if (payload.source === 'temaloka-preview-console' && typeof payload.message === 'string') {
        const rawLv = String(payload.level || 'log');
        const level: DevConsoleLevel =
          rawLv === 'error' || rawLv === 'warn' || rawLv === 'info' || rawLv === 'network'
            ? rawLv
            : 'log';
        const timeStr = new Date().toTimeString().slice(0, 8);
        setPreviewConsoleLogs((prev) => [
          ...prev.slice(-119),
          {
            id: `pv-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: timeStr,
            level,
            source: 'preview',
            title: payload.message,
            line: typeof payload.line === 'number' ? payload.line : null,
            url: typeof payload.url === 'string' ? payload.url : undefined,
          },
        ]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const isLargeTemplate = debouncedXml.length > LARGE_FILE_VALIDATION_THRESHOLD_BYTES;
  const parsedInfo = useMemo(
    () => parseBloggerXml(debouncedXml, { skipRedundancyAnalysis: isLargeTemplate }),
    [debouncedXml, isLargeTemplate]
  );
  const xmlValidation = useMemo(
    () => validateBloggerXmlOffline(debouncedXml),
    [debouncedXml]
  );

  const notepad = useCloudNotepad({
    activeTemplateTitle: parsedInfo.templateTitle,
    isOfflineMode,
  });

  const handleGlobalOfflineAutoFix = useCallback(() => {
    globalFixCancelRef.current?.();
    const job = runIterativeAutoFixWorker(
      xmlSource,
      (p) => setGlobalFixProgress(p),
      10
    );
    globalFixCancelRef.current = job.cancel;
    job.promise
      .then((result) => {
        globalFixCancelRef.current = null;
        setGlobalFixProgress(null);
        if (result.fixesApplied.length === 0 && result.fixedXml === xmlSource) {
          notify(
            result.domParserValid
              ? 'XML sudah valid (DOMParser "text/xml"): tidak ada perbaikan tambahan yang diperlukan.'
              : 'Auto-Fix selesai. Periksa detail error di tab Editor XML.',
            result.domParserValid ? 'success' : 'info'
          );
          return;
        }
        recordSnapshot(xmlSource, 'Sebelum Auto-Fix XML', 'autofix', false);
        setXmlSource(result.fixedXml);
        recordSnapshot(
          result.fixedXml,
          `Setelah Auto-Fix (${result.fixesApplied.length} perbaikan)`,
          'autofix',
          false
        );
        notify(
          `Auto-Fix Web Worker (${result.roundsExecuted} putaran) menerapkan ${result.fixesApplied.length} perbaikan${result.domParserValid ? ' · XML Valid!' : ''}.`,
          result.domParserValid ? 'success' : 'info'
        );
      })
      .catch((err) => {
        globalFixCancelRef.current = null;
        setGlobalFixProgress(null);
        notify(err instanceof Error ? err.message : 'Auto-Fix dibatalkan/gagal.', 'error');
      });
  }, [xmlSource, notify, recordSnapshot]);

  const handleLoadXmlContent = useCallback(
    (
      xml: string,
      label: string,
      presetId: string | null = null,
      originalBytes: number | null = null
    ) => {
      setXmlSource(xml);
      setInitialUploadBytes(originalBytes ?? getUtf8ByteLength(xml));
      setSourceLabel(label);
      setActivePresetId(presetId);
      setVariableValues({});
      setCssVarValues({});
      setColorReplacements({});
      setColors(DEFAULT_COLORS);
      setFonts(DEFAULT_FONTS);
      setCustomCss('');
      setPreviewQueryParams({});
      setPageType('index');
      setActiveCategory(null);
      recordSnapshot(xml, `Muat Template: ${label}`, 'import', false);
    },
    [recordSnapshot]
  );

  const handleSelectPreset = useCallback(
    (presetId: string) => {
      const found = TEMPLATE_PRESETS.find((p) => p.id === presetId);
      if (!found) return;
      handleLoadXmlContent(found.xml, `Preset: ${found.name}`, found.id);
      notify(`Template "${found.name}" dimuat ke pratinjau.`, 'success');
    },
    [handleLoadXmlContent, notify]
  );

  const handleVariableChange = useCallback((name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleResetVariable = useCallback((name: string, defaultValue: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: defaultValue }));
  }, []);

  const handleCssVarChange = useCallback((key: string, value: string) => {
    setCssVarValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleResetCssVar = useCallback((key: string) => {
    setCssVarValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleColorReplace = useCallback((oldHex: string, newHex: string) => {
    setColorReplacements((prev) => ({ ...prev, [oldHex]: newHex }));
  }, []);

  const handleResetColorReplace = useCallback((oldHex: string) => {
    setColorReplacements((prev) => {
      const next = { ...prev };
      delete next[oldHex];
      return next;
    });
  }, []);

  const handleResetCustomizations = useCallback(() => {
    setVariableValues({});
    setCssVarValues({});
    setColorReplacements({});
    setColors(DEFAULT_COLORS);
    setFonts(DEFAULT_FONTS);
    setCustomCss('');
    notify('Semua penyesuaian warna, font, dan CSS dikembalikan ke bawaan XML.', 'info');
  }, [notify]);

  const handleDirectXmlUpdate = useCallback(
    (nextXml: string, feedbackMessage: string) => {
      if (nextXml !== xmlSource) {
        const lower = feedbackMessage.toLowerCase();
        const category: SnapshotCategory = lower.includes('svg') || lower.includes('pembersih') || lower.includes('minify') || lower.includes('css')
          ? 'cleaner'
          : lower.includes('section') || lower.includes('widget')
            ? 'layout'
            : lower.includes('auto-fix')
              ? 'autofix'
              : 'auto';
        recordSnapshot(nextXml, feedbackMessage.slice(0, 80), category, false);
      }
      setXmlSource(nextXml);
      notify(feedbackMessage, 'success');
    },
    [notify, recordSnapshot, xmlSource]
  );

  const handleSaveOverwriteAndDownload = useCallback(
    async (
      overrideBaseXml?: string,
      options?: { download?: boolean; feedbackMessage?: string }
    ) => {
      const baseXml = overrideBaseXml ?? xmlSource;
      const { exportedXml } = exportModifiedBloggerXml(
        baseXml,
        variableValues,
        colors,
        fonts,
        customCss,
        {
          cssVarValues,
          colorReplacements,
          minimalExport: false,
          initialUploadBytes,
        }
      );

      setXmlSource(exportedXml);
      setInitialUploadBytes(getUtf8ByteLength(exportedXml));
      setActivePresetId(null);
      setVariableValues({});
      setCssVarValues({});
      setColorReplacements({});
      setColors(DEFAULT_COLORS);
      setFonts(DEFAULT_FONTS);
      setCustomCss('');
      recordSnapshot(exportedXml, 'Simpan & Timpa Template XML', 'editor', false);

      const shouldDownload = options?.download !== false;
      let downloadedFilename = '';
      let downloadCancelled = false;
      if (shouldDownload) {
        const reparsedTitle =
          parseBloggerXml(exportedXml).templateTitle || parsedInfo.templateTitle;
        const dlRes = await downloadXmlFile(exportedXml, reparsedTitle);
        downloadedFilename = dlRes.filename;
        downloadCancelled = dlRes.method === 'cancelled';
      }

      notify(
        options?.feedbackMessage ||
          (shouldDownload
            ? downloadCancelled
              ? 'Template XML utuh disimpan di editor. Penyimpanan file ke perangkat dibatalkan.'
              : `Template XML utuh berhasil ditimpa, disimpan, dan diunduh (${downloadedFilename}).`
            : 'Template XML aktif berhasil disimpan & ditimpa secara utuh.'),
        downloadCancelled ? 'info' : 'success'
      );
    },
    [
      xmlSource,
      variableValues,
      colors,
      fonts,
      customCss,
      cssVarValues,
      colorReplacements,
      initialUploadBytes,
      parsedInfo.templateTitle,
      notify,
      recordSnapshot,
    ]
  );

  const handleOverwriteBakedXml = useCallback(
    async (bakedXml: string, downloadAfter = false) => {
      setXmlSource(bakedXml);
      setInitialUploadBytes(getUtf8ByteLength(bakedXml));
      setActivePresetId(null);
      setVariableValues({});
      setCssVarValues({});
      setColorReplacements({});
      setColors(DEFAULT_COLORS);
      setFonts(DEFAULT_FONTS);
      setCustomCss('');
      recordSnapshot(bakedXml, 'Timpa Permanen dari Ekspor XML', 'auto', false);

      if (downloadAfter) {
        const reparsedTitle =
          parseBloggerXml(bakedXml).templateTitle || parsedInfo.templateTitle;
        const dlRes = await downloadXmlFile(bakedXml, reparsedTitle);
        if (dlRes.method === 'cancelled') {
          notify('Template XML utuh disimpan, penyimpanan file dibatalkan.', 'info');
        } else {
          notify(
            `Template XML utuh ditimpa secara permanen & diunduh (${dlRes.filename}).`,
            'success'
          );
        }
      } else {
        notify('Template XML aktif berhasil ditimpa secara utuh dengan hasil ekspor.', 'success');
      }
    },
    [parsedInfo.templateTitle, notify, recordSnapshot]
  );

  const handleJumpToEditorLine = useCallback((line?: number | null) => {
    setEditorFocusLine(line ?? 1);
    setWorkspaceView('editor');
  }, []);

  const handleSetUserBlogVisual = useCallback(
    (url: string, visualHtml: string, switchMode?: PreviewVisualMode) => {
      setUserBlogVisualUrl(url);
      setUserBlogVisualHtml(visualHtml);
      if (switchMode) {
        setPreviewVisualMode(switchMode);
        setWorkspaceView('preview');
      }
    },
    []
  );

  const handleBlogFingerprintFetched = useCallback(
    (
      url: string,
      fingerprint: LiveBlogFingerprint,
      comparison: TemplateMatchComparison,
      visualHtml?: string | null
    ) => {
      setSharedBlogUrl(url);
      setLiveBlogFingerprint(fingerprint);
      setLiveBlogComparison(comparison);
      if (visualHtml) {
        setUserBlogVisualUrl(url);
        setUserBlogVisualHtml(visualHtml);
      }
    },
    []
  );

  const hasCustomizations =
    colors.enabled ||
    fonts.enabled ||
    customCss.trim().length > 0 ||
    Object.keys(variableValues).length > 0 ||
    Object.keys(cssVarValues).length > 0 ||
    Object.keys(colorReplacements).length > 0;

  const currentXmlBytes = useMemo(() => getUtf8ByteLength(xmlSource), [xmlSource]);

  const activeAiSignatureSummary = useMemo(
    () => detectAiSignaturesInXml(xmlSource),
    [xmlSource]
  );

  const handleApplyPreviewQueryParams = useCallback(
    (nextParams: Record<string, string>, openPreview = false) => {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(nextParams)) {
        const key = k.trim();
        if (key) cleaned[key] = v;
      }
      setPreviewQueryParams(cleaned);
      if (openPreview) {
        setPreviewVisualMode('xml');
        setWorkspaceView('preview');
      }
      const qStr = new URLSearchParams(cleaned).toString();
      notify(
        qStr
          ? `Parameter uji (?${qStr}) diterapkan ke Pratinjau XML.`
          : 'Parameter URL pratinjau dikembalikan ke bawaan.',
        'success'
      );
    },
    [notify]
  );

  const handleResetPreviewQueryParams = useCallback(() => {
    setPreviewQueryParams({});
    notify('Semua parameter query pratinjau di-reset ke bawaan.', 'info');
  }, [notify]);

  const compiledHtml = useMemo(() => {
    if (workspaceView !== 'preview') return '';
    return compileBloggerPreviewHtml({
      xml: xmlSource,
      variableValues,
      cssVarValues,
      colorReplacements,
      parsedInfo,
      colors,
      fonts,
      customCss,
      sampleData,
      pageType,
      activePostId,
      activeCategory,
      device,
      offlineMode: isOfflineMode,
      previewQueryParams,
    });
  }, [
    workspaceView,
    xmlSource,
    variableValues,
    cssVarValues,
    colorReplacements,
    parsedInfo,
    colors,
    fonts,
    customCss,
    sampleData,
    pageType,
    activePostId,
    activeCategory,
    device,
    isOfflineMode,
    previewQueryParams,
  ]);

  const siteAdsenseSlotProps = useMemo(
    () => ({
      config: siteAdsense.config,
      shouldRenderLiveAds: siteAdsense.shouldRenderLiveAds,
      isAdmin: siteAdsense.isAdmin,
    }),
    [siteAdsense.config, siteAdsense.shouldRenderLiveAds, siteAdsense.isAdmin]
  );

  const showTopBannerWrapper = useMemo(() => {
    const cfg = siteAdsense.config;
    if (!cfg.adsenseEnabled || !cfg.topBannerEnabled || !cfg.publisherId) return false;
    if (cfg.hideAdsForAdmin && siteAdsense.isAdmin) return true;
    return siteAdsense.shouldRenderLiveAds && Boolean(cfg.topBannerSlot);
  }, [siteAdsense.config, siteAdsense.isAdmin, siteAdsense.shouldRenderLiveAds]);

  if (isAdminRoute) {
    return (
      <>
        <AdminAdsensePanel
          siteAdsense={siteAdsense}
          xml={xmlSource}
          parsedInfo={parsedInfo}
          onUpdateXml={handleDirectXmlUpdate}
          onExitAdmin={closeAdminRoute}
          onNotify={notify}
        />

        {toast && (
          <div
            role="status"
            className={`fixed bottom-4 right-4 z-50 max-w-sm px-4 py-3 rounded-lg border shadow-md flex items-center justify-between gap-3 text-xs font-medium ${
              toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : toast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Tutup notifikasi"
              className="text-current opacity-60 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Top Bar: Responsive 3-Zone Contract (Hidden in Fullscreen) */}
      {!isFullscreen && (
        <header className="h-13 lg:h-14 shrink-0 bg-white border-b border-slate-200 px-2.5 sm:px-5 flex items-center justify-between gap-1.5 sm:gap-3">
          {/* Zone 1: Brand Wordmark + Desktop Sidebar Hide/Show Toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                setWorkspaceView('preview');
              }}
              className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            >
              TemaLoka
            </a>

            <button
              type="button"
              onClick={() => setSidebarHidden((v) => !v)}
              title={
                sidebarHidden
                  ? 'Tampilkan Panel Kiri Kustomisasi'
                  : 'Sembunyikan Panel Kiri agar area kerja lebih luas'
              }
              aria-label={sidebarHidden ? 'Tampilkan panel kiri' : 'Sembunyikan panel kiri'}
              className={`hidden lg:inline-flex items-center justify-center p-1.5 rounded-lg border transition-colors cursor-pointer ${
                sidebarHidden
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {sidebarHidden ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Zone 2: Desktop Single-Line Workspace Navigation */}
          <nav className="hidden lg:flex items-center gap-4 xl:gap-5 text-xs xl:text-sm font-medium overflow-x-auto no-scrollbar">
            {WORKSPACE_TABS.map(([view, label]) => {
              const active = workspaceView === view;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => setWorkspaceView(view)}
                  className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-blue-600 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                  {view === 'variables' &&
                    activeAiSignatureSummary.highConfidenceCount > 0 && (
                      <span
                        title={`${activeAiSignatureSummary.highConfidenceCount} AI Signature terdeteksi otomatis`}
                        className="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded tabular-nums"
                      >
                        AI {activeAiSignatureSummary.findings.length}
                      </span>
                    )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Responsive Account/Limit + Chat AI + Fullscreen + Tools + Export */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <GoogleAccountButton isOfflineMode={isOfflineMode} />

            {siteAdsense.isAdmin && (
              <button
                type="button"
                onClick={openAdminRoute}
                title="Buka Panel Admin AdSense (/?admin)"
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Admin AdSense</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setNotepadOpen((v) => !v)}
              title="Buka Notepad Akun (Simpan di Cloud)"
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                notepadOpen
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <NotebookPen className="w-3.5 h-3.5 shrink-0" />
              <span>Notepad</span>
              {notepad.dirtyCount > 0 ? (
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-amber-100 text-amber-900 border border-amber-200 tabular-nums">
                  {notepad.dirtyCount}
                </span>
              ) : notepad.cloudCount > 0 ? (
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-slate-100 text-slate-700 tabular-nums">
                  {notepad.cloudCount}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={toggleChatOpen}
              title="Buka / Tutup Kolom Chat AI"
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 min-h-[38px] sm:min-h-[34px] text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isChatOpen
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
              }`}
            >
              <Bot className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Chat AI</span>
              <span className="sm:hidden">AI</span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title="Mode Layar Penuh (Fullscreen) untuk Desktop & Smartphone"
              aria-label="Aktifkan Layar Penuh"
              className="flex items-center justify-center gap-1 px-2 sm:px-2.5 py-1.5 min-h-[38px] min-w-[38px] sm:min-h-[34px] text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors shrink-0 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Layar Penuh</span>
            </button>

            {/* Desktop Full Action Controls */}
            <div className="hidden md:flex items-center gap-1.5 sm:gap-2">
              <OnlineOfflineToggle onNotify={notify} />
              <OfflineSyncReloadButton onNotify={notify} />
              <PWAInstallButton />
            </div>

            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              title="Buka Panel Kustomisasi & Alat"
              className="lg:hidden flex items-center gap-1 px-2 sm:px-2.5 py-1.5 min-h-[38px] sm:min-h-[34px] text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Alat</span>
            </button>

            {/* Desktop Export CTA */}
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              className="hidden md:flex items-center gap-1.5 px-3 sm:px-4 py-1.5 min-h-[34px] text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ekspor Tema XML</span>
            </button>

            {/* Smartphone Compact Overflow Menu (Export + Limit Info + Online/Offline + PWA) */}
            <div ref={mobileMoreRef} className="md:hidden relative shrink-0">
              <button
                type="button"
                onClick={() => setMobileMoreOpen((v) => !v)}
                aria-label="Menu Lainnya & Ekspor"
                aria-expanded={mobileMoreOpen}
                className="flex items-center justify-center min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {mobileMoreOpen && (
                <div className="fixed left-3 right-3 top-14 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3.5 space-y-3 text-xs">
                  {/* Explicit Limit & Engine Summary */}
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900">Info Limit &amp; Mesin AI</div>
                      <div className="text-[11px] text-slate-600 font-mono tabular-nums mt-0.5">
                        {isOfflineMode || engineMode === 'local'
                          ? 'AI Lokal Aktif · Tanpa Limit (0 Kuota)'
                          : user
                            ? `Gemini · Sisa ${quota.remaining}/${quota.dailyLimit} hari ini`
                            : `Gemini · Limit ${quota.dailyLimit}/hari (Masuk Google)`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMoreOpen(false);
                        offlineAi.openSettings();
                      }}
                      className="flex items-center gap-1 px-2.5 py-2 min-h-[36px] rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-800 shrink-0 cursor-pointer"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      <span>Pilih Mesin</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setNotepadOpen(true);
                    }}
                    className="w-full flex items-center justify-between gap-2 py-2.5 min-h-[42px] px-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <NotebookPen className="w-4 h-4" />
                      <span>Notepad Akun (Simpan Cloud)</span>
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-700 text-slate-100 tabular-nums">
                      {notepad.cloudCount} Cloud · {notepad.dirtyCount} Draft
                    </span>
                  </button>

                  {siteAdsense.isAdmin && (
                    <button
                      type="button"
                      onClick={openAdminRoute}
                      className="w-full flex items-center justify-between gap-2 py-2.5 min-h-[42px] px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 font-semibold rounded-lg cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-700" />
                        <span>Panel Admin AdSense (/?admin)</span>
                      </span>
                      <span className="text-[11px] font-mono text-emerald-700">Kelola</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setExportModalOpen(true);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 min-h-[42px] px-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Ekspor Tema XML</span>
                  </button>

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                    <OnlineOfflineToggle onNotify={notify} />
                    <OfflineSyncReloadButton onNotify={notify} />
                    <PWAInstallButton />
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Mobile & Tablet Horizontally Scrollable Workspace Switcher Strip (Hidden in Fullscreen) */}
      {!isFullscreen && (
        <div className="lg:hidden bg-white border-b border-slate-200 px-3 py-1 flex items-center gap-4 text-xs font-medium overflow-x-auto no-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => setNotepadOpen(true)}
            className={`whitespace-nowrap shrink-0 py-1 px-2 rounded-md border flex items-center gap-1 cursor-pointer ${
              notepadOpen
                ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                : 'bg-slate-50 text-slate-800 border-slate-200'
            }`}
          >
            <NotebookPen className="w-3.5 h-3.5" />
            <span>Notepad</span>
            {notepad.dirtyCount > 0 && (
              <span className="px-1 text-[10px] font-mono rounded bg-amber-100 text-amber-900 tabular-nums">
                {notepad.dirtyCount}
              </span>
            )}
          </button>

          {WORKSPACE_TABS.map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => setWorkspaceView(view)}
              className={`whitespace-nowrap shrink-0 py-1.5 border-b-2 cursor-pointer ${
                workspaceView === view
                  ? 'border-blue-600 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600'
              }`}
            >
              {label}
              {view === 'variables' &&
                activeAiSignatureSummary.highConfidenceCount > 0 && (
                  <span className="ml-1 px-1 py-0.5 text-[10px] font-mono font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded tabular-nums">
                    AI {activeAiSignatureSummary.findings.length}
                  </span>
                )}
            </button>
          ))}
        </div>
      )}

      {!isFullscreen && showTopBannerWrapper && (
        <div className="bg-white border-b border-slate-200 px-3 py-1.5 shrink-0">
          <div className="max-w-5xl mx-auto">
            <AdsenseSlotRenderer
              slotKey="topBanner"
              config={siteAdsenseSlotProps.config}
              shouldRenderLiveAds={siteAdsenseSlotProps.shouldRenderLiveAds}
              isAdmin={siteAdsenseSlotProps.isAdmin}
            />
          </div>
        </div>
      )}

      {/* Main Studio Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Desktop Sidebar (Hideable via sidebarHidden or isFullscreen) */}
        {!sidebarHidden && !isFullscreen && (
          <div className="hidden lg:flex h-full">
            <SidebarControls
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              xml={xmlSource}
              activePresetId={activePresetId}
              sourceLabel={sourceLabel}
              parsedInfo={parsedInfo}
              variableValues={variableValues}
              onVariableChange={handleVariableChange}
              colors={colors}
              onColorsChange={setColors}
              fonts={fonts}
              onFontsChange={setFonts}
              customCss={customCss}
              onCustomCssChange={setCustomCss}
              onSelectPreset={handleSelectPreset}
              onLoadXmlContent={handleLoadXmlContent}
              cssVarValues={cssVarValues}
              onCssVarChange={handleCssVarChange}
              sampleData={sampleData}
              onSampleDataChange={setSampleData}
              xmlIssuesCount={xmlValidation.issues.length}
              onAutoFixOffline={handleGlobalOfflineAutoFix}
              onOpenEditor={() => setWorkspaceView('editor')}
              onSetUserBlogVisual={handleSetUserBlogVisual}
              onOpenPreview={() => setWorkspaceView('preview')}
              offlineAi={offlineAi}
              isOfflineMode={isOfflineMode}
              onSwitchToOnline={handleSwitchToOnline}
              onUpdateXml={handleDirectXmlUpdate}
              onOpenSnapshots={() => setSnapshotDrawerOpen(true)}
              snapshotCount={snapshots.length}
              onOpenSplitter={() => setWorkspaceView('splitter')}
              sharedBlogUrl={sharedBlogUrl}
              onSharedBlogUrlChange={setSharedBlogUrl}
              onBlogFingerprintFetched={handleBlogFingerprintFetched}
              onNotify={notify}
              siteAdsense={siteAdsenseSlotProps}
            />
          </div>
        )}

        {/* Mobile / Tablet / Fullscreen Overlay Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div className={`${isFullscreen ? '' : 'lg:hidden'} fixed inset-0 z-40 flex`}>
            <div
              className="fixed inset-0 bg-slate-900/40"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="relative z-50 w-[340px] max-w-[92vw] h-full bg-white shadow-xl flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Panel Kustomisasi</span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  aria-label="Tutup panel"
                  className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <SidebarControls
                  activeTab={sidebarTab}
                  onTabChange={setSidebarTab}
                  xml={xmlSource}
                  activePresetId={activePresetId}
                  sourceLabel={sourceLabel}
                  parsedInfo={parsedInfo}
                  variableValues={variableValues}
                  onVariableChange={handleVariableChange}
                  colors={colors}
                  onColorsChange={setColors}
                  fonts={fonts}
                  onFontsChange={setFonts}
                  customCss={customCss}
                  onCustomCssChange={setCustomCss}
                  onSelectPreset={(id) => {
                    handleSelectPreset(id);
                    setMobileSidebarOpen(false);
                  }}
                  onLoadXmlContent={(xml, label, id, bytes) => {
                    handleLoadXmlContent(xml, label, id, bytes);
                    setMobileSidebarOpen(false);
                  }}
                  cssVarValues={cssVarValues}
                  onCssVarChange={handleCssVarChange}
                  sampleData={sampleData}
                  onSampleDataChange={setSampleData}
                  xmlIssuesCount={xmlValidation.issues.length}
                  onAutoFixOffline={() => {
                    handleGlobalOfflineAutoFix();
                    setMobileSidebarOpen(false);
                  }}
                  onOpenEditor={() => {
                    setWorkspaceView('editor');
                    setMobileSidebarOpen(false);
                  }}
                  onSetUserBlogVisual={handleSetUserBlogVisual}
                  onOpenPreview={() => {
                    setWorkspaceView('preview');
                    setMobileSidebarOpen(false);
                  }}
                  offlineAi={offlineAi}
                  isOfflineMode={isOfflineMode}
                  onSwitchToOnline={handleSwitchToOnline}
                  onUpdateXml={handleDirectXmlUpdate}
                  onOpenSnapshots={() => {
                    setSnapshotDrawerOpen(true);
                    setMobileSidebarOpen(false);
                  }}
                  snapshotCount={snapshots.length}
                  onOpenSplitter={() => {
                    setWorkspaceView('splitter');
                    setMobileSidebarOpen(false);
                  }}
                  sharedBlogUrl={sharedBlogUrl}
                  onSharedBlogUrlChange={setSharedBlogUrl}
                  onBlogFingerprintFetched={handleBlogFingerprintFetched}
                  onNotify={notify}
                  siteAdsense={siteAdsenseSlotProps}
                />
              </div>
            </div>
          </div>
        )}

        {/* Active Center Viewport */}
        {workspaceView === 'preview' && (
          <PreviewCanvas
            compiledHtml={compiledHtml}
            xml={xmlSource}
            parsedInfo={parsedInfo}
            offlineAi={offlineAi}
            onApplySuggestedCss={(suggested) => {
              if (!suggested.trim()) return;
              setCustomCss((prev) => [prev, suggested].filter(Boolean).join('\n\n'));
              notify('Saran CSS responsif dari AI Offline diterapkan ke pratinjau.', 'success');
            }}
            userBlogVisualHtml={userBlogVisualHtml}
            userBlogVisualUrl={userBlogVisualUrl}
            visualMode={previewVisualMode}
            onVisualModeChange={setPreviewVisualMode}
            onClearUserBlogVisual={() => {
              setUserBlogVisualHtml(null);
              setUserBlogVisualUrl(null);
              setPreviewVisualMode('xml');
            }}
            device={device}
            onDeviceChange={setDevice}
            isLandscape={isLandscape}
            onToggleLandscape={() => setIsLandscape((v) => !v)}
            pageType={pageType}
            onPageTypeChange={setPageType}
            activeCategory={activeCategory}
            onClearCategory={() => setActiveCategory(null)}
            zoom={zoom}
            onZoomChange={setZoom}
            hasCustomizations={hasCustomizations}
            onResetCustomizations={handleResetCustomizations}
            isOfflineMode={isOfflineMode}
            activePresetId={activePresetId}
            sourceLabel={sourceLabel}
            onLoadXmlContent={handleLoadXmlContent}
            previewQueryParams={previewQueryParams}
            onApplyPreviewQueryParams={handleApplyPreviewQueryParams}
            onResetPreviewQueryParams={handleResetPreviewQueryParams}
            onNotify={notify}
          />
        )}

        {workspaceView === 'layout' && (
          <BloggerLayoutView
            xml={xmlSource}
            parsedInfo={parsedInfo}
            offlineAi={offlineAi}
            onUpdateXml={handleDirectXmlUpdate}
            onSaveOverwriteAndDownload={(nextXml) =>
              handleSaveOverwriteAndDownload(nextXml, { download: true })
            }
            onOpenInspectorWidgets={() => setWorkspaceView('variables')}
          />
        )}

        {workspaceView === 'seo' && (
          <SeoMonetizationView
            xml={xmlSource}
            parsedInfo={parsedInfo}
            offlineAi={offlineAi}
            onUpdateXml={handleDirectXmlUpdate}
            isOfflineMode={isOfflineMode}
            onSwitchToOnline={handleSwitchToOnline}
            initialBlogUrl={sharedBlogUrl || userBlogVisualUrl}
            onNotify={notify}
            defaultAdsensePubId={
              siteAdsense.config.defaultTemplatePubId || siteAdsense.config.publisherId
            }
            siteAdsense={siteAdsenseSlotProps}
          />
        )}

        {workspaceView === 'errors' && (
          <BloggerErrorAnalyzerView
            xml={xmlSource}
            parsedInfo={parsedInfo}
            offlineAi={offlineAi}
            onUpdateXml={handleDirectXmlUpdate}
            onJumpToEditorLine={handleJumpToEditorLine}
          />
        )}

        {workspaceView === 'editor' && (
          <XmlEditorView
            xml={xmlSource}
            customCss={customCss}
            parsedInfo={parsedInfo}
            offlineAi={offlineAi}
            focusLine={editorFocusLine}
            onApplyXml={(nextXml) => {
              setXmlSource(nextXml);
              setActivePresetId(null);
              setSourceLabel('Editor XML Manual');
              recordSnapshot(nextXml, 'Perubahan Editor XML', 'editor', false);
            }}
            onSaveOverwriteAndDownload={(editedXml) =>
              handleSaveOverwriteAndDownload(editedXml, { download: true })
            }
            onCustomCssChange={setCustomCss}
            onNotify={notify}
            onSendToUrlConsole={(item) => {
              setPendingConsolePayload({
                id: Date.now(),
                payload: item.payload,
                kind: item.kind,
                runNow: item.runNow,
              });
              setWorkspaceView('console');
            }}
            onOpenSnapshots={() => setSnapshotDrawerOpen(true)}
            snapshotCount={snapshots.length}
            previewQueryParams={previewQueryParams}
            onApplyPreviewQueryParams={handleApplyPreviewQueryParams}
            onResetPreviewQueryParams={handleResetPreviewQueryParams}
          />
        )}

        {workspaceView === 'variables' && (
          <VariableInspectorView
            xml={xmlSource}
            parsedInfo={parsedInfo}
            variableValues={variableValues}
            onVariableChange={handleVariableChange}
            onResetVariable={handleResetVariable}
            cssVarValues={cssVarValues}
            onCssVarChange={handleCssVarChange}
            onResetCssVar={handleResetCssVar}
            colorReplacements={colorReplacements}
            onColorReplace={handleColorReplace}
            onResetColorReplace={handleResetColorReplace}
            onUpdateXml={handleDirectXmlUpdate}
            onOpenXmlEditor={() => setWorkspaceView('editor')}
            onJumpToEditorLine={handleJumpToEditorLine}
            offlineAi={offlineAi}
            activePresetId={activePresetId}
            sourceLabel={sourceLabel}
            onLoadXmlContent={handleLoadXmlContent}
            isOfflineMode={isOfflineMode}
            onNotify={notify}
          />
        )}

        {workspaceView === 'splitter' && (
          <XmlSplitterMergerView
            xml={xmlSource}
            sourceLabel={sourceLabel}
            parsedInfo={parsedInfo}
            offlineAi={offlineAi}
            onApplyMergedXml={(nextXml, label, openView) => {
              handleLoadXmlContent(nextXml, label, null);
              setWorkspaceView(openView || 'preview');
              notify(
                `Hasil penggabungan XML dimuat ke ${openView === 'editor' ? 'Editor XML' : 'Pratinjau'}.`,
                'success'
              );
            }}
            onNotify={notify}
          />
        )}

        {workspaceView === 'console' && (
          <UrlConsoleView
            xml={xmlSource}
            parsedInfo={parsedInfo}
            sharedBlogUrl={sharedBlogUrl}
            onSharedBlogUrlChange={setSharedBlogUrl}
            liveFingerprint={liveBlogFingerprint}
            comparisonResult={liveBlogComparison}
            userBlogVisualHtml={userBlogVisualHtml}
            onBlogFingerprintFetched={handleBlogFingerprintFetched}
            onOpenUserBlogPreview={() => {
              if (userBlogVisualHtml) {
                setPreviewVisualMode('user-site');
                setWorkspaceView('preview');
              }
            }}
            previewConsoleLogs={previewConsoleLogs}
            onClearPreviewLogs={() => setPreviewConsoleLogs([])}
            pendingConsolePayload={pendingConsolePayload}
            onConsumePendingConsolePayload={() => setPendingConsolePayload(null)}
            isOfflineMode={isOfflineMode}
            onSwitchToOnline={handleSwitchToOnline}
            onJumpToEditorLine={handleJumpToEditorLine}
            previewQueryParams={previewQueryParams}
            onApplyPreviewQueryParams={handleApplyPreviewQueryParams}
            onResetPreviewQueryParams={handleResetPreviewQueryParams}
            offlineAi={offlineAi}
            onNotify={notify}
          />
        )}

        {/* Right Docked / Fullscreen-Safe AI Chat Column */}
        <AiChatDrawer
          isOpen={isChatOpen}
          onClose={() => setChatOpen(false)}
          activePage={
            workspaceView === 'variables' ? 'inspector' : workspaceView
          }
          xml={xmlSource}
          parsedInfo={parsedInfo}
          offlineAi={offlineAi}
          isOfflineMode={isOfflineMode}
          xmlIssuesCount={xmlValidation.issues.length}
          aiSignaturesCount={activeAiSignatureSummary.findings.length}
          onApplySuggestedCss={(suggested) => {
            if (!suggested.trim()) return;
            setCustomCss((prev) => [prev, suggested].filter(Boolean).join('\n\n'));
            notify('Saran CSS dari Chat AI diterapkan ke pratinjau.', 'success');
          }}
          onNotify={notify}
        />

        {/* Floating Quick Control Bar while in Fullscreen Mode */}
        {isFullscreen && !isChatOpen && !notepadOpen && (
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1.5rem)] bg-slate-900/90 text-white backdrop-blur-md border border-slate-700/80 rounded-full px-2.5 py-1.5 shadow-xl flex items-center gap-1.5">
            <select
              aria-label="Pindah tab saat layar penuh"
              value={workspaceView}
              onChange={(e) => setWorkspaceView(e.target.value as WorkspaceView)}
              className="bg-slate-800 text-white text-xs font-medium rounded-full px-2.5 py-1.5 border border-slate-700 focus:outline-none cursor-pointer"
            >
              {WORKSPACE_TABS.map(([v, lbl]) => (
                <option key={v} value={v}>
                  {lbl}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              title="Buka Panel Alat & Kustomisasi"
              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] text-xs font-medium rounded-full bg-slate-800 hover:bg-slate-700 cursor-pointer shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Alat</span>
            </button>

            <button
              type="button"
              onClick={() => setNotepadOpen(true)}
              title="Buka Notepad Akun"
              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] text-xs font-medium rounded-full bg-slate-800 hover:bg-slate-700 cursor-pointer shrink-0"
            >
              <NotebookPen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Notepad</span>
            </button>

            <button
              type="button"
              onClick={toggleChatOpen}
              title="Buka Chat AI"
              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-full bg-blue-600 hover:bg-blue-500 cursor-pointer shrink-0"
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Chat AI</span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title="Keluar Mode Layar Penuh (Esc)"
              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-full bg-white text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Keluar</span>
            </button>
          </div>
        )}
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        xml={xmlSource}
        initialUploadBytes={initialUploadBytes}
        parsedInfo={parsedInfo}
        variableValues={variableValues}
        cssVarValues={cssVarValues}
        colorReplacements={colorReplacements}
        colors={colors}
        fonts={fonts}
        customCss={customCss}
        onOverwriteWholeXml={handleOverwriteBakedXml}
        onNotify={notify}
        siteAdsense={siteAdsenseSlotProps}
      />

      {/* Local Snapshot History Drawer (IndexedDB) */}
      <SnapshotHistoryDrawer
        isOpen={snapshotDrawerOpen}
        snapshots={snapshots}
        currentXmlBytes={currentXmlBytes}
        templateTitle={parsedInfo.templateTitle}
        onClose={() => setSnapshotDrawerOpen(false)}
        onCreateManualSnapshot={(label) => {
          recordSnapshot(xmlSource, label, 'manual', true);
          notify(`Snapshot "${label}" disimpan ke IndexedDB.`, 'success');
        }}
        onRestoreSnapshot={(snap) => {
          recordSnapshot(xmlSource, 'Cadangan sebelum Pulihkan Snapshot', 'auto', false);
          setXmlSource(snap.xml);
          setInitialUploadBytes(snap.byteSize);
          setActivePresetId(null);
          setSourceLabel(`Snapshot: ${snap.label}`);
          setSnapshotDrawerOpen(false);
          notify(`Template dipulihkan ke snapshot "${snap.label}".`, 'success');
        }}
        onDeleteSnapshot={(id) => {
          void deleteXmlSnapshot(id).then(() => {
            refreshSnapshots();
            notify('Snapshot dihapus dari penyimpanan lokal.', 'info');
          });
        }}
        onClearAll={() => {
          void clearAllXmlSnapshots().then(() => {
            refreshSnapshots();
            notify('Semua riwayat snapshot lokal dihapus.', 'info');
          });
        }}
      />

      {/* Per-Account Cloud Notepad Drawer */}
      <CloudNotepadDrawer
        isOpen={notepadOpen}
        onClose={() => setNotepadOpen(false)}
        notepad={notepad}
        activeTemplateTitle={parsedInfo.templateTitle}
        sourceLabel={sourceLabel}
        xmlByteSize={currentXmlBytes}
        isOfflineMode={isOfflineMode}
        onNotify={notify}
      />

      {/* Offline AI Runtime Settings Modal */}
      <OfflineAiRuntimeModal controller={offlineAi} onNotify={notify} />

      {/* Offline Status Notice */}
      <OfflineIndicator onNotify={notify} />

      {/* Global Auto-Fix Worker Progress Toast */}
      {globalFixProgress && (
        <div
          role="status"
          className="fixed bottom-16 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] p-3.5 rounded-xl bg-white border border-slate-200 shadow-lg space-y-2"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-900 truncate">{globalFixProgress.message}</span>
            <button
              type="button"
              onClick={() => {
                globalFixCancelRef.current?.();
                globalFixCancelRef.current = null;
                setGlobalFixProgress(null);
                notify('Proses Auto-Fix XML dibatalkan.', 'info');
              }}
              className="px-2 py-1 text-[11px] font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded cursor-pointer shrink-0"
            >
              Batal
            </button>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${Math.max(5, globalFixProgress.percent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 max-w-sm px-4 py-3 rounded-lg border shadow-md flex items-center justify-between gap-3 text-xs font-medium ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : toast.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Tutup notifikasi"
            className="text-current opacity-60 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
