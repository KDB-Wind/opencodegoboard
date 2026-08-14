import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import { Loading } from '../components/Loading';
import { UsageTable } from '../components/UsageTable';
import type { OpenCodeAccount, UsageRecord, UsageSession } from '../api/types';

export function UsageRecords() {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [view, setView] = useState<'sessions' | 'records'>('sessions');
  const [selectedSession, setSelectedSession] = useState<UsageSession | null>(null);
  const [sessionRecords, setSessionRecords] = useState<UsageRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const limit = 50;

  const { data: accounts } = usePolling(
    (signal) => api.listOpenCodeAccounts(signal),
    120000,
  );

  const { data: recordData, loading: recordsLoading, refetch: refetchRecords } = usePolling(
    (signal) => api.getAllUsage(page * limit, limit, accountId || undefined, signal),
    30000,
    view === 'records',
  );
  const { data: sessionData, loading: sessionsLoading, refetch: refetchSessions } = usePolling(
    (signal) => api.getUsageSessions(page * limit, limit, accountId || undefined, signal),
    30000,
    view === 'sessions',
  );
  const { data: projectData, refetch: refetchProjects } = usePolling(
    () => api.getProjectUsage(accountId || undefined), 60000, view === 'sessions', [accountId],
  );

  useEffect(() => {
    setSelectedSession(null);
    if (view === 'sessions') refetchSessions();
    else refetchRecords();
  }, [page, accountId, view, refetchRecords, refetchSessions]);

  const records = recordData?.records ?? [];
  const sessions = sessionData?.sessions ?? [];
  const total = view === 'sessions' ? sessionData?.total ?? 0 : recordData?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const loading = recordsLoading || sessionsLoading;

  async function openSession(session: UsageSession) {
    setSelectedSession(session);
    setDetailLoading(true);
    try {
      const result = await api.getSessionUsage(session.account_id, session.session_id);
      setSessionRecords(result.records);
    } finally {
      setDetailLoading(false);
    }
  }

  async function editSessionContext(session: UsageSession) {
    if (!session.session_id) return;
    const projectName = window.prompt(t('usageRecords.projectNamePrompt'), session.project_name ?? '');
    if (projectName == null) return;
    const projectPath = window.prompt(t('usageRecords.projectPathPrompt'), session.project_path ?? '');
    if (projectPath == null) return;
    const title = window.prompt(t('usageRecords.sessionTitlePrompt'), session.session_title ?? '');
    if (title == null) return;
    await api.updateSessionContext({
      account_id: session.account_id, session_id: session.session_id,
      project_name: projectName, project_path: projectPath, title,
    });
    refetchSessions();
    refetchProjects();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('usageRecords.title')}</h1>
          <p className="text-sm text-base-content/60 mt-1">{t('usageRecords.subtitle', { total: total.toLocaleString() })}</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="select select-bordered select-sm w-40"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t('common.allAccounts')}</option>
            {(accounts ?? []).map((a: OpenCodeAccount) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => view === 'sessions' ? refetchSessions() : refetchRecords()}>
            {t('common.refresh')}
          </button>
        </div>
      </div>

      <div role="tablist" className="tabs tabs-boxed w-fit">
        <button role="tab" className={`tab ${view === 'sessions' ? 'tab-active' : ''}`} onClick={() => { setView('sessions'); setPage(0); }}>
          {t('usageRecords.sessions')}
        </button>
        <button role="tab" className={`tab ${view === 'records' ? 'tab-active' : ''}`} onClick={() => { setView('records'); setPage(0); }}>
          {t('usageRecords.records')}
        </button>
      </div>

      {view === 'records' ? (
        <div className="bg-base-100 border border-base-200 rounded-box shadow-sm">
          <UsageTable records={records} showAccount />
        </div>
      ) : (
        <div className="space-y-4">
        {(projectData?.projects ?? []).length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {(projectData?.projects ?? []).slice(0, 6).map((project) => (
              <div key={`${project.project_name}:${project.project_path ?? ''}`} className="border border-base-200 rounded-lg p-3">
                <div className="font-semibold truncate">{project.project_name}</div>
                <div className="text-xs text-muted truncate">{project.project_path || t('usageRecords.noProjectPath')}</div>
                <div className="text-xs mt-2">{t('usageRecords.projectSummary', { cost: project.total_cost_usd.toFixed(4), cache: project.cache_hit_rate, models: project.models.length })}</div>
              </div>
            ))}
          </div>
        )}
        <div className="overflow-x-auto bg-base-100 border border-base-200 rounded-box shadow-sm">
          <table className="table table-sm">
            <thead><tr>
              <th>{t('common.account')}</th><th>{t('usageRecords.session')}</th><th>{t('usageRecords.project')}</th>
              <th className="text-right">{t('common.requests')}</th>
              <th className="text-right">{t('common.totalTokens')}</th>
              <th className="text-right">{t('common.cost')}</th><th>{t('usageRecords.lastActive')}</th>
            </tr></thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={`${session.account_id}:${session.session_id ?? '__unassigned__'}`} className="hover cursor-pointer" onClick={() => openSession(session)}>
                  <td>{session.account_name}</td>
                  <td className="font-mono max-w-64 truncate">{session.session_id || t('usageRecords.unassigned')}</td>
                  <td className="max-w-52">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{session.project_name || session.project_path || t('usageRecords.unassigned')}</span>
                      {session.session_id && <button className="btn btn-ghost btn-xs" onClick={(event) => { event.stopPropagation(); editSessionContext(session); }}>{t('usageRecords.linkProject')}</button>}
                    </div>
                    {session.session_title && <div className="text-xs text-muted truncate">{session.session_title}</div>}
                  </td>
                  <td className="text-right tabular-nums">{session.request_count.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{(session.total_input_tokens + session.total_output_tokens + session.total_reasoning_tokens).toLocaleString()}</td>
                  <td className="text-right tabular-nums">${session.total_cost_usd.toFixed(4)}</td>
                  <td>{new Date(session.last_at).toLocaleString()}</td>
                </tr>
              ))}
              {!sessions.length && !loading && <tr><td colSpan={7} className="py-10 text-center text-base-content/60">{t('usageRecords.noSessions')}</td></tr>}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {selectedSession && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{selectedSession.session_id || t('usageRecords.unassigned')}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedSession(null)}>{t('common.close')}</button>
          </div>
          <div className="bg-base-100 border border-base-200 rounded-box shadow-sm">
            {detailLoading ? <Loading /> : <UsageTable records={sessionRecords} showAccount />}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-base-content/40">
            {t('common.page', { current: page + 1, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t('common.prevPage')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            >
              {t('common.nextPage')}
            </button>
          </div>
        </div>
      )}

      {loading && <Loading />}
    </div>
  );
}
