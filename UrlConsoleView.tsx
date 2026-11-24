import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ClipboardPaste,
  Code2,
  Copy,
  Eraser,
  Globe,
  HelpCircle,
  Loader2,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Terminal,
  Trash2,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import type {
  DevConsoleLevel,
  DevConsoleLogEntry,
  ParsedTemplateInfo,
} from '../types/blogger';
import {
  compareBlogWithActiveTemplate,
  type LiveBlogFingerprint,
  type TemplateMatchComparison,
} from '../lib/seoAndErrorAnalyzer';
import {
  buildQueryStringFromPairs,
  detectConsoleTestableTargetsInXml,
  detectQueryStringsAndParamsInXml,
  inspectJsSnippetForConsole,
  parseAndAnalyzeQueryString,
  scanDynamicQueryParametersInXml,
  smartDecodeCodeOffline,
  type CapturedUrlStringItem,
  type DetectedQueryParameter,
  type DynamicQueryManualNotice,
} from '../lib/scriptAndCodeInspector';
import { validateBloggerXmlOffline } from '../lib/xmlOfflineTools';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';

export interface PendingConsoleInjection {
  id: number;
  payload: string;
  kind: 'query-string' | 'url-string' | 'javascript';
  runNow?: boolean;
}

interface UrlConsoleViewProps {
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  sharedBlogUrl: string;
  onSharedBlogUrlChange: (url: string) => void;
  liveFingerprint: LiveBlogFingerprint | null;
  comparisonResult: TemplateMatchComparison | null;
  userBlogVisualHtml: string | null;
  onBlogFingerprintFetched: (
    url: string,
    fingerprint: LiveBlogFingerprint,
    comparison: TemplateMatchComparison,
    visualHtml?: string | null
  ) => void;
  onOpenUserBlogPreview?: () => void;
  previewConsoleLogs: DevConsoleLogEntry[];
  onClearPreviewLogs: () => void;
  pendingConsolePayload?: PendingConsoleInjection | null;
  onConsumePendingConsolePayload?: () => void;
  isOfflineMode?: boolean;
  onSwitchToOnline?: () => void;
  onJumpToEditorLine: (line?: number | null) => void;
  previewQueryParams?: Record<string, string>;
  onApplyPreviewQueryParams?: (nextParams: Record<string, string>, openPreview?: boolean) => void;
  onResetPreviewQueryParams?: () => void;
  offlineAi?: OfflineAiController;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type LeftInspectorTab = 'auto-test' | 'query-tester' | 'resources' | 'match' | 'selector';
type AutoTestCategory =
  | 'all'
  | 'query-string'
  | 'url-string'
  | 'javascript'
  | 'selector'
  | 'xml-error';
type ResourceFilter = 'all' | 'css' | 'js' | 'obfuscated' | 'insecure';
type ConsoleFilter = 'all' | 'error' | 'warn' | 'info' | 'network';

interface QueryBuilderParamRow {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
}

interface SelectorMatchPreview {
  tagName: string;
  idAttr: string;
  classAttr: string;
  textPreview: string;
  xmlLine: number | null;
}

interface AutoTestableCardItem {
  id: string;
  category: Exclude<AutoTestCategory, 'all'>;
  badge: string;
  title: string;
  subtitle: string;
  previewCode: string;
  copyText: string;
  consolePayload: string;
  rawQueryPayload?: string;
  line: number | null;
  isHighlight?: boolean;
}

function nowTimeLabel(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function normalizeBlogspotInputUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function resolveQueryTestBaseUrl(rawPathOrUrl: string, sharedBlogUrl: string): string {
  const baseInput = rawPathOrUrl.trim().replace(/\?.*$/, '');
  const fallbackOrigin = sharedBlogUrl.trim()
    ? normalizeBlogspotInputUrl(sharedBlogUrl).replace(/\/+$/, '').replace(/\?.*$/, '')
    : 'https://namabloganda.blogspot.com';

  if (!baseInput || baseInput === '/' || baseInput.startsWith('(')) {
    return fallbackOrigin;
  }
  if (/^https?:\/\//i.test(baseInput)) {
    return baseInput;
  }
  if (baseInput.startsWith('//')) {
    return `https:${baseInput}`;
  }
  if (baseInput.startsWith('/')) {
    return `${fallbackOrigin.replace(/^(https?:\/\/[^/]+).*$/, '$1')}${baseInput}`;
  }
  if (/^[a-zA-Z0-9.-]+\.[a-z]{2,}/i.test(baseInput)) {
    return `https://${baseInput}`;
  }
  return `${fallbackOrigin}/${baseInput.replace(/^\/+/, '')}`;
}

function findLineNumberInXml(xml: string, needle: string): number | null {
  if (!needle) return null;
  const idx = xml.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (xml.charCodeAt(i) === 10) line++;
  }
  return line;
}

function querySelectorSafely(
  sourceHtml: string,
  xmlForLines: string,
  selector: string
): { count: number; items: SelectorMatchPreview[]; error?: string } {
  const cleanSel = selector.trim();
  if (!cleanSel) return { count: 0, items: [], error: 'Selector masih kosong.' };
  if (typeof DOMParser === 'undefined') {
    return { count: 0, items: [], error: 'DOMParser tidak tersedia di lingkungan ini.' };
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sourceHtml, 'text/html');
    const nodes = Array.from(doc.querySelectorAll(cleanSel));
    const items: SelectorMatchPreview[] = nodes.slice(0, 18).map((el) => {
      const idAttr = el.getAttribute('id') || '';
      const classAttr = el.getAttribute('class') || '';
      const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const xmlLine =
        (idAttr && findLineNumberInXml(xmlForLines, `id="${idAttr}"`)) ||
        (idAttr && findLineNumberInXml(xmlForLines, `id='${idAttr}'`)) ||
        (classAttr &&
          findLineNumberInXml(xmlForLines, classAttr.split(/\s+/).filter(Boolean)[0] || '')) ||
        findLineNumberInXml(xmlForLines, `<${el.tagName.toLowerCase()}`);
      return {
        tagName: el.tagName.toLowerCase(),
        idAttr,
        classAttr,
        textPreview: rawText || '(elemen tanpa teks langsung)',
        xmlLine,
      };
    });
    return { count: nodes.length, items };
  } catch (err) {
    return {
      count: 0,
      items: [],
      error: err instanceof Error ? err.message : 'Selector CSS tidak valid.',
    };
  }
}

function buildStaticHtmlFromXml(xml: string): string {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml);
  const rawBody = bodyMatch ? bodyMatch[1] : xml;
  return rawBody
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<b:skin\b[\s\S]*?<\/b:skin>/gi, '')
    .replace(/<b:template-skin\b[\s\S]*?<\/b:template-skin>/gi, '')
    .replace(/<b:section\b([^>]*)>/gi, '<section data-b-section="true" $1>')
    .replace(/<\/b:section>/gi, '</section>')
    .replace(/<b:widget\b([^>]*)>/gi, '<div data-b-widget="true" $1>')
    .replace(/<\/b:widget>/gi, '</div>');
}

export const UrlConsoleView: React.FC<UrlConsoleViewProps> = ({
  xml,
  parsedInfo,
  sharedBlogUrl,
  onSharedBlogUrlChange,
  liveFingerprint,
  comparisonResult,
  userBlogVisualHtml,
  onBlogFingerprintFetched,
  onOpenUserBlogPreview,
  previewConsoleLogs,
  onClearPreviewLogs,
  pendingConsolePayload,
  onConsumePendingConsolePayload,
  isOfflineMode = false,
  onSwitchToOnline,
  onJumpToEditorLine,
  previewQueryParams = {},
  onApplyPreviewQueryParams,
  onResetPreviewQueryParams,
  offlineAi,
  onNotify,
}) => {
  const [leftTab, setLeftTab] = useState<LeftInspectorTab>('auto-test');
  const [autoCategory, setAutoCategory] = useState<AutoTestCategory>('all');
  const [autoSearch, setAutoSearch] = useState('');
  const [querySearch, setQuerySearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [resourceSearch, setResourceSearch] = useState('');
  const [consoleFilter, setConsoleFilter] = useState<ConsoleFilter>('all');
  const [consoleLogSearch, setConsoleLogSearch] = useState('');

  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectorInput, setSelectorInput] = useState('.widget, b\\:widget, h1, header');
  const [consoleInput, setConsoleInput] = useState('');
  const [userConsoleEntries, setUserConsoleEntries] = useState<DevConsoleLogEntry[]>([]);

  // Interactive Dynamic Query String & Parameter Tester state
  const [queryBaseInput, setQueryBaseInput] = useState('');
  const [queryParamRows, setQueryParamRows] = useState<QueryBuilderParamRow[]>([]);
  const [detectedParamDrafts, setDetectedParamDrafts] = useState<Record<string, string>>({});
  const [isTestingLiveQuery, setIsTestingLiveQuery] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const consoleFeedEndRef = useRef<HTMLDivElement>(null);
  const consoleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastAutoScannedSignatureRef = useRef<string>('');
  const lastConsumedPayloadIdRef = useRef<number | null>(null);

  // Automatic dynamic XML parameter & target scanning
  const dynamicQueryScan = useMemo(() => scanDynamicQueryParametersInXml(xml), [xml]);
  const consoleReport = useMemo(() => detectConsoleTestableTargetsInXml(xml), [xml]);
  const queryStrings = useMemo(() => detectQueryStringsAndParamsInXml(xml), [xml]);
  const xmlAssets = consoleReport.urlStrings;
  const jsSnippets = consoleReport.jsSnippets;
  const capturedSelectors = consoleReport.selectors;
  const xmlValidation = useMemo(() => validateBloggerXmlOffline(xml), [xml]);

  // Keep per-parameter quick-test drafts & builder rows dynamically synced with active XML
  const lastScannedXmlRef = useRef<string>('');
  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const p of dynamicQueryScan.parameters) {
      nextDrafts[p.name] =
        p.name in previewQueryParams ? previewQueryParams[p.name] : p.suggestedValue;
    }
    setDetectedParamDrafts(nextDrafts);

    if (lastScannedXmlRef.current !== xml) {
      lastScannedXmlRef.current = xml;
      if (dynamicQueryScan.detectedBasePaths.length > 0) {
        const firstPath = dynamicQueryScan.detectedBasePaths[0];
        setQueryBaseInput(
          /^https?:\/\//i.test(firstPath) || firstPath.startsWith('/') ? firstPath : ''
        );
      } else {
        setQueryBaseInput('');
      }
      setQueryParamRows(
        dynamicQueryScan.parameters.map((p, idx) => ({
          id: `qp-dyn-${idx}-${p.name}`,
          enabled: true,
          key: p.name,
          value: p.name in previewQueryParams ? previewQueryParams[p.name] : p.suggestedValue,
        }))
      );
    }
  }, [xml, dynamicQueryScan, previewQueryParams]);

  const builtQueryState = useMemo(() => {
    const { rawQuery, xmlSafeQuery } = buildQueryStringFromPairs(queryParamRows);
    const resolvedBase = resolveQueryTestBaseUrl(queryBaseInput, sharedBlogUrl);
    const fullUrl = `${resolvedBase}${rawQuery}`;
    const enabledPairs = queryParamRows.filter((r) => r.enabled && r.key.trim().length > 0);
    const paramMap = Object.fromEntries(enabledPairs.map((p) => [p.key.trim(), p.value]));
    const jsSearchParamsSnippet = [
      `const params = new URLSearchParams(${JSON.stringify(paramMap, null, 2)});`,
      `console.log('Query aktif:', '?' + params.toString());`,
    ].join('\n');
    const analysis = parseAndAnalyzeQueryString(fullUrl, resolvedBase);
    return {
      resolvedBase,
      rawQuery,
      xmlSafeQuery,
      fullUrl,
      paramMap,
      jsSearchParamsSnippet,
      analysis,
      enabledCount: enabledPairs.length,
    };
  }, [queryBaseInput, queryParamRows, sharedBlogUrl]);

  // Build unified list of auto-detected testable targets ("tinggal salin dan tempel")
  const autoTestableItems = useMemo<AutoTestableCardItem[]>(() => {
    const list: AutoTestableCardItem[] = [];

    for (const dp of dynamicQueryScan.parameters) {
      const valList =
        dp.candidateValues.length > 0
          ? `Opsi terdeteksi: ${dp.candidateValues.join(', ')}`
          : `Nilai contoh: ${dp.suggestedValue}`;
      list.push({
        id: `auto-${dp.id}`,
        category: 'query-string',
        badge: dp.primarySourceLabel.toUpperCase(),
        title: dp.testQueryExample,
        subtitle: `Param "${dp.name}" · ${valList} · ${dp.sources[0]?.context || 'XML'}`,
        previewCode: dp.consoleSnippet,
        copyText: dp.testQueryExample,
        consolePayload: `query ${dp.testQueryExample}`,
        rawQueryPayload: dp.testQueryExample,
        line: dp.primaryLine,
        isHighlight: dp.candidateValues.length > 0,
      });
    }

    for (const qs of queryStrings) {
      list.push({
        id: `auto-${qs.id}`,
        category: 'query-string',
        badge: `QUERY LINK (${qs.params.length} PARAM)`,
        title: qs.normalizedQueryString,
        subtitle: `${qs.sourceContext} · Base: ${qs.baseUrl}${
          qs.hasRawAmpersandInXmlAttr ? ' · Gunakan &amp; di atribut XML' : ''
        }`,
        previewCode: `${qs.params.map((p) => `${p.key} = ${p.value || '(kosong)'}`).join('\n')}`,
        copyText: qs.normalizedQueryString,
        consolePayload: qs.consoleCommand,
        rawQueryPayload:
          qs.baseUrl && !qs.baseUrl.startsWith('(')
            ? `${qs.baseUrl}${qs.normalizedQueryString}`
            : qs.normalizedQueryString,
        line: qs.line,
        isHighlight: qs.hasRawAmpersandInXmlAttr || qs.isObfuscated,
      });
    }

    for (const u of xmlAssets) {
      list.push({
        id: `auto-${u.id}`,
        category: 'url-string',
        badge: u.isObfuscated
          ? 'URL TERSEMBUNYI'
          : u.extension
            ? `.${u.extension.toUpperCase()}`
            : u.kind.toUpperCase(),
        title: u.host,
        subtitle: `${u.sourceContext}${u.isHttpInsecure ? ' · HTTP Non-SSL' : ''}`,
        previewCode: u.url,
        copyText: u.url,
        consolePayload: u.consoleCommand,
        line: u.line,
        isHighlight: u.isObfuscated || u.isHttpInsecure,
      });
    }

    for (const js of jsSnippets) {
      list.push({
        id: `auto-${js.id}`,
        category: 'javascript',
        badge: js.isObfuscated ? 'JS ENCRYPTED' : 'JAVASCRIPT',
        title: js.title,
        subtitle: [
          js.sourceContext,
          js.embeddedUrls.length > 0 ? `${js.embeddedUrls.length} URL tertangkap` : null,
          js.detectedApis.length > 0 ? js.detectedApis.slice(0, 3).join(', ') : null,
        ]
          .filter(Boolean)
          .join(' · '),
        previewCode: js.code.slice(0, 220),
        copyText: js.code,
        consolePayload: js.consoleCommand,
        line: js.line,
        isHighlight: js.isObfuscated || js.needsCdataInXml,
      });
    }

    for (const sel of capturedSelectors) {
      list.push({
        id: `auto-${sel.id}`,
        category: 'selector',
        badge: 'SELECTOR',
        title: sel.selector,
        subtitle: sel.label,
        previewCode: sel.consoleCommand,
        copyText: sel.selector,
        consolePayload: sel.consoleCommand,
        line: sel.line,
      });
    }

    for (const iss of xmlValidation.issues.slice(0, 30)) {
      list.push({
        id: `auto-err-${iss.code}-${iss.line}`,
        category: 'xml-error',
        badge: iss.severity === 'error' ? 'XML ERROR' : 'XML WARN',
        title: `[${iss.code}] ${iss.message}`,
        subtitle: `Baris ${iss.line}`,
        previewCode: iss.snippet || iss.message,
        copyText: iss.snippet || iss.message,
        consolePayload: iss.snippet || iss.message,
        line: iss.line,
        isHighlight: iss.severity === 'error',
      });
    }

    return list;
  }, [queryStrings, xmlAssets, jsSnippets, capturedSelectors, xmlValidation.issues]);

  const filteredAutoItems = useMemo(() => {
    const q = autoSearch.trim().toLowerCase();
    return autoTestableItems.filter((item) => {
      if (autoCategory !== 'all' && item.category !== autoCategory) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.previewCode.toLowerCase().includes(q)
      );
    });
  }, [autoTestableItems, autoCategory, autoSearch]);

  const filteredDynamicParams = useMemo(() => {
    const q = querySearch.trim().toLowerCase();
    if (!q) return dynamicQueryScan.parameters;
    return dynamicQueryScan.parameters.filter(
      (param) =>
        param.name.toLowerCase().includes(q) ||
        param.primarySourceLabel.toLowerCase().includes(q) ||
        param.suggestedValue.toLowerCase().includes(q) ||
        param.candidateValues.some((v) => v.toLowerCase().includes(q)) ||
        param.sources.some(
          (s) =>
            s.label.toLowerCase().includes(q) ||
            s.context.toLowerCase().includes(q) ||
            String(s.line).includes(q)
        )
    );
  }, [dynamicQueryScan.parameters, querySearch]);

  const filteredAssets = useMemo(() => {
    const q = resourceSearch.trim().toLowerCase();
    return xmlAssets.filter((item) => {
      if (resourceFilter === 'css' && item.kind !== 'css') return false;
      if (resourceFilter === 'js' && item.kind !== 'js') return false;
      if (resourceFilter === 'obfuscated' && !item.isObfuscated) return false;
      if (resourceFilter === 'insecure' && !item.isHttpInsecure) return false;
      if (!q) return true;
      return (
        item.url.toLowerCase().includes(q) ||
        item.host.toLowerCase().includes(q) ||
        item.sourceContext.toLowerCase().includes(q)
      );
    });
  }, [xmlAssets, resourceFilter, resourceSearch]);

  // Also extract external URLs from fetched live Blogspot visual HTML (if loaded)
  const liveHtmlExternalUrls = useMemo(() => {
    if (!userBlogVisualHtml) return [] as Array<{ kind: 'css' | 'js' | 'link'; url: string }>;
    const found: Array<{ kind: 'css' | 'js' | 'link'; url: string }> = [];
    const seen = new Set<string>();
    const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(userBlogVisualHtml)) !== null) {
      if (m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        found.push({ kind: 'js', url: m[1] });
      }
    }
    while ((m = linkRe.exec(userBlogVisualHtml)) !== null) {
      if (m[1] && !seen.has(m[1]) && (/\.css/i.test(m[1]) || /stylesheet/i.test(m[0]))) {
        seen.add(m[1]);
        found.push({ kind: 'css', url: m[1] });
      }
    }
    return found.slice(0, 60);
  }, [userBlogVisualHtml]);

  const appendLog = (entry: Omit<DevConsoleLogEntry, 'id' | 'timestamp'>) => {
    setUserConsoleEntries((prev) => [
      ...prev.slice(-140),
      {
        ...entry,
        id: `usr-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: nowTimeLabel(),
      },
    ]);
  };

  // Automatically log detected testable candidates whenever XML template changes
  useEffect(() => {
    const sig = `${xml.length}:${dynamicQueryScan.parameters.length}:${xmlAssets.length}:${jsSnippets.length}:${xmlValidation.issues.length}`;
    if (lastAutoScannedSignatureRef.current === sig) return;
    lastAutoScannedSignatureRef.current = sig;

    const previewParams = dynamicQueryScan.parameters
      .slice(0, 5)
      .map(
        (p, idx) =>
          `  ${idx + 1}. [Baris ${p.primaryLine}] ${p.name} (${p.primarySourceLabel})${
            p.candidateValues.length > 0 ? ` — Opsi: ${p.candidateValues.join(', ')}` : ` — Contoh: ${p.testQueryExample}`
          }`
      )
      .join('\n');
    const previewJs = jsSnippets
      .slice(0, 3)
      .map(
        (j, idx) =>
          `  ${idx + 1}. [Baris ${j.line}] ${j.title}${
            j.embeddedUrls.length > 0 ? ` (${j.embeddedUrls.length} URL)` : ''
          }`
      )
      .join('\n');

    appendLog({
      level: xmlValidation.issues.some((i) => i.severity === 'error') ? 'warn' : 'info',
      source: 'xml',
      title: `Deteksi Otomatis Konsol: ${dynamicQueryScan.parameters.length} Parameter URL Dinamis, ${jsSnippets.length} Blok JavaScript, ${xmlAssets.length} URL Aset, ${capturedSelectors.length} Selector DOM siap diuji.`,
      detail: [
        previewParams
          ? `Parameter & Query URL Terdeteksi:\n${previewParams}`
          : dynamicQueryScan.xmlEmpty
            ? 'XML masih kosong — unggah atau muat template .xml terlebih dahulu.'
            : 'Parameter URL Terdeteksi: Tidak ditemukan pola URLSearchParams / location.search / Form GET / Link query pada XML ini.',
        dynamicQueryScan.manualCheckNotices.length > 0
          ? `Perlu Pengecekan Manual (${dynamicQueryScan.manualCheckNotices.length}):\n- ${dynamicQueryScan.manualCheckNotices
              .slice(0, 3)
              .map((n) => `[Baris ${n.line}] ${n.reason}`)
              .join('\n- ')}`
          : null,
        previewJs ? `JavaScript Terdeteksi:\n${previewJs}` : 'JavaScript Terdeteksi: (tidak ada)',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
  }, [
    xml.length,
    dynamicQueryScan,
    xmlAssets.length,
    jsSnippets,
    capturedSelectors.length,
    xmlValidation.issues,
  ]);

  // Merge runtime iframe logs + user/audit logs
  const mergedConsoleLogs = useMemo(() => {
    const combined = [...userConsoleEntries, ...previewConsoleLogs];
    const q = consoleLogSearch.trim().toLowerCase();
    return combined.filter((item) => {
      if (consoleFilter === 'info') {
        if (item.level !== 'info' && item.level !== 'log') return false;
      } else if (consoleFilter !== 'all' && item.level !== consoleFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.detail && item.detail.toLowerCase().includes(q)) ||
        (item.url && item.url.toLowerCase().includes(q)) ||
        (item.codeSnippet && item.codeSnippet.toLowerCase().includes(q)) ||
        (typeof item.line === 'number' && String(item.line).includes(q))
      );
    });
  }, [userConsoleEntries, previewConsoleLogs, consoleFilter, consoleLogSearch]);

  useEffect(() => {
    consoleFeedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mergedConsoleLogs.length]);

  const copyText = (text: string, id: string, label = 'Teks') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1600);
        onNotify?.(`${label} disalin ke clipboard.`, 'success');
      });
    }
  };

  const pasteIntoConsolePrompt = (text: string, focusBox = true) => {
    setConsoleInput(text);
    if (focusBox) {
      requestAnimationFrame(() => {
        consoleTextareaRef.current?.focus();
      });
    }
    onNotify?.('Ditempel ke kolom input konsol. Tekan Enter atau "Jalankan ke Konsol".', 'info');
  };

  const loadRawQueryIntoBuilder = (rawInput: string, switchTab = true) => {
    const parsed = parseAndAnalyzeQueryString(
      rawInput,
      sharedBlogUrl.trim() ? normalizeBlogspotInputUrl(sharedBlogUrl) : ''
    );
    if (parsed.baseUrl && !parsed.baseUrl.startsWith('(')) {
      setQueryBaseInput(parsed.baseUrl);
    } else if (/^\//.test(rawInput.trim())) {
      setQueryBaseInput(rawInput.trim().split('?')[0]);
    }
    if (parsed.params.length > 0) {
      setQueryParamRows(
        parsed.params.map((p, idx) => ({
          id: `qp-load-${Date.now()}-${idx}`,
          enabled: true,
          key: p.key,
          value: p.value,
        }))
      );
    }
    if (switchTab) setLeftTab('query-tester');
    return parsed;
  };

  const handleSimulateQueryToConsole = (overrideRawInput?: string) => {
    const analysis = overrideRawInput
      ? parseAndAnalyzeQueryString(overrideRawInput, builtQueryState.resolvedBase)
      : builtQueryState.analysis;

    const paramLines =
      analysis.params.length > 0
        ? analysis.params
            .map(
              (p, idx) =>
                `  ${idx + 1}. ${p.key} = "${p.value}" [${p.category.toUpperCase()}]${
                  p.meaningHint ? ` — ${p.meaningHint}` : ''
                }${p.isDynamicPlaceholder ? ' (Placeholder Dinamis)' : ''}`
            )
            .join('\n')
        : '  (Tidak ada parameter query key=value)';

    appendLog({
      level: analysis.warnings.length > 0 ? 'warn' : 'network',
      source: 'user-input',
      title: `Simulasi Uji Query String: ${analysis.queryString || '(tanpa ?query)'} (${analysis.params.length} Parameter)`,
      url: /^https?:\/\//i.test(analysis.normalizedUrl) ? analysis.normalizedUrl : undefined,
      detail: [
        `URL Lengkap Uji: ${analysis.normalizedUrl}`,
        `Query String Mentah: ${analysis.queryString || '(kosong)'}`,
        `Versi XML Blogger (&amp;): ${analysis.xmlSafeQueryString || '(kosong)'}`,
        `Daftar Query Parameter:\n${paramLines}`,
        analysis.bloggerBehaviorNotes.length > 0
          ? `Perilaku Blogger:\n- ${analysis.bloggerBehaviorNotes.join('\n- ')}`
          : null,
        analysis.warnings.length > 0 ? `Catatan:\n- ${analysis.warnings.join('\n- ')}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
  };

  const handleTestLiveQueryUrl = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl || builtQueryState.fullUrl).trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      appendLog({
        level: 'warn',
        source: 'url',
        title: 'URL tujuan belum lengkap untuk Uji Request Live HTTP.',
        detail: 'Isi kolom Base URL / Blogspot di atas terlebih dahulu atau gunakan "Simulasi & Uji di Konsol (Offline)".',
      });
      onNotify?.('Isi Base URL terlebih dahulu untuk Uji Request Live.', 'info');
      return;
    }

    if (isOfflineMode) {
      appendLog({
        level: 'warn',
        source: 'url',
        title: 'Uji Request Live HTTP ditahan (Mode Offline aktif) — menjalankan simulasi offline.',
        url: targetUrl,
      });
      handleSimulateQueryToConsole(targetUrl);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      appendLog({
        level: 'error',
        source: 'url',
        title: 'ERR_INTERNET_DISCONNECTED saat menguji Query String live.',
        url: targetUrl,
      });
      return;
    }

    setIsTestingLiveQuery(true);
    appendLog({
      level: 'network',
      source: 'url',
      title: `TEST QUERY GET ${targetUrl} → Mengirim request dengan Query Parameter...`,
      url: targetUrl,
    });

    try {
      const res = await fetch('/api/test-query-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status} saat menguji query URL.`);
      }

      const qpList = Array.isArray(data.queryParams)
        ? (data.queryParams as Array<{ key: string; value: string }>)
            .map((p, idx) => `  ${idx + 1}. ${p.key} = ${p.value}`)
            .join('\n')
        : '';

      appendLog({
        level: data.ok ? 'network' : 'warn',
        source: 'url',
        title: `HTTP ${data.status} ${data.statusText || ''} (${data.latencyMs} ms) — Uji Query Selesai`,
        url: data.finalUrl || targetUrl,
        detail: [
          `Final URL: ${data.finalUrl}${data.redirected ? ' (mengalami redirect)' : ''}`,
          `Content-Type: ${data.contentType} · Ukuran terbaca: ${data.byteSize} B`,
          data.pageTitle ? `Judul Halaman: ${data.pageTitle}` : null,
          data.jsonSummary ? `Ringkasan JSON: ${data.jsonSummary}` : null,
          qpList ? `Query Parameter Diterima Server:\n${qpList}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        codeSnippet: data.bodySnippet ? String(data.bodySnippet).slice(0, 650) : undefined,
      });
      onNotify?.(`Uji Query Live selesai: HTTP ${data.status} (${data.latencyMs} ms).`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menguji query URL live.';
      appendLog({
        level: 'error',
        source: 'url',
        title: `Uji Query Live Gagal: ${msg}`,
        url: targetUrl,
      });
      onNotify?.(msg, 'error');
    } finally {
      setIsTestingLiveQuery(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      consoleTextareaRef.current?.focus();
      onNotify?.('Gunakan Ctrl+V / tempel langsung ke dalam kotak konsol.', 'info');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        onNotify?.('Papan klip kosong.', 'info');
        return;
      }
      setConsoleInput((prev) => (prev ? `${prev}\n${text}` : text));
      consoleTextareaRef.current?.focus();
      onNotify?.('Teks dari papan klip ditempel ke kolom konsol.', 'success');
    } catch {
      consoleTextareaRef.current?.focus();
      onNotify?.('Izin baca papan klip dibatasi browser — silakan tekan Ctrl+V di kotak konsol.', 'info');
    }
  };

  // Live fetch synced Blogspot URL and emit DevTools logs
  const handleFetchSyncedUrlToConsole = async (overrideUrl?: string) => {
    const rawTarget = (overrideUrl ?? sharedBlogUrl).trim();
    if (!rawTarget) {
      const msg =
        'Kolom URL Blogspot masih kosong. Anda tetap dapat menguji seluruh URL string, JavaScript, dan selector yang otomatis terdeteksi di kolom kiri.';
      setFetchError(msg);
      appendLog({
        level: 'warn',
        source: 'url',
        title: 'URL Blogspot belum diisi — menampilkan ringkasan target XML lokal.',
        detail: `Siap uji: ${xmlAssets.length} URL String · ${jsSnippets.length} Blok JavaScript · ${capturedSelectors.length} Selector.`,
      });
      onNotify?.(msg, 'info');
      return;
    }

    if (isOfflineMode) {
      const msg = 'Mode Offline sedang aktif. Aktifkan Mode Online untuk mengambil URL Blogspot live.';
      setFetchError(msg);
      appendLog({
        level: 'warn',
        source: 'url',
        title: 'Permintaan jaringan ditahan (Mode Offline aktif)',
        url: rawTarget,
        detail: msg,
      });
      onNotify?.(msg, 'info');
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const msg = 'Perangkat sedang offline. Periksa koneksi internet untuk mengambil URL live.';
      setFetchError(msg);
      appendLog({
        level: 'error',
        source: 'url',
        title: 'ERR_INTERNET_DISCONNECTED saat memeriksa URL',
        url: rawTarget,
        detail: msg,
      });
      return;
    }

    const normalizedUrl = normalizeBlogspotInputUrl(rawTarget);
    setIsFetchingUrl(true);
    setFetchError(null);
    appendLog({
      level: 'network',
      source: 'url',
      title: `GET ${normalizedUrl} → Memeriksa fingerprint & kecocokan XML...`,
      url: normalizedUrl,
    });

    const t0 = performance.now();
    try {
      const res = await fetch('/api/compare-blogspot-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const elapsedMs = Math.round(performance.now() - t0);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status} saat mengambil URL.`);
      }

      const comparison = compareBlogWithActiveTemplate(data.fingerprint, parsedInfo, xml);
      onBlogFingerprintFetched(
        data.fingerprint.sourceUrl,
        data.fingerprint,
        comparison,
        data.visualPreviewHtml || null
      );

      appendLog({
        level: 'network',
        source: 'url',
        title: `200 OK (${elapsedMs} ms) — ${data.fingerprint.blogTitle || data.fingerprint.sourceUrl}`,
        url: data.fingerprint.sourceUrl,
        detail: `Kecocokan vs XML aktif: ${comparison.similarityPercent}% (${comparison.headline}). Widget cocok: ${comparison.matchedWidgets.length}, Section cocok: ${comparison.matchedSections.length}, CSS Token cocok: ${comparison.matchedSignatureTokens.length}.`,
      });

      if (!data.fingerprint.isBloggerPowered) {
        appendLog({
          level: 'warn',
          source: 'url',
          title: 'Signature mesin Blogger standar tidak terdeteksi penuh pada HTML publik.',
          url: data.fingerprint.sourceUrl,
        });
      }
      if (/^http:\/\//i.test(data.fingerprint.sourceUrl)) {
        appendLog({
          level: 'warn',
          source: 'url',
          title: 'URL menggunakan HTTP non-HTTPS (berisiko Mixed Content pada browser modern).',
          url: data.fingerprint.sourceUrl,
        });
      }

      onNotify?.(`URL dimuat ke Konsol URL (${comparison.similarityPercent}% cocok).`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil URL ke konsol.';
      setFetchError(msg);
      appendLog({
        level: 'error',
        source: 'url',
        title: `Fetch Gagal: ${msg}`,
        url: normalizedUrl,
      });
      onNotify?.(msg, 'error');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  // Run instant offline audit on active XML & push findings into Console
  const handleAuditActiveXmlToConsole = () => {
    const insecureAssets = xmlAssets.filter((a) => a.isHttpInsecure);
    const obfuscatedAssets = xmlAssets.filter((a) => a.isObfuscated);
    const jssAssets = xmlAssets.filter((a) => a.extension === 'jss');
    const errList = xmlValidation.issues.filter((i) => i.severity === 'error');
    const warnList = xmlValidation.issues.filter((i) => i.severity === 'warning');

    appendLog({
      level: errList.length > 0 ? 'warn' : 'info',
      source: 'xml',
      title: `Audit XML Aktif: ${xmlAssets.length} URL string (${obfuscatedAssets.length} tersembunyi, ${jssAssets.length} .jss, ${insecureAssets.length} HTTP), ${jsSnippets.length} blok JS · ${errList.length} error, ${warnList.length} warning.`,
      detail: `Judul template: ${parsedInfo.templateTitle || 'Tanpa judul'} · ${parsedInfo.sections.length} section · ${parsedInfo.widgets.length} widget.`,
    });

    insecureAssets.slice(0, 6).forEach((asset) => {
      appendLog({
        level: 'warn',
        source: 'xml',
        title: `Mixed Content HTTP ditemukan pada ${asset.sourceContext}`,
        url: asset.url,
        line: asset.line,
        detail: `Pertimbangkan ganti http:// ke https:// agar tidak diblokir browser.`,
      });
    });

    obfuscatedAssets.slice(0, 6).forEach((asset) => {
      appendLog({
        level: 'network',
        source: 'xml',
        title: `URL Tersembunyi berhasil di-decode (${asset.obfuscationTechnique || 'Obfuscation'})`,
        url: asset.url,
        line: asset.line,
        codeSnippet: asset.rawText,
      });
    });

    jsSnippets.slice(0, 4).forEach((js) => {
      appendLog({
        level: js.needsCdataInXml || js.isObfuscated ? 'warn' : 'info',
        source: 'xml',
        title: `JS Tertangkap: ${js.title} (${js.embeddedUrls.length} URL, API: ${js.detectedApis.join(', ') || 'Dasar'})`,
        line: js.line,
        url: js.embeddedUrls[0],
        codeSnippet: js.code.slice(0, 320),
      });
    });

    errList.slice(0, 6).forEach((iss) => {
      appendLog({
        level: 'error',
        source: 'xml',
        title: `[${iss.code}] ${iss.message}`,
        line: iss.line,
        codeSnippet: iss.snippet,
      });
    });

    onNotify?.('Hasil audit URL String, JavaScript & XML dikirim ke Konsol.', 'success');
  };

  // Selector live evaluation
  const selectorTargetHtml = useMemo(() => {
    if (userBlogVisualHtml) return userBlogVisualHtml;
    return buildStaticHtmlFromXml(xml);
  }, [userBlogVisualHtml, xml]);

  const selectorEvalResult = useMemo(
    () => querySelectorSafely(selectorTargetHtml, xml, selectorInput),
    [selectorTargetHtml, xml, selectorInput]
  );

  // Interactive Console Evaluator ("memasukan consol dikolom lainya")
  const handleRunConsoleCommand = (rawCommand?: string) => {
    const input = (rawCommand ?? consoleInput).trim();
    if (!input) return;
    if (!rawCommand) setConsoleInput('');

    // Echo user command / pasted code
    appendLog({
      level: 'log',
      source: 'user-input',
      title: input.includes('\n') ? `> [Blok Kode / Multi-baris (${input.length} karakter)]` : `> ${input}`,
      codeSnippet: input.includes('\n') ? input.slice(0, 600) : undefined,
    });

    const lower = input.toLowerCase();

    if (lower === 'clear' || lower === 'cls') {
      setUserConsoleEntries([]);
      onClearPreviewLogs();
      return;
    }

    if (lower === 'help' || lower === '?') {
      appendLog({
        level: 'info',
        source: 'user-input',
        title: 'Panduan Perintah Konsol URL & Query Tester TemaLoka',
        detail: [
          '• query <string/url> → Parse & uji Query String + Query Parameter (contoh: query ?param=nilai)',
          '• params <k=v&...> → Uji parameter langsung (contoh: params tab=pricing&mode=dark)',
          '• test-query <url> → Kirim HTTP GET live ke server & baca status + JSON/HTML respons',
          '• urls → Tampilkan semua URL aset (.css, .js, .jss) & URL tersembunyi di XML',
          '• js → Tampilkan semua blok JavaScript & event handler dari XML beserta URL di dalamnya',
          '• errors → Tampilkan error & warning Validator XML Blogger beserta barisnya',
          '• vars → Tampilkan daftar <Variable> & --css-var pada tema aktif',
          '• selector <css> → Uji selector CSS di XML/Blog HTML (contoh: selector .widget)',
          '• decode <teks> → Bongkar URL/JS tersembunyi (atob, %XX, \\xHH, Packer, String.fromCharCode)',
          '• check <url> → Analisis URL & cari kecocokan di dalam XML aktif',
          '• Tempel langsung: Tempel ?q=seo&m=1, potongan JavaScript, URL lengkap, atau error browser tanpa awalan perintah.',
        ].join('\n'),
      });
      return;
    }

    if (lower.startsWith('test-query ')) {
      const target = input.slice(11).trim();
      const parsed = loadRawQueryIntoBuilder(target, false);
      void handleTestLiveQueryUrl(parsed.normalizedUrl);
      return;
    }

    if (lower.startsWith('query ') || lower.startsWith('params ')) {
      const target = input.slice(lower.startsWith('query ') ? 6 : 7).trim();
      loadRawQueryIntoBuilder(target, false);
      handleSimulateQueryToConsole(target);
      return;
    }

    // Raw query string pasted directly: "?m=1&max-results=8" or "m=1&q=hello"
    const looksLikeStandaloneQuery =
      /^\?[^\s]+$/.test(input) ||
      (/^[a-zA-Z0-9_.-]+=[^\s&]*(?:&(?:amp;)?[a-zA-Z0-9_.-]+=[^\s&]*)*$/i.test(input) &&
        !input.includes(' ') &&
        !input.includes('('));
    if (looksLikeStandaloneQuery) {
      loadRawQueryIntoBuilder(input, false);
      handleSimulateQueryToConsole(input);
      return;
    }

    if (lower === 'urls') {
      if (xmlAssets.length === 0) {
        appendLog({
          level: 'info',
          source: 'xml',
          title: 'Tidak ditemukan URL atau aset .css/.js/.jss di XML aktif.',
        });
        return;
      }
      appendLog({
        level: 'network',
        source: 'xml',
        title: `Daftar URL & Aset XML (${xmlAssets.length} item)`,
        detail: xmlAssets
          .slice(0, 25)
          .map(
            (a, i) =>
              `${i + 1}. [Baris ${a.line}] (${a.kind.toUpperCase()}${
                a.isObfuscated ? ' · DECODED' : ''
              }) ${a.url}`
          )
          .join('\n'),
        line: xmlAssets[0]?.line ?? null,
        url: xmlAssets[0]?.url,
      });
      return;
    }

    if (lower === 'js') {
      if (jsSnippets.length === 0) {
        appendLog({
          level: 'info',
          source: 'xml',
          title: 'Tidak ditemukan blok <script> / JavaScript pada XML aktif.',
        });
        return;
      }
      jsSnippets.slice(0, 12).forEach((js) => {
        appendLog({
          level: js.needsCdataInXml || js.isObfuscated ? 'warn' : 'info',
          source: 'xml',
          title: `[Baris ${js.line}] ${js.title}`,
          line: js.line,
          url: js.embeddedUrls[0],
          detail: [
            `Sumber: ${js.sourceContext} · Ukuran: ${js.byteSize} B`,
            js.detectedApis.length > 0 ? `API: ${js.detectedApis.join(', ')}` : null,
            js.embeddedUrls.length > 0 ? `URL tertangkap:\n${js.embeddedUrls.join('\n')}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
          codeSnippet: js.code.slice(0, 420),
        });
      });
      return;
    }

    if (lower === 'errors') {
      if (xmlValidation.issues.length === 0) {
        appendLog({
          level: 'info',
          source: 'xml',
          title: '0 Error/Warning XML! Template XML lolos validasi struktur Blogger.',
        });
        return;
      }
      xmlValidation.issues.slice(0, 10).forEach((iss) => {
        appendLog({
          level: iss.severity === 'error' ? 'error' : 'warn',
          source: 'xml',
          title: `[${iss.code}] ${iss.message}`,
          line: iss.line,
          codeSnippet: iss.snippet,
        });
      });
      return;
    }

    if (lower === 'vars') {
      const topVars = parsedInfo.variables.slice(0, 12);
      const topCssVars = parsedInfo.cssCustomProperties.slice(0, 12);
      appendLog({
        level: 'info',
        source: 'xml',
        title: `Variabel Tema: ${parsedInfo.variables.length} <Variable>, ${parsedInfo.cssCustomProperties.length} CSS --var`,
        detail: [
          topVars.length > 0
            ? 'Blogger <Variable>: ' + topVars.map((v) => `${v.name}=${v.value}`).join(', ')
            : 'Tidak ada <Variable>.',
          topCssVars.length > 0
            ? 'CSS Vars: ' + topCssVars.map((c) => `${c.name}: ${c.value}`).join(', ')
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return;
    }

    // selector ... or document.querySelector(...)
    const dqMatch =
      /^document\.querySelector(?:All)?\s*\(\s*(['"`])([\s\S]+?)\1\s*\)/i.exec(input) ||
      /^\$\s*\(\s*(['"`])([\s\S]+?)\1\s*\)/i.exec(input);
    if (lower.startsWith('selector ') || dqMatch) {
      const sel = dqMatch ? dqMatch[2] : input.slice(9).trim();
      setSelectorInput(sel);
      setLeftTab('selector');
      const res = querySelectorSafely(selectorTargetHtml, xml, sel);
      if (res.error) {
        appendLog({
          level: 'error',
          source: 'user-input',
          title: `SyntaxError Selector: ${res.error}`,
        });
      } else {
        appendLog({
          level: res.count > 0 ? 'info' : 'warn',
          source: 'user-input',
          title: `Selector "${sel}" cocok dengan ${res.count} elemen`,
          detail:
            res.items.length > 0
              ? res.items
                  .slice(0, 6)
                  .map(
                    (it, idx) =>
                      `${idx + 1}. <${it.tagName}${it.idAttr ? ` id="${it.idAttr}"` : ''}${
                        it.classAttr ? ` class="${it.classAttr}"` : ''
                      }>${it.xmlLine ? ` [XML Baris ${it.xmlLine}]` : ''}`
                  )
                  .join('\n')
              : 'Tidak ada elemen yang cocok pada struktur HTML/XML aktif.',
          line: res.items[0]?.xmlLine ?? null,
        });
      }
      return;
    }

    // Check / Inspect URL (with optional quotes around URL string and automatic Query Parameter breakdown)
    const strippedQuotes = input.replace(/^['"`]|['"`]$/g, '').trim();
    const urlExtract =
      /^(?:check\s+)?['"`]?((?:https?:\/\/|\/\/)[a-zA-Z0-9.-]+\.[a-z]{2,}[^\s"'`]*|[a-zA-Z0-9-]+\.blogspot\.[a-z.]+(?:\/[^\s"'`]*)?)['"`]?$/i.exec(
        strippedQuotes
      );
    if (urlExtract) {
      const rawUrl = urlExtract[1];
      const fullUrl = normalizeBlogspotInputUrl(rawUrl);
      const isHttpInsecure = /^http:\/\//i.test(fullUrl);
      const matchingAsset = xmlAssets.find(
        (a) =>
          a.url.toLowerCase().includes(rawUrl.toLowerCase()) ||
          fullUrl.toLowerCase() === a.url.toLowerCase()
      );
      const lineInXml = matchingAsset?.line ?? findLineNumberInXml(xml, rawUrl);
      const isBlogspot = /\.blogspot\./i.test(fullUrl) || /^https?:\/\/[^/]+\/?$/i.test(fullUrl);
      const qAnalysis = fullUrl.includes('?')
        ? parseAndAnalyzeQueryString(fullUrl, builtQueryState.resolvedBase)
        : null;
      if (qAnalysis && qAnalysis.params.length > 0) {
        loadRawQueryIntoBuilder(fullUrl, false);
      }

      appendLog({
        level: isHttpInsecure ? 'warn' : 'network',
        source: 'url',
        title: `Inspeksi URL${qAnalysis && qAnalysis.params.length > 0 ? ` + ${qAnalysis.params.length} Query Parameter` : ''}: ${fullUrl}`,
        url: fullUrl,
        line: lineInXml,
        detail: [
          `Protokol: ${isHttpInsecure ? 'HTTP (Rentan Mixed Content)' : 'HTTPS (Aman)'}`,
          matchingAsset
            ? `Ditemukan di XML aktif sebagai ${matchingAsset.sourceContext} (Baris ${matchingAsset.line}).`
            : lineInXml
              ? `URL tertulis di XML aktif pada baris ${lineInXml}.`
              : 'URL ini belum ada di XML aktif.',
          qAnalysis && qAnalysis.params.length > 0
            ? `Query String: ${qAnalysis.queryString}\nQuery Parameter:\n${qAnalysis.params
                .map((p, idx) => `  ${idx + 1}. ${p.key} = "${p.value}"${p.meaningHint ? ` (${p.meaningHint})` : ''}`)
                .join('\n')}`
            : null,
          isBlogspot
            ? 'Tips: Gunakan "Pakai ke URL Blogspot" di atas atau ketik "test-query <url>" untuk uji GET live.'
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return;
    }

    // Explicit decode <payload> OR heavy obfuscated string
    const looksObfuscated =
      lower.startsWith('decode ') ||
      /atob\s*\(|eval\s*\(|String\s*\.\s*fromCharCode|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|https?%3a%2f%2f|aHR0cHM6Ly|aHR0cDovLw/i.test(
        input
      );
    if (looksObfuscated) {
      const payload = lower.startsWith('decode ') ? input.slice(7).trim() : input;
      const decoded = smartDecodeCodeOffline(payload);
      const jsInsp = inspectJsSnippetForConsole(decoded.decodedText);
      appendLog({
        level: decoded.revealedUrls.length > 0 || jsInsp.extractedUrls.length > 0 ? 'network' : 'info',
        source: 'user-input',
        title: decoded.changed
          ? `Decode & Analisis JS (${decoded.appliedLayers.join(' → ')})`
          : 'Hasil Dekode Payload / JavaScript',
        url: decoded.revealedUrls[0] || jsInsp.extractedUrls[0],
        line: findLineNumberInXml(xml, payload.slice(0, 32)),
        codeSnippet: decoded.decodedText.slice(0, 900),
        detail: [
          jsInsp.extractedUrls.length > 0
            ? `URL String terungkap (${jsInsp.extractedUrls.length}):\n${jsInsp.extractedUrls.join('\n')}`
            : null,
          jsInsp.detectedApis.length > 0 ? `API JS: ${jsInsp.detectedApis.join(', ')}` : null,
          jsInsp.warnings.length > 0 ? `Peringatan: ${jsInsp.warnings.join(' ')}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return;
    }

    // Auto-diagnose pasted Browser DevTools Errors
    const looksLikeConsoleError =
      /Uncaught|TypeError|ReferenceError|SyntaxError|Mixed Content|CORS|Access-Control-Allow-Origin|Failed to load resource|ERR_|404|403|500|SAXParseException|ParseError/i.test(
        input
      );
    if (looksLikeConsoleError) {
      let diagnosis = 'Pesan error konsol browser terdeteksi.';
      let matchedLine: number | null = null;

      if (/Mixed Content/i.test(input)) {
        const httpAsset = xmlAssets.find((a) => a.isHttpInsecure);
        matchedLine = httpAsset?.line ?? findLineNumberInXml(xml, 'http://');
        diagnosis =
          'Mixed Content terjadi karena halaman HTTPS memuat skrip/CSS/gambar melalui http://. Ganti http:// menjadi https:// atau //. ' +
          (httpAsset ? `Di XML aktif ditemukan di Baris ${httpAsset.line}: ${httpAsset.url}` : '');
      } else if (/CORS|Access-Control-Allow-Origin/i.test(input)) {
        diagnosis =
          'Kebijakan CORS memblokir request fetch/XHR/font ke domain eksternal. Pastikan CDN mendukung CORS atau pindahkan aset ke Google Fonts / CDN publik yang mengizinkan origin blog.';
      } else if (/TypeError|ReferenceError|is not a function|undefined|null/i.test(input)) {
        const tokenMatch = /([a-zA-Z_$][a-zA-Z0-9_$]{2,})\s+is not defined|Cannot read propert/i.exec(
          input
        );
        if (tokenMatch?.[1]) {
          matchedLine = findLineNumberInXml(xml, tokenMatch[1]);
        }
        diagnosis =
          'Error runtime JavaScript: variabel/fungsi belum didefinisikan atau elemen DOM bernilai null sebelum skrip berjalan. Pastikan skrip ditempatkan sebelum </body> atau dibungkus DOMContentLoaded.' +
          (matchedLine ? ` Token terkait ditemukan di XML Baris ${matchedLine}.` : '');
      } else if (/SyntaxError|SAXParseException|ParseError/i.test(input)) {
        diagnosis =
          'SyntaxError / ParseError pada XML atau JS: periksa apakah ada karakter "&", "<", ">" mentah di dalam <script>/<style> yang belum dibungkus CDATA, atau tanda kurung/kutip tidak berpasangan.';
        matchedLine = xmlValidation.issues[0]?.line ?? null;
      } else if (/404|Failed to load resource/i.test(input)) {
        const urlInErr = /(https?:\/\/[^\s'"]+)/i.exec(input)?.[1];
        if (urlInErr) {
          matchedLine = findLineNumberInXml(xml, urlInErr);
        }
        diagnosis =
          'Sumber daya eksternal (.js/.css/gambar) gagal dimuat (404/terblokir). Periksa tautan CDN atau muat ulang dari mirror aktif.' +
          (matchedLine ? ` Ditemukan pada XML Baris ${matchedLine}.` : '');
      }

      appendLog({
        level: 'error',
        source: 'user-input',
        title: 'Diagnosa Error Konsol Browser',
        detail: diagnosis,
        line: matchedLine,
      });
      return;
    }

    // JavaScript snippet / expression static inspection (detects URL strings, APIs, functions, brace balance, CDATA)
    const looksLikeJavaScript =
      /\b(?:function|const|let|var|return|if|for|fetch|async|await|document|window|console)\b|=>|\(\s*\)\s*\{|<script/i.test(
        input
      ) || input.includes('\n');
    if (looksLikeJavaScript) {
      const jsInsp = inspectJsSnippetForConsole(input);
      const inlineLine = findLineNumberInXml(
        xml,
        input.split(/\r?\n/)[0].trim().slice(0, 48)
      );

      appendLog({
        level: jsInsp.warnings.length > 0 ? 'warn' : jsInsp.extractedUrls.length > 0 ? 'network' : 'info',
        source: 'user-input',
        title: `Inspeksi JavaScript Konsol (${jsInsp.braceBalanceOk && jsInsp.parenBalanceOk ? 'Kurung Seimbang' : 'Cek Kurung!'})`,
        line: inlineLine,
        url: jsInsp.extractedUrls[0],
        detail: [
          jsInsp.detectedFunctions.length > 0
            ? `Fungsi terdeteksi: ${jsInsp.detectedFunctions.join(', ')}`
            : null,
          jsInsp.detectedApis.length > 0
            ? `API Browser dipakai: ${jsInsp.detectedApis.join(', ')}`
            : null,
          jsInsp.extractedUrls.length > 0
            ? `URL String tertangkap di JS (${jsInsp.extractedUrls.length}):\n${jsInsp.extractedUrls.join('\n')}`
            : 'Tidak ada URL string eksternal di dalam potongan JS ini.',
          jsInsp.decodedLayers.length > 0
            ? `Lapisan Obfuscation: ${jsInsp.decodedLayers.join(' → ')}`
            : null,
          jsInsp.warnings.length > 0
            ? `Catatan:\n- ${jsInsp.warnings.join('\n- ')}`
            : 'Aman untuk sintaks JS dasar.',
          inlineLine ? `Potongan ini ditemukan di XML aktif pada Baris ${inlineLine}.` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        codeSnippet:
          jsInsp.decodedLayers.length > 0 ? jsInsp.decodedCode.slice(0, 500) : undefined,
      });
      return;
    }

    // Fallback: safe static inspection of arbitrary snippet / selector check
    const fallbackDec = smartDecodeCodeOffline(input);
    const maybeSelector =
      /^[.#\[a-zA-Z][a-zA-Z0-9_.\-#:\[\]="'\s*>+~()]+$/.test(input) && input.length < 80;
    const selTest = maybeSelector ? querySelectorSafely(selectorTargetHtml, xml, input) : null;
    const inlineLine = findLineNumberInXml(xml, input.slice(0, 48));

    appendLog({
      level: 'info',
      source: 'user-input',
      title: 'Hasil Inspeksi Statis Konsol (Aman tanpa eval)',
      line: inlineLine ?? selTest?.items[0]?.xmlLine ?? null,
      detail: [
        fallbackDec.changed
          ? `Terdeteksi lapisan kode tersembunyi (${fallbackDec.appliedLayers.join(' → ')}): ${fallbackDec.decodedText.slice(0, 260)}`
          : null,
        selTest && !selTest.error
          ? `Jika dianggap selector CSS "${input}": cocok dengan ${selTest.count} elemen di struktur aktif.`
          : null,
        inlineLine ? `Teks/potongan kode ini ditemukan di XML pada Baris ${inlineLine}.` : null,
        !fallbackDec.changed && !inlineLine && (!selTest || selTest.count === 0)
          ? 'Ketik "help" untuk daftar perintah (urls, js, errors, vars, selector <css>, decode <kode>, check <url>).'
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  };

  // Receive Query String, URL, or JavaScript payload directly from XML Editor
  useEffect(() => {
    if (!pendingConsolePayload) return;
    if (lastConsumedPayloadIdRef.current === pendingConsolePayload.id) return;
    lastConsumedPayloadIdRef.current = pendingConsolePayload.id;

    const { payload, kind, runNow } = pendingConsolePayload;
    if (kind === 'query-string') {
      loadRawQueryIntoBuilder(payload, true);
      if (runNow) {
        handleSimulateQueryToConsole(payload);
      } else {
        pasteIntoConsolePrompt(`query ${payload}`, true);
      }
    } else if (runNow) {
      handleRunConsoleCommand(kind === 'url-string' ? `check ${payload}` : payload);
    } else {
      pasteIntoConsolePrompt(payload, true);
    }
    onConsumePendingConsolePayload?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConsolePayload]);

  const handleCopyAllLogs = () => {
    const text = mergedConsoleLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.title}${
            l.url ? `\n  URL: ${l.url}` : ''
          }${l.line ? ` (Baris ${l.line})` : ''}${l.detail ? `\n  ${l.detail}` : ''}`
      )
      .join('\n\n');
    copyText(text || '(Log konsol kosong)', 'copy-all-console', 'Seluruh log konsol');
  };

  const renderAssetRow = (asset: CapturedUrlStringItem) => {
    return (
      <div
        key={asset.id}
        className="p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors space-y-1.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase rounded ${
                asset.kind === 'css'
                  ? 'bg-sky-50 text-sky-800 border border-sky-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              {asset.extension || asset.kind}
            </span>
            <span className="text-xs font-semibold text-slate-900 truncate">{asset.host}</span>
            {asset.isObfuscated && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-purple-50 text-purple-800 border border-purple-200 rounded">
                Decoded: {asset.obfuscationTechnique || 'Obfuscated'}
              </span>
            )}
            {asset.isHttpInsecure && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-red-50 text-red-700 border border-red-200 rounded">
                HTTP Non-SSL
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onJumpToEditorLine(asset.line)}
              className="px-2 py-1 text-[11px] font-mono tabular-nums bg-slate-100 hover:bg-slate-200 text-slate-800 rounded cursor-pointer"
            >
              Baris {asset.line} &rarr;
            </button>
            <button
              type="button"
              onClick={() => copyText(asset.url, asset.id, 'URL string')}
              className="p-1 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
              title="Salin URL"
            >
              {copiedId === asset.id ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => pasteIntoConsolePrompt(asset.url)}
              className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
            >
              Tempel
            </button>
            <button
              type="button"
              onClick={() => handleRunConsoleCommand(asset.consoleCommand)}
              className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
            >
              Uji
            </button>
          </div>
        </div>

        <div className="text-[11px] font-mono text-slate-700 break-all bg-slate-50 border border-slate-100 rounded px-2 py-1 select-all">
          {asset.url}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Sumber: {asset.sourceContext}</span>
          <span className="font-mono tabular-nums">Baris {asset.line}</span>
        </div>
      </div>
    );
  };

  const levelBadgeClass = (level: DevConsoleLevel) => {
    switch (level) {
      case 'error':
        return 'text-red-300 bg-red-950/70 border-red-700/60';
      case 'warn':
        return 'text-amber-300 bg-amber-950/60 border-amber-700/60';
      case 'network':
        return 'text-cyan-300 bg-cyan-950/60 border-cyan-700/60';
      case 'info':
        return 'text-blue-300 bg-blue-950/60 border-blue-700/60';
      default:
        return 'text-slate-300 bg-slate-800 border-slate-700';
    }
  };

  const dynamicQuickChips = useMemo(() => {
    const chips: Array<{ label: string; cmd: string }> = [];
    if (dynamicQueryScan.parameters[0]) {
      const p0 = dynamicQueryScan.parameters[0];
      chips.push({
        label: `Uji ${p0.testQueryExample}`,
        cmd: `query ${p0.testQueryExample}`,
      });
    }
    if (dynamicQueryScan.fullExampleQueryString && dynamicQueryScan.parameters.length > 1) {
      chips.push({
        label: `Semua Param (${dynamicQueryScan.parameters.length})`,
        cmd: `query ${dynamicQueryScan.fullExampleQueryString}`,
      });
    }
    chips.push(
      { label: 'Semua JavaScript', cmd: 'js' },
      { label: 'Semua URL', cmd: 'urls' },
      { label: 'Error XML', cmd: 'errors' }
    );
    if (capturedSelectors[0]) {
      chips.push({
        label: `Uji ${capturedSelectors[0].selector}`,
        cmd: capturedSelectors[0].consoleCommand,
      });
    }
    return chips;
  }, [dynamicQueryScan, capturedSelectors]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#F8FAFC] overflow-hidden">
      {offlineAi && (
        <OfflineAiRuntimeBar
          controller={offlineAi}
          page="console"
          xml={xml}
          parsedInfo={parsedInfo}
        />
      )}
      {/* Top Unified URL Sync & Action Bar */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-5 py-3 shrink-0 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Terminal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-sm font-bold text-slate-900">
                  Konsol URL, Query String &amp; Pengembang Browser
                </h1>
                <span className="text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                  Tersinkron 1:1 dengan Cek Kecocokan URL Blogspot
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                Deteksi otomatis Query String, Query Parameter, JavaScript, URL aset &amp; penguji request langsung di konsol.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAuditActiveXmlToConsole}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Audit XML ke Konsol</span>
            </button>
            {userBlogVisualHtml && onOpenUserBlogPreview && (
              <button
                type="button"
                onClick={onOpenUserBlogPreview}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Lihat Iframe URL</span>
              </button>
            )}
          </div>
        </div>

        {/* Shared Blogspot URL Input (always visible, even when empty) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleFetchSyncedUrlToConsole();
          }}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
        >
          <div className="relative flex-1 min-w-0">
            <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={sharedBlogUrl}
              onChange={(e) => {
                onSharedBlogUrlChange(e.target.value);
                if (fetchError) setFetchError(null);
              }}
              placeholder="https://namabloganda.blogspot.com (otomatis sama dengan Cek Kecocokan URL Blogspot...)"
              className="w-full pl-9 pr-8 py-2 text-xs font-mono bg-slate-50 focus:bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            {sharedBlogUrl && (
              <button
                type="button"
                onClick={() => onSharedBlogUrlChange('')}
                title="Kosongkan URL (kolom konsol tetap tampil)"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isFetchingUrl}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isFetchingUrl ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Mengambil URL...</span>
              </>
            ) : (
              <>
                <Network className="w-3.5 h-3.5" />
                <span>{sharedBlogUrl.trim() ? 'Cek & Muat ke Konsol' : 'Jalankan Cek Konsol'}</span>
              </>
            )}
          </button>
        </form>

        {isOfflineMode && (
          <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900">
            <div className="flex items-center gap-2">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>
                Mode Offline aktif — semua deteksi URL string, JavaScript, decoder, dan penguji selector tetap berjalan otomatis 100% offline.
              </span>
            </div>
            {onSwitchToOnline && (
              <button
                type="button"
                onClick={onSwitchToOnline}
                className="px-2.5 py-1 bg-amber-900 hover:bg-amber-800 text-white rounded font-medium cursor-pointer"
              >
                Aktifkan Online
              </button>
            )}
          </div>
        )}

        {fetchError && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-800">
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{fetchError}</span>
          </div>
        )}
      </div>

      {/* Main Browser DevTools Split Columns */}
      <div className="flex-1 min-h-0 p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-12 gap-3 sm:gap-4 overflow-y-auto xl:overflow-hidden">
        {/* LEFT COLUMN (7 cols): Auto-Detected Testable Candidates + URL Assets + Structure Match + DOM Selector */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col min-h-[440px] xl:min-h-0 overflow-hidden">
          <div className="px-3 sm:px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setLeftTab('auto-test')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer tabular-nums ${
                  leftTab === 'auto-test'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                Siap Uji Otomatis ({autoTestableItems.length})
              </button>
              <button
                type="button"
                onClick={() => setLeftTab('query-tester')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer tabular-nums ${
                  leftTab === 'query-tester'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/70'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Penguji Parameter Dinamis ({dynamicQueryScan.parameters.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setLeftTab('resources')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer tabular-nums ${
                  leftTab === 'resources'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                URL &amp; Aset ({xmlAssets.length})
              </button>
              <button
                type="button"
                onClick={() => setLeftTab('match')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer tabular-nums ${
                  leftTab === 'match'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                Kecocokan Blogspot {comparisonResult ? `(${comparisonResult.similarityPercent}%)` : ''}
              </button>
              <button
                type="button"
                onClick={() => setLeftTab('selector')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                  leftTab === 'selector'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                Uji Selector DOM
              </button>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              {sharedBlogUrl.trim() ? 'URL Terisi' : 'URL Kosong (Siap Uji XML)'}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
            {/* Synced URL Summary Banner */}
            <div
              className={`p-3 rounded-lg border space-y-1 ${
                comparisonResult
                  ? comparisonResult.verdict === 'same'
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : comparisonResult.verdict === 'partial'
                      ? 'bg-amber-50/70 border-amber-200'
                      : 'bg-slate-50 border-slate-200'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  Target URL Konsol &amp; Blogspot
                </span>
                <span className="text-[11px] font-mono text-slate-600 truncate max-w-[320px]">
                  {sharedBlogUrl.trim() || '(Belum diisi — target XML tetap tampil di bawah)'}
                </span>
              </div>
              {liveFingerprint ? (
                <div className="text-[11px] text-slate-700">
                  Blog: <span className="font-semibold">{liveFingerprint.blogTitle || '-'}</span> &middot; Widget:{' '}
                  <span className="font-mono tabular-nums">{liveFingerprint.widgets.length}</span> &middot; GA:{' '}
                  <span className="font-mono tabular-nums">{liveFingerprint.gaIds.length}</span> &middot; AdSense:{' '}
                  <span className="font-mono tabular-nums">{liveFingerprint.adsenseClients.length}</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span>
                    Otomatis terdeteksi dari XML:{' '}
                    <strong>{dynamicQueryScan.parameters.length} Parameter Dinamis</strong>,{' '}
                    <strong>{jsSnippets.length} JavaScript</strong>, <strong>{xmlAssets.length} URL Aset</strong>,{' '}
                    <strong>{capturedSelectors.length} Selector</strong>.
                  </span>
                  <button
                    type="button"
                    onClick={() => setLeftTab('query-tester')}
                    className="font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Buka Penguji Parameter Dinamis &rarr;
                  </button>
                </div>
              )}
            </div>

            {/* TAB 1 (DEFAULT): Auto-Detected Testable Items — Ready to Copy, Paste & Test */}
            {leftTab === 'auto-test' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        ['all', `Semua (${autoTestableItems.length})`],
                        ['query-string', `Parameter & Query (${dynamicQueryScan.parameters.length + queryStrings.length})`],
                        ['javascript', `JavaScript (${jsSnippets.length})`],
                        ['url-string', `URL Aset (${xmlAssets.length})`],
                        ['selector', `Selector (${capturedSelectors.length})`],
                        ['xml-error', `Error XML (${xmlValidation.issues.length})`],
                      ] as Array<[AutoTestCategory, string]>
                    ).map(([cat, label]) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setAutoCategory(cat)}
                        className={`px-2 py-1 text-[11px] font-medium rounded border cursor-pointer tabular-nums ${
                          autoCategory === cat
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-52">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={autoSearch}
                      onChange={(e) => setAutoSearch(e.target.value)}
                      placeholder="Filter query, JS, URL..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {filteredAutoItems.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg text-xs text-slate-500">
                    Tidak ada item siap uji yang cocok dengan filter saat ini.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredAutoItems.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-lg border transition-colors space-y-1.5 ${
                          item.isHighlight
                            ? 'bg-amber-50/40 border-amber-200'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border shrink-0 ${
                                item.category === 'query-string'
                                  ? 'bg-teal-50 text-teal-800 border-teal-200'
                                  : item.category === 'url-string'
                                    ? 'bg-sky-50 text-sky-800 border-sky-200'
                                    : item.category === 'javascript'
                                      ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                      : item.category === 'selector'
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        : 'bg-red-50 text-red-800 border-red-200'
                              }`}
                            >
                              {item.badge}
                            </span>
                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {item.title}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1 shrink-0">
                            {item.line && (
                              <button
                                type="button"
                                onClick={() => onJumpToEditorLine(item.line)}
                                className="px-2 py-1 text-[11px] font-mono tabular-nums bg-slate-100 hover:bg-slate-200 text-slate-800 rounded cursor-pointer"
                              >
                                Baris {item.line} &rarr;
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => copyText(item.copyText, item.id, item.badge)}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded cursor-pointer"
                              title="Salin kode/Query untuk ditempel"
                            >
                              {copiedId === item.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>Salin</span>
                            </button>
                            {item.category === 'query-string' && item.rawQueryPayload && (
                              <button
                                type="button"
                                onClick={() => loadRawQueryIntoBuilder(item.rawQueryPayload!, true)}
                                className="px-2 py-1 text-[11px] font-medium bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded cursor-pointer"
                              >
                                Muat ke Penguji
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => pasteIntoConsolePrompt(item.consolePayload)}
                              className="px-2 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-white rounded cursor-pointer"
                            >
                              Tempel ke Konsol
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunConsoleCommand(item.consolePayload)}
                              className="px-2 py-1 text-[11px] font-medium bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded cursor-pointer"
                            >
                              Uji
                            </button>
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-500">{item.subtitle}</div>
                        <pre className="text-[11px] font-mono text-slate-800 bg-slate-50 border border-slate-100 rounded px-2.5 py-1.5 whitespace-pre-wrap break-all max-h-24 overflow-y-auto select-all">
                          {item.previewCode}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Dynamic XML Parameter Scanner + Quick Preview Tester */}
            {leftTab === 'query-tester' && (
              <div className="space-y-4">
                {/* SECTION 1: Detected Dynamic Parameters from Active XML */}
                <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50/35 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h2 className="text-xs font-bold text-slate-900">
                        Deteksi Otomatis Parameter &amp; Query URL dari XML Aktif ({filteredDynamicParams.length}
                        {querySearch.trim() ? ` / ${dynamicQueryScan.parameters.length}` : ''})
                      </h2>
                      <p className="text-[11px] text-slate-600">
                        Memindai <span className="font-mono">URLSearchParams</span>,{' '}
                        <span className="font-mono">location.search</span>,{' '}
                        <span className="font-mono">new URL().searchParams</span>, Regex/Helper JS, Form GET &amp; link <span className="font-mono">?param=nilai</span> langsung di sisi klien.
                      </p>
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={querySearch}
                        onChange={(e) => setQuerySearch(e.target.value)}
                        placeholder="Cari nama param, nilai opsi, baris..."
                        className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-600"
                      />
                      {querySearch && (
                        <button
                          type="button"
                          onClick={() => setQuerySearch('')}
                          title="Bersihkan pencarian"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quick bulk actions when parameters exist */}
                  {dynamicQueryScan.parameters.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const pairs = dynamicQueryScan.parameters.map((p) => ({
                            key: p.name,
                            value: detectedParamDrafts[p.name] ?? p.suggestedValue,
                            enabled: true,
                          }));
                          const { rawQuery } = buildQueryStringFromPairs(pairs);
                          copyText(
                            `${builtQueryState.resolvedBase}${rawQuery || ''}`,
                            'dyn-copy-all-url',
                            'URL Uji Lengkap'
                          );
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        {copiedId === 'dyn-copy-all-url' ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy URL Uji</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const mapObj: Record<string, string> = {};
                          for (const p of dynamicQueryScan.parameters) {
                            mapObj[p.name] = detectedParamDrafts[p.name] ?? p.suggestedValue;
                          }
                          const snippet = `const params = new URLSearchParams(${JSON.stringify(
                            mapObj,
                            null,
                            2
                          )});\nconsole.log('?'.concat(params.toString()));`;
                          copyText(snippet, 'dyn-copy-all-js', 'Snippet Console JS');
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        {copiedId === 'dyn-copy-all-js' ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy Snippet Console JS</span>
                      </button>
                      {onApplyPreviewQueryParams && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const payload: Record<string, string> = {};
                              for (const p of dynamicQueryScan.parameters) {
                                payload[p.name] = detectedParamDrafts[p.name] ?? p.suggestedValue;
                              }
                              onApplyPreviewQueryParams(payload, true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            <span>Terapkan Semua ke Preview</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onResetPreviewQueryParams?.();
                              const resetMap: Record<string, string> = {};
                              for (const p of dynamicQueryScan.parameters) {
                                resetMap[p.name] = p.suggestedValue;
                              }
                              setDetectedParamDrafts(resetMap);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Reset Parameter</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Empty XML or 0 detected parameters or list of DetectedQueryParameter */}
                  {dynamicQueryScan.xmlEmpty ? (
                    <div className="p-4 text-center border border-dashed border-slate-300 bg-white rounded-lg text-xs text-slate-600">
                      Kode XML masih kosong. Silakan unggah file <span className="font-mono">.xml</span> atau tempel kode di Editor XML untuk memindai parameter URL secara otomatis.
                    </div>
                  ) : dynamicQueryScan.parameters.length === 0 ? (
                    <div className="p-4 border border-dashed border-slate-300 bg-white rounded-lg text-xs text-slate-600 space-y-1">
                      <div className="font-semibold text-slate-800">
                        Tidak ditemukan parameter URL pada XML aktif.
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Pemindai telah memeriksa blok <span className="font-mono">&lt;script&gt;</span>, event inline JS, <span className="font-mono">&lt;form method=&quot;get&quot;&gt;</span>, atribut link/src, dan ekspresi template tanpa menemukan pola pembacaan parameter. Anda tetap dapat menguji parameter kustom melalui builder di bawah.
                      </p>
                    </div>
                  ) : filteredDynamicParams.length === 0 ? (
                    <div className="p-4 text-center border border-dashed border-slate-300 bg-white rounded-lg text-xs text-slate-500">
                      Tidak ada parameter yang cocok dengan pencarian &ldquo;{querySearch}&rdquo;.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredDynamicParams.map((param: DetectedQueryParameter) => {
                        const draftVal = detectedParamDrafts[param.name] ?? param.suggestedValue;
                        const exampleUrlWithVal = `${builtQueryState.resolvedBase}?${encodeURIComponent(
                          param.name
                        )}=${encodeURIComponent(draftVal)}`;
                        const snippetWithVal = [
                          `// Uji parameter "${param.name}" (${param.primarySourceLabel})`,
                          `const params = new URLSearchParams('?${encodeURIComponent(
                            param.name
                          )}=${encodeURIComponent(draftVal)}');`,
                          `console.log('${param.name} =', params.get('${param.name}'));`,
                        ].join('\n');

                        return (
                          <div
                            key={param.id}
                            className="p-3 bg-white border border-slate-200 rounded-lg space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span className="px-2 py-0.5 text-xs font-mono font-bold bg-teal-50 text-teal-900 border border-teal-200 rounded">
                                  {param.name}
                                </span>
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded">
                                  {param.primarySourceLabel}
                                </span>
                                {param.isBooleanFlag && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-mono bg-indigo-50 text-indigo-800 border border-indigo-200 rounded">
                                    Flag / .has()
                                  </span>
                                )}
                                <span className="text-[11px] font-mono text-slate-500">
                                  ?{param.name}={draftVal || '(kosong)'}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => onJumpToEditorLine(param.primaryLine)}
                                className="px-2 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 rounded cursor-pointer shrink-0"
                              >
                                Baris {param.primaryLine} &rarr;
                              </button>
                            </div>

                            {/* Quick Value Dropdown + Editable Input */}
                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                              {param.candidateValues.length > 0 && (
                                <select
                                  aria-label={`Nilai terdeteksi untuk ${param.name}`}
                                  value={
                                    param.candidateValues.includes(draftVal) ? draftVal : '__custom__'
                                  }
                                  onChange={(e) => {
                                    if (e.target.value !== '__custom__') {
                                      setDetectedParamDrafts((prev) => ({
                                        ...prev,
                                        [param.name]: e.target.value,
                                      }));
                                    }
                                  }}
                                  className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-teal-600 cursor-pointer"
                                >
                                  {param.candidateValues.map((valOpt) => (
                                    <option key={valOpt} value={valOpt}>
                                      Opsi: {valOpt}
                                    </option>
                                  ))}
                                  {!param.candidateValues.includes(draftVal) && (
                                    <option value="__custom__">(Nilai Kustom)</option>
                                  )}
                                </select>
                              )}
                              <input
                                type="text"
                                value={draftVal}
                                onChange={(e) =>
                                  setDetectedParamDrafts((prev) => ({
                                    ...prev,
                                    [param.name]: e.target.value,
                                  }))
                                }
                                placeholder={`Masukkan nilai untuk ${param.name}...`}
                                className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs font-mono bg-slate-50 focus:bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-teal-600"
                              />
                            </div>

                            {/* Sources & Candidate Values */}
                            <div className="text-[11px] text-slate-500 space-y-0.5">
                              <div>
                                Konteks: <span className="font-mono text-slate-700">{param.sources[0]?.label}</span>{' '}
                                ({param.sources[0]?.context})
                              </div>
                              {param.candidateValues.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span>Nilai/opsi ditemukan:</span>
                                  {param.candidateValues.map((cv) => (
                                    <button
                                      key={cv}
                                      type="button"
                                      onClick={() =>
                                        setDetectedParamDrafts((prev) => ({
                                          ...prev,
                                          [param.name]: cv,
                                        }))
                                      }
                                      className={`px-1.5 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                                        draftVal === cv
                                          ? 'bg-teal-600 text-white border-teal-600'
                                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-teal-400'
                                      }`}
                                    >
                                      {cv}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Action buttons per parameter */}
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  copyText(exampleUrlWithVal, `copy-url-${param.id}`, `URL uji ${param.name}`)
                                }
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded cursor-pointer"
                              >
                                {copiedId === `copy-url-${param.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>Copy URL Uji</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  copyText(snippetWithVal, `copy-js-${param.id}`, `Snippet JS ${param.name}`)
                                }
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded cursor-pointer"
                              >
                                {copiedId === `copy-js-${param.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>Copy Snippet Console JS</span>
                              </button>
                              {onApplyPreviewQueryParams && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onApplyPreviewQueryParams(
                                      { ...previewQueryParams, [param.name]: draftVal },
                                      true
                                    )
                                  }
                                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded cursor-pointer"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>Terapkan ke Preview</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleSimulateQueryToConsole(
                                    `?${encodeURIComponent(param.name)}=${encodeURIComponent(draftVal)}`
                                  )
                                }
                                className="px-2 py-1 text-[11px] font-medium bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded cursor-pointer"
                              >
                                Uji di Konsol
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setQueryParamRows((prev) => {
                                    const exists = prev.some((r) => r.key.trim() === param.name);
                                    if (exists) {
                                      return prev.map((r) =>
                                        r.key.trim() === param.name
                                          ? { ...r, enabled: true, value: draftVal }
                                          : r
                                      );
                                    }
                                    return [
                                      ...prev,
                                      {
                                        id: `qp-add-${Date.now()}-${param.name}`,
                                        enabled: true,
                                        key: param.name,
                                        value: draftVal,
                                      },
                                    ];
                                  });
                                  onNotify?.(`Parameter "${param.name}" dimuat ke Builder Gabungan.`, 'info');
                                }}
                                className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer"
                              >
                                + Builder
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Manual Verification Notices (dynamic variable parameter names / generic parsers) */}
                  {dynamicQueryScan.manualCheckNotices.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>
                          Pola Parameter Dinamis yang Perlu Dicek Manual ({dynamicQueryScan.manualCheckNotices.length})
                        </span>
                      </div>
                      <div className="space-y-1">
                        {dynamicQueryScan.manualCheckNotices.map((notice: DynamicQueryManualNotice) => (
                          <div
                            key={notice.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900 bg-white/80 border border-amber-200 rounded px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <div>{notice.reason}</div>
                              <div className="font-mono text-[10px] text-amber-800 truncate">
                                {notice.snippet}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onJumpToEditorLine(notice.line)}
                              className="px-2 py-0.5 text-[10px] font-mono bg-amber-100 hover:bg-amber-200 text-amber-950 rounded cursor-pointer shrink-0"
                            >
                              Baris {notice.line} &rarr;
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* SECTION 2: Interactive Multi-Param Query Builder & Live Request Tester */}
                <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-xs font-bold text-slate-900">
                        Builder &amp; Penguji Query Gabungan (Offline Preview / Live HTTP GET)
                      </h2>
                      <p className="text-[11px] text-slate-600">
                        Gabungkan beberapa parameter (atau tambahkan parameter kustom), salin versi URL / XML (<span className="font-mono">&amp;amp;</span>), lalu terapkan ke Pratinjau atau uji ke server.
                      </p>
                    </div>
                  </div>

                  {/* Dynamically detected base paths from XML (only shown if detected) */}
                  {dynamicQueryScan.detectedBasePaths.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-500 mr-1">
                        Path Terdeteksi di XML:
                      </span>
                      {dynamicQueryScan.detectedBasePaths.slice(0, 6).map((bp) => (
                        <button
                          key={bp}
                          type="button"
                          onClick={() => setQueryBaseInput(bp)}
                          className="px-2 py-0.5 text-[11px] font-mono bg-white hover:bg-blue-50 text-slate-800 border border-slate-200 rounded cursor-pointer truncate max-w-[200px]"
                        >
                          {bp}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Base Path / Domain */}
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Path / Base URL Tujuan (kosongkan untuk memakai URL Blogspot tersinkron)
                    </label>
                    <input
                      type="text"
                      value={queryBaseInput}
                      onChange={(e) => setQueryBaseInput(e.target.value)}
                      placeholder={
                        sharedBlogUrl.trim()
                          ? `Contoh: /search atau kosongkan (${sharedBlogUrl.trim()})`
                          : 'Contoh: /search atau https://bloganda.blogspot.com'
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  {/* Dynamic Key=Value Parameter Rows */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Daftar Parameter Uji Gabungan ({builtQueryState.enabledCount} aktif)
                      </span>
                      <div className="flex items-center gap-1.5">
                        {dynamicQueryScan.parameters.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setQueryParamRows(
                                dynamicQueryScan.parameters.map((p, idx) => ({
                                  id: `qp-reload-${Date.now()}-${idx}`,
                                  enabled: true,
                                  key: p.name,
                                  value: detectedParamDrafts[p.name] ?? p.suggestedValue,
                                }))
                              )
                            }
                            className="px-2 py-1 text-[11px] font-medium bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded cursor-pointer"
                          >
                            Muat dari Deteksi XML ({dynamicQueryScan.parameters.length})
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setQueryParamRows((prev) => [
                              ...prev,
                              {
                                id: `qp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                enabled: true,
                                key: '',
                                value: '',
                              },
                            ])
                          }
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Tambah Parameter</span>
                        </button>
                      </div>
                    </div>

                    {queryParamRows.length === 0 ? (
                      <div className="p-3 text-center text-[11px] text-slate-500 bg-white border border-dashed border-slate-200 rounded-lg">
                        Belum ada parameter di builder gabungan. Klik <strong>+ Tambah Parameter</strong> untuk menambah parameter uji kustom.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {queryParamRows.map((row) => {
                          const matchedDyn = dynamicQueryScan.parameters.find(
                            (p) => p.name === row.key.trim()
                          );
                          return (
                            <div
                              key={row.id}
                              className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 bg-white p-1.5 rounded-lg border border-slate-200"
                            >
                              <input
                                type="checkbox"
                                checked={row.enabled}
                                onChange={(e) =>
                                  setQueryParamRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, enabled: e.target.checked } : r
                                    )
                                  )
                                }
                                title="Aktifkan parameter ini"
                                className="w-3.5 h-3.5 ml-1 accent-blue-600 cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={row.key}
                                onChange={(e) =>
                                  setQueryParamRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, key: e.target.value } : r
                                    )
                                  )
                                }
                                placeholder="Nama parameter"
                                className="w-32 sm:w-36 px-2 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-blue-600"
                              />
                              <span className="text-xs font-mono text-slate-400">=</span>
                              {matchedDyn && matchedDyn.candidateValues.length > 0 && (
                                <select
                                  aria-label={`Pilih opsi untuk ${row.key}`}
                                  value={
                                    matchedDyn.candidateValues.includes(row.value)
                                      ? row.value
                                      : '__custom__'
                                  }
                                  onChange={(e) => {
                                    if (e.target.value !== '__custom__') {
                                      const v = e.target.value;
                                      setQueryParamRows((prev) =>
                                        prev.map((r) => (r.id === row.id ? { ...r, value: v } : r))
                                      );
                                    }
                                  }}
                                  className="max-w-[115px] px-1.5 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer"
                                >
                                  {matchedDyn.candidateValues.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                  {!matchedDyn.candidateValues.includes(row.value) && (
                                    <option value="__custom__">(Kustom)</option>
                                  )}
                                </select>
                              )}
                              <input
                                type="text"
                                value={row.value}
                                onChange={(e) =>
                                  setQueryParamRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, value: e.target.value } : r
                                    )
                                  )
                                }
                                placeholder="Nilai parameter"
                                className="flex-1 min-w-[110px] px-2 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-blue-600"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setQueryParamRows((prev) => prev.filter((r) => r.id !== row.id))
                                }
                                className="p-1 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                                title="Hapus baris parameter"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Generated Outputs (Copyable) */}
                  <div className="space-y-1.5 bg-white border border-slate-200 rounded-lg p-2.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-600">Hasil URL Lengkap:</span>
                      <button
                        type="button"
                        onClick={() => copyText(builtQueryState.fullUrl, 'qp-full-url', 'URL Uji')}
                        className="text-blue-700 hover:underline font-medium cursor-pointer shrink-0"
                      >
                        {copiedId === 'qp-full-url' ? 'Tersalin!' : 'Copy URL Uji'}
                      </button>
                    </div>
                    <div className="font-mono text-slate-900 bg-slate-50 px-2 py-1 rounded border border-slate-100 break-all select-all">
                      {builtQueryState.fullUrl}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-600">Query String Mentah:</span>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(builtQueryState.rawQuery || '?', 'qp-raw', 'Query String')
                            }
                            className="text-blue-700 hover:underline cursor-pointer"
                          >
                            {copiedId === 'qp-raw' ? 'Tersalin!' : 'Salin'}
                          </button>
                        </div>
                        <div className="font-mono text-slate-800 bg-slate-50 px-2 py-1 rounded border border-slate-100 break-all select-all">
                          {builtQueryState.rawQuery || '(kosong)'}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-600">Versi Atribut XML (&amp;amp;):</span>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(
                                builtQueryState.xmlSafeQuery || '?',
                                'qp-xml',
                                'Query String XML Aman'
                              )
                            }
                            className="text-blue-700 hover:underline cursor-pointer"
                          >
                            {copiedId === 'qp-xml' ? 'Tersalin!' : 'Salin'}
                          </button>
                        </div>
                        <div className="font-mono text-emerald-800 bg-emerald-50/50 px-2 py-1 rounded border border-emerald-100 break-all select-all">
                          {builtQueryState.xmlSafeQuery || '(kosong)'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Run / Apply / Copy Buttons */}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {onApplyPreviewQueryParams && (
                      <button
                        type="button"
                        onClick={() => onApplyPreviewQueryParams(builtQueryState.paramMap, true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Terapkan ke Preview</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSimulateQueryToConsole()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Uji di Konsol (Offline)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTestLiveQueryUrl()}
                      disabled={isTestingLiveQuery}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg cursor-pointer"
                    >
                      {isTestingLiveQuery ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Network className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isTestingLiveQuery ? 'Menguji Request...' : 'Uji Request Live (HTTP GET)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          builtQueryState.jsSearchParamsSnippet,
                          'qp-js-snippet',
                          'Snippet Console JS'
                        )
                      }
                      className="px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      {copiedId === 'qp-js-snippet' ? 'JS Tersalin!' : 'Copy Snippet Console JS'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Full External & Obfuscated URL Assets */}
            {leftTab === 'resources' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        ['all', 'Semua'],
                        ['css', '.CSS'],
                        ['js', '.JS / .JSS'],
                        ['obfuscated', 'Tersembunyi'],
                        ['insecure', 'HTTP'],
                      ] as Array<[ResourceFilter, string]>
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setResourceFilter(id)}
                        className={`px-2 py-1 text-[11px] font-medium rounded border cursor-pointer ${
                          resourceFilter === id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="relative w-full sm:w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={resourceSearch}
                      onChange={(e) => setResourceSearch(e.target.value)}
                      placeholder="Cari URL / domain..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {liveHtmlExternalUrls.length > 0 && (
                  <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-200 space-y-2">
                    <div className="text-xs font-semibold text-blue-950">
                      Aset Eksternal dari URL Blogspot Live ({liveHtmlExternalUrls.length})
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {liveHtmlExternalUrls.map((item, idx) => (
                        <div
                          key={`${item.url}-${idx}`}
                          className="flex items-center justify-between gap-2 text-[11px] font-mono bg-white border border-blue-100 rounded px-2 py-1"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="uppercase font-bold text-blue-700 shrink-0">
                              {item.kind}
                            </span>
                            <span className="truncate text-slate-700">{item.url}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => pasteIntoConsolePrompt(`check ${item.url}`)}
                              className="text-slate-600 hover:underline cursor-pointer"
                            >
                              Tempel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunConsoleCommand(`check ${item.url}`)}
                              className="text-blue-700 hover:underline cursor-pointer"
                            >
                              Uji
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredAssets.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg text-xs text-slate-500">
                    Tidak ada URL aset yang cocok dengan filter saat ini pada XML aktif.
                  </div>
                ) : (
                  <div className="space-y-2">{filteredAssets.map(renderAssetRow)}</div>
                )}
              </div>
            )}

            {/* TAB 3: Blogspot vs XML Match */}
            {leftTab === 'match' && (
              <div className="space-y-3">
                {comparisonResult ? (
                  <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          {comparisonResult.headline}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">{comparisonResult.summary}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                          {comparisonResult.similarityPercent}%
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          CSS: {comparisonResult.cssMatchPercent}%
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[11px] text-slate-500">Widget Cocok</div>
                        <div className="font-mono font-bold tabular-nums text-slate-900">
                          {comparisonResult.matchedWidgets.length} cocok /{' '}
                          {comparisonResult.onlyInLiveWidgets.length} hanya live
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[11px] text-slate-500">Section Cocok</div>
                        <div className="font-mono font-bold tabular-nums text-slate-900">
                          {comparisonResult.matchedSections.length} cocok /{' '}
                          {comparisonResult.onlyInXmlSections.length} hanya XML
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[11px] text-slate-500">Font &amp; CSS Vars</div>
                        <div className="font-mono font-bold tabular-nums text-slate-900">
                          {comparisonResult.matchedFonts.length} font ·{' '}
                          {comparisonResult.matchedCssVars.length} vars
                        </div>
                      </div>
                    </div>

                    {comparisonResult.mismatchReasons.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                        <div className="text-xs font-semibold text-amber-950">
                          Catatan Perbedaan Terdeteksi:
                        </div>
                        <ul className="list-disc pl-4 text-xs text-amber-900 space-y-0.5">
                          {comparisonResult.mismatchReasons.map((reason, idx) => (
                            <li key={idx}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 text-center space-y-2.5">
                    <Globe className="w-6 h-6 text-slate-400 mx-auto" />
                    <div className="text-xs font-semibold text-slate-800">
                      Belum ada hasil perbandingan Blogspot live vs XML aktif
                    </div>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      Isi kolom URL Blogspot di bagian atas (atau melalui "Cek Kecocokan URL Blogspot..." di panel kiri), lalu tekan <strong>Cek &amp; Muat ke Konsol</strong>.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Live DOM Selector Tester */}
            {leftTab === 'selector' && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Uji Selector CSS / Elemen DOM (Seperti Elements Panel DevTools)
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Target: {userBlogVisualHtml ? 'HTML Live URL' : 'Struktur Markup XML Aktif'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={selectorInput}
                      onChange={(e) => setSelectorInput(e.target.value)}
                      placeholder="Contoh: .post-title, #Blog1, header a, script[src]"
                      className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => handleRunConsoleCommand(`selector ${selectorInput}`)}
                      className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer shrink-0"
                    >
                      Catat ke Konsol
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {(capturedSelectors.length > 0
                      ? capturedSelectors.slice(0, 8).map((s) => s.selector)
                      : ['.widget', '#Blog1', 'header', 'h1, h2', 'a[href]', 'img']
                    ).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setSelectorInput(preset)}
                        className="px-2 py-0.5 font-mono bg-white border border-slate-200 hover:border-blue-400 rounded text-slate-700 cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {selectorEvalResult.error ? (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                    Selector tidak valid: {selectorEvalResult.error}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-700">
                      Ditemukan <span className="font-mono tabular-nums">{selectorEvalResult.count}</span> elemen cocok:
                    </div>
                    {selectorEvalResult.items.length === 0 ? (
                      <div className="p-4 text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg text-center">
                        Tidak ada elemen cocok untuk selector tersebut.
                      </div>
                    ) : (
                      selectorEvalResult.items.map((el, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 bg-white border border-slate-200 rounded-lg flex items-start justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-mono text-slate-900 font-semibold break-all">
                              &lt;{el.tagName}
                              {el.idAttr ? ` id="${el.idAttr}"` : ''}
                              {el.classAttr ? ` class="${el.classAttr}"` : ''}&gt;
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">{el.textPreview}</div>
                          </div>
                          {el.xmlLine && (
                            <button
                              type="button"
                              onClick={() => onJumpToEditorLine(el.xmlLine)}
                              className="px-2 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 rounded shrink-0 cursor-pointer"
                            >
                              Baris {el.xmlLine} &rarr;
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN (5 cols): Interactive Browser DevTools Console & Paste/Run Column */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col min-h-[460px] xl:min-h-0 overflow-hidden">
          <div className="px-3 sm:px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Code2 className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-bold text-slate-900">Kolom Konsol Pengembang</span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                ({mergedConsoleLogs.length})
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyAllLogs}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded cursor-pointer"
              >
                {copiedId === 'copy-all-console' ? (
                  <Check className="w-3 h-3 text-emerald-600" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>Salin Log</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserConsoleEntries([]);
                  onClearPreviewLogs();
                }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 rounded cursor-pointer"
                title="Bersihkan log konsol"
              >
                <Eraser className="w-3 h-3" />
                <span>Bersihkan</span>
              </button>
            </div>
          </div>

          <div className="px-3 py-1.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(
                [
                  ['all', 'Semua'],
                  ['error', 'Error'],
                  ['warn', 'Warn'],
                  ['info', 'Info / Log'],
                  ['network', 'Network / URL'],
                ] as Array<[ConsoleFilter, string]>
              ).map(([lv, label]) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setConsoleFilter(lv)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded whitespace-nowrap cursor-pointer ${
                    consoleFilter === lv
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-44">
              <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={consoleLogSearch}
                onChange={(e) => setConsoleLogSearch(e.target.value)}
                placeholder="Cari log konsol..."
                className="w-full pl-6 pr-6 py-1 text-[11px] bg-slate-50 focus:bg-white border border-slate-200 rounded text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
              {consoleLogSearch && (
                <button
                  type="button"
                  onClick={() => setConsoleLogSearch('')}
                  title="Bersihkan pencarian log"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Dark Console Log Output Feed */}
          <div className="flex-1 min-h-[200px] overflow-y-auto bg-[#0F172A] text-slate-100 p-3 space-y-2 font-mono text-xs">
            {mergedConsoleLogs.length === 0 ? (
              <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center text-slate-400 space-y-1.5 px-4">
                <Terminal className="w-5 h-5 opacity-70" />
                <p>Belum ada log konsol pada filter ini.</p>
                <p className="text-[11px] text-slate-500">
                  Klik "Tempel" atau "Uji" pada item di kolom kiri, atau tempel kode JavaScript / URL di bawah.
                </p>
              </div>
            ) : (
              mergedConsoleLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold uppercase border rounded ${levelBadgeClass(
                          entry.level
                        )}`}
                      >
                        {entry.level}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        [{entry.source === 'preview' ? 'Pratinjau' : entry.source === 'url' ? 'URL' : entry.source === 'xml' ? 'XML' : 'Konsol'}]
                      </span>
                      <span className="text-[10px] text-slate-500 tabular-nums">
                        {entry.timestamp}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {entry.url && (
                        <button
                          type="button"
                          onClick={() => {
                            onSharedBlogUrlChange(entry.url || '');
                            onNotify?.('URL diterapkan ke kolom URL utama.', 'info');
                          }}
                          className="text-[10px] text-cyan-300 hover:underline cursor-pointer"
                        >
                          Pakai ke URL Blogspot
                        </button>
                      )}
                      {typeof entry.line === 'number' && entry.line > 0 && (
                        <button
                          type="button"
                          onClick={() => onJumpToEditorLine(entry.line)}
                          className="px-1.5 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-blue-300 rounded cursor-pointer"
                        >
                          Baris {entry.line} &rarr;
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
                    {entry.title}
                  </div>

                  {entry.url && (
                    <div className="text-[11px] text-cyan-300 break-all">{entry.url}</div>
                  )}

                  {entry.detail && (
                    <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-words bg-slate-950/70 border border-slate-800 rounded p-2 overflow-x-auto select-all">
                      {entry.detail}
                    </pre>
                  )}

                  {entry.codeSnippet && (
                    <pre className="text-[11px] text-emerald-300 whitespace-pre-wrap break-all bg-slate-950 border border-slate-800 rounded p-2 max-h-40 overflow-y-auto select-all">
                      {entry.codeSnippet}
                    </pre>
                  )}
                </div>
              ))
            )}
            <div ref={consoleFeedEndRef} />
          </div>

          {/* Interactive Secondary Console Prompt Box */}
          <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-2 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-[11px] font-semibold text-slate-700">
                Masukkan / Tempel Konsol (Query String/Param, JS, URL, Error):
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handlePasteFromClipboard()}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded cursor-pointer"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>Tempel Clipboard</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRunConsoleCommand('help')}
                  className="flex items-center gap-1 text-[11px] text-blue-700 hover:underline cursor-pointer"
                >
                  <HelpCircle className="w-3 h-3" />
                  <span>Bantuan</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {dynamicQuickChips.map((btn) => (
                <button
                  key={btn.cmd}
                  type="button"
                  onClick={() => handleRunConsoleCommand(btn.cmd)}
                  className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-800 border border-slate-200 rounded cursor-pointer truncate max-w-[175px]"
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <textarea
                ref={consoleTextareaRef}
                rows={3}
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleRunConsoleCommand();
                  }
                }}
                placeholder="Tempel Query String (?param=nilai), JS, URL, atau perintah (query ..., test-query https://..., js, urls, selector .widget)..."
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-y"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                  <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded font-mono">Enter</kbd> jalankan ·{' '}
                  <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded font-mono">Shift+Enter</kbd> baris baru
                </span>
                <button
                  type="button"
                  onClick={() => handleRunConsoleCommand()}
                  disabled={!consoleInput.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg cursor-pointer"
                >
                  <Play className="w-3 h-3" />
                  <span>Jalankan ke Konsol</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
