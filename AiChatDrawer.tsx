import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Cpu,
  FileCode2,
  Loader2,
  LogIn,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import { getGeminiModelOption } from '../lib/aiEngineCatalog';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { runChatPromptOnLocalAi, type WorkspaceAiPage } from '../lib/offlineAiRuntime';
import type { ParsedTemplateInfo } from '../types/blogger';
import { AiEngineSelectorCard } from './AiEngineSelectorCard';

interface AiChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activePage: WorkspaceAiPage;
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  isOfflineMode: boolean;
  xmlIssuesCount: number;
  aiSignaturesCount: number;
  onApplySuggestedCss: (css: string) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const PAGE_LABELS: Record<WorkspaceAiPage, string> = {
  preview: 'Pratinjau',
  layout: 'Tata Letak',
  seo: 'SEO & Iklan',
  errors: 'Diagnosa Error',
  editor: 'Editor XML',
  inspector: 'Inspektor',
  console: 'Konsol URL',
  splitter: 'Splitter XML',
};

const QUICK_PROMPTS_BY_PAGE: Record<WorkspaceAiPage, string[]> = {
  preview: [
    'Buat CSS agar kartu artikel dan tampilan mobile lebih rapi',
    'Apa kelemahan tata letak template XML ini?',
  ],
  layout: [
    'Analisa struktur b:section dan b:widget pada template ini',
    'Saran penempatan slot widget iklan yang rapi',
  ],
  seo: [
    'Periksa kesiapan SEO, meta tag, dan skrip AdSense di XML ini',
    'Meta tag penting apa yang belum ada di template ini?',
  ],
  errors: [
    'Diagnosa potensi error SAXParseException saat simpan di Blogger',
    'Jelaskan cara aman membungkus script dalam CDATA XML',
  ],
  editor: [
    'Review bagian head & b:skin template XML yang aktif',
    'Buat CSS tombol & link hover yang modern untuk template ini',
  ],
  inspector: [
    'Bagaimana cara meringankan CSS mati & script duplikat di XML ini?',
    'Apakah ada tanda tangan AI atau kode mencurigakan di XML ini?',
  ],
  console: [
    'Jelaskan cara kerja query parameter URL yang ada di XML ini',
    'Berikan contoh skrip console JS untuk menguji navigasi template',
  ],
  splitter: [
    'Bagian mana dari template XML ini yang paling aman dipecah untuk diedit terpisah?',
    'Jelaskan perbedaan Gabung Berurutan vs Penyatu Blogger Cerdas untuk XML ini',
  ],
};

function renderFormattedMessage(
  content: string,
  onCopyCode: (code: string) => void,
  onApplyCss?: (css: string) => void
) {
  const blocks = content.split(/(```[\s\S]*?```)/g);
  return blocks.map((part, idx) => {
    const codeMatch = /^```([a-zA-Z0-9_-]*)\s*\n?([\s\S]*?)```$/.exec(part.trim());
    if (codeMatch) {
      const lang = (codeMatch[1] || 'code').toLowerCase();
      const code = codeMatch[2].trim();
      return (
        <div
          key={idx}
          className="my-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-100 overflow-hidden"
        >
          <div className="flex items-center justify-between px-2.5 py-1 bg-slate-800 border-b border-slate-700 text-[10px] text-slate-300">
            <span className="font-mono uppercase">{lang}</span>
            <div className="flex items-center gap-2">
              {lang === 'css' && onApplyCss && (
                <button
                  type="button"
                  onClick={() => onApplyCss(code)}
                  className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                >
                  Terapkan CSS
                </button>
              )}
              <button
                type="button"
                onClick={() => onCopyCode(code)}
                className="flex items-center gap-1 hover:text-white cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>Salin</span>
              </button>
            </div>
          </div>
          <pre className="p-2.5 text-[11px] font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-words">
            {code}
          </pre>
        </div>
      );
    }

    return (
      <div key={idx} className="whitespace-pre-wrap break-words leading-relaxed">
        {part}
      </div>
    );
  });
}

export const AiChatDrawer: React.FC<AiChatDrawerProps> = ({
  isOpen,
  onClose,
  activePage,
  xml,
  parsedInfo,
  offlineAi,
  isOfflineMode,
  xmlIssuesCount,
  aiSignaturesCount,
  onApplySuggestedCss,
  onNotify,
}) => {
  const {
    user,
    isSigningIn,
    signInWithGoogle,
    engineMode,
    setEngineMode,
    geminiModel,
    quota,
    chatMessages,
    attachedXmlParts,
    removeAttachedXmlPart,
    clearAttachedXmlParts,
    appendChatMessages,
    clearChatMessages,
    authorizedGeminiFetch,
  } = useAuthAndAi();

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showEnginePicker, setShowEnginePicker] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const effectiveMode = isOfflineMode ? 'local' : engineMode;
  const activeGeminiMeta = getGeminiModelOption(geminiModel);

  const attachedTotalBytes = useMemo(
    () => attachedXmlParts.reduce((acc, p) => acc + p.byteSize, 0),
    [attachedXmlParts]
  );
  const attachedTotalLines = useMemo(
    () => attachedXmlParts.reduce((acc, p) => acc + p.lineCount, 0),
    [attachedXmlParts]
  );

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, chatMessages.length, isSending]);

  const templateContext = useMemo(() => {
    const sections = parsedInfo.sections
      .slice(0, 15)
      .map((s) => `${s.id} (${s.widgetCount} widget)`)
      .join(', ');
    const varNames = parsedInfo.variables
      .slice(0, 20)
      .map((v) => `${v.name}=${v.value}`)
      .join('; ');
    const xmlExcerpt =
      attachedXmlParts.length > 0
        ? `(Ringkasan saja — ${attachedXmlParts.length} bagian XML utuh dilampirkan lengkap di bawah via XML Splitter)`
        : xml.slice(0, 18000);
    return [
      `Judul Template: ${parsedInfo.templateTitle}`,
      `Ukuran XML: ${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB (${parsedInfo.byteBreakdown.lineCount} baris)`,
      `Jumlah Section: ${parsedInfo.sections.length} [${sections || '-'}]`,
      `Jumlah Widget: ${parsedInfo.widgets.length} · Variabel: ${parsedInfo.variables.length}`,
      `Error XML Terdeteksi: ${xmlIssuesCount} · AI Signature: ${aiSignaturesCount}`,
      `Meta Viewport: ${parsedInfo.hasViewportMeta ? 'Ada' : 'Belum Ada'} · b:skin: ${parsedInfo.hasSkin ? 'Ada' : 'Tidak Ada'}`,
      varNames ? `Contoh Variabel: ${varNames}` : '',
      `Cuplikan / Status XML:\n${xmlExcerpt}`,
    ]
      .filter(Boolean)
      .join('\n');
  }, [parsedInfo, xml, xmlIssuesCount, aiSignaturesCount, attachedXmlParts.length]);

  if (!isOpen) return null;

  const handleCopy = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (id) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
      }
      onNotify('Kode berhasil disalin ke clipboard.', 'success');
    } catch {
      onNotify('Gagal menyalin teks.', 'error');
    }
  };

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isSending) return;

    if (effectiveMode === 'gemini' && !user) {
      onNotify('Silakan Login Google terlebih dahulu untuk chat dengan Gemini Cloud.', 'info');
      return;
    }

    setInput('');
    setIsSending(true);

    try {
      const historyPayload = chatMessages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const attachedTag =
        attachedXmlParts.length > 0
          ? `[Lampiran Utuh: ${attachedXmlParts.length} bagian XML · ${(attachedTotalBytes / 1024).toFixed(1)} KB (${attachedXmlParts.map((p) => `#${p.index} ${p.title}`).slice(0, 4).join(', ')}${attachedXmlParts.length > 4 ? ', ...' : ''})]\n`
          : '';
      const storedUserMessage = `${attachedTag}${trimmed}`.slice(0, 12000);

      if (effectiveMode === 'gemini') {
        const res = await authorizedGeminiFetch<{
          reply: string;
          suggestedCss?: string;
          engineLabel: string;
          modelId: string;
        }>('/api/ai/chat', {
          message: trimmed,
          activePage,
          templateContext,
          attachedParts: attachedXmlParts.map((p) => ({
            index: p.index,
            total: p.total,
            filename: p.filename,
            title: p.title,
            byteSize: p.byteSize,
            lineCount: p.lineCount,
            content: p.content,
          })),
          history: historyPayload,
        });

        await appendChatMessages(
          {
            role: 'user',
            content: storedUserMessage,
            engineLabel: res.engineLabel || activeGeminiMeta.label,
            modelId: res.modelId || geminiModel,
            pageContext: activePage,
          },
          {
            role: 'assistant',
            content: res.reply,
            engineLabel: res.engineLabel || activeGeminiMeta.label,
            modelId: res.modelId || geminiModel,
            suggestedCss: res.suggestedCss,
            pageContext: activePage,
          }
        );
      } else {
        const localAttachedText =
          attachedXmlParts.length > 0
            ? `${templateContext}\n\n${attachedXmlParts
                .map((p) => `--- ${p.filename} ---\n${p.content}`)
                .join('\n\n')}`
            : templateContext;

        const localRes = await runChatPromptOnLocalAi(offlineAi.config, {
          activePage,
          templateContext: localAttachedText,
          parsedInfo,
          history: historyPayload,
          message: trimmed,
        });

        await appendChatMessages(
          {
            role: 'user',
            content: storedUserMessage,
            engineLabel: localRes.engineLabel,
            modelId: offlineAi.config.runtime,
            pageContext: activePage,
          },
          {
            role: 'assistant',
            content: localRes.reply,
            engineLabel: localRes.engineLabel,
            modelId: offlineAi.config.runtime,
            suggestedCss: localRes.suggestedCss,
            pageContext: activePage,
          }
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim pesan Chat AI.';
      onNotify(msg, 'error');
      setInput(trimmed);
    } finally {
      setIsSending(false);
    }
  };

  const quickPrompts =
    attachedXmlParts.length > 0
      ? [
          'Baca seluruh bagian XML yang dilampirkan secara utuh dan jelaskan fungsi utamanya',
          'Periksa error sintaks, tag belum tertutup, atau script bermasalah di bagian XML ini',
          'Buatkan perbaikan kode atau CSS yang siap tempel untuk bagian XML terlampir',
        ]
      : QUICK_PROMPTS_BY_PAGE[activePage] || QUICK_PROMPTS_BY_PAGE.preview;

  return (
    <>
      {/* Backdrop for tablet/desktop overlay transitions */}
      <div
        className="lg:hidden fixed inset-0 z-40 bg-slate-900/50"
        onClick={onClose}
      />

      <aside className="fixed inset-0 lg:static lg:inset-auto z-50 w-full lg:w-[370px] xl:w-[410px] shrink-0 bg-white lg:border-l lg:border-slate-200 flex flex-col h-[100dvh] max-h-[100dvh] lg:h-full lg:max-h-full shadow-2xl lg:shadow-none overflow-hidden">
        {/* Header */}
        <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200 bg-slate-50 space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs sm:text-xs font-bold text-slate-900 truncate">
                  Chat AI TemaLoka
                </h2>
                <div className="text-[11px] text-slate-600 truncate font-medium">
                  {effectiveMode === 'gemini'
                    ? `${activeGeminiMeta.shortLabel}`
                    : `${offlineAi.activeMeta.shortName}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowEnginePicker((v) => !v)}
                title="Pilih Mesin AI (Gemini atau AI Lokal)"
                className={`flex items-center gap-1 px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-[32px] rounded-lg border text-[11px] font-semibold cursor-pointer ${
                  showEnginePicker
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Mesin</span>
              </button>
              {chatMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clearChatMessages()}
                  title="Hapus riwayat percakapan"
                  className="p-2 sm:p-1.5 min-h-[38px] min-w-[38px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup Chat AI"
                className="p-2 sm:p-1.5 min-h-[38px] min-w-[38px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dedicated Always-Visible Quota / Limit & Active Tab Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              {effectiveMode === 'gemini' ? (
                <span className="font-mono font-semibold text-blue-700 tabular-nums">
                  Limit Gemini: Sisa {quota.remaining}/{quota.dailyLimit}
                </span>
              ) : (
                <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                  AI Lokal · Tanpa Limit (0 Kuota)
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600 shrink-0">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                {PAGE_LABELS[activePage]}
              </span>
            </div>
          </div>

          {showEnginePicker && (
            <div className="pt-1 max-h-[42dvh] overflow-y-auto pr-0.5">
              <AiEngineSelectorCard
                offlineAi={offlineAi}
                isOfflineMode={isOfflineMode}
                compact
              />
            </div>
          )}

          {attachedXmlParts.length > 0 && (
            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 font-semibold text-blue-950 min-w-0">
                  <FileCode2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span className="truncate">
                    Lampiran XML Utuh ({attachedXmlParts.length} bagian ·{' '}
                    {(attachedTotalBytes / 1024).toFixed(1)} KB ·{' '}
                    {attachedTotalLines.toLocaleString('id-ID')} baris)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearAttachedXmlParts}
                  className="text-[10px] font-semibold text-blue-800 hover:text-rose-700 shrink-0 cursor-pointer"
                >
                  Hapus Semua
                </button>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {attachedXmlParts.map((part) => (
                  <span
                    key={part.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-blue-200 text-[10px] font-mono text-slate-800 whitespace-nowrap shrink-0"
                    title={`${part.filename} (${(part.byteSize / 1024).toFixed(1)} KB)`}
                  >
                    <span>
                      #{part.index}/{part.total} · {(part.byteSize / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachedXmlPart(part.id)}
                      aria-label={`Hapus lampiran ${part.filename}`}
                      className="text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-blue-900 leading-snug">
                  Dikirim 100% utuh ke Gemini tanpa terpotong saat Anda mengirim pesan.
                </p>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={() =>
                    void sendMessage(
                      `Baca seluruh ${attachedXmlParts.length} bagian XML terlampir secara utuh dari awal hingga akhir, lalu jelaskan struktur, fungsi utama, dan potensi error atau perbaikannya.`
                    )
                  }
                  className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Analisa Utuh
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Message List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 bg-white">
          {effectiveMode === 'gemini' && !user && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Masuk Google untuk Memakai Gemini</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                Login Google menjaga riwayat chat &amp; kuota harian ({quota.dailyLimit}/hari) akun Anda. Atau beralih ke AI Lokal agar gratis tanpa login.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  disabled={isSigningIn}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold rounded-lg cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{isSigningIn ? 'Menghubungkan...' : 'Masuk Google'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngineMode('local')}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] bg-white border border-amber-300 text-amber-950 text-[11px] font-semibold rounded-lg hover:bg-amber-100/60 cursor-pointer"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Pakai AI Lokal</span>
                </button>
              </div>
            </div>
          )}

          {chatMessages.length === 0 ? (
            <div className="py-4 px-1 text-center space-y-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
                <Bot className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-slate-900">
                  Tanya Tentang "{parsedInfo.templateTitle}"
                </h3>
                <p className="text-[11px] text-slate-500 leading-relaxed max-w-[290px] mx-auto">
                  Asisten membaca struktur section, widget, CSS, error XML, parameter URL, &amp; SEO template aktif.
                </p>
              </div>
              <div className="space-y-1.5 pt-1 text-left">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1">
                  Saran Cepat ({PAGE_LABELS[activePage]})
                </div>
                {quickPrompts.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void sendMessage(q)}
                    className="w-full text-left px-3 py-2.5 min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 text-[11px] text-slate-700 transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chatMessages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[92%] rounded-xl px-3 py-2.5 text-xs space-y-1.5 ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-50 border border-slate-200 text-slate-800'
                    }`}
                  >
                    {!isUser && (
                      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 border-b border-slate-200/70 pb-1">
                        <span className="font-semibold text-blue-700 truncate">
                          {msg.engineLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopy(msg.content, msg.id)}
                          className="flex items-center gap-1 hover:text-slate-900 cursor-pointer shrink-0"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    )}
                    <div>
                      {renderFormattedMessage(
                        msg.content,
                        (code) => void handleCopy(code),
                        !isUser ? onApplySuggestedCss : undefined
                      )}
                    </div>
                    {!isUser && msg.suggestedCss && !/```css/i.test(msg.content) && (
                      <button
                        type="button"
                        onClick={() => onApplySuggestedCss(msg.suggestedCss || '')}
                        className="mt-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded-lg cursor-pointer"
                      >
                        Terapkan CSS ke Pratinjau
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {isSending && (
            <div className="flex items-start">
              <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span>
                  {effectiveMode === 'gemini'
                    ? `${activeGeminiMeta.shortLabel} sedang menganalisis XML...`
                    : `${offlineAi.activeMeta.shortName} sedang memproses...`}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200 bg-slate-50 shrink-0"
        >
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(input);
                }
              }}
              placeholder={
                effectiveMode === 'gemini'
                  ? `Tanya ${activeGeminiMeta.shortLabel} tentang XML ini...`
                  : `Tanya ${offlineAi.activeMeta.shortName} (0 kuota)...`
              }
              className="flex-1 min-h-[44px] px-3 py-2 text-sm sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-none"
            />
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              aria-label="Kirim pesan AI"
              className="h-[46px] sm:h-[52px] min-w-[46px] px-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
};
