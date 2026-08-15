import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import type { ModelQuotaTier } from '../api/types';
import { useToast } from './Toast';

interface FormState {
  display_name: string;
  monthly_quota_usd: string;
  input_price_usd: string;
  output_price_usd: string;
  cache_read_price_usd: string;
  cache_write_price_usd: string;
}

const EMPTY_FORM: FormState = {
  display_name: '',
  monthly_quota_usd: '60',
  input_price_usd: '',
  output_price_usd: '',
  cache_read_price_usd: '',
  cache_write_price_usd: '',
};

function parseOptionalPrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function ModelQuotaManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data, refetch } = usePolling(() => api.listModelQuotas(), 120000);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const models = data?.models ?? [];

  const openAdd = () => {
    setEditingKey(null);
    setForm(EMPTY_FORM);
    dialogRef.current?.showModal();
  };

  const openEdit = (model: ModelQuotaTier) => {
    setEditingKey(model.model_key);
    setForm({
      display_name: model.display_name,
      monthly_quota_usd: String(model.monthly_quota_usd),
      input_price_usd: model.input_price_usd == null ? '' : String(model.input_price_usd),
      output_price_usd: model.output_price_usd == null ? '' : String(model.output_price_usd),
      cache_read_price_usd: model.cache_read_price_usd == null ? '' : String(model.cache_read_price_usd),
      cache_write_price_usd: model.cache_write_price_usd == null ? '' : String(model.cache_write_price_usd),
    });
    dialogRef.current?.showModal();
  };

  const save = async () => {
    if (!form.display_name.trim()) return;
    const monthlyQuota = Number(form.monthly_quota_usd);
    if (!Number.isFinite(monthlyQuota) || monthlyQuota <= 0) return;
    setSaving(true);
    try {
      await api.upsertModelQuota({
        display_name: form.display_name.trim(),
        monthly_quota_usd: monthlyQuota,
        input_price_usd: parseOptionalPrice(form.input_price_usd),
        output_price_usd: parseOptionalPrice(form.output_price_usd),
        cache_read_price_usd: parseOptionalPrice(form.cache_read_price_usd),
        cache_write_price_usd: parseOptionalPrice(form.cache_write_price_usd),
      });
      toast(t('modelQuota.saved'), 'success');
      dialogRef.current?.close();
      setEditingKey(null);
      refetch();
    } catch (error) {
      toast(t('modelQuota.saveFailed', { msg: String(error instanceof Error ? error.message : error) }), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (model: ModelQuotaTier) => {
    if (!window.confirm(t('modelQuota.confirmDelete', { name: model.display_name }))) return;
    try {
      await api.deleteModelQuota(model.model_key);
      toast(t('modelQuota.deleted'), 'success');
      refetch();
    } catch (error) {
      toast(t('modelQuota.deleteFailed', { msg: String(error instanceof Error ? error.message : error) }), 'error');
    }
  };

  const price = (value: number | null) => (value == null ? '—' : `$${value}`);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted">{t('modelQuota.desc')}</div>
          <div className="text-[11px] text-base-content/40 mt-1">{t('modelQuota.priceNote')}</div>
        </div>
        <button className="btn btn-outline btn-sm shrink-0" onClick={openAdd}>
          {t('modelQuota.addModel')}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr className="text-base-content/40 text-xs uppercase tracking-wider">
              <th>{t('common.model')}</th>
              <th className="text-right">{t('modelQuota.monthlyQuota')}</th>
              <th className="text-right">{t('modelQuota.multiplier')}</th>
              <th className="text-right">{t('modelQuota.inputPrice')}</th>
              <th className="text-right">{t('modelQuota.outputPrice')}</th>
              <th className="text-right">{t('modelQuota.cacheReadPrice')}</th>
              <th className="text-right">{t('modelQuota.cacheWritePrice')}</th>
              <th>{t('modelQuota.source')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model_key} className="hover">
                <td className="text-sm font-medium">{model.display_name}</td>
                <td className="text-right tabular-nums">{model.monthly_quota_usd}</td>
                <td className="text-right tabular-nums">{model.multiplier.toFixed(2)}×</td>
                <td className="text-right tabular-nums">{price(model.input_price_usd)}</td>
                <td className="text-right tabular-nums">{price(model.output_price_usd)}</td>
                <td className="text-right tabular-nums">{price(model.cache_read_price_usd)}</td>
                <td className="text-right tabular-nums">{price(model.cache_write_price_usd)}</td>
                <td className="text-xs text-base-content/50">
                  {model.source === 'opencode-docs-2026-08-15'
                    ? t('modelQuota.sourceOfficial')
                    : t('modelQuota.sourceManual')}
                </td>
                <td>
                  <div className="flex gap-1 justify-end">
                    <button className="btn btn-xs btn-ghost" onClick={() => openEdit(model)}>
                      {t('settings.edit')}
                    </button>
                    <button className="btn btn-xs btn-ghost text-error" onClick={() => void remove(model)}>
                      {t('common.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box max-w-lg">
          <h3 className="font-semibold text-base mb-4">
            {editingKey ? t('modelQuota.editDialog') : t('modelQuota.addDialog')}
          </h3>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-base-content/60 mb-1.5 block">{t('common.model')}</label>
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                value={form.display_name}
                onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-base-content/60 mb-1.5 block">{t('modelQuota.monthlyQuota')} (USD)</label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                className="input input-bordered input-sm w-full"
                value={form.monthly_quota_usd}
                onChange={(event) => setForm({ ...form, monthly_quota_usd: event.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-base-content/60 mb-1.5 block">{t('modelQuota.inputPrice')} / 1M</label>
                <input type="number" min={0} step={0.000001} className="input input-bordered input-sm w-full" value={form.input_price_usd} onChange={(event) => setForm({ ...form, input_price_usd: event.target.value })} />
              </div>
              <div>
                <label className="text-xs text-base-content/60 mb-1.5 block">{t('modelQuota.outputPrice')} / 1M</label>
                <input type="number" min={0} step={0.000001} className="input input-bordered input-sm w-full" value={form.output_price_usd} onChange={(event) => setForm({ ...form, output_price_usd: event.target.value })} />
              </div>
              <div>
                <label className="text-xs text-base-content/60 mb-1.5 block">{t('modelQuota.cacheReadPrice')} / 1M</label>
                <input type="number" min={0} step={0.000001} className="input input-bordered input-sm w-full" value={form.cache_read_price_usd} onChange={(event) => setForm({ ...form, cache_read_price_usd: event.target.value })} />
              </div>
              <div>
                <label className="text-xs text-base-content/60 mb-1.5 block">{t('modelQuota.cacheWritePrice')} / 1M</label>
                <input type="number" min={0} step={0.000001} className="input input-bordered input-sm w-full" value={form.cache_write_price_usd} onChange={(event) => setForm({ ...form, cache_write_price_usd: event.target.value })} />
              </div>
            </div>
          </div>
          <div className="modal-action">
            <button className="btn btn-sm" onClick={() => dialogRef.current?.close()}>{t('common.cancel')}</button>
            <button className="btn btn-primary btn-sm" disabled={saving || !form.display_name.trim() || !(Number(form.monthly_quota_usd) > 0)} onClick={() => void save()}>
              {saving ? <span className="loading loading-spinner loading-xs" /> : t('common.save')}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
