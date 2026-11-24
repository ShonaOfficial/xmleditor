import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Monitor,
  Laptop,
  Tablet,
  Smartphone,
  RotateCw,
  RotateCcw,
  Columns2,
  Globe,
  Code2,
  FileUp,
  SlidersHorizontal,
  Play,
  Copy,
  Check,
  AlertTriangle,
  X,
} from 'lucide-react';
import type { DevicePreset, ParsedTemplateInfo, PreviewPageType } from '../types/blogger';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';
import { scanDynamicQueryParametersInXml } from '../lib/scriptAndCodeInspector';

export type PreviewVisualMode = 'xml' | 'user-site' | 'split';

interface PreviewCanvasProps {
  compiledHtml: string;
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  onApplySuggestedCss?: (css: string) => void;
  userBlogVisualHtml: string | null;
  userBlogVisualUrl: string | null;
  visualMode: PreviewVisualMode;
  onVisualModeChange: (mode: PreviewVisualMode) => void;
  onClearUserBlogVisual: () => void;
  device: DevicePreset;
  onDeviceChange: (device: DevicePreset) => void;
  isLandscape: boolean;
  onToggleLandscape: () => void;
  pageType: PreviewPageType;
  onPageTypeChange: (pageType: PreviewPageType) => void;
  activeCategory: string | null;
  onClearCategory: () => void;
  zoom: 'fit' | 1 | 0.75;
  onZoomChange: (zoom: 'fit' | 1 | 0.75) => void;
  hasCustomizations: boolean;
  onResetCustomizations: () => void;
  isOfflineMode?: boolean;
  activePresetId?: string | null;
  sourceLabel?: string;
  onLoadXmlContent?: (
    xml: string,
    label: string,
    presetId?: string | null,
    originalBytes?: number | null
  ) => void;
  previewQueryParams?: Record<string, string>;
  onApplyPreviewQueryParams?: (nextParams: Record<string, string>, openPreview?: boolean) => void;
  onResetPreviewQueryParams?: () => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const DEVICE_DIMENSIONS: Record<DevicePreset, { width: number; height: number; label: string }> = {
  desktop: { width: 1280, height: 800, label: 'Desktop' },
  laptop: { width: 1024, height: 700, label: 'Laptop' },
  tablet: { width: 768, height: 1024, label: 'Tablet' },
  mobile: { width: 375, height: 720, label: 'Ponsel' },
};

function getSafeDisplayUrl(url: string | null): string {
  if (!url) return 'pratinjau-lokal.blogspot.com';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  compiledHtml,
  xml,
  parsedInfo,
  offlineAi,
  onApplySuggestedCss,
  userBlogVisualHtml,
  userBlogVisualUrl,
  visualMode,
  onVisualModeChange,
  onClearUserBlogVisual,
  device,
  onDeviceChange,
  isLandscape,
  onToggleLandscape,
  pageType,
  onPageTypeChange,
  activeCategory,
  onClearCategory,
  zoom,
  onZoomChange,
  hasCustomizations,
  onResetCustomizations,
  isOfflineMode = false,
  activePresetId,
  sourceLabel,
  onLoadXmlContent,
  previewQueryParams = {},
  onApplyPreviewQueryParams,
  onResetPreviewQueryParams,
  onNotify,
}) => {
  const previewXmlInputRef = useRef<HTMLInputElement>(null);
  const [showQuickParamBar, setShowQuickParamBar] = useState(false);
  const [copiedQuickId, setCopiedQuickId] = useState<string | null>(null);

  const dynamicQueryScan = useMemo(() => scanDynamicQueryParametersInXml(xml), [xml]);
  const [quickParamDraft, setQuickParamDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const nextDraft: Record<string, string> = {};
    for (const p of dynamicQueryScan.parameters) {
      nextDraft[p.name] =
        p.name in previewQueryParams ? previewQueryParams[p.name] : p.suggestedValue;
    }
    for (const [k, v] of Object.entries(previewQueryParams)) {
      if (!(k in nextDraft)) nextDraft[k] = v;
    }
    setQuickParamDraft(nextDraft);
  }, [dynamicQueryScan.parameters, previewQueryParams]);

  const activeQueryString = useMemo(() => {
    const entries = Object.entries(previewQueryParams).filter(([k]) => k.trim().length > 0);
    return entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
  }, [previewQueryParams]);

  const activeQueryCount = Object.keys(previewQueryParams).length;

  const copyQuickText = (text: string, id: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedQuickId(id);
        setTimeout(() => setCopiedQuickId((prev) => (prev === id ? null : prev)), 1500);
        onNotify?.(`${label} disalin ke clipboard.`, 'success');
      });
    }
  };

  const handleQuickXmlUpload = (file: File) => {
    if (!onLoadXmlContent) return;
    if (!file.name.toLowerCase().endsWith('.xml')) {
      onNotify?.('Harap pilih file template Blogger berekstensi .xml yang valid.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) {
        onNotify?.('File XML kosong atau tidak dapat dibaca.', 'error');
        return;
      }
      onLoadXmlContent(content, `File: ${file.name}`, null, file.size);
      onNotify?.(
        `File ${file.name} (${(file.size / 1024).toFixed(1)} KB) dimuat ke Pratinjau & Inspektor.`,
        'success'
      );
    };
    reader.onerror = () => {
      onNotify?.('Gagal membaca file dari perangkat Anda.', 'error');
    };
    reader.readAsText(file);
  };

  const baseDim = DEVICE_DIMENSIONS[device];
  const canRotate = device === 'tablet' || device === 'mobile';
  const targetWidth = canRotate && isLandscape ? baseDim.height : baseDim.width;
  const targetHeight = canRotate && isLandscape ? baseDim.width : baseDim.height;

  const hasUserVisual = Boolean(userBlogVisualHtml);
  const effectiveVisualMode: PreviewVisualMode = hasUserVisual ? visualMode : 'xml';

  const effectiveUserVisualHtml =
    userBlogVisualHtml && isOfflineMode
      ? userBlogVisualHtml.replace(
          /<head([^>]*)>/i,
          `<head$1><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: 'unsafe-inline'; img-src * data: blob:; style-src 'unsafe-inline' data: blob:; font-src 'self' data: blob:; connect-src 'none';" />`
        )
      : userBlogVisualHtml;

  const deviceButtons: Array<{ id: DevicePreset; label: string; icon: React.ReactNode }> = [
    { id: 'desktop', label: 'Desktop', icon: <Monitor className="w-3.5 h-3.5" /> },
    { id: 'laptop', label: 'Laptop', icon: <Laptop className="w-3.5 h-3.5" /> },
    { id: 'tablet', label: 'Tablet', icon: <Tablet className="w-3.5 h-3.5" /> },
    { id: 'mobile', label: 'Ponsel', icon: <Smartphone className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-100/80 overflow-hidden">
      {/* Unified Offline AI Runtime Bar */}
      <OfflineAiRuntimeBar
        controller={offlineAi}
        page="preview"
        xml={xml}
        parsedInfo={parsedInfo}
        onApplySuggestedCss={onApplySuggestedCss}
        compact
      />

      {/* Workspace Canvas Toolbar */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        {/* Device Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {deviceButtons.map((btn) => {
              const active = device === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onDeviceChange(btn.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {btn.icon}
                  <span className="hidden sm:inline">{btn.label}</span>
                </button>
              );
            })}
          </div>

          {canRotate && (
            <button
              type="button"
              onClick={onToggleLandscape}
              title="Putar Orientasi Perangkat"
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          )}

          <span className="hidden xl:inline text-xs font-mono tabular-nums text-slate-500 pl-1">
            {device === 'desktop' ? 'Lebar penuh' : `${targetWidth} × ${targetHeight} px`}
          </span>

          {/* Visual Mode Switcher when user entered a live URL */}
          {hasUserVisual && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => onVisualModeChange('xml')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveVisualMode === 'xml'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Pratinjau XML</span>
              </button>
              <button
                type="button"
                onClick={() => onVisualModeChange('user-site')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveVisualMode === 'user-site'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Halaman URL Asli</span>
              </button>
              <button
                type="button"
                onClick={() => onVisualModeChange('split')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveVisualMode === 'split'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>Bandingkan</span>
              </button>
              <button
                type="button"
                onClick={onClearUserBlogVisual}
                title="Tutup iframe halaman URL pengguna"
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Page View & Zoom Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {activeCategory && effectiveVisualMode !== 'user-site' && (
            <button
              type="button"
              onClick={onClearCategory}
              className="text-xs text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Filter: {activeCategory} &times;
            </button>
          )}

          {effectiveVisualMode !== 'user-site' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['index', 'Beranda'],
                  ['item', 'Artikel'],
                  ['archive', 'Arsip'],
                ] as Array<[PreviewPageType, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPageTypeChange(id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    pageType === id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <select
            aria-label="Skala Pratinjau"
            value={String(zoom)}
            onChange={(e) => {
              const val = e.target.value;
              onZoomChange(val === 'fit' ? 'fit' : (Number(val) as 1 | 0.75));
            }}
            className="px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
          >
            <option value="fit">Otomatis</option>
            <option value="1">100%</option>
            <option value="0.75">75%</option>
          </select>

          {onLoadXmlContent && (
            <>
              <input
                ref={previewXmlInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleQuickXmlUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => previewXmlInputRef.current?.click()}
                title={
                  activePresetId === null && sourceLabel
                    ? `Sumber aktif: ${sourceLabel} (Klik untuk ganti file .xml)`
                    : 'Unggah template .xml dari perangkat (langsung terbaca di Pratinjau & Deteksi AI)'
                }
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activePresetId !== null
                    ? 'text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200'
                    : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-200'
                }`}
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>{activePresetId !== null ? 'Unggah .xml' : 'Ganti .xml'}</span>
              </button>
            </>
          )}

          {onApplyPreviewQueryParams && (
            <button
              type="button"
              onClick={() => setShowQuickParamBar((v) => !v)}
              title="Uji cepat parameter & query string hasil deteksi otomatis dari XML langsung ke Pratinjau"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                showQuickParamBar || activeQueryCount > 0
                  ? 'text-teal-900 bg-teal-50 hover:bg-teal-100 border-teal-300'
                  : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-teal-600" />
              <span>
                Parameter URL ({dynamicQueryScan.parameters.length}
                {activeQueryCount > 0 ? ` · ${activeQueryCount} aktif` : ''})
              </span>
            </button>
          )}

          {hasCustomizations && (
            <button
              type="button"
              onClick={onResetCustomizations}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Gaya</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Dynamic Parameter Tester Drawer in Preview */}
      {showQuickParamBar && onApplyPreviewQueryParams && (
        <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-3 space-y-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-900 flex flex-wrap items-center gap-2">
                <span>Uji Cepat Parameter URL Dinamis pada Pratinjau</span>
                {activeQueryString && (
                  <span className="px-2 py-0.5 text-[11px] font-mono bg-teal-50 text-teal-800 border border-teal-200 rounded">
                    Aktif: {activeQueryString}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Terdeteksi otomatis dari XML (<span className="font-mono">URLSearchParams</span>,{' '}
                <span className="font-mono">location.search</span>,{' '}
                <span className="font-mono">new URL</span>, Form GET, &amp; atribut link). Pilih/ubah nilai lalu terapkan tanpa mengetik di konsol.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {dynamicQueryScan.parameters.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const qStr = `?${new URLSearchParams(quickParamDraft).toString()}`;
                      copyQuickText(qStr, 'pv-copy-all-url', 'URL Uji Gabungan');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                  >
                    {copiedQuickId === 'pv-copy-all-url' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>Copy URL Uji</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const entries = Object.entries(quickParamDraft).filter(([k]) => k.trim());
                      const qStr = entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '?';
                      const snippet = `const params = new URLSearchParams('${qStr}');\nconsole.log(Object.fromEntries(params.entries()));`;
                      copyQuickText(snippet, 'pv-copy-all-js', 'Snippet Console JS');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                  >
                    {copiedQuickId === 'pv-copy-all-js' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>Copy Snippet Console JS</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onApplyPreviewQueryParams(quickParamDraft, false)}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Terapkan ke Preview</span>
                  </button>
                </>
              )}
              {(activeQueryCount > 0 || dynamicQueryScan.parameters.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    onResetPreviewQueryParams?.();
                    const resetDraft: Record<string, string> = {};
                    for (const p of dynamicQueryScan.parameters) {
                      resetDraft[p.name] = p.suggestedValue;
                    }
                    setQuickParamDraft(resetDraft);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Parameter</span>
                </button>
              )}
            </div>
          </div>

          {dynamicQueryScan.xmlEmpty ? (
            <div className="p-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
              Kode XML masih kosong. Muat atau unggah template .xml terlebih dahulu untuk memindai parameter URL secara otomatis.
            </div>
          ) : dynamicQueryScan.parameters.length === 0 ? (
            <div className="p-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-600">
              Tidak ditemukan pola pembacaan parameter URL (<span className="font-mono">URLSearchParams</span>,{' '}
              <span className="font-mono">location.search</span>, <span className="font-mono">new URL</span>, Form GET, atau link <span className="font-mono">?param=nilai</span>) pada template XML aktif.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {dynamicQueryScan.parameters.map((param) => {
                const currentVal = quickParamDraft[param.name] ?? '';
                const hasCandidates = param.candidateValues.length > 0;
                return (
                  <div
                    key={param.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-mono font-bold text-slate-900 truncate">
                          {param.name}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-white border border-slate-200 rounded text-slate-600 truncate">
                          {param.primarySourceLabel}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        Baris {param.primaryLine}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {hasCandidates && (
                        <select
                          aria-label={`Opsi terdeteksi untuk ${param.name}`}
                          value={param.candidateValues.includes(currentVal) ? currentVal : '__custom__'}
                          onChange={(e) => {
                            if (e.target.value !== '__custom__') {
                              setQuickParamDraft((prev) => ({ ...prev, [param.name]: e.target.value }));
                            }
                          }}
                          className="max-w-[125px] px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-600 cursor-pointer"
                        >
                          {param.candidateValues.map((optVal) => (
                            <option key={optVal} value={optVal}>
                              {optVal}
                            </option>
                          ))}
                          {!param.candidateValues.includes(currentVal) && (
                            <option value="__custom__">(Kustom)</option>
                          )}
                        </select>
                      )}
                      <input
                        type="text"
                        value={currentVal}
                        onChange={(e) =>
                          setQuickParamDraft((prev) => ({ ...prev, [param.name]: e.target.value }))
                        }
                        placeholder="Nilai parameter..."
                        className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-teal-600"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onApplyPreviewQueryParams(
                            { ...previewQueryParams, [param.name]: currentVal },
                            false
                          )
                        }
                        className="px-2 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded cursor-pointer shrink-0"
                        title={`Terapkan ?${param.name}=${currentVal} ke Preview`}
                      >
                        Uji
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {dynamicQueryScan.manualCheckNotices.length > 0 && (
            <div className="px-2.5 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-700" />
              <div className="space-y-0.5">
                <div className="font-semibold">
                  {dynamicQueryScan.manualCheckNotices.length} pola parameter dinamis perlu pengecekan manual:
                </div>
                <div>
                  {dynamicQueryScan.manualCheckNotices
                    .slice(0, 2)
                    .map((n) => `Baris ${n.line}: ${n.reason}`)
                    .join(' · ')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview Viewport Stage */}
      <div className="flex-1 overflow-auto p-2.5 sm:p-4 md:p-6">
        {effectiveVisualMode === 'split' && effectiveUserVisualHtml ? (
          <div className="w-full h-full min-h-[480px] sm:min-h-[560px] grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {/* Left: Active XML Template Preview (Strict Sandbox Isolation) */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col min-h-[380px] sm:min-h-[420px]">
              <div className="h-8 bg-slate-50 border-b border-slate-200 px-3 flex items-center justify-between shrink-0 gap-2">
                <span className="text-[11px] font-semibold text-slate-800 whitespace-nowrap">
                  Pratinjau Template XML Aktif
                </span>
                <span className="text-[11px] font-mono text-slate-400 truncate max-w-[220px]">
                  {isOfflineMode ? 'Offline · Terisolasi' : 'Online · Terisolasi'}
                </span>
              </div>
              <iframe
                title="Pratinjau Template Blogspot"
                srcDoc={compiledHtml}
                sandbox="allow-scripts allow-forms"
                className="w-full flex-1 border-0 bg-white"
              />
            </div>

            {/* Right: User-Entered Live URL Visual Iframe (Opaque Sandbox Isolation) */}
            <div className="bg-white border border-blue-200 shadow-sm rounded-xl overflow-hidden flex flex-col min-h-[380px] sm:min-h-[420px]">
              <div className="h-8 bg-blue-50/70 border-b border-blue-200 px-3 flex items-center justify-between shrink-0 gap-2">
                <span className="text-[11px] font-semibold text-blue-900 whitespace-nowrap">
                  {isOfflineMode
                    ? 'Visual URL · Cache Offline Lokal'
                    : 'Visual URL Pengguna · Online Terisolasi'}
                </span>
                <span className="text-[11px] font-mono text-blue-700 truncate max-w-[220px]">
                  {getSafeDisplayUrl(userBlogVisualUrl)}
                </span>
              </div>
              <iframe
                title="Visual Halaman URL Blogspot Pengguna"
                srcDoc={effectiveUserVisualHtml}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full flex-1 border-0 bg-white"
              />
            </div>
          </div>
        ) : zoom === 0.75 ? (
          <div
            className="mx-auto relative overflow-hidden bg-white border border-slate-200 shadow-sm rounded-xl"
            style={
              device === 'desktop'
                ? { width: '100%', height: '100%', minHeight: '460px' }
                : {
                    width: `${Math.round(targetWidth * 0.75)}px`,
                    height: `${Math.round(targetHeight * 0.75)}px`,
                  }
            }
          >
            <div
              className="bg-white flex flex-col"
              style={
                device === 'desktop'
                  ? {
                      width: '133.3333%',
                      height: '133.3333%',
                      transform: 'scale(0.75)',
                      transformOrigin: 'top left',
                    }
                  : {
                      width: `${targetWidth}px`,
                      height: `${targetHeight}px`,
                      transform: 'scale(0.75)',
                      transformOrigin: 'top left',
                    }
              }
            >
              {/* Minimal Browser Frame Chrome */}
              <div className="h-8 bg-slate-50 border-b border-slate-200 px-3 flex items-center justify-between shrink-0 gap-2">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate max-w-[360px]">
                  {effectiveVisualMode === 'user-site'
                    ? `${getSafeDisplayUrl(userBlogVisualUrl)} · ${
                        isOfflineMode ? 'Cache Offline' : 'Online Terisolasi'
                      }`
                    : `pratinjau-lokal.blogspot.com${pageType === 'item' ? '/2026/11/artikel.html' : ''}${activeQueryString}`}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                  {isOfflineMode ? 'Offline' : 'Online'} &middot; 75%
                </div>
              </div>

              {effectiveVisualMode === 'user-site' && effectiveUserVisualHtml ? (
                <iframe
                  title="Visual Halaman URL Blogspot Pengguna"
                  srcDoc={effectiveUserVisualHtml}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full flex-1 border-0 bg-white"
                />
              ) : (
                <iframe
                  title="Pratinjau Template Blogspot"
                  srcDoc={compiledHtml}
                  sandbox="allow-scripts allow-forms"
                  className="w-full flex-1 border-0 bg-white"
                />
              )}
            </div>
          </div>
        ) : (
          <div
            className="mx-auto bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col transition-all duration-200"
            style={
              device === 'desktop' && zoom === 'fit'
                ? { width: '100%', height: '100%', minHeight: '460px' }
                : {
                    width: `${targetWidth}px`,
                    maxWidth: zoom === 'fit' ? '100%' : undefined,
                    height: device === 'desktop' ? '100%' : `${targetHeight}px`,
                    minHeight: device === 'desktop' ? '460px' : undefined,
                  }
            }
          >
            {/* Minimal Browser Frame Chrome */}
            <div className="h-8 bg-slate-50 border-b border-slate-200 px-3 flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
              </div>
              <div className="text-[11px] font-mono text-slate-500 truncate max-w-[360px]">
                {effectiveVisualMode === 'user-site'
                  ? `${getSafeDisplayUrl(userBlogVisualUrl)} · ${
                      isOfflineMode ? 'Cache Offline' : 'Online Terisolasi'
                    }`
                  : `pratinjau-lokal.blogspot.com${pageType === 'item' ? '/2026/11/artikel.html' : ''}${activeQueryString}`}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                {isOfflineMode ? 'Offline' : 'Online'} &middot;{' '}
                {device === 'desktop' ? '100%' : `${targetWidth}px`}
              </div>
            </div>

            {effectiveVisualMode === 'user-site' && effectiveUserVisualHtml ? (
              <iframe
                title="Visual Halaman URL Blogspot Pengguna"
                srcDoc={effectiveUserVisualHtml}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full flex-1 border-0 bg-white"
              />
            ) : (
              <iframe
                title="Pratinjau Template Blogspot"
                srcDoc={compiledHtml}
                sandbox="allow-scripts allow-forms"
                className="w-full flex-1 border-0 bg-white"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
