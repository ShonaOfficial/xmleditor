import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Combine,
  Copy,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  FileUp,
  Play,
  Scissors,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuthAndAi, type GeminiXmlPartAttachment } from '../contexts/AuthAndAiContext';
import type { ParsedTemplateInfo } from '../types/blogger';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';
import {
  countLines,
  getUtf8Bytes,
  mergeXmlParts,
  splitXmlByBloggerStructure,
  splitXmlByChunks,
  type XmlMergeInputPart,
  type XmlMergeMode,
  type XmlSplitMode,
  type XmlSplitPart,
} from '../lib/xmlSplitterMerger';
import { downloadXmlFile } from '../lib/bloggerCompiler';

interface XmlSplitterMergerViewProps {
  xml: string;
  sourceLabel: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  onApplyMergedXml: (
    nextXml: string,
    label: string,
    openView?: 'preview' | 'editor'
  ) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type SplitterSubTab = 'split' | 'merge';

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function downloadTextBlob(content: string, filename: string, mime = 'application/xml;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const XmlSplitterMergerView: React.FC<XmlSplitterMergerViewProps> = ({
  xml,
  sourceLabel,
  parsedInfo,
  offlineAi,
  onApplyMergedXml,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<SplitterSubTab>('split');

  // --- Splitter State ---
  const splitFileInputRef = useRef<HTMLInputElement>(null);
  const [useCustomSplitSource, setUseCustomSplitSource] = useState(false);
  const [customSplitXml, setCustomSplitXml] = useState('');
  const [customSplitName, setCustomSplitName] = useState('custom-template.xml');
  const [splitMode, setSplitMode] = useState<XmlSplitMode>('blogger-structure');
  const [maxLines, setMaxLines] = useState(400);
  const [maxKb, setMaxKb] = useState(50);
  const [partsCount, setPartsCount] = useState(4);
  const [partSearch, setPartSearch] = useState('');
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [rangeStartPart, setRangeStartPart] = useState<number>(1);
  const [rangeEndPart, setRangeEndPart] = useState<number>(1);
  const { attachXmlPartsToGemini } = useAuthAndAi();

  const activeSplitXml = useCustomSplitSource ? customSplitXml : xml;
  const activeSplitName = useCustomSplitSource
    ? customSplitName
    : `${parsedInfo.templateTitle || 'template-blogger'}.xml`;

  const splitResult = useMemo(() => {
    if (splitMode === 'blogger-structure') {
      return splitXmlByBloggerStructure(activeSplitXml, activeSplitName);
    }
    return splitXmlByChunks(
      activeSplitXml,
      {
        mode: splitMode,
        maxLines,
        maxKb,
        partsCount,
      },
      activeSplitName
    );
  }, [activeSplitXml, activeSplitName, splitMode, maxLines, maxKb, partsCount]);

  const filteredSplitParts = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    if (!q) return splitResult.parts;
    return splitResult.parts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.filename.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
    );
  }, [splitResult.parts, partSearch]);

  // --- Merger State ---
  const mergeFileInputRef = useRef<HTMLInputElement>(null);
  const [mergeParts, setMergeParts] = useState<XmlMergeInputPart[]>([]);
  const [mergeMode, setMergeMode] = useState<XmlMergeMode>('sequential');
  const [autoSortByName, setAutoSortByName] = useState(false);
  const [insertNewlineBetweenParts, setInsertNewlineBetweenParts] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isDraggingMerge, setIsDraggingMerge] = useState(false);
  const [showMergedPreview, setShowMergedPreview] = useState(false);

  const mergeResult = useMemo(
    () =>
      mergeXmlParts(mergeParts, {
        mode: mergeMode,
        autoSortByName,
        insertNewlineBetweenStandaloneParts: insertNewlineBetweenParts,
      }),
    [mergeParts, mergeMode, autoSortByName, insertNewlineBetweenParts]
  );

  const handleCopy = async (text: string, id: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
      onNotify(`${label} berhasil disalin ke clipboard.`, 'success');
    } catch {
      onNotify('Gagal menyalin ke clipboard.', 'error');
    }
  };

  const handleUploadCustomSplitFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) {
        onNotify('File XML kosong atau tidak dapat dibaca.', 'error');
        return;
      }
      setCustomSplitXml(content);
      setCustomSplitName(file.name);
      setUseCustomSplitSource(true);
      setExpandedPartId(null);
      onNotify(`File "${file.name}" (${formatKb(file.size)}) siap dipecah.`, 'success');
    };
    reader.readAsText(file);
  };

  const handleDownloadAllParts = () => {
    if (splitResult.parts.length === 0) return;
    splitResult.parts.forEach((part, idx) => {
      setTimeout(() => {
        downloadTextBlob(part.content, part.filename);
      }, idx * 140);
    });
    setTimeout(() => {
      downloadTextBlob(
        splitResult.manifestJson,
        `${splitResult.parts[0]?.filename.replace(/-\d+.*\.xml$/, '') || 'temaloka'}-manifest.json`,
        'application/json;charset=utf-8'
      );
    }, splitResult.parts.length * 140 + 80);
    onNotify(
      `Mengunduh ${splitResult.parts.length} bagian XML + 1 file manifest JSON...`,
      'success'
    );
  };

  const handleSendPartsToMerger = (parts: XmlSplitPart[], recommendedMode: XmlMergeMode) => {
    const mapped: XmlMergeInputPart[] = parts.map((p) => ({
      id: `${Date.now()}-${p.index}-${Math.random().toString(36).slice(2, 6)}`,
      name: p.filename,
      content: p.content,
      enabled: true,
    }));
    setMergeParts(mapped);
    setMergeMode(recommendedMode);
    setAutoSortByName(false);
    setInsertNewlineBetweenParts(false);
    setSubTab('merge');
    onNotify(
      `${mapped.length} bagian XML dikirim ke Penyatu XML (${recommendedMode === 'sequential' ? 'Gabung Berurutan' : 'Gabung Blogger Cerdas'}).`,
      'success'
    );
  };

  const handleTestRoundTrip = () => {
    if (splitResult.parts.length === 0) return;
    const recombined = splitResult.parts.map((p) => p.content).join('');
    if (recombined === activeSplitXml) {
      onNotify(
        `Verifikasi Round-Trip Lolos 100%! (${splitResult.parts.length} bagian = ${formatKb(getUtf8Bytes(recombined))} identik byte-per-byte).`,
        'success'
      );
    } else {
      onNotify(
        'Peringatan: hasil gabungan ulang sedikit berbeda dari sumber asli.',
        'error'
      );
    }
  };

  const totalPartsCount = splitResult.parts.length;

  useEffect(() => {
    setRangeStartPart(1);
    setRangeEndPart(Math.max(1, totalPartsCount));
    setSelectedPartIds([]);
  }, [totalPartsCount, splitMode, activeSplitName]);

  const effectiveRangeStart = useMemo(() => {
    if (totalPartsCount === 0) return 1;
    const s = Math.max(1, Math.min(totalPartsCount, rangeStartPart));
    const e = Math.max(1, Math.min(totalPartsCount, rangeEndPart));
    return Math.min(s, e);
  }, [totalPartsCount, rangeStartPart, rangeEndPart]);

  const effectiveRangeEnd = useMemo(() => {
    if (totalPartsCount === 0) return 1;
    const s = Math.max(1, Math.min(totalPartsCount, rangeStartPart));
    const e = Math.max(1, Math.min(totalPartsCount, rangeEndPart));
    return Math.max(s, e);
  }, [totalPartsCount, rangeStartPart, rangeEndPart]);

  const rangedParts = useMemo(
    () =>
      splitResult.parts.filter(
        (p) => p.index >= effectiveRangeStart && p.index <= effectiveRangeEnd
      ),
    [splitResult.parts, effectiveRangeStart, effectiveRangeEnd]
  );

  const rangedTotalBytes = useMemo(
    () => rangedParts.reduce((acc, p) => acc + p.byteSize, 0),
    [rangedParts]
  );

  const rangedTotalLines = useMemo(
    () => rangedParts.reduce((acc, p) => acc + p.lineCount, 0),
    [rangedParts]
  );

  const rangeBadgeLabel =
    effectiveRangeStart === effectiveRangeEnd
      ? `Part ${effectiveRangeStart}`
      : `Part ${effectiveRangeStart}–${effectiveRangeEnd}`;

  const selectedParts = useMemo(() => {
    const idSet = new Set(selectedPartIds);
    return splitResult.parts.filter((p) => idSet.has(p.id));
  }, [splitResult.parts, selectedPartIds]);

  const toGeminiAttachment = (p: XmlSplitPart): GeminiXmlPartAttachment => ({
    id: `${activeSplitName}:${p.id}`,
    index: p.index,
    total: p.total,
    filename: p.filename,
    title: p.title,
    byteSize: p.byteSize,
    lineCount: p.lineCount,
    content: p.content,
  });

  const handleSharePartsToGemini = (partsToShare: XmlSplitPart[]) => {
    if (partsToShare.length === 0) return;
    const totalChars = partsToShare.reduce((acc, p) => acc + p.content.length, 0);
    if (totalChars > 1_450_000) {
      onNotify(
        `Total teks (${(totalChars / 1024).toFixed(0)} KB) terlalu besar untuk sekali kirim (>1.4 MB). Pilih beberapa bagian terlebih dahulu lalu kirim bertahap ke Gemini agar tidak terpotong.`,
        'info'
      );
      return;
    }
    attachXmlPartsToGemini(partsToShare.map(toGeminiAttachment), {
      replace: true,
      openChat: true,
      switchToGemini: true,
    });
    const totalKb = formatKb(partsToShare.reduce((acc, p) => acc + p.byteSize, 0));
    onNotify(
      `${partsToShare.length} bagian XML (${totalKb}) dilampirkan utuh tanpa terpotong ke Chat AI Gemini.`,
      'success'
    );
  };

  const handleCopyGeminiPromptPackage = async (partsToCopy: XmlSplitPart[]) => {
    if (partsToCopy.length === 0) return;
    const firstIdx = partsToCopy[0].index;
    const lastIdx = partsToCopy[partsToCopy.length - 1].index;
    const totalAll = partsToCopy[0].total;
    const rangeDesc =
      partsToCopy.length === 1
        ? `Part #${firstIdx} dari total ${totalAll} bagian`
        : `Part #${firstIdx} sampai #${lastIdx} (${partsToCopy.length} bagian dari total ${totalAll} bagian)`;
    const totalPackageKb = formatKb(partsToCopy.reduce((a, p) => a + p.byteSize, 0));

    const header = [
      `Tolong baca dan analisa file XML template Blogger berikut secara utuh (${rangeDesc}, jangan lewatkan baris maupun blok CDATA mana pun):`,
      `Sumber: ${activeSplitName} | Ukuran Paket: ${totalPackageKb}`,
      '',
    ].join('\n');
    const body = partsToCopy
      .map(
        (p) =>
          `=== BAGIAN #${p.index}/${p.total} | ${p.filename} | ${p.title} (${p.lineCount} baris, ${formatKb(p.byteSize)}) ===\n${p.content}\n=== AKHIR BAGIAN #${p.index}/${p.total} ===`
      )
      .join('\n\n');
    await handleCopy(
      `${header}${body}`,
      'gemini-prompt-pack',
      `Paket XML utuh ${partsToCopy.length === 1 ? `Part #${firstIdx}` : `Part #${firstIdx}–#${lastIdx}`} (${totalPackageKb}) untuk Gemini`
    );
  };

  const toggleSelectPart = (id: string) => {
    setSelectedPartIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addFilesToMerger = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const loaded: XmlMergeInputPart[] = [];
    for (const f of files) {
      const text = await f.text();
      if (!text.trim()) continue;
      loaded.push({
        id: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        content: text,
        enabled: true,
      });
    }
    if (loaded.length === 0) {
      onNotify('Tidak ada file berisi teks/XML yang valid untuk ditambahkan.', 'error');
      return;
    }
    setMergeParts((prev) => [...prev, ...loaded]);
    onNotify(`${loaded.length} file ditambahkan ke daftar Penyatu XML.`, 'success');
  };

  const handleAddActiveXmlAsBase = () => {
    if (!xml.trim()) {
      onNotify('Template XML aktif saat ini kosong.', 'error');
      return;
    }
    setMergeParts((prev) => [
      {
        id: `merge-base-${Date.now()}`,
        name: `00-basis-${(parsedInfo.templateTitle || 'template').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xml`,
        content: xml,
        enabled: true,
      },
      ...prev,
    ]);
    setMergeMode('smart-blogger');
    onNotify('Template aktif dimasukkan sebagai kerangka utama Penyatu Blogger Cerdas.', 'success');
  };

  const handleSaveManualPart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualContent.trim()) {
      onNotify('Isi kode potongan XML / CSS / Section terlebih dahulu.', 'error');
      return;
    }
    const cleanName =
      manualName.trim() || `potongan-manual-${mergeParts.length + 1}.xml`;

    if (editingPartId) {
      setMergeParts((prev) =>
        prev.map((p) =>
          p.id === editingPartId ? { ...p, name: cleanName, content: manualContent } : p
        )
      );
      setEditingPartId(null);
      onNotify(`Potongan "${cleanName}" diperbarui.`, 'success');
    } else {
      setMergeParts((prev) => [
        ...prev,
        {
          id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          content: manualContent,
          enabled: true,
        },
      ]);
      onNotify(`Potongan "${cleanName}" ditambahkan ke daftar gabung.`, 'success');
    }
    setManualName('');
    setManualContent('');
    setShowManualForm(false);
  };

  const moveMergePart = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= mergeParts.length) return;
    setMergeParts((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#F8FAFC] overflow-hidden">
      <OfflineAiRuntimeBar
        controller={offlineAi}
        page="splitter"
        xml={xml}
        parsedInfo={parsedInfo}
        compact
      />

      {/* Top Toolbar */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('split')}
              className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                subTab === 'split'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Scissors className="w-3.5 h-3.5 text-blue-600" />
              <span>XML Splitter (Pecah)</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('merge')}
              className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                subTab === 'merge'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Combine className="w-3.5 h-3.5 text-emerald-600" />
              <span>Penyatu XML (Gabung)</span>
              {mergeParts.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-emerald-100 text-emerald-800 tabular-nums">
                  {mergeParts.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
          Template Aktif: <strong className="text-slate-800">{parsedInfo.templateTitle}</strong> &middot;{' '}
          {formatKb(parsedInfo.xmlByteSize)} &middot; {parsedInfo.sections.length} section
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
        {subTab === 'split' ? (
          <div className="max-w-6xl mx-auto space-y-4">
            {/* Split Configuration Card */}
            <section className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Pemecah Template XML (Client-Side Lossless)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pecah file XML Blogspot besar per struktur Blogger atau per baris/KB tanpa merusak blok <span className="font-mono">&lt;![CDATA[...]]&gt;</span>.
                  </p>
                </div>

                {/* Source Picker */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <input
                    ref={splitFileInputRef}
                    type="file"
                    accept=".xml,.txt,.html"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadCustomSplitFile(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setUseCustomSplitSource(false)}
                    className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border cursor-pointer ${
                      !useCustomSplitSource
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    XML Aktif ({sourceLabel.slice(0, 22)})
                  </button>
                  <button
                    type="button"
                    onClick={() => splitFileInputRef.current?.click()}
                    className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border cursor-pointer ${
                      useCustomSplitSource
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>
                      {useCustomSplitSource ? `File: ${customSplitName}` : 'Unggah XML Khusus'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Mode Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {(
                  [
                    [
                      'blogger-structure',
                      'Struktur Blogger',
                      'Head/b:skin, tiap b:section, & script akhir',
                    ],
                    ['lines', 'Per Jumlah Baris', 'Cocok untuk edit/tempel per N baris'],
                    ['size-kb', 'Per Ukuran KB', 'Cocok untuk batasan ukuran upload/AI'],
                    ['parts-count', 'Jumlah Bagian', 'Bagi rata ke N file bagian'],
                  ] as Array<[XmlSplitMode, string, string]>
                ).map(([mId, title, desc]) => (
                  <button
                    key={mId}
                    type="button"
                    onClick={() => setSplitMode(mId)}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer space-y-0.5 ${
                      splitMode === mId
                        ? 'border-blue-600 bg-blue-50/70'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">{title}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                  </button>
                ))}
              </div>

              {/* Dynamic Mode Parameters */}
              {splitMode !== 'blogger-structure' && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-3 text-xs">
                  {splitMode === 'lines' && (
                    <>
                      <label className="font-semibold text-slate-800" htmlFor="split-lines-input">
                        Maksimal Baris per Bagian:
                      </label>
                      <input
                        id="split-lines-input"
                        type="number"
                        min={20}
                        max={20000}
                        value={maxLines}
                        onChange={(e) => setMaxLines(Math.max(20, Number(e.target.value) || 200))}
                        className="w-24 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                      />
                      <div className="flex items-center gap-1.5">
                        {[250, 400, 800, 1500].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setMaxLines(preset)}
                            className={`px-2 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                              maxLines === preset
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {splitMode === 'size-kb' && (
                    <>
                      <label className="font-semibold text-slate-800" htmlFor="split-kb-input">
                        Target Ukuran per Bagian (KB):
                      </label>
                      <input
                        id="split-kb-input"
                        type="number"
                        min={4}
                        max={5000}
                        value={maxKb}
                        onChange={(e) => setMaxKb(Math.max(4, Number(e.target.value) || 50))}
                        className="w-24 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                      />
                      <div className="flex items-center gap-1.5">
                        {[25, 50, 100, 250].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setMaxKb(preset)}
                            className={`px-2 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                              maxKb === preset
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            {preset} KB
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {splitMode === 'parts-count' && (
                    <>
                      <label className="font-semibold text-slate-800" htmlFor="split-count-input">
                        Bagi Menjadi Berapa Bagian:
                      </label>
                      <input
                        id="split-count-input"
                        type="number"
                        min={2}
                        max={40}
                        value={partsCount}
                        onChange={(e) => setPartsCount(Math.max(2, Math.min(40, Number(e.target.value) || 2)))}
                        className="w-20 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                      />
                      <div className="flex items-center gap-1.5">
                        {[2, 4, 6, 10].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setPartsCount(preset)}
                            className={`px-2 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                              partsCount === preset
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            {preset} Bagian
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Summary & Batch Actions */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 pt-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
                  <span className="font-semibold text-slate-900">
                    {splitResult.parts.length} Bagian Dihasilkan
                  </span>
                  <span aria-hidden="true">&middot;</span>
                  <span>Total {formatKb(splitResult.totalBytes)}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>{splitResult.totalLines.toLocaleString('id-ID')} baris</span>
                  {splitResult.losslessRoundTrip && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Lossless 100%</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleSharePartsToGemini(
                        selectedParts.length > 0 ? selectedParts : rangedParts
                      )
                    }
                    disabled={splitResult.parts.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>
                      {selectedParts.length > 0
                        ? `Kirim Terpilih (${selectedParts.length}) ke Gemini`
                        : `Kirim ${rangeBadgeLabel} ke Gemini`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyGeminiPromptPackage(
                        selectedParts.length > 0 ? selectedParts : rangedParts
                      )
                    }
                    disabled={splitResult.parts.length === 0}
                    title="Salin bagian XML utuh sesuai rentang atau pilihan untuk ditempel ke Gemini"
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {copiedId === 'gemini-prompt-pack' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    )}
                    <span>
                      {selectedParts.length > 0
                        ? `Salin Paket (${selectedParts.length} Terpilih)`
                        : `Salin Paket Gemini (${rangeBadgeLabel})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTestRoundTrip}
                    disabled={splitResult.parts.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Uji Gabung Ulang</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendPartsToMerger(splitResult.parts, 'sequential')}
                    disabled={splitResult.parts.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>Kirim ke Penyatu XML</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadAllParts}
                    disabled={splitResult.parts.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh Semua ({splitResult.parts.length})</span>
                  </button>
                </div>
              </div>

              {/* Dedicated Range Picker: Dari Part X Sampai Part Y */}
              {splitResult.parts.length > 0 && (
                <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-blue-950 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span>Pilih Rentang Paket Gemini:</span>
                    </span>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <label htmlFor="range-start-part" className="text-[11px] font-medium text-slate-700">
                        Dari
                      </label>
                      <select
                        id="range-start-part"
                        value={effectiveRangeStart}
                        onChange={(e) => {
                          const nextStart = Number(e.target.value);
                          setRangeStartPart(nextStart);
                          if (nextStart > effectiveRangeEnd) {
                            setRangeEndPart(nextStart);
                          }
                        }}
                        className="px-2 py-1.5 min-h-[34px] text-xs font-medium bg-white border border-blue-200 rounded-lg text-slate-900 max-w-[190px]"
                      >
                        {splitResult.parts.map((p) => (
                          <option key={p.id} value={p.index}>
                            Part #{p.index} — {p.title.slice(0, 26)}
                          </option>
                        ))}
                      </select>

                      <label htmlFor="range-end-part" className="text-[11px] font-medium text-slate-700">
                        sampai
                      </label>
                      <select
                        id="range-end-part"
                        value={effectiveRangeEnd}
                        onChange={(e) => {
                          const nextEnd = Number(e.target.value);
                          setRangeEndPart(nextEnd);
                          if (nextEnd < effectiveRangeStart) {
                            setRangeStartPart(nextEnd);
                          }
                        }}
                        className="px-2 py-1.5 min-h-[34px] text-xs font-medium bg-white border border-blue-200 rounded-lg text-slate-900 max-w-[190px]"
                      >
                        {splitResult.parts.map((p) => (
                          <option key={p.id} value={p.index}>
                            Part #{p.index} — {p.title.slice(0, 26)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <span className="px-2 py-0.5 rounded bg-white border border-blue-200 text-[11px] font-mono text-blue-900 tabular-nums">
                      {rangedParts.length} bagian &middot; {formatKb(rangedTotalBytes)} &middot;{' '}
                      {rangedTotalLines.toLocaleString('id-ID')} baris
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {(effectiveRangeStart !== 1 || effectiveRangeEnd !== splitResult.parts.length) && (
                      <button
                        type="button"
                        onClick={() => {
                          setRangeStartPart(1);
                          setRangeEndPart(splitResult.parts.length);
                        }}
                        className="px-2.5 py-1.5 min-h-[34px] text-[11px] font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
                      >
                        Semua (1–{splitResult.parts.length})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPartIds(rangedParts.map((p) => p.id));
                        onNotify(
                          `${rangedParts.length} bagian (${rangeBadgeLabel}) ditandai pada daftar.`,
                          'info'
                        );
                      }}
                      className="px-2.5 py-1.5 min-h-[34px] text-[11px] font-medium bg-white border border-blue-200 hover:bg-blue-100/60 text-blue-800 rounded-lg cursor-pointer"
                    >
                      Tandai {rangeBadgeLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyGeminiPromptPackage(rangedParts)}
                      className="flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] text-xs font-semibold bg-white border border-blue-300 hover:bg-blue-100/70 text-blue-900 rounded-lg cursor-pointer"
                    >
                      {copiedId === 'gemini-prompt-pack' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-blue-600" />
                      )}
                      <span>Salin Paket {rangeBadgeLabel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSharePartsToGemini(rangedParts)}
                      className="flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Kirim {rangeBadgeLabel}</span>
                    </button>
                  </div>
                </div>
              )}

              {splitResult.warnings.map((w, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{w}</span>
                </div>
              ))}
            </section>

            {/* Filter & Parts List */}
            <section className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={partSearch}
                    onChange={(e) => setPartSearch(e.target.value)}
                    placeholder="Cari nama bagian, ID section, atau isi kode XML..."
                    className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                  {partSearch && (
                    <button
                      type="button"
                      onClick={() => setPartSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                  {filteredSplitParts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const filteredIds = filteredSplitParts.map((p) => p.id);
                        const allSelected = filteredIds.every((id) =>
                          selectedPartIds.includes(id)
                        );
                        setSelectedPartIds((prev) =>
                          allSelected
                            ? prev.filter((id) => !filteredIds.includes(id))
                            : Array.from(new Set([...prev, ...filteredIds]))
                        );
                      }}
                      className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 cursor-pointer"
                    >
                      {filteredSplitParts.every((p) => selectedPartIds.includes(p.id))
                        ? 'Batal Pilih Semua'
                        : 'Pilih Semua untuk Gemini'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(splitResult.manifestJson, 'manifest', 'Manifest JSON')
                    }
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 cursor-pointer"
                  >
                    {copiedId === 'manifest' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Salin Manifest JSON</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {filteredSplitParts.map((part) => {
                  const isExpanded = expandedPartId === part.id;
                  const isSelected = selectedPartIds.includes(part.id);
                  return (
                    <div
                      key={part.id}
                      className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                        isSelected ? 'border-blue-500 ring-1 ring-blue-500/20' : 'border-slate-200'
                      }`}
                    >
                      <div className="p-3 sm:p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectPart(part.id)}
                            aria-label={`Pilih ${part.title} untuk dikirim ke Gemini`}
                            className="mt-1 rounded border-slate-300 cursor-pointer shrink-0"
                          />
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-900 text-white tabular-nums">
                                #{part.index}/{part.total}
                              </span>
                              <h3 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                                {part.title}
                              </h3>
                              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {formatKb(part.byteSize)} &middot; {part.lineCount.toLocaleString('id-ID')} baris
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-blue-700 truncate">
                              {part.filename}
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              {part.note}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSharePartsToGemini([part])}
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-semibold bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 rounded-lg cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Kirim ke Gemini</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPartId(isExpanded ? null : part.id)
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{isExpanded ? 'Tutup Kode' : 'Lihat Kode'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopy(part.content, part.id, part.title)
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer"
                          >
                            {copiedId === part.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>Salin</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              downloadTextBlob(part.content, part.filename);
                              onNotify(`Bagian "${part.filename}" diunduh.`, 'success');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Unduh .xml</span>
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-200 bg-slate-950 text-slate-100 p-3 max-h-80 overflow-auto">
                          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                            {part.content.slice(0, 45000)}
                            {part.content.length > 45000
                              ? '\n\n... (pratinjau dipotong pada 45.000 karakter; unduh .xml untuk isi penuh)'
                              : ''}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          /* MERGER TAB */
          <div className="max-w-6xl mx-auto space-y-4">
            {/* Upload / Add Parts Card */}
            <section className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Penyatu XML (Gabungkan Pecahan atau Modul Template Blogger)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Unggah banyak file <span className="font-mono">.xml</span> atau tempel fragmen CSS/Section/Script, atur urutannya, lalu gabungkan &amp; terapkan langsung ke Pratinjau.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <input
                    ref={mergeFileInputRef}
                    type="file"
                    multiple
                    accept=".xml,.txt,.html,.css,.js"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void addFilesToMerger(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => mergeFileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Pilih Banyak File .xml</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAddActiveXmlAsBase}
                    className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 rounded-lg cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Jadikan XML Aktif Basis</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPartId(null);
                      setManualName('');
                      setManualContent('');
                      setShowManualForm((v) => !v);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    <span>Tempel Potongan</span>
                  </button>
                </div>
              </div>

              {/* Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingMerge(true);
                }}
                onDragLeave={() => setIsDraggingMerge(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingMerge(false);
                  if (e.dataTransfer.files?.length) {
                    void addFilesToMerger(e.dataTransfer.files);
                  }
                }}
                onClick={() => mergeFileInputRef.current?.click()}
                className={`p-4 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
                  isDraggingMerge
                    ? 'border-blue-600 bg-blue-50 text-blue-900'
                    : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 text-slate-600'
                }`}
              >
                <div className="text-xs font-medium">
                  Seret &amp; lepas beberapa file <span className="font-mono">.xml</span> / potongan kode ke sini, atau klik untuk memilih file dari perangkat.
                </div>
              </div>

              {/* Manual Add / Edit Part Form */}
              {showManualForm && (
                <form
                  onSubmit={handleSaveManualPart}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {editingPartId ? 'Edit Isi Potongan XML' : 'Tambah Potongan XML / CSS / Section Manual'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualForm(false);
                        setEditingPartId(null);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Nama bagian (mis: 02-section-sidebar.xml atau custom-css.css)"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                  />
                  <textarea
                    rows={6}
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                    placeholder="Tempel kode XML, <b:section>, <b:widget>, <b:skin>, CSS, atau <script>..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualForm(false);
                        setEditingPartId(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer"
                    >
                      {editingPartId ? 'Simpan Perubahan' : 'Tambahkan ke Daftar'}
                    </button>
                  </div>
                </form>
              )}

              {/* Merge Strategy Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setMergeMode('sequential')}
                  className={`text-left p-3 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                    mergeMode === 'sequential'
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">
                    Mode 1: Gabung Berurutan (Lossless Splitter Reassembly)
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Menyatukan kembali bagian-bagian hasil XML Splitter persis sesuai urutan daftar agar kembali menjadi file XML utuh 100% identik.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMergeMode('smart-blogger')}
                  className={`text-left p-3 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                    mergeMode === 'smart-blogger'
                      ? 'border-emerald-600 bg-emerald-50/70'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">
                    Mode 2: Penyatu Blogger Cerdas (Smart Template Merge)
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Menggabungkan fragmen terpisah (template basis + <span className="font-mono">&lt;b:skin&gt;</span>/CSS + <span className="font-mono">&lt;b:section&gt;</span> + <span className="font-mono">&lt;script&gt;</span>) tanpa menduplikasi tag <span className="font-mono">&lt;html&gt;</span>/<span className="font-mono">&lt;head&gt;</span>.
                  </p>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSortByName}
                      onChange={(e) => setAutoSortByName(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Urutkan otomatis berdasar nama (01, 02...)</span>
                  </label>
                  {mergeMode === 'sequential' && (
                    <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={insertNewlineBetweenParts}
                        onChange={(e) => setInsertNewlineBetweenParts(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>Sisipkan baris baru antar file terpisah</span>
                    </label>
                  )}
                </div>

                {mergeParts.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setMergeParts((prev) =>
                          [...prev].sort((a, b) =>
                            a.name.localeCompare(b.name, undefined, {
                              numeric: true,
                              sensitivity: 'base',
                            })
                          )
                        )
                      }
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 cursor-pointer"
                    >
                      <ArrowUpDown className="w-3 h-3" />
                      <span>Rapikan Urutan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMergeParts([])}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Kosongkan Daftar</span>
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Queued Parts List */}
            {mergeParts.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
                <Combine className="w-8 h-8 text-slate-300 mx-auto" />
                <div className="text-xs font-semibold text-slate-800">
                  Belum ada file atau potongan XML di daftar Penyatu XML
                </div>
                <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
                  Pilih beberapa file <span className="font-mono">.xml</span> dari perangkat, klik <strong>Jadikan XML Aktif Basis</strong>, atau pecah XML di tab <strong>XML Splitter</strong> lalu klik <strong>Kirim ke Penyatu XML</strong>.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left: Ordered Source Parts */}
                <div className="lg:col-span-6 space-y-2">
                  <div className="text-xs font-bold text-slate-800 px-1">
                    Daftar Bagian yang Akan Digabungkan ({mergeParts.filter((p) => p.enabled).length}/{mergeParts.length} aktif)
                  </div>
                  {mergeParts.map((part, idx) => (
                    <div
                      key={part.id}
                      className={`p-3 rounded-xl border transition-colors ${
                        part.enabled
                          ? 'bg-white border-slate-200'
                          : 'bg-slate-50 border-slate-200 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-start gap-2.5 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={part.enabled}
                            onChange={(e) =>
                              setMergeParts((prev) =>
                                prev.map((p) =>
                                  p.id === part.id ? { ...p, enabled: e.target.checked } : p
                                )
                              )
                            }
                            className="mt-1 rounded border-slate-300"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate font-mono">
                              {idx + 1}. {part.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {formatKb(getUtf8Bytes(part.content))} &middot;{' '}
                              {countLines(part.content).toLocaleString('id-ID')} baris
                            </div>
                          </div>
                        </label>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveMergePart(idx, -1)}
                            disabled={idx === 0}
                            title="Naikkan urutan"
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveMergePart(idx, 1)}
                            disabled={idx === mergeParts.length - 1}
                            title="Turunkan urutan"
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPartId(part.id);
                              setManualName(part.name);
                              setManualContent(part.content);
                              setShowManualForm(true);
                            }}
                            title="Edit potongan ini"
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            <Code2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMergeParts((prev) => prev.filter((p) => p.id !== part.id))
                            }
                            title="Hapus dari daftar"
                            className="p-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Right: Merged Result & Validation */}
                <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                        Hasil Penggabungan XML
                      </h3>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        {formatKb(mergeResult.byteSize)} &middot;{' '}
                        {mergeResult.lineCount.toLocaleString('id-ID')} baris &middot;{' '}
                        {mergeResult.sourcePartsCount} bagian aktif
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                        mergeResult.validation.isValid
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                      }`}
                    >
                      {mergeResult.validation.isValid ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {mergeResult.validation.isValid
                          ? 'XML Valid'
                          : `${mergeResult.validation.issues.length} Isu Sintaks`}
                      </span>
                    </span>
                  </div>

                  {mergeResult.summary.length > 0 && (
                    <ul className="space-y-1 text-[11px] text-slate-600 list-disc pl-4">
                      {mergeResult.summary.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ul>
                  )}

                  {mergeResult.warnings.map((w, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                      <span>{w}</span>
                    </div>
                  ))}

                  {/* Primary Merge Actions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!mergeResult.mergedXml}
                      onClick={() =>
                        onApplyMergedXml(
                          mergeResult.mergedXml,
                          `Gabungan XML (${mergeResult.sourcePartsCount} bagian)`,
                          'preview'
                        )
                      }
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[42px] text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Terapkan ke Pratinjau</span>
                    </button>

                    <button
                      type="button"
                      disabled={!mergeResult.mergedXml}
                      onClick={() =>
                        onApplyMergedXml(
                          mergeResult.mergedXml,
                          `Gabungan XML (${mergeResult.sourcePartsCount} bagian)`,
                          'editor'
                        )
                      }
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[42px] text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      <span>Buka di Editor XML</span>
                    </button>

                    <button
                      type="button"
                      disabled={!mergeResult.mergedXml}
                      onClick={() =>
                        void handleCopy(
                          mergeResult.mergedXml,
                          'merged-xml',
                          'XML Hasil Gabungan'
                        )
                      }
                      className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-800 rounded-lg cursor-pointer"
                    >
                      {copiedId === 'merged-xml' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Salin XML Gabungan</span>
                    </button>

                    <button
                      type="button"
                      disabled={!mergeResult.mergedXml}
                      onClick={async () => {
                        const res = await downloadXmlFile(
                          mergeResult.mergedXml,
                          `${parsedInfo.templateTitle || 'temaloka'}-gabungan`
                        );
                        if (res.method !== 'cancelled') {
                          onNotify(`XML gabungan diunduh (${res.filename}).`, 'success');
                        }
                      }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 text-emerald-900 rounded-lg cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh XML Gabungan</span>
                    </button>
                  </div>

                  {/* Toggle Preview Code */}
                  {mergeResult.mergedXml && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setShowMergedPreview((v) => !v)}
                        className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                      >
                        {showMergedPreview
                          ? 'Sembunyikan Pratinjau Kode Gabungan'
                          : 'Lihat Pratinjau Kode Gabungan'}
                      </button>
                      {showMergedPreview && (
                        <div className="mt-2 rounded-lg bg-slate-950 text-slate-100 p-3 max-h-72 overflow-auto">
                          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                            {mergeResult.mergedXml.slice(0, 45000)}
                            {mergeResult.mergedXml.length > 45000
                              ? '\n\n... (pratinjau dipotong pada 45.000 karakter)'
                              : ''}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
