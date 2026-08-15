import { describe, expect, it } from 'vitest';
import {
  detectFeaturePreset,
  FULL_FEATURE_FLAGS,
  MINIMAL_FEATURE_FLAGS,
} from './featureFlags';

describe('detectFeaturePreset', () => {
  it('recognizes minimal and full presets', () => {
    expect(detectFeaturePreset(MINIMAL_FEATURE_FLAGS)).toBe('minimal');
    expect(detectFeaturePreset(FULL_FEATURE_FLAGS)).toBe('full');
  });

  it('treats mixed flags as custom', () => {
    expect(detectFeaturePreset({ ...MINIMAL_FEATURE_FLAGS, token_stats: true })).toBe('custom');
  });
});
