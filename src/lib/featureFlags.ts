export const FEATURE_KEYS = [
  'token_stats',
  'usage_records',
  'quota_intelligence',
  'data_tools',
  'advanced_sync',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureFlags = Record<FeatureKey, boolean>;
export type FeaturePreset = 'minimal' | 'full' | 'custom';

export const MINIMAL_FEATURE_FLAGS: FeatureFlags = {
  token_stats: false,
  usage_records: false,
  quota_intelligence: false,
  data_tools: false,
  advanced_sync: false,
};

export const FULL_FEATURE_FLAGS: FeatureFlags = {
  token_stats: true,
  usage_records: true,
  quota_intelligence: true,
  data_tools: true,
  advanced_sync: true,
};

export function detectFeaturePreset(flags: FeatureFlags): FeaturePreset {
  if (FEATURE_KEYS.every((key) => flags[key])) return 'full';
  if (FEATURE_KEYS.every((key) => !flags[key])) return 'minimal';
  return 'custom';
}
