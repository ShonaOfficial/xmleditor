import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Layout,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  PlusCircle,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import type { SiteAdsenseController } from '../hooks/useSiteAdsense';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  buildAdsTxtLine,
  sanitizePublisherId,
  sanitizeSlotDigits,
  type AdsenseUnitFormatType,
  type AdsenseUnitPlacementType,
  type AdsenseUnitRecord,
  type FooterSlotFormat,
  type ModalSlotFormat,
  type SidebarSlotFormat,
  type SiteAdsenseConfig,
  type TopBannerFormat,
} from '../types/adsense';
import {
  buildAdsensePreviewSnippet,
  injectAdsenseIntoXml,
} from '../lib/seoAndErrorAnalyzer';
import type { ParsedTemplateInfo } from '../types/blogger';

interface AdminAdsensePanelProps {
  siteAdsense: SiteAdsenseController;
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  onUpdateXml: (nextXml: string, feedbackMessage: string) => void;
  onExitAdmin: () => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type AdminTab = 'global' | 'slots' | 'units' | 'adstxt' | 'admins';

export const AdminAdsensePanel: React.FC<AdminAdsensePanelProps> = ({
  siteAdsense,
  xml,
  parsedInfo,
  onUpdateXml,
  onExitAdmin,
  onNotify,
}) => {
  const { user, authReady, isSigningIn, signInWithGoogle, signOutGoogle } = useAuthAndAi();
  const [activeTab, setActiveTab] = useState<AdminTab>('global');
  const [draft, setDraft] = useState<SiteAdsenseConfig>(siteAdsense.config);
  const [isDirty, setIsDirty] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Unit form states
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitName, setUnitName] = useState('');
  const [unitSlotId, setUnitSlotId] = useState('');
  const [unitFormat, setUnitFormat] = useState<AdsenseUnitFormatType>('responsive');
  const [unitPlacement, setUnitPlacement] =
    useState<AdsenseUnitPlacementType>('bloggerTemplate');
  const [unitEnabled, setUnitEnabled] = useState(true);
  const [unitOnlyOnPosts, setUnitOnlyOnPosts] = useState(false);
  const [unitNotes, setUnitNotes] = useState('');
  const [targetSectionId, setTargetSectionId] = useState<string>(
    () =>
      parsedInfo.sections.find((s) => /sidebar|main|footer|header/i.test(s.id))?.id ||
      parsedInfo.sections[0]?.id ||
      'sidebar'
  );

  // Extra admin form states
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminLabel, setNewAdminLabel] = useState('');

  useEffect(() => {
    if (!isDirty) {
      setDraft(siteAdsense.config);
    }
  }, [siteAdsense.config, isDirty]);

  useEffect(() => {
    if (
      parsedInfo.sections.length > 0 &&
      !parsedInfo.sections.some((s) => s.id === targetSectionId)
    ) {
      setTargetSectionId(
        parsedInfo.sections.find((s) => /sidebar|main|footer|header/i.test(s.id))?.id ||
          parsedInfo.sections[0].id
      );
    }
  }, [parsedInfo.sections, targetSectionId]);

  const adminUrlOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const cleanPubPreview = sanitizePublisherId(draft.publisherId);
  const activeSlotCount = [
    draft.topBannerEnabled,
    draft.sidebarSlotEnabled,
    draft.footerSlotEnabled,
    draft.modalSlotEnabled,
  ].filter(Boolean).length;

  const updateDraft = (patch: Partial<SiteAdsenseConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  };

  const handleCopy = (key: string, value: string, label = 'Teks') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopiedKey(key);
    onNotify?.(`${label} berhasil disalin.`, 'success');
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
  };

  const handleSaveConfig = async () => {
    try {
      await siteAdsense.saveGlobalConfig(draft);
      setIsDirty(false);
      onNotify?.('Pengaturan Google AdSense berhasil disimpan ke Cloud Firestore.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pengaturan AdSense.';
      onNotify?.(msg, 'error');
    }
  };

  const resetUnitForm = () => {
    setEditingUnitId(null);
    setUnitName('');
    setUnitSlotId('');
    setUnitFormat('responsive');
    setUnitPlacement('bloggerTemplate');
    setUnitEnabled(true);
    setUnitOnlyOnPosts(false);
    setUnitNotes('');
  };

  const startEditUnit = (unit: AdsenseUnitRecord) => {
    setEditingUnitId(unit.id);
    setUnitName(unit.name);
    setUnitSlotId(unit.slotId);
    setUnitFormat(unit.format);
    setUnitPlacement(unit.placement);
    setUnitEnabled(unit.enabled);
    setUnitOnlyOnPosts(unit.onlyOnPosts);
    setUnitNotes(unit.notes);
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      if (editingUnitId) {
        await siteAdsense.updateAdUnit(editingUnitId, {
          name: unitName,
          slotId: unitSlotId,
          format: unitFormat,
          placement: unitPlacement,
          enabled: unitEnabled,
          onlyOnPosts: unitOnlyOnPosts,
          notes: unitNotes,
        });
        onNotify?.(`Unit iklan "${unitName}" diperbarui.`, 'success');
      } else {
        await siteAdsense.createAdUnit({
          name: unitName,
          slotId: unitSlotId,
          format: unitFormat,
          placement: unitPlacement,
          enabled: unitEnabled,
          onlyOnPosts: unitOnlyOnPosts,
          notes: unitNotes,
        });
        onNotify?.(`Unit iklan "${unitName}" ditambahkan ke Cloud.`, 'success');
      }
      resetUnitForm();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Gagal menyimpan unit iklan.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteUnit = async (unit: AdsenseUnitRecord) => {
    setActionBusy(true);
    try {
      await siteAdsense.deleteAdUnit(unit.id);
      if (editingUnitId === unit.id) resetUnitForm();
      onNotify?.(`Unit iklan "${unit.name}" dihapus.`, 'info');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Gagal menghapus unit iklan.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      await siteAdsense.addAdminUser(newAdminUid, newAdminEmail, newAdminLabel);
      onNotify?.(`Admin ${newAdminEmail} berhasil ditambahkan.`, 'success');
      setNewAdminUid('');
      setNewAdminEmail('');
      setNewAdminLabel('');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Gagal menambahkan admin.', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const buildUnitHtmlSnippet = (unit: AdsenseUnitRecord) => {
    const pub = cleanPubPreview || 'ca-pub-0000000000000000';
    const slot = unit.slotId || '1234567890';
    return [
      `<ins class="adsbygoogle"`,
      `     style="display:block"`,
      `     data-ad-client="${pub}"`,
      `     data-ad-slot="${slot}"`,
      `     data-ad-format="${unit.format === 'in-article' ? 'fluid' : unit.format === 'multiplex' ? 'autorelaxed' : 'auto'}"`,
      `     data-full-width-responsive="true"${draft.testMode ? `\n     data-adtest="on"` : ''}></ins>`,
      `<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`,
    ].join('\n');
  };

  const buildUnitBloggerXmlSnippet = (unit: AdsenseUnitRecord) => {
    const pub = cleanPubPreview || 'ca-pub-0000000000000000';
    return buildAdsensePreviewSnippet({
      publisherId: pub,
      slotId: unit.slotId,
      format: unit.format,
      target: { kind: 'section-html-ins', sectionId: targetSectionId },
      onlyOnPosts: unit.onlyOnPosts,
      widgetTitle: unit.name,
    });
  };

  const updatedDateLabel = useMemo(() => {
    if (!siteAdsense.config.updatedAtMs) return 'Belum pernah disimpan ke Cloud';
    return new Date(siteAdsense.config.updatedAtMs).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }, [siteAdsense.config.updatedAtMs]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onExitAdmin}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Studio</span>
          </button>

          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                Panel Admin Google AdSense
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-slate-900 text-white rounded">
                /?admin
              </span>
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              Kontrol terpusat Auto Ads, slot iklan aplikasi, unit XML Blogger, dan <span className="font-mono">/ads.txt</span>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {user && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-medium text-slate-800 max-w-[180px] truncate">
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => void signOutGoogle()}
                title="Keluar akun Google"
                className="text-slate-400 hover:text-red-600 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {siteAdsense.isAdmin && (
            <button
              type="button"
              disabled={siteAdsense.savingConfig || !isDirty}
              onClick={() => void handleSaveConfig()}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}
            >
              {siteAdsense.savingConfig ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{isDirty ? 'Simpan Perubahan ke Cloud' : 'Tersinkron'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-6 space-y-5">
        {/* Loading Auth State */}
        {(!authReady || siteAdsense.checkingAdmin) && (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
            <p className="text-xs font-medium text-slate-600">
              Memeriksa sesi autentikasi Admin...
            </p>
          </div>
        )}

        {/* Not Signed In Gate */}
        {authReady && !siteAdsense.checkingAdmin && !user && (
          <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-slate-900">
                Masuk sebagai Admin untuk Mengatur AdSense
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Halaman <code className="font-mono text-slate-900">/?admin</code> dilindungi autentikasi Google &amp; aturan keamanan Cloud Firestore. Masuk dengan akun Google Admin Anda (<span className="font-mono">{ADMIN_BOOTSTRAP_EMAIL}</span>).
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => void signInWithGoogle()}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer disabled:opacity-60"
              >
                {isSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>Masuk dengan Google (Admin)</span>
              </button>
              <button
                type="button"
                onClick={onExitAdmin}
                className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Kembali ke Editor
              </button>
            </div>
          </div>
        )}

        {/* Signed In But Not Admin Gate */}
        {authReady && !siteAdsense.checkingAdmin && user && !siteAdsense.isAdmin && (
          <div className="max-w-lg mx-auto bg-white border border-red-200 rounded-2xl p-6 sm:p-8 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-slate-900">
                Akses Khusus Admin Ditolak
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Anda saat ini masuk sebagai <strong>{user.email}</strong> (UID:{' '}
                <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                  {user.uid}
                </code>
                ), yang tidak terdaftar sebagai Admin Panel AdSense.
              </p>
              <p className="text-[11px] text-slate-500">
                Masuk menggunakan akun Admin utama (<span className="font-mono">{ADMIN_BOOTSTRAP_EMAIL}</span>) atau minta Admin utama menambahkan UID Anda di tab Keamanan Admin.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Ganti Akun Google</span>
              </button>
              <button
                type="button"
                onClick={onExitAdmin}
                className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Kembali ke Studio
              </button>
            </div>
          </div>
        )}

        {/* Authenticated Admin Workspace */}
        {authReady && !siteAdsense.checkingAdmin && siteAdsense.isAdmin && (
          <>
            {/* Overview Status Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-1">
                <div className="text-[11px] text-slate-500 font-medium">Status AdSense Web</div>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      draft.adsenseEnabled && cleanPubPreview
                        ? 'bg-emerald-500'
                        : 'bg-slate-300'
                    }`}
                  />
                  <span className="text-sm font-bold text-slate-900">
                    {draft.adsenseEnabled
                      ? cleanPubPreview
                        ? 'Aktif (Live)'
                        : 'Aktif (Butuh ca-pub)'
                      : 'Nonaktif'}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate">
                  {cleanPubPreview || 'Publisher ID belum diisi'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-1">
                <div className="text-[11px] text-slate-500 font-medium">Auto Ads &amp; Meta &lt;head&gt;</div>
                <div className="text-sm font-bold text-slate-900">
                  {draft.autoAdsEnabled ? 'Auto Ads Aktif' : 'Hanya Unit Manual'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Meta account: {draft.headMetaEnabled ? 'Terpasang' : 'Mati'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-1">
                <div className="text-[11px] text-slate-500 font-medium">Posisi Iklan &amp; Unit</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {activeSlotCount}/4 Zona · {siteAdsense.units.length} Unit
                </div>
                <div className="text-[11px] text-slate-500">
                  {draft.testMode ? 'Mode Test (data-adtest=on)' : 'Mode Produksi Normal'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-1">
                <div className="text-[11px] text-slate-500 font-medium">Sinkronisasi Cloud</div>
                <div className="text-xs font-bold text-slate-900 truncate">
                  {siteAdsense.configExistsInCloud ? 'Tersimpan di Firestore' : 'Draft Awal (Belum Simpan)'}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{updatedDateLabel}</div>
              </div>
            </div>

            {/* Admin Navigation Tabs */}
            <div className="bg-white border border-slate-200 rounded-xl p-1.5 flex flex-wrap gap-1">
              {(
                [
                  ['global', 'Pengaturan Global & Auto Ads', Settings2],
                  ['slots', '4 Zona Iklan Aplikasi', Layout],
                  ['units', `Pustaka Unit Iklan (${siteAdsense.units.length})`, Code2],
                  ['adstxt', 'Pengelola /ads.txt', FileText],
                  ['admins', 'Tautan & Akses Admin', ShieldCheck],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    activeTab === id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* TAB 1: Global Settings & Auto Ads */}
            {activeTab === 'global' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        Konfigurasi Utama Google AdSense
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Mengatur apakah AdSense berjalan live di seluruh halaman web TemaLoka.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={draft.adsenseEnabled}
                        onChange={(e) => updateDraft({ adsenseEnabled: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 rounded"
                      />
                      <span className="text-xs font-semibold text-slate-900">
                        {draft.adsenseEnabled ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </label>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="admin-pub-id"
                        className="block text-xs font-semibold text-slate-800"
                      >
                        Publisher ID Google AdSense (Global)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          id="admin-pub-id"
                          type="text"
                          value={draft.publisherId}
                          onChange={(e) => updateDraft({ publisherId: e.target.value })}
                          onBlur={() => {
                            if (draft.publisherId.trim()) {
                              const clean = sanitizePublisherId(draft.publisherId);
                              if (clean && clean !== draft.publisherId) {
                                updateDraft({ publisherId: clean });
                              }
                            }
                          }}
                          placeholder="ca-pub-1234567890123456"
                          className="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = sanitizePublisherId(draft.publisherId);
                            if (!clean) {
                              onNotify?.('Masukkan ca-pub yang valid dulu.', 'info');
                              return;
                            }
                            updateDraft({
                              publisherId: clean,
                              defaultTemplatePubId: clean,
                              adsTxtContent: buildAdsTxtLine(clean),
                            });
                            onNotify?.(
                              'Publisher ID disinkronkan ke Default Template & ads.txt.',
                              'success'
                            );
                          }}
                          className="px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Sinkron ke ads.txt &amp; Studio
                        </button>
                      </div>
                      {draft.publisherId.trim() && !cleanPubPreview && (
                        <p className="text-[11px] text-red-600">
                          Format harus berupa <code className="font-mono">ca-pub-</code> diikuti 10–20 digit angka.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="admin-default-tpl-pub"
                        className="block text-xs font-semibold text-slate-800"
                      >
                        Default Publisher ID di Tab SEO &amp; Iklan Template XML
                      </label>
                      <input
                        id="admin-default-tpl-pub"
                        type="text"
                        value={draft.defaultTemplatePubId}
                        onChange={(e) => updateDraft({ defaultTemplatePubId: e.target.value })}
                        placeholder="Kosongkan untuk mengikuti Publisher ID Global"
                        className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <label className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.autoAdsEnabled}
                          onChange={(e) => updateDraft({ autoAdsEnabled: e.target.checked })}
                          className="mt-0.5 accent-emerald-600 rounded"
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900">Skrip Auto Ads &lt;head&gt;</div>
                          <div className="text-[11px] text-slate-500">
                            Memuat <code className="font-mono">adsbygoogle.js</code> otomatis di seluruh halaman.
                          </div>
                        </div>
                      </label>

                      <label className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.headMetaEnabled}
                          onChange={(e) => updateDraft({ headMetaEnabled: e.target.checked })}
                          className="mt-0.5 accent-emerald-600 rounded"
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900">Meta Verifikasi Akun</div>
                          <div className="text-[11px] text-slate-500">
                            Pasang <code className="font-mono">google-adsense-account</code> di &lt;head&gt;.
                          </div>
                        </div>
                      </label>

                      <label className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.hideAdsForAdmin}
                          onChange={(e) => updateDraft({ hideAdsForAdmin: e.target.checked })}
                          className="mt-0.5 accent-emerald-600 rounded"
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900">Proteksi Admin Anti-Invalid Click</div>
                          <div className="text-[11px] text-slate-500">
                            Sembunyikan iklan live saat Anda login sebagai Admin (ganti dengan kotak pratinjau aman).
                          </div>
                        </div>
                      </label>

                      <label className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.testMode}
                          onChange={(e) => updateDraft({ testMode: e.target.checked })}
                          className="mt-0.5 accent-amber-600 rounded"
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900">Mode Uji Coba (data-adtest=&quot;on&quot;)</div>
                          <div className="text-[11px] text-slate-500">
                            Aktifkan saat staging/uji tata letak agar mematuhi kebijakan AdSense.
                          </div>
                        </div>
                      </label>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.hideAdsInOfflineMode}
                        onChange={(e) => updateDraft({ hideAdsInOfflineMode: e.target.checked })}
                        className="accent-emerald-600 rounded"
                      />
                      <span>Jangan muat skrip Google AdSense ketika pengguna mengaktifkan Mode Offline.</span>
                    </label>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-800">
                        Catatan Admin (Opsional)
                      </label>
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={draft.adminNote}
                        onChange={(e) => updateDraft({ adminNote: e.target.value })}
                        placeholder="Mis. Pengaktifan AdSense v1 untuk halaman pratinjau & footer..."
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                  </div>
                </section>

                {/* Live Head Preview Box */}
                <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                      Pratinjau Tag &lt;head&gt; Live Web App
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Tag berikut otomatis disuntikkan secara dinamis ke <code className="font-mono">&lt;head&gt;</code> aplikasi web saat konfigurasi disimpan dan status AdSense aktif:
                  </p>
                  <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                    {!draft.adsenseEnabled || !cleanPubPreview
                      ? '<!-- Google AdSense sedang nonaktif atau ca-pub belum diisi -->'
                      : [
                          draft.headMetaEnabled
                            ? `<meta name="google-adsense-account" content="${cleanPubPreview}" />`
                            : '<!-- Meta google-adsense-account dimatikan -->',
                          draft.autoAdsEnabled
                            ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cleanPubPreview}" crossorigin="anonymous"></script>`
                            : '<!-- Auto Ads script dimatikan -->',
                        ].join('\n')}
                  </pre>

                  <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveConfig()}
                      disabled={siteAdsense.savingConfig}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      {siteAdsense.savingConfig ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>Simpan Semua ke Cloud</span>
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 2: 4 App Placement Zones */}
            {activeTab === 'slots' && (
              <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Pengaturan 4 Zona Slot Iklan di Aplikasi TemaLoka
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Aktifkan zona dan masukkan <code className="font-mono">data-ad-slot</code> masing-masing. Pastikan AdSense Global juga aktif di tab Pengaturan Global.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveConfig()}
                    disabled={siteAdsense.savingConfig || !isDirty}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Simpan Zona Iklan</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Top Banner */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">1. Top Banner Workspace</div>
                        <div className="text-[11px] text-slate-500">Muncul ringkas di atas kanvas kerja utama.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.topBannerEnabled}
                        onChange={(e) => updateDraft({ topBannerEnabled: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Slot ID</label>
                        <input
                          type="text"
                          value={draft.topBannerSlot}
                          onChange={(e) =>
                            updateDraft({ topBannerSlot: sanitizeSlotDigits(e.target.value) })
                          }
                          placeholder="1234567890"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Format</label>
                        <select
                          value={draft.topBannerFormat}
                          onChange={(e) =>
                            updateDraft({ topBannerFormat: e.target.value as TopBannerFormat })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                        >
                          <option value="horizontal">Horizontal</option>
                          <option value="auto">Auto</option>
                          <option value="rectangle">Rectangle</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar Slot */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">2. Sidebar Panel Kiri</div>
                        <div className="text-[11px] text-slate-500">Muncul di bagian bawah panel alat kiri.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.sidebarSlotEnabled}
                        onChange={(e) => updateDraft({ sidebarSlotEnabled: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Slot ID</label>
                        <input
                          type="text"
                          value={draft.sidebarSlotId}
                          onChange={(e) =>
                            updateDraft({ sidebarSlotId: sanitizeSlotDigits(e.target.value) })
                          }
                          placeholder="2345678901"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Format</label>
                        <select
                          value={draft.sidebarSlotFormat}
                          onChange={(e) =>
                            updateDraft({ sidebarSlotFormat: e.target.value as SidebarSlotFormat })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                        >
                          <option value="rectangle">Rectangle (300x250)</option>
                          <option value="vertical">Vertical</option>
                          <option value="auto">Auto</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Footer / SEO Bottom Slot */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">3. Footer / Bawah Halaman SEO</div>
                        <div className="text-[11px] text-slate-500">Muncul di area bawah tab SEO &amp; Splitter.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.footerSlotEnabled}
                        onChange={(e) => updateDraft({ footerSlotEnabled: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Slot ID</label>
                        <input
                          type="text"
                          value={draft.footerSlotId}
                          onChange={(e) =>
                            updateDraft({ footerSlotId: sanitizeSlotDigits(e.target.value) })
                          }
                          placeholder="3456789012"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Format</label>
                        <select
                          value={draft.footerSlotFormat}
                          onChange={(e) =>
                            updateDraft({ footerSlotFormat: e.target.value as FooterSlotFormat })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                        >
                          <option value="auto">Auto Responsive</option>
                          <option value="horizontal">Horizontal</option>
                          <option value="rectangle">Rectangle</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Export Modal Slot */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">4. Modal Ekspor Tema XML</div>
                        <div className="text-[11px] text-slate-500">Muncul di bagian bawah jendela Ekspor Tema.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.modalSlotEnabled}
                        onChange={(e) => updateDraft({ modalSlotEnabled: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Slot ID</label>
                        <input
                          type="text"
                          value={draft.modalSlotId}
                          onChange={(e) =>
                            updateDraft({ modalSlotId: sanitizeSlotDigits(e.target.value) })
                          }
                          placeholder="4567890123"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-700">Format</label>
                        <select
                          value={draft.modalSlotFormat}
                          onChange={(e) =>
                            updateDraft({ modalSlotFormat: e.target.value as ModalSlotFormat })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                        >
                          <option value="rectangle">Rectangle</option>
                          <option value="auto">Auto</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* TAB 3: Custom Ad Units Library */}
            {activeTab === 'units' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <form
                  onSubmit={(e) => void handleSaveUnit(e)}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-slate-900">
                      {editingUnitId ? 'Edit Unit Iklan' : 'Tambah Unit Iklan Baru'}
                    </h2>
                    {editingUnitId && (
                      <button
                        type="button"
                        onClick={resetUnitForm}
                        className="text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        Batal Edit
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Nama Unit Iklan
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={unitName}
                      onChange={(e) => setUnitName(e.target.value)}
                      placeholder="Mis. Banner Atas Blog / Iklan Dalam Artikel"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Slot ID (data-ad-slot)
                      </label>
                      <input
                        type="text"
                        maxLength={32}
                        value={unitSlotId}
                        onChange={(e) => setUnitSlotId(sanitizeSlotDigits(e.target.value))}
                        placeholder="1234567890"
                        className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Format
                      </label>
                      <select
                        value={unitFormat}
                        onChange={(e) => setUnitFormat(e.target.value as AdsenseUnitFormatType)}
                        className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <option value="responsive">Auto Responsive</option>
                        <option value="leaderboard">Leaderboard 728x90</option>
                        <option value="sidebar">Sidebar 300x250</option>
                        <option value="in-article">In-Article Fluid</option>
                        <option value="multiplex">Multiplex Grid</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Target Penggunaan
                    </label>
                    <select
                      value={unitPlacement}
                      onChange={(e) =>
                        setUnitPlacement(e.target.value as AdsenseUnitPlacementType)
                      }
                      className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="bloggerTemplate">Sisipan Template XML Blogger</option>
                      <option value="topBanner">Top Banner Aplikasi</option>
                      <option value="sidebarSlot">Sidebar Aplikasi</option>
                      <option value="footerSlot">Footer Aplikasi</option>
                      <option value="modalSlot">Modal Ekspor</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Catatan Singkat
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={unitNotes}
                      onChange={(e) => setUnitNotes(e.target.value)}
                      placeholder="Opsional..."
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={unitEnabled}
                        onChange={(e) => setUnitEnabled(e.target.checked)}
                        className="accent-emerald-600 rounded"
                      />
                      <span>Aktif</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={unitOnlyOnPosts}
                        onChange={(e) => setUnitOnlyOnPosts(e.target.checked)}
                        className="accent-emerald-600 rounded"
                      />
                      <span>Khusus halaman artikel (<code className="font-mono text-[11px]">isPost</code>)</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    {actionBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>{editingUnitId ? 'Simpan Perubahan Unit' : 'Simpan Unit ke Cloud'}</span>
                  </button>
                </form>

                {/* Saved Units List */}
                <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Daftar Unit Iklan Tersimpan ({siteAdsense.units.length})
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Pilih section target di template XML aktif untuk langsung memasang unit ini dengan satu klik.
                      </p>
                    </div>
                    <select
                      aria-label="Target section XML"
                      value={targetSectionId}
                      onChange={(e) => setTargetSectionId(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      {parsedInfo.sections.length === 0 ? (
                        <option value="sidebar">#sidebar</option>
                      ) : (
                        parsedInfo.sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            Section #{s.id}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {siteAdsense.units.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                      Belum ada unit iklan kustom tersimpan di Cloud. Tambahkan lewat formulir di sebelah kiri.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {siteAdsense.units.map((u) => (
                        <div
                          key={u.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-900">{u.name}</span>
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                                    u.enabled
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {u.enabled ? 'Aktif' : 'Nonaktif'}
                                </span>
                                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-white border border-slate-200 text-slate-700 rounded">
                                  {u.format}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                Slot: {u.slotId || '(otomatis)'} · Target: {u.placement}
                                {u.onlyOnPosts ? ' · Hanya Artikel' : ''}
                              </div>
                              {u.notes && (
                                <p className="text-[11px] text-slate-600 mt-1">{u.notes}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => startEditUnit(u)}
                                className="px-2 py-1 text-[11px] font-medium bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteUnit(u)}
                                aria-label={`Hapus ${u.name}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/70">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(`html-${u.id}`, buildUnitHtmlSnippet(u), 'Kode HTML AdSense')
                              }
                              className="px-2.5 py-1.5 text-[11px] font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
                            >
                              {copiedKey === `html-${u.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>Salin HTML</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  `xml-${u.id}`,
                                  buildUnitBloggerXmlSnippet(u),
                                  'Snippet XML Blogger'
                                )
                              }
                              className="px-2.5 py-1.5 text-[11px] font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
                            >
                              {copiedKey === `xml-${u.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>Salin XML Blogger</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const pub = cleanPubPreview;
                                if (!pub) {
                                  onNotify?.(
                                    'Isi Publisher ID (ca-pub-...) di Pengaturan Global terlebih dahulu.',
                                    'info'
                                  );
                                  return;
                                }
                                const res = injectAdsenseIntoXml(xml, {
                                  publisherId: pub,
                                  slotId: u.slotId,
                                  format: u.format,
                                  target: { kind: 'section-html-ins', sectionId: targetSectionId },
                                  onlyOnPosts: u.onlyOnPosts,
                                  widgetTitle: u.name,
                                });
                                if (!res.changed) {
                                  onNotify?.(res.summary, 'info');
                                } else {
                                  onUpdateXml(res.nextXml, res.summary);
                                }
                              }}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <PlusCircle className="w-3 h-3" />
                              <span>Pasang ke Template XML (#{targetSectionId})</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 4: /ads.txt Manager */}
            {activeTab === 'adstxt' && (
              <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Pengelola File <code className="font-mono">/ads.txt</code> Live &amp; Blogger
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Setelah disimpan ke Cloud, endpoint <code className="font-mono">{adminUrlOrigin}/ads.txt</code> langsung menyajikan isi file ini untuk verifikasi crawler AdSense.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const autoLine = buildAdsTxtLine(draft.publisherId);
                        if (!autoLine) {
                          onNotify?.('Isi Publisher ID valid di tab Pengaturan Global dulu.', 'info');
                          return;
                        }
                        updateDraft({ adsTxtContent: autoLine });
                        onNotify?.('Baris ads.txt dibuat otomatis dari Publisher ID.', 'success');
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                    >
                      Generate dari Publisher ID
                    </button>
                    <a
                      href="/ads.txt"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1"
                    >
                      <span>Buka /ads.txt</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                <textarea
                  rows={5}
                  maxLength={4000}
                  value={draft.adsTxtContent}
                  onChange={(e) => updateDraft({ adsTxtContent: e.target.value })}
                  spellCheck={false}
                  placeholder="google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0"
                  className="w-full p-3 text-xs font-mono bg-slate-900 text-emerald-300 border border-slate-800 rounded-xl focus:outline-none focus:border-emerald-500"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy('adstxt-content', draft.adsTxtContent, 'Isi ads.txt')
                      }
                      className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin ads.txt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const content =
                          draft.adsTxtContent.trim() || buildAdsTxtLine(draft.publisherId);
                        if (!content) {
                          onNotify?.('Isi ads.txt masih kosong.', 'info');
                          return;
                        }
                        const blob = new Blob([content + '\n'], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'ads.txt';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh ads.txt</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={siteAdsense.savingConfig}
                    onClick={() => void handleSaveConfig()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Simpan &amp; Terbitkan /ads.txt</span>
                  </button>
                </div>
              </section>
            )}

            {/* TAB 5: Admin Links & Access Management */}
            {activeTab === 'admins' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-bold text-slate-900">
                      Tautan Langsung Panel Admin
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Gunakan salah satu URL di bawah ini kapan saja untuk langsung membuka Admin Panel AdSense:
                  </p>
                  <div className="space-y-2">
                    {[
                      `${adminUrlOrigin}/?admin`,
                      `${adminUrlOrigin}/?admin=1`,
                      `${adminUrlOrigin}/admin`,
                    ].map((link) => (
                      <div
                        key={link}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                      >
                        <code className="text-xs font-mono text-slate-800 truncate">{link}</code>
                        <button
                          type="button"
                          onClick={() => handleCopy(link, link, 'Tautan Admin')}
                          className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-200 rounded hover:bg-slate-100 shrink-0 cursor-pointer"
                        >
                          {copiedKey === link ? 'Tersalin' : 'Salin'}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      <span>Admin Utama Terverifikasi</span>
                    </div>
                    <div className="font-mono text-[11px]">
                      Email: {ADMIN_BOOTSTRAP_EMAIL} · UID Aktif Anda: {user?.uid}
                    </div>
                  </div>
                </section>

                <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-sm font-bold text-slate-900">
                      Co-Admin Tambahan (Firestore /admins)
                    </h2>
                  </div>

                  {!siteAdsense.isBootstrappedAdmin ? (
                    <p className="text-xs text-slate-600">
                      Hanya Admin utama (<span className="font-mono">{ADMIN_BOOTSTRAP_EMAIL}</span>) yang dapat menambah atau menghapus Co-Admin tambahan.
                    </p>
                  ) : (
                    <>
                      <form onSubmit={(e) => void handleAddAdmin(e)} className="space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            required
                            value={newAdminUid}
                            onChange={(e) => setNewAdminUid(e.target.value)}
                            placeholder="Firebase Auth UID"
                            className="px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                          />
                          <input
                            type="email"
                            required
                            value={newAdminEmail}
                            onChange={(e) => setNewAdminEmail(e.target.value)}
                            placeholder="email@gmail.com"
                            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newAdminLabel}
                            onChange={(e) => setNewAdminLabel(e.target.value)}
                            placeholder="Label (mis. Editor Monetisasi)"
                            className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                          />
                          <button
                            type="submit"
                            disabled={actionBusy}
                            className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer shrink-0"
                          >
                            Tambah Admin
                          </button>
                        </div>
                      </form>

                      <div className="space-y-2 pt-1">
                        {siteAdsense.admins.length === 0 ? (
                          <div className="text-xs text-slate-500 py-3 text-center border border-dashed border-slate-200 rounded-lg">
                            Belum ada Co-Admin tambahan.
                          </div>
                        ) : (
                          siteAdsense.admins.map((adm) => (
                            <div
                              key={adm.uid}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 truncate">
                                  {adm.email} ({adm.label || 'Co-Admin'})
                                </div>
                                <div className="text-[11px] font-mono text-slate-500 truncate">
                                  UID: {adm.uid}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void siteAdsense.removeAdminUser(adm.uid)}
                                aria-label={`Hapus admin ${adm.email}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
