import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileWarning,
  FolderTree,
  Globe,
  Hash,
  History,
  Loader2,
  Lock,
  Minimize2,
  Moon,
  Play,
  RotateCcw,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
  Sun,
  Unlock,
  Wrench,
  X,
} from 'lucide-react';
import type { ParsedTemplateInfo } from '../types/blogger';
import {
  canShareXmlFile,
  downloadXmlFile,
  shareXmlFileViaNavigator,
  updateSnippetInXml,
  updateWidgetAttrInXml,
} from '../lib/bloggerCompiler';
import {
  detectConsoleTestableTargetsInXml,
  detectObfuscatedAndExternalUrlsInXml,
  scanDynamicQueryParametersInXml,
} from '../lib/scriptAndCodeInspector';
import {
  escapeHtmlEntities,
  formatBloggerXmlOffline,
  unescapeHtmlEntities,
  unwrapCdata,
  validateBloggerXmlOffline,
  wrapWithCdata,
  type CdataStyle,
  type XmlSyntaxIssue,
  type XmlValidationResult,
} from '../lib/xmlOfflineTools';
import {
  LARGE_FILE_VALIDATION_THRESHOLD_BYTES,
  runAnalyzeDeadCodeWorker,
  runCleanDeadCodeWorker,
  runIterativeAutoFixWorker,
  type AutoDetectedSafelistPrefix,
  type DeadCleanOptions,
  type DeadCodeCleanResult,
  type IterativeAutoFixResult,
  type WorkerProgressInfo,
} from '../lib/xmlWorkerEngine';
import {
  BLOGGER_SNIPPET_PRESETS,
  buildFoldedEditorView,
  cleanAllSvgsInXml,
  minifyCssInXmlOffline,
  minifyJsInXmlOffline,
  parseBloggerLayoutTree,
  unfoldEditorText,
} from '../lib/xmlFeatureTools';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';
import { SafelistPrefixManager, normalizeSafelistInput } from './SafelistPrefixManager';
import { TemplateIdentityModal } from './TemplateIdentityModal';
import { DiffViewerPanel } from './DiffViewerPanel';
import { HtmlJsCssViewerPanel } from './HtmlJsCssViewerPanel';

interface XmlEditorViewProps {
  xml: string;
  customCss: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  focusLine?: number | null;
  onApplyXml: (nextXml: string) => void;
  onSaveOverwriteAndDownload?: (editedXml: string) => void;
  onCustomCssChange: (css: string) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendToUrlConsole?: (payload: {
    payload: string;
    kind: 'query-string' | 'url-string' | 'javascript';
    runNow?: boolean;
  }) => void;
  onOpenSnapshots?: () => void;
  snapshotCount?: number;
  previewQueryParams?: Record<string, string>;
  onApplyPreviewQueryParams?: (nextParams: Record<string, string>, openPreview?: boolean) => void;
  onResetPreviewQueryParams?: () => void;
}

type EditorTheme = 'light' | 'dark';

const ROW_HEIGHT_PX = 22;

export interface CodeSearchMatch {
  start: number;
  end: number;
  line: number;
  colStart: number;
  colEnd: number;
}

function renderHighlightedLineSegments(
  lineText: string,
  lineIssues: XmlSyntaxIssue[],
  isDark: boolean,
  lineNum?: number,
  searchQuery?: string,
  searchCaseSensitive?: boolean,
  activeMatch?: CodeSearchMatch | null
): React.ReactNode {
  if (!lineText) return '\u00A0';
  if (lineText.length > 12000) return lineText;

  type RangeKind = 'active-match' | 'error' | 'warning' | 'match';
  const candidates: Array<{ start: number; end: number; kind: RangeKind }> = [];

  if (searchQuery && searchQuery.length > 0) {
    const haystack = searchCaseSensitive ? lineText : lineText.toLowerCase();
    const needle = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < haystack.length) {
      const foundIdx = haystack.indexOf(needle, searchFrom);
      if (foundIdx === -1) break;
      const foundEnd = foundIdx + needle.length;
      const isCurrentActive =
        activeMatch &&
        activeMatch.line === lineNum &&
        activeMatch.colStart === foundIdx &&
        activeMatch.colEnd === foundEnd;
      candidates.push({
        start: foundIdx,
        end: foundEnd,
        kind: isCurrentActive ? 'active-match' : 'match',
      });
      searchFrom = foundIdx + Math.max(1, needle.length);
    }
  }

  const snippets = lineIssues
    .map((iss) => ({
      snippet: iss.snippet?.trim() || '',
      severity: iss.severity,
    }))
    .filter((s) => s.snippet.length > 0);

  for (const item of snippets) {
    let searchFrom = 0;
    while (searchFrom < lineText.length) {
      const foundIdx = lineText.indexOf(item.snippet, searchFrom);
      if (foundIdx === -1) break;
      const foundEnd = foundIdx + item.snippet.length;
      candidates.push({ start: foundIdx, end: foundEnd, kind: item.severity });
      searchFrom = foundEnd;
    }
  }

  if (candidates.length === 0) {
    return lineText;
  }

  const priority: Record<RangeKind, number> = {
    'active-match': 4,
    error: 3,
    warning: 2,
    match: 1,
  };

  candidates.sort((a, b) => priority[b.kind] - priority[a.kind] || a.start - b.start);

  const ranges: Array<{ start: number; end: number; kind: RangeKind }> = [];
  for (const c of candidates) {
    const overlaps = ranges.some((r) => !(c.end <= r.start || c.start >= r.end));
    if (!overlaps) {
      ranges.push(c);
    }
  }

  ranges.sort((a, b) => a.start - b.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, idx) => {
    if (r.start > cursor) {
      nodes.push(lineText.slice(cursor, r.start));
    }
    const token = lineText.slice(r.start, r.end);
    let markClass = '';
    if (r.kind === 'active-match') {
      markClass = isDark
        ? 'bg-blue-500/45 ring-1 ring-blue-400 rounded-[2px] text-transparent'
        : 'bg-blue-500/30 ring-1 ring-blue-600 rounded-[2px] text-transparent';
    } else if (r.kind === 'match') {
      markClass = isDark
        ? 'bg-amber-400/25 rounded-[2px] text-transparent'
        : 'bg-amber-300/45 rounded-[2px] text-transparent';
    } else if (r.kind === 'error') {
      markClass = isDark
        ? 'bg-red-500/35 border-b-2 border-red-400 rounded-[2px] text-transparent'
        : 'bg-red-500/20 border-b-2 border-red-600 rounded-[2px] text-transparent';
    } else {
      markClass = isDark
        ? 'bg-amber-500/30 border-b-2 border-amber-400 rounded-[2px] text-transparent'
        : 'bg-amber-400/25 border-b-2 border-amber-600 rounded-[2px] text-transparent';
    }

    nodes.push(
      <mark key={`${idx}-${r.start}`} className={markClass}>
        {token}
      </mark>
    );
    cursor = r.end;
  });

  if (cursor < lineText.length) {
    nodes.push(lineText.slice(cursor));
  }

  return nodes;
}

interface NumberedCodeEditorProps {
  value: string;
  onChange: (val: string) => void;
  editorTheme: EditorTheme;
  issues?: XmlSyntaxIssue[];
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  ariaLabel: string;
  placeholder?: string;
  activeLine: number;
  activeCol: number;
  onCursorUpdate: (line: number, col: number) => void;
  searchQuery?: string;
  searchCaseSensitive?: boolean;
  activeMatch?: CodeSearchMatch | null;
}

const EDITOR_OVERSCAN_LINES = 24;

function buildEditorLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function sliceEditorLine(text: string, lineStarts: number[], lineIdx: number): string {
  const start = lineStarts[lineIdx] ?? 0;
  const rawEnd = lineIdx + 1 < lineStarts.length ? lineStarts[lineIdx + 1] - 1 : text.length;
  const cleanEnd = rawEnd > start && text.charCodeAt(rawEnd - 1) === 13 ? rawEnd - 1 : rawEnd;
  return text.slice(start, cleanEnd);
}

function getLineColAtOffsetFast(text: string, offset: number): { line: number; col: number } {
  const safeOffset = Math.min(Math.max(0, offset), text.length);
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < safeOffset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, col: lastNl === -1 ? safeOffset + 1 : safeOffset - lastNl };
}

function getLineRangeAtNumberFast(text: string, targetLine: number): { start: number; end: number; lineText: string } {
  const wanted = Math.max(1, targetLine);
  let line = 1;
  let start = 0;
  const len = text.length;
  for (let i = 0; i <= len; i++) {
    if (i === len || text.charCodeAt(i) === 10) {
      if (line === wanted || i === len) {
        return { start, end: i, lineText: text.slice(start, i) };
      }
      line++;
      start = i + 1;
    }
  }
  return { start: 0, end: 0, lineText: '' };
}

const NumberedCodeEditor: React.FC<NumberedCodeEditorProps> = React.memo(({
  value,
  onChange,
  editorTheme,
  issues = [],
  textareaRef: externalRef,
  ariaLabel,
  placeholder,
  activeLine,
  activeCol,
  onCursorUpdate,
  searchQuery,
  searchCaseSensitive,
  activeMatch,
}) => {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const resolvedRef = externalRef ?? internalRef;
  const gutterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const backdropInnerRef = useRef<HTMLDivElement>(null);
  const editorViewportRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  const isDark = editorTheme === 'dark';

  const lineStarts = useMemo(() => buildEditorLineStarts(value), [value]);
  const totalLines = lineStarts.length;

  const [viewportHeight, setViewportHeight] = useState(440);
  const [visibleWindow, setVisibleWindow] = useState<{ start: number; end: number }>({
    start: 0,
    end: 60,
  });

  useEffect(() => {
    const el = editorViewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => {
      const nextH = el.clientHeight || 440;
      setViewportHeight((prev) => (Math.abs(prev - nextH) > 4 ? nextH : prev));
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateVisibleWindowFromScroll = useCallback(
    (scrollTopPx: number, force = false) => {
      const visibleCount = Math.max(12, Math.ceil(viewportHeight / ROW_HEIGHT_PX) + 2);
      const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTopPx - 12) / ROW_HEIGHT_PX));
      const lastVisible = Math.min(totalLines - 1, firstVisible + visibleCount);

      setVisibleWindow((prev) => {
        const clampedPrevEnd = Math.min(prev.end, totalLines - 1);
        const clampedPrevStart = Math.min(prev.start, clampedPrevEnd);
        const insideBuffer =
          !force &&
          firstVisible >= clampedPrevStart + 6 &&
          lastVisible <= clampedPrevEnd - 6 &&
          prev.end <= totalLines - 1;
        if (insideBuffer) return prev;

        const nextStart = Math.max(0, firstVisible - EDITOR_OVERSCAN_LINES);
        const nextEnd = Math.min(totalLines - 1, lastVisible + EDITOR_OVERSCAN_LINES);
        if (nextStart === prev.start && nextEnd === prev.end) return prev;
        return { start: nextStart, end: nextEnd };
      });
    },
    [totalLines, viewportHeight]
  );

  useEffect(() => {
    const ta = resolvedRef.current;
    updateVisibleWindowFromScroll(ta ? ta.scrollTop : 0, true);
  }, [resolvedRef, totalLines, viewportHeight, updateVisibleWindowFromScroll]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const issuesByLine = useMemo(() => {
    const map = new Map<number, XmlSyntaxIssue[]>();
    for (const iss of issues) {
      const arr = map.get(iss.line) || [];
      arr.push(iss);
      map.set(iss.line, arr);
    }
    return map;
  }, [issues]);

  const syncScroll = useCallback(() => {
    const ta = resolvedRef.current;
    if (!ta) return;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
    if (backdropInnerRef.current) {
      backdropInnerRef.current.style.minWidth = `${ta.scrollWidth}px`;
    }
    if (backdropRef.current) {
      backdropRef.current.scrollTop = ta.scrollTop;
      backdropRef.current.scrollLeft = ta.scrollLeft;
    }
    if (scrollRafRef.current === null) {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const currTa = resolvedRef.current;
        if (currTa) {
          updateVisibleWindowFromScroll(currTa.scrollTop, false);
        }
      });
    }
  }, [resolvedRef, updateVisibleWindowFromScroll]);

  useEffect(() => {
    syncScroll();
  }, [activeLine, activeCol, activeMatch, syncScroll]);

  const handleCursorEvent = useCallback(() => {
    const ta = resolvedRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? 0;
    const { line, col } = getLineColAtOffsetFast(ta.value, pos);
    onCursorUpdate(line, col);
    syncScroll();
  }, [onCursorUpdate, resolvedRef, syncScroll]);

  const jumpToLineFromGutter = useCallback(
    (targetLine: number) => {
      const ta = resolvedRef.current;
      if (!ta) return;
      const { start, end } = getLineRangeAtNumberFast(ta.value, targetLine);
      ta.focus();
      ta.setSelectionRange(start, end);
      onCursorUpdate(targetLine, 1);
    },
    [onCursorUpdate, resolvedRef]
  );

  const gutterDigits = Math.max(3, String(totalLines).length);
  const gutterWidthPx = gutterDigits * 9 + 26;

  const activeLineIssues = issuesByLine.get(activeLine) || [];
  const renderStart = Math.max(0, Math.min(visibleWindow.start, totalLines - 1));
  const renderEnd = Math.max(renderStart, Math.min(visibleWindow.end, totalLines - 1));
  const totalCanvasHeightPx = totalLines * ROW_HEIGHT_PX + 52;
  const visibleSliceCount = renderEnd >= renderStart ? renderEnd - renderStart + 1 : 0;

  return (
    <div
      className={`flex-1 min-h-[46dvh] md:min-h-[340px] flex flex-col border rounded-lg overflow-hidden transition-colors ${
        isDark ? 'bg-[#0F172A] border-slate-700' : 'bg-white border-slate-200'
      }`}
    >
      <div ref={editorViewportRef} className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Left Synchronized Virtualized Line Number Gutter */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          style={{ width: `${gutterWidthPx}px` }}
          className={`shrink-0 overflow-hidden select-none border-r font-mono text-[11px] tabular-nums ${
            isDark
              ? 'bg-[#0B1120] border-slate-800 text-slate-500'
              : 'bg-slate-50 border-slate-200 text-slate-400'
          }`}
        >
          <div className="relative" style={{ height: `${totalCanvasHeightPx}px` }}>
            <div
              style={{
                paddingTop: '12px',
                transform: `translateY(${renderStart * ROW_HEIGHT_PX}px)`,
              }}
            >
              {Array.from({ length: visibleSliceCount }, (_, offset) => {
                const lineNum = renderStart + offset + 1;
                const lineIss = issuesByLine.get(lineNum);
                const hasErr = lineIss?.some((i) => i.severity === 'error');
                const hasWarn = !hasErr && lineIss && lineIss.length > 0;
                const isActive = activeLine === lineNum;

                return (
                  <button
                    key={lineNum}
                    type="button"
                    onClick={() => jumpToLineFromGutter(lineNum)}
                    title={
                      lineIss?.length
                        ? `Baris ${lineNum}: ${lineIss[0].message}`
                        : `Baris ${lineNum}`
                    }
                    style={{ height: `${ROW_HEIGHT_PX}px`, lineHeight: `${ROW_HEIGHT_PX}px` }}
                    className={`w-full px-2.5 flex items-center justify-end gap-1.5 text-right cursor-pointer transition-colors ${
                      hasErr
                        ? isDark
                          ? 'bg-red-500/20 text-red-400 font-semibold'
                          : 'bg-red-50 text-red-600 font-semibold'
                        : hasWarn
                          ? isDark
                            ? 'bg-amber-500/15 text-amber-400 font-semibold'
                            : 'bg-amber-50 text-amber-700 font-semibold'
                          : isActive
                            ? isDark
                              ? 'bg-slate-800/80 text-slate-200 font-semibold'
                              : 'bg-slate-200/60 text-slate-900 font-semibold'
                            : isDark
                              ? 'hover:bg-slate-800/40'
                              : 'hover:bg-slate-100'
                    }`}
                  >
                    {(hasErr || hasWarn) && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          hasErr ? 'bg-red-500' : 'bg-amber-500'
                        }`}
                      />
                    )}
                    <span>{lineNum}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Virtualized Highlight Backdrop + Textarea */}
        <div className="flex-1 min-w-0 relative overflow-hidden">
          <div
            ref={backdropRef}
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden pointer-events-none select-none"
          >
            <div
              ref={backdropInnerRef}
              className="relative font-mono text-xs min-w-max"
              style={{ height: `${totalCanvasHeightPx}px`, tabSize: 2 }}
            >
              <div
                style={{
                  paddingTop: '12px',
                  transform: `translateY(${renderStart * ROW_HEIGHT_PX}px)`,
                }}
              >
                {Array.from({ length: visibleSliceCount }, (_, offset) => {
                  const lineIdx = renderStart + offset;
                  const lineNum = lineIdx + 1;
                  const lineText = sliceEditorLine(value, lineStarts, lineIdx);
                  const lineIss = issuesByLine.get(lineNum) || [];
                  const hasErr = lineIss.some((i) => i.severity === 'error');
                  const hasWarn = !hasErr && lineIss.length > 0;
                  const isActive = activeLine === lineNum;

                  const rowBgClass = hasErr
                    ? isDark
                      ? 'bg-red-500/15'
                      : 'bg-red-50/90'
                    : hasWarn
                      ? isDark
                        ? 'bg-amber-500/12'
                        : 'bg-amber-50/80'
                      : isActive
                        ? isDark
                          ? 'bg-slate-800/50'
                          : 'bg-slate-100/75'
                        : '';

                  return (
                    <div
                      key={lineNum}
                      style={{ height: `${ROW_HEIGHT_PX}px`, lineHeight: `${ROW_HEIGHT_PX}px` }}
                      className={`px-4 whitespace-pre text-transparent ${rowBgClass}`}
                    >
                      {renderHighlightedLineSegments(
                        lineText,
                        lineIss,
                        isDark,
                        lineNum,
                        searchQuery,
                        searchCaseSensitive,
                        activeMatch
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <textarea
            ref={resolvedRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              handleCursorEvent();
            }}
            onScroll={syncScroll}
            onClick={handleCursorEvent}
            onKeyUp={handleCursorEvent}
            wrap="off"
            spellCheck={false}
            placeholder={placeholder}
            aria-label={ariaLabel}
            style={{ lineHeight: `${ROW_HEIGHT_PX}px`, tabSize: 2 }}
            className={`relative z-10 w-full h-full py-3 px-4 font-mono text-xs whitespace-pre overflow-auto bg-transparent resize-none focus:outline-none ${
              isDark
                ? 'text-slate-100 placeholder:text-slate-500 caret-blue-400 selection:bg-blue-500/35'
                : 'text-slate-900 placeholder:text-slate-400 caret-blue-600 selection:bg-blue-200/70'
            }`}
          />
        </div>
      </div>

      {/* Bottom Editor Status Bar */}
      <div
        className={`px-3.5 py-1.5 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums ${
          isDark
            ? 'bg-[#0B1120] border-slate-800 text-slate-400'
            : 'bg-slate-50 border-slate-200 text-slate-500'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="shrink-0">
            Baris {activeLine}, Kolom {activeCol}
          </span>
          {activeLineIssues.length > 0 && (
            <span
              className={`truncate font-sans font-medium ${
                activeLineIssues.some((i) => i.severity === 'error')
                  ? isDark
                    ? 'text-red-400'
                    : 'text-red-600'
                  : isDark
                    ? 'text-amber-400'
                    : 'text-amber-700'
              }`}
            >
              {activeLineIssues[0].message}
            </span>
          )}
        </div>
        <span className="shrink-0">
          Total {totalLines} baris &middot; {isDark ? 'Mode Gelap' : 'Mode Terang'}
        </span>
      </div>
    </div>
  );
});

export const XmlEditorView: React.FC<XmlEditorViewProps> = ({
  xml,
  customCss,
  parsedInfo,
  offlineAi,
  focusLine,
  onApplyXml,
  onSaveOverwriteAndDownload,
  onCustomCssChange,
  onNotify,
  onSendToUrlConsole,
  onOpenSnapshots,
  snapshotCount = 0,
  previewQueryParams = {},
  onApplyPreviewQueryParams,
  onResetPreviewQueryParams,
}) => {
  const [mode, setMode] = useState<'xml' | 'css' | 'html-js-css' | 'converter'>('xml');
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem('temaloka_editor_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  const [draftXml, setDraftXml] = useState(xml);
  const [copied, setCopied] = useState(false);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);

  // Tree Explorer, Code Folding, Snippet Injector & Side-by-Side Diff state
  const [showTreeExplorer, setShowTreeExplorer] = useState(false);
  const [showUrlInspectorPanel, setShowUrlInspectorPanel] = useState(false);
  const [urlInspectorFilter, setUrlInspectorFilter] = useState<
    'query-strings' | 'javascript' | 'url-strings' | 'all' | 'css' | 'obfuscated'
  >('query-strings');
  const [urlInspectorSearch, setUrlInspectorSearch] = useState('');
  const [foldedKeys, setFoldedKeys] = useState<Set<string>>(() => new Set());
  const [expandedTreeSections, setExpandedTreeSections] = useState<Record<string, boolean>>({});
  const [selectedSnippetId, setSelectedSnippetId] = useState<string>(BLOGGER_SNIPPET_PRESETS[0].id);
  const [lastEditorDiff, setLastEditorDiff] = useState<{
    before: string;
    after: string;
    title: string;
    subtitle?: string;
  } | null>(null);

  // Cursor line & column state
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);

  // Code Search & Jump-to-Line state
  const [codeSearchQuery, setCodeSearchQuery] = useState('');
  const [codeSearchCaseSensitive, setCodeSearchCaseSensitive] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [jumpLineInput, setJumpLineInput] = useState('');

  // Offline syntax diagnostics & Worker Cleaner state
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showCleanerPanel, setShowCleanerPanel] = useState(false);
  const [cleanOptions, setCleanOptions] = useState<DeadCleanOptions>({
    removeUnusedCssRules: true,
    removeUnusedCssVars: true,
    removeDeadJsFunctions: true,
    removeCssJsComments: true,
    removeDuplicateCssRules: true,
    removeDuplicateAssets: true,
  });
  const [workerProgress, setWorkerProgress] = useState<WorkerProgressInfo | null>(null);
  const workerCancelRef = useRef<(() => void) | null>(null);
  const safelistCancelRef = useRef<(() => void) | null>(null);
  const lastAutoSafelistXmlRef = useRef<string>('');
  const [activeSafelistChips, setActiveSafelistChips] = useState<AutoDetectedSafelistPrefix[]>([]);
  const [cssPrefixRuleCounts, setCssPrefixRuleCounts] = useState<Record<string, number>>({});
  const [isDetectingSafelist, setIsDetectingSafelist] = useState(false);
  const [lastCleanResult, setLastCleanResult] = useState<DeadCodeCleanResult | null>(null);
  const [lastAutoFixResult, setLastAutoFixResult] = useState<IterativeAutoFixResult | null>(null);
  const [lastFixesApplied, setLastFixesApplied] = useState<string[]>([]);

  // Offline Escape / Unescape / CDATA converter state
  const [snippetInput, setSnippetInput] = useState(
    `<div class="promo-banner">\n  <a href="https://contoh.blogspot.com/?utm_source=blog&utm_medium=banner">Kunjungi Toko & Lihat Promo</a>\n</div>`
  );
  const [snippetOutput, setSnippetOutput] = useState('');
  const [preserveEntities, setPreserveEntities] = useState(true);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const xmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const cssTextareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const isDark = editorTheme === 'dark';
  const canShareMobile = useMemo(() => canShareXmlFile(), []);

  const [debouncedDraftXml, setDebouncedDraftXml] = useState(xml);
  useEffect(() => {
    const delay = draftXml.length > LARGE_FILE_VALIDATION_THRESHOLD_BYTES ? 750 : 180;
    const timer = window.setTimeout(() => {
      setDebouncedDraftXml(draftXml);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [draftXml]);

  const layoutTree = useMemo(
    () =>
      mode === 'xml' && (showTreeExplorer || foldedKeys.size > 0)
        ? parseBloggerLayoutTree(debouncedDraftXml)
        : null,
    [debouncedDraftXml, foldedKeys.size, mode, showTreeExplorer]
  );

  const capturedExternalUrls = useMemo(
    () => detectObfuscatedAndExternalUrlsInXml(debouncedDraftXml),
    [debouncedDraftXml]
  );
  const consoleCaptureReport = useMemo(
    () => detectConsoleTestableTargetsInXml(debouncedDraftXml),
    [debouncedDraftXml]
  );
  const dynamicQueryScan = useMemo(
    () => scanDynamicQueryParametersInXml(debouncedDraftXml),
    [debouncedDraftXml]
  );
  const [editorParamDrafts, setEditorParamDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const p of dynamicQueryScan.parameters) {
      nextDrafts[p.name] =
        p.name in previewQueryParams ? previewQueryParams[p.name] : p.suggestedValue;
    }
    setEditorParamDrafts(nextDrafts);
  }, [dynamicQueryScan.parameters, previewQueryParams]);

  const obfuscatedUrlCount = useMemo(
    () => capturedExternalUrls.filter((u) => u.isObfuscated).length,
    [capturedExternalUrls]
  );
  const filteredCapturedUrls = useMemo(() => {
    const q = urlInspectorSearch.trim().toLowerCase();
    return capturedExternalUrls.filter((u) => {
      if (urlInspectorFilter === 'css' && u.kind !== 'css') return false;
      if (urlInspectorFilter === 'obfuscated' && !u.isObfuscated) return false;
      if (!q) return true;
      return (
        u.url.toLowerCase().includes(q) ||
        u.host.toLowerCase().includes(q) ||
        u.sourceContext.toLowerCase().includes(q) ||
        String(u.line).includes(q)
      );
    });
  }, [capturedExternalUrls, urlInspectorFilter, urlInspectorSearch]);

  const filteredDynamicQueries = useMemo(() => {
    const q = urlInspectorSearch.trim().toLowerCase();
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
  }, [dynamicQueryScan.parameters, urlInspectorSearch]);

  const filteredInspectorUrlStrings = useMemo(() => {
    const q = urlInspectorSearch.trim().toLowerCase();
    if (!q) return consoleCaptureReport.urlStrings;
    return consoleCaptureReport.urlStrings.filter(
      (u) =>
        u.url.toLowerCase().includes(q) ||
        u.host.toLowerCase().includes(q) ||
        u.sourceContext.toLowerCase().includes(q) ||
        String(u.line).includes(q)
    );
  }, [consoleCaptureReport.urlStrings, urlInspectorSearch]);

  const filteredInspectorJs = useMemo(() => {
    const q = urlInspectorSearch.trim().toLowerCase();
    if (!q) return consoleCaptureReport.jsSnippets;
    return consoleCaptureReport.jsSnippets.filter(
      (js) =>
        js.title.toLowerCase().includes(q) ||
        js.sourceContext.toLowerCase().includes(q) ||
        js.code.toLowerCase().includes(q) ||
        js.embeddedUrls.some((u) => u.toLowerCase().includes(q)) ||
        String(js.line).includes(q)
    );
  }, [consoleCaptureReport.jsSnippets, urlInspectorSearch]);

  const foldedView = useMemo(() => {
    if (mode !== 'xml' || foldedKeys.size === 0 || !layoutTree) return null;
    return buildFoldedEditorView(draftXml, foldedKeys, layoutTree);
  }, [mode, foldedKeys, layoutTree, draftXml]);

  const activeSourceCode =
    mode === 'css' ? customCss : foldedView ? foldedView.displayText : draftXml;
  const activeLineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < activeSourceCode.length; i++) {
      if (activeSourceCode.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [activeSourceCode]);

  const { searchMatches, isMatchLimitReached } = useMemo(() => {
    if (!codeSearchQuery) {
      return { searchMatches: [] as CodeSearchMatch[], isMatchLimitReached: false };
    }
    const matches: CodeSearchMatch[] = [];
    const haystack = codeSearchCaseSensitive ? activeSourceCode : activeSourceCode.toLowerCase();
    const needle = codeSearchCaseSensitive ? codeSearchQuery : codeSearchQuery.toLowerCase();

    let pos = 0;
    let scanLine = 1;
    let lineStartOffset = 0;
    let nlCursor = 0;
    let capped = false;

    while (pos < haystack.length) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) break;

      while (true) {
        const nextNl = haystack.indexOf('\n', nlCursor);
        if (nextNl === -1 || nextNl >= idx) break;
        scanLine++;
        lineStartOffset = nextNl + 1;
        nlCursor = nextNl + 1;
      }

      matches.push({
        start: idx,
        end: idx + needle.length,
        line: scanLine,
        colStart: idx - lineStartOffset,
        colEnd: idx - lineStartOffset + needle.length,
      });

      if (matches.length >= 5000) {
        capped = true;
        break;
      }

      pos = idx + Math.max(1, needle.length);
    }

    return { searchMatches: matches, isMatchLimitReached: capped };
  }, [activeSourceCode, codeSearchCaseSensitive, codeSearchQuery]);

  const safeMatchIdx =
    searchMatches.length === 0 ? 0 : Math.min(activeMatchIdx, searchMatches.length - 1);
  const activeMatch = searchMatches.length > 0 ? searchMatches[safeMatchIdx] : null;

  const scrollTextareaToMatch = useCallback(
    (match: CodeSearchMatch, focusEditor = false) => {
      requestAnimationFrame(() => {
        const textarea = mode === 'css' ? cssTextareaRef.current : xmlTextareaRef.current;
        if (!textarea) return;
        const targetTop = Math.max(
          0,
          (match.line - 1) * ROW_HEIGHT_PX - Math.floor((textarea.clientHeight || 300) / 3)
        );
        const approxCharWidth = 7.25;
        const matchLeftPx = match.colStart * approxCharWidth;
        const targetLeft =
          matchLeftPx > (textarea.clientWidth || 600) * 0.65
            ? Math.max(0, matchLeftPx - (textarea.clientWidth || 600) * 0.35)
            : 0;

        textarea.scrollTop = targetTop;
        textarea.scrollLeft = targetLeft;
        if (focusEditor) {
          textarea.focus();
          textarea.setSelectionRange(match.start, match.end);
        }
        setCursorLine(match.line);
        setCursorCol(match.colStart + 1);
      });
    },
    [mode]
  );

  const navigateSearchMatch = useCallback(
    (direction: 'next' | 'prev', focusEditor = false) => {
      if (searchMatches.length === 0) return;
      const nextIdx =
        direction === 'next'
          ? (safeMatchIdx + 1) % searchMatches.length
          : (safeMatchIdx - 1 + searchMatches.length) % searchMatches.length;
      setActiveMatchIdx(nextIdx);
      scrollTextareaToMatch(searchMatches[nextIdx], focusEditor);
    },
    [safeMatchIdx, scrollTextareaToMatch, searchMatches]
  );

  useEffect(() => {
    setActiveMatchIdx(0);
    if (searchMatches.length > 0) {
      scrollTextareaToMatch(searchMatches[0], false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSearchQuery, codeSearchCaseSensitive, mode]);

  const toggleEditorTheme = () => {
    setEditorTheme((prev) => {
      const next: EditorTheme = prev === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('temaloka_editor_theme', next);
      }
      return next;
    });
  };

  const runAutoDetectSafelist = useCallback((targetXml: string) => {
    if (!targetXml.trim()) {
      setActiveSafelistChips([]);
      setCssPrefixRuleCounts({});
      return;
    }
    safelistCancelRef.current?.();
    setIsDetectingSafelist(true);
    const job = runAnalyzeDeadCodeWorker(targetXml);
    safelistCancelRef.current = job.cancel;
    job.promise
      .then((res) => {
        if (safelistCancelRef.current !== job.cancel) return;
        safelistCancelRef.current = null;
        lastAutoSafelistXmlRef.current = targetXml;
        setActiveSafelistChips(res.autoDetectedSafelist || []);
        setCssPrefixRuleCounts(res.cssPrefixRuleCounts || {});
        setIsDetectingSafelist(false);
      })
      .catch(() => {
        if (safelistCancelRef.current !== job.cancel) return;
        safelistCancelRef.current = null;
        setIsDetectingSafelist(false);
      });
  }, []);

  useEffect(() => {
    setDraftXml(xml);
    setDebouncedDraftXml(xml);
    setFoldedKeys(new Set());
    setLastFixesApplied([]);
    lastAutoSafelistXmlRef.current = '';
  }, [xml]);

  useEffect(() => {
    if (!showCleanerPanel) return;
    if (lastAutoSafelistXmlRef.current === draftXml) return;
    const delay = draftXml.length > LARGE_FILE_VALIDATION_THRESHOLD_BYTES ? 800 : 120;
    const t = window.setTimeout(() => {
      runAutoDetectSafelist(draftXml);
    }, delay);
    return () => window.clearTimeout(t);
  }, [showCleanerPanel, draftXml, runAutoDetectSafelist]);

  useEffect(() => {
    return () => {
      workerCancelRef.current?.();
      safelistCancelRef.current?.();
    };
  }, []);

  const scrollToLineAndSelect = useCallback(
    (targetLine: number, highlightSnippet?: string, targetMode: 'xml' | 'css' = 'xml') => {
      setMode(targetMode);
      const performScroll = (attemptsLeft: number) => {
        const textarea = targetMode === 'css' ? cssTextareaRef.current : xmlTextareaRef.current;
        if (!textarea) {
          if (attemptsLeft > 0) {
            window.setTimeout(() => performScroll(attemptsLeft - 1), 32);
          }
          return;
        }
        const source = targetMode === 'css' ? customCss : textarea.value || draftXml;
        const { start: charStart, lineText } = getLineRangeAtNumberFast(source, targetLine);
        const targetIdx = Math.max(0, targetLine - 1);
        let selStart = charStart;
        let selEnd = charStart + lineText.length;

        if (highlightSnippet) {
          const snipIdx = lineText.indexOf(highlightSnippet.trim());
          if (snipIdx !== -1) {
            selStart = charStart + snipIdx;
            selEnd = selStart + highlightSnippet.trim().length;
          }
        }

        textarea.focus();
        textarea.setSelectionRange(selStart, selEnd);
        textarea.scrollTop = Math.max(
          0,
          targetIdx * ROW_HEIGHT_PX - Math.floor((textarea.clientHeight || 300) / 3)
        );
        textarea.scrollLeft = 0;
        setCursorLine(targetIdx + 1);
        setCursorCol(selStart - charStart + 1);
      };
      requestAnimationFrame(() => performScroll(4));
    },
    [customCss, draftXml]
  );

  const handleToggleFoldKey = (key: string) => {
    setFoldedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleJumpFromTree = (line: number, keysToUnfold: string[]) => {
    if (keysToUnfold.length > 0 && foldedKeys.size > 0) {
      setFoldedKeys((prev) => {
        const next = new Set(prev);
        for (const k of keysToUnfold) next.delete(k);
        return next;
      });
      requestAnimationFrame(() => {
        scrollToLineAndSelect(line, undefined, 'xml');
      });
      return;
    }
    scrollToLineAndSelect(line, undefined, 'xml');
  };

  const handleJumpToLineSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsed = parseInt(jumpLineInput.trim(), 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      onNotify(`Masukkan nomor baris valid antara 1 dan ${activeLineCount}.`, 'info');
      return;
    }
    const clampedLine = Math.min(Math.max(1, parsed), activeLineCount);
    const activeEditorMode = mode === 'css' ? 'css' : 'xml';
    scrollToLineAndSelect(clampedLine, undefined, activeEditorMode);
    if (parsed > activeLineCount) {
      onNotify(`Melompat ke baris terakhir (${activeLineCount}).`, 'info');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode === 'converter') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        jumpInputRef.current?.focus();
        jumpInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  useEffect(() => {
    if (!focusLine || focusLine < 1) return;
    setShowDiagnostics(true);
    scrollToLineAndSelect(focusLine);
  }, [focusLine, scrollToLineAndSelect]);

  // Debounced live syntax validation using fast O(N) checks (DOMParser forced via manual Validate button on >150KB)
  const [validation, setValidation] = useState<XmlValidationResult>(() =>
    validateBloggerXmlOffline(xml)
  );
  const validationPending = draftXml !== debouncedDraftXml;

  useEffect(() => {
    setValidation(validateBloggerXmlOffline(debouncedDraftXml));
  }, [debouncedDraftXml]);

  const handleManualValidate = () => {
    const res = validateBloggerXmlOffline(draftXml, { forceDomParser: true });
    setValidation(res);
    setShowDiagnostics(true);
    onNotify(
      res.isValid
        ? 'Validasi DOMParser("text/xml") lulus tanpa error.'
        : `Ditemukan ${res.issues.length} masalah sintaks XML.`,
      res.isValid ? 'success' : 'error'
    );
  };

  const lineCount = activeLineCount;
  const usesCrlf = xml.includes('\r\n');
  const hasUnsavedXml = draftXml.replace(/\r\n/g, '\n') !== xml.replace(/\r\n/g, '\n');

  const preserveLineEndings = (text: string) =>
    usesCrlf ? text.replace(/\r?\n/g, '\r\n') : text;

  const handleCopy = async () => {
    try {
      const content =
        mode === 'xml' || mode === 'html-js-css'
          ? draftXml
          : mode === 'css'
            ? customCss
            : snippetOutput || snippetInput;
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onNotify(
        mode === 'xml' || mode === 'html-js-css'
          ? 'Kode XML disalin ke papan klip.'
          : mode === 'css'
            ? 'CSS kustom disalin ke papan klip.'
            : 'Hasil konversi disalin ke papan klip.',
        'success'
      );
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('Gagal menyalin ke papan klip.', 'error');
    }
  };

  const handleCancelWorker = () => {
    workerCancelRef.current?.();
    workerCancelRef.current = null;
    setWorkerProgress(null);
    onNotify('Proses Web Worker dibatalkan oleh pengguna.', 'info');
  };

  const handleAutoFixOffline = () => {
    workerCancelRef.current?.();
    setLastCleanResult(null);
    const job = runIterativeAutoFixWorker(
      draftXml,
      (p) => setWorkerProgress(p),
      10
    );
    workerCancelRef.current = job.cancel;
    job.promise
      .then((result) => {
        workerCancelRef.current = null;
        setWorkerProgress(null);
        setLastAutoFixResult(result);
        setLastFixesApplied(result.fixesApplied);
        setValidation(result.validationAfter);
        setShowDiagnostics(true);

        if (result.fixesApplied.length === 0 && result.fixedXml === draftXml) {
          onNotify(
            result.domParserValid
              ? 'XML sudah valid menurut DOMParser("text/xml").'
              : 'Auto-Fix selesai (maks. 10 putaran). Tinjau error yang tersisa di panel diagnostik.',
            result.domParserValid ? 'success' : 'info'
          );
          return;
        }

        const finalFixed = preserveLineEndings(result.fixedXml);
        setDraftXml(finalFixed);
        onApplyXml(finalFixed);
        onNotify(
          `Auto-Fix Worker (${result.roundsExecuted} putaran, ${result.durationMs} md) menerapkan ${result.fixesApplied.length} perbaikan${result.domParserValid ? ' · XML Valid!' : ''}.`,
          result.domParserValid ? 'success' : 'info'
        );
      })
      .catch((err) => {
        workerCancelRef.current = null;
        setWorkerProgress(null);
        onNotify(err instanceof Error ? err.message : 'Auto-Fix dibatalkan/gagal.', 'error');
      });
  };

  const handleAddManualSafelist = (rawPrefix: string) => {
    const normalized = normalizeSafelistInput(rawPrefix);
    if (!normalized) return;
    setActiveSafelistChips((prev) => {
      if (prev.some((c) => c.prefix.toLowerCase() === normalized.toLowerCase())) {
        return prev;
      }
      return [
        ...prev,
        {
          prefix: normalized,
          kind: 'prefix',
          cssRuleCount: cssPrefixRuleCounts[normalized.toLowerCase()] || 0,
          matchedTokensSample: [],
          source: 'manual',
        },
      ];
    });
  };

  const handleRemoveSafelistPrefix = (prefixToRemove: string) => {
    setActiveSafelistChips((prev) =>
      prev.filter((c) => c.prefix.toLowerCase() !== prefixToRemove.toLowerCase())
    );
  };

  const handleRunDeadCodeCleaner = () => {
    workerCancelRef.current?.();
    setLastAutoFixResult(null);
    const job = runCleanDeadCodeWorker(
      draftXml,
      {
        ...cleanOptions,
        safelistPrefixes: activeSafelistChips.map((c) => c.prefix),
      },
      (p) => setWorkerProgress(p)
    );
    workerCancelRef.current = job.cancel;
    job.promise
      .then((res) => {
        workerCancelRef.current = null;
        setWorkerProgress(null);
        setLastCleanResult(res);

        if (res.rolledBackToValid) {
          onNotify(
            'Pembersihan dibatalkan otomatis karena memicu <parsererror> di XML.',
            'error'
          );
          return;
        }

        const beforeClean = draftXml;
        const finalCleaned = preserveLineEndings(res.cleanedXml);
        setDraftXml(finalCleaned);
        onApplyXml(finalCleaned);
        setValidation(validateBloggerXmlOffline(finalCleaned));

        const totalRemoved =
          res.stats.removedCssRulesCount +
          res.stats.removedCssVarsCount +
          res.stats.removedJsFunctionsCount +
          res.stats.removedDuplicateCssCount +
          res.stats.removedDuplicateJsCount +
          res.stats.removedCommentsCount;

        if (finalCleaned !== beforeClean) {
          setLastEditorDiff({
            before: beforeClean,
            after: finalCleaned,
            title: 'Diff Pembersih CSS / JS Mati',
            subtitle: `Hemat ${(res.stats.savedBytes / 1024).toFixed(2)} KB · ${totalRemoved} item dibersihkan`,
          });
        }

        onNotify(
          totalRemoved > 0
            ? `Pembersih Worker selesai (${res.stats.durationMs} md): ${totalRemoved} item dibersihkan, hemat ${(res.stats.savedBytes / 1024).toFixed(2)} KB · XML Valid!`
            : 'Template sudah bersih, tidak ada kode mati atau komentar yang perlu dihapus.',
          totalRemoved > 0 ? 'success' : 'info'
        );
      })
      .catch((err) => {
        workerCancelRef.current = null;
        setWorkerProgress(null);
        onNotify(err instanceof Error ? err.message : 'Pembersihan dibatalkan/gagal.', 'error');
      });
  };

  const handleCleanAllSvgsInEditor = () => {
    const res = cleanAllSvgsInXml(draftXml);
    if (res.cleanedCount === 0 || res.savedBytes <= 0) {
      onNotify('Semua SVG inline sudah bersih dari metadata berlebih.', 'info');
      return;
    }
    const before = draftXml;
    const nextFinal = preserveLineEndings(res.nextXml);
    setDraftXml(nextFinal);
    onApplyXml(nextFinal);
    setLastEditorDiff({
      before,
      after: nextFinal,
      title: 'Diff Inline SVG Cleaner',
      subtitle: `${res.cleanedCount} SVG dibersihkan · hemat ${(res.savedBytes / 1024).toFixed(2)} KB`,
    });
    onNotify(
      `${res.cleanedCount} SVG inline dibersihkan (hemat ${(res.savedBytes / 1024).toFixed(2)} KB).`,
      'success'
    );
  };

  const handleMinifyCssInEditor = () => {
    const res = minifyCssInXmlOffline(draftXml);
    if (!res.changed || res.blocksMinified === 0) {
      onNotify('CSS pada <b:skin> dan <style> sudah terkompresi optimal.', 'info');
      return;
    }
    const before = draftXml;
    const nextFinal = preserveLineEndings(res.nextXml);
    setDraftXml(nextFinal);
    onApplyXml(nextFinal);
    const savedLabel =
      res.savedBytes > 0
        ? `hemat ${(res.savedBytes / 1024).toFixed(2)} KB`
        : 'diamankan dengan CDATA XML';
    setLastEditorDiff({
      before,
      after: nextFinal,
      title: 'Diff Minify CSS (<b:skin> & <style>)',
      subtitle: `${res.blocksMinified} blok CSS diperkecil · ${savedLabel}`,
    });
    onNotify(
      `${res.blocksMinified} blok CSS berhasil di-minify (${savedLabel}).`,
      'success'
    );
  };

  const handleMinifyJsInEditor = () => {
    const res = minifyJsInXmlOffline(draftXml);
    if (!res.changed || res.blocksMinified === 0) {
      onNotify('JavaScript pada blok <script> sudah ringkas (tidak ada penghematan tambahan).', 'info');
      return;
    }
    const before = draftXml;
    const nextFinal = preserveLineEndings(res.nextXml);
    setDraftXml(nextFinal);
    onApplyXml(nextFinal);
    const savedLabel =
      res.savedBytes > 0
        ? `hemat ${(res.savedBytes / 1024).toFixed(2)} KB`
        : 'diamankan dengan //<![CDATA[';
    setLastEditorDiff({
      before,
      after: nextFinal,
      title: 'Diff Minify JS (<script> Inline)',
      subtitle: `${res.blocksMinified} blok JS diperkecil · ${savedLabel}`,
    });
    onNotify(
      `${res.blocksMinified} blok JavaScript berhasil di-minify (${savedLabel}).`,
      'success'
    );
  };

  const handleInsertBloggerSnippet = () => {
    const preset = BLOGGER_SNIPPET_PRESETS.find((p) => p.id === selectedSnippetId);
    if (!preset) return;
    const textarea = xmlTextareaRef.current;
    const displaySrc = foldedView ? foldedView.displayText : draftXml;
    const start = textarea ? textarea.selectionStart : displaySrc.length;
    const end = textarea ? textarea.selectionEnd : start;
    const nextDisplay = `${displaySrc.slice(0, start)}${preset.code}${displaySrc.slice(end)}`;
    const nextCanonical = foldedView
      ? unfoldEditorText(nextDisplay, foldedView.placeholderToOriginal)
      : nextDisplay;
    setDraftXml(nextCanonical);
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(start, start + preset.code.length);
      }
    });
    onNotify(`Snippet "${preset.label}" disisipkan ke posisi kursor.`, 'success');
  };

  const handlePrettifyXml = () => {
    try {
      const res = formatBloggerXmlOffline(draftXml, 2);
      if (res.error) {
        onNotify(res.error, 'error');
        if (res.errorLine) scrollToLineAndSelect(res.errorLine);
        return;
      }
      if (!res.changed) {
        onNotify('Struktur dan indentasi kode XML sudah rapi.', 'info');
        return;
      }
      const finalFormatted = preserveLineEndings(res.formattedXml);
      setDraftXml(finalFormatted);
      onNotify(
        `Kode XML dirapikan dengan indentasi 2 spasi (${res.lineCountBefore} → ${res.lineCountAfter} baris).`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Gagal merapikan XML karena sintaks tag belum lengkap.',
        'error'
      );
    }
  };

  const applySelectionTransform = (
    transformFn: (selected: string) => string,
    label: string
  ) => {
    const textarea = xmlTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end) {
      onNotify(
        `Sorot teks di editor terlebih dahulu untuk "${label}", atau gunakan tab Konverter Offline.`,
        'info'
      );
      return;
    }

    const displaySrc = foldedView ? foldedView.displayText : draftXml;
    const selected = displaySrc.slice(start, end);
    const transformed = transformFn(selected);
    const nextDisplay = displaySrc.slice(0, start) + transformed + displaySrc.slice(end);
    const nextCanonical = foldedView
      ? unfoldEditorText(nextDisplay, foldedView.placeholderToOriginal)
      : nextDisplay;
    setDraftXml(nextCanonical);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + transformed.length);
    });
    onNotify(`${label} diterapkan pada teks terpilih secara offline.`, 'success');
  };

  const runConverterAction = (
    action: 'escape' | 'unescape' | 'cdata-xml' | 'cdata-css' | 'cdata-slash' | 'unwrap-cdata'
  ) => {
    let result = '';
    switch (action) {
      case 'escape':
        result = escapeHtmlEntities(snippetInput, preserveEntities);
        break;
      case 'unescape':
        result = unescapeHtmlEntities(snippetInput);
        break;
      case 'cdata-xml':
        result = wrapWithCdata(snippetInput, 'xml');
        break;
      case 'cdata-css':
        result = wrapWithCdata(snippetInput, 'css-js');
        break;
      case 'cdata-slash':
        result = wrapWithCdata(snippetInput, 'slash');
        break;
      case 'unwrap-cdata':
        result = unwrapCdata(snippetInput);
        break;
    }
    setSnippetOutput(result);
  };

  const handleInsertToXmlEditor = () => {
    const textToInsert = snippetOutput || snippetInput;
    if (!textToInsert) return;
    const textarea = xmlTextareaRef.current;
    const cursorPos = textarea ? textarea.selectionStart : draftXml.length;
    const next = draftXml.slice(0, cursorPos) + textToInsert + draftXml.slice(cursorPos);
    setDraftXml(next);
    setMode('xml');
    onNotify('Hasil konversi disisipkan ke Editor XML.', 'success');
  };

  const handleCopySnippetResult = async () => {
    const textToCopy = snippetOutput;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedSnippet(true);
      onNotify('Hasil konversi offline disalin ke papan klip.', 'success');
      setTimeout(() => setCopiedSnippet(false), 1800);
    } catch {
      onNotify('Gagal menyalin hasil konversi.', 'error');
    }
  };

  const errorCount = validation.issues.filter((i) => i.severity === 'error').length;
  const warningCount = validation.issues.filter((i) => i.severity === 'warning').length;

  return (
    <div
      className={`flex-1 flex flex-col overflow-hidden transition-colors ${
        isDark ? 'bg-[#0B1120] text-slate-100' : 'bg-white text-slate-900'
      }`}
    >
      <OfflineAiRuntimeBar
        controller={offlineAi}
        page="editor"
        xml={draftXml}
        parsedInfo={parsedInfo}
        activeLine={cursorLine}
      />

      {/* Main Editor Toolbar */}
      <div
        className={`px-3 sm:px-6 py-2.5 sm:py-3 border-b flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 ${
          isDark
            ? 'bg-[#0F172A] border-slate-800'
            : 'bg-slate-50/60 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-4 flex-wrap">
          <div
            className={`flex items-center gap-1 p-1 rounded-lg ${
              isDark ? 'bg-slate-800' : 'bg-slate-200/70'
            }`}
          >
            <button
              type="button"
              onClick={() => setMode('xml')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'xml'
                  ? isDark
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sumber Template XML
            </button>
            <button
              type="button"
              onClick={() => setMode('css')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'css'
                  ? isDark
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              CSS Kustom
            </button>
            <button
              type="button"
              onClick={() => setMode('html-js-css')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'html-js-css'
                  ? isDark
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              HTML / .JS / .CSS
            </button>
            <button
              type="button"
              onClick={() => setMode('converter')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'converter'
                  ? isDark
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Alat Escape &amp; CDATA
            </button>
          </div>

          <div
            className={`hidden xl:flex items-center gap-2 text-xs font-mono tabular-nums ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            <span>{lineCount} baris</span>
            <span aria-hidden="true">&middot;</span>
            <span>{(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB</span>
            <span aria-hidden="true">&middot;</span>
            <span>{parsedInfo.variables.length} variabel</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Light / Dark Mode Switcher */}
          <button
            type="button"
            onClick={toggleEditorTheme}
            title={isDark ? 'Ganti ke Mode Terang (Light)' : 'Ganti ke Mode Gelap (Dark)'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isDark
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            }`}
          >
            {isDark ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-600" />
                <span>Dark</span>
              </>
            )}
          </button>

          {mode === 'xml' && (
            <>
              <button
                type="button"
                onClick={handleManualValidate}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  errorCount > 0
                    ? isDark
                      ? 'bg-red-950/70 border-red-800 text-red-300 hover:bg-red-900/70'
                      : 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
                    : warningCount > 0
                      ? isDark
                        ? 'bg-amber-950/70 border-amber-800 text-amber-300 hover:bg-amber-900/70'
                        : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                      : isDark
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {errorCount > 0 ? (
                  <ShieldAlert className="w-3.5 h-3.5" />
                ) : warningCount > 0 ? (
                  <AlertTriangle className="w-3.5 h-3.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span className="tabular-nums">
                  {validationPending
                    ? 'Validasi XML'
                    : errorCount > 0
                      ? `${errorCount} Error Sintaks`
                      : warningCount > 0
                        ? `${warningCount} Peringatan`
                        : 'XML Valid (Offline)'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowTreeExplorer((v) => !v)}
                title="Jelajahi Section & Widget serta aktifkan Code Folding"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showTreeExplorer
                    ? isDark
                      ? 'bg-blue-600/25 border-blue-500/60 text-blue-200'
                      : 'bg-blue-50 border-blue-300 text-blue-900'
                    : isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5 text-blue-500" />
                <span>Peta XML ({layoutTree ? layoutTree.sections.length : parsedInfo.sections.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowUrlInspectorPanel((v) => !v)}
                title="Tangkap Query String, Query Parameter, JavaScript untuk Konsol, serta decode URL Obfuscation (.css/.js/.jss)"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                  showUrlInspectorPanel
                    ? isDark
                      ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-200'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : obfuscatedUrlCount > 0
                      ? isDark
                        ? 'bg-red-950/60 border-red-800 text-red-200 hover:bg-red-900/60'
                        : 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
                      : isDark
                        ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-emerald-500" />
                <span>
                  Parameter &amp; JS Konsol ({dynamicQueryScan.parameters.length} Param &middot;{' '}
                  {consoleCaptureReport.jsSnippets.length} JS
                  {obfuscatedUrlCount > 0 ? ` · ${obfuscatedUrlCount} Tersembunyi` : ''})
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowCleanerPanel((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showCleanerPanel
                    ? isDark
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                      : 'bg-amber-50 border-amber-300 text-amber-900'
                    : isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Pembersih CSS/JS Mati</span>
              </button>

              <button
                type="button"
                onClick={handleMinifyCssInEditor}
                title="Minify blok CSS <b:skin> dan <style> secara aman"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Minimize2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Minify CSS</span>
              </button>

              <button
                type="button"
                onClick={handleMinifyJsInEditor}
                title="Minify blok JavaScript <script> inline secara aman (ASI & CDATA terjaga)"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Minimize2 className="w-3.5 h-3.5 text-blue-500" />
                <span>Minify JS</span>
              </button>

              <button
                type="button"
                onClick={handleCleanAllSvgsInEditor}
                title="Bersihkan komentar, Inkscape/Figma metadata, dan grup kosong di semua SVG inline"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Bersihkan SVG</span>
              </button>

              <button
                type="button"
                onClick={handlePrettifyXml}
                title="Auto-format (Prettify) struktur kode XML dengan indentasi dan spasi rapi"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <AlignLeft className="w-3.5 h-3.5" />
                <span>Rapikan XML</span>
              </button>

              <button
                type="button"
                onClick={() => setIdentityModalOpen(true)}
                title="Atur Identitas Template (Nama, Versi, Author, URL, Lisensi, dan atribut lainnya)"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <BadgeCheck className="w-3.5 h-3.5 text-blue-500" />
                <span>Identitas Template</span>
              </button>

              {onOpenSnapshots && (
                <button
                  type="button"
                  onClick={onOpenSnapshots}
                  title="Buka Riwayat Snapshot Lokal (IndexedDB)"
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  <History className="w-3.5 h-3.5 text-blue-500" />
                  <span>Snapshot ({snapshotCount})</span>
                </button>
              )}

              <button
                type="button"
                disabled={Boolean(workerProgress)}
                onClick={handleAutoFixOffline}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                  isDark
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Auto-Fix XML (Worker)</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isDark
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Tersalin' : 'Salin'}</span>
          </button>

          {mode === 'xml' && hasUnsavedXml && (
            <>
              <button
                type="button"
                onClick={() => setDraftXml(xml)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Batalkan</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onApplyXml(preserveLineEndings(draftXml));
                  onNotify('Perubahan kode XML diterapkan ke pratinjau.', 'success');
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Terapkan ke Pratinjau</span>
              </button>
            </>
          )}

          {mode === 'xml' && onSaveOverwriteAndDownload && (
            <>
              <button
                type="button"
                onClick={() => onSaveOverwriteAndDownload(preserveLineEndings(draftXml))}
                title="Simpan editor, timpa seluruh template XML aktif, dan langsung unduh file .xml"
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Simpan, Timpa &amp; Unduh .xml</span>
              </button>
              {canShareMobile && (
                <button
                  type="button"
                  onClick={() =>
                    void shareXmlFileViaNavigator(
                      preserveLineEndings(draftXml),
                      parsedInfo.templateTitle
                    )
                  }
                  title="Simpan template-blogger.xml ke File Manager Android via Share HP"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share HP</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Inline Offline Selection Toolbar & Blogger Snippet Injector (when in XML mode) */}
      {mode === 'xml' && (
        <div
          className={`px-3 sm:px-6 py-2 border-b flex flex-wrap items-center justify-between gap-2.5 text-xs ${
            isDark
              ? 'bg-[#0F172A] border-slate-800'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 max-w-full">
            <span
              className={`text-[11px] font-medium mr-1 whitespace-nowrap ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Ubah Teks Tersorot:
            </span>
            {(
              [
                ['Escape HTML', () => applySelectionTransform((s) => escapeHtmlEntities(s, true), 'HTML Escape'), false],
                ['Unescape HTML', () => applySelectionTransform((s) => unescapeHtmlEntities(s), 'HTML Unescape'), false],
                ['<![CDATA[...]]>', () => applySelectionTransform((s) => wrapWithCdata(s, 'xml'), 'Bungkus <![CDATA[...]]>'), true],
                ['/*<![CDATA[*/', () => applySelectionTransform((s) => wrapWithCdata(s, 'css-js'), 'Bungkus /*<![CDATA[*/'), true],
                ['Lepas CDATA', () => applySelectionTransform((s) => unwrapCdata(s), 'Lepas CDATA'), false],
              ] as Array<[string, () => void, boolean]>
            ).map(([label, handler, isMono]) => (
              <button
                key={label}
                type="button"
                onClick={handler}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isMono ? 'font-mono' : 'font-medium'
                } ${
                  isDark
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="blogger-snippet-select"
                className={`text-[11px] font-medium whitespace-nowrap ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Snippet Blogger:
              </label>
              <select
                id="blogger-snippet-select"
                value={selectedSnippetId}
                onChange={(e) => setSelectedSnippetId(e.target.value)}
                title={
                  BLOGGER_SNIPPET_PRESETS.find((p) => p.id === selectedSnippetId)?.description || ''
                }
                className={`px-2 py-1 text-[11px] font-mono border rounded-md focus:outline-none ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-100'
                    : 'bg-white border-slate-200 text-slate-800'
                }`}
              >
                {BLOGGER_SNIPPET_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleInsertBloggerSnippet}
                className="px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap cursor-pointer"
              >
                Sisipkan di Kursor
              </button>
            </div>

            <button
              type="button"
              onClick={() => setMode('converter')}
              className={`text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
              }`}
            >
              Konverter Penuh &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Search Code & Jump to Line Bar (XML & CSS modes) */}
      {(mode === 'xml' || mode === 'css') && (
        <div
          className={`px-3 sm:px-6 py-2 border-b flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs ${
            isDark
              ? 'bg-[#0B1120] border-slate-800'
              : 'bg-slate-50/70 border-slate-200'
          }`}
        >
          {/* Left: XML/CSS Code Search */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[180px] max-w-md">
              <Search
                className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${
                  isDark ? 'text-slate-500' : 'text-slate-400'
                }`}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={codeSearchQuery}
                onChange={(e) => setCodeSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    navigateSearchMatch(e.shiftKey ? 'prev' : 'next', false);
                  } else if (e.key === 'Escape') {
                    setCodeSearchQuery('');
                    (mode === 'css' ? cssTextareaRef : xmlTextareaRef).current?.focus();
                  }
                }}
                placeholder={
                  mode === 'xml'
                    ? 'Cari kode XML (misal: b:widget, header, .post)...'
                    : 'Cari kode CSS...'
                }
                aria-label="Cari kode di editor"
                className={`w-full pl-8 pr-7 py-1.5 text-xs font-mono border rounded-lg focus:outline-none transition-colors ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500'
                    : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-600'
                }`}
              />
              {codeSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setCodeSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Hapus kata kunci pencarian"
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded cursor-pointer ${
                    isDark
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {codeSearchQuery && (
              <span
                className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded border whitespace-nowrap shrink-0 ${
                  searchMatches.length === 0
                    ? isDark
                      ? 'bg-red-950/60 border-red-800/70 text-red-300'
                      : 'bg-red-50 border-red-200 text-red-700'
                    : isDark
                      ? 'bg-slate-900 border-slate-700 text-slate-300'
                      : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {searchMatches.length === 0
                  ? '0 hasil'
                  : `${safeMatchIdx + 1} / ${searchMatches.length}${isMatchLimitReached ? '+' : ''}`}
              </span>
            )}

            <button
              type="button"
              onClick={() => setCodeSearchCaseSensitive((v) => !v)}
              title="Cocokkan huruf besar/kecil (Case Sensitive)"
              aria-pressed={codeSearchCaseSensitive}
              className={`px-2 py-1.5 text-[11px] font-mono font-semibold border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                codeSearchCaseSensitive
                  ? isDark
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-blue-600 border-blue-600 text-white'
                  : isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Aa
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => navigateSearchMatch('prev', false)}
                disabled={searchMatches.length === 0}
                title="Hasil sebelumnya (Shift+Enter)"
                aria-label="Hasil pencarian sebelumnya"
                className={`p-1.5 border rounded-lg transition-colors disabled:opacity-40 cursor-pointer ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigateSearchMatch('next', false)}
                disabled={searchMatches.length === 0}
                title="Hasil berikutnya (Enter)"
                aria-label="Hasil pencarian berikutnya"
                className={`p-1.5 border rounded-lg transition-colors disabled:opacity-40 cursor-pointer ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right: Jump to Line Number */}
          <form
            onSubmit={handleJumpToLineSubmit}
            className="flex items-center gap-1.5 shrink-0"
          >
            <label
              htmlFor="xml-jump-line-input"
              className={`text-[11px] font-medium whitespace-nowrap flex items-center gap-1 ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              <Hash className="w-3 h-3" />
              <span>Lompat ke Baris:</span>
            </label>
            <input
              id="xml-jump-line-input"
              ref={jumpInputRef}
              type="number"
              min={1}
              max={activeLineCount}
              value={jumpLineInput}
              onChange={(e) => setJumpLineInput(e.target.value)}
              placeholder={`1–${activeLineCount}`}
              aria-label="Nomor baris tujuan"
              className={`w-24 px-2.5 py-1.5 text-xs font-mono tabular-nums border rounded-lg focus:outline-none transition-colors ${
                isDark
                  ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500'
                  : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-600'
              }`}
            />
            <button
              type="submit"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>Lompat</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </form>
        </div>
      )}

      {/* Web Worker Real-Time Progress & Cancel Banner */}
      {workerProgress && (
        <div
          className={`px-3 sm:px-6 py-2.5 border-b space-y-1.5 ${
            isDark
              ? 'bg-blue-950/60 border-blue-900 text-blue-100'
              : 'bg-blue-50 border-blue-200 text-blue-950'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
              <span className="font-semibold truncate">{workerProgress.message}</span>
              <span className="font-mono tabular-nums text-[11px] opacity-80 shrink-0">
                {workerProgress.percent}%
              </span>
            </div>
            <button
              type="button"
              onClick={handleCancelWorker}
              className="px-2.5 py-1 text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md cursor-pointer shrink-0"
            >
              Batal
            </button>
          </div>
          <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-blue-200/70'}`}>
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${Math.max(4, workerProgress.percent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Dead CSS / JS / CSS Vars Worker Cleaner Panel */}
      {mode === 'xml' && showCleanerPanel && (
        <div
          className={`px-3 sm:px-6 py-3.5 border-b space-y-3 text-xs ${
            isDark
              ? 'bg-[#0F172A] border-slate-800 text-slate-200'
              : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>Pembersih CSS / JS / Variabel CSS Mati (100% Offline Web Worker)</span>
              </div>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Isolasi blok &amp; CDATA aman, indexing O(1) Set(), pelacakan var(--*) transitif, serta validasi ketat DOMParser(&quot;text/xml&quot;).
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={Boolean(workerProgress)}
                onClick={handleRunDeadCodeCleaner}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                Jalankan Pembersih Sekarang
              </button>
              <button
                type="button"
                onClick={() => setShowCleanerPanel(false)}
                className={`px-2 py-1.5 text-xs cursor-pointer ${isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Tutup
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            {(
              [
                ['removeUnusedCssRules', 'Aturan CSS Mati'],
                ['removeUnusedCssVars', 'Variabel CSS (--*) Mati'],
                ['removeDeadJsFunctions', 'Fungsi JS Mati'],
                ['removeCssJsComments', 'Komentar dalam CSS/JS'],
                ['removeDuplicateCssRules', 'Aturan CSS Duplikat'],
                ['removeDuplicateAssets', 'Tag <link>/<script> Ganda'],
              ] as Array<[keyof DeadCleanOptions, string]>
            ).map(([optKey, optLabel]) => (
              <label key={optKey} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(cleanOptions[optKey])}
                  onChange={(e) =>
                    setCleanOptions((prev) => ({ ...prev, [optKey]: e.target.checked }))
                  }
                  className="rounded border-slate-400 text-blue-600 focus:ring-blue-600"
                />
                <span className="text-[11px] font-medium">{optLabel}</span>
              </label>
            ))}
          </div>

          <SafelistPrefixManager
            chips={activeSafelistChips}
            cssPrefixRuleCounts={cssPrefixRuleCounts}
            isScanning={isDetectingSafelist}
            isDark={isDark}
            onAddManualPrefix={handleAddManualSafelist}
            onRemovePrefix={handleRemoveSafelistPrefix}
            onResetAutoDetect={() => runAutoDetectSafelist(draftXml)}
          />

          {lastCleanResult && (
            <div
              className={`p-3 rounded-lg border space-y-2 ${
                isDark
                  ? 'bg-emerald-950/35 border-emerald-800/70 text-emerald-100'
                  : 'bg-white border-emerald-200 text-slate-800'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    Hasil Pembersihan ({lastCleanResult.stats.durationMs} md) &middot; Hemat{' '}
                    {(lastCleanResult.stats.savedBytes / 1024).toFixed(2)} KB &middot;{' '}
                    {lastCleanResult.validationPassed
                      ? 'DOMParser("text/xml") Valid'
                      : 'Periksa Diagnostik'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer ${
                      isDark ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    Salin XML Hasil
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await downloadXmlFile(draftXml, parsedInfo.templateTitle);
                      if (res.method !== 'cancelled') {
                        onNotify(`File ${res.filename} berhasil diunduh sebagai text/xml.`, 'success');
                      }
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  >
                    Unduh .xml
                  </button>
                  {canShareMobile && (
                    <button
                      type="button"
                      onClick={() => void shareXmlFileViaNavigator(draftXml, parsedInfo.templateTitle)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 flex items-center gap-1 cursor-pointer"
                    >
                      <Share2 className="w-3 h-3" />
                      <span>Simpan via Share HP</span>
                    </button>
                  )}
                </div>
              </div>

              {lastCleanResult.removedItemsSummary.length > 0 ? (
                <ul className="list-disc pl-5 text-[11px] space-y-0.5 tabular-nums">
                  {lastCleanResult.removedItemsSummary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] opacity-80">Tidak ada item yang perlu dihapus.</p>
              )}

              {lastCleanResult.removedItemsDetail && lastCleanResult.removedItemsDetail.length > 0 && (
                <div
                  className={`rounded border overflow-hidden ${
                    isDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div
                    className={`px-2.5 py-1.5 text-[11px] font-semibold border-b flex items-center justify-between gap-2 ${
                      isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <span>
                      Daftar Verifikasi Item Dihapus &amp; Alasannya ({lastCleanResult.removedItemsDetail.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const txt = lastCleanResult.removedItemsDetail
                          .map(
                            (it, idx) =>
                              `${idx + 1}. [${it.kind}] ${it.name} (Baris ${it.line}, -${it.savedBytes} B) — ${it.reason}`
                          )
                          .join('\n');
                        navigator.clipboard?.writeText(txt).catch(() => {});
                      }}
                      className="text-blue-500 hover:underline font-medium cursor-pointer"
                    >
                      Salin Audit Log
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-200/40">
                    {lastCleanResult.removedItemsDetail.map((item, idx) => (
                      <div key={idx} className="px-2.5 py-1.5 text-[11px] space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold break-all">{item.name}</span>
                          <span className="font-mono text-[10px] opacity-75 tabular-nums shrink-0">
                            {item.kind} &middot; Baris {item.line} &middot; -{item.savedBytes} B
                          </span>
                        </div>
                        <p className="opacity-80">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {lastEditorDiff && (
                <div className="pt-1 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold">
                      {lastEditorDiff.title}
                      {lastEditorDiff.subtitle ? ` (${lastEditorDiff.subtitle})` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLastEditorDiff(null)}
                      className="text-blue-500 hover:underline cursor-pointer"
                    >
                      Tutup Diff
                    </button>
                  </div>
                  <DiffViewerPanel
                    beforeText={lastEditorDiff.before}
                    afterText={lastEditorDiff.after}
                    isDark={isDark}
                    maxTotalRows={200}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Standalone Diff Panel (when triggered from Minify CSS or Clean SVG without opening Cleaner Panel) */}
      {mode === 'xml' && !showCleanerPanel && lastEditorDiff && (
        <div
          className={`px-3 sm:px-6 py-3 border-b space-y-2 ${
            isDark ? 'bg-[#0F172A] border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">
              {lastEditorDiff.title}
              {lastEditorDiff.subtitle ? ` — ${lastEditorDiff.subtitle}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setLastEditorDiff(null)}
              className="text-[11px] text-blue-500 hover:underline cursor-pointer"
            >
              Tutup Diff
            </button>
          </div>
          <DiffViewerPanel
            beforeText={lastEditorDiff.before}
            afterText={lastEditorDiff.after}
            isDark={isDark}
            maxTotalRows={200}
          />
        </div>
      )}

      {/* Query String, Query Parameter, JavaScript & External URL Capture Drawer for Console */}
      {mode === 'xml' && showUrlInspectorPanel && (
        <div
          className={`px-3 sm:px-6 py-3 border-b space-y-2.5 text-xs ${
            isDark
              ? 'bg-[#0F172A] border-slate-800 text-slate-200'
              : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-emerald-500" />
                <span>
                  Penangkap Query String, Query Parameter, JavaScript &amp; URL Luar untuk Konsol
                </span>
              </div>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Mendeteksi otomatis seluruh Query String (<span className="font-mono">?key=val</span>), Query Parameter, JavaScript (<span className="font-mono">URLSearchParams</span>, blok skrip), serta URL tersembunyi untuk langsung disalin atau diuji di tab Konsol URL.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="relative w-full sm:w-56">
                <Search
                  className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${
                    isDark ? 'text-slate-400' : 'text-slate-400'
                  }`}
                />
                <input
                  type="text"
                  value={urlInspectorSearch}
                  onChange={(e) => setUrlInspectorSearch(e.target.value)}
                  placeholder="Cari query, param, JS, URL..."
                  className={`w-full pl-8 pr-7 py-1 text-xs rounded-lg border focus:outline-none ${
                    isDark
                      ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500'
                      : 'bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-blue-600'
                  }`}
                />
                {urlInspectorSearch && (
                  <button
                    type="button"
                    onClick={() => setUrlInspectorSearch('')}
                    title="Bersihkan pencarian"
                    className={`absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer ${
                      isDark ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div
                className={`inline-flex flex-wrap items-center gap-1 p-0.5 rounded-lg border ${
                  isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
                }`}
              >
                {(
                  [
                    ['query-strings', `Parameter Dinamis (${filteredDynamicQueries.length})`],
                    ['javascript', `JavaScript (${filteredInspectorJs.length})`],
                    ['url-strings', `URL Luar (${filteredInspectorUrlStrings.length})`],
                    ['all', `Aset (${capturedExternalUrls.length})`],
                    ['css', `.CSS (${capturedExternalUrls.filter((u) => u.kind === 'css').length})`],
                    ['obfuscated', `Tersembunyi (${obfuscatedUrlCount})`],
                  ] as const
                ).map(([fk, fl]) => (
                  <button
                    key={fk}
                    type="button"
                    onClick={() => setUrlInspectorFilter(fk)}
                    className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer tabular-nums ${
                      urlInspectorFilter === fk
                        ? isDark
                          ? 'bg-slate-700 text-white'
                          : 'bg-slate-900 text-white'
                        : isDark
                          ? 'text-slate-400 hover:text-white'
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {fl}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowUrlInspectorPanel(false)}
                className={`px-2 py-1 text-xs cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Tutup
              </button>
            </div>
          </div>

          <div
            className={`max-h-64 overflow-y-auto rounded-lg border divide-y ${
              isDark ? 'bg-slate-950/70 border-slate-800 divide-slate-800' : 'bg-white border-slate-200 divide-slate-100'
            }`}
          >
            {urlInspectorFilter === 'query-strings' ? (
              dynamicQueryScan.xmlEmpty ? (
                <div className="p-4 text-center text-[11px] opacity-75">
                  Kode XML masih kosong. Tempel atau unggah template .xml untuk memindai parameter URL secara otomatis.
                </div>
              ) : filteredDynamicQueries.length === 0 ? (
                <div className="p-4 text-center text-[11px] opacity-75 space-y-1">
                  <div>
                    {urlInspectorSearch.trim()
                      ? `Tidak ada parameter URL yang cocok dengan "${urlInspectorSearch}".`
                      : 'Tidak ditemukan pola pembacaan parameter URL (URLSearchParams, location.search, new URL, Regex/Helper, Form GET, atau link ?param=val) di XML ini.'}
                  </div>
                  {dynamicQueryScan.manualCheckNotices.length > 0 && (
                    <div className="text-amber-500">
                      Catatan: {dynamicQueryScan.manualCheckNotices.length} pola parameter dinamis perlu dicek manual (lihat bawah).
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {dynamicQueryScan.parameters.length > 0 && (
                    <div
                      className={`px-3 py-2 flex flex-wrap items-center justify-between gap-2 ${
                        isDark ? 'bg-slate-900/80' : 'bg-slate-50'
                      }`}
                    >
                      <span className="text-[11px] font-medium opacity-80">
                        Uji cepat langsung dari Editor XML tanpa mengetik di konsol:
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const qStr = `?${new URLSearchParams(editorParamDrafts).toString()}`;
                            navigator.clipboard?.writeText(qStr).catch(() => {});
                            onNotify('URL Uji gabungan disalin ke clipboard.', 'success');
                          }}
                          className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Copy URL Uji
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const snippet = `const params = new URLSearchParams(${JSON.stringify(
                              editorParamDrafts,
                              null,
                              2
                            )});\nconsole.log('?'.concat(params.toString()));`;
                            navigator.clipboard?.writeText(snippet).catch(() => {});
                            onNotify('Snippet Console JS disalin ke clipboard.', 'success');
                          }}
                          className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Copy Snippet Console JS
                        </button>
                        {onApplyPreviewQueryParams && (
                          <>
                            <button
                              type="button"
                              onClick={() => onApplyPreviewQueryParams(editorParamDrafts, true)}
                              className="px-2.5 py-0.5 text-[11px] font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white cursor-pointer"
                            >
                              Terapkan Semua ke Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => onResetPreviewQueryParams?.()}
                              className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                                isDark
                                  ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              Reset Parameter
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {filteredDynamicQueries.map((param) => {
                    const draftVal = editorParamDrafts[param.name] ?? param.suggestedValue;
                    const singleQueryStr = `?${encodeURIComponent(param.name)}=${encodeURIComponent(
                      draftVal
                    )}`;
                    const singleJsSnippet = `const params = new URLSearchParams('${singleQueryStr}');\nconsole.log('${param.name} =', params.get('${param.name}'));`;

                    return (
                      <div key={param.id} className="px-3 py-2 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span
                              className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded border ${
                                isDark
                                  ? 'bg-teal-950/60 border-teal-800 text-teal-300'
                                  : 'bg-teal-50 border-teal-200 text-teal-800'
                              }`}
                            >
                              {param.name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${
                                isDark
                                  ? 'bg-slate-900 border-slate-700 text-slate-300'
                                  : 'bg-slate-100 border-slate-200 text-slate-700'
                              }`}
                            >
                              {param.primarySourceLabel}
                            </span>
                            <span className="font-mono text-[11px] opacity-80">
                              {singleQueryStr}
                            </span>
                            <span className="font-mono text-[10px] opacity-65">
                              {param.sources[0]?.context}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => scrollToLineAndSelect(param.primaryLine, param.name, 'xml')}
                              className={`px-2 py-0.5 text-[11px] font-mono rounded border flex items-center gap-1 cursor-pointer ${
                                isDark
                                  ? 'bg-slate-900 border-slate-700 text-blue-300 hover:bg-slate-800'
                                  : 'bg-slate-50 border-slate-200 text-blue-700 hover:bg-slate-100'
                              }`}
                            >
                              <span>Baris {param.primaryLine}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(singleQueryStr).catch(() => {});
                                onNotify(`URL uji ${singleQueryStr} disalin.`, 'success');
                              }}
                              className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                                isDark
                                  ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              Copy URL Uji
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(singleJsSnippet).catch(() => {});
                                onNotify(`Snippet JS "${param.name}" disalin.`, 'success');
                              }}
                              className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                                isDark
                                  ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              Copy Snippet Console JS
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
                                className="px-2 py-0.5 text-[11px] font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white cursor-pointer"
                              >
                                Terapkan ke Preview
                              </button>
                            )}
                            {onSendToUrlConsole && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSendToUrlConsole({
                                    payload: singleQueryStr,
                                    kind: 'query-string',
                                    runNow: true,
                                  })
                                }
                                className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                              >
                                Uji Query di Konsol
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {param.candidateValues.length > 0 && (
                            <select
                              aria-label={`Opsi terdeteksi untuk ${param.name}`}
                              value={param.candidateValues.includes(draftVal) ? draftVal : '__custom__'}
                              onChange={(e) => {
                                if (e.target.value !== '__custom__') {
                                  setEditorParamDrafts((prev) => ({
                                    ...prev,
                                    [param.name]: e.target.value,
                                  }));
                                }
                              }}
                              className={`px-2 py-1 text-[11px] font-mono rounded border cursor-pointer ${
                                isDark
                                  ? 'bg-slate-900 border-slate-700 text-slate-100'
                                  : 'bg-slate-50 border-slate-200 text-slate-800'
                              }`}
                            >
                              {param.candidateValues.map((opt) => (
                                <option key={opt} value={opt}>
                                  Opsi: {opt}
                                </option>
                              ))}
                              {!param.candidateValues.includes(draftVal) && (
                                <option value="__custom__">(Kustom)</option>
                              )}
                            </select>
                          )}
                          <input
                            type="text"
                            value={draftVal}
                            onChange={(e) =>
                              setEditorParamDrafts((prev) => ({
                                ...prev,
                                [param.name]: e.target.value,
                              }))
                            }
                            placeholder={`Nilai ${param.name}...`}
                            className={`flex-1 min-w-[140px] px-2 py-1 text-[11px] font-mono rounded border focus:outline-none ${
                              isDark
                                ? 'bg-slate-900 border-slate-700 text-slate-100 focus:border-teal-500'
                                : 'bg-white border-slate-200 text-slate-900 focus:border-teal-600'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {dynamicQueryScan.manualCheckNotices.length > 0 && (
                    <div
                      className={`px-3 py-2 space-y-1 ${
                        isDark ? 'bg-amber-950/30 text-amber-200' : 'bg-amber-50 text-amber-900'
                      }`}
                    >
                      <div className="text-[11px] font-semibold">
                        Perlu Pengecekan Manual ({dynamicQueryScan.manualCheckNotices.length}):
                      </div>
                      {dynamicQueryScan.manualCheckNotices.map((n) => (
                        <div key={n.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate">{n.reason}</span>
                          <button
                            type="button"
                            onClick={() => scrollToLineAndSelect(n.line, undefined, 'xml')}
                            className="font-mono underline shrink-0 cursor-pointer"
                          >
                            Baris {n.line} &rarr;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            ) : urlInspectorFilter === 'url-strings' ? (
              filteredInspectorUrlStrings.length === 0 ? (
                <div className="p-4 text-center text-[11px] opacity-75">
                  {urlInspectorSearch.trim()
                    ? `Tidak ada URL yang cocok dengan "${urlInspectorSearch}".`
                    : 'Tidak ada string URL eksternal atau URL inline yang tertangkap di XML ini.'}
                </div>
              ) : (
                filteredInspectorUrlStrings.map((uItem) => (
                  <div key={uItem.id} className="px-3 py-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                            isDark
                              ? 'bg-sky-950/60 border-sky-800 text-sky-300'
                              : 'bg-sky-50 border-sky-200 text-sky-800'
                          }`}
                        >
                          {uItem.extension ? `.${uItem.extension.toUpperCase()}` : uItem.kind.toUpperCase()}
                        </span>
                        {uItem.isObfuscated && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                              isDark
                                ? 'bg-red-950/60 border-red-800 text-red-300'
                                : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                          >
                            Tersembunyi &middot; {uItem.obfuscationTechnique}
                          </span>
                        )}
                        <span className="font-semibold text-[11px]">{uItem.host}</span>
                        <span className="font-mono text-[10px] opacity-70">{uItem.sourceContext}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => scrollToLineAndSelect(uItem.line, uItem.url, 'xml')}
                          className={`px-2 py-0.5 text-[11px] font-mono rounded border flex items-center gap-1 cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-blue-300 hover:bg-slate-800'
                              : 'bg-slate-50 border-slate-200 text-blue-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>Baris {uItem.line}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(uItem.url).catch(() => {});
                            onNotify('String URL disalin untuk konsol.', 'success');
                          }}
                          className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Salin
                        </button>
                        {onSendToUrlConsole && (
                          <button
                            type="button"
                            onClick={() =>
                              onSendToUrlConsole({
                                payload: uItem.url,
                                kind: 'url-string',
                                runNow: true,
                              })
                            }
                            className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                          >
                            Kirim ke Konsol
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      className={`font-mono text-[11px] break-all select-all ${
                        isDark ? 'text-emerald-300' : 'text-emerald-800'
                      }`}
                    >
                      {uItem.url}
                    </div>
                  </div>
                ))
              )
            ) : urlInspectorFilter === 'javascript' ? (
              filteredInspectorJs.length === 0 ? (
                <div className="p-4 text-center text-[11px] opacity-75">
                  {urlInspectorSearch.trim()
                    ? `Tidak ada blok JavaScript yang cocok dengan "${urlInspectorSearch}".`
                    : 'Tidak ada blok <script> atau handler JavaScript yang terdeteksi di XML ini.'}
                </div>
              ) : (
                filteredInspectorJs.map((jsItem) => (
                  <div key={jsItem.id} className="px-3 py-2 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                            isDark
                              ? 'bg-indigo-950/70 border-indigo-800 text-indigo-300'
                              : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                          }`}
                        >
                          JAVASCRIPT
                        </span>
                        {jsItem.isObfuscated && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                              isDark
                                ? 'bg-red-950/60 border-red-800 text-red-300'
                                : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                          >
                            Encrypted ({jsItem.obfuscationLayers.join(', ')})
                          </span>
                        )}
                        <span className="font-semibold text-[11px] truncate max-w-[260px]">
                          {jsItem.title}
                        </span>
                        <span className="font-mono text-[10px] opacity-70">{jsItem.sourceContext}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => scrollToLineAndSelect(jsItem.line, undefined, 'xml')}
                          className={`px-2 py-0.5 text-[11px] font-mono rounded border flex items-center gap-1 cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-blue-300 hover:bg-slate-800'
                              : 'bg-slate-50 border-slate-200 text-blue-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>Baris {jsItem.line}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(jsItem.code).catch(() => {});
                            onNotify('Kode JavaScript disalin untuk konsol.', 'success');
                          }}
                          className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Salin JS
                        </button>
                        {onSendToUrlConsole && (
                          <button
                            type="button"
                            onClick={() =>
                              onSendToUrlConsole({
                                payload: jsItem.consoleCommand,
                                kind: 'javascript',
                                runNow: true,
                              })
                            }
                            className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                          >
                            Kirim ke Konsol
                          </button>
                        )}
                      </div>
                    </div>

                    {jsItem.embeddedUrls.length > 0 && (
                      <div className="text-[10px] font-mono text-emerald-500 break-all">
                        URL String di dalam JS ({jsItem.embeddedUrls.length}):{' '}
                        {jsItem.embeddedUrls.slice(0, 4).join(' · ')}
                      </div>
                    )}
                    <pre
                      className={`text-[11px] font-mono rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-all select-all ${
                        isDark ? 'bg-slate-900 text-slate-300' : 'bg-slate-50 text-slate-700'
                      }`}
                    >
                      {jsItem.code.slice(0, 360)}
                    </pre>
                  </div>
                ))
              )
            ) : filteredCapturedUrls.length === 0 ? (
              <div className="p-4 text-center text-[11px] opacity-75">
                Tidak ada URL .css, .js, .jss, atau URL terobfuskasi yang cocok pada filter ini.
              </div>
            ) : (
              filteredCapturedUrls.map((asset) => {
                const extBadge = asset.extension
                  ? `.${asset.extension.toUpperCase()}`
                  : `.${asset.kind.toUpperCase()}`;
                return (
                  <div key={asset.id} className="px-3 py-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                            asset.kind === 'css'
                              ? isDark
                                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : asset.extension === 'jss'
                                ? isDark
                                  ? 'bg-amber-950/70 border-amber-700 text-amber-300'
                                  : 'bg-amber-50 border-amber-300 text-amber-900'
                                : isDark
                                  ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                                  : 'bg-blue-50 border-blue-200 text-blue-800'
                          }`}
                        >
                          {extBadge}
                        </span>
                        {asset.isObfuscated && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                              isDark
                                ? 'bg-red-950/60 border-red-800 text-red-300'
                                : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                          >
                            Tersembunyi &middot; {asset.obfuscationTechnique}
                          </span>
                        )}
                        <span className="font-semibold text-[11px]">{asset.host}</span>
                        <span className="font-mono text-[10px] opacity-70">{asset.sourceContext}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            scrollToLineAndSelect(asset.line, asset.rawExpression || asset.rawUrl, 'xml')
                          }
                          className={`px-2 py-0.5 text-[11px] font-mono rounded border flex items-center gap-1 cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-blue-300 hover:bg-slate-800'
                              : 'bg-slate-50 border-slate-200 text-blue-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>Baris {asset.line}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(asset.url).catch(() => {});
                            onNotify(`URL ${extBadge} hasil decode disalin.`, 'success');
                          }}
                          className={`px-2 py-0.5 text-[11px] rounded border cursor-pointer ${
                            isDark
                              ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Salin URL
                        </button>
                        {onSendToUrlConsole && (
                          <button
                            type="button"
                            onClick={() =>
                              onSendToUrlConsole({
                                payload: asset.url,
                                kind: 'url-string',
                                runNow: true,
                              })
                            }
                            className="px-2 py-0.5 text-[11px] font-medium rounded bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                          >
                            Kirim ke Konsol
                          </button>
                        )}
                        {asset.isObfuscated && asset.rawExpression && asset.rawExpression.length < 240 && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextXml = updateSnippetInXml(draftXml, asset.rawExpression!, asset.url);
                              if (nextXml !== draftXml) {
                                setDraftXml(nextXml);
                                onApplyXml(nextXml);
                                onNotify(`URL terobfuskasi di baris ${asset.line} diganti ke URL bersih.`, 'success');
                              }
                            }}
                            className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                          >
                            Ganti ke URL Bersih
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="font-mono text-[11px] break-all select-all text-emerald-400">
                      <span className={isDark ? 'text-emerald-300' : 'text-emerald-800'}>
                        {asset.isObfuscated ? 'Decode: ' : ''}
                        {asset.url}
                      </span>
                    </div>
                    {asset.isObfuscated && asset.rawExpression && (
                      <div className="font-mono text-[10px] opacity-65 truncate">
                        Asli: {asset.rawExpression}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Main Editor Body */}
      <div className="flex-1 p-3 sm:p-4 md:p-5 overflow-y-auto md:overflow-hidden flex flex-col gap-3 sm:gap-4">
        {mode === 'xml' && (
          <>
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
              {showTreeExplorer && layoutTree && (
                <aside
                  className={`w-full lg:w-72 shrink-0 border rounded-lg flex flex-col max-h-64 lg:max-h-none overflow-hidden ${
                    isDark
                      ? 'bg-[#0F172A] border-slate-700 text-slate-200'
                      : 'bg-slate-50/70 border-slate-200 text-slate-800'
                  }`}
                >
                  <div
                    className={`px-3 py-2 border-b flex items-center justify-between gap-2 text-xs ${
                      isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold truncate">
                      <FolderTree className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate">Peta Section &amp; Widget</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {foldedKeys.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setFoldedKeys(new Set())}
                          className="text-[10px] font-medium text-blue-500 hover:underline cursor-pointer"
                        >
                          Buka Lipatan ({foldedKeys.size})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowTreeExplorer(false)}
                        aria-label="Tutup Peta XML"
                        className="p-0.5 opacity-60 hover:opacity-100 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
                    {layoutTree.skinBlock && (
                      <div
                        className={`px-2 py-1.5 rounded flex items-center justify-between gap-1.5 ${
                          isDark ? 'hover:bg-slate-800/70' : 'hover:bg-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            handleJumpFromTree(layoutTree.skinBlock!.startLine, ['skin:b:skin'])
                          }
                          className="flex-1 min-w-0 text-left font-mono text-[11px] font-semibold truncate cursor-pointer"
                        >
                          &lt;b:skin&gt; · Brs {layoutTree.skinBlock.startLine}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleFoldKey('skin:b:skin')}
                          className={`px-1.5 py-0.5 text-[10px] font-mono rounded border cursor-pointer shrink-0 ${
                            foldedKeys.has('skin:b:skin')
                              ? 'bg-blue-600 text-white border-blue-600'
                              : isDark
                                ? 'border-slate-700 text-slate-300'
                                : 'border-slate-200 text-slate-600 bg-white'
                          }`}
                        >
                          {foldedKeys.has('skin:b:skin') ? 'Unfold' : 'Fold'}
                        </button>
                      </div>
                    )}

                    {layoutTree.sections.map((sec) => {
                      const secKey = `section:${sec.id}`;
                      const isSecFolded = foldedKeys.has(secKey);
                      const isExpanded = expandedTreeSections[sec.id] ?? true;

                      return (
                        <div key={sec.id} className="space-y-0.5">
                          <div
                            className={`px-2 py-1.5 rounded flex items-center justify-between gap-1 ${
                              isDark ? 'bg-slate-900/60 hover:bg-slate-800/80' : 'bg-white hover:bg-slate-100/70'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedTreeSections((prev) => ({
                                  ...prev,
                                  [sec.id]: !isExpanded,
                                }))
                              }
                              className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                              aria-label={`Toggle section ${sec.id}`}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleJumpFromTree(sec.startLine, [secKey])}
                              className="flex-1 min-w-0 text-left truncate cursor-pointer"
                            >
                              <span className="font-mono text-[11px] font-semibold">
                                #{sec.id}
                              </span>
                              <span className="ml-1.5 text-[10px] opacity-65 tabular-nums">
                                ({sec.widgets.length}) · Brs {sec.startLine}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleFoldKey(secKey)}
                              className={`px-1.5 py-0.5 text-[10px] font-mono rounded border cursor-pointer shrink-0 ${
                                isSecFolded
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : isDark
                                    ? 'border-slate-700 text-slate-300'
                                    : 'border-slate-200 text-slate-600 bg-white'
                              }`}
                            >
                              {isSecFolded ? 'Unfold' : 'Fold'}
                            </button>
                          </div>

                          {isExpanded && sec.widgets.length > 0 && (
                            <div className="pl-4 space-y-0.5">
                              {sec.widgets.map((w) => {
                                const wKey = `widget:${w.id}`;
                                const isWFolded = foldedKeys.has(wKey);
                                const isLocked = w.locked === 'true';
                                return (
                                  <div
                                    key={w.id}
                                    className={`px-2 py-1 rounded flex items-center justify-between gap-1 text-[11px] ${
                                      isDark ? 'hover:bg-slate-800/60' : 'hover:bg-white'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleJumpFromTree(w.startLine, [secKey, wKey])}
                                      className="flex-1 min-w-0 text-left truncate cursor-pointer"
                                      title={`${w.type}${w.title ? ` — ${w.title}` : ''} (Baris ${w.startLine})`}
                                    >
                                      <span className="font-mono font-medium">{w.id}</span>
                                      <span className="ml-1 text-[10px] opacity-65">
                                        {w.type}
                                      </span>
                                    </button>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        title={isLocked ? 'Unlock widget' : 'Lock widget'}
                                        onClick={() => {
                                          const nextLocked = isLocked ? 'false' : 'true';
                                          const nextXml = updateWidgetAttrInXml(
                                            draftXml,
                                            w.id,
                                            'locked',
                                            nextLocked
                                          );
                                          setDraftXml(nextXml);
                                          onApplyXml(nextXml);
                                          onNotify(
                                            `Widget ${w.id} locked=${nextLocked}.`,
                                            'success'
                                          );
                                        }}
                                        className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                                      >
                                        {isLocked ? (
                                          <Lock className="w-3 h-3 text-amber-500" />
                                        ) : (
                                          <Unlock className="w-3 h-3 opacity-60" />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleFoldKey(wKey)}
                                        className={`px-1.5 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                                          isWFolded
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : isDark
                                              ? 'border-slate-700 text-slate-300'
                                              : 'border-slate-200 text-slate-600 bg-white'
                                        }`}
                                      >
                                        {isWFolded ? 'Unfold' : 'Fold'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </aside>
              )}

              <NumberedCodeEditor
                value={foldedView ? foldedView.displayText : draftXml}
                onChange={(nextDisplayText) => {
                  const canonical = foldedView
                    ? unfoldEditorText(nextDisplayText, foldedView.placeholderToOriginal)
                    : nextDisplayText;
                  setDraftXml(canonical);
                }}
                editorTheme={editorTheme}
                issues={validation.issues}
                textareaRef={xmlTextareaRef}
                ariaLabel="Editor Kode XML Blogger"
                activeLine={cursorLine}
                activeCol={cursorCol}
                searchQuery={codeSearchQuery}
                searchCaseSensitive={codeSearchCaseSensitive}
                activeMatch={activeMatch}
                onCursorUpdate={(l, c) => {
                  setCursorLine(l);
                  setCursorCol(c);
                }}
              />
            </div>

            {/* Offline Syntax Diagnostics & Auto-Fix Panel */}
            {showDiagnostics && (
              <div
                className={`border rounded-lg max-h-[240px] flex flex-col overflow-hidden shrink-0 ${
                  isDark ? 'bg-[#0F172A] border-slate-700' : 'bg-white border-slate-200'
                }`}
              >
                <div
                  className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 ${
                    isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 text-xs font-semibold ${
                      isDark ? 'text-slate-100' : 'text-slate-800'
                    }`}
                  >
                    <FileWarning className="w-4 h-4 text-slate-400" />
                    <span>Pemeriksaan Sintaks &amp; Penyorot Kode Error (Offline)</span>
                    <span className="text-slate-400 font-normal tabular-nums">
                      ({validation.issues.length} temuan &middot; klik baris untuk sorot kode)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {validation.issues.length > 0 && (
                      <button
                        type="button"
                        onClick={handleAutoFixOffline}
                        className="px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer"
                      >
                        Perbaiki Semua Otomatis
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowDiagnostics(false)}
                      className={`text-xs cursor-pointer ${
                        isDark
                          ? 'text-slate-400 hover:text-white'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Tutup
                    </button>
                  </div>
                </div>

                <div
                  className={`overflow-y-auto divide-y text-xs ${
                    isDark ? 'divide-slate-800' : 'divide-slate-100'
                  }`}
                >
                  {lastFixesApplied.length > 0 && (
                    <div
                      className={`px-4 py-2.5 space-y-1 ${
                        isDark
                          ? 'bg-emerald-950/60 text-emerald-200'
                          : 'bg-emerald-50/70 text-emerald-900'
                      }`}
                    >
                      <div className="font-semibold text-[11px]">
                        Perbaikan Auto-Fix Worker Diterapkan
                        {lastAutoFixResult
                          ? ` (${lastAutoFixResult.roundsExecuted} putaran · ${lastAutoFixResult.durationMs} md · ${lastAutoFixResult.domParserValid ? 'DOMParser Valid' : 'Butuh Tinjauan'})`
                          : ''}
                        :
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                        {lastFixesApplied.map((fix, idx) => (
                          <li key={idx}>{fix}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validation.issues.length === 0 ? (
                    <div
                      className={`px-4 py-4 flex items-center gap-2 ${
                        isDark ? 'text-emerald-300' : 'text-emerald-800'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Struktur XML Blogger valid: tidak ditemukan karakter &amp; tak ter-escape, tag terbuka, atau blok CDATA yang rusak.
                      </span>
                    </div>
                  ) : (
                    validation.issues.map((issue, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => scrollToLineAndSelect(issue.line, issue.snippet)}
                        className={`w-full text-left px-4 py-2.5 flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                          isDark ? 'hover:bg-slate-800/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span
                            className={`font-mono tabular-nums text-[11px] shrink-0 pt-0.5 ${
                              isDark ? 'text-slate-400' : 'text-slate-500'
                            }`}
                          >
                            Baris {issue.line}
                          </span>
                          <span
                            className={`text-[11px] font-semibold shrink-0 pt-0.5 ${
                              issue.severity === 'error'
                                ? isDark
                                  ? 'text-red-400'
                                  : 'text-red-700'
                                : isDark
                                  ? 'text-amber-400'
                                  : 'text-amber-700'
                            }`}
                          >
                            {issue.severity === 'error' ? 'Error' : 'Peringatan'}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div
                              className={`leading-relaxed ${
                                isDark ? 'text-slate-200' : 'text-slate-700'
                              }`}
                            >
                              {issue.message}
                            </div>
                            {issue.snippet && (
                              <code
                                className={`inline-block font-mono text-[11px] px-1.5 py-0.5 rounded max-w-full truncate ${
                                  isDark
                                    ? 'bg-red-950/80 text-red-300 border border-red-900'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                }`}
                              >
                                {issue.snippet}
                              </code>
                            )}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-medium shrink-0 pt-0.5 ${
                            isDark ? 'text-blue-400' : 'text-blue-600'
                          }`}
                        >
                          Sorot &rarr;
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'css' && (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Setiap aturan CSS di bawah ini diterapkan secara real-time ke pratinjau dan otomatis disisipkan ke dalam blok{' '}
              <span className={`font-mono ${isDark ? 'text-white' : 'text-slate-800'}`}>
                &lt;b:skin&gt;
              </span>{' '}
              saat Anda mengekspor tema.
            </p>
            <NumberedCodeEditor
              value={customCss}
              onChange={onCustomCssChange}
              editorTheme={editorTheme}
              textareaRef={cssTextareaRef}
              ariaLabel="Editor CSS Kustom"
              placeholder="/* Tulis CSS kustom Anda di sini, misalnya:&#10;.post-title { letter-spacing: -0.02em; }&#10;.jump-link a { border-radius: 999px; }&#10;*/"
              activeLine={cursorLine}
              activeCol={cursorCol}
              searchQuery={codeSearchQuery}
              searchCaseSensitive={codeSearchCaseSensitive}
              activeMatch={activeMatch}
              onCursorUpdate={(l, c) => {
                setCursorLine(l);
                setCursorCol(c);
              }}
            />
          </div>
        )}

        {mode === 'html-js-css' && (
          <HtmlJsCssViewerPanel
            xml={draftXml}
            templateTitle={parsedInfo.templateTitle}
            isDark={isDark}
            onJumpToLine={(line, snippet) => scrollToLineAndSelect(line, snippet, 'xml')}
            onReplaceSnippetInXml={(oldSnippet, newSnippet, feedbackMsg) => {
              const nextXml = updateSnippetInXml(draftXml, oldSnippet, newSnippet);
              if (nextXml !== draftXml) {
                setDraftXml(nextXml);
                onApplyXml(nextXml);
                onNotify(feedbackMsg, 'success');
              }
            }}
          />
        )}

        {mode === 'converter' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* Converter Action Bar */}
            <div
              className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
                isDark ? 'border-slate-800' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => runConverterAction('escape')}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                >
                  HTML Escape
                </button>
                <button
                  type="button"
                  onClick={() => runConverterAction('unescape')}
                  className={`px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
                  }`}
                >
                  HTML Unescape
                </button>

                <span
                  className={`h-4 w-px mx-1 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}
                  aria-hidden="true"
                />

                {(
                  [
                    ['cdata-xml', '<![CDATA[ ... ]]>', 'xml'],
                    ['cdata-css', '/*<![CDATA[*/ ... /*]]>*/', 'css-js'],
                    ['cdata-slash', '//<![CDATA[ ... //]]>', 'slash'],
                  ] as Array<['cdata-xml' | 'cdata-css' | 'cdata-slash', string, CdataStyle]>
                ).map(([act, label]) => (
                  <button
                    key={act}
                    type="button"
                    onClick={() => runConverterAction(act)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors cursor-pointer ${
                      isDark
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => runConverterAction('unwrap-cdata')}
                  className={`px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  Lepas CDATA
                </button>
              </div>

              <label
                className={`flex items-center gap-2 text-xs cursor-pointer ${
                  isDark ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={preserveEntities}
                  onChange={(e) => setPreserveEntities(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Hindari double-escape &amp;amp;</span>
              </label>
            </div>

            {/* Two-Column Input / Output Workbench */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
              <div className="flex flex-col gap-2 min-h-0">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`font-semibold flex items-center gap-1.5 ${
                      isDark ? 'text-slate-200' : 'text-slate-800'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>Input Kode / Snippet (Offline)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSnippetInput('');
                      setSnippetOutput('');
                    }}
                    className={`text-[11px] cursor-pointer ${
                      isDark
                        ? 'text-slate-400 hover:text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Bersihkan
                  </button>
                </div>
                <textarea
                  value={snippetInput}
                  onChange={(e) => setSnippetInput(e.target.value)}
                  spellCheck={false}
                  placeholder="Tempel kode HTML, script AdSense, URL berparameter '&', atau kode XML di sini..."
                  className={`w-full flex-1 p-4 font-mono text-xs leading-relaxed border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 ${
                    isDark
                      ? 'bg-[#0F172A] border-slate-700 text-slate-100 placeholder:text-slate-500'
                      : 'bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400'
                  }`}
                />
              </div>

              <div className="flex flex-col gap-2 min-h-0">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`font-semibold ${
                      isDark ? 'text-slate-200' : 'text-slate-800'
                    }`}
                  >
                    Hasil Transformasi Siap Pakai
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopySnippetResult}
                      disabled={!snippetOutput}
                      className={`flex items-center gap-1 text-[11px] font-medium disabled:opacity-40 cursor-pointer ${
                        isDark
                          ? 'text-slate-300 hover:text-white'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      {copiedSnippet ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedSnippet ? 'Tersalin' : 'Salin Hasil'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleInsertToXmlEditor}
                      disabled={!snippetOutput}
                      className={`flex items-center gap-1 text-[11px] font-medium disabled:opacity-40 cursor-pointer ${
                        isDark
                          ? 'text-blue-400 hover:text-blue-300'
                          : 'text-blue-600 hover:text-blue-700'
                      }`}
                    >
                      <span>Sisipkan ke Editor XML</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly
                  value={snippetOutput}
                  placeholder="Klik salah satu tombol di atas (HTML Escape, HTML Unescape, atau CDATA) untuk melihat hasil instan secara offline."
                  className={`w-full flex-1 p-4 font-mono text-xs leading-relaxed border rounded-lg resize-none focus:outline-none ${
                    isDark
                      ? 'bg-[#0F172A] border-slate-700 text-slate-100 placeholder:text-slate-500'
                      : 'bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400'
                  }`}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <TemplateIdentityModal
        isOpen={identityModalOpen}
        xml={draftXml}
        isDark={isDark}
        onClose={() => setIdentityModalOpen(false)}
        onSaveXml={(nextXml, id) => {
          const finalXml = preserveLineEndings(nextXml);
          setDraftXml(finalXml);
          onApplyXml(finalXml);
          onNotify(
            `Identitas template "${id.name || parsedInfo.templateTitle}"${id.version ? ` v${id.version}` : ''} disimpan ke XML.`,
            'success'
          );
        }}
      />
    </div>
  );
};
