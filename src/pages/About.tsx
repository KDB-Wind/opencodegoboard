import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';

function openLink(url: string) {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export function About() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('1.2.0');

  useEffect(() => {
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then(setVersion).catch(() => {});
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold">{t('about.title')}</h1>
        <p className="text-xs text-base-content/40 mt-1">{t('about.version', { version })}</p>
      </div>

      <button className="btn btn-primary w-full" onClick={() => openLink('https://github.com/KDB-Wind/opencodeboard')}>
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {t('about.repo')}
      </button>

      <div className="border border-base-200 rounded-xl p-4 space-y-3">
        <p className="text-sm text-base-content/70 leading-relaxed">
          {t('about.desc1')}
        </p>
        <p className="text-sm text-base-content/70 leading-relaxed">
          {t('about.desc2')}
        </p>
      </div>
    </div>
  );
}
