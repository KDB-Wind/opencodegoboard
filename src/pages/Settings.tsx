import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import { SyncProgressBar } from '../components/SyncProgress';
import { useToast } from '../components/Toast';
import { useTheme } from '../components/ThemeProvider';
import { About } from './About';
import type { OpenCodeAccount } from '../api/types';

function BackendStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [restarting, setRestarting] = useState(false);

  const backendPort = typeof window !== 'undefined' && window.electronAPI?.getBackendPort
    ? window.electronAPI.getBackendPort()
    : 8788;

  const check = async () => {
    setStatus('checking');
    try {
      const res = await api.health();
      if (res.status === 'ok') {
        setStatus('online');
      } else {
        setStatus('offline');
      }
    } catch {
      setStatus('offline');
    }
  };

  useEffect(() => { check(); }, []);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      if (window.electronAPI?.restartBackend) {
        await window.electronAPI.restartBackend();
      }
      await new Promise((r) => setTimeout(r, 2000));
      await check();
    } finally {
      setRestarting(false);
    }
  };

  const dotColor = status === 'online' ? 'bg-success' : status === 'offline' ? 'bg-error' : 'bg-warning';
  const label = status === 'online' ? t('settings.running') : status === 'offline' ? t('settings.disconnected') : t('settings.checking');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-sm text-base-content/70">{t('settings.backendStatus')}</span>
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-base-content/70">{t('settings.backendAddress')}</span>
        <span className="text-sm font-mono">http://127.0.0.1:{backendPort}</span>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-outline btn-sm" onClick={check}>
          {t('settings.refreshStatus')}
        </button>
        <button className="btn btn-outline btn-sm" onClick={handleRestart} disabled={restarting}>
          {restarting ? <span className="loading loading-spinner loading-xs" /> : t('settings.restart')}
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { data: config, refetch } = usePolling(
    () => api.getConfig(),
    60000,
  );

  const [form, setForm] = useState({ name: '', auth_cookie: '', workspace_id: 'Default' });
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [systemLoginOpened, setSystemLoginOpened] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncProg, setSyncProg] = useState<Record<string, { status: string; current: number; total: number; inserted: number; error?: string }>>({});
  const syncTimerRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const [autoSync, setAutoSync] = useState(true);
  const [syncInterval, setSyncInterval] = useState(300);
  const [backfillMode, setBackfillMode] = useState<'days' | 'until' | 'all'>('days');
  const [backfillDays, setBackfillDays] = useState(90);
  const [backfillUntil, setBackfillUntil] = useState('');
  const syncConfigLoadedRef = useRef(false);
  useEffect(() => {
    if (config?.usage_sync && !syncConfigLoadedRef.current) {
      syncConfigLoadedRef.current = true;
      setAutoSync(config.usage_sync.auto_sync ?? true);
      setSyncInterval(config.usage_sync.interval_sec ?? 300);
    }
  }, [config]);
  const [trayMode, setTrayMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OpenCodeAccount | null>(null);
  const addModal = useRef<HTMLDialogElement>(null);
  const deleteModal = useRef<HTMLDialogElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const { theme, setTheme, readability, setReadability } = useTheme();
  const [language, setLanguageState] = useState<'zh' | 'en' | 'auto'>(() => {
    const stored = localStorage.getItem('opencodeboard-language');
    if (stored === 'zh' || stored === 'en') return stored;
    return 'auto';
  });

  const handleLanguageChange = (l: 'zh' | 'en' | 'auto') => {
    setLanguageState(l);
    if (l === 'auto') {
      localStorage.removeItem('opencodeboard-language');
      const detected = navigator.language.startsWith('zh') ? 'zh' : 'en';
      i18n.changeLanguage(detected);
    } else {
      i18n.changeLanguage(l);
    }
  };

  useEffect(() => {
    (async () => {
      if (window.electronAPI?.getTrayMode) {
        const t = await window.electronAPI.getTrayMode();
        setTrayMode(t);
      }
    })();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.enabled !== undefined) {
        setTrayMode(detail.enabled);
      }
    };
    window.addEventListener('tray-mode-changed', handler);
    return () => window.removeEventListener('tray-mode-changed', handler);
  }, []);

  useEffect(() => {
    return () => {
      Object.values(syncTimerRef.current).forEach(clearInterval);
    };
  }, []);

  const accounts = config?.opencode_accounts ?? [];

  const openAdd = () => {
    setForm({ name: '', auth_cookie: '', workspace_id: 'Default' });
    setAutoFilled(false);
    setSystemLoginOpened(false);
    addModal.current?.showModal();
  };

  const handleSystemLogin = async () => {
    try {
      if (window.electronAPI?.loginOpenCodeSystem) {
        await window.electronAPI.loginOpenCodeSystem();
      }
      setSystemLoginOpened(true);
    } catch (e) {
      toast(t('settings.loginFailed', { msg: (e as Error).message }), 'error');
    }
  };

  const handleBrowserLogin = async () => {
    if (!window.electronAPI?.loginOpenCode) {
      toast(t('settings.loginUnavailable'), 'error');
      return;
    }
    setLoggingIn(true);
    try {
      const result = await window.electronAPI.loginOpenCode();
      if (result.status === 'ok') {
        setForm((f) => ({
          ...f,
          workspace_id: result.workspace_id,
          auth_cookie: result.auth_cookie,
        }));
        setAutoFilled(true);
        toast(t('settings.loginSuccess'), 'success');
      } else if (result.status === 'error') {
        toast(t('settings.loginFailed', { msg: result.error }), 'error');
      } else {
        toast(t('settings.loginCancelled'), 'info');
      }
    } catch (e) {
      toast(t('settings.loginFailed', { msg: (e as Error).message }), 'error');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdd = async () => {
    if (!form.name || !form.auth_cookie) return;
    setSaving(true);
    try {
      await api.createOpenCodeAccount(form);
      toast(t('settings.toastAccountAdded'), 'success');
      addModal.current?.close();
      refetch();
    } catch (e) {
      toast(t('settings.toastAddFailed', { msg: (e as Error).message }), 'error');
    } finally {
      setSaving(false);
    }
  };

  const startPollProgress = (id: string) => {
    const poll = async () => {
      try {
        const p = await api.syncProgress(id);
        if (p.status !== 'idle') {
          setSyncProg((prev) => ({ ...prev, [id]: p }));
        }
        if (p.status === 'done') {
          toast(t('settings.toastSyncComplete', { count: p.inserted }), 'success');
          stopPollProgress(id);
          setSyncing(null);
          refetch();
        } else if (p.status === 'error' || p.status === 'timeout') {
          toast(
            p.status === 'timeout'
              ? t('settings.syncTimeout')
              : t('settings.toastSyncFailedMsg', { msg: p.error || 'unknown' }),
            'error',
          );
          stopPollProgress(id);
          setSyncing(null);
        }
      } catch {
        // ignore poll errors
      }
    };
    syncTimerRef.current[id] = setInterval(poll, 800);
    poll();
  };

  const stopPollProgress = (id: string) => {
    if (syncTimerRef.current[id]) {
      clearInterval(syncTimerRef.current[id]);
      delete syncTimerRef.current[id];
    }
  };

  const doSync = async (id: string, mode: 'sync' | 'backfill') => {
    setSyncing(id);
    setSyncProg((prev) => ({ ...prev, [id]: { status: 'running', current: 0, total: 0, inserted: 0 } }));
    startPollProgress(id);
    try {
      if (mode === 'backfill') {
        await api.backfillUsage(id, {
          mode: backfillMode,
          days: backfillMode === 'days' ? backfillDays : undefined,
          until: backfillMode === 'until' ? backfillUntil : undefined,
        });
      } else {
        await api.syncUsage(id);
      }
    } catch (e) {
      stopPollProgress(id);
      setSyncing(null);
      toast(t('settings.toastOpFailed', { msg: (e as Error).message }), 'error');
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await api.testOpenCodeAccount(id);
      if (result.success) {
        toast(t('settings.toastTestSuccess', { id: result.workspace_id }), 'success');
      } else {
        toast(t('settings.toastTestFailed', { msg: result.error || 'unknown' }), 'error');
      }
      refetch();
    } catch (e) {
      toast(t('settings.toastTestFailed', { msg: (e as Error).message }), 'error');
    } finally {
      setTesting(null);
    }
  };

  const confirmDelete = (account: OpenCodeAccount) => {
    setDeleteTarget(account);
    deleteModal.current?.showModal();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteOpenCodeAccount(deleteTarget.id);
      toast(t('settings.toastDeleted'), 'success');
      deleteModal.current?.close();
      setDeleteTarget(null);
      refetch();
    } catch (e) {
      toast(t('settings.toastDeleteFailed', { msg: (e as Error).message }), 'error');
    }
  };

  const handleToggle = async (account: OpenCodeAccount) => {
    try {
      await api.updateOpenCodeAccount(account.id, { enabled: !account.enabled });
      refetch();
    } catch (e) {
      toast(t('settings.toastUpdateFailed', { msg: (e as Error).message }), 'error');
    }
  };

  const saveSyncSettings = async () => {
    try {
      await api.updateConfig({
        usage_sync: {
          auto_sync: autoSync,
          interval_sec: syncInterval,
        },
      });
      toast(t('settings.toastSyncSaved'), 'success');
      refetch();
    } catch (e) {
      toast(t('settings.toastSyncSaveFailed', { msg: (e as Error).message }), 'error');
    }
  };

  const handleTrayChange = async (v: boolean) => {
    setTrayMode(v);
    if (window.electronAPI?.setTrayMode) {
      await window.electronAPI.setTrayMode(v);
    }
    if (v) {
      toast(t('settings.toastTrayOn'), 'success');
    } else {
      toast(t('settings.toastTrayOff'), 'success');
    }
  };

  const themeLabel: Record<string, string> = {
    light: t('settings.light'),
    dark: t('settings.dark'),
    system: t('settings.system'),
  };

  const restoreBackup = async (file?: File) => {
    if (!file) return;
    try {
      await api.restoreDatabase(file);
      toast(t('settings.restoreDone'), 'success');
      refetch();
    } catch (error) {
      toast(t('settings.restoreFailed', { msg: (error as Error).message }), 'error');
    } finally {
      if (restoreInput.current) restoreInput.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-base-content">{t('settings.title')}</h1>
        <p className="text-xs text-base-content/40 mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* -- 语言 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.language')}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-base-content/70">{t('settings.language')}</div>
              <div className="text-[11px] text-base-content/40 mt-0.5">{t('settings.languageDesc')}</div>
            </div>
            <div className="flex gap-2">
              {(['zh', 'en', 'auto'] as const).map((l) => (
                <button
                  key={l}
                  className={`btn btn-sm ${language === l ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => handleLanguageChange(l)}
                >
                  {l === 'zh' ? t('settings.zh') : l === 'en' ? t('settings.en') : t('settings.languageAuto')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* -- 外观 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.appearance')}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-base-content/70">{t('settings.theme')}</div>
              <div className="text-[11px] text-base-content/40 mt-0.5">{t('settings.themeDesc')}</div>
            </div>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  className={`btn btn-sm ${theme === t ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTheme(t)}
                >
                  {themeLabel[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-base-content/70">{t('settings.readability')}</div>
              <div className="text-xs text-muted mt-0.5">{t('settings.readabilityDesc')}</div>
            </div>
            <div className="flex gap-2">
              {(['standard', 'comfortable', 'high-contrast'] as const).map((value) => (
                <button
                  key={value}
                  className={`btn btn-sm ${readability === value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setReadability(value)}
                >
                  {t(`settings.readability_${value}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* -- 系统 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.systemSection')}</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-base-content/70">{t('settings.tray')}</div>
            <div className="text-[11px] text-base-content/40 mt-0.5">{t('settings.trayDesc')}</div>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={trayMode}
            onChange={(e) => handleTrayChange(e.target.checked)}
          />
        </div>
      </div>

      {/* -- 账户 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-base-content/70">{t('settings.accounts')}</h2>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            {t('settings.addAccount')}
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-6 text-base-content/50 text-sm">
            {t('settings.noAccounts')}
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between bg-base-200/50 rounded-box px-3 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${account.enabled ? 'bg-success' : 'bg-base-content/30'}`}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate text-base-content" title={account.name}>{account.name}</div>
                    <div className="text-xs text-base-content/50 font-mono truncate">
                      {account.auth_cookie_masked || '-'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className={`btn btn-xs btn-ghost ${account.enabled ? 'text-success' : 'text-base-content/40'}`}
                    onClick={() => handleToggle(account)}
                  >
                    {account.enabled ? t('settings.enabled') : t('settings.disabled')}
                  </button>
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => handleTest(account.id)}
                    disabled={testing === account.id}
                  >
                    {testing === account.id
                      ? <span className="loading loading-spinner loading-xs" />
                      : t('settings.test')}
                  </button>
                  {syncing === account.id && syncProg[account.id] ? (
                    <SyncProgressBar {...syncProg[account.id]} />
                  ) : (
                    <>
                      <button className="btn btn-xs btn-ghost" onClick={() => doSync(account.id, 'sync')}>{t('settings.sync')}</button>
                      <button className="btn btn-xs btn-ghost" onClick={() => doSync(account.id, 'backfill')}>{t('settings.backfill')}</button>
                    </>
                  )}
                  <button
                    className="btn btn-xs btn-ghost text-error"
                    onClick={() => confirmDelete(account)}
                  >
                    {t('settings.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* -- 自动同步 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.autoSync')}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-base-content/70">{t('settings.autoSync')}</div>
              <div className="text-[11px] text-base-content/40 mt-0.5">{t('settings.autoSyncDesc')}</div>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-base-content/70">{t('settings.syncInterval')}</div>
              <div className="text-[11px] text-base-content/40 mt-0.5">{t('settings.syncIntervalDesc')}</div>
            </div>
            <select
              className="select select-bordered select-sm w-28"
              value={syncInterval}
              onChange={(e) => setSyncInterval(Number(e.target.value))}
            >
              <option value={60}>{t('settings.min1')}</option>
              <option value={300}>{t('settings.min5')}</option>
              <option value={600}>{t('settings.min10')}</option>
              <option value={1800}>{t('settings.min30')}</option>
            </select>
          </div>

          <button className="btn btn-primary btn-sm" onClick={saveSyncSettings}>
            {t('settings.saveSyncSettings')}
          </button>
        </div>
      </div>

      {/* -- 历史回填 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.backfillSection')}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-base-content/70">{t('settings.backfillTarget')}</div>
              <div className="text-xs text-muted mt-0.5">{t('settings.backfillTargetDesc')}</div>
            </div>
            <select
              className="select select-bordered select-sm w-40"
              value={backfillMode}
              onChange={(e) => setBackfillMode(e.target.value as 'days' | 'until' | 'all')}
            >
              <option value="days">{t('settings.backfillRecentDays')}</option>
              <option value="until">{t('settings.backfillUntil')}</option>
              <option value="all">{t('settings.backfillAll')}</option>
            </select>
          </div>
          {backfillMode === 'days' && <input className="input input-bordered input-sm w-40 ml-auto block" type="number" min={1} max={3650} value={backfillDays} onChange={(e) => setBackfillDays(Math.max(1, Number(e.target.value)))} />}
          {backfillMode === 'until' && <input className="input input-bordered input-sm w-40 ml-auto block" type="date" value={backfillUntil} onChange={(e) => setBackfillUntil(e.target.value)} />}
        </div>
      </div>

      <div className="border border-base-200 rounded-xl p-4" id="backend-status">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.backend')}</h2>
        <BackendStatus />
      </div>

      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-2">{t('settings.dataManagement')}</h2>
        <p className="text-xs text-muted mb-4">{t('settings.dataManagementDesc')}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => api.exportUsageCsv()}>{t('settings.exportCsv')}</button>
          <button className="btn btn-outline btn-sm" onClick={() => api.backupDatabase()}>{t('settings.backupDatabase')}</button>
          <button className="btn btn-warning btn-outline btn-sm" onClick={() => restoreInput.current?.click()}>{t('settings.restoreDatabase')}</button>
          <input ref={restoreInput} type="file" accept=".db,.sqlite,.sqlite3" className="hidden" onChange={(event) => restoreBackup(event.target.files?.[0])} />
        </div>
      </div>

      <div className="border border-base-200 rounded-xl p-4">
        <About />
      </div>

      <div className="border border-base-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-bold text-base-content/70">{t('settings.explanation')}</h2>

        <div className="text-sm text-base-content/60 leading-relaxed space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-base-content mb-1">{t('settings.syncVsBackfill')}</h3>
            <p className="text-xs text-base-content/50">
              <span className="font-medium text-base-content/70">{t('settings.syncLabel')}</span> {t('settings.syncExplanation')}
            </p>
            <p className="text-xs text-base-content/50 mt-2">
              <span className="font-medium text-base-content/70">{t('settings.backfillLabel')}</span> {t('settings.backfillExplanation')}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-base-content mb-1">{t('settings.newVsOld')}</h3>
            <p className="text-xs text-base-content/50">
              <span className="font-medium text-base-content/70">{t('settings.newUser')}</span>
              {t('settings.newUserDesc')}
            </p>
            <p className="text-xs text-base-content/50 mt-2">
              <span className="font-medium text-base-content/70">{t('settings.oldUser')}</span>
              {t('settings.oldUserDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* -- 恢复默认 -- */}
      <div className="border border-base-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-base-content/70 mb-4">{t('settings.resetDefaults')}</h2>
        <p className="text-xs text-base-content/40 mb-3">{t('settings.resetDesc')}</p>
        <button
          className="btn btn-outline btn-sm"
          onClick={async () => {
            try {
              await api.updateConfig({
                usage_sync: {
                  auto_sync: true,
                  interval_sec: 300,
                  backfill_pages_per_request: 100,
                  max_pages_per_incremental: 30,
                },
                refresh: {
                  opencode_go: { auto_refresh: true, interval_sec: 60 },
                },
              });
              setAutoSync(true);
              setSyncInterval(300);
              setBackfillMode('days');
              setBackfillDays(90);
              setBackfillUntil('');
              toast(t('settings.toastResetDone'), 'success');
              refetch();
            } catch (e) {
              toast(t('settings.toastResetFailed', { msg: (e as Error).message }), 'error');
            }
          }}
        >
          {t('settings.resetButton')}
        </button>
      </div>

      <dialog ref={addModal} className="modal">
        <div className="modal-box max-w-md">
          <h3 className="font-semibold text-base mb-4">{t('settings.addAccountDialog')}</h3>
          <div className="space-y-4">
            <button
              className="btn btn-primary btn-sm w-full"
              onClick={handleBrowserLogin}
              disabled={loggingIn}
            >
              {loggingIn ? <span className="loading loading-spinner loading-xs" /> : t('settings.loginViaBrowser')}
            </button>
            {loggingIn && (
              <p className="text-xs text-base-content/50 text-center">{t('settings.loginInProgress')}</p>
            )}
            {autoFilled && (
              <p className="text-xs text-success text-center">{t('settings.loginAutoNote')}</p>
            )}
            <button
              className="btn btn-outline btn-sm w-full"
              onClick={handleSystemLogin}
            >
              {t('settings.loginViaSystemBrowser')}
            </button>
            {systemLoginOpened && (
              <div className="rounded-box bg-base-200/60 p-3 space-y-1.5 text-xs text-base-content/60 leading-relaxed">
                <p>{t('settings.loginSystemOpened')}</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>{t('settings.loginSystemStep1')}</li>
                  <li>{t('settings.loginSystemStep2')}</li>
                  <li>{t('settings.loginSystemStep3')}</li>
                </ol>
              </div>
            )}
            <div className="divider text-xs text-base-content/40">{t('settings.manualOr')}</div>
            <div>
              <label className="text-xs text-base-content/60 mb-1.5 block">{t('settings.name')}</label>
              <input
                type="text"
                className="input-native"
                placeholder={t('settings.namePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-base-content/60 mb-1.5 block">{t('settings.workspaceId')}</label>
              <input
                type="text"
                className="input-native"
                placeholder={t('settings.workspacePlaceholder')}
                value={form.workspace_id}
                onChange={(e) => setForm({ ...form, workspace_id: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-base-content/60 mb-1.5 block">{t('settings.authCookie')}</label>
              <input
                type="password"
                className="input-native font-mono"
                placeholder={t('settings.cookiePlaceholder')}
                value={form.auth_cookie}
                onChange={(e) => setForm({ ...form, auth_cookie: e.target.value })}
              />
            </div>
          </div>
          <div className="modal-action">
            <button className="btn btn-sm" onClick={() => addModal.current?.close()}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAdd}
              disabled={saving || !form.name || !form.auth_cookie}
            >
              {saving ? <span className="loading loading-spinner loading-xs" /> : t('common.save')}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      <dialog ref={deleteModal} className="modal">
        <div className="modal-box max-w-sm">
          <h3 className="font-semibold text-base mb-2">{t('settings.confirmDelete')}</h3>
          <p className="text-sm text-base-content/60">
            {t('settings.confirmDeleteMsg', { name: deleteTarget?.name })}
          </p>
          <div className="modal-action">
            <button className="btn btn-sm" onClick={() => { deleteModal.current?.close(); setDeleteTarget(null); }}>{t('common.cancel')}</button>
            <button className="btn btn-sm btn-error" onClick={handleDelete}>{t('common.delete')}</button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
