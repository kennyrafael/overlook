import { useEffect, useRef, useState } from 'react';
import { Card } from 'primereact/card';
import { Chips } from 'primereact/chips';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { Button } from 'primereact/button';
import { Toast } from 'primereact/toast';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { InputText } from 'primereact/inputtext';
import { DEFAULT_MODEL_PRICES, type ModelPrice, type Settings } from '@overlook/shared';
import { api } from '../api';
import { useProjects } from '../store/projects';

type PriceRow = ModelPrice & { key: string };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useRef<Toast>(null);

  useEffect(() => { api.settings().then(setSettings); }, []);

  if (!settings) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });

  const priceRows: PriceRow[] = Object.entries(settings.modelPrices)
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const setPrices = (prices: Record<string, ModelPrice>) => setSettings((s) => (s ? { ...s, modelPrices: prices } : s));
  const setPrice = (key: string, field: keyof ModelPrice, value: number) =>
    setPrices({ ...settings.modelPrices, [key]: { ...settings.modelPrices[key], [field]: Math.max(0, value) } });
  const renamePrice = (from: string, to: string) => {
    if (!to || to === from || settings.modelPrices[to]) return;
    const { [from]: price, ...rest } = settings.modelPrices;
    setPrices({ ...rest, [to]: price });
  };
  const removePrice = (key: string) => {
    const { [key]: _drop, ...rest } = settings.modelPrices;
    setPrices(rest);
  };
  const addPrice = () => {
    let key = 'claude-new-model';
    for (let i = 2; settings.modelPrices[key]; i++) key = `claude-new-model-${i}`;
    setPrices({ ...settings.modelPrices, [key]: { input: 0, output: 0, cacheRead: 0 } });
  };

  const save = async () => {
    setSaving(true);
    try {
      setSettings(await api.saveSettings(settings));
      const projects = await useProjects.getState().rescan();
      toast.current?.show({ severity: 'success', summary: 'Settings saved', detail: `${projects.length} projects found` });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Save failed', detail: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (k: 'useClaudeHistory' | 'includeScratch' | 'includeMissing', label: string, hint: string) => (
    <div className="flex align-items-center justify-content-between gap-3">
      <div>
        <div>{label}</div>
        <small className="text-500">{hint}</small>
      </div>
      <InputSwitch checked={settings[k]} onChange={(e) => set(k, !!e.value)} />
    </div>
  );

  return (
    <div className="grid">
      <Toast ref={toast} />
      <div className="col-12 xl:col-7">
        <Card title="Folders">
          <div className="flex flex-column gap-4">
            <label className="flex flex-column gap-2">
              <span>Root folders <small className="text-500">(paste a path and press Enter)</small></span>
              <Chips value={settings.roots} onChange={(e) => set('roots', e.value ?? [])} separator="," />
              <small className="text-500">Each folder inside a root that has .git, CLAUDE.md, .claude or a plan file becomes a project. Nested repos are folded into it.</small>
            </label>
            <label className="flex flex-column gap-2">
              <span>Ignore folder names</span>
              <Chips value={settings.ignore} onChange={(e) => set('ignore', e.value ?? [])} separator="," />
            </label>
            <label className="flex flex-column gap-2">
              <span>Plan files (milestone sources)</span>
              <Chips value={settings.planFiles} onChange={(e) => set('planFiles', e.value ?? [])} separator="," />
            </label>
            <div className="flex flex-wrap gap-4">
              <label className="flex flex-column gap-2">
                <span>Scan depth</span>
                <InputNumber value={settings.maxDepth} min={1} max={6} showButtons onValueChange={(e) => set('maxDepth', e.value ?? 3)} />
              </label>
              <label className="flex flex-column gap-2">
                <span>Paused after (days idle)</span>
                <InputNumber value={settings.staleDays} min={1} showButtons onValueChange={(e) => set('staleDays', e.value ?? 14)} />
              </label>
            </div>
          </div>
        </Card>
      </div>
      <div className="col-12 xl:col-5">
        <Card title="Claude history">
          <div className="flex flex-column gap-4">
            {toggle('useClaudeHistory', 'Include Claude Code projects', 'Folders you used Claude Code in (~/.claude/projects)')}
            {toggle('includeScratch', 'Include scratch workspaces', 'Temporary per-session folders from the desktop app')}
            {toggle('includeMissing', 'Include missing folders', 'Projects in history whose folder was deleted')}
          </div>
        </Card>
      </div>
      <div className="col-12">
        <Card title="Cost estimates" subTitle="USD per million tokens. Matched by model-id prefix; the longest match wins.">
          <DataTable value={priceRows} dataKey="key" size="small" editMode="cell">
            <Column field="key" header="Model id prefix" style={{ minWidth: '14rem' }}
              body={(r: PriceRow) => <code>{r.key}</code>}
              editor={(o) => <InputText value={o.value as string} onChange={(e) => o.editorCallback?.(e.target.value)} />}
              onCellEditComplete={(e) => renamePrice(e.rowData.key, String(e.newValue ?? '').trim())} />
            {(['input', 'output', 'cacheRead'] as const).map((f) => (
              <Column key={f} field={f} header={f === 'cacheRead' ? 'Cache read' : f[0].toUpperCase() + f.slice(1)}
                body={(r: PriceRow) => `$${r[f]}`}
                editor={(o) => <InputNumber value={o.value as number} onValueChange={(e) => o.editorCallback?.(e.value ?? 0)} mode="decimal" minFractionDigits={0} maxFractionDigits={4} min={0} />}
                onCellEditComplete={(e) => setPrice(e.rowData.key, f, Number(e.newValue ?? 0))} />
            ))}
            <Column style={{ width: '3rem' }} body={(r: PriceRow) => (
              <Button icon="pi pi-trash" rounded text severity="secondary" aria-label={`Remove ${r.key}`} onClick={() => removePrice(r.key)} />
            )} />
          </DataTable>
          <div className="flex flex-wrap align-items-end gap-4 mt-3">
            <Button label="Add model" icon="pi pi-plus" text size="small" onClick={addPrice} />
            <Button label="Reset to defaults" icon="pi pi-replay" text size="small" severity="secondary"
              onClick={() => setSettings({ ...settings, modelPrices: DEFAULT_MODEL_PRICES, cacheWrite5mMultiplier: 1.25, cacheWrite1hMultiplier: 2 })} />
            <label className="flex flex-column gap-2 ml-auto">
              <span className="text-sm">Cache write (5 min) × input</span>
              <InputNumber value={settings.cacheWrite5mMultiplier} min={0} maxFractionDigits={2} onValueChange={(e) => set('cacheWrite5mMultiplier', e.value ?? 1.25)} />
            </label>
            <label className="flex flex-column gap-2">
              <span className="text-sm">Cache write (1 h) × input</span>
              <InputNumber value={settings.cacheWrite1hMultiplier} min={0} maxFractionDigits={2} onValueChange={(e) => set('cacheWrite1hMultiplier', e.value ?? 2)} />
            </label>
          </div>
          <small className="text-500 block mt-2">Click a cell to edit. Changes apply after Save.</small>
        </Card>
      </div>
      <div className="col-12">
        <Button label="Save & rescan" icon="pi pi-save" loading={saving} onClick={save} />
      </div>
    </div>
  );
}
