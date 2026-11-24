import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  ADSENSE_FIELD_LIMITS,
  DEFAULT_SITE_ADSENSE_CONFIG,
  sanitizePublisherId,
  sanitizeSlotDigits,
  type AdminUserRecord,
  type AdsenseUnitFormatType,
  type AdsenseUnitPlacementType,
  type AdsenseUnitRecord,
  type FooterSlotFormat,
  type ModalSlotFormat,
  type SidebarSlotFormat,
  type SiteAdsenseConfig,
  type TopBannerFormat,
} from '../types/adsense';

const APP_CONFIG_COLLECTION = 'appConfig';
const ADSENSE_DOC_ID = 'adsense';
const UNITS_COLLECTION = 'adsenseUnits';
const ADMINS_COLLECTION = 'admins';
const MANAGED_HEAD_ATTR = 'data-temaloka-managed-adsense';

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

function asBannerFormat(v: unknown): TopBannerFormat {
  return v === 'auto' || v === 'horizontal' || v === 'rectangle' ? v : 'horizontal';
}

function asSidebarFormat(v: unknown): SidebarSlotFormat {
  return v === 'auto' || v === 'vertical' || v === 'rectangle' ? v : 'rectangle';
}

function asFooterFormat(v: unknown): FooterSlotFormat {
  return v === 'auto' || v === 'horizontal' || v === 'rectangle' ? v : 'auto';
}

function asModalFormat(v: unknown): ModalSlotFormat {
  return v === 'auto' || v === 'rectangle' ? v : 'rectangle';
}

function asUnitFormat(v: unknown): AdsenseUnitFormatType {
  return v === 'leaderboard' ||
    v === 'sidebar' ||
    v === 'in-article' ||
    v === 'multiplex' ||
    v === 'responsive'
    ? v
    : 'responsive';
}

function asUnitPlacement(v: unknown): AdsenseUnitPlacementType {
  return v === 'topBanner' ||
    v === 'sidebarSlot' ||
    v === 'footerSlot' ||
    v === 'modalSlot' ||
    v === 'bloggerTemplate'
    ? v
    : 'bloggerTemplate';
}

function makeUnitDocId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ad_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  }
  return `ad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface SiteAdsenseController {
  config: SiteAdsenseConfig;
  configExistsInCloud: boolean;
  loadingConfig: boolean;
  savingConfig: boolean;
  units: AdsenseUnitRecord[];
  loadingUnits: boolean;
  admins: AdminUserRecord[];
  isBootstrappedAdmin: boolean;
  isAdmin: boolean;
  checkingAdmin: boolean;
  shouldRenderLiveAds: boolean;
  saveGlobalConfig: (next: SiteAdsenseConfig) => Promise<void>;
  createAdUnit: (input: {
    name: string;
    slotId: string;
    format: AdsenseUnitFormatType;
    placement: AdsenseUnitPlacementType;
    enabled: boolean;
    onlyOnPosts: boolean;
    notes: string;
  }) => Promise<void>;
  updateAdUnit: (
    unitId: string,
    patch: {
      name: string;
      slotId: string;
      format: AdsenseUnitFormatType;
      placement: AdsenseUnitPlacementType;
      enabled: boolean;
      onlyOnPosts: boolean;
      notes: string;
    }
  ) => Promise<void>;
  deleteAdUnit: (unitId: string) => Promise<void>;
  addAdminUser: (uid: string, email: string, label: string) => Promise<void>;
  removeAdminUser: (uid: string) => Promise<void>;
}

export function useSiteAdsense(
  user: User | null,
  authReady: boolean,
  isOfflineMode: boolean
): SiteAdsenseController {
  const [config, setConfig] = useState<SiteAdsenseConfig>(DEFAULT_SITE_ADSENSE_CONFIG);
  const [configExistsInCloud, setConfigExistsInCloud] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  const [units, setUnits] = useState<AdsenseUnitRecord[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [admins, setAdmins] = useState<AdminUserRecord[]>([]);

  const [isExtraAdmin, setIsExtraAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  const isBootstrappedAdmin = useMemo(() => {
    if (!user || !user.emailVerified) return false;
    return (user.email || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL;
  }, [user]);

  useEffect(() => {
    if (!authReady) return;
    if (!user || !user.emailVerified) {
      setIsExtraAdmin(false);
      setCheckingAdmin(false);
      return;
    }
    if (isBootstrappedAdmin) {
      setIsExtraAdmin(true);
      setCheckingAdmin(false);
      return;
    }

    let cancelled = false;
    setCheckingAdmin(true);
    const adminRef = doc(db, ADMINS_COLLECTION, user.uid);
    getDoc(adminRef)
      .then((snap) => {
        if (!cancelled) {
          setIsExtraAdmin(snap.exists());
          setCheckingAdmin(false);
        }
      })
      .catch((error) => {
        // Non-admin read denial should cleanly fall back to false; log unexpected errors via handler helper pattern
        if (!cancelled) {
          setIsExtraAdmin(false);
          setCheckingAdmin(false);
        }
        const msg = error instanceof Error ? error.message : String(error);
        if (!/permission|insufficient/i.test(msg)) {
          console.warn('Admin check warning:', msg);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, user, isBootstrappedAdmin]);

  const isAdmin = isBootstrappedAdmin || isExtraAdmin;

  // Subscribe to public /appConfig/adsense doc
  useEffect(() => {
    const configPath = `${APP_CONFIG_COLLECTION}/${ADSENSE_DOC_ID}`;
    const configRef = doc(db, APP_CONFIG_COLLECTION, ADSENSE_DOC_ID);
    const unsub = onSnapshot(
      configRef,
      (snap) => {
        setLoadingConfig(false);
        if (!snap.exists()) {
          setConfigExistsInCloud(false);
          setConfig(DEFAULT_SITE_ADSENSE_CONFIG);
          return;
        }
        const d = snap.data() as Record<string, unknown>;
        setConfigExistsInCloud(true);
        setConfig({
          adsenseEnabled: Boolean(d.adsenseEnabled),
          publisherId: typeof d.publisherId === 'string' ? d.publisherId : '',
          autoAdsEnabled: Boolean(d.autoAdsEnabled),
          headMetaEnabled: Boolean(d.headMetaEnabled),
          adsTxtContent: typeof d.adsTxtContent === 'string' ? d.adsTxtContent : '',
          hideAdsForAdmin: d.hideAdsForAdmin !== false,
          hideAdsInOfflineMode: d.hideAdsInOfflineMode !== false,
          testMode: Boolean(d.testMode),
          defaultTemplatePubId:
            typeof d.defaultTemplatePubId === 'string' ? d.defaultTemplatePubId : '',
          topBannerEnabled: Boolean(d.topBannerEnabled),
          topBannerSlot: typeof d.topBannerSlot === 'string' ? d.topBannerSlot : '',
          topBannerFormat: asBannerFormat(d.topBannerFormat),
          sidebarSlotEnabled: Boolean(d.sidebarSlotEnabled),
          sidebarSlotId: typeof d.sidebarSlotId === 'string' ? d.sidebarSlotId : '',
          sidebarSlotFormat: asSidebarFormat(d.sidebarSlotFormat),
          footerSlotEnabled: Boolean(d.footerSlotEnabled),
          footerSlotId: typeof d.footerSlotId === 'string' ? d.footerSlotId : '',
          footerSlotFormat: asFooterFormat(d.footerSlotFormat),
          modalSlotEnabled: Boolean(d.modalSlotEnabled),
          modalSlotId: typeof d.modalSlotId === 'string' ? d.modalSlotId : '',
          modalSlotFormat: asModalFormat(d.modalSlotFormat),
          adminNote: typeof d.adminNote === 'string' ? d.adminNote : '',
          updatedByUid: typeof d.updatedByUid === 'string' ? d.updatedByUid : '',
          updatedByEmail: typeof d.updatedByEmail === 'string' ? d.updatedByEmail : '',
          updatedAtMs: toMillis(d.updatedAt),
        });
      },
      (error) => {
        setLoadingConfig(false);
        handleFirestoreError(error, OperationType.GET, configPath);
      }
    );
    return () => unsub();
  }, []);

  // Subscribe to custom Ad Units (all units for bootstrapped admin, enabled units for visitors)
  useEffect(() => {
    if (!authReady) return;
    setLoadingUnits(true);
    const q = isBootstrappedAdmin
      ? query(collection(db, UNITS_COLLECTION))
      : query(collection(db, UNITS_COLLECTION), where('enabled', '==', true));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AdsenseUnitRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            name: typeof d.name === 'string' ? d.name : docSnap.id,
            slotId: typeof d.slotId === 'string' ? d.slotId : '',
            format: asUnitFormat(d.format),
            placement: asUnitPlacement(d.placement),
            enabled: Boolean(d.enabled),
            onlyOnPosts: Boolean(d.onlyOnPosts),
            notes: typeof d.notes === 'string' ? d.notes : '',
            createdByUid: typeof d.createdByUid === 'string' ? d.createdByUid : '',
            createdAtMs: toMillis(d.createdAt),
            updatedAtMs: toMillis(d.updatedAt),
          };
        });
        list.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.name.localeCompare(b.name));
        setUnits(list);
        setLoadingUnits(false);
      },
      (error) => {
        setLoadingUnits(false);
        handleFirestoreError(error, OperationType.LIST, UNITS_COLLECTION);
      }
    );

    return () => unsub();
  }, [authReady, isBootstrappedAdmin]);

  // Subscribe to additional Admin list (bootstrapped admin only)
  useEffect(() => {
    if (!authReady || !isBootstrappedAdmin) {
      setAdmins([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, ADMINS_COLLECTION),
      (snap) => {
        const rows: AdminUserRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          return {
            uid: typeof d.uid === 'string' ? d.uid : docSnap.id,
            email: typeof d.email === 'string' ? d.email : '',
            label: typeof d.label === 'string' ? d.label : '',
            addedByUid: typeof d.addedByUid === 'string' ? d.addedByUid : '',
            createdAtMs: toMillis(d.createdAt),
          };
        });
        rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setAdmins(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, ADMINS_COLLECTION);
      }
    );

    return () => unsub();
  }, [authReady, isBootstrappedAdmin]);

  const shouldRenderLiveAds = useMemo(() => {
    if (!config.adsenseEnabled) return false;
    if (!sanitizePublisherId(config.publisherId)) return false;
    if (config.hideAdsInOfflineMode && isOfflineMode) return false;
    if (config.hideAdsForAdmin && isAdmin) return false;
    return true;
  }, [config, isOfflineMode, isAdmin]);

  // Dynamically manage <meta name="google-adsense-account"> & Auto Ads <script> in document.head
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const head = document.head;
    if (!head) return;

    const cleanPub = sanitizePublisherId(config.publisherId);
    const existingMeta = head.querySelector(`meta[${MANAGED_HEAD_ATTR}="meta"]`);
    const existingScript = head.querySelector(`script[${MANAGED_HEAD_ATTR}="script"]`);

    const wantMeta = config.adsenseEnabled && config.headMetaEnabled && Boolean(cleanPub);
    if (wantMeta) {
      if (existingMeta) {
        if (existingMeta.getAttribute('content') !== cleanPub) {
          existingMeta.setAttribute('content', cleanPub);
        }
      } else {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'google-adsense-account');
        meta.setAttribute('content', cleanPub);
        meta.setAttribute(MANAGED_HEAD_ATTR, 'meta');
        head.appendChild(meta);
      }
    } else if (existingMeta) {
      existingMeta.remove();
    }

    const wantScript =
      shouldRenderLiveAds && config.autoAdsEnabled && Boolean(cleanPub);
    const desiredSrc = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cleanPub}`;

    if (wantScript) {
      if (existingScript) {
        if (existingScript.getAttribute('src') !== desiredSrc) {
          existingScript.remove();
          const script = document.createElement('script');
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.src = desiredSrc;
          script.setAttribute(MANAGED_HEAD_ATTR, 'script');
          head.appendChild(script);
        }
      } else {
        const script = document.createElement('script');
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = desiredSrc;
        script.setAttribute(MANAGED_HEAD_ATTR, 'script');
        head.appendChild(script);
      }
    } else if (existingScript) {
      existingScript.remove();
    }
  }, [config.adsenseEnabled, config.headMetaEnabled, config.autoAdsEnabled, config.publisherId, shouldRenderLiveAds]);

  const saveGlobalConfig = useCallback(
    async (next: SiteAdsenseConfig) => {
      if (!user || !user.emailVerified || !isAdmin) {
        throw new Error('Hanya akun Admin terverifikasi yang dapat menyimpan pengaturan AdSense.');
      }

      const rawPub = next.publisherId.trim();
      const sanitizedPub = rawPub ? sanitizePublisherId(rawPub) : '';
      if (rawPub && !sanitizedPub) {
        throw new Error('Format Publisher ID tidak valid. Gunakan format ca-pub-1234567890123456.');
      }

      const rawTplPub = next.defaultTemplatePubId.trim();
      const sanitizedTplPub = rawTplPub ? sanitizePublisherId(rawTplPub) : '';
      if (rawTplPub && !sanitizedTplPub) {
        throw new Error('Format Publisher ID default template tidak valid.');
      }

      const payload = {
        adsenseEnabled: Boolean(next.adsenseEnabled),
        publisherId: sanitizedPub,
        autoAdsEnabled: Boolean(next.autoAdsEnabled),
        headMetaEnabled: Boolean(next.headMetaEnabled),
        adsTxtContent: next.adsTxtContent.slice(0, ADSENSE_FIELD_LIMITS.adsTxtMax),
        hideAdsForAdmin: Boolean(next.hideAdsForAdmin),
        hideAdsInOfflineMode: Boolean(next.hideAdsInOfflineMode),
        testMode: Boolean(next.testMode),
        defaultTemplatePubId: sanitizedTplPub || sanitizedPub,
        topBannerEnabled: Boolean(next.topBannerEnabled),
        topBannerSlot: sanitizeSlotDigits(next.topBannerSlot),
        topBannerFormat: asBannerFormat(next.topBannerFormat),
        sidebarSlotEnabled: Boolean(next.sidebarSlotEnabled),
        sidebarSlotId: sanitizeSlotDigits(next.sidebarSlotId),
        sidebarSlotFormat: asSidebarFormat(next.sidebarSlotFormat),
        footerSlotEnabled: Boolean(next.footerSlotEnabled),
        footerSlotId: sanitizeSlotDigits(next.footerSlotId),
        footerSlotFormat: asFooterFormat(next.footerSlotFormat),
        modalSlotEnabled: Boolean(next.modalSlotEnabled),
        modalSlotId: sanitizeSlotDigits(next.modalSlotId),
        modalSlotFormat: asModalFormat(next.modalSlotFormat),
        adminNote: next.adminNote.slice(0, ADSENSE_FIELD_LIMITS.adminNoteMax),
        updatedByUid: user.uid,
        updatedByEmail: (user.email || ADMIN_BOOTSTRAP_EMAIL).slice(0, ADSENSE_FIELD_LIMITS.adminEmailMax),
        updatedAt: serverTimestamp(),
      };

      const docPath = `${APP_CONFIG_COLLECTION}/${ADSENSE_DOC_ID}`;
      setSavingConfig(true);
      try {
        await setDoc(doc(db, APP_CONFIG_COLLECTION, ADSENSE_DOC_ID), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, docPath);
      } finally {
        setSavingConfig(false);
      }
    },
    [user, isAdmin]
  );

  const createAdUnit = useCallback(
    async (input: {
      name: string;
      slotId: string;
      format: AdsenseUnitFormatType;
      placement: AdsenseUnitPlacementType;
      enabled: boolean;
      onlyOnPosts: boolean;
      notes: string;
    }) => {
      if (!user || !user.emailVerified || !isAdmin) {
        throw new Error('Hanya Admin yang dapat membuat unit iklan.');
      }
      const cleanName = input.name.trim().slice(0, ADSENSE_FIELD_LIMITS.unitNameMax);
      if (!cleanName) {
        throw new Error('Nama unit iklan wajib diisi.');
      }
      const unitId = makeUnitDocId();
      const docPath = `${UNITS_COLLECTION}/${unitId}`;
      try {
        await setDoc(doc(db, UNITS_COLLECTION, unitId), {
          name: cleanName,
          slotId: sanitizeSlotDigits(input.slotId),
          format: asUnitFormat(input.format),
          placement: asUnitPlacement(input.placement),
          enabled: Boolean(input.enabled),
          onlyOnPosts: Boolean(input.onlyOnPosts),
          notes: input.notes.trim().slice(0, ADSENSE_FIELD_LIMITS.unitNotesMax),
          createdByUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, docPath);
      }
    },
    [user, isAdmin]
  );

  const updateAdUnit = useCallback(
    async (
      unitId: string,
      patch: {
        name: string;
        slotId: string;
        format: AdsenseUnitFormatType;
        placement: AdsenseUnitPlacementType;
        enabled: boolean;
        onlyOnPosts: boolean;
        notes: string;
      }
    ) => {
      if (!user || !user.emailVerified || !isAdmin) {
        throw new Error('Hanya Admin yang dapat mengubah unit iklan.');
      }
      const cleanName = patch.name.trim().slice(0, ADSENSE_FIELD_LIMITS.unitNameMax);
      if (!cleanName) {
        throw new Error('Nama unit iklan wajib diisi.');
      }
      const docPath = `${UNITS_COLLECTION}/${unitId}`;
      try {
        await updateDoc(doc(db, UNITS_COLLECTION, unitId), {
          name: cleanName,
          slotId: sanitizeSlotDigits(patch.slotId),
          format: asUnitFormat(patch.format),
          placement: asUnitPlacement(patch.placement),
          enabled: Boolean(patch.enabled),
          onlyOnPosts: Boolean(patch.onlyOnPosts),
          notes: patch.notes.trim().slice(0, ADSENSE_FIELD_LIMITS.unitNotesMax),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, docPath);
      }
    },
    [user, isAdmin]
  );

  const deleteAdUnit = useCallback(
    async (unitId: string) => {
      if (!user || !user.emailVerified || !isAdmin) {
        throw new Error('Hanya Admin yang dapat menghapus unit iklan.');
      }
      const docPath = `${UNITS_COLLECTION}/${unitId}`;
      try {
        await deleteDoc(doc(db, UNITS_COLLECTION, unitId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, docPath);
      }
    },
    [user, isAdmin]
  );

  const addAdminUser = useCallback(
    async (targetUid: string, email: string, label: string) => {
      if (!user || !isBootstrappedAdmin) {
        throw new Error('Hanya Admin utama yang dapat menambahkan Admin tambahan.');
      }
      const cleanUid = targetUid.trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanUid)) {
        throw new Error('UID Firebase harus berisi huruf/angka/-/_ yang valid.');
      }
      const cleanEmail = email.trim().slice(0, ADSENSE_FIELD_LIMITS.adminEmailMax);
      if (!cleanEmail.includes('@') || cleanEmail.length < 3) {
        throw new Error('Masukkan alamat email Google yang valid.');
      }
      const docPath = `${ADMINS_COLLECTION}/${cleanUid}`;
      try {
        await setDoc(doc(db, ADMINS_COLLECTION, cleanUid), {
          uid: cleanUid,
          email: cleanEmail,
          label: (label.trim() || 'Admin Co-Manager').slice(0, ADSENSE_FIELD_LIMITS.adminLabelMax),
          addedByUid: user.uid,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, docPath);
      }
    },
    [user, isBootstrappedAdmin]
  );

  const removeAdminUser = useCallback(
    async (targetUid: string) => {
      if (!user || !isBootstrappedAdmin) {
        throw new Error('Hanya Admin utama yang dapat menghapus Admin tambahan.');
      }
      const docPath = `${ADMINS_COLLECTION}/${targetUid}`;
      try {
        await deleteDoc(doc(db, ADMINS_COLLECTION, targetUid));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, docPath);
      }
    },
    [user, isBootstrappedAdmin]
  );

  return {
    config,
    configExistsInCloud,
    loadingConfig,
    savingConfig,
    units,
    loadingUnits,
    admins,
    isBootstrappedAdmin,
    isAdmin,
    checkingAdmin,
    shouldRenderLiveAds,
    saveGlobalConfig,
    createAdUnit,
    updateAdUnit,
    deleteAdUnit,
    addAdminUser,
    removeAdminUser,
  };
}
