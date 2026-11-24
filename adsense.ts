export const ADMIN_BOOTSTRAP_EMAIL = 'mehmet.azmir@gmail.com';

export type TopBannerFormat = 'auto' | 'horizontal' | 'rectangle';
export type SidebarSlotFormat = 'auto' | 'vertical' | 'rectangle';
export type FooterSlotFormat = 'auto' | 'horizontal' | 'rectangle';
export type ModalSlotFormat = 'auto' | 'rectangle';

export type AdsenseUnitFormatType =
  | 'responsive'
  | 'leaderboard'
  | 'sidebar'
  | 'in-article'
  | 'multiplex';

export type AdsenseUnitPlacementType =
  | 'topBanner'
  | 'sidebarSlot'
  | 'footerSlot'
  | 'modalSlot'
  | 'bloggerTemplate';

export interface SiteAdsenseConfig {
  adsenseEnabled: boolean;
  publisherId: string;
  autoAdsEnabled: boolean;
  headMetaEnabled: boolean;
  adsTxtContent: string;
  hideAdsForAdmin: boolean;
  hideAdsInOfflineMode: boolean;
  testMode: boolean;
  defaultTemplatePubId: string;
  topBannerEnabled: boolean;
  topBannerSlot: string;
  topBannerFormat: TopBannerFormat;
  sidebarSlotEnabled: boolean;
  sidebarSlotId: string;
  sidebarSlotFormat: SidebarSlotFormat;
  footerSlotEnabled: boolean;
  footerSlotId: string;
  footerSlotFormat: FooterSlotFormat;
  modalSlotEnabled: boolean;
  modalSlotId: string;
  modalSlotFormat: ModalSlotFormat;
  adminNote: string;
  updatedByUid: string;
  updatedByEmail: string;
  updatedAtMs: number;
}

export interface AdsenseUnitRecord {
  id: string;
  name: string;
  slotId: string;
  format: AdsenseUnitFormatType;
  placement: AdsenseUnitPlacementType;
  enabled: boolean;
  onlyOnPosts: boolean;
  notes: string;
  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AdminUserRecord {
  uid: string;
  email: string;
  label: string;
  addedByUid: string;
  createdAtMs: number;
}

export const ADSENSE_FIELD_LIMITS = {
  publisherIdMax: 40,
  slotIdMax: 32,
  adsTxtMax: 4000,
  adminNoteMax: 500,
  unitNameMax: 120,
  unitNotesMax: 300,
  adminLabelMax: 80,
  adminEmailMax: 160,
} as const;

export const DEFAULT_SITE_ADSENSE_CONFIG: SiteAdsenseConfig = {
  adsenseEnabled: false,
  publisherId: '',
  autoAdsEnabled: true,
  headMetaEnabled: true,
  adsTxtContent: '',
  hideAdsForAdmin: true,
  hideAdsInOfflineMode: true,
  testMode: false,
  defaultTemplatePubId: '',
  topBannerEnabled: false,
  topBannerSlot: '',
  topBannerFormat: 'horizontal',
  sidebarSlotEnabled: false,
  sidebarSlotId: '',
  sidebarSlotFormat: 'rectangle',
  footerSlotEnabled: false,
  footerSlotId: '',
  footerSlotFormat: 'auto',
  modalSlotEnabled: false,
  modalSlotId: '',
  modalSlotFormat: 'rectangle',
  adminNote: '',
  updatedByUid: '',
  updatedByEmail: '',
  updatedAtMs: 0,
};

export function sanitizePublisherId(raw: string): string {
  const digits = /(?:ca-pub-|pub-)?(\d{10,20})/i.exec(raw.trim());
  if (!digits) return '';
  return `ca-pub-${digits[1]}`.slice(0, ADSENSE_FIELD_LIMITS.publisherIdMax);
}

export function sanitizeSlotDigits(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, ADSENSE_FIELD_LIMITS.slotIdMax);
}

export function buildAdsTxtLine(publisherId: string): string {
  const clean = sanitizePublisherId(publisherId);
  if (!clean) return '';
  const pubOnly = clean.replace(/^ca-/, '');
  return `google.com, ${pubOnly}, DIRECT, f08c47fec0942fa0`;
}
