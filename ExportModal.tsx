import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Info, Share2, X } from 'lucide-react';
import type {
  FontCustomization,
  ParsedTemplateInfo,
  ThemePaletteOverrides,
} from '../types/blogger';
import {
  canShareXmlFile,
  downloadXmlFile,
  exportModifiedBloggerXml,
  shareXmlFileViaNavigator,
} from '../lib/bloggerCompiler';
import { AdsenseSlotRenderer } from './AdsenseSlotRenderer';
import type { SiteAdsenseConfig } from '../types/adsense';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  xml: string;
  initialUploadBytes: number | null;
  parsedInfo: ParsedTemplateInfo;
  variableValues: Record<string, string>;
  cssVarValues: Record<string, string>;
  colorReplacements: Record<string, string>;
  colors: ThemePaletteOverrides;
  fonts: FontCustomization;
  customCss: string;
  onOverwriteWholeXml?: (bakedXml: string, downloadAfter?: boolean) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
  siteAdsense?: {
    config: SiteAdsenseConfig;
    shouldRenderLiveAds: boolean;
    isAdmin: boolean;
  };
}

function formatByteDelta(delta: number): string {
  if (delta === 0) return '0 B (Identik)';
  const sign = delta > 0 ? '+' : '-';
  const abs = Math.abs(delta);
  if (abs < 1024) return `${sign}${abs} B`;
  return `${sign}${(abs / 1024).toFixed(2)} KB (${sign}${abs.toLocaleString('id-ID')} B)`;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  xml,
  initialUploadBytes,
  parsedInfo,
  variableValues,
  cssVarValues,
  colorReplacements,
  colors,
  fonts,
  customCss,
  onOverwriteWholeXml,
  onNotify,
  siteAdsense,
}) => {
  const [activeTab, setActiveTab] = useState<'xml' | 'css'>('xml');
  const [minimalExport, setMinimalExport] = useState(false);
  const [copied, setCopied] = useState(false);

  const exportResult = useMemo(() => {
    if (!isOpen) return null;
    return exportModifiedBloggerXml(xml, variableValues, colors, fonts, customCss, {
      cssVarValues,
      colorReplacements,
      minimalExport,
      initialUploadBytes,
    });
  }, [
    isOpen,
    xml,
    variableValues,
    cssVarValues,
    colorReplacements,
    colors,
    fonts,
    customCss,
    minimalExport,
    initialUploadBytes,
  ]);

  const canShareMobile = useMemo(() => canShareXmlFile(), []);

  if (!isOpen || !exportResult) return null;

  const { exportedXml, cssOnlySnippet, originalBytes, exportedBytes, deltaBytes, reasons } =
    exportResult;

  const modifiedVarsCount =
    parsedInfo.variables.filter((v) => (variableValues[v.name] ?? v.value) !== v.defaultValue)
      .length +
    Object.keys(cssVarValues).length +
    Object.keys(colorReplacements).length;

  const handleDownloadXml = async () => {
    const res = await downloadXmlFile(exportedXml, parsedInfo.templateTitle);
    if (res.method === 'cancelled') {
      onNotify('Penyimpanan file dibatalkan.', 'info');
      return;
    }
    onNotify(`File ${res.filename} berhasil disimpan sebagai text/xml.`, 'success');
  };

  const handleShareMobileXml = async () => {
    try {
      const status = await shareXmlFileViaNavigator(exportedXml, parsedInfo.templateTitle);
      if (status === 'shared') {
        onNotify('File template-blogger.xml dibagikan ke File Manager / aplikasi target.', 'success');
      } else if (status === 'unsupported') {
        onNotify('Browser tidak mendukung Share file XML. Gunakan Unduh File .xml.', 'info');
      }
    } catch {
      onNotify('Gagal membagikan file XML melalui Share HP.', 'error');
    }
  };

  const handleCopy = async () => {
    const content = activeTab === 'xml' ? exportedXml : cssOnlySnippet;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onNotify(
        activeTab === 'xml'
          ? 'XML tema yang dimodifikasi disalin ke papan klip.'
          : 'Potongan CSS disalin ke papan klip.',
        'success'
      );
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('Gagal menyalin kode ke papan klip.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="export-modal-title" className="text-base font-semibold text-slate-900">
              Ekspor Tema Blogspot Siap Pakai
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Unggah file <span className="font-mono">.xml</span> hasil ekspor melalui menu Tema &rarr; Pulihkan di dasbor Blogger.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog ekspor"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary & Size Transparency Strip */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-slate-600 tabular-nums">
              <span>
                <strong className="text-slate-900">{modifiedVarsCount}</strong> token diubah
              </span>
              <span aria-hidden="true">&middot;</span>
              <span>
                Palet: <strong className="text-slate-900">{colors.enabled ? 'Kustom aktif' : 'Bawaan XML'}</strong>
              </span>
              <span aria-hidden="true">&middot;</span>
              <span>
                Font: <strong className="text-slate-900">{fonts.enabled ? `${fonts.headingFont} + ${fonts.bodyFont}` : 'Bawaan XML'}</strong>
              </span>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('xml')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'xml'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                XML Lengkap
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('css')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'css'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                CSS Saja
              </button>
            </div>
          </div>

          {/* Exact Size Comparison Breakdown */}
          <div className="pt-2 border-t border-slate-200/80 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono tabular-nums text-[11px] text-slate-700">
                <span>
                  Asli: <strong>{(originalBytes / 1024).toFixed(2)} KB</strong>
                </span>
                <span aria-hidden="true">&rarr;</span>
                <span>
                  Ekspor: <strong>{(exportedBytes / 1024).toFixed(2)} KB</strong>
                </span>
                <span aria-hidden="true">&middot;</span>
                <span
                  className={
                    deltaBytes === 0
                      ? 'text-emerald-700 font-semibold'
                      : 'text-blue-700 font-semibold'
                  }
                >
                  Selisih: {formatByteDelta(deltaBytes)}
                </span>
              </div>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={minimalExport}
                  onChange={(e) => setMinimalExport(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Ekspor minimal (tanpa injeksi blok CSS/font tambahan)</span>
              </label>
            </div>

            {reasons.length > 0 && (
              <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                  {reasons.map((r, i) => (
                    <span key={i}>
                      {r.label} ({formatByteDelta(r.bytesDelta)})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Code Preview */}
        <div className="flex-1 overflow-hidden p-4 bg-white">
          <textarea
            readOnly
            value={
              activeTab === 'xml'
                ? exportedXml
                : cssOnlySnippet || '/* Belum ada override warna, font, atau CSS kustom yang aktif. */'
            }
            aria-label="Pratinjau kode ekspor"
            className="w-full h-[290px] p-4 font-mono text-xs leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none"
          />
        </div>

        {siteAdsense && (
          <AdsenseSlotRenderer
            slotKey="modalSlot"
            config={siteAdsense.config}
            shouldRenderLiveAds={siteAdsense.shouldRenderLiveAds}
            isAdmin={siteAdsense.isAdmin}
            className="mx-6 mb-3"
          />
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            Ukuran ekspor: {exportedBytes.toLocaleString('id-ID')} bytes ({(exportedBytes / 1024).toFixed(2)} KB)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Tersalin' : 'Salin Kode'}</span>
            </button>
            {onOverwriteWholeXml && (
              <button
                type="button"
                onClick={() => onOverwriteWholeXml(exportedXml, false)}
                title="Simpan seluruh perubahan dan timpa template XML yang sedang dibuka"
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 text-blue-600" />
                <span>Simpan &amp; Timpa Template</span>
              </button>
            )}
            {canShareMobile && (
              <button
                type="button"
                onClick={() => void handleShareMobileXml()}
                title="Kirim template-blogger.xml ke File Manager Android melalui menu Share"
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Simpan via Share HP</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (onOverwriteWholeXml) {
                  onOverwriteWholeXml(exportedXml, true);
                } else {
                  void handleDownloadXml();
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{onOverwriteWholeXml ? 'Timpa Template & Unduh .xml' : 'Unduh File .xml'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
