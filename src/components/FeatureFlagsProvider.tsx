import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { Loading } from './Loading';
import {
  FULL_FEATURE_FLAGS,
  MINIMAL_FEATURE_FLAGS,
  type FeatureFlags,
} from '../lib/featureFlags';

interface FeatureFlagsContextValue {
  flags: FeatureFlags;
  featureLegacyPromptPending: boolean;
  updateFlags: (next: FeatureFlags) => Promise<void>;
  applyPreset: (preset: 'minimal' | 'full') => Promise<void>;
  dismissLegacyPrompt: () => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: MINIMAL_FEATURE_FLAGS,
  featureLegacyPromptPending: false,
  updateFlags: async () => {},
  applyPreset: async () => {},
  dismissLegacyPrompt: async () => {},
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { data, error } = usePolling(() => api.getConfig(), 60000);
  const [flags, setFlags] = useState<FeatureFlags>(MINIMAL_FEATURE_FLAGS);
  const [legacyPromptPending, setLegacyPromptPending] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (data) {
      setFlags(data.feature_flags ?? MINIMAL_FEATURE_FLAGS);
      setLegacyPromptPending(data.feature_legacy_prompt_pending ?? false);
      setReady(true);
    }
  }, [data]);

  useEffect(() => {
    if (error && !data) setReady(true);
  }, [error, data]);

  const updateFlags = async (next: FeatureFlags) => {
    const config = await api.updateConfig({ feature_flags: next });
    setFlags(config.feature_flags);
    setLegacyPromptPending(config.feature_legacy_prompt_pending ?? false);
  };

  const applyPreset = async (preset: 'minimal' | 'full') => {
    const next = preset === 'full' ? FULL_FEATURE_FLAGS : MINIMAL_FEATURE_FLAGS;
    await updateFlags(next);
  };

  const dismissLegacyPrompt = async () => {
    const config = await api.updateConfig({ feature_legacy_prompt_pending: false });
    setLegacyPromptPending(false);
    setFlags(config.feature_flags);
  };

  const value = useMemo(
    () => ({ flags, featureLegacyPromptPending: legacyPromptPending, updateFlags, applyPreset, dismissLegacyPrompt }),
    [flags, legacyPromptPending],
  );

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loading />
      </div>
    );
  }

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
