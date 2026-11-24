import React, { useEffect, useRef } from 'react';
import { EyeOff } from 'lucide-react';
import { sanitizePublisherId, type SiteAdsenseConfig } from '../types/adsense';

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

export type AppAdSlotKey = 'topBanner' | 'sidebarSlot' | 'footerSlot' | 'modalSlot';

interface AdsenseSlotRendererProps {
  slotKey: AppAdSlotKey;
  config: SiteAdsenseConfig;
  shouldRenderLiveAds: boolean;
  isAdmin: boolean;
  className?: string;
}

function getSlotSettings(slotKey: AppAdSlotKey, config: SiteAdsenseConfig) {
  switch (slotKey) {
    case 'topBanner':
      return {
        label: 'Top Banner Workspace',
        enabled: config.topBannerEnabled,
        slotId: config.topBannerSlot,
        format: config.topBannerFormat,
      };
    case 'sidebarSlot':
      return {
        label: 'Sidebar Panel Kiri',
        enabled: config.sidebarSlotEnabled,
        slotId: config.sidebarSlotId,
        format: config.sidebarSlotFormat,
      };
    case 'footerSlot':
      return {
        label: 'Footer / Bawah SEO',
        enabled: config.footerSlotEnabled,
        slotId: config.footerSlotId,
        format: config.footerSlotFormat,
      };
    case 'modalSlot':
      return {
        label: 'Modal Ekspor XML',
        enabled: config.modalSlotEnabled,
        slotId: config.modalSlotId,
        format: config.modalSlotFormat,
      };
  }
}

export const AdsenseSlotRenderer: React.FC<AdsenseSlotRendererProps> = ({
  slotKey,
  config,
  shouldRenderLiveAds,
  isAdmin,
  className = '',
}) => {
  const pushedKeyRef = useRef<string>('');
  const slot = getSlotSettings(slotKey, config);
  const cleanPub = sanitizePublisherId(config.publisherId);

  const showAdminSafePreview =
    config.adsenseEnabled &&
    slot.enabled &&
    Boolean(cleanPub) &&
    config.hideAdsForAdmin &&
    isAdmin;

  const canMountLiveAd =
    shouldRenderLiveAds && slot.enabled && Boolean(cleanPub) && Boolean(slot.slotId);

  useEffect(() => {
    if (!canMountLiveAd) return;
    const key = `${cleanPub}:${slot.slotId}:${slot.format}:${config.testMode ? 'test' : 'live'}`;
    if (pushedKeyRef.current === key) return;
    pushedKeyRef.current = key;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {
      // Ignore AdSense runtime push errors (e.g. adblocker or strict offline mode)
    }
  }, [canMountLiveAd, cleanPub, slot.slotId, slot.format, config.testMode]);

  if (!config.adsenseEnabled || !slot.enabled || !cleanPub) {
    return null;
  }

  if (showAdminSafePreview) {
    return (
      <div
        className={`rounded-lg border border-dashed border-emerald-300 bg-emerald-50/70 px-3 py-2 text-[11px] text-emerald-900 flex items-center justify-between gap-2 ${className}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <EyeOff className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
          <span className="font-semibold truncate">Slot AdSense Aktif: {slot.label}</span>
        </div>
        <span className="font-mono text-[10px] text-emerald-800 shrink-0">
          {slot.slotId ? `Slot ${slot.slotId}` : 'Tanpa Slot ID'} · Disembunyikan untuk Admin
        </span>
      </div>
    );
  }

  if (!canMountLiveAd) {
    return null;
  }

  return (
    <div
      className={`overflow-hidden text-center ${className}`}
      aria-label={`Slot Iklan ${slot.label}`}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={cleanPub}
        data-ad-slot={slot.slotId}
        data-ad-format={slot.format}
        data-full-width-responsive="true"
        {...(config.testMode ? { 'data-adtest': 'on' } : {})}
      />
    </div>
  );
};
