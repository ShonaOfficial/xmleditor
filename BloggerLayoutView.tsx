import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  LayoutGrid,
  Lock,
  Package,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import type { BloggerWidgetInfo, ParsedTemplateInfo } from '../types/blogger';
import {
  addEmptyLayoutWidgetToSectionInXml,
  addNewWidgetToSectionInXml,
  canShareXmlFile,
  createEmptyLayoutSectionInXml,
  extractTemplateSkinRawBlock,
  generateTemplateSkinInXml,
  insertCustomTemplateSkinInXml,
  moveWidgetOrderInSectionXml,
  populateEmptySectionsWithEmptyWidgetsInXml,
  removeWidgetFromXml,
  scaffoldEmptyBloggerLayoutInXml,
  shareXmlFileViaNavigator,
  updateWidgetAttrInXml,
} from '../lib/bloggerCompiler';
import {
  extractWidgetBundle,
  importWidgetBundleIntoXml,
  type ExtractedWidgetBundle,
} from '../lib/xmlFeatureTools';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';

interface BloggerLayoutViewProps {
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  onUpdateXml: (nextXml: string, feedbackMessage: string) => void;
  onSaveOverwriteAndDownload?: (nextXml?: string) => void;
  onOpenInspectorWidgets: () => void;
}

const GADGET_PRESETS = [
  { type: 'HTML_EMPTY', label: 'Widget Tata Letak Kosong (Shell)', defaultTitle: '' },
  { type: 'HTML', label: 'HTML / JavaScript', defaultTitle: 'Kode Kustom / Banner' },
  { type: 'AdSense', label: 'Google AdSense', defaultTitle: 'Iklan AdSense' },
  { type: 'PopularPosts', label: 'Entri Populer', defaultTitle: 'Artikel Populer' },
  { type: 'Label', label: 'Label / Kategori', defaultTitle: 'Kategori' },
  { type: 'PageList', label: 'Halaman (Menu)', defaultTitle: 'Navigasi Halaman' },
  { type: 'FeaturedPost', label: 'Artikel Unggulan', defaultTitle: 'Pilihan Editor' },
  { type: 'BlogSearch', label: 'Kotak Penelusuran', defaultTitle: 'Cari Artikel' },
  { type: 'Profile', label: 'Profil Penulis', defaultTitle: 'Tentang Penulis' },
];

type LayoutZone = 'top' | 'header' | 'crosscol' | 'main' | 'sidebar' | 'footer' | 'other';

function classifySectionZone(sectionId: string, className: string): LayoutZone {
  const s = `${sectionId} ${className}`.toLowerCase();
  if (/navbar|topbar|top-nav|announcement/.test(s)) return 'top';
  if (/header|logo|branding/.test(s)) return 'header';
  if (/crosscol|nav|menu|slider|featured/.test(s)) return 'crosscol';
  if (/footer|bottom|credit|sub-footer/.test(s)) return 'footer';
  if (/main|content|post|blog/.test(s)) return 'main';
  if (/sidebar|aside|right|left|rail/.test(s)) return 'sidebar';
  return 'other';
}

export const BloggerLayoutView: React.FC<BloggerLayoutViewProps> = ({
  xml,
  parsedInfo,
  offlineAi,
  onUpdateXml,
  onSaveOverwriteAndDownload,
  onOpenInspectorWidgets,
}) => {
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [addingSectionId, setAddingSectionId] = useState<string | null>(null);
  const [selectedGadgetType, setSelectedGadgetType] = useState('HTML');
  const [newGadgetTitle, setNewGadgetTitle] = useState('Gadget Baru');

  // Auto-generator states for <b:template-skin> & empty layout slots
  const [showTemplateSkinCode, setShowTemplateSkinCode] = useState(false);
  const [showPasteGuide, setShowPasteGuide] = useState(true);
  const [pastedTemplateSkinInput, setPastedTemplateSkinInput] = useState('');
  const [copiedSkin, setCopiedSkin] = useState(false);
  const [showNewSectionForm, setShowNewSectionForm] = useState(false);
  const [newSectionId, setNewSectionId] = useState('section-baru');
  const [newSectionZone, setNewSectionZone] = useState<
    'header' | 'crosscol' | 'main' | 'sidebar' | 'footer' | 'other'
  >('sidebar');
  const [includeEmptyWidgetInNewSection, setIncludeEmptyWidgetInNewSection] = useState(true);
  const [emptyWidgetStyle, setEmptyWidgetStyle] = useState<'self-closing' | 'with-includable'>(
    'with-includable'
  );

  // Widget Extractor & Importer states
  const [extractedBundle, setExtractedBundle] = useState<ExtractedWidgetBundle | null>(null);
  const [bundleCopied, setBundleCopied] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRawInput, setImportRawInput] = useState('');
  const [importTargetSectionId, setImportTargetSectionId] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const templateSkinRaw = useMemo(() => extractTemplateSkinRawBlock(xml), [xml]);
  const templateSkinInnerClean = templateSkinRaw
    .replace(/<\/?b:template-skin[^>]*>/gi, '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .trim();
  const isTemplateSkinEmpty = parsedInfo.hasTemplateSkin && templateSkinInnerClean.length < 15;
  const canShareMobile = useMemo(() => canShareXmlFile(), []);

  const widgetsBySection = useMemo(() => {
    const map = new Map<string, BloggerWidgetInfo[]>();
    for (const sec of parsedInfo.sections) {
      map.set(sec.id, []);
    }
    for (const w of parsedInfo.widgets) {
      const arr = map.get(w.sectionId) || [];
      arr.push(w);
      map.set(w.sectionId, arr);
    }
    return map;
  }, [parsedInfo.sections, parsedInfo.widgets]);

  const zones = useMemo(() => {
    const grouped: Record<LayoutZone, typeof parsedInfo.sections> = {
      top: [],
      header: [],
      crosscol: [],
      main: [],
      sidebar: [],
      footer: [],
      other: [],
    };
    for (const sec of parsedInfo.sections) {
      grouped[classifySectionZone(sec.id, sec.className)].push(sec);
    }
    return grouped;
  }, [parsedInfo.sections]);

  const standaloneWidgets = parsedInfo.widgets.filter((w) => w.sectionId === '(standalone)');
  const emptySectionsCount = useMemo(
    () =>
      parsedInfo.sections.filter((sec) => {
        const canAdd = sec.showAddElement !== 'false' && sec.showAddElement !== 'no';
        return canAdd && (widgetsBySection.get(sec.id)?.length || 0) === 0;
      }).length,
    [parsedInfo.sections, widgetsBySection]
  );

  const handleCopyTemplateSkin = async () => {
    if (!templateSkinRaw) return;
    try {
      await navigator.clipboard.writeText(templateSkinRaw);
      setCopiedSkin(true);
      setTimeout(() => setCopiedSkin(false), 1800);
    } catch {
      // Clipboard might be restricted
    }
  };

  const renderSectionBox = (section: (typeof parsedInfo.sections)[number], accentClass = 'border-slate-300') => {
    const widgets = widgetsBySection.get(section.id) || [];
    const canAdd = section.showAddElement !== 'false' && section.showAddElement !== 'no';

    return (
      <div
        key={section.id}
        className={`rounded-xl border ${accentClass} bg-white p-3.5 sm:p-4 space-y-3`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 truncate">
                Section: <span className="font-mono">{section.id}</span>
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5 tabular-nums">
              {section.className || 'section'} &middot; {widgets.length} gadget
              {section.maxWidgets ? ` · maks ${section.maxWidgets}` : ''}
            </div>
          </div>

          {canAdd && (
            <button
              type="button"
              onClick={() => {
                setAddingSectionId(addingSectionId === section.id ? null : section.id);
                setSelectedGadgetType('HTML');
                setNewGadgetTitle('Gadget Baru');
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Gadget</span>
            </button>
          )}
        </div>

        {/* Add Gadget Inline Panel */}
        {addingSectionId === section.id && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                Tambah Gadget ke #{section.id}
              </span>
              <button
                type="button"
                onClick={() => setAddingSectionId(null)}
                aria-label="Tutup form tambah gadget"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={selectedGadgetType}
                onChange={(e) => {
                  setSelectedGadgetType(e.target.value);
                  const found = GADGET_PRESETS.find((g) => g.type === e.target.value);
                  if (found) setNewGadgetTitle(found.defaultTitle);
                }}
                aria-label="Pilih jenis gadget"
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
              >
                {GADGET_PRESETS.map((g) => (
                  <option key={g.type} value={g.type}>
                    {g.label} ({g.type === 'HTML_EMPTY' ? 'Kosong' : g.type})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newGadgetTitle}
                onChange={(e) => setNewGadgetTitle(e.target.value)}
                placeholder={selectedGadgetType === 'HTML_EMPTY' ? 'Judul opsional (kosongkan bila blank)...' : 'Judul gadget...'}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                const nextXml =
                  selectedGadgetType === 'HTML_EMPTY'
                    ? addEmptyLayoutWidgetToSectionInXml(
                        xml,
                        section.id,
                        emptyWidgetStyle,
                        newGadgetTitle
                      )
                    : addNewWidgetToSectionInXml(
                        xml,
                        section.id,
                        selectedGadgetType,
                        newGadgetTitle
                      );
                onUpdateXml(
                  nextXml,
                  selectedGadgetType === 'HTML_EMPTY'
                    ? `Widget tata letak kosong ditambahkan ke #${section.id}.`
                    : `Gadget ${selectedGadgetType} "${newGadgetTitle}" ditambahkan ke #${section.id}.`
                );
                setAddingSectionId(null);
              }}
              className="w-full sm:w-auto px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
            >
              Pasang Gadget ke XML
            </button>
          </div>
        )}

        {/* Widget Cards inside Section */}
        {widgets.length === 0 ? (
          <div className="py-4 px-3 border border-dashed border-slate-300 rounded-lg text-center space-y-2.5 bg-slate-50/40">
            <p className="text-[11px] text-slate-500">
              Section <span className="font-mono text-slate-700">#{section.id}</span> masih kosong.
            </p>
            {canAdd && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const nextXml = addEmptyLayoutWidgetToSectionInXml(
                      xml,
                      section.id,
                      'self-closing',
                      ''
                    );
                    onUpdateXml(
                      nextXml,
                      `Widget tata letak kosong (<b:widget .../>) dibuat di #${section.id}.`
                    );
                  }}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  + Buat Widget Kosong
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextXml = addEmptyLayoutWidgetToSectionInXml(
                      xml,
                      section.id,
                      'with-includable',
                      ''
                    );
                    onUpdateXml(
                      nextXml,
                      `Widget kosong lengkap dengan <b:includable id='main'> dibuat di #${section.id}.`
                    );
                  }}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  + Widget Kosong + Includable
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {widgets.map((w, idx) => {
              const isHidden = w.visible === 'false';
              const isLocked = w.locked === 'true';
              const isEditing = editingWidgetId === w.id;

              return (
                <div
                  key={`${w.id}-${idx}`}
                  className={`rounded-lg border p-3 transition-colors ${
                    isHidden
                      ? 'bg-slate-50/70 border-slate-200 opacity-75'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {w.title || w.id}
                        </span>
                        <span className="text-[11px] font-mono text-blue-700">
                          {w.type}
                        </span>
                        {isHidden && (
                          <span className="text-[11px] text-amber-700 font-medium">
                            (Disembunyikan)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
                        ID: {w.id} &middot; Baris {w.line || '-'}
                      </div>
                    </div>

                    {/* Gadget Quick Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          const nextXml = moveWidgetOrderInSectionXml(
                            xml,
                            section.id,
                            w.id,
                            'up'
                          );
                          onUpdateXml(nextXml, `Urutan ${w.id} dipindah ke atas.`);
                        }}
                        title="Pindah ke atas"
                        aria-label={`Pindah ${w.id} ke atas`}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 disabled:opacity-35 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === widgets.length - 1}
                        onClick={() => {
                          const nextXml = moveWidgetOrderInSectionXml(
                            xml,
                            section.id,
                            w.id,
                            'down'
                          );
                          onUpdateXml(nextXml, `Urutan ${w.id} dipindah ke bawah.`);
                        }}
                        title="Pindah ke bawah"
                        aria-label={`Pindah ${w.id} ke bawah`}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 disabled:opacity-35 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextVis = isHidden ? 'true' : 'false';
                          const nextXml = updateWidgetAttrInXml(xml, w.id, 'visible', nextVis);
                          onUpdateXml(
                            nextXml,
                            `Gadget ${w.id} ${nextVis === 'true' ? 'ditampilkan' : 'disembunyikan'}.`
                          );
                        }}
                        title={isHidden ? 'Tampilkan gadget' : 'Sembunyikan gadget'}
                        aria-label={`Ubah visibilitas ${w.id}`}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        {isHidden ? (
                          <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextLocked = isLocked ? 'false' : 'true';
                          const nextXml = updateWidgetAttrInXml(xml, w.id, 'locked', nextLocked);
                          onUpdateXml(
                            nextXml,
                            `Kunci gadget ${w.id} diubah ke ${nextLocked}.`
                          );
                        }}
                        title={isLocked ? 'Buka kunci widget (locked=false)' : 'Kunci widget (locked=true)'}
                        aria-label={`Kunci atau buka ${w.id}`}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        {isLocked ? (
                          <Lock className="w-3.5 h-3.5 text-slate-700" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const bundle = extractWidgetBundle(xml, w.id);
                          if (bundle) {
                            setExtractedBundle(bundle);
                            setBundleCopied(false);
                          }
                        }}
                        title={`Ekspor paket widget ${w.id} + CSS terkait`}
                        aria-label={`Ekspor ${w.id}`}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-emerald-700 cursor-pointer"
                      >
                        <Package className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingWidgetId(null);
                          } else {
                            setEditingWidgetId(w.id);
                            setTitleDraft(w.title || '');
                          }
                        }}
                        title="Edit judul widget"
                        aria-label={`Edit ${w.id}`}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-blue-700 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextXml = removeWidgetFromXml(xml, w.id);
                            onUpdateXml(nextXml, `Gadget ${w.id} dihapus dari XML.`);
                          }}
                          title="Hapus gadget dari template XML"
                          aria-label={`Hapus ${w.id}`}
                          className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        placeholder="Masukkan judul widget..."
                        className="flex-1 min-w-[160px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextXml = updateWidgetAttrInXml(xml, w.id, 'title', titleDraft);
                          onUpdateXml(nextXml, `Judul ${w.id} diperbarui ke "${titleDraft}".`);
                          setEditingWidgetId(null);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Simpan</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-[#F8FAFC] overflow-hidden">
      <OfflineAiRuntimeBar
        controller={offlineAi}
        page="layout"
        xml={xml}
        parsedInfo={parsedInfo}
      />

      {/* Header Bar */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate">Visualisasi Tata Letak Blogger (Offline)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {parsedInfo.sections.length} section &middot; {parsedInfo.widgets.length} gadget &middot;{' '}
            &lt;b:template-skin&gt;:{' '}
            <span
              className={
                !parsedInfo.hasTemplateSkin
                  ? 'text-amber-700 font-medium'
                  : isTemplateSkinEmpty
                    ? 'text-amber-700 font-medium'
                    : 'text-emerald-700 font-medium'
              }
            >
              {!parsedInfo.hasTemplateSkin
                ? 'Belum ada'
                : isTemplateSkinEmpty
                  ? 'Ada (kosong)'
                  : 'Terpasang'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => {
              setImportTargetSectionId(parsedInfo.sections[0]?.id || '');
              setImportError(null);
              setImportModalOpen(true);
            }}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Impor Paket Widget</span>
          </button>
          {onSaveOverwriteAndDownload && (
            <button
              type="button"
              onClick={() => onSaveOverwriteAndDownload(xml)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Simpan, Timpa &amp; Unduh .xml</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenInspectorWidgets}
            className="flex-1 sm:flex-initial px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Kelola Widget &rarr;
          </button>
        </div>
      </div>

      {/* Blogger-like Wireframe Canvas */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-5">
        {/* Auto-Generator Bar: <b:template-skin> & Empty Layout Sections/Widgets */}
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Card 1: <b:template-skin> Auto Generator + Pasting Guide + Direct Save/Overwrite */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <Code2 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Generator &amp; Tempel &lt;b:template-skin&gt;</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Membuat atau menempel CSS tata letak dashboard Blogger (<span className="font-mono">body#layout</span>) langsung ke XML.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPasteGuide((v) => !v)}
                  className="text-[11px] font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <BookOpen className="w-3 h-3" />
                  <span>{showPasteGuide ? 'Tutup Panduan' : 'Petunjuk Tempel'}</span>
                </button>
                {templateSkinRaw && (
                  <button
                    type="button"
                    onClick={() => setShowTemplateSkinCode((v) => !v)}
                    className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap cursor-pointer"
                  >
                    {showTemplateSkinCode ? 'Sembunyikan Kode' : 'Lihat Kode'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const nextXml = generateTemplateSkinInXml(xml, parsedInfo, 'auto');
                  onUpdateXml(
                    nextXml,
                    parsedInfo.hasTemplateSkin
                      ? '<b:template-skin> otomatis diregenerasi sesuai section tata letak aktif.'
                      : '<b:template-skin> otomatis berhasil dibuat di <head> template XML.'
                  );
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {parsedInfo.hasTemplateSkin && !isTemplateSkinEmpty
                    ? 'Regenerasi <b:template-skin>'
                    : 'Buat <b:template-skin> Otomatis'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextXml = generateTemplateSkinInXml(xml, parsedInfo, 'empty');
                  onUpdateXml(
                    nextXml,
                    'Blok <b:template-skin> kosong siap pakai berhasil dibuat ke XML.'
                  );
                }}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                Buat &lt;b:template-skin&gt; Kosong
              </button>
            </div>

            {/* Step-by-Step Guide & Direct Paste Box for <b:template-skin> */}
            {showPasteGuide && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="text-[11px] font-semibold text-slate-900">
                  Petunjuk Posisi Menempelkan &lt;b:template-skin&gt; di XML Blogger:
                </div>
                <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-600 leading-relaxed">
                  <li>
                    Letakkan blok <span className="font-mono text-slate-800">&lt;b:template-skin&gt;</span> tepat{' '}
                    <strong className="text-slate-800">di bawah tag penutup &lt;/b:skin&gt;</strong> dan masih berada{' '}
                    <strong className="text-slate-800">di atas &lt;/head&gt;</strong> (jangan diletakkan di dalam{' '}
                    <span className="font-mono">&lt;body&gt;</span> atau di dalam <span className="font-mono">&lt;b:skin&gt;</span>).
                  </li>
                  <li>
                    Selalu bungkus isinya dengan{' '}
                    <span className="font-mono text-slate-800">&lt;![CDATA[ ... ]]&gt;</span> agar karakter{' '}
                    <span className="font-mono">&amp;</span>, <span className="font-mono">&lt;</span>, dan{' '}
                    <span className="font-mono">&gt;</span> tidak menimbulkan error saat disimpan di Studio Blogger.
                  </li>
                  <li>
                    Atau cukup tempel kode <span className="font-mono text-slate-800">&lt;b:template-skin&gt;</span> maupun CSS{' '}
                    <span className="font-mono text-slate-800">body#layout</span> di kotak bawah ini — sistem otomatis menempatkan dan menimpanya secara utuh ke XML Anda.
                  </li>
                </ol>

                <div className="space-y-1.5 pt-1">
                  <textarea
                    rows={4}
                    value={pastedTemplateSkinInput}
                    onChange={(e) => setPastedTemplateSkinInput(e.target.value)}
                    spellCheck={false}
                    placeholder={`Tempel <b:template-skin><![CDATA[ ... ]]></b:template-skin> atau CSS body#layout di sini...\nContoh:\nbody#layout #main { width: 65%; float: left; }\nbody#layout #sidebar { width: 32%; float: right; }`}
                    className="w-full p-2.5 text-[11px] font-mono bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!pastedTemplateSkinInput.trim()}
                      onClick={() => {
                        const nextXml = insertCustomTemplateSkinInXml(
                          xml,
                          pastedTemplateSkinInput
                        );
                        onUpdateXml(
                          nextXml,
                          'Kode <b:template-skin> ditempel tepat setelah </b:skin> dan disimpan ke XML aktif.'
                        );
                        setShowTemplateSkinCode(true);
                      }}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Tempel &amp; Simpan ke XML
                    </button>
                    {onSaveOverwriteAndDownload && (
                      <button
                        type="button"
                        disabled={!pastedTemplateSkinInput.trim()}
                        onClick={() => {
                          const nextXml = insertCustomTemplateSkinInXml(
                            xml,
                            pastedTemplateSkinInput
                          );
                          onSaveOverwriteAndDownload(nextXml);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Timpa Template Utuh &amp; Unduh .xml</span>
                      </button>
                    )}
                    {canShareMobile && (
                      <button
                        type="button"
                        disabled={!pastedTemplateSkinInput.trim()}
                        onClick={() => {
                          const nextXml = insertCustomTemplateSkinInXml(
                            xml,
                            pastedTemplateSkinInput
                          );
                          onUpdateXml(
                            nextXml,
                            'Kode <b:template-skin> disimpan dan disiapkan untuk Share HP.'
                          );
                          void shareXmlFileViaNavigator(nextXml, parsedInfo.templateTitle);
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-emerald-50 disabled:bg-slate-100 disabled:text-slate-400 text-emerald-800 border border-emerald-200 text-[11px] font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>Simpan via Share HP</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showTemplateSkinCode && templateSkinRaw && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-500">Blok &lt;b:template-skin&gt; aktif</span>
                  <button
                    type="button"
                    onClick={handleCopyTemplateSkin}
                    className="flex items-center gap-1 text-blue-700 hover:underline cursor-pointer"
                  >
                    {copiedSkin ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSkin ? 'Disalin' : 'Salin'}</span>
                  </button>
                </div>
                <pre className="p-2.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] max-h-44 overflow-auto whitespace-pre-wrap break-all">
                  {templateSkinRaw}
                </pre>
              </div>
            )}
          </section>

          {/* Card 2: Empty Layout Section & Empty Widget Generator */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Generator Widget &amp; Section Tata Letak Kosong</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Buat section <span className="font-mono">&lt;b:section&gt;</span> kosong maupun placeholder <span className="font-mono">&lt;b:widget&gt;</span> kosong secara instan.
                </p>
              </div>

              <select
                aria-label="Format XML widget kosong"
                value={emptyWidgetStyle}
                onChange={(e) =>
                  setEmptyWidgetStyle(e.target.value as 'self-closing' | 'with-includable')
                }
                className="px-2 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded-md text-slate-700 cursor-pointer"
              >
                <option value="with-includable">Widget + Includable</option>
                <option value="self-closing">Tag Ringkas (&lt;b:widget/&gt;)</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const res = scaffoldEmptyBloggerLayoutInXml(xml, {
                    includeEmptyWidgets: true,
                    emptyWidgetStyle,
                    alsoGenerateTemplateSkin: true,
                  });
                  if (res.addedSections.length === 0 && !res.generatedTemplateSkin) {
                    onUpdateXml(
                      xml,
                      'Semua section standar (header, crosscol, main, sidebar, footer) dan <b:template-skin> sudah tersedia.'
                    );
                    return;
                  }
                  onUpdateXml(
                    res.xml,
                    `Berhasil membuat ${res.addedSections.length} section kosong, ${res.addedWidgets} widget kosong${res.generatedTemplateSkin ? ', dan <b:template-skin>' : ''}.`
                  );
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                Lengkapi Kerangka Tata Letak Kosong
              </button>

              {emptySectionsCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const res = populateEmptySectionsWithEmptyWidgetsInXml(
                      xml,
                      parsedInfo,
                      emptyWidgetStyle
                    );
                    onUpdateXml(
                      res.xml,
                      `${res.addedCount} widget tata letak kosong berhasil dipasang ke section yang kosong.`
                    );
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Isi {emptySectionsCount} Section Kosong
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowNewSectionForm((v) => !v)}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                {showNewSectionForm ? 'Tutup Form Section' : '+ Section Kosong Baru'}
              </button>
            </div>

            {showNewSectionForm && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newSectionId}
                    onChange={(e) => setNewSectionId(e.target.value)}
                    placeholder="ID Section (mis. promo-atas)"
                    className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                  <select
                    aria-label="Pilih zona section baru"
                    value={newSectionZone}
                    onChange={(e) =>
                      setNewSectionZone(
                        e.target.value as
                          | 'header'
                          | 'crosscol'
                          | 'main'
                          | 'sidebar'
                          | 'footer'
                          | 'other'
                      )
                    }
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
                  >
                    <option value="header">Zona Header</option>
                    <option value="crosscol">Zona Navigasi / Crosscol</option>
                    <option value="main">Zona Konten Utama</option>
                    <option value="sidebar">Zona Sidebar</option>
                    <option value="footer">Zona Footer</option>
                    <option value="other">Zona Kustom</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeEmptyWidgetInNewSection}
                      onChange={(e) => setIncludeEmptyWidgetInNewSection(e.target.checked)}
                      className="rounded border-slate-300 accent-blue-600"
                    />
                    <span>Sertakan widget tata letak kosong di dalamnya</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const res = createEmptyLayoutSectionInXml(
                        xml,
                        newSectionId,
                        newSectionZone,
                        includeEmptyWidgetInNewSection,
                        emptyWidgetStyle
                      );
                      onUpdateXml(
                        res.xml,
                        `Section kosong #${res.createdSectionId}${includeEmptyWidgetInNewSection ? ' beserta widget kosong' : ''} berhasil ditambahkan ke XML.`
                      );
                      setShowNewSectionForm(false);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                  >
                    Buat Section ke XML
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {parsedInfo.sections.length === 0 ? (
          <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900">
              Belum ada &lt;b:section&gt; Blogger ditemukan di dokumen ini
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Anda dapat langsung membuat kerangka tata letak Blogger standar (<span className="font-mono">header</span>, <span className="font-mono">crosscol</span>, <span className="font-mono">main</span>, <span className="font-mono">sidebar</span>, <span className="font-mono">footer</span>) lengkap dengan widget kosong dan <span className="font-mono">&lt;b:template-skin&gt;</span> otomatis.
            </p>
            <button
              type="button"
              onClick={() => {
                const res = scaffoldEmptyBloggerLayoutInXml(xml, {
                  includeEmptyWidgets: true,
                  emptyWidgetStyle,
                  alsoGenerateTemplateSkin: true,
                });
                onUpdateXml(
                  res.xml,
                  `Kerangka tata letak Blogger kosong (${res.addedSections.length} section, ${res.addedWidgets} widget kosong, & <b:template-skin>) berhasil dibuat.`
                );
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Buat Kerangka &amp; &lt;b:template-skin&gt; Otomatis</span>
            </button>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-4">
            {/* Top / Navbar Zone */}
            {zones.top.length > 0 && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Bilah Atas / Navbar
                </div>
                {zones.top.map((s) => renderSectionBox(s))}
              </div>
            )}

            {/* Header Zone */}
            {zones.header.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Header Blog
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {zones.header.map((s) => renderSectionBox(s, 'border-blue-200'))}
                </div>
              </div>
            )}

            {/* Crosscol / Navigation Menu Zone */}
            {zones.crosscol.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Menu Navigasi / Crosscol
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {zones.crosscol.map((s) => renderSectionBox(s))}
                </div>
              </div>
            )}

            {/* Main + Sidebar Wireframe Grid */}
            {(zones.main.length > 0 || zones.sidebar.length > 0) && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Area Konten Utama &amp; Sidebar
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  <div
                    className={`space-y-3 ${
                      zones.sidebar.length > 0 ? 'lg:col-span-8' : 'lg:col-span-12'
                    }`}
                  >
                    {zones.main.length > 0 ? (
                      zones.main.map((s) => renderSectionBox(s, 'border-slate-300'))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-xs text-slate-400">
                        Tidak ada section konten utama terpisah
                      </div>
                    )}
                  </div>

                  {zones.sidebar.length > 0 && (
                    <div className="lg:col-span-4 space-y-3">
                      {zones.sidebar.map((s) => renderSectionBox(s))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Footer Columns */}
            {zones.footer.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Area Footer
                </div>
                <div
                  className={`grid grid-cols-1 gap-3 ${
                    zones.footer.length === 2
                      ? 'md:grid-cols-2'
                      : zones.footer.length >= 3
                        ? 'md:grid-cols-3'
                        : ''
                  }`}
                >
                  {zones.footer.map((s) => renderSectionBox(s))}
                </div>
              </div>
            )}

            {/* Other Custom Sections */}
            {zones.other.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Section Tambahan / Kustom
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {zones.other.map((s) => renderSectionBox(s))}
                </div>
              </div>
            )}

            {/* Standalone Widgets Warning */}
            {standaloneWidgets.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                <div className="text-xs font-semibold text-amber-900">
                  Gadget di Luar &lt;b:section&gt; ({standaloneWidgets.length})
                </div>
                <p className="text-xs text-amber-800">
                  Gadget berikut terdeteksi berada di luar blok &lt;b:section&gt;. Di Blogger Studio asli, setiap widget harus diletakkan di dalam &lt;b:section&gt;.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {standaloneWidgets.map((w, idx) => (
                    <span
                      key={`${w.id}-${idx}`}
                      className="text-xs font-mono bg-white border border-amber-200 px-2.5 py-1 rounded text-amber-900"
                    >
                      {w.id} ({w.type})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Ekstrak Paket Widget (+ CSS) */}
      {extractedBundle && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5">
          <div className="w-full max-w-2xl max-h-[88dvh] bg-white border border-slate-200 rounded-xl shadow-xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Ekstrak Paket Widget: {extractedBundle.widgetId}</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tipe {extractedBundle.widgetType} &middot; Termasuk{' '}
                  {extractedBundle.extractedCss ? 'CSS terkait dari <b:skin>/<style>' : 'markup XML widget'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExtractedBundle(null)}
                aria-label="Tutup modal ekstrak widget"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-700">
                  Markup XML &lt;b:widget id=&quot;{extractedBundle.widgetId}&quot;&gt;
                </div>
                <pre className="p-2.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] max-h-48 overflow-auto whitespace-pre-wrap break-all">
                  {extractedBundle.widgetXml}
                </pre>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-700">
                  Aturan CSS Terkait ({extractedBundle.extractedCss ? 'Ditemukan' : 'Tidak ada aturan khusus'})
                </div>
                <pre className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 font-mono text-[11px] max-h-40 overflow-auto whitespace-pre-wrap break-all">
                  {extractedBundle.extractedCss || '/* Tidak ada aturan CSS spesifik #widgetId atau kelas internal yang ditemukan */'}
                </pre>
              </div>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const payload = JSON.stringify(extractedBundle, null, 2);
                  navigator.clipboard?.writeText(payload).catch(() => {});
                  setBundleCopied(true);
                  setTimeout(() => setBundleCopied(false), 1800);
                }}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                {bundleCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{bundleCopied ? 'Paket JSON Disalin' : 'Salin Paket JSON'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(extractedBundle, null, 2)], {
                    type: 'application/json;charset=utf-8',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `widget-${extractedBundle.widgetId.toLowerCase()}.temaloka-widget.json`;
                  a.type = 'application/json';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh Paket (.json)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Impor Paket Widget */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5">
          <div className="w-full max-w-xl max-h-[88dvh] bg-white border border-slate-200 rounded-xl shadow-xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Impor Paket Widget (+ Deteksi Bentrok ID)</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tempel JSON paket ekstrak TemaLoka atau tag <span className="font-mono">&lt;b:widget&gt;</span> langsung.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                aria-label="Tutup modal impor widget"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-700">
                  Section Tujuan:
                </label>
                <select
                  value={importTargetSectionId}
                  onChange={(e) => setImportTargetSectionId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                >
                  {parsedInfo.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} ({s.className || 'section'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  Tempel Kode Paket Widget atau Muat File:
                </span>
                <label className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md text-[11px] font-medium text-slate-800 cursor-pointer">
                  <span>Pilih File .json / .xml</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const lowerName = f.name.toLowerCase();
                      if (!lowerName.endsWith('.xml') && !lowerName.endsWith('.json')) {
                        setImportError('Harap pilih file berekstensi .json atau .xml yang valid.');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        setImportRawInput(String(reader.result || ''));
                        setImportError(null);
                      };
                      reader.readAsText(f);
                    }}
                  />
                </label>
              </div>

              <textarea
                rows={7}
                value={importRawInput}
                onChange={(e) => {
                  setImportRawInput(e.target.value);
                  if (importError) setImportError(null);
                }}
                spellCheck={false}
                placeholder='Tempel JSON paket widget TemaLoka atau kode <b:widget id="HTML1" type="HTML">...</b:widget> di sini...'
                className="w-full p-2.5 font-mono text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              />

              {importError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-[11px]">
                  {importError}
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Jika ID widget (misalnya <span className="font-mono">HTML1</span>) sudah terpakai di template ini, importer otomatis menomori ulang menjadi ID kosong berikutnya dan memperbarui selector CSS terkait sebelum disisipkan tepat di atas <span className="font-mono">]]&gt;&lt;/b:skin&gt;</span>.
              </p>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!importRawInput.trim() || !importTargetSectionId}
                onClick={() => {
                  try {
                    const res = importWidgetBundleIntoXml(
                      xml,
                      importRawInput,
                      importTargetSectionId
                    );
                    if (res.error) {
                      setImportError(res.error);
                      return;
                    }
                    const renameNote = res.renamedFrom
                      ? ` (ID "${res.renamedFrom}" bentrok -> otomatis diubah ke "${res.finalWidgetId}")`
                      : '';
                    onUpdateXml(
                      res.nextXml,
                      `Widget ${res.finalWidgetId} berhasil diimpor ke #${importTargetSectionId}${renameNote}${res.cssInjected ? ' beserta CSS-nya' : ''}.`
                    );
                    setImportModalOpen(false);
                    setImportRawInput('');
                  } catch (err) {
                    setImportError(
                      err instanceof Error ? err.message : 'Gagal mengimpor paket widget.'
                    );
                  }
                }}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                Pasang ke Section
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
