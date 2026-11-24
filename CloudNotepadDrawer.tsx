import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudOff,
  CloudUpload,
  Copy,
  Download,
  FilePlus2,
  Loader2,
  LogIn,
  NotebookPen,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import {
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  NOTE_TAG_LABELS,
  type CloudNotepadNote,
  type NoteTag,
} from '../hooks/useCloudNotepad';

export interface CloudNotepadController {
  notes: CloudNotepadNote[];
  activeNote: CloudNotepadNote | null;
  selectedNoteId: string;
  setSelectedNoteId: (id: string) => void;
  cloudLoading: boolean;
  cloudCount: number;
  dirtyCount: number;
  savingNoteIds: Record<string, boolean>;
  deletingNoteIds: Record<string, boolean>;
  createNewNote: (prefill?: { title?: string; content?: string; tag?: NoteTag }) => string;
  updateDraftNote: (
    noteId: string,
    patch: Partial<Pick<CloudNotepadNote, 'title' | 'content' | 'tag' | 'pinned' | 'templateHint'>>
  ) => void;
  saveNoteToCloud: (noteId: string) => Promise<boolean>;
  discardLocalChanges: (noteId: string) => void;
  deleteNote: (noteId: string) => Promise<boolean>;
}

interface CloudNotepadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notepad: CloudNotepadController;
  activeTemplateTitle: string;
  sourceLabel: string;
  xmlByteSize: number;
  isOfflineMode: boolean;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const TAG_BADGE_CLASS: Record<NoteTag, string> = {
  umum: 'bg-slate-100 text-slate-700 border-slate-200',
  xml: 'bg-blue-50 text-blue-700 border-blue-200',
  css: 'bg-violet-50 text-violet-700 border-violet-200',
  url: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ide: 'bg-amber-50 text-amber-800 border-amber-200',
};

function formatTimeShort(ms: number | null): string {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let keyIdx = 0;

  while (cursor < text.length) {
    const idx = lowerText.indexOf(lowerQ, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <mark
        key={keyIdx++}
        className="bg-amber-200 text-slate-900 rounded px-0.5 font-semibold"
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    cursor = idx + q.length;
  }

  return parts.length > 0 ? parts : text;
}

function getContextualSnippet(content: string, query: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '(Kosong)';
  const q = query.trim().toLowerCase();
  if (!q) return trimmed;
  const idx = trimmed.toLowerCase().indexOf(q);
  if (idx === -1) return trimmed;
  const start = Math.max(0, idx - 32);
  const end = Math.min(trimmed.length, idx + q.length + 72);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < trimmed.length ? '...' : '';
  return `${prefix}${trimmed.slice(start, end)}${suffix}`;
}

export const CloudNotepadDrawer: React.FC<CloudNotepadDrawerProps> = ({
  isOpen,
  onClose,
  notepad,
  activeTemplateTitle,
  sourceLabel,
  xmlByteSize,
  isOfflineMode,
  onNotify,
}) => {
  const { user, isSigningIn, signInWithGoogle } = useAuthAndAi();
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<'all' | NoteTag>('all');
  const [sortBy, setSortBy] = useState<'updated-desc' | 'updated-asc' | 'title-asc'>(
    'updated-desc'
  );
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    notes,
    activeNote,
    selectedNoteId,
    setSelectedNoteId,
    cloudLoading,
    cloudCount,
    dirtyCount,
    savingNoteIds,
    deletingNoteIds,
    createNewNote,
    updateDraftNote,
    saveNoteToCloud,
    discardLocalChanges,
    deleteNote,
  } = notepad;

  // Automatically switch to editor when a note is newly created or none exists yet on mobile
  useEffect(() => {
    if (!isOpen) {
      setConfirmDeleteId(null);
      return;
    }
    if (notes.length === 0) {
      setMobileView('list');
    }
  }, [isOpen, notes.length]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = notes.filter((note) => {
      if (tagFilter !== 'all' && note.tag !== tagFilter) return false;
      if (!q) return true;
      return (
        note.title.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q) ||
        note.templateHint.toLowerCase().includes(q) ||
        NOTE_TAG_LABELS[note.tag].toLowerCase().includes(q)
      );
    });

    return [...matched].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortBy === 'updated-asc') {
        return a.updatedAtMs - b.updatedAtMs;
      }
      if (sortBy === 'title-asc') {
        const cmp = (a.title || 'Catatan Tanpa Judul').localeCompare(
          b.title || 'Catatan Tanpa Judul',
          'id',
          { sensitivity: 'base', numeric: true }
        );
        return cmp !== 0 ? cmp : b.updatedAtMs - a.updatedAtMs;
      }
      return b.updatedAtMs - a.updatedAtMs;
    });
  }, [notes, searchQuery, tagFilter, sortBy]);

  const activeContentMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !activeNote?.content) return [];
    const text = activeNote.content.toLowerCase();
    const indices: number[] = [];
    let pos = 0;
    while (pos < text.length) {
      const found = text.indexOf(q, pos);
      if (found === -1) break;
      indices.push(found);
      pos = found + Math.max(1, q.length);
      if (indices.length >= 200) break;
    }
    return indices;
  }, [activeNote?.content, searchQuery]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery, activeNote?.id]);

  if (!isOpen) return null;

  const handleCreateNote = (prefill?: { title?: string; content?: string; tag?: NoteTag }) => {
    createNewNote(prefill);
    setConfirmDeleteId(null);
    setMobileView('editor');
  };

  const handleSelectNote = (id: string) => {
    setSelectedNoteId(id);
    setConfirmDeleteId(null);
    setMobileView('editor');
  };

  const handleSaveToCloud = async (noteId: string) => {
    try {
      await saveNoteToCloud(noteId);
    } catch {
      // Error already surfaced via onNotify & handleFirestoreError
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setConfirmDeleteId(null);
    try {
      await deleteNote(noteId);
      setMobileView('list');
    } catch {
      // Error already surfaced via onNotify & handleFirestoreError
    }
  };

  const handleCopyContent = async (note: CloudNotepadNote) => {
    try {
      const payload = note.title ? `${note.title}\n\n${note.content}` : note.content;
      await navigator.clipboard.writeText(payload);
      setCopiedId(note.id);
      setTimeout(() => setCopiedId(null), 1500);
      onNotify('Isi catatan disalin ke clipboard.', 'success');
    } catch {
      onNotify('Gagal menyalin catatan.', 'error');
    }
  };

  const handleDownloadTxt = (note: CloudNotepadNote) => {
    const safeName = (note.title || 'catatan-temaloka')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const body = `${note.title}\nKategori: ${NOTE_TAG_LABELS[note.tag]}\nDiperbarui: ${formatTimeShort(note.updatedAtMs)}\n\n${note.content}\n`;
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName || 'catatan'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onNotify('Catatan diunduh sebagai file .txt.', 'success');
  };

  const handleInsertTemplateInfo = (note: CloudNotepadNote) => {
    const stamp = `[Template: ${activeTemplateTitle} | Sumber: ${sourceLabel} | ${(xmlByteSize / 1024).toFixed(1)} KB]`;
    const nextContent = note.content
      ? `${note.content.trimEnd()}\n\n${stamp}\n`
      : `${stamp}\n`;
    updateDraftNote(note.id, {
      content: nextContent,
      templateHint: activeTemplateTitle,
    });
    onNotify('Info template XML aktif ditambahkan ke catatan.', 'info');
  };

  const jumpToContentMatch = (direction: 1 | -1) => {
    const el = textareaRef.current;
    const qLen = searchQuery.trim().length;
    if (!el || activeContentMatches.length === 0 || qLen === 0) return;
    const total = activeContentMatches.length;
    const nextIdx = (activeMatchIndex + direction + total) % total;
    setActiveMatchIndex(nextIdx);
    const start = activeContentMatches[nextIdx];
    el.focus();
    el.setSelectionRange(start, start + qLen);
  };

  const isSavingActive = activeNote ? Boolean(savingNoteIds[activeNote.id]) : false;
  const isDeletingActive = activeNote ? Boolean(deletingNoteIds[activeNote.id]) : false;
  const charCount = activeNote ? activeNote.content.length : 0;
  const lineCount = activeNote ? activeNote.content.split('\n').length : 0;
  const hasActiveFilter = searchQuery.trim().length > 0 || tagFilter !== 'all';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Responsive Full-Height Drawer */}
      <section
        aria-label="Notepad Cloud TemaLoka"
        className="relative z-10 w-full md:w-[740px] lg:w-[820px] max-w-full h-[100dvh] max-h-[100dvh] bg-white md:border-l md:border-slate-200 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Drawer Header */}
        <header className="px-3.5 sm:px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {mobileView === 'editor' && activeNote && (
              <button
                type="button"
                onClick={() => setMobileView('list')}
                aria-label="Kembali ke daftar catatan"
                className="md:hidden p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <NotebookPen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 truncate">
                  Notepad Akun
                </h2>
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-white border border-slate-200 text-slate-700 tabular-nums shrink-0">
                  {cloudCount} Cloud · {dirtyCount} Draft
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {user
                  ? `Akun: ${user.email || user.displayName || 'Google'} · Tersimpan privat setelah klik Simpan di Cloud`
                  : 'Mode Tamu (Draft Lokal) · Login Google untuk menyimpan ke Cloud akun Anda'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleCreateNote()}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[38px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Catatan Baru</span>
              <span className="sm:hidden">Baru</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup Notepad"
              className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Auth Prompt Banner if Guest */}
        {!user && (
          <div className="px-3.5 sm:px-5 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex items-center gap-2 text-amber-950 min-w-0">
              <CloudOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="leading-snug">
                Catatan Anda tersimpan sementara di browser. Masuk akun Google agar bisa menekan <strong>Simpan di Cloud</strong> ke akun masing-masing.
              </span>
            </div>
            <button
              type="button"
              disabled={isSigningIn || isOfflineMode}
              onClick={() => void signInWithGoogle()}
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{isSigningIn ? 'Menghubungkan...' : 'Masuk Google'}</span>
            </button>
          </div>
        )}

        {/* Global Text Search & Sort Bar (Always visible on Desktop & Smartphone) */}
        <div className="px-3.5 sm:px-5 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim() && mobileView === 'editor') {
                  setMobileView('list');
                }
              }}
              placeholder="Cari catatan berdasarkan kata kunci (judul, isi, kategori)..."
              aria-label="Cari catatan berdasarkan kata kunci"
              className="w-full pl-9 pr-9 py-2 min-h-[38px] text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 focus:bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Bersihkan kata kunci pencarian"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="relative flex items-center">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
              <select
                aria-label="Urutkan catatan"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as 'updated-desc' | 'updated-asc' | 'title-asc'
                  )
                }
                className="pl-8 pr-3 py-2 min-h-[38px] text-xs font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 cursor-pointer"
              >
                <option value="updated-desc">Terbaru Diubah</option>
                <option value="updated-asc">Terlama Diubah</option>
                <option value="title-asc">Judul (A-Z)</option>
              </select>
            </label>

            <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
              {hasActiveFilter
                ? `${filteredNotes.length}/${notes.length} cocok`
                : `${notes.length} catatan`}
            </span>
          </div>
        </div>

        {/* Body: 2-Pane on Desktop, Single Switchable View on Smartphone */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left Pane: Notes List */}
          <aside
            className={`${
              mobileView === 'list' ? 'flex' : 'hidden md:flex'
            } w-full md:w-64 lg:w-72 shrink-0 border-r border-slate-200 bg-slate-50/70 flex-col min-h-0 overflow-hidden`}
          >
            {/* Tag Filters */}
            <div className="p-2.5 border-b border-slate-200 bg-white shrink-0">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                {(['all', 'umum', 'xml', 'css', 'url', 'ide'] as const).map((t) => {
                  const active = tagFilter === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTagFilter(t)}
                      className={`px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {t === 'all' ? 'Semua' : NOTE_TAG_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5">
              {cloudLoading && notes.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Memuat catatan Cloud akun Anda...</span>
                </div>
              ) : filteredNotes.length === 0 ? (
                <div className="py-8 px-3 text-center space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                    {hasActiveFilter ? (
                      <Search className="w-4 h-4" />
                    ) : (
                      <NotebookPen className="w-4 h-4" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-800">
                      {notes.length === 0
                        ? 'Belum ada catatan di Notepad'
                        : `Tidak ada catatan untuk "${searchQuery.trim() || NOTE_TAG_LABELS[tagFilter as NoteTag]}"`}
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {hasActiveFilter
                        ? 'Coba ubah kata kunci atau reset filter kategori untuk melihat semua catatan.'
                        : 'Buat catatan kode XML, CSS custom, daftar URL uji, atau pengingat template lalu tekan Simpan di Cloud.'}
                    </p>
                  </div>
                  {hasActiveFilter ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setTagFilter('all');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Pencarian</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        handleCreateNote({
                          title: `Catatan ${activeTemplateTitle}`.slice(0, MAX_NOTE_TITLE_LENGTH),
                          tag: 'xml',
                          content: '',
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      <FilePlus2 className="w-3.5 h-3.5" />
                      <span>Buat Catatan Pertama</span>
                    </button>
                  )}
                </div>
              ) : (
                filteredNotes.map((note) => {
                  const selected = note.id === activeNote?.id;
                  const isSaving = Boolean(savingNoteIds[note.id]);
                  const snippet = getContextualSnippet(note.content, searchQuery);
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => handleSelectNote(note.id)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer space-y-1.5 ${
                        selected
                          ? 'bg-white border-blue-500 ring-1 ring-blue-500/20 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {note.pinned && (
                            <Pin className="w-3 h-3 text-amber-600 shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {renderHighlightedText(
                              note.title || 'Catatan Tanpa Judul',
                              searchQuery
                            )}
                          </span>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-medium rounded border shrink-0 ${
                            TAG_BADGE_CLASS[note.tag]
                          }`}
                        >
                          {NOTE_TAG_LABELS[note.tag]}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-snug break-words">
                        {renderHighlightedText(snippet, searchQuery)}
                      </p>

                      <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px]">
                        <span className="text-slate-400 font-mono tabular-nums">
                          {formatTimeShort(note.updatedAtMs)}
                        </span>
                        {isSaving ? (
                          <span className="text-blue-700 font-semibold flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Menyimpan...</span>
                          </span>
                        ) : note.dirty ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                            Belum ke Cloud
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1">
                            <Cloud className="w-2.5 h-2.5" />
                            <span>Cloud</span>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right Pane: Active Note Editor */}
          <div
            className={`${
              mobileView === 'editor' ? 'flex' : 'hidden md:flex'
            } flex-1 min-w-0 flex-col bg-white min-h-0 overflow-hidden`}
          >
            {!activeNote ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
                  <NotebookPen className="w-5 h-5" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h3 className="text-sm font-bold text-slate-900">
                    Pilih atau Buat Catatan Baru
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Simpan catatan CSS, snippet XML Blogger, parameter URL, atau daftar perbaikan Anda lalu tekan <strong>Simpan di Cloud</strong> untuk menyimpannya di akun Google pribadi Anda.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCreateNote()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  <FilePlus2 className="w-4 h-4" />
                  <span>Buat Catatan Baru</span>
                </button>
              </div>
            ) : (
              <>
                {/* Note Metadata & Tools Toolbar */}
                <div className="px-3.5 sm:px-5 py-3 border-b border-slate-200 space-y-2.5 shrink-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={MAX_NOTE_TITLE_LENGTH}
                      value={activeNote.title}
                      onChange={(e) =>
                        updateDraftNote(activeNote.id, { title: e.target.value })
                      }
                      placeholder="Judul catatan..."
                      aria-label="Judul catatan"
                      className="flex-1 min-w-0 px-3 py-2 min-h-[40px] text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                    <select
                      aria-label="Kategori catatan"
                      value={activeNote.tag}
                      onChange={(e) =>
                        updateDraftNote(activeNote.id, {
                          tag: e.target.value as NoteTag,
                        })
                      }
                      className="px-2.5 py-2 min-h-[40px] text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 cursor-pointer"
                    >
                      {(Object.keys(NOTE_TAG_LABELS) as NoteTag[]).map((tagKey) => (
                        <option key={tagKey} value={tagKey}>
                          {NOTE_TAG_LABELS[tagKey]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Quick Actions Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateDraftNote(activeNote.id, {
                            pinned: !activeNote.pinned,
                          })
                        }
                        className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-lg border text-[11px] font-medium cursor-pointer ${
                          activeNote.pinned
                            ? 'bg-amber-50 border-amber-300 text-amber-900'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {activeNote.pinned ? (
                          <PinOff className="w-3.5 h-3.5" />
                        ) : (
                          <Pin className="w-3.5 h-3.5" />
                        )}
                        <span>{activeNote.pinned ? 'Lepas Pin' : 'Pin'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInsertTemplateInfo(activeNote)}
                        className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                        <span>Info Template</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleCopyContent(activeNote)}
                        className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer"
                      >
                        {copiedId === activeNote.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>Salin</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadTxt(activeNote)}
                        className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>.TXT</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {activeNote.inCloud && activeNote.dirty && (
                        <button
                          type="button"
                          onClick={() => discardLocalChanges(activeNote.id)}
                          title="Batalkan edit lokal dan pulihkan versi Cloud terakhir"
                          className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-medium cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset Cloud</span>
                        </button>
                      )}

                      {confirmDeleteId === activeNote.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isDeletingActive}
                            onClick={() => void handleDeleteNote(activeNote.id)}
                            className="px-2.5 py-1.5 min-h-[34px] rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                          >
                            {isDeletingActive ? 'Menghapus...' : 'Ya, Hapus'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 min-h-[34px] rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(activeNote.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-[11px] font-medium cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Main Textarea Area */}
                <div className="flex-1 min-h-0 p-3.5 sm:p-5 flex flex-col gap-2">
                  {searchQuery.trim() && activeContentMatches.length > 0 && (
                    <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-[11px] text-amber-950 shrink-0">
                      <span className="font-medium truncate tabular-nums">
                        Ditemukan <strong>{activeContentMatches.length}</strong> kecocokan untuk &ldquo;{searchQuery.trim()}&rdquo;
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-mono text-[10px] text-amber-800 tabular-nums mr-1">
                          {activeMatchIndex + 1}/{activeContentMatches.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => jumpToContentMatch(-1)}
                          aria-label="Kecocokan sebelumnya"
                          className="p-1 rounded border border-amber-300 bg-white hover:bg-amber-100 cursor-pointer"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => jumpToContentMatch(1)}
                          aria-label="Kecocokan berikutnya"
                          className="p-1 rounded border border-amber-300 bg-white hover:bg-amber-100 cursor-pointer"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    value={activeNote.content}
                    maxLength={MAX_NOTE_CONTENT_LENGTH}
                    onChange={(e) =>
                      updateDraftNote(activeNote.id, { content: e.target.value })
                    }
                    placeholder="Tulis catatan template Blogger, CSS custom, script JS, parameter query URL, atau daftar tugas Anda di sini...&#10;&#10;Saat siap menyimpan ke akun Google pribadi Anda, klik tombol 'Simpan di Cloud' di bawah."
                    className="flex-1 w-full min-h-[220px] p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm sm:text-xs font-mono leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 focus:bg-white resize-none"
                  />
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
                    <span>
                      {lineCount} baris · {charCount.toLocaleString('id-ID')}/
                      {MAX_NOTE_CONTENT_LENGTH.toLocaleString('id-ID')} karakter
                    </span>
                    {activeNote.templateHint && (
                      <span className="truncate max-w-[260px]">
                        Template: {activeNote.templateHint}
                      </span>
                    )}
                  </div>
                </div>

                {/* Sticky Cloud Save Footer */}
                <footer className="px-3.5 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    {activeNote.dirty ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
                        <CloudOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span>
                          {activeNote.inCloud
                            ? 'Ada perubahan lokal · Belum disimpan ke Cloud'
                            : 'Draft Lokal · Belum disimpan ke Cloud'}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold tabular-nums">
                        <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          Tersimpan di Cloud · {formatTimeShort(activeNote.cloudSyncedAtMs)}
                        </span>
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={
                      isSavingActive ||
                      isOfflineMode ||
                      (Boolean(user) && !activeNote.dirty && activeNote.inCloud)
                    }
                    onClick={() => void handleSaveToCloud(activeNote.id)}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0 w-full sm:w-auto ${
                      user && !activeNote.dirty && activeNote.inCloud
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default'
                        : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-xs'
                    }`}
                  >
                    {isSavingActive ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Menyimpan di Cloud...</span>
                      </>
                    ) : !user ? (
                      <>
                        <CloudUpload className="w-4 h-4" />
                        <span>Masuk Google &amp; Simpan di Cloud</span>
                      </>
                    ) : !activeNote.dirty && activeNote.inCloud ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Sudah Tersimpan di Cloud</span>
                      </>
                    ) : (
                      <>
                        <CloudUpload className="w-4 h-4" />
                        <span>Simpan di Cloud</span>
                      </>
                    )}
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
