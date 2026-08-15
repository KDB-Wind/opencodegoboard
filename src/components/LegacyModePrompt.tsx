import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeatureFlags } from './FeatureFlagsProvider';
import { useToast } from './Toast';

export function LegacyModePrompt() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { featureLegacyPromptPending, applyPreset, dismissLegacyPrompt } = useFeatureFlags();
  const [busy, setBusy] = useState(false);

  if (!featureLegacyPromptPending) return null;

  const choose = async (preset?: 'minimal' | 'full') => {
    if (busy) return;
    setBusy(true);
    try {
      if (preset === 'minimal') await applyPreset('minimal');
      await dismissLegacyPrompt();
    } catch (error) {
      toast(t('features.saveFailed', { msg: String(error instanceof Error ? error.message : error) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="alert border-primary/40 bg-primary/5 py-3 mb-4" role="status">
      <div className="flex items-start gap-3 w-full">
        <div className="min-w-0">
          <div className="font-semibold text-sm">{t('legacyPrompt.title')}</div>
          <div className="text-xs opacity-80 mt-0.5">{t('legacyPrompt.desc')}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void choose('full')}>
            {t('legacyPrompt.keepFull')}
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void choose('minimal')}>
            {t('legacyPrompt.tryMinimal')}
          </button>
        </div>
      </div>
    </div>
  );
}
