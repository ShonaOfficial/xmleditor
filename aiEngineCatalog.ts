export type AiEngineMode = 'local' | 'gemini';

export type CallableGeminiModelId = 'gemini-3.1-flash-lite';

export type GeminiModelId =
  | CallableGeminiModelId
  | 'gemini-4-hydrogen'
  | 'gemini-4-neon'
  | 'gemini-4-carbon';

export interface GeminiModelOption {
  id: GeminiModelId;
  label: string;
  shortLabel: string;
  tier: 'standard' | 'pro';
  requiresPro: boolean;
  badge: string;
  description: string;
  disabledNotice?: string;
}

export const GEMINI_MODELS: GeminiModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    shortLabel: 'Flash Lite',
    tier: 'standard',
    requiresPro: false,
    badge: 'Standar · Aktif',
    description:
      'Mesin Gemini standar yang cepat dan ringan untuk Chat AI, merancang tema, CSS, audit SEO/AdSense, & diagnosa XML.',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    shortLabel: '4 Hydrogen',
    tier: 'pro',
    requiresPro: true,
    badge: 'Pro · Berbayar',
    disabledNotice: 'Butuh akun Gemini yang Pro',
    description:
      'Model seri Gemini 4 berbayar; memerlukan akun & API key Gemini Pro agar aktif.',
  },
  {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon',
    shortLabel: '4 Neon',
    tier: 'pro',
    requiresPro: true,
    badge: 'Pro · Berbayar',
    disabledNotice: 'Butuh akun Gemini yang Pro',
    description:
      'Penalaran kompleks untuk refactoring kode XML lanjutan & arsitektur template.',
  },
  {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    shortLabel: '4 Carbon',
    tier: 'pro',
    requiresPro: true,
    badge: 'Pro · Berbayar',
    disabledNotice: 'Butuh akun Gemini yang Pro',
    description:
      'Audit mendalam untuk debugging akar masalah, keamanan, dan optimasi tingkat lanjut.',
  },
];

export const DAILY_GEMINI_QUOTA_LIMIT = 25;

export function isCallableGeminiModel(modelId: string): modelId is CallableGeminiModelId {
  return modelId === 'gemini-3.1-flash-lite';
}

export function getGeminiModelOption(modelId: string): GeminiModelOption {
  return (
    GEMINI_MODELS.find((m) => m.id === modelId) || GEMINI_MODELS[0]
  );
}
