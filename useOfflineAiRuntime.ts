import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_OFFLINE_AI_CONFIG,
  OFFLINE_AI_RUNTIMES,
  probeOfflineAiRuntime,
  type OfflineAiConfig,
  type OfflineAiProbeResult,
  type OfflineAiRuntimeId,
  type OfflineAiRuntimeMeta,
} from '../lib/offlineAiRuntime';

const OFFLINE_AI_CONFIG_KEY = 'temaloka_offline_ai_config_v1';

export interface OfflineAiController {
  config: OfflineAiConfig;
  activeMeta: OfflineAiRuntimeMeta;
  probeResult: OfflineAiProbeResult | null;
  isProbing: boolean;
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  setRuntime: (runtime: OfflineAiRuntimeId) => void;
  updateEndpoint: (runtime: 'ollama' | 'lmstudio' | 'llamacpp', endpoint: string) => void;
  updateModel: (
    runtime: 'ollama' | 'lmstudio' | 'llamacpp' | 'webllm' | 'transformersjs',
    model: string
  ) => void;
  attachMediaPipeFile: (file: File) => void;
  runProbe: (overrideRuntime?: OfflineAiRuntimeId) => Promise<OfflineAiProbeResult>;
}

function loadInitialConfig(): OfflineAiConfig {
  try {
    const raw = localStorage.getItem(OFFLINE_AI_CONFIG_KEY);
    if (!raw) return DEFAULT_OFFLINE_AI_CONFIG;
    const parsed = JSON.parse(raw) as Partial<OfflineAiConfig>;
    return {
      ...DEFAULT_OFFLINE_AI_CONFIG,
      ...parsed,
      endpoints: {
        ...DEFAULT_OFFLINE_AI_CONFIG.endpoints,
        ...(parsed.endpoints || {}),
      },
      models: {
        ...DEFAULT_OFFLINE_AI_CONFIG.models,
        ...(parsed.models || {}),
      },
    };
  } catch {
    return DEFAULT_OFFLINE_AI_CONFIG;
  }
}

export function useOfflineAiRuntime(): OfflineAiController {
  const [config, setConfig] = useState<OfflineAiConfig>(loadInitialConfig);
  const [probeResult, setProbeResult] = useState<OfflineAiProbeResult | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(OFFLINE_AI_CONFIG_KEY, JSON.stringify(config));
    } catch {
      // ignore storage errors
    }
  }, [config]);

  const activeMeta = useMemo(
    () =>
      OFFLINE_AI_RUNTIMES.find((r) => r.id === config.runtime) || OFFLINE_AI_RUNTIMES[0],
    [config.runtime]
  );

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  const setRuntime = useCallback((runtime: OfflineAiRuntimeId) => {
    setConfig((prev) => ({ ...prev, runtime }));
  }, []);

  const updateEndpoint = useCallback(
    (runtime: 'ollama' | 'lmstudio' | 'llamacpp', endpoint: string) => {
      setConfig((prev) => ({
        ...prev,
        endpoints: {
          ...prev.endpoints,
          [runtime]: endpoint,
        },
      }));
    },
    []
  );

  const updateModel = useCallback(
    (
      runtime: 'ollama' | 'lmstudio' | 'llamacpp' | 'webllm' | 'transformersjs',
      model: string
    ) => {
      setConfig((prev) => ({
        ...prev,
        models: {
          ...prev.models,
          [runtime]: model,
        },
      }));
    },
    []
  );

  const attachMediaPipeFile = useCallback((file: File) => {
    setConfig((prev) => ({
      ...prev,
      runtime: 'mediapipe',
      localMediaPipeFileName: file.name,
    }));
  }, []);

  const runProbe = useCallback(
    async (overrideRuntime?: OfflineAiRuntimeId): Promise<OfflineAiProbeResult> => {
      setIsProbing(true);
      try {
        const res = await probeOfflineAiRuntime(config, overrideRuntime);
        setProbeResult(res);
        return res;
      } finally {
        setIsProbing(false);
      }
    },
    [config]
  );

  useEffect(() => {
    if (!probeResult) {
      void probeOfflineAiRuntime(config).then((res) => setProbeResult(res));
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    config,
    activeMeta,
    probeResult,
    isProbing,
    isSettingsOpen,
    openSettings,
    closeSettings,
    setRuntime,
    updateEndpoint,
    updateModel,
    attachMediaPipeFile,
    runProbe,
  };
}
