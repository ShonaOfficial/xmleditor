import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  Globe,
  ShieldAlert,
} from 'lucide-react';
import { extractHtmlJsCssViewsFromXml } from '../lib/scriptAndCodeInspector';
import type { DetectedAssetUrl } from '../types/blogger';

interface HtmlJsCssViewerPanelProps {
  xml: string;
  templateTitle?: string;
  isDark?: boolean;
  initialSubTab?: 'html' | 'js' | 'css' | 'urls';
  onJumpToLine: (line: number, snippet?: string) => void;
  onReplaceSnippetInXml?: (oldText: string, newText: string, feedbackMessage: string) => void;
}

function downloadTextBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const HtmlJsCssViewerPanel: React.FC<HtmlJsCssViewerPanelProps> = ({
  xml,
  templateTitle = 'template-blogger',
  isDark = false,
  initialSubTab = 'html',
  onJumpToLine,
  onReplaceSnippetInXml,
}) => {
  const [subTab, setSubTab] = useState<'html' | 'js' | 'css' | 'urls'>(initialSubTab);
  const [htmlMode, setHtmlMode] = useState<'code' | 'render'>('code');
  const [urlFilter, setUrlFilter] = useState<'all' | 'css' | 'js' | 'obfuscated'>('all');
  const [urlSearch, setUrlSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const views = useMemo(() => extractHtmlJsCssViewsFromXml(xml), [xml]);

  const obfuscatedCount = useMemo(
    () => views.externalUrls.filter((u) => u.isObfuscated).length,
    [views.externalUrls]
  );
  const cssUrlCount = useMemo(
    () => views.externalUrls.filter((u) => u.kind === 'css').length,
    [views.externalUrls]
  );
  const jsUrlCount = useMemo(
    () => views.externalUrls.filter((u) => u.kind === 'js').length,
    [views.externalUrls]
  );

  const filteredUrls = useMemo(() => {
    const q = urlSearch.trim().toLowerCase();
    return views.externalUrls.filter((u) => {
      if (urlFilter === 'css' && u.kind !== 'css') return false;
      if (urlFilter === 'js' && u.kind !== 'js') return false;
      if (urlFilter === 'obfuscated' && !u.isObfuscated) return false;
      if (!q) return true;
      return (
        u.url.toLowerCase().includes(q) ||
        u.host.toLowerCase().includes(q) ||
        (u.extension || '').toLowerCase().includes(q) ||
        (u.obfuscationTechnique || '').toLowerCase().includes(q) ||
        u.sourceContext.toLowerCase().includes(q)
      );
    });
  }, [urlFilter, urlSearch, views.externalUrls]);

  const handleCopy = (key: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
  };

  const slugBase =
    templateTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tema-blogger';

  const cardBg = isDark
    ? 'bg-[#0F172A] border-slate-700 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const subSurface = isDark
    ? 'bg-slate-900/90 border-slate-700 text-slate-200'
    : 'bg-slate-50 border-slate-200 text-slate-800';

  const renderUrlRow = (u: DetectedAssetUrl) => {
    const extBadge = u.extension ? `.${u.extension.toUpperCase()}` : `.${u.kind.toUpperCase()}`;
    return (
      <div
        key={u.id}
        className={`p-3.5 space-y-2 border-b last:border-b-0 ${
          isDark ? 'border-slate-800' : 'border-slate-100'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                u.kind === 'css'
                  ? isDark
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : u.extension === 'jss'
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

            {u.isObfuscated && (
              <span
                className={`px-2 py-0.5 text-[10px] font-semibold rounded border inline-flex items-center gap-1 ${
                  isDark
                    ? 'bg-red-950/60 border-red-800 text-red-300'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                <ShieldAlert className="w-3 h-3" />
                <span>Tersembunyi &middot; {u.obfuscationTechnique || 'Obfuscated'}</span>
              </span>
            )}

            <span className={`text-xs font-medium ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              {u.host}
            </span>
            <span className={`text-[11px] font-mono ${mutedText}`}>
              {u.sourceContext}
              {u.count > 1 ? ` · ${u.count}×` : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onJumpToLine(u.line, u.rawExpression || u.rawUrl)}
              className={`px-2.5 py-1 text-[11px] font-mono tabular-nums rounded border flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-blue-300 hover:bg-slate-700'
                  : 'bg-slate-50 border-slate-200 text-blue-700 hover:bg-slate-100'
              }`}
            >
              <span>Baris {u.line}</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={() => handleCopy(u.id, u.url)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded border flex items-center gap-1 cursor-pointer ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {copiedKey === u.id ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copiedKey === u.id ? 'Disalin' : 'Salin URL'}</span>
            </button>

            {onReplaceSnippetInXml && u.isObfuscated && u.rawExpression && u.rawExpression.length < 240 && (
              <button
                type="button"
                onClick={() =>
                  onReplaceSnippetInXml(
                    u.rawExpression!,
                    u.url,
                    `URL terobfuskasi di baris ${u.line} dibuka menjadi URL bersih.`
                  )
                }
                className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              >
                Ganti ke URL Bersih
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${mutedText}`}>
            {u.isObfuscated ? 'URL Hasil Decode:' : 'URL Terdeteksi:'}
          </div>
          <div
            className={`px-2.5 py-1.5 rounded border font-mono text-xs break-all select-all ${
              u.isObfuscated
                ? isDark
                  ? 'bg-emerald-950/35 border-emerald-800/70 text-emerald-200'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : subSurface
            }`}
          >
            {u.url}
          </div>
        </div>

        {u.isObfuscated && u.rawExpression && (
          <div className="space-y-1">
            <div className={`text-[10px] font-medium ${mutedText}`}>
              Kode Asli Terobfuskasi dalam Template:
            </div>
            <pre
              className={`p-2 rounded border font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all ${
                isDark
                  ? 'bg-slate-950 border-slate-800 text-slate-400'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              {u.rawExpression}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">
      {/* Top Sub-Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div
          className={`inline-flex items-center gap-1 p-1 rounded-lg overflow-x-auto no-scrollbar max-w-full ${
            isDark ? 'bg-slate-800' : 'bg-slate-100'
          }`}
        >
          {(
            [
              ['html', `HTML View (${views.htmlLineCount} brs)`],
              ['js', `.JS / .JSS (${views.jsBlocks.length} blok · ${jsUrlCount} URL)`],
              ['css', `.CSS (${views.cssBlocks.length} blok · ${cssUrlCount} URL)`],
              [
                'urls',
                `URL Luar & Decode (${views.externalUrls.length}${
                  obfuscatedCount > 0 ? ` · ${obfuscatedCount} Tersembunyi` : ''
                })`,
              ],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                subTab === id
                  ? isDark
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {subTab === 'html' && (
            <>
              <div
                className={`inline-flex items-center gap-1 p-0.5 rounded-lg border ${
                  isDark ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setHtmlMode('code')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                    htmlMode === 'code'
                      ? isDark
                        ? 'bg-slate-700 text-white'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedText
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  <span>Kode HTML</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlMode('render')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                    htmlMode === 'render'
                      ? isDark
                        ? 'bg-slate-700 text-white'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedText
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Pratinjau HTML</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('html-all', views.htmlMarkup)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {copiedKey === 'html-all' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Salin HTML</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadTextBlob(`${slugBase}-markup.html`, views.htmlRenderPreview, 'text/html;charset=utf-8')
                }
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh .html</span>
              </button>
            </>
          )}

          {subTab === 'js' && (
            <>
              <button
                type="button"
                disabled={!views.combinedJs}
                onClick={() => handleCopy('js-all', views.combinedJs)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1 disabled:opacity-40 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {copiedKey === 'js-all' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Salin Semua .JS</span>
              </button>
              <button
                type="button"
                disabled={!views.combinedJs}
                onClick={() =>
                  downloadTextBlob(`${slugBase}-scripts.js`, views.combinedJs, 'application/javascript;charset=utf-8')
                }
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh .js</span>
              </button>
            </>
          )}

          {subTab === 'css' && (
            <>
              <button
                type="button"
                disabled={!views.combinedCss}
                onClick={() => handleCopy('css-all', views.combinedCss)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1 disabled:opacity-40 cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {copiedKey === 'css-all' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Salin Semua .CSS</span>
              </button>
              <button
                type="button"
                disabled={!views.combinedCss}
                onClick={() =>
                  downloadTextBlob(`${slugBase}-styles.css`, views.combinedCss, 'text/css;charset=utf-8')
                }
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh .css</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content View */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5">
        {subTab === 'html' && (
          <div className="space-y-3 h-full flex flex-col">
            {htmlMode === 'code' ? (
              <div className={`flex-1 min-h-[340px] rounded-xl border overflow-hidden flex flex-col ${cardBg}`}>
                <div
                  className={`px-4 py-2 border-b flex items-center justify-between text-xs ${
                    isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5 text-blue-500" />
                    <span>HTML Markup Template (Blok CSS &amp; JS Terpisah)</span>
                  </span>
                  <span className={`font-mono text-[11px] tabular-nums ${mutedText}`}>
                    {views.htmlLineCount} baris &middot; {(views.htmlMarkup.length / 1024).toFixed(1)} KB
                  </span>
                </div>
                <pre
                  className={`flex-1 p-4 font-mono text-xs leading-relaxed overflow-auto whitespace-pre ${
                    isDark ? 'bg-[#0B1120] text-slate-100' : 'bg-slate-50/50 text-slate-900'
                  }`}
                >
                  {views.htmlMarkup || 'Template XML masih kosong.'}
                </pre>
              </div>
            ) : (
              <div className={`flex-1 min-h-[380px] rounded-xl border overflow-hidden flex flex-col ${cardBg}`}>
                <div
                  className={`px-4 py-2 border-b flex items-center justify-between text-xs ${
                    isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Pratinjau Struktur HTML Render (Tanpa Eksekusi Script)</span>
                  </span>
                  <span className={`text-[11px] ${mutedText}`}>Sandbox aman &middot; Script dinonaktifkan</span>
                </div>
                <iframe
                  title="Pratinjau HTML View Template"
                  sandbox=""
                  srcDoc={views.htmlRenderPreview}
                  className="w-full flex-1 min-h-[360px] bg-white"
                />
              </div>
            )}
          </div>
        )}

        {subTab === 'js' && (
          <div className="space-y-4">
            {/* External .JS / .JSS & Obfuscated JS URLs */}
            <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
              <div
                className={`px-4 py-2.5 border-b flex items-center justify-between text-xs ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <span className="font-semibold flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-blue-500" />
                  <span>URL Skrip Eksternal (.JS / .JSS / .MJS &amp; Tersembunyi)</span>
                </span>
                <span className={`font-mono text-[11px] tabular-nums ${mutedText}`}>
                  {jsUrlCount} URL
                </span>
              </div>
              {jsUrlCount === 0 ? (
                <div className={`p-4 text-xs ${mutedText}`}>
                  Tidak ada URL .js atau .jss eksternal ditemukan di template.
                </div>
              ) : (
                <div>
                  {views.externalUrls.filter((u) => u.kind === 'js').map(renderUrlRow)}
                </div>
              )}
            </div>

            {/* Inline <script> Blocks */}
            {views.jsBlocks.length === 0 ? (
              <div className={`p-6 rounded-xl border text-center text-xs ${cardBg} ${mutedText}`}>
                Tidak ada blok &lt;script&gt; inline di dalam template ini.
              </div>
            ) : (
              views.jsBlocks.map((block) => (
                <div key={block.id} className={`rounded-xl border overflow-hidden ${cardBg}`}>
                  <div
                    className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
                      isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="font-mono font-semibold flex items-center gap-2">
                      <span>{block.sourceLabel}</span>
                      <span className={`font-normal text-[11px] tabular-nums ${mutedText}`}>
                        Baris {block.startLine}–{block.endLine} &middot; {(block.byteSize / 1024).toFixed(2)} KB
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onJumpToLine(block.startLine)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded border flex items-center gap-1 cursor-pointer ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-blue-300 hover:bg-slate-700'
                            : 'bg-white border-slate-200 text-blue-700 hover:bg-slate-100'
                        }`}
                      >
                        <span>Editor XML Baris {block.startLine}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(block.id, block.code)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded border flex items-center gap-1 cursor-pointer ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {copiedKey === block.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>Salin</span>
                      </button>
                    </div>
                  </div>
                  <pre
                    className={`p-3.5 max-h-72 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      isDark ? 'bg-[#0B1120] text-slate-100' : 'bg-slate-50/40 text-slate-900'
                    }`}
                  >
                    {block.code}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}

        {subTab === 'css' && (
          <div className="space-y-4">
            {/* External .CSS & Obfuscated CSS URLs */}
            <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
              <div
                className={`px-4 py-2.5 border-b flex items-center justify-between text-xs ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <span className="font-semibold flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-emerald-500" />
                  <span>URL Stylesheet Eksternal (.CSS &amp; Tersembunyi)</span>
                </span>
                <span className={`font-mono text-[11px] tabular-nums ${mutedText}`}>
                  {cssUrlCount} URL
                </span>
              </div>
              {cssUrlCount === 0 ? (
                <div className={`p-4 text-xs ${mutedText}`}>
                  Tidak ada URL .css eksternal atau @import CSS ditemukan di template.
                </div>
              ) : (
                <div>
                  {views.externalUrls.filter((u) => u.kind === 'css').map(renderUrlRow)}
                </div>
              )}
            </div>

            {/* Inline <b:skin>, <b:template-skin>, <style> Blocks */}
            {views.cssBlocks.length === 0 ? (
              <div className={`p-6 rounded-xl border text-center text-xs ${cardBg} ${mutedText}`}>
                Tidak ada blok &lt;b:skin&gt; atau &lt;style&gt; di dalam template ini.
              </div>
            ) : (
              views.cssBlocks.map((block) => (
                <div key={block.id} className={`rounded-xl border overflow-hidden ${cardBg}`}>
                  <div
                    className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
                      isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="font-mono font-semibold flex items-center gap-2">
                      <span>{block.sourceLabel}</span>
                      <span className={`font-normal text-[11px] tabular-nums ${mutedText}`}>
                        Baris {block.startLine}–{block.endLine} &middot; {(block.byteSize / 1024).toFixed(2)} KB
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onJumpToLine(block.startLine)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded border flex items-center gap-1 cursor-pointer ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-blue-300 hover:bg-slate-700'
                            : 'bg-white border-slate-200 text-blue-700 hover:bg-slate-100'
                        }`}
                      >
                        <span>Editor XML Baris {block.startLine}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(block.id, block.code)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded border flex items-center gap-1 cursor-pointer ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {copiedKey === block.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>Salin</span>
                      </button>
                    </div>
                  </div>
                  <pre
                    className={`p-3.5 max-h-72 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      isDark ? 'bg-[#0B1120] text-slate-100' : 'bg-slate-50/40 text-slate-900'
                    }`}
                  >
                    {block.code}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}

        {subTab === 'urls' && (
          <div className="space-y-3">
            <div className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 ${cardBg}`}>
              <input
                type="text"
                value={urlSearch}
                onChange={(e) => setUrlSearch(e.target.value)}
                placeholder="Filter URL .css, .js, .jss, domain, atau metode obfuskasi..."
                className={`flex-1 min-w-[200px] px-3 py-1.5 text-xs font-mono border rounded-lg focus:outline-none ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500'
                    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-600'
                }`}
              />
              <div
                className={`inline-flex items-center gap-1 p-1 rounded-lg ${
                  isDark ? 'bg-slate-800' : 'bg-slate-100'
                }`}
              >
                {(
                  [
                    ['all', `Semua (${views.externalUrls.length})`],
                    ['css', `.CSS (${cssUrlCount})`],
                    ['js', `.JS / .JSS (${jsUrlCount})`],
                    ['obfuscated', `Tersembunyi (${obfuscatedCount})`],
                  ] as const
                ).map(([fKey, fLabel]) => (
                  <button
                    key={fKey}
                    type="button"
                    onClick={() => setUrlFilter(fKey)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer whitespace-nowrap tabular-nums ${
                      urlFilter === fKey
                        ? isDark
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-900 shadow-xs'
                        : mutedText
                    }`}
                  >
                    {fLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
              {filteredUrls.length === 0 ? (
                <div className={`p-6 text-center text-xs ${mutedText}`}>
                  Tidak ada URL eksternal atau URL terobfuskasi yang cocok dengan filter ini.
                </div>
              ) : (
                filteredUrls.map(renderUrlRow)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
