import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  RotateCcw,
  Search,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import type { DetectedPageText, ParsedTemplateInfo } from '../types/blogger';
import {
  canShareXmlFile,
  downloadXmlFile,
  replaceAssetUrlInXml,
  replaceSvgByIndexInXml,
  shareXmlFileViaNavigator,
  updateNavLinkInXml,
  updatePageTextInXml,
  updateSnippetInXml,
  updateWidgetAttrInXml,
  updateWidgetSettingInXml,
} from '../lib/bloggerCompiler';
import {
  removeDuplicateAssetsFromXml,
  removeDuplicateCssRulesFromXml,
  removeUnusedCssRulesFromXml,
  removeUnusedCssVarsFromXml,
  smartDecodeCodeOffline,
} from '../lib/scriptAndCodeInspector';
import {
  LARGE_FILE_EDITOR_DOM_THRESHOLD_BYTES,
  LARGE_FILE_VALIDATION_THRESHOLD_BYTES,
  runAnalyzeDeadCodeWorker,
  runCleanDeadCodeWorker,
  validateXmlWithDomParser,
  type AutoDetectedSafelistPrefix,
  type DeadCleanOptions,
  type DeadCodeAnalysisResult,
  type DeadCodeCleanResult,
  type WorkerProgressInfo,
} from '../lib/xmlWorkerEngine';
import {
  evaluateAssetUrlWithOfflineAi,
  evaluateEncodedCodeWithOfflineAi,
  evaluatePageTextWithOfflineAi,
} from '../lib/offlineAiEngine';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';
import { SafelistPrefixManager, normalizeSafelistInput } from './SafelistPrefixManager';
import { DiffViewerPanel } from './DiffViewerPanel';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import {
  cleanAllSvgsInXml,
  cleanInlineSvgMarkup,
  containsBloggerDynamicSyntax,
  minifyCssInXmlOffline,
  minifyJsInXmlOffline,
} from '../lib/xmlFeatureTools';
import {
  buildXmlExcerptForAiSignatureCheck,
  cleanAllAiSignaturesInXml,
  customizeAiAttributionInXml,
  detectAiSignaturesInXml,
  removeAiSignatureInXml,
  replaceAiSignatureInXml,
  stripInvisibleWatermarks,
  suggestNeutralizedSnippet,
  type AiSignatureFinding,
  type DeepAiSignatureAnalysisResult,
} from '../lib/aiSignatureDetector';
import { AiSignatureAutoBar } from './AiSignatureAutoBar';
import { AiSignatureLocationMap } from './AiSignatureLocationMap';
import { HtmlJsCssViewerPanel } from './HtmlJsCssViewerPanel';
import { runJsonPromptOnLocalServer } from '../lib/offlineAiRuntime';

type InspectorTab =
  | 'ai-signature'
  | 'html-js-css'
  | 'redundancy'
  | 'page-texts'
  | 'scripts-decode'
  | 'xml-vars'
  | 'css-vars'
  | 'hardcoded'
  | 'widgets-nav'
  | 'images-svg'
  | 'structure';

type AiSigFilter =
  | 'all'
  | 'comment'
  | 'meta'
  | 'credit-attr'
  | 'unicode'
  | 'stylistic';

type RedundancyFilter =
  | 'all'
  | 'dup-css'
  | 'dup-js'
  | 'unused-css'
  | 'unused-vars'
  | 'unused-js';

interface VariableInspectorViewProps {
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  variableValues: Record<string, string>;
  onVariableChange: (name: string, value: string) => void;
  onResetVariable: (name: string, defaultValue: string) => void;
  cssVarValues: Record<string, string>;
  onCssVarChange: (key: string, value: string) => void;
  onResetCssVar: (key: string) => void;
  colorReplacements: Record<string, string>;
  onColorReplace: (oldHex: string, newHex: string) => void;
  onResetColorReplace: (oldHex: string) => void;
  onUpdateXml: (nextXml: string, feedbackMessage: string) => void;
  onOpenXmlEditor: () => void;
  onJumpToEditorLine?: (line?: number | null) => void;
  offlineAi?: OfflineAiController;
  activePresetId?: string | null;
  sourceLabel?: string;
  onLoadXmlContent?: (
    xml: string,
    label: string,
    presetId?: string | null,
    originalBytes?: number | null
  ) => void;
  isOfflineMode?: boolean;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB (${bytes.toLocaleString('id-ID')} B)`;
}

function sanitizeSvgForPreview(rawSvg: string): string {
  return rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export const VariableInspectorView: React.FC<VariableInspectorViewProps> = ({
  xml,
  parsedInfo,
  variableValues,
  onVariableChange,
  onResetVariable,
  cssVarValues,
  onCssVarChange,
  onResetCssVar,
  colorReplacements,
  onColorReplace,
  onResetColorReplace,
  onUpdateXml,
  onOpenXmlEditor,
  onJumpToEditorLine,
  offlineAi,
  activePresetId = null,
  sourceLabel = '',
  onLoadXmlContent,
  isOfflineMode = false,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>(() => {
    const initialSigReport = detectAiSignaturesInXml(xml);
    if (initialSigReport.highConfidenceCount > 0) {
      return 'ai-signature';
    }
    if (
      parsedInfo.redundancyReport.totalDuplicateCssCount +
        parsedInfo.redundancyReport.totalDuplicateJsCount +
        parsedInfo.redundancyReport.unusedCssRules.length >
      0
    ) {
      return 'redundancy';
    }
    if (parsedInfo.pageTexts.length > 0) return 'page-texts';
    if (parsedInfo.variables.length > 0) return 'xml-vars';
    if (parsedInfo.cssCustomProperties.length > 0) return 'css-vars';
    return 'widgets-nav';
  });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'color' | 'font' | 'other'>('all');
  const [zoneFilter, setZoneFilter] = useState<'all' | DetectedPageText['zone']>('all');
  const [scriptFilter, setScriptFilter] = useState<'all' | 'js' | 'css' | 'obfuscated' | 'encoded'>('all');
  const [redundancyFilter, setRedundancyFilter] = useState<RedundancyFilter>('all');
  const [aiSigFilter, setAiSigFilter] = useState<AiSigFilter>('all');
  const [aiSigDrafts, setAiSigDrafts] = useState<Record<string, string>>({});
  const [aiSigError, setAiSigError] = useState<string | null>(null);
  const [isDeepScanningAiSig, setIsDeepScanningAiSig] = useState(false);
  const [deepAiSigResult, setDeepAiSigResult] = useState<DeepAiSignatureAnalysisResult | null>(null);
  const [isDraggingAiXml, setIsDraggingAiXml] = useState(false);
  const aiXmlFileInputRef = useRef<HTMLInputElement>(null);
  const aiFindingsSectionRef = useRef<HTMLDivElement>(null);
  const canShareMobile = useMemo(() => canShareXmlFile(), []);
  const {
    user,
    engineMode,
    geminiModel,
    signInWithGoogle,
    authorizedGeminiFetch,
  } = useAuthAndAi();

  // Web Worker state for offline O(1) CSS/JS/Var analysis & dead code cleaning
  const [workerAnalysis, setWorkerAnalysis] = useState<DeadCodeAnalysisResult | null>(null);
  const [workerProgress, setWorkerProgress] = useState<WorkerProgressInfo | null>(null);
  const [isWorkerBusy, setIsWorkerBusy] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [cleanOptions, setCleanOptions] = useState<DeadCleanOptions>({
    removeUnusedCssRules: true,
    removeUnusedCssVars: true,
    removeDeadJsFunctions: true,
    removeCssJsComments: true,
    removeDuplicateCssRules: true,
    removeDuplicateAssets: true,
  });
  const [cleanResult, setCleanResult] = useState<DeadCodeCleanResult | null>(null);
  const [cleanResultCopied, setCleanResultCopied] = useState(false);
  const [activeSafelistChips, setActiveSafelistChips] = useState<AutoDetectedSafelistPrefix[]>([]);
  const [hasCustomSafelistEdits, setHasCustomSafelistEdits] = useState(false);
  const workerCancelRef = useRef<(() => void) | null>(null);
  const skipAutoAnalyzeForXmlRef = useRef<string | null>(null);

  const isLargeFile = xml.length > LARGE_FILE_VALIDATION_THRESHOLD_BYTES;
  const isVeryLargeDomFile = xml.length > LARGE_FILE_EDITOR_DOM_THRESHOLD_BYTES;

  // Local draft states for quick inline editing
  const [pageTextDrafts, setPageTextDrafts] = useState<Record<string, string>>({});
  const [assetUrlDrafts, setAssetUrlDrafts] = useState<Record<string, string>>({});
  const [manualDecodeInput, setManualDecodeInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [widgetTitleDrafts, setWidgetTitleDrafts] = useState<Record<string, string>>({});
  const [widgetSettingDrafts, setWidgetSettingDrafts] = useState<Record<string, string>>({});
  const [navDrafts, setNavDrafts] = useState<Record<number, { text: string; href: string }>>({});
  const [imageDrafts, setImageDrafts] = useState<Record<string, string>>({});
  const [svgDrafts, setSvgDrafts] = useState<Record<number, string>>({});
  const [expandedSvgIdx, setExpandedSvgIdx] = useState<number | null>(null);
  const [regionDrafts, setRegionDrafts] = useState<Record<string, string>>({});
  const [cardUndoHistory, setCardUndoHistory] = useState<
    Record<string, { xml: string; label: string }>
  >({});
  const [unlockedDynamicCards, setUnlockedDynamicCards] = useState<Record<string, boolean>>({});
  const [lastDiffSnapshot, setLastDiffSnapshot] = useState<{
    before: string;
    after: string;
    title: string;
    subtitle?: string;
  } | null>(null);

  const commitCardXmlChange = (
    cardKey: string,
    nextXml: string,
    feedbackMessage: string,
    cardLabel: string
  ) => {
    if (nextXml !== xml) {
      setCardUndoHistory((prev) => ({
        ...prev,
        [cardKey]: { xml, label: cardLabel },
      }));
    }
    onUpdateXml(nextXml, feedbackMessage);
  };

  const handleUndoCard = (cardKey: string) => {
    const entry = cardUndoHistory[cardKey];
    if (!entry) return;
    setCardUndoHistory((prev) => {
      const next = { ...prev };
      delete next[cardKey];
      return next;
    });
    onUpdateXml(entry.xml, `Perubahan pada "${entry.label}" dibatalkan (Undo kartu).`);
  };

  useEffect(() => {
    setWorkerAnalysis(null);
    setWorkerError(null);
    setHasCustomSafelistEdits(false);
    setDeepAiSigResult(null);
    setAiSigError(null);
  }, [xml]);

  useEffect(() => {
    return () => {
      workerCancelRef.current?.();
      workerCancelRef.current = null;
    };
  }, []);

  const handleCancelWorker = () => {
    skipAutoAnalyzeForXmlRef.current = xml;
    workerCancelRef.current?.();
    workerCancelRef.current = null;
    setIsWorkerBusy(false);
    setWorkerProgress(null);
  };

  const handleRunWorkerAnalyze = async (forceResetAutoSafelist = false) => {
    if (isWorkerBusy) return;
    skipAutoAnalyzeForXmlRef.current = null;
    setIsWorkerBusy(true);
    setWorkerError(null);
    setWorkerProgress({
      phase: 'indexing',
      percent: 8,
      message: 'Mengindeks dokumen & mendeteksi Safelist Prefix di Web Worker...',
    });

    const overridePrefixes =
      !forceResetAutoSafelist && hasCustomSafelistEdits
        ? activeSafelistChips.map((c) => c.prefix)
        : undefined;

    const job = runAnalyzeDeadCodeWorker(
      xml,
      (p) => setWorkerProgress(p),
      overridePrefixes
    );
    workerCancelRef.current = job.cancel;

    try {
      const result = await job.promise;
      if (workerCancelRef.current !== job.cancel) return;
      workerCancelRef.current = null;
      setWorkerAnalysis(result);
      if (forceResetAutoSafelist || !hasCustomSafelistEdits) {
        setActiveSafelistChips(result.autoDetectedSafelist || []);
        setHasCustomSafelistEdits(false);
      }
      setIsWorkerBusy(false);
      setWorkerProgress(null);
    } catch (err) {
      workerCancelRef.current = null;
      setIsWorkerBusy(false);
      setWorkerProgress(null);
      setWorkerError(
        err instanceof Error ? err.message : 'Gagal menjalankan analisis Web Worker.'
      );
    }
  };

  const handleAddManualSafelist = (rawPrefix: string) => {
    const normalized = normalizeSafelistInput(rawPrefix);
    if (!normalized) return;
    setHasCustomSafelistEdits(true);
    setActiveSafelistChips((prev) => {
      if (prev.some((c) => c.prefix.toLowerCase() === normalized.toLowerCase())) {
        return prev;
      }
      const cssCount = workerAnalysis?.cssPrefixRuleCounts?.[normalized.toLowerCase()] || 0;
      return [
        ...prev,
        {
          prefix: normalized,
          kind: 'prefix',
          cssRuleCount: cssCount,
          matchedTokensSample: [],
          source: 'manual',
        },
      ];
    });
  };

  const handleRemoveSafelistPrefix = (prefixToRemove: string) => {
    setHasCustomSafelistEdits(true);
    setActiveSafelistChips((prev) =>
      prev.filter((c) => c.prefix.toLowerCase() !== prefixToRemove.toLowerCase())
    );
  };

  const handleResetSafelistAutoDetect = () => {
    setHasCustomSafelistEdits(false);
    void handleRunWorkerAnalyze(true);
  };

  useEffect(() => {
    if (
      activeTab === 'redundancy' &&
      !workerAnalysis &&
      !isWorkerBusy &&
      xml.trim().length > 0 &&
      skipAutoAnalyzeForXmlRef.current !== xml
    ) {
      void handleRunWorkerAnalyze(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, xml, workerAnalysis]);

  const handleRunWorkerClean = async () => {
    if (isWorkerBusy) return;
    setIsWorkerBusy(true);
    setWorkerError(null);
    setWorkerProgress({
      phase: 'indexing',
      percent: 5,
      message: 'Mengindeks dokumen sebelum pembersihan...',
    });

    const job = runCleanDeadCodeWorker(
      xml,
      {
        ...cleanOptions,
        safelistPrefixes: activeSafelistChips.map((c) => c.prefix),
      },
      (p) => setWorkerProgress(p)
    );
    workerCancelRef.current = job.cancel;

    try {
      const result = await job.promise;
      if (workerCancelRef.current !== job.cancel) return;
      workerCancelRef.current = null;
      setCleanResult(result);
      setIsWorkerBusy(false);
      setWorkerProgress(null);

      if (!result.rolledBackToValid && result.cleanedXml !== xml) {
        setLastDiffSnapshot({
          before: xml,
          after: result.cleanedXml,
          title: 'Side-by-Side Diff — Pembersihan CSS/JS & Variabel',
          subtitle: `Hemat ${formatBytes(result.stats.savedBytes)} (${result.stats.durationMs} ms)`,
        });
        onUpdateXml(
          result.cleanedXml,
          `Pembersih Web Worker selesai: hemat ${formatBytes(result.stats.savedBytes)}, validasi DOMParser("text/xml") ${result.validationPassed ? 'lulus' : 'selesai'}.`
        );
      } else if (result.rolledBackToValid) {
        onUpdateXml(
          xml,
          'Pembersihan dibatalkan otomatis demi menjaga validitas DOMParser("text/xml").'
        );
      }
    } catch (err) {
      workerCancelRef.current = null;
      setIsWorkerBusy(false);
      setWorkerProgress(null);
      setWorkerError(
        err instanceof Error ? err.message : 'Pembersihan Web Worker dibatalkan atau gagal.'
      );
    }
  };

  const handleMinifyCssInXml = () => {
    const minRes = minifyCssInXmlOffline(xml);
    if (!minRes.changed || minRes.blocksMinified === 0 || minRes.nextXml === xml) {
      onUpdateXml(xml, 'CSS <b:skin> & <style> sudah ringkas (tidak ada penghematan tambahan).');
      return;
    }
    const check = validateXmlWithDomParser(minRes.nextXml);
    if (!check.isValid) {
      setWorkerError(
        `Minify CSS ditahan karena memicu error XML (${check.message || 'tidak valid'}).`
      );
      return;
    }
    const summarySub =
      minRes.savedBytes > 0
        ? `Hemat ${formatBytes(minRes.savedBytes)} pada ${minRes.blocksMinified} blok style`
        : `${minRes.blocksMinified} blok style di-minify & diamankan CDATA`;
    setLastDiffSnapshot({
      before: xml,
      after: minRes.nextXml,
      title: 'Side-by-Side Diff — Minify CSS <b:skin> & <style>',
      subtitle: summarySub,
    });
    onUpdateXml(
      minRes.nextXml,
      minRes.savedBytes > 0
        ? `Minify CSS selesai pada ${minRes.blocksMinified} blok (hemat ${formatBytes(minRes.savedBytes)}).`
        : `Minify CSS selesai & CDATA diamankan pada ${minRes.blocksMinified} blok style.`
    );
  };

  const handleMinifyJsInXml = () => {
    const minRes = minifyJsInXmlOffline(xml);
    if (!minRes.changed || minRes.blocksMinified === 0 || minRes.nextXml === xml) {
      onUpdateXml(xml, 'JavaScript pada blok <script> sudah ringkas (tidak ada penghematan tambahan).');
      return;
    }
    const check = validateXmlWithDomParser(minRes.nextXml);
    if (!check.isValid) {
      setWorkerError(
        `Minify JS ditahan karena memicu error XML (${check.message || 'tidak valid'}).`
      );
      return;
    }
    const summarySub =
      minRes.savedBytes > 0
        ? `Hemat ${formatBytes(minRes.savedBytes)} pada ${minRes.blocksMinified} blok script`
        : `${minRes.blocksMinified} blok script di-minify & diamankan CDATA`;
    setLastDiffSnapshot({
      before: xml,
      after: minRes.nextXml,
      title: 'Side-by-Side Diff — Minify JS (<script> Inline)',
      subtitle: summarySub,
    });
    onUpdateXml(
      minRes.nextXml,
      minRes.savedBytes > 0
        ? `Minify JS selesai pada ${minRes.blocksMinified} blok (hemat ${formatBytes(minRes.savedBytes)}).`
        : `Minify JS selesai & //<![CDATA[ diamankan pada ${minRes.blocksMinified} blok script.`
    );
  };

  const handleCopyCleanedXml = async () => {
    if (!cleanResult) return;
    try {
      await navigator.clipboard.writeText(cleanResult.cleanedXml);
      setCleanResultCopied(true);
      setTimeout(() => setCleanResultCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const applySingleCleanupChecked = (nextXml: string, okMsg: string) => {
    const check = validateXmlWithDomParser(nextXml);
    if (!check.isValid) {
      setWorkerError(
        `Aksi ditahan karena akan memicu error XML (${check.message || 'sintaks tidak valid'}). Gunakan Pembersih Web Worker untuk pembersihan + Auto-Fix aman.`
      );
      return;
    }
    onUpdateXml(nextXml, okMsg);
  };

  const q = search.trim().toLowerCase();

  const filteredAssetUrls = useMemo(() => {
    return parsedInfo.assetUrls.filter((asset) => {
      if (scriptFilter === 'js' && asset.kind !== 'js') return false;
      if (scriptFilter === 'css' && asset.kind !== 'css') return false;
      if (scriptFilter === 'obfuscated' && !asset.isObfuscated) return false;
      if (scriptFilter === 'encoded') return false;
      if (!q) return true;
      return (
        asset.url.toLowerCase().includes(q) ||
        asset.host.toLowerCase().includes(q) ||
        (asset.extension || '').toLowerCase().includes(q) ||
        (asset.obfuscationTechnique || '').toLowerCase().includes(q) ||
        asset.sourceContext.toLowerCase().includes(q)
      );
    });
  }, [parsedInfo.assetUrls, q, scriptFilter]);

  const filteredEncodedCodes = useMemo(() => {
    if (scriptFilter === 'js' || scriptFilter === 'css') return [];
    return parsedInfo.encodedCodes.filter((item) => {
      if (!q) return true;
      return (
        item.techniqueLabel.toLowerCase().includes(q) ||
        item.decodedText.toLowerCase().includes(q) ||
        item.rawSnippet.toLowerCase().includes(q) ||
        item.revealedUrls.some((u) => u.toLowerCase().includes(q))
      );
    });
  }, [parsedInfo.encodedCodes, q, scriptFilter]);

  const manualDecodeResult = useMemo(
    () => smartDecodeCodeOffline(manualDecodeInput),
    [manualDecodeInput]
  );

  const handleCopyText = (id: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  const filteredPageTexts = useMemo(() => {
    return parsedInfo.pageTexts.filter((item) => {
      if (zoneFilter !== 'all' && item.zone !== zoneFilter) return false;
      if (!q) return true;
      return (
        item.text.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.zone.toLowerCase().includes(q) ||
        (item.widgetId || '').toLowerCase().includes(q)
      );
    });
  }, [parsedInfo.pageTexts, q, zoneFilter]);

  const filteredXmlVars = useMemo(() => {
    return parsedInfo.variables.filter((v) => {
      const matchesQuery =
        !q ||
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        (v.group || '').toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (typeFilter === 'color') return v.type.toLowerCase() === 'color';
      if (typeFilter === 'font') return v.type.toLowerCase() === 'font';
      if (typeFilter === 'other') {
        const t = v.type.toLowerCase();
        return t !== 'color' && t !== 'font';
      }
      return true;
    });
  }, [parsedInfo.variables, q, typeFilter]);

  const filteredCssVars = useMemo(() => {
    return parsedInfo.cssCustomProperties.filter((p) => {
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.value.toLowerCase().includes(q) ||
        p.selector.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (typeFilter === 'color') return p.valueType === 'color';
      if (typeFilter === 'font') return p.valueType === 'font';
      if (typeFilter === 'other') return p.valueType === 'length' || p.valueType === 'other';
      return true;
    });
  }, [parsedInfo.cssCustomProperties, q, typeFilter]);

  const filteredColors = useMemo(() => {
    return parsedInfo.hardcodedColors.filter(
      (c) =>
        !q ||
        c.color.toLowerCase().includes(q) ||
        c.sampleContext.toLowerCase().includes(q)
    );
  }, [parsedInfo.hardcodedColors, q]);

  const filteredWidgets = useMemo(() => {
    return parsedInfo.widgets.filter(
      (w) =>
        !q ||
        w.id.toLowerCase().includes(q) ||
        w.type.toLowerCase().includes(q) ||
        w.title.toLowerCase().includes(q) ||
        w.sectionId.toLowerCase().includes(q)
    );
  }, [parsedInfo.widgets, q]);

  const filteredNavLinks = useMemo(() => {
    return parsedInfo.navLinks.filter(
      (n) =>
        !q ||
        n.text.toLowerCase().includes(q) ||
        n.href.toLowerCase().includes(q) ||
        n.zone.toLowerCase().includes(q)
    );
  }, [parsedInfo.navLinks, q]);

  const filteredImages = useMemo(() => {
    return parsedInfo.images.filter(
      (img) =>
        !q ||
        img.url.toLowerCase().includes(q) ||
        img.context.toLowerCase().includes(q)
    );
  }, [parsedInfo.images, q]);

  const filteredSvgs = useMemo(() => {
    return parsedInfo.svgs.filter(
      (s) =>
        !q ||
        s.context.toLowerCase().includes(q) ||
        s.idAttr.toLowerCase().includes(q) ||
        s.classAttr.toLowerCase().includes(q)
    );
  }, [parsedInfo.svgs, q]);

  const { byteBreakdown } = parsedInfo;
  const redundancyReport = workerAnalysis ? workerAnalysis.report : parsedInfo.redundancyReport;
  const unusedJsFunctions = workerAnalysis ? workerAnalysis.unusedJsFunctions : [];

  const filteredUnusedJsFunctions = useMemo(
    () =>
      unusedJsFunctions.filter(
        (fn) =>
          !q ||
          fn.name.toLowerCase().includes(q) ||
          fn.preview.toLowerCase().includes(q)
      ),
    [unusedJsFunctions, q]
  );

  const filteredDupCssAssets = useMemo(
    () =>
      redundancyReport.duplicateCssAssets.filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q) ||
          item.urlsOrSnippets.some((u) => u.toLowerCase().includes(q))
      ),
    [redundancyReport.duplicateCssAssets, q]
  );

  const filteredDupJsAssets = useMemo(
    () =>
      redundancyReport.duplicateJsAssets.filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q) ||
          item.urlsOrSnippets.some((u) => u.toLowerCase().includes(q))
      ),
    [redundancyReport.duplicateJsAssets, q]
  );

  const filteredDupCssRules = useMemo(
    () =>
      redundancyReport.duplicateCssRules.filter(
        (item) =>
          !q ||
          item.selector.toLowerCase().includes(q) ||
          item.sampleBody.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q)
      ),
    [redundancyReport.duplicateCssRules, q]
  );

  const filteredUnusedCssRules = useMemo(
    () =>
      redundancyReport.unusedCssRules.filter(
        (item) =>
          !q ||
          item.selector.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q) ||
          item.tokensChecked.some((t) => t.toLowerCase().includes(q))
      ),
    [redundancyReport.unusedCssRules, q]
  );

  const filteredUnusedCssVars = useMemo(
    () =>
      redundancyReport.unusedCssVars.filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.value.toLowerCase().includes(q) ||
          item.selector.toLowerCase().includes(q)
      ),
    [redundancyReport.unusedCssVars, q]
  );

  const totalRedundancyBadge =
    redundancyReport.totalDuplicateCssCount +
    redundancyReport.totalDuplicateJsCount +
    redundancyReport.unusedCssRules.length +
    unusedJsFunctions.length;

  const aiSignatureReport = useMemo(() => detectAiSignaturesInXml(xml), [xml]);

  const filteredAiSignatures = useMemo(() => {
    return aiSignatureReport.findings.filter((item) => {
      if (aiSigFilter === 'comment') {
        if (item.category !== 'comment-watermark' && item.category !== 'script-comment') return false;
      } else if (aiSigFilter === 'meta') {
        if (item.category !== 'meta-generator') return false;
      } else if (aiSigFilter === 'credit-attr') {
        if (item.category !== 'attribution-credit' && item.category !== 'custom-attribute') return false;
      } else if (aiSigFilter === 'unicode') {
        if (item.category !== 'steganographic-unicode') return false;
      } else if (aiSigFilter === 'stylistic') {
        if (item.category !== 'stylistic-pattern') return false;
      }

      if (!q) return true;
      return (
        item.sourceTool.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.rawSnippet.toLowerCase().includes(q) ||
        item.zone.toLowerCase().includes(q)
      );
    });
  }, [aiSignatureReport.findings, aiSigFilter, q]);

  const hasCustomTemplateLoaded = Boolean(xml.trim()) && activePresetId === null;

  const handleUploadXmlInInspector = (file: File) => {
    if (!onLoadXmlContent) return;
    if (!file.name.toLowerCase().endsWith('.xml')) {
      const msg = 'Harap pilih file template Blogger berekstensi .xml yang valid.';
      setAiSigError(msg);
      onNotify?.(msg, 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) {
        const msg = 'File XML kosong atau tidak dapat dibaca.';
        setAiSigError(msg);
        onNotify?.(msg, 'error');
        return;
      }
      setAiSigError(null);
      setAiSigDrafts({});
      onLoadXmlContent(content, `File: ${file.name}`, null, file.size);
      onNotify?.(
        `Template ${file.name} (${(file.size / 1024).toFixed(1)} KB) dimuat & langsung dipindai tanda tangan AI.`,
        'success'
      );
    };
    reader.onerror = () => {
      const msg = 'Gagal membaca file dari perangkat Anda.';
      setAiSigError(msg);
      onNotify?.(msg, 'error');
    };
    reader.readAsText(file);
  };

  const handleApplyAiSignatureEdit = (finding: AiSignatureFinding, nextSnippet: string) => {
    setAiSigError(null);
    const nextXml = replaceAiSignatureInXml(xml, finding, nextSnippet);
    if (nextXml === xml) {
      setAiSigError('Tidak ada perubahan pada potongan kode tersebut atau posisi sudah berubah.');
      return;
    }
    const check = validateXmlWithDomParser(nextXml);
    if (!check.isValid) {
      setAiSigError(
        `Edit ditahan karena menghasilkan struktur XML tidak valid (${check.message || 'syntax error'}). Pastikan penutup komentar/tag lengkap.`
      );
      return;
    }
    setAiSigDrafts((prev) => {
      const copy = { ...prev };
      delete copy[finding.id];
      return copy;
    });
    commitCardXmlChange(
      finding.id,
      nextXml,
      `Tanda tangan AI pada baris ${finding.line} berhasil diperbarui di XML.`,
      finding.label
    );
  };

  const handleRemoveAiSignature = (finding: AiSignatureFinding) => {
    setAiSigError(null);
    const nextXml = removeAiSignatureInXml(xml, finding);
    if (nextXml === xml) {
      setAiSigError('Gagal menemukan potongan tanda tangan tersebut di XML aktif.');
      return;
    }
    const check = validateXmlWithDomParser(nextXml);
    if (!check.isValid) {
      setAiSigError(
        `Penghapusan ditahan karena memicu error XML (${check.message || 'syntax error'}). Coba edit isinya alih-alih menghapus seluruh tag.`
      );
      return;
    }
    setAiSigDrafts((prev) => {
      const copy = { ...prev };
      delete copy[finding.id];
      return copy;
    });
    commitCardXmlChange(
      finding.id,
      nextXml,
      `Tanda tangan AI "${finding.sourceTool}" di baris ${finding.line} dihapus dari XML.`,
      finding.label
    );
  };

  const handleCleanAllAiSignatures = (includeStylistic = false) => {
    setAiSigError(null);
    const res = cleanAllAiSignaturesInXml(xml, { includeStylistic });
    if (res.removedCount === 0 && res.removedInvisibleCount === 0) {
      onNotify?.('Tidak ada tanda tangan AI eksplisit yang perlu dihapus.', 'info');
      return;
    }
    const check = validateXmlWithDomParser(res.nextXml);
    if (!check.isValid) {
      setAiSigError(
        `Pembersihan massal ditahan demi menjaga validitas XML (${check.message || 'syntax error'}). Hapus atau edit item satu per satu.`
      );
      return;
    }
    setAiSigDrafts({});
    commitCardXmlChange(
      'ai-sig-bulk',
      res.nextXml,
      `Berhasil membersihkan ${res.removedCount} tanda tangan AI${
        res.removedInvisibleCount > 0
          ? ` dan ${res.removedInvisibleCount} watermark Unicode tak terlihat`
          : ''
      }.`,
      'Semua Tanda Tangan AI'
    );
  };

  const handleCustomizeAllAiSignatures = (customAuthor: string) => {
    setAiSigError(null);
    const res = customizeAiAttributionInXml(xml, customAuthor);
    if (res.updatedCount === 0 && res.nextXml === xml) {
      onNotify?.('Tidak ada kredit/tanda tangan AI yang perlu diubah.', 'info');
      return;
    }
    const check = validateXmlWithDomParser(res.nextXml);
    if (!check.isValid) {
      setAiSigError(
        `Pengubahan massal ditahan demi menjaga validitas XML (${check.message || 'syntax error'}). Silakan modifikasi item satu per satu.`
      );
      return;
    }
    setAiSigDrafts({});
    commitCardXmlChange(
      'ai-sig-bulk',
      res.nextXml,
      `${res.updatedCount} tanda tangan AI berhasil diubah menjadi "${customAuthor}".`,
      `Ganti Kredit AI → ${customAuthor}`
    );
  };

  const handleRunDeepAiSignatureScan = async () => {
    if (isDeepScanningAiSig || !xml.trim()) return;
    setAiSigError(null);
    setIsDeepScanningAiSig(true);
    try {
      const excerpt = buildXmlExcerptForAiSignatureCheck(xml);
      const staticSummary = `${aiSignatureReport.verdictLabel} (skor ${aiSignatureReport.confidenceScore}%). Temuan awal: ${aiSignatureReport.findings
        .slice(0, 8)
        .map((f) => `[Baris ${f.line}] ${f.sourceTool}: ${f.rawSnippet.slice(0, 80)}`)
        .join(' | ')}`;

      const isLocalHttpRuntime =
        offlineAi &&
        (offlineAi.config.runtime === 'ollama' ||
          offlineAi.config.runtime === 'lmstudio' ||
          offlineAi.config.runtime === 'llamacpp') &&
        Boolean(offlineAi.probeResult?.available);

      if ((engineMode === 'local' || isOfflineMode) && isLocalHttpRuntime && offlineAi) {
        const localRes = await runJsonPromptOnLocalServer(
          offlineAi.config,
          'Anda adalah analis forensik kode XML Blogger. Balas hanya JSON valid.',
          `Analisis forensik template XML Blogger berikut untuk mendeteksi apakah dibuat/ditandatangani oleh AI (ChatGPT, Claude, Gemini, DeepSeek, Copilot, Qwen, Cursor, v0, Bolt, dll).
Balas HANYA JSON dengan kunci:
{
  "isAiSigned": boolean,
  "confidenceScore": number,
  "verdictLabel": "string bahasa Indonesia",
  "detectedTools": ["string"],
  "reasoning": "string 2 kalimat bahasa Indonesia",
  "extraSignatures": [{ "snippet": "potongan kode persis", "reason": "alasan", "suspectedTool": "nama alat", "zone": "zona" }]
}

Ringkasan awal: ${staticSummary}

Cuplikan XML:
${excerpt}`
        );
        const parsedLocal = JSON.parse(localRes.jsonText) as DeepAiSignatureAnalysisResult;
        setDeepAiSigResult(parsedLocal);
        onNotify?.(`Analisis mendalam tanda tangan AI selesai lewat ${localRes.engineLabel}.`, 'success');
        return;
      }

      if (isOfflineMode || engineMode === 'local') {
        setAiSigError(
          isOfflineMode
            ? 'Mode Offline aktif tanpa server LLM Lokal terhubung. Pemindaian forensik deterministik tetap aktif 100% offline di atas.'
            : 'Mode AI Lokal aktif tanpa Ollama/LM Studio terhubung. Pilih Gemini Cloud di pemilih Mesin AI atau hubungkan server LLM lokal untuk analisis mendalam.'
        );
        return;
      }

      if (!user) {
        onNotify?.('Login Google diperlukan untuk memakai Gemini Cloud.', 'info');
        const ok = await signInWithGoogle();
        if (!ok) return;
      }

      const data = await authorizedGeminiFetch<DeepAiSignatureAnalysisResult>(
        '/api/ai/detect-ai-signature',
        { xmlExcerpt: excerpt, staticSummary }
      );
      setDeepAiSigResult(data);
      onNotify?.(`Analisis mendalam AI (${geminiModel}) selesai.`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan analisis mendalam AI.';
      setAiSigError(msg);
      onNotify?.(msg, 'error');
    } finally {
      setIsDeepScanningAiSig(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {offlineAi && (
        <OfflineAiRuntimeBar
          controller={offlineAi}
          page="inspector"
          xml={xml}
          parsedInfo={parsedInfo}
        />
      )}

      {/* Top Inspector Header, Auto AI Signature Bar & Tabs */}
      <div className="px-3 sm:px-6 py-3 border-b border-slate-200 bg-white space-y-2.5">
        <AiSignatureAutoBar
          report={aiSignatureReport}
          sourceLabel={sourceLabel || parsedInfo.templateTitle}
          hasCustomTemplateLoaded={hasCustomTemplateLoaded}
          isActiveAiTab={activeTab === 'ai-signature'}
          hasBulkUndo={Boolean(cardUndoHistory['ai-sig-bulk'])}
          onOpenAiTab={() => {
            setActiveTab('ai-signature');
            setTimeout(() => {
              aiFindingsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
          }}
          onQuickCleanAll={() => handleCleanAllAiSignatures(false)}
          onQuickCustomizeAuthor={handleCustomizeAllAiSignatures}
          onUndoBulkClean={() => handleUndoCard('ai-sig-bulk')}
          onJumpToFirstLine={(line) =>
            onJumpToEditorLine ? onJumpToEditorLine(line) : onOpenXmlEditor()
          }
          onUploadXmlFile={onLoadXmlContent ? handleUploadXmlInInspector : undefined}
        />

        <div className="w-full overflow-x-auto no-scrollbar">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['ai-signature', `Deteksi AI (${aiSignatureReport.findings.length})`],
                ['html-js-css', 'HTML / .JS / .CSS'],
                ['redundancy', `CSS/JS Ganda & CSS Mati (${totalRedundancyBadge})`],
                ['page-texts', `Teks Halaman (${parsedInfo.pageTexts.length})`],
                [
                  'scripts-decode',
                  `JS, CSS, .JSS & Decode (${parsedInfo.assetUrls.length + parsedInfo.encodedCodes.length})`,
                ],
                ['xml-vars', `Variabel XML (${parsedInfo.variables.length})`],
                ['css-vars', `CSS Vars (${parsedInfo.cssCustomProperties.length})`],
                ['hardcoded', `Warna & Font (${parsedInfo.hardcodedColors.length})`],
                ['widgets-nav', `Widget & Navigasi (${parsedInfo.widgets.length + parsedInfo.navLinks.length})`],
                ['images-svg', `Gambar & SVG (${parsedInfo.images.length + parsedInfo.svgs.length})`],
                ['structure', `Header, Footer & Byte`],
              ] as Array<[InspectorTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                  activeTab === id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab !== 'structure' && activeTab !== 'html-js-css' && (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100">
            <div className="relative w-full md:w-80 lg:w-96 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari selector, URL, widget, atau nama..."
                className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {activeTab === 'ai-signature' && (
              <div className="w-full md:w-auto min-w-0 overflow-x-auto no-scrollbar md:ml-auto">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['all', `Semua (${aiSignatureReport.findings.length})`],
                      [
                        'comment',
                        `Komentar (${
                          aiSignatureReport.findings.filter(
                            (f) =>
                              f.category === 'comment-watermark' || f.category === 'script-comment'
                          ).length
                        })`,
                      ],
                      [
                        'meta',
                        `Meta & Schema (${
                          aiSignatureReport.findings.filter((f) => f.category === 'meta-generator')
                            .length
                        })`,
                      ],
                      [
                        'credit-attr',
                        `Kredit & Atribut (${
                          aiSignatureReport.findings.filter(
                            (f) =>
                              f.category === 'attribution-credit' ||
                              f.category === 'custom-attribute'
                          ).length
                        })`,
                      ],
                      [
                        'unicode',
                        `Watermark Unicode (${
                          aiSignatureReport.findings.filter(
                            (f) => f.category === 'steganographic-unicode'
                          ).length
                        })`,
                      ],
                      [
                        'stylistic',
                        `Sinyal Gaya (${
                          aiSignatureReport.findings.filter(
                            (f) => f.category === 'stylistic-pattern'
                          ).length
                        })`,
                      ],
                    ] as const
                  ).map(([sKey, sLabel]) => (
                    <button
                      key={sKey}
                      type="button"
                      onClick={() => setAiSigFilter(sKey)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                        aiSigFilter === sKey
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {sLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'redundancy' && (
              <div className="w-full md:w-auto min-w-0 overflow-x-auto no-scrollbar md:ml-auto">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['all', 'Semua'],
                      ['dup-css', `CSS Ganda (${redundancyReport.totalDuplicateCssCount})`],
                      ['dup-js', `JS Ganda (${redundancyReport.totalDuplicateJsCount})`],
                      ['unused-css', `CSS Mati (${redundancyReport.unusedCssRules.length})`],
                      ['unused-vars', `Var Mati (${redundancyReport.unusedCssVars.length})`],
                      ['unused-js', `JS Mati (${unusedJsFunctions.length})`],
                    ] as const
                  ).map(([rKey, rLabel]) => (
                    <button
                      key={rKey}
                      type="button"
                      onClick={() => setRedundancyFilter(rKey)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                        redundancyFilter === rKey
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {rLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'page-texts' && (
              <div className="w-full md:w-auto min-w-0 overflow-x-auto no-scrollbar md:ml-auto">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['all', 'Semua'],
                      ['header', 'Header'],
                      ['footer', 'Footer'],
                      ['widget', 'Widget'],
                      ['nav', 'Navigasi'],
                      ['heading', 'Heading'],
                      ['content', 'Konten'],
                      ['meta', 'Meta'],
                    ] as const
                  ).map(([zKey, zLabel]) => (
                    <button
                      key={zKey}
                      type="button"
                      onClick={() => setZoneFilter(zKey)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        zoneFilter === zKey
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {zLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'scripts-decode' && (
              <div className="w-full md:w-auto min-w-0 overflow-x-auto no-scrollbar md:ml-auto">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['all', 'Semua'],
                      ['js', '.JS / .JSS URL'],
                      ['css', '.CSS URL'],
                      ['obfuscated', 'Tersembunyi (Obfuscated)'],
                      ['encoded', 'Kode Decode'],
                    ] as const
                  ).map(([sKey, sLabel]) => (
                    <button
                      key={sKey}
                      type="button"
                      onClick={() => setScriptFilter(sKey)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        scriptFilter === sKey
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {sLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(activeTab === 'xml-vars' || activeTab === 'css-vars') && (
              <div className="w-full md:w-auto min-w-0 overflow-x-auto no-scrollbar md:ml-auto">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['all', 'Semua'],
                      ['color', 'Warna'],
                      ['font', 'Font'],
                      ['other', 'Lainnya'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTypeFilter(key)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        typeFilter === key
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'ai-signature' && (
          <div className="p-3 sm:p-6 space-y-5">
            {/* Shared Hidden XML File Input (no accept attr for Android picker compatibility) */}
            {onLoadXmlContent && (
              <input
                ref={aiXmlFileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadXmlInInspector(file);
                  e.target.value = '';
                }}
              />
            )}

            {/* Conditional Upload XML Prompt if user hasn't uploaded a custom XML yet */}
            {onLoadXmlContent && !hasCustomTemplateLoaded && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingAiXml(true);
                }}
                onDragLeave={() => setIsDraggingAiXml(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingAiXml(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleUploadXmlInInspector(file);
                }}
                className={`p-4 sm:p-5 rounded-xl border-2 border-dashed transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isDraggingAiXml
                    ? 'border-blue-500 bg-blue-50/70'
                    : 'border-slate-300 bg-slate-50/80'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900">
                    Unggah Template XML untuk Dicek Tanda Tangan AI
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Saat ini masih memakai template bawaan ({sourceLabel || parsedInfo.templateTitle}). Unggah file{' '}
                    <span className="font-mono">.xml</span> sekali saja di sini atau di menu{' '}
                    <strong>Pratinjau</strong> — hasilnya otomatis sinkron di seluruh menu tanpa perlu unggah ulang.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => aiXmlFileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  <span>Unggah File .XML</span>
                </button>
              </div>
            )}

            {/* Verdict & Forensic Summary Banner */}
            <div
              className={`p-4 sm:p-5 rounded-xl border space-y-4 ${
                aiSignatureReport.verdict === 'ai-signed'
                  ? 'border-amber-200 bg-amber-50/50'
                  : aiSignatureReport.verdict === 'ai-assisted'
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-emerald-200 bg-emerald-50/50'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {aiSignatureReport.verdict === 'ai-signed' ? (
                      <Bot className="w-5 h-5 text-amber-700 shrink-0" />
                    ) : aiSignatureReport.verdict === 'ai-assisted' ? (
                      <ShieldAlert className="w-5 h-5 text-blue-700 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" />
                    )}
                    <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                      {aiSignatureReport.verdictLabel}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border tabular-nums ${
                        aiSignatureReport.verdict === 'ai-signed'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : aiSignatureReport.verdict === 'ai-assisted'
                            ? 'bg-blue-100 text-blue-900 border-blue-300'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      }`}
                    >
                      Skor Jejak AI: {aiSignatureReport.confidenceScore}%
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {aiSignatureReport.summary}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-600 pt-0.5">
                    <span>
                      Sumber aktif: <strong className="font-sans text-slate-800">{sourceLabel || parsedInfo.templateTitle}</strong>
                    </span>
                    <span>&middot;</span>
                    <span className="tabular-nums">{formatBytes(byteBreakdown.totalBytes)}</span>
                    {aiSignatureReport.detectedGenerators.length > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>
                          Platform AI: <strong className="text-amber-900">{aiSignatureReport.detectedGenerators.join(', ')}</strong>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {onLoadXmlContent && hasCustomTemplateLoaded && (
                    <button
                      type="button"
                      onClick={() => aiXmlFileInputRef.current?.click()}
                      className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>Ganti File .xml</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isDeepScanningAiSig || !xml.trim()}
                    onClick={() => void handleRunDeepAiSignatureScan()}
                    className="px-3 py-2 bg-white hover:bg-slate-50 disabled:opacity-60 border border-slate-300 text-slate-900 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {isDeepScanningAiSig ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    )}
                    <span>Analisis Mendalam AI</span>
                  </button>

                  {aiSignatureReport.findings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleCleanAllAiSignatures(false)}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Bersihkan Semua Tanda Tangan AI</span>
                    </button>
                  )}

                  {cardUndoHistory['ai-sig-bulk'] && (
                    <button
                      type="button"
                      onClick={() => handleUndoCard('ai-sig-bulk')}
                      className="px-3 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Undo Bersihkan Semua</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Quick forensic breakdown metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/70">
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <div className="text-[11px] text-slate-500">Tanda Tangan Eksplisit</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                    {aiSignatureReport.highConfidenceCount}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <div className="text-[11px] text-slate-500">Indikasi Menengah</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                    {aiSignatureReport.mediumConfidenceCount}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <div className="text-[11px] text-slate-500">Watermark Tak Terlihat</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                    {aiSignatureReport.invisibleWatermarkCount} karakter
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <div className="text-[11px] text-slate-500">Sinyal Gaya Kode AI</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                    {aiSignatureReport.signalCount}
                  </div>
                </div>
              </div>
            </div>

            {aiSigError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start justify-between gap-2 text-xs text-red-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{aiSigError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAiSigError(null)}
                  className="text-red-600 hover:text-red-800 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Optional Deep LLM Result */}
            {deepAiSigResult && (
              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-700" />
                    <span className="text-xs font-semibold text-slate-900">
                      Hasil Analisis Mendalam AI: {deepAiSigResult.verdictLabel} ({Math.round(deepAiSigResult.confidenceScore)}%)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeepAiSigResult(null)}
                    className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{deepAiSigResult.reasoning}</p>
                {deepAiSigResult.detectedTools?.length > 0 && (
                  <div className="text-xs text-slate-700">
                    <strong>Alat teridentifikasi:</strong> {deepAiSigResult.detectedTools.join(', ')}
                  </div>
                )}
                {deepAiSigResult.extraSignatures?.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Jejak Tambahan Ditemukan Model AI ({deepAiSigResult.extraSignatures.length}):
                    </div>
                    {deepAiSigResult.extraSignatures.map((sig, idx) => {
                      const foundLine = (() => {
                        const pos = sig.snippet ? xml.indexOf(sig.snippet) : -1;
                        if (pos === -1) return null;
                        return xml.slice(0, pos).split('\n').length;
                      })();
                      return (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-white border border-blue-200/80 space-y-1.5 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {sig.suspectedTool || 'Indikasi AI'} &middot; {sig.zone}
                              {foundLine ? ` · Baris ${foundLine}` : ''}
                            </span>
                            <div className="flex items-center gap-2">
                              {foundLine && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onJumpToEditorLine ? onJumpToEditorLine(foundLine) : onOpenXmlEditor()
                                  }
                                  className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                                >
                                  Edit di Baris {foundLine}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleCopyText(`deep-${idx}`, sig.snippet)}
                                className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                {copiedId === `deep-${idx}` ? 'Disalin' : 'Salin'}
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600">{sig.reason}</p>
                          <pre className="p-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded text-slate-800 overflow-x-auto whitespace-pre-wrap break-all">
                            {sig.snippet}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Visual Line-Number Location Map for AI Signatures */}
            <AiSignatureLocationMap
              xml={xml}
              findings={aiSignatureReport.findings}
              onJumpToLine={(line) =>
                onJumpToEditorLine ? onJumpToEditorLine(line) : onOpenXmlEditor()
              }
            />

            {/* Findings & In-Place Signature Editor List */}
            <section ref={aiFindingsSectionRef} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Daftar Tanda Tangan &amp; Jejak AI Terdeteksi ({filteredAiSignatures.length})
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Edit langsung teks komentar, tag <span className="font-mono">&lt;meta&gt;</span>, atribut, kredit footer, atau hapus watermark langsung ke file XML aktif.
                  </p>
                </div>
                {aiSignatureReport.findings.some((f) => f.confidence === 'sinyal') && (
                  <button
                    type="button"
                    onClick={() => handleCleanAllAiSignatures(true)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
                  >
                    Bersihkan Termasuk Komentar Gaya AI
                  </button>
                )}
              </div>

              {filteredAiSignatures.length === 0 ? (
                <div className="p-8 text-center border border-slate-200 rounded-xl bg-slate-50/50 space-y-1.5">
                  <p className="text-sm font-semibold text-slate-900">
                    {aiSignatureReport.findings.length === 0
                      ? 'Tidak ada tanda tangan AI ditemukan pada template ini'
                      : 'Tidak ada temuan yang cocok dengan pencarian atau filter ini'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                    {aiSignatureReport.findings.length === 0
                      ? 'Pemindai telah memeriksa komentar XML/HTML, CSS <b:skin>/<style>, JS <script>, <meta>, JSON-LD, atribut data-*, kredit footer, dan karakter watermark Unicode tak terlihat.'
                      : 'Coba ubah kata kunci pencarian atau pilih filter "Semua".'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredAiSignatures.map((finding) => {
                    const isUnicode = finding.category === 'steganographic-unicode';
                    const defaultDraftValue = isUnicode
                      ? stripInvisibleWatermarks(finding.rawSnippet)
                      : finding.rawSnippet;
                    const draft = aiSigDrafts[finding.id] ?? finding.rawSnippet;
                    const isDirty = draft !== finding.rawSnippet;
                    const isMultiline =
                      finding.rawSnippet.includes('\n') || finding.rawSnippet.length > 100;
                    const hasCardUndo = Boolean(cardUndoHistory[finding.id]);

                    return (
                      <div
                        key={finding.id}
                        className="p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-white space-y-2.5 hover:border-slate-300 transition-colors"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-slate-100 text-slate-700 border border-slate-200">
                                {finding.zone}
                              </span>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                                  finding.confidence === 'tinggi'
                                    ? 'bg-amber-50 text-amber-900 border-amber-200'
                                    : finding.confidence === 'sedang'
                                      ? 'bg-blue-50 text-blue-900 border-blue-200'
                                      : 'bg-slate-50 text-slate-700 border-slate-200'
                                }`}
                              >
                                {finding.confidence === 'tinggi'
                                  ? 'Tanda Tangan Kuat'
                                  : finding.confidence === 'sedang'
                                    ? 'Indikasi AI'
                                    : 'Sinyal Gaya'}
                              </span>
                              <span className="text-xs font-semibold text-slate-900">
                                {finding.sourceTool}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {finding.reason}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {hasCardUndo && (
                              <button
                                type="button"
                                onClick={() => handleUndoCard(finding.id)}
                                className="px-2 py-1 text-[11px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg flex items-center gap-1 cursor-pointer"
                              >
                                <Undo2 className="w-3 h-3" />
                                <span>Undo</span>
                              </button>
                            )}
                            <span className="font-mono text-[11px] text-slate-500 tabular-nums px-1.5">
                              Baris {finding.line}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onJumpToEditorLine
                                  ? onJumpToEditorLine(finding.line)
                                  : onOpenXmlEditor()
                              }
                              title={`Buka di Editor XML baris ${finding.line}`}
                              className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Editor</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyText(finding.id, finding.rawSnippet)}
                              className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              {copiedId === finding.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>{copiedId === finding.id ? 'Disalin' : 'Salin'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Editable signature box */}
                        <div className="space-y-2">
                          {isMultiline || isUnicode ? (
                            <textarea
                              rows={isUnicode ? 2 : Math.min(6, Math.max(2, draft.split('\n').length))}
                              value={draft}
                              spellCheck={false}
                              onChange={(e) =>
                                setAiSigDrafts((prev) => ({
                                  ...prev,
                                  [finding.id]: e.target.value,
                                }))
                              }
                              className="w-full p-2.5 text-xs font-mono bg-slate-50 focus:bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                            />
                          ) : (
                            <input
                              type="text"
                              value={draft}
                              spellCheck={false}
                              onChange={(e) =>
                                setAiSigDrafts((prev) => ({
                                  ...prev,
                                  [finding.id]: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 focus:bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                            />
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              {finding.matchedSignals.slice(0, 4).map((sig, i) => (
                                <span
                                  key={i}
                                  className="px-1.5 py-0.5 bg-slate-100 rounded font-mono text-[10px] text-slate-600"
                                >
                                  {sig}
                                </span>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 ml-auto">
                              {isUnicode && defaultDraftValue !== finding.rawSnippet && (
                                <button
                                  type="button"
                                  onClick={() => handleApplyAiSignatureEdit(finding, defaultDraftValue)}
                                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                  <span>Hapus Karakter Watermark</span>
                                </button>
                              )}

                              {isDirty && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleApplyAiSignatureEdit(finding, draft)}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Simpan Edit ke XML</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAiSigDrafts((prev) => {
                                        const copy = { ...prev };
                                        delete copy[finding.id];
                                        return copy;
                                      })
                                    }
                                    className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-xs rounded-lg cursor-pointer"
                                  >
                                    Reset Draf
                                  </button>
                                </>
                              )}

                              {!isUnicode && !isDirty && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const suggested = suggestNeutralizedSnippet(
                                      finding,
                                      parsedInfo.templateTitle || 'Tim Tema Blog'
                                    );
                                    if (!suggested) {
                                      handleRemoveAiSignature(finding);
                                    } else {
                                      setAiSigDrafts((prev) => ({
                                        ...prev,
                                        [finding.id]: suggested,
                                      }));
                                    }
                                  }}
                                  title="Isi otomatis draf netral tanpa tanda tangan AI untuk diedit/disimpan"
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  <Wand2 className="w-3.5 h-3.5 text-blue-600" />
                                  <span>Netralkan Cepat</span>
                                </button>
                              )}

                              {!isUnicode && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAiSignature(finding)}
                                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-medium rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Hapus Tanda Tangan</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'redundancy' && (
          <div className="p-3 sm:p-6 space-y-6">
            {/* Web Worker O(1) Index Cleaner Bar & Progress */}
            <div className="p-4 sm:p-5 border border-slate-200 rounded-xl bg-slate-50/70 space-y-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Pembersih CSS, JS &amp; Variabel CSS Mati (100% Offline Web Worker)
                    </h3>
                    {isLargeFile && (
                      <span className="font-mono text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md tabular-nums">
                        Mode File Besar ({(xml.length / 1024).toFixed(0)} KB)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Menggunakan Inline Blob Web Worker + indexing O(1) <span className="font-mono">Set()</span> tanpa CDN eksternal, isolasi CDATA otomatis, serta validasi ketat <span className="font-mono">DOMParser(&quot;text/xml&quot;)</span> sebelum hasil ditulis.
                  </p>
                  {workerAnalysis && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 tabular-nums pt-0.5">
                      <span>{workerAnalysis.stats.indexedClasses.toLocaleString('id-ID')} class terindeks</span>
                      <span>{workerAnalysis.stats.indexedIds.toLocaleString('id-ID')} ID</span>
                      <span>{workerAnalysis.stats.indexedCssVars.toLocaleString('id-ID')} var(--*)</span>
                      <span>{workerAnalysis.stats.indexedJsRefs.toLocaleString('id-ID')} token JS</span>
                      <span>{workerAnalysis.stats.scanMs} ms</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isWorkerBusy}
                    onClick={() => void handleRunWorkerAnalyze(false)}
                    className="px-3 py-2 bg-white hover:bg-slate-100 disabled:opacity-60 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isWorkerBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Scan Ulang (Web Worker)</span>
                  </button>

                  <button
                    type="button"
                    disabled={isWorkerBusy}
                    onClick={handleRunWorkerClean}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isWorkerBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>Bersihkan Otomatis (Web Worker)</span>
                  </button>

                  <button
                    type="button"
                    disabled={isWorkerBusy}
                    onClick={handleMinifyCssInXml}
                    className="px-3 py-2 bg-white hover:bg-slate-100 disabled:opacity-60 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Minify CSS</span>
                  </button>

                  <button
                    type="button"
                    disabled={isWorkerBusy}
                    onClick={handleMinifyJsInXml}
                    className="px-3 py-2 bg-white hover:bg-slate-100 disabled:opacity-60 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Minify JS</span>
                  </button>

                  {isWorkerBusy && (
                    <button
                      type="button"
                      onClick={handleCancelWorker}
                      className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Batal</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Clean Category Toggles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 border-t border-slate-200/80">
                {(
                  [
                    ['removeUnusedCssRules', 'Aturan CSS Mati'],
                    ['removeUnusedCssVars', 'Variabel --* Mati'],
                    ['removeDeadJsFunctions', 'Fungsi JS Mati'],
                    ['removeCssJsComments', 'Komentar CSS/JS'],
                    ['removeDuplicateCssRules', 'Aturan CSS Ganda'],
                    ['removeDuplicateAssets', 'Tag CSS/JS Ganda'],
                  ] as Array<[keyof DeadCleanOptions, string]>
                ).map(([optKey, optLabel]) => (
                  <label
                    key={optKey}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(cleanOptions[optKey])}
                      onChange={(e) =>
                        setCleanOptions((prev) => ({
                          ...prev,
                          [optKey]: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-300 text-slate-900 focus:ring-blue-600"
                    />
                    <span className="truncate">{optLabel}</span>
                  </label>
                ))}
              </div>

              {/* Dynamic Auto-Detected Safelist Prefix Manager */}
              <SafelistPrefixManager
                chips={activeSafelistChips}
                cssPrefixRuleCounts={workerAnalysis?.cssPrefixRuleCounts}
                isScanning={isWorkerBusy}
                onAddManualPrefix={handleAddManualSafelist}
                onRemovePrefix={handleRemoveSafelistPrefix}
                onResetAutoDetect={handleResetSafelistAutoDetect}
              />

              {/* Real-time Worker Progress */}
              {isWorkerBusy && workerProgress && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium text-blue-950">
                    <span className="truncate">{workerProgress.message}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono tabular-nums">{workerProgress.percent}%</span>
                      <button
                        type="button"
                        onClick={handleCancelWorker}
                        className="px-2 py-0.5 text-[11px] font-medium bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded cursor-pointer"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-blue-200/70 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-150"
                      style={{ width: `${Math.min(100, Math.max(5, workerProgress.percent))}%` }}
                    />
                  </div>
                </div>
              )}

              {workerError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start justify-between gap-2 text-xs text-red-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{workerError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWorkerError(null)}
                    className="text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Post-clean Statistics Report + Copy & Download */}
              {cleanResult && (
                <div
                  className={`p-3.5 rounded-xl border space-y-3 ${
                    cleanResult.validationPassed && !cleanResult.rolledBackToValid
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-amber-50/70 border-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          cleanResult.validationPassed && !cleanResult.rolledBackToValid
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      />
                      <span>
                        {cleanResult.rolledBackToValid
                          ? 'Rollback Aman: Pembersihan dibatalkan karena berisiko memicu <parsererror>'
                          : cleanResult.validationPassed
                            ? 'Ringkasan Pembersihan — Lolos Validasi DOMParser("text/xml")'
                            : 'Ringkasan Pembersihan — Validasi XML Memerlukan Tinjauan'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyCleanedXml}
                        className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {cleanResultCopied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{cleanResultCopied ? 'Disalin' : 'Salin XML Bersih'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void downloadXmlFile(
                            cleanResult.cleanedXml,
                            parsedInfo.templateTitle || 'template-blogger-bersih'
                          )
                        }
                        className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh .XML</span>
                      </button>
                      {canShareMobile && (
                        <button
                          type="button"
                          onClick={() =>
                            void shareXmlFileViaNavigator(
                              cleanResult.cleanedXml,
                              parsedInfo.templateTitle || 'template-blogger-bersih'
                            )
                          }
                          className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Simpan via Share HP</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono tabular-nums">
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <div className="text-[10px] font-sans text-slate-500">Hemat Ukuran</div>
                      <div className="font-semibold text-emerald-700">
                        {formatBytes(cleanResult.stats.savedBytes)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <div className="text-[10px] font-sans text-slate-500">CSS Mati</div>
                      <div className="font-semibold text-slate-900">
                        {cleanResult.stats.removedCssRulesCount}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <div className="text-[10px] font-sans text-slate-500">Var --* Mati</div>
                      <div className="font-semibold text-slate-900">
                        {cleanResult.stats.removedCssVarsCount}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <div className="text-[10px] font-sans text-slate-500">Fungsi JS Mati</div>
                      <div className="font-semibold text-slate-900">
                        {cleanResult.stats.removedJsFunctionsCount}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <div className="text-[10px] font-sans text-slate-500">Komentar/Duplikat</div>
                      <div className="font-semibold text-slate-900">
                        {cleanResult.stats.removedCommentsCount +
                          cleanResult.stats.removedDuplicateCssCount +
                          cleanResult.stats.removedDuplicateJsCount}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <div className="text-[10px] font-sans text-slate-500">Durasi Worker</div>
                      <div className="font-semibold text-slate-900">
                        {cleanResult.stats.durationMs} ms
                      </div>
                    </div>
                  </div>

                  {cleanResult.removedItemsDetail && cleanResult.removedItemsDetail.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-slate-800">
                          Daftar Verifikasi Item Dihapus &amp; Alasannya ({cleanResult.removedItemsDetail.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const txt = cleanResult.removedItemsDetail
                              .map(
                                (item, idx) =>
                                  `${idx + 1}. [${item.kind}] ${item.name} (Baris ${item.line}, -${item.savedBytes} B) — ${item.reason}`
                              )
                              .join('\n');
                            navigator.clipboard?.writeText(txt).catch(() => {});
                          }}
                          className="text-[11px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Salin Daftar Audit</span>
                        </button>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                        {cleanResult.removedItemsDetail.map((item, idx) => (
                          <div key={idx} className="px-3 py-2 text-[11px] space-y-0.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-slate-900 break-all">
                                {item.name}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0">
                                {item.kind} &middot; Baris {item.line} &middot; -{item.savedBytes} B
                              </span>
                            </div>
                            <p className="text-slate-600 leading-snug">{item.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {lastDiffSnapshot && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-semibold text-slate-900">{lastDiffSnapshot.title}</span>
                          {lastDiffSnapshot.subtitle && (
                            <span className="ml-2 text-slate-500">{lastDiffSnapshot.subtitle}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setLastDiffSnapshot(null)}
                          className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                        >
                          Tutup Diff
                        </button>
                      </div>
                      <DiffViewerPanel
                        beforeText={lastDiffSnapshot.before}
                        afterText={lastDiffSnapshot.after}
                      />
                    </div>
                  )}
                </div>
              )}

              {!cleanResult && lastDiffSnapshot && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{lastDiffSnapshot.title}</span>
                      {lastDiffSnapshot.subtitle && (
                        <span className="ml-2 text-slate-500">{lastDiffSnapshot.subtitle}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setLastDiffSnapshot(null)}
                      className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                    >
                      Tutup Diff
                    </button>
                  </div>
                  <DiffViewerPanel
                    beforeText={lastDiffSnapshot.before}
                    afterText={lastDiffSnapshot.after}
                  />
                </div>
              )}
            </div>

            {/* Summary Metrics Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
              <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70">
                <div className="text-[11px] font-medium text-slate-500">CSS Ganda</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {redundancyReport.totalDuplicateCssCount}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {redundancyReport.duplicateCssAssets.length} URL/@import &middot;{' '}
                  {redundancyReport.duplicateCssRules.length} aturan
                </div>
              </div>

              <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70">
                <div className="text-[11px] font-medium text-slate-500">JS Ganda</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {redundancyReport.totalDuplicateJsCount}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Eksternal &amp; skrip inline identik
                </div>
              </div>

              <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70">
                <div className="text-[11px] font-medium text-slate-500">CSS Tak Dipakai</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {redundancyReport.unusedCssRules.length}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {redundancyReport.unusedCssRules.filter((u) => u.confidence === 'pasti').length} pasti mati &middot;{' '}
                  {redundancyReport.unusedCssVars.length} var mati
                </div>
              </div>

              <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70">
                <div className="text-[11px] font-medium text-slate-500">Fungsi JS Mati</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                  {unusedJsFunctions.length}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Deklarasi top-level tidak dipanggil
                </div>
              </div>

              <div className="p-3.5 border border-slate-200 rounded-xl bg-emerald-50/60 col-span-2 lg:col-span-1">
                <div className="text-[11px] font-medium text-emerald-800">Potensi Hemat Byte</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-emerald-950 mt-0.5">
                  {formatBytes(
                    redundancyReport.totalEstimatedSavingsBytes +
                      unusedJsFunctions.reduce((acc, f) => acc + f.estimatedBytes, 0)
                  )}
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5">
                  Aman dibersihkan via Worker
                </div>
              </div>
            </div>

            {/* Batch Cleanup Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {(redundancyReport.duplicateCssAssets.length > 0 ||
                redundancyReport.duplicateJsAssets.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    const allExtraTags = [
                      ...redundancyReport.duplicateCssAssets.flatMap((a) => a.removableRawTags),
                      ...redundancyReport.duplicateJsAssets.flatMap((a) => a.removableRawTags),
                    ];
                    const allExtraRanges = [
                      ...redundancyReport.duplicateCssAssets.flatMap(
                        (a) => a.removableRanges || []
                      ),
                      ...redundancyReport.duplicateJsAssets.flatMap(
                        (a) => a.removableRanges || []
                      ),
                    ];
                    const nextXml = removeDuplicateAssetsFromXml(
                      xml,
                      allExtraTags,
                      allExtraRanges
                    );
                    applySingleCleanupChecked(
                      nextXml,
                      `${allExtraTags.length} tag CSS/JS duplikat dihapus dari XML (tag pertama tetap dipertahankan).`
                    );
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Semua Tag CSS &amp; JS Ganda</span>
                </button>
              )}

              {redundancyReport.duplicateCssRules.some(
                (r) =>
                  r.removableRawRules.length > 0 ||
                  (r.removableRanges && r.removableRanges.length > 0)
              ) && (
                <button
                  type="button"
                  onClick={() => {
                    const removable = redundancyReport.duplicateCssRules.filter(
                      (r) =>
                        r.removableRawRules.length > 0 ||
                        (r.removableRanges && r.removableRanges.length > 0)
                    );
                    const nextXml = removeDuplicateCssRulesFromXml(xml, removable);
                    applySingleCleanupChecked(
                      nextXml,
                      `Duplikat aturan/variabel CSS dari ${removable.length} item berhasil dibersihkan.`
                    );
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>
                    Bersihkan Aturan &amp; Var CSS Ganda (
                    {
                      redundancyReport.duplicateCssRules.filter(
                        (r) =>
                          r.removableRawRules.length > 0 ||
                          (r.removableRanges && r.removableRanges.length > 0)
                      ).length
                    }
                    )
                  </span>
                </button>
              )}

              {redundancyReport.unusedCssRules.some((r) => r.confidence === 'pasti') && (
                <button
                  type="button"
                  onClick={() => {
                    const sureUnused = redundancyReport.unusedCssRules.filter(
                      (r) => r.confidence === 'pasti'
                    );
                    const nextXml = removeUnusedCssRulesFromXml(xml, sureUnused);
                    applySingleCleanupChecked(
                      nextXml,
                      `${sureUnused.length} aturan CSS yang pasti tidak dipanggil berhasil dihapus dari template.`
                    );
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    Bersihkan CSS Pasti Tak Dipakai (
                    {redundancyReport.unusedCssRules.filter((r) => r.confidence === 'pasti').length})
                  </span>
                </button>
              )}

              {redundancyReport.unusedCssVars.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const nextXml = removeUnusedCssVarsFromXml(xml, redundancyReport.unusedCssVars);
                    applySingleCleanupChecked(
                      nextXml,
                      `${redundancyReport.unusedCssVars.length} variabel CSS mati (--*) berhasil dihapus dari template.`
                    );
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-red-50 border border-slate-300 hover:border-red-300 text-slate-800 hover:text-red-700 text-xs font-medium rounded-lg cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                  <span>Bersihkan Var Mati ({redundancyReport.unusedCssVars.length})</span>
                </button>
              )}
            </div>

            {totalRedundancyBadge === 0 && redundancyReport.unusedCssVars.length === 0 && !isWorkerBusy && (
              <div className="p-8 text-center border border-emerald-200 rounded-xl bg-emerald-50/50 space-y-1.5">
                <p className="text-sm font-semibold text-emerald-900">
                  Template bersih: Tidak ada CSS ganda, JS ganda, fungsi JS mati, atau CSS mati yang terdeteksi
                </p>
                <p className="text-xs text-emerald-800">
                  Seluruh link stylesheet, skrip JavaScript, aturan selector CSS, dan custom properties dipakai secara aktif.
                </p>
              </div>
            )}

            {/* 1. Duplicate External CSS & Rules */}
            {(redundancyFilter === 'all' || redundancyFilter === 'dup-css') && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Deteksi CSS Ganda — Link Stylesheet, @import, Aturan &amp; Selector Berulang (
                    {filteredDupCssAssets.length + filteredDupCssRules.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Membandingkan cakupan <span className="font-mono">@media</span> secara akurat agar override responsif ponsel tidak salah dianggap duplikat.
                  </p>
                </div>

                {filteredDupCssAssets.length === 0 && filteredDupCssRules.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    Tidak ada CSS ganda yang ditemukan pada filter ini.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {filteredDupCssAssets.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-white space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-xs font-semibold text-slate-900 break-words">
                              {item.label} &middot;{' '}
                              <span className="font-mono text-amber-700 tabular-nums">
                                {item.occurrences}&times; dipanggil
                              </span>
                            </div>
                            <p className="text-xs text-slate-600">{item.reason}</p>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              Baris: {item.lines.join(', ')} &middot; Hemat ~{formatBytes(item.estimatedSavedBytes)}
                            </div>
                          </div>
                          {(item.removableRawTags.length > 0 ||
                            (item.removableRanges && item.removableRanges.length > 0)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextXml = removeDuplicateAssetsFromXml(
                                  xml,
                                  item.removableRawTags,
                                  item.removableRanges
                                );
                                onUpdateXml(
                                  nextXml,
                                  `Duplikat CSS "${item.label}" dihapus (baris pertama dipertahankan).`
                                );
                              }}
                              className="w-full sm:w-auto px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-medium rounded-lg flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Hapus Duplikat</span>
                            </button>
                          )}
                        </div>
                        <div className="space-y-1 pt-1 border-t border-slate-100">
                          {item.urlsOrSnippets.map((u, idx) => (
                            <div
                              key={idx}
                              className="text-[11px] font-mono text-slate-600 truncate"
                            >
                              #{idx + 1} (Baris {item.lines[idx] || '-'}): {u}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {filteredDupCssRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-white space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-xs font-mono font-semibold text-slate-900 break-all">
                              {rule.selector}
                            </div>
                            <div className="text-xs text-slate-600">{rule.reason}</div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              Sumber: &lt;{rule.source}&gt; &middot; Baris {rule.lines.join(', ')}
                              {rule.estimatedSavedBytes > 0
                                ? ` · Hemat ~${formatBytes(rule.estimatedSavedBytes)}`
                                : ''}
                            </div>
                          </div>
                          {(rule.removableRawRules.length > 0 ||
                            (rule.removableRanges && rule.removableRanges.length > 0)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextXml = removeDuplicateCssRulesFromXml(xml, [rule]);
                                onUpdateXml(
                                  nextXml,
                                  `Duplikat CSS "${rule.selector}" berhasil dibersihkan dari XML.`
                                );
                              }}
                              className="w-full sm:w-auto px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-medium rounded-lg flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>
                                {rule.duplicateType === 'repeated-selector'
                                  ? 'Hapus Blok Awal'
                                  : rule.duplicateType === 'duplicate-css-var'
                                    ? 'Hapus Var Tertimpa'
                                    : 'Hapus Duplikat'}
                              </span>
                            </button>
                          )}
                        </div>
                        <pre className="p-2.5 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 overflow-x-auto whitespace-pre-wrap break-all">
                          {rule.sampleBody}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 2. Duplicate External & Inline JS */}
            {(redundancyFilter === 'all' || redundancyFilter === 'dup-js') && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Deteksi JS Ganda — Script URL, Pustaka CDN &amp; Inline Identik (
                    {filteredDupJsAssets.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mendeteksi pemanggilan ulang jQuery, AdSense, gtag.js, URL <span className="font-mono">.js</span> yang sama, maupun blok <span className="font-mono">&lt;script&gt;</span> inline kembar.
                  </p>
                </div>

                {filteredDupJsAssets.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    Tidak ada JavaScript ganda terdeteksi.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {filteredDupJsAssets.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-white space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-xs font-semibold text-slate-900 break-words">
                              {item.label} &middot;{' '}
                              <span className="font-mono text-red-700 tabular-nums">
                                {item.occurrences}&times; dimuat
                              </span>
                            </div>
                            <p className="text-xs text-slate-600">{item.reason}</p>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              Baris: {item.lines.join(', ')} &middot; Hemat ~{formatBytes(item.estimatedSavedBytes)}
                            </div>
                          </div>
                          {(item.removableRawTags.length > 0 ||
                            (item.removableRanges && item.removableRanges.length > 0)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextXml = removeDuplicateAssetsFromXml(
                                  xml,
                                  item.removableRawTags,
                                  item.removableRanges
                                );
                                onUpdateXml(
                                  nextXml,
                                  `Duplikat JS "${item.label}" dihapus (salinan pertama dipertahankan).`
                                );
                              }}
                              className="w-full sm:w-auto px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-medium rounded-lg flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Hapus Duplikat JS</span>
                            </button>
                          )}
                        </div>
                        <div className="space-y-1 pt-1 border-t border-slate-100">
                          {item.urlsOrSnippets.map((u, idx) => (
                            <div
                              key={idx}
                              className="text-[11px] font-mono text-slate-600 truncate"
                            >
                              #{idx + 1} (Baris {item.lines[idx] || '-'}): {u}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 3. Unused / Uncalled CSS Selectors */}
            {(redundancyFilter === 'all' || redundancyFilter === 'unused-css') && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    CSS Tidak Dipakai &amp; Tidak Dipanggil Sama Sekali (
                    {filteredUnusedCssRules.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Memeriksa kemunculan kelas &amp; ID di HTML, tag Blogger (<span className="font-mono">&lt;b:class&gt;</span>, <span className="font-mono">expr:class</span>), dan JavaScript. Status <strong>Pasti Mati</strong> aman langsung dihapus.
                  </p>
                </div>

                {filteredUnusedCssRules.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    Semua selector CSS yang terpasang terdeteksi dipanggil di template.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredUnusedCssRules.map((rule) => (
                      <div key={rule.id} className="p-3.5 sm:p-4 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono font-semibold text-slate-900 break-all">
                                {rule.selector}
                              </span>
                              <span
                                className={`text-[11px] font-semibold ${
                                  rule.confidence === 'pasti'
                                    ? 'text-red-700'
                                    : 'text-amber-700'
                                }`}
                              >
                                &middot;{' '}
                                {rule.confidence === 'pasti'
                                  ? 'Pasti Tidak Dipanggil'
                                  : 'Kemungkinan Runtime Blogger'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed">{rule.reason}</p>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              &lt;{rule.source}&gt; &middot; Baris {rule.line} &middot;{' '}
                              {formatBytes(rule.estimatedBytes)}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const nextXml = removeUnusedCssRulesFromXml(xml, [rule]);
                              onUpdateXml(
                                nextXml,
                                `Aturan CSS "${rule.selector}" dihapus dari XML.`
                              );
                            }}
                            className="w-full sm:w-auto px-3 py-1.5 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-700 hover:text-red-700 text-xs font-medium rounded-lg flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus Aturan Ini</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 4. Unused CSS Custom Properties (--var) */}
            {(redundancyFilter === 'all' || redundancyFilter === 'unused-vars') && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Variabel CSS (--*) Tidak Pernah Dipanggil ({filteredUnusedCssVars.length})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deklarasi custom property CSS yang tidak memiliki pemanggilan <span className="font-mono">var(--nama)</span> di CSS, variabel berantai, maupun JavaScript.
                    </p>
                  </div>
                </div>

                {filteredUnusedCssVars.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    Seluruh variabel CSS terpakai dengan baik.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredUnusedCssVars.map((v) => (
                      <div
                        key={v.id}
                        className="p-3 sm:px-4 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div>
                            <span className="font-mono font-semibold text-slate-900">{v.name}</span>
                            <span className="font-mono text-slate-500 ml-2">= {v.value}</span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-0.5">
                            {v.selector} &middot; Baris {v.line}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const nextXml = removeUnusedCssVarsFromXml(xml, [v]);
                            applySingleCleanupChecked(
                              nextXml,
                              `Variabel CSS mati "${v.name}" dihapus dari XML.`
                            );
                          }}
                          className="px-2.5 py-1.5 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-700 hover:text-red-700 text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus Var Ini</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 5. Unused Top-Level JavaScript Functions */}
            {(redundancyFilter === 'all' || redundancyFilter === 'unused-js') && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Fungsi JavaScript Mati Tidak Pernah Dipanggil ({filteredUnusedJsFunctions.length})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deklarasi <span className="font-mono">function nama()</span> top-level di dalam <span className="font-mono">&lt;script&gt;</span> yang tidak memiliki referensi pemanggilan di HTML atribut (<span className="font-mono">onclick</span>, dll.) maupun blok JS lainnya.
                    </p>
                  </div>
                </div>

                {filteredUnusedJsFunctions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    {workerAnalysis
                      ? 'Tidak ada fungsi JavaScript top-level mati terdeteksi.'
                      : 'Klik "Scan Ulang (Web Worker)" untuk memindai fungsi JS top-level mati.'}
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredUnusedJsFunctions.map((fn) => (
                      <div key={fn.id} className="p-3.5 sm:p-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="text-xs font-mono font-semibold text-slate-900">
                              function {fn.name}({fn.params})
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              Baris {fn.line} &middot; {formatBytes(fn.estimatedBytes)}
                            </div>
                          </div>
                        </div>
                        <pre className="p-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 overflow-x-auto whitespace-pre-wrap break-all">
                          {fn.preview}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === 'page-texts' && (
          <div className="p-3 sm:p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Deteksi Teks Halaman — Header, Footer, Widget &amp; Navigasi ({filteredPageTexts.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Setiap perubahan yang Anda simpan akan langsung menulis ke kode template XML aktif dan memperbarui pratinjau seketika.
              </p>
            </div>

            {filteredPageTexts.length === 0 ? (
              <div className="p-8 text-center border border-slate-200 rounded-lg bg-slate-50/50">
                <p className="text-xs font-medium text-slate-700">
                  Tidak ada teks statis pada zona ini.
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Coba pilih filter &quot;Semua&quot; atau periksa tab Widget &amp; Navigasi.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {filteredPageTexts.map((item) => {
                  const draft = pageTextDrafts[item.id] ?? item.text;
                  const isDirty = draft !== item.text;
                  const isMultiline = item.text.length > 90 || item.text.includes('\n');
                  const aiTextEval = evaluatePageTextWithOfflineAi(item);
                  const isDynamic =
                    Boolean(item.isDynamic) ||
                    containsBloggerDynamicSyntax(item.text, item.rawSnippet);
                  const isDynamicUnlocked = Boolean(unlockedDynamicCards[item.id]);
                  const isDynamicLocked = isDynamic && !isDynamicUnlocked;
                  const hasCardUndo = Boolean(cardUndoHistory[item.id]);

                  return (
                    <div key={item.id} className="p-3.5 sm:p-4 space-y-2 hover:bg-slate-50/60 transition-colors">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-slate-100 text-slate-700 shrink-0">
                            {item.zone}
                          </span>
                          {isDynamic && (
                            <span
                              title="Mengandung tag/variabel dinamis Blogger (<b:if>, <b:with>, data:..., expr:...)"
                              className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-amber-100 text-amber-900 border border-amber-300 shrink-0"
                            >
                              DINAMIS
                            </span>
                          )}
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {item.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {hasCardUndo && (
                            <button
                              type="button"
                              onClick={() => handleUndoCard(item.id)}
                              title="Batalkan perubahan terakhir pada kartu ini"
                              className="px-2 py-0.5 text-[11px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded flex items-center gap-1 cursor-pointer"
                            >
                              <Undo2 className="w-3 h-3" />
                              <span>Undo</span>
                            </button>
                          )}
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            Baris {item.line}
                          </span>
                        </div>
                      </div>

                      {isDynamic && (
                        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50/80 border border-amber-200 text-[11px] text-amber-900">
                          <span className="flex items-center gap-1.5">
                            {isDynamicLocked ? (
                              <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            )}
                            <span>
                              {isDynamicLocked
                                ? 'Mode timpa statis dikunci otomatis untuk melindungi variabel SEO / tag Blogger bawaan.'
                                : 'Kunci dinamis dibuka manual — berhati-hatilah agar sintaks Blogger tidak tertimpa.'}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setUnlockedDynamicCards((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className="px-2 py-0.5 bg-white hover:bg-amber-100 border border-amber-300 rounded font-medium text-amber-950 whitespace-nowrap cursor-pointer"
                          >
                            {isDynamicLocked ? 'Buka Kunci' : 'Kunci Kembali'}
                          </button>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        {isMultiline ? (
                          <textarea
                            rows={2}
                            value={draft}
                            readOnly={isDynamicLocked}
                            onChange={(e) =>
                              setPageTextDrafts((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className={`flex-1 w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 ${
                              isDynamicLocked
                                ? 'bg-slate-100 text-slate-500 font-mono cursor-not-allowed'
                                : 'bg-white text-slate-900'
                            }`}
                          />
                        ) : (
                          <input
                            type="text"
                            value={draft}
                            readOnly={isDynamicLocked}
                            onChange={(e) =>
                              setPageTextDrafts((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className={`flex-1 w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 ${
                              isDynamicLocked
                                ? 'bg-slate-100 text-slate-500 font-mono cursor-not-allowed'
                                : 'bg-white text-slate-900'
                            }`}
                          />
                        )}

                        {isDirty && !isDynamicLocked && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const nextXml = updatePageTextInXml(xml, item, draft);
                                setPageTextDrafts((prev) => {
                                  const copy = { ...prev };
                                  delete copy[item.id];
                                  return copy;
                                });
                                commitCardXmlChange(
                                  item.id,
                                  nextXml,
                                  `Teks "${item.label}" berhasil ditulis ke template XML.`,
                                  item.label
                                );
                              }}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Simpan ke XML</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPageTextDrafts((prev) => {
                                  const copy = { ...prev };
                                  delete copy[item.id];
                                  return copy;
                                })
                              }
                              title="Batalkan draf"
                              className="p-1.5 text-slate-400 hover:text-slate-700 border border-slate-200 rounded-lg bg-white cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {aiTextEval.status !== 'optimal' && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                          <span
                            className={
                              aiTextEval.status === 'perhatian'
                                ? 'text-amber-800'
                                : 'text-blue-800'
                            }
                          >
                            AI Offline: {aiTextEval.insight}
                          </span>
                          {!isDynamicLocked && aiTextEval.suggestedText && aiTextEval.suggestedText !== draft && (
                            <button
                              type="button"
                              onClick={() =>
                                setPageTextDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: aiTextEval.suggestedText || draft,
                                }))
                              }
                              className="font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Isi Saran AI Offline
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'xml-vars' && (
          <>
            {filteredXmlVars.length === 0 ? (
              <div className="p-12 text-center max-w-lg mx-auto">
                <p className="text-sm font-medium text-slate-800">
                  Tidak ada tag &lt;Variable&gt; Blogger ditemukan
                </p>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Banyak tema modern menyimpan warna di <strong>CSS Vars</strong> atau langsung di aturan CSS. Periksa tab{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('css-vars')}
                    className="text-blue-600 hover:underline font-medium cursor-pointer"
                  >
                    CSS Vars ({parsedInfo.cssCustomProperties.length})
                  </button>{' '}
                  atau{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('widgets-nav')}
                    className="text-blue-600 hover:underline font-medium cursor-pointer"
                  >
                    Widget &amp; Navigasi
                  </button>
                  .
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr className="text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-6">Variabel &amp; Deskripsi</th>
                    <th className="py-2.5 px-4">Sumber / Grup</th>
                    <th className="py-2.5 px-4">Tipe</th>
                    <th className="py-2.5 px-4">Bawaan</th>
                    <th className="py-2.5 px-6">Nilai Aktif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredXmlVars.map((v) => {
                    const current = variableValues[v.name] ?? v.value;
                    const isModified = current !== v.defaultValue;
                    const isColor =
                      v.type.toLowerCase() === 'color' || /^#[0-9a-f]{3,8}$/i.test(current);

                    return (
                      <tr key={v.name} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-6">
                          <div className="font-medium text-slate-900">{v.description}</div>
                          <div className="font-mono text-[11px] text-slate-400">{v.name}</div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          <div>{v.group || 'Umum'}</div>
                          <div className="font-mono text-[10px] text-slate-400">{v.source || 'b:skin'}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{v.type}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">
                          {v.defaultValue || '-'}
                        </td>
                        <td className="py-2.5 px-6">
                          <div className="flex items-center gap-2">
                            {isColor && (
                              <input
                                type="color"
                                value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#1d4ed8'}
                                onChange={(e) => onVariableChange(v.name, e.target.value)}
                                aria-label={`Pilih warna ${v.name}`}
                                className="w-7 h-7 p-0.5 rounded border border-slate-200 bg-white cursor-pointer shrink-0"
                              />
                            )}
                            <input
                              type="text"
                              value={current}
                              onChange={(e) => onVariableChange(v.name, e.target.value)}
                              className="w-48 px-2.5 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                            />
                            {isModified && (
                              <button
                                type="button"
                                onClick={() => onResetVariable(v.name, v.defaultValue)}
                                title="Kembalikan nilai bawaan"
                                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'css-vars' && (
          <>
            {filteredCssVars.length === 0 ? (
              <div className="p-12 text-center max-w-lg mx-auto">
                <p className="text-sm font-medium text-slate-800">
                  Tidak ada CSS Custom Property (--*) terdeteksi
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Template ini tidak mendeklarasikan variabel CSS seperti <span className="font-mono">--primary-color</span> di dalam blok style.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr className="text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-6">Nama Token CSS</th>
                    <th className="py-2.5 px-4">Selector</th>
                    <th className="py-2.5 px-4">Tipe</th>
                    <th className="py-2.5 px-4">Dipakai</th>
                    <th className="py-2.5 px-6">Nilai Aktif (Real-Time &amp; Ekspor)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredCssVars.map((prop) => {
                    const key = `${prop.selector}::${prop.name}`;
                    const current = cssVarValues[key] ?? prop.value;
                    const isModified = current !== prop.value;
                    const isHex = /^#[0-9a-f]{6}$/i.test(current);

                    return (
                      <tr key={key} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-6 font-mono font-medium text-slate-900">
                          {prop.name}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-[180px] truncate">
                          {prop.selector}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{prop.valueType}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">
                          {prop.occurrences}&times;
                        </td>
                        <td className="py-2.5 px-6">
                          <div className="flex items-center gap-2">
                            {(prop.valueType === 'color' || isHex) && (
                              <input
                                type="color"
                                value={isHex ? current : '#1d4ed8'}
                                onChange={(e) => onCssVarChange(key, e.target.value)}
                                aria-label={`Ubah warna ${prop.name}`}
                                className="w-7 h-7 p-0.5 rounded border border-slate-200 bg-white cursor-pointer shrink-0"
                              />
                            )}
                            <input
                              type="text"
                              value={current}
                              onChange={(e) => onCssVarChange(key, e.target.value)}
                              className="w-56 px-2.5 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                            />
                            {isModified && (
                              <button
                                type="button"
                                onClick={() => onResetCssVar(key)}
                                title="Kembalikan nilai asli"
                                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'hardcoded' && (
          <div className="p-6 space-y-8">
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Warna Hex Dominan dalam CSS ({filteredColors.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deteksi otomatis seluruh kode warna yang ditulis langsung di dalam <span className="font-mono">&lt;b:skin&gt;</span> dan <span className="font-mono">&lt;style&gt;</span>.
                </p>
              </div>

              {filteredColors.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">Tidak ada kode warna hex statis ditemukan.</p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[11px] font-semibold text-slate-500">
                        <th className="py-2.5 px-4">Warna Asli</th>
                        <th className="py-2.5 px-4">Frekuensi</th>
                        <th className="py-2.5 px-4">Contoh Aturan CSS</th>
                        <th className="py-2.5 px-4">Ganti Global Menjadi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredColors.map((item) => {
                        const replacement = colorReplacements[item.color] || item.color;
                        const isChanged = replacement.toLowerCase() !== item.color.toLowerCase();
                        return (
                          <tr key={item.color} className="hover:bg-slate-50/70">
                            <td className="py-2 px-4">
                              <div className="flex items-center gap-2 font-mono">
                                <span
                                  className="w-4 h-4 rounded border border-slate-300 shrink-0"
                                  style={{ backgroundColor: item.color }}
                                />
                                <span className="text-slate-900">{item.color}</span>
                              </div>
                            </td>
                            <td className="py-2 px-4 font-mono tabular-nums text-slate-600">
                              {item.count}&times;
                            </td>
                            <td className="py-2 px-4 font-mono text-[11px] text-slate-500 max-w-md truncate">
                              {item.sampleContext}
                            </td>
                            <td className="py-2 px-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={/^#[0-9a-f]{6}$/i.test(replacement) ? replacement : '#1d4ed8'}
                                  onChange={(e) => onColorReplace(item.color, e.target.value)}
                                  aria-label={`Ganti warna ${item.color}`}
                                  className="w-7 h-7 p-0.5 rounded border border-slate-200 bg-white cursor-pointer"
                                />
                                <input
                                  type="text"
                                  value={replacement}
                                  onChange={(e) => onColorReplace(item.color, e.target.value)}
                                  className="w-24 px-2 py-1 text-xs font-mono border border-slate-200 rounded bg-white"
                                />
                                {isChanged && (
                                  <button
                                    type="button"
                                    onClick={() => onResetColorReplace(item.color)}
                                    title="Kembalikan warna asli"
                                    className="p-1 text-slate-400 hover:text-slate-800 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-3 pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Deklarasi Font Family Terdeteksi ({parsedInfo.hardcodedFonts.length})
              </h3>
              {parsedInfo.hardcodedFonts.length === 0 ? (
                <p className="text-xs text-slate-500">Tidak ada deklarasi font-family statis ditemukan.</p>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {parsedInfo.hardcodedFonts.map((f) => (
                    <div
                      key={f.fontFamily}
                      className="px-4 py-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="font-mono text-slate-800">{f.fontFamily}</span>
                      <span className="font-mono tabular-nums text-slate-500">{f.count}&times;</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'widgets-nav' && (
          <div className="p-6 space-y-8">
            {/* Widgets & Direct Title/Locked Editing */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Widget Terdeteksi ({filteredWidgets.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ubah judul widget atau kunci widget langsung ke dalam kode XML template.
                  </p>
                </div>
              </div>

              {filteredWidgets.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">Tidak ada &lt;b:widget&gt; yang cocok.</p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[11px] font-semibold text-slate-500">
                        <th className="py-2.5 px-4">ID &amp; Baris</th>
                        <th className="py-2.5 px-4">Tipe</th>
                        <th className="py-2.5 px-4">Section</th>
                        <th className="py-2.5 px-4">Edit Judul Widget</th>
                        <th className="py-2.5 px-4">Kunci (Locked)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredWidgets.map((w, idx) => {
                        const titleVal = widgetTitleDrafts[w.id] ?? w.title;
                        const isTitleDirty = titleVal !== w.title;
                        const wCardKey = `widget-${w.id}`;
                        const hasWUndo = Boolean(cardUndoHistory[wCardKey]);
                        return (
                          <tr key={`${w.id}-${idx}`} className="hover:bg-slate-50/70">
                            <td className="py-2 px-4">
                              <div className="font-mono font-medium text-slate-900">{w.id}</div>
                              <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 tabular-nums">
                                <span>Baris {w.line || '-'}</span>
                                {hasWUndo && (
                                  <button
                                    type="button"
                                    onClick={() => handleUndoCard(wCardKey)}
                                    title="Batalkan perubahan widget ini"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-sans font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded cursor-pointer"
                                  >
                                    <Undo2 className="w-2.5 h-2.5" />
                                    <span>Undo</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-4 font-mono text-blue-700">{w.type}</td>
                            <td className="py-2 px-4 font-mono text-slate-500">{w.sectionId}</td>
                            <td className="py-2 px-4">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={titleVal}
                                  onChange={(e) =>
                                    setWidgetTitleDrafts((prev) => ({
                                      ...prev,
                                      [w.id]: e.target.value,
                                    }))
                                  }
                                  className="w-48 px-2.5 py-1 text-xs border border-slate-200 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                                />
                                {isTitleDirty && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextXml = updateWidgetAttrInXml(
                                        xml,
                                        w.id,
                                        'title',
                                        titleVal
                                      );
                                      commitCardXmlChange(
                                        wCardKey,
                                        nextXml,
                                        `Judul widget ${w.id} diperbarui ke "${titleVal}".`,
                                        `Widget ${w.id}`
                                      );
                                    }}
                                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Simpan</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-4">
                              <button
                                type="button"
                                onClick={() => {
                                  const nextLocked = w.locked === 'true' ? 'false' : 'true';
                                  const nextXml = updateWidgetAttrInXml(
                                    xml,
                                    w.id,
                                    'locked',
                                    nextLocked
                                  );
                                  commitCardXmlChange(
                                    wCardKey,
                                    nextXml,
                                    `Status locked widget ${w.id} diubah menjadi ${nextLocked}.`,
                                    `Widget ${w.id}`
                                  );
                                }}
                                className="px-2.5 py-1 text-[11px] font-mono border border-slate-200 rounded bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                              >
                                {w.locked === 'true' ? 'true' : 'false'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Widget Settings */}
            {parsedInfo.widgetSettings.length > 0 && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Pengaturan Internal Widget (&lt;b:widget-setting&gt;: {parsedInfo.widgetSettings.length})
                </h3>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[11px] font-semibold text-slate-500">
                        <th className="py-2 px-4">Widget</th>
                        <th className="py-2 px-4">Nama Setting</th>
                        <th className="py-2 px-4">Edit Nilai</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {parsedInfo.widgetSettings.slice(0, 60).map((s, idx) => {
                        const key = `${s.widgetId}::${s.name}`;
                        const wsCardKey = `ws-${key}`;
                        const hasWsUndo = Boolean(cardUndoHistory[wsCardKey]);
                        const val = widgetSettingDrafts[key] ?? s.value;
                        const isDirty = val !== s.value;
                        return (
                          <tr key={`${key}-${idx}`}>
                            <td className="py-2 px-4 font-mono text-slate-700">{s.widgetId}</td>
                            <td className="py-2 px-4 font-mono text-slate-900">{s.name}</td>
                            <td className="py-2 px-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) =>
                                    setWidgetSettingDrafts((prev) => ({
                                      ...prev,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  className="w-72 px-2.5 py-1 text-xs font-mono border border-slate-200 rounded bg-white"
                                />
                                {isDirty && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextXml = updateWidgetSettingInXml(
                                        xml,
                                        s.widgetId,
                                        s.name,
                                        val
                                      );
                                      commitCardXmlChange(
                                        wsCardKey,
                                        nextXml,
                                        `Setting ${s.name} pada ${s.widgetId} diperbarui.`,
                                        `Setting ${s.name}`
                                      );
                                    }}
                                    className="px-2.5 py-1 bg-blue-600 text-white text-[11px] rounded cursor-pointer"
                                  >
                                    Simpan
                                  </button>
                                )}
                                {hasWsUndo && (
                                  <button
                                    type="button"
                                    onClick={() => handleUndoCard(wsCardKey)}
                                    title="Batalkan perubahan setting ini"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded cursor-pointer"
                                  >
                                    <Undo2 className="w-2.5 h-2.5" />
                                    <span>Undo</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Navigation Links */}
            <section className="space-y-3 pt-4 border-t border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Tautan Navigasi Header, Menu &amp; Footer ({filteredNavLinks.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deteksi otomatis tag <span className="font-mono">&lt;a href=&quot;...&quot;&gt;</span> di area header, navbar, widget menu, dan footer. Edit label atau URL langsung di sini.
                </p>
              </div>

              {filteredNavLinks.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  Tidak ada tautan navigasi statis ditemukan (template mungkin merender menu dinamis lewat PageList Blogger).
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[11px] font-semibold text-slate-500">
                        <th className="py-2.5 px-4">Area &amp; Baris</th>
                        <th className="py-2.5 px-4">Teks Tautan</th>
                        <th className="py-2.5 px-4">URL Tujuan (href)</th>
                        <th className="py-2.5 px-4">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredNavLinks.map((nav) => {
                        const draft = navDrafts[nav.index] ?? {
                          text: nav.text,
                          href: nav.href,
                        };
                        const isDirty = draft.text !== nav.text || draft.href !== nav.href;
                        const navCardKey = `nav-${nav.index}`;
                        const hasNavUndo = Boolean(cardUndoHistory[navCardKey]);
                        return (
                          <tr key={nav.index} className="hover:bg-slate-50/70">
                            <td className="py-2 px-4 font-mono">
                              <div className="text-slate-900 font-medium">{nav.zone}</div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 tabular-nums">
                                <span>Baris {nav.line}</span>
                                {hasNavUndo && (
                                  <button
                                    type="button"
                                    onClick={() => handleUndoCard(navCardKey)}
                                    title="Batalkan perubahan tautan ini"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-sans font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded cursor-pointer"
                                  >
                                    <Undo2 className="w-2.5 h-2.5" />
                                    <span>Undo</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-4">
                              <input
                                type="text"
                                value={draft.text}
                                onChange={(e) =>
                                  setNavDrafts((prev) => ({
                                    ...prev,
                                    [nav.index]: { ...draft, text: e.target.value },
                                  }))
                                }
                                className="w-44 px-2.5 py-1 text-xs border border-slate-200 rounded bg-white"
                              />
                            </td>
                            <td className="py-2 px-4">
                              <input
                                type="text"
                                value={draft.href}
                                onChange={(e) =>
                                  setNavDrafts((prev) => ({
                                    ...prev,
                                    [nav.index]: { ...draft, href: e.target.value },
                                  }))
                                }
                                className="w-64 px-2.5 py-1 text-xs font-mono border border-slate-200 rounded bg-white"
                              />
                            </td>
                            <td className="py-2 px-4">
                              {isDirty && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextXml = updateNavLinkInXml(
                                      xml,
                                      nav.rawTag,
                                      draft.href,
                                      draft.text
                                    );
                                    commitCardXmlChange(
                                      navCardKey,
                                      nextXml,
                                      `Tautan navigasi "${draft.text}" berhasil diperbarui.`,
                                      `Navigasi ${nav.zone}`
                                    );
                                  }}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded cursor-pointer"
                                >
                                  Simpan
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'images-svg' && (
          <div className="p-6 space-y-8">
            {/* Images */}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Gambar, Logo, Favicon &amp; URL Media Terdeteksi ({filteredImages.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Menampilkan semua referensi gambar (<span className="font-mono">&lt;img&gt;</span>, <span className="font-mono">url(...)</span> CSS, favicon, dan <span className="font-mono">og:image</span>). Ganti URL di sini untuk memperbarui semua kemunculannya.
                </p>
              </div>

              {filteredImages.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  Tidak ada URL gambar statis ditemukan di dalam template XML.
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[11px] font-semibold text-slate-500">
                        <th className="py-2.5 px-4">Pratinjau</th>
                        <th className="py-2.5 px-4">Sumber &amp; Konteks</th>
                        <th className="py-2.5 px-4">URL Gambar (Edit &amp; Ganti Global)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredImages.map((img) => {
                        const draftUrl = imageDrafts[img.id] ?? img.url;
                        const isDirty = draftUrl !== img.url;
                        const isDynamicExpr = img.sourceKind === 'expr-img' || img.url.includes('data:');
                        const imgCardKey = `img-${img.id}`;
                        const hasImgUndo = Boolean(cardUndoHistory[imgCardKey]);
                        return (
                          <tr key={img.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 w-16">
                              <div className="w-12 h-12 rounded border border-slate-200 bg-slate-100 flex items-center justify-center overflow-hidden">
                                {!isDynamicExpr ? (
                                  <img
                                    src={img.url}
                                    alt={img.context}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <ImageIcon className="w-4 h-4 text-slate-400" />
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{img.context}</div>
                              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-slate-400 tabular-nums">
                                <span>{img.sourceKind} &middot; Baris {img.line || '-'} &middot; {img.count}&times;</span>
                                {hasImgUndo && (
                                  <button
                                    type="button"
                                    onClick={() => handleUndoCard(imgCardKey)}
                                    title="Batalkan perubahan URL gambar ini"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-sans font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded cursor-pointer"
                                  >
                                    <Undo2 className="w-2.5 h-2.5" />
                                    <span>Undo</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={draftUrl}
                                  onChange={(e) =>
                                    setImageDrafts((prev) => ({
                                      ...prev,
                                      [img.id]: e.target.value,
                                    }))
                                  }
                                  className="flex-1 min-w-[240px] px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                                />
                                {isDirty && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextXml = replaceAssetUrlInXml(xml, img.url, draftUrl);
                                      commitCardXmlChange(
                                        imgCardKey,
                                        nextXml,
                                        'URL gambar berhasil diganti di XML.',
                                        img.context
                                      );
                                    }}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    Terapkan
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Inline SVGs */}
            <section className="space-y-3 pt-4 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Ikon &amp; Grafis &lt;svg&gt; Inline Terdeteksi ({filteredSvgs.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Klik &quot;Edit SVG&quot; untuk mengubah warna <span className="font-mono">fill</span> atau bersihkan metadata Figma/Inkscape/komentar untuk meringankan XML.
                  </p>
                </div>
                {filteredSvgs.length > 0 && (
                  <div className="flex items-center gap-2">
                    {cardUndoHistory['svg-bulk-clean'] && (
                      <button
                        type="button"
                        onClick={() => handleUndoCard('svg-bulk-clean')}
                        className="px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Undo Pembersihan SVG</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const res = cleanAllSvgsInXml(xml);
                        if (res.cleanedCount === 0 || res.savedBytes <= 0) {
                          onUpdateXml(xml, 'Semua SVG inline sudah bersih dari metadata berlebih.');
                          return;
                        }
                        commitCardXmlChange(
                          'svg-bulk-clean',
                          res.nextXml,
                          `${res.cleanedCount} SVG inline dibersihkan (hemat ${formatBytes(res.savedBytes)}).`,
                          'Semua SVG Inline'
                        );
                      }}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Bersihkan Metadata Semua SVG</span>
                    </button>
                  </div>
                )}
              </div>

              {filteredSvgs.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  Tidak ada elemen &lt;svg&gt; inline ditemukan dalam template ini.
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {filteredSvgs.map((svg) => {
                    const isExpanded = expandedSvgIdx === svg.index;
                    const draftCode = svgDrafts[svg.index] ?? svg.rawSvg;
                    const isDirty = draftCode !== svg.rawSvg;
                    const svgCardKey = `svg-${svg.index}`;
                    const hasSvgUndo = Boolean(cardUndoHistory[svgCardKey]);

                    return (
                      <div key={svg.index} className="p-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-10 h-10 rounded border border-slate-200 bg-slate-50 flex items-center justify-center p-1.5 text-slate-800 shrink-0 [&>svg]:w-full [&>svg]:h-full"
                              dangerouslySetInnerHTML={{
                                __html: sanitizeSvgForPreview(svg.rawSvg),
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {svg.context}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 tabular-nums truncate">
                                Baris {svg.line} &middot; viewBox: {svg.viewBox} &middot; {svg.width} &times; {svg.height} &middot; fill: {svg.fill}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {hasSvgUndo && (
                              <button
                                type="button"
                                onClick={() => handleUndoCard(svgCardKey)}
                                className="px-2 py-1.5 text-[11px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg flex items-center gap-1 cursor-pointer"
                              >
                                <Undo2 className="w-3 h-3" />
                                <span>Undo</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const cleanedRes = cleanInlineSvgMarkup(svg.rawSvg);
                                if (!cleanedRes.changed) {
                                  onUpdateXml(xml, `SVG #${svg.index + 1} sudah bersih.`);
                                  return;
                                }
                                const nextXml = replaceSvgByIndexInXml(
                                  xml,
                                  svg.index,
                                  cleanedRes.cleanedSvg
                                );
                                setSvgDrafts((prev) => ({
                                  ...prev,
                                  [svg.index]: cleanedRes.cleanedSvg,
                                }));
                                commitCardXmlChange(
                                  svgCardKey,
                                  nextXml,
                                  `Metadata SVG #${svg.index + 1} dibersihkan (hemat ${cleanedRes.savedBytes} byte).`,
                                  `SVG #${svg.index + 1}`
                                );
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Bersihkan SVG</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSvgIdx(isExpanded ? null : svg.index)
                              }
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg cursor-pointer"
                            >
                              <Code2 className="w-3.5 h-3.5" />
                              <span>{isExpanded ? 'Tutup Editor' : 'Edit SVG'}</span>
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="space-y-2 pt-2 border-t border-slate-100">
                            <textarea
                              rows={5}
                              value={draftCode}
                              onChange={(e) =>
                                setSvgDrafts((prev) => ({
                                  ...prev,
                                  [svg.index]: e.target.value,
                                }))
                              }
                              spellCheck={false}
                              className="w-full p-3 font-mono text-[11px] leading-relaxed bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
                            />
                            <div className="flex items-center justify-end gap-2">
                              {isDirty && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextXml = replaceSvgByIndexInXml(
                                      xml,
                                      svg.index,
                                      draftCode
                                    );
                                    commitCardXmlChange(
                                      svgCardKey,
                                      nextXml,
                                      `Kode SVG #${svg.index + 1} (baris ${svg.line}) berhasil diperbarui.`,
                                      `SVG #${svg.index + 1}`
                                    );
                                  }}
                                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                                >
                                  Terapkan Perubahan SVG
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'structure' && (
          <div className="p-6 space-y-8">
            {/* Header, Footer, Meta SEO & Copyright Quick Edit */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Header, Footer, Meta SEO &amp; Kredit Copyright ({parsedInfo.regions.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Edit blok meta, copyright, atau buka langsung kode lengkapnya di Editor XML.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenXmlEditor}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50/70 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  Buka Editor XML &rarr;
                </button>
              </div>

              {parsedInfo.regions.length === 0 ? (
                <p className="text-xs text-slate-500">Tidak ada blok header/footer/meta terdeteksi.</p>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {parsedInfo.regions.map((reg) => {
                    const draft = regionDrafts[reg.id] ?? reg.rawSnippet;
                    const isDirty = draft !== reg.rawSnippet;
                    const isSingleLineEditable =
                      reg.zone === 'meta' || reg.zone === 'copyright';
                    const regCardKey = `reg-${reg.id}`;
                    const hasRegUndo = Boolean(cardUndoHistory[regCardKey]);
                    const isRegDynamic =
                      Boolean(reg.isDynamic) ||
                      containsBloggerDynamicSyntax(reg.previewText, reg.rawSnippet);
                    const isRegLocked = isRegDynamic && !unlockedDynamicCards[regCardKey];

                    return (
                      <div key={reg.id} className="p-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-slate-900">{reg.label}</span>
                            {isRegDynamic && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                                DINAMIS
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {hasRegUndo && (
                              <button
                                type="button"
                                onClick={() => handleUndoCard(regCardKey)}
                                className="px-2 py-0.5 text-[11px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded flex items-center gap-1 cursor-pointer"
                              >
                                <Undo2 className="w-3 h-3" />
                                <span>Undo</span>
                              </button>
                            )}
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                              {reg.zone} &middot; Baris {reg.line}
                            </span>
                          </div>
                        </div>

                        {isRegDynamic && isSingleLineEditable && (
                          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-amber-50/80 border border-amber-200 text-[11px] text-amber-900">
                            <span className="flex items-center gap-1.5">
                              {isRegLocked ? (
                                <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                              ) : (
                                <Unlock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              )}
                              <span>
                                {isRegLocked
                                  ? 'Blok meta/tag dinamis Blogger terkunci otomatis.'
                                  : 'Kunci blok dinamis dibuka manual.'}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setUnlockedDynamicCards((prev) => ({
                                  ...prev,
                                  [regCardKey]: !prev[regCardKey],
                                }))
                              }
                              className="px-2 py-0.5 bg-white hover:bg-amber-100 border border-amber-300 rounded font-medium cursor-pointer"
                            >
                              {isRegLocked ? 'Buka Kunci' : 'Kunci Kembali'}
                            </button>
                          </div>
                        )}

                        {isSingleLineEditable ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={draft}
                              readOnly={isRegLocked}
                              onChange={(e) =>
                                setRegionDrafts((prev) => ({
                                  ...prev,
                                  [reg.id]: e.target.value,
                                }))
                              }
                              className={`flex-1 px-3 py-1.5 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:border-blue-600 ${
                                isRegLocked
                                  ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                                  : 'bg-slate-50 text-slate-900'
                              }`}
                            />
                            {isDirty && !isRegLocked && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextXml = updateSnippetInXml(xml, reg.rawSnippet, draft);
                                  commitCardXmlChange(
                                    regCardKey,
                                    nextXml,
                                    `${reg.label} berhasil diperbarui.`,
                                    reg.label
                                  );
                                }}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded cursor-pointer"
                              >
                                Simpan
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-600 font-mono truncate">
                            {reg.previewText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Byte Size Breakdown */}
            <section className="space-y-3 pt-4 border-t border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Rincian Ukuran &amp; Komposisi File XML
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Transparansi ukuran file per bagian agar Anda dapat melihat mengapa ukuran file berubah saat dimodifikasi atau diekspor.
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/50">
                  <div className="text-[11px] text-slate-500">Total XML</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-1">
                    {formatBytes(byteBreakdown.totalBytes)}
                  </div>
                </div>
                <div className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/50">
                  <div className="text-[11px] text-slate-500">CSS &lt;b:skin&gt;</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-1">
                    {formatBytes(byteBreakdown.skinBytes)}
                  </div>
                </div>
                <div className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/50">
                  <div className="text-[11px] text-slate-500">Markup &amp; Widget XML</div>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-1">
                    {formatBytes(byteBreakdown.markupBytes)}
                  </div>
                </div>
                <div className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/50">
                  <div className="text-[11px] text-slate-500">Format Baris &amp; Script</div>
                  <div className="text-xs font-mono tabular-nums text-slate-900 mt-1">
                    {byteBreakdown.lineCount.toLocaleString('id-ID')} baris &middot; {byteBreakdown.lineEnding}
                    {byteBreakdown.hasBom ? ' · BOM' : ''}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 font-mono tabular-nums pt-1">
                <span>&lt;b:section&gt;: {parsedInfo.sections.length}</span>
                <span aria-hidden="true">&middot;</span>
                <span>&lt;b:widget&gt;: {parsedInfo.widgets.length}</span>
                <span aria-hidden="true">&middot;</span>
                <span>&lt;b:includable&gt;: {parsedInfo.includableCount}</span>
                <span aria-hidden="true">&middot;</span>
                <span>&lt;b:if&gt;: {parsedInfo.conditionalCount}</span>
                <span aria-hidden="true">&middot;</span>
                <span>&lt;b:loop&gt;: {parsedInfo.loopCount}</span>
              </div>
            </section>

            {/* External Resources */}
            {parsedInfo.externalResources.length > 0 && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Aset Eksternal Terhubung ({parsedInfo.externalResources.length})
                </h3>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                  {parsedInfo.externalResources.map((res, idx) => (
                    <div key={idx} className="px-4 py-2 flex items-center gap-3">
                      <span className="font-mono text-[11px] text-slate-500 w-20 shrink-0">
                        {res.kind}
                      </span>
                      <span className="font-mono text-slate-700 truncate">{res.url}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {activeTab === 'html-js-css' && (
          <div className="p-3 sm:p-6 h-full flex flex-col">
            <HtmlJsCssViewerPanel
              xml={xml}
              templateTitle={parsedInfo.templateTitle}
              onJumpToLine={(line) =>
                onJumpToEditorLine ? onJumpToEditorLine(line) : onOpenXmlEditor()
              }
              onReplaceSnippetInXml={(oldSnippet, newSnippet, feedbackMsg) => {
                const nextXml = updateSnippetInXml(xml, oldSnippet, newSnippet);
                onUpdateXml(nextXml, feedbackMsg);
              }}
            />
          </div>
        )}
        {activeTab === 'scripts-decode' && (
          <div className="p-4 sm:p-6 space-y-8">
            {/* Section 1: Detected .JS, .JSS, .CSS & Obfuscated URLs */}
            {scriptFilter !== 'encoded' && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Deteksi URL .JS, .JSS, .CSS &amp; URL Tersembunyi ({filteredAssetUrls.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mendeteksi tautan <span className="font-mono">&lt;script src&gt;</span>,{' '}
                    <span className="font-mono">&lt;link stylesheet&gt;</span>, file{' '}
                    <span className="font-mono">.css / .js / .jss</span>, CSS{' '}
                    <span className="font-mono">@import</span>, Data URI Base64, serta URL terobfuskasi (Base64,{' '}
                    <span className="font-mono">\xHH</span>, <span className="font-mono">%XX</span>,{' '}
                    <span className="font-mono">concat</span>, <span className="font-mono">.reverse().join()</span>).
                  </p>
                </div>

                {filteredAssetUrls.length === 0 ? (
                  <div className="p-6 text-center border border-slate-200 rounded-lg bg-slate-50/50 text-xs text-slate-500">
                    Tidak ada URL .JS, .JSS, atau .CSS eksternal yang cocok pada filter ini.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-[11px] font-semibold text-slate-500">
                          <th className="py-2.5 px-4 w-24">Tipe</th>
                          <th className="py-2.5 px-4 w-60">Sumber &amp; Domain</th>
                          <th className="py-2.5 px-4">URL / Hasil Decode (Edit atau Lompat ke Baris)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredAssetUrls.map((asset) => {
                          const draftUrl = assetUrlDrafts[asset.id] ?? (asset.isObfuscated ? asset.url : asset.rawUrl);
                          const baseCompare = asset.isObfuscated ? asset.url : asset.rawUrl;
                          const isDirty = draftUrl !== baseCompare;
                          const aiAssetEval = evaluateAssetUrlWithOfflineAi(asset);
                          const extDisplay = asset.extension
                            ? `.${asset.extension.toUpperCase()}`
                            : `.${asset.kind.toUpperCase()}`;
                          return (
                            <tr key={asset.id} className="hover:bg-slate-50/70 transition-colors align-top">
                              <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 uppercase space-y-1">
                                <div>{extDisplay}</div>
                                {asset.isObfuscated && (
                                  <div className="text-[10px] font-sans font-semibold text-red-700">
                                    Tersembunyi
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-slate-900 truncate max-w-[230px]">
                                  {asset.host}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate max-w-[230px]">
                                  {asset.sourceContext} &middot; Baris {asset.line}
                                  {asset.count > 1 ? ` · ${asset.count}×` : ''}
                                </div>
                                <div
                                  className={`text-[11px] font-medium mt-0.5 ${
                                    aiAssetEval.trustLevel === 'resmi'
                                      ? 'text-emerald-700'
                                      : aiAssetEval.trustLevel === 'waspada'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  AI Offline: {aiAssetEval.roleLabel}
                                </div>
                              </td>
                              <td className="py-2.5 px-4 space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="text"
                                    value={draftUrl}
                                    onChange={(e) =>
                                      setAssetUrlDrafts((prev) => ({
                                        ...prev,
                                        [asset.id]: e.target.value,
                                      }))
                                    }
                                    className="flex-1 min-w-[240px] px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onJumpToEditorLine
                                        ? onJumpToEditorLine(asset.line)
                                        : onOpenXmlEditor()
                                    }
                                    title={`Lompat ke baris ${asset.line} di Editor XML`}
                                    className="px-2.5 py-1.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-blue-700 text-xs font-mono rounded flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <span>Brs {asset.line}</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyText(asset.id, asset.url)}
                                    title="Salin URL"
                                    className="px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {copiedId === asset.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                    <span>{copiedId === asset.id ? 'Disalin' : 'Salin'}</span>
                                  </button>
                                  {isDirty && !asset.isObfuscated && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextXml = replaceAssetUrlInXml(
                                          xml,
                                          asset.rawUrl,
                                          draftUrl
                                        );
                                        setAssetUrlDrafts((prev) => {
                                          const copy = { ...prev };
                                          delete copy[asset.id];
                                          return copy;
                                        });
                                        commitCardXmlChange(
                                          `asset-${asset.id}`,
                                          nextXml,
                                          `URL .${asset.kind.toUpperCase()} di baris ${asset.line} diperbarui.`,
                                          `URL .${asset.kind.toUpperCase()} Baris ${asset.line}`
                                        );
                                      }}
                                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded whitespace-nowrap shrink-0 cursor-pointer"
                                    >
                                      Simpan URL
                                    </button>
                                  )}
                                  {cardUndoHistory[`asset-${asset.id}`] && (
                                    <button
                                      type="button"
                                      onClick={() => handleUndoCard(`asset-${asset.id}`)}
                                      title="Batalkan perubahan terakhir pada URL aset ini"
                                      className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-medium rounded flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                    >
                                      <Undo2 className="w-3 h-3" />
                                      <span>Undo</span>
                                    </button>
                                  )}
                                </div>
                                {asset.isObfuscated && asset.rawExpression && (
                                  <div className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1 truncate">
                                    Asli: {asset.rawExpression}
                                  </div>
                                )}
                                <p className="text-[11px] text-slate-600">{aiAssetEval.summary}</p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* Section 2: Auto-Detected Obfuscated / Encoded Scripts */}
            {scriptFilter !== 'js' && scriptFilter !== 'css' && (
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Deteksi &amp; Decode Kode Terenkripsi dalam Template ({filteredEncodedCodes.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mendeteksi kode yang sengaja disamarkan seperti{' '}
                    <span className="font-mono">eval(function(p,a,c,k,e,d)...)</span>,{' '}
                    <span className="font-mono">Base64 (atob)</span>,{' '}
                    <span className="font-mono">\xHH / \uHHHH</span>,{' '}
                    <span className="font-mono">String.fromCharCode</span>, maupun{' '}
                    <span className="font-mono">unescape(%XX)</span> secara offline tanpa mengeksekusinya.
                  </p>
                </div>

                {filteredEncodedCodes.length === 0 ? (
                  <div className="p-6 text-center border border-slate-200 rounded-lg bg-slate-50/50 text-xs text-slate-600">
                    Tidak ada blok skrip terenkripsi atau kode terobfuskasi yang terdeteksi pada template aktif.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                    {filteredEncodedCodes.map((enc) => {
                      const aiCodeEval = evaluateEncodedCodeWithOfflineAi(enc);
                      return (
                      <div key={enc.id} className="p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-slate-900">
                              {enc.techniqueLabel}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                              Zona {enc.zone} &middot; Baris {enc.line}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleCopyText(`${enc.id}-dec`, enc.decodedText)}
                              className="px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {copiedId === `${enc.id}-dec` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>Salin Decode</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const nextXml = updateSnippetInXml(xml, enc.rawSnippet, '');
                                onUpdateXml(
                                  nextXml,
                                  `Blok kode terenkripsi pada baris ${enc.line} berhasil dihapus dari XML.`
                                );
                              }}
                              className="px-2.5 py-1.5 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Hapus Blok</span>
                            </button>
                          </div>
                        </div>

                        {/* AI Offline Classification & Purpose Summary */}
                        <div
                          className={`p-3 rounded-lg border text-xs space-y-1 ${
                            aiCodeEval.riskLevel === 'tinggi'
                              ? 'bg-red-50 border-red-200 text-red-950'
                              : aiCodeEval.riskLevel === 'sedang'
                                ? 'bg-amber-50 border-amber-200 text-amber-950'
                                : 'bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                        >
                          <div className="font-semibold">
                            AI Offline: {aiCodeEval.classification}
                          </div>
                          <p className="leading-relaxed">{aiCodeEval.summary}</p>
                          <div className="text-[11px] font-medium">
                            Rekomendasi: {aiCodeEval.recommendation}
                          </div>
                        </div>

                        {(enc.signals.length > 0 || enc.revealedUrls.length > 0) && (
                          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 space-y-1.5 text-xs">
                            {enc.signals.length > 0 && (
                              <div className="flex items-start gap-2">
                                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                                <div className="space-y-0.5">
                                  {enc.signals.map((sig, i) => (
                                    <div key={i}>{sig}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {enc.revealedUrls.length > 0 && (
                              <div className="pt-1 border-t border-amber-200/80 font-mono text-[11px] space-y-0.5">
                                <div className="font-sans font-semibold text-amber-900">
                                  URL Terungkap Setelah Decode:
                                </div>
                                {enc.revealedUrls.map((u, idx) => (
                                  <div key={idx} className="truncate text-amber-900">
                                    {u}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-slate-500">
                              Kode Asli di Template
                            </div>
                            <pre className="p-3 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-600 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                              {enc.rawSnippet}
                            </pre>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-slate-900">
                              Hasil Decode Offline
                            </div>
                            <pre className="p-3 text-[11px] font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                              {enc.decodedText}
                            </pre>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Section 3: Offline Manual Code Decoder */}
            <section className="space-y-3 pt-4 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Alat Decode Kode Manual (Offline)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tempel potongan kode <span className="font-mono">eval(p,a,c,k,e,d)</span>, Base64,{' '}
                    <span className="font-mono">\xHH</span>, <span className="font-mono">String.fromCharCode</span>, atau{' '}
                    <span className="font-mono">%XX</span> untuk langsung membaca isi aslinya secara lokal.
                  </p>
                </div>
                {manualDecodeInput && (
                  <button
                    type="button"
                    onClick={() => setManualDecodeInput('')}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg bg-white cursor-pointer"
                  >
                    Bersihkan
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="manual-decode-input" className="block text-xs font-medium text-slate-700">
                    Kode Terenkripsi / Tersamar
                  </label>
                  <textarea
                    id="manual-decode-input"
                    rows={6}
                    value={manualDecodeInput}
                    onChange={(e) => setManualDecodeInput(e.target.value)}
                    placeholder="Tempel kode eval(function(p,a,c,k,e,d){...}), atob('...'), \x68\x74\x74\x70, atau unescape('%3C...') di sini..."
                    spellCheck={false}
                    className="w-full p-3 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">
                      Hasil Decode
                      {manualDecodeResult.appliedLayers.length > 0
                        ? ` · ${manualDecodeResult.appliedLayers.join(' → ')}`
                        : ''}
                    </span>
                    {manualDecodeResult.decodedText && (
                      <button
                        type="button"
                        onClick={() => handleCopyText('manual-dec', manualDecodeResult.decodedText)}
                        className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === 'manual-dec' ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedId === 'manual-dec' ? 'Disalin' : 'Salin Hasil'}</span>
                      </button>
                    )}
                  </div>
                  <pre className="p-3 min-h-[146px] max-h-60 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-slate-100 overflow-auto whitespace-pre-wrap break-all">
                    {manualDecodeInput.trim()
                      ? manualDecodeResult.decodedText
                      : 'Hasil decode otomatis akan muncul di sini...'}
                  </pre>
                  {manualDecodeInput.trim() && (() => {
                    const aiManualEval = evaluateEncodedCodeWithOfflineAi(manualDecodeResult);
                    return (
                      <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-950 space-y-1">
                        <div className="font-semibold">AI Offline: {aiManualEval.classification}</div>
                        <p>{aiManualEval.summary}</p>
                        <div className="text-[11px] font-medium">
                          Rekomendasi: {aiManualEval.recommendation}
                        </div>
                      </div>
                    );
                  })()}
                  {(manualDecodeResult.signals.length > 0 || manualDecodeResult.revealedUrls.length > 0) && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1">
                      {manualDecodeResult.signals.map((sig, i) => (
                        <div key={i}>{sig}</div>
                      ))}
                      {manualDecodeResult.revealedUrls.map((u, i) => (
                        <div key={i} className="font-mono text-[11px] truncate">
                          URL: {u}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

      </div>
    </div>
  );
};
