import { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Chips } from 'primereact/chips';
import { InputSwitch } from 'primereact/inputswitch';
import type { Settings } from '@overlook/shared';
import { api } from '../api';
import { desktop } from '../desktop';
import { useProjects } from '../store/projects';
import { useTools } from '../store/tools';
import { appToast } from '../toast';
import { OverlookMark } from './OverlookMark';
import { ToolList } from './ToolList';

const STEPS = ['Welcome', 'Your tools', 'Your projects'] as const;

/**
 * First-run setup: explains that everything stays local, shows the detected tools, and asks where
 * projects live. Shown once, when setup was never finished and no root folders are set.
 */
export default function Onboarding() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const tools = useTools((s) => s.tools);

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      if (!s.onboarded && s.roots.length === 0) {
        setVisible(true);
        void useTools.getState().load(true);
      }
    }).catch(() => { /* server unreachable: the live indicator already says so */ });
  }, []);

  if (!settings || !visible) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });

  const finish = async (skip: boolean) => {
    setSaving(true);
    try {
      const patch: Partial<Settings> = skip
        ? { onboarded: true }
        : { onboarded: true, roots: settings.roots, useClaudeHistory: settings.useClaudeHistory, useWsl: settings.useWsl };
      await api.saveSettings(patch);
      setVisible(false);
      if (!skip) {
        const projects = await useProjects.getState().rescan();
        appToast.current?.show({ severity: 'success', summary: 'All set', detail: `${projects.length} projects found` });
      }
    } catch (e) {
      appToast.current?.show({ severity: 'error', summary: 'Could not save', detail: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const addFolders = async () => {
    const picked = await desktop?.pickFolders();
    if (picked?.length) set('roots', [...new Set([...settings.roots, ...picked])]);
  };

  const last = step === STEPS.length - 1;
  const nothingToFind = settings.roots.length === 0 && !settings.useClaudeHistory;

  const footer = (
    <div className="flex justify-content-between align-items-center gap-2 flex-wrap pt-3">
      <Button label="Skip setup" text size="small" className="pl-0" onClick={() => void finish(true)} disabled={saving} />
      <div className="flex gap-2">
        {step > 0 && <Button label="Back" outlined size="small" onClick={() => setStep(step - 1)} disabled={saving} />}
        {last
          ? <Button label="Finish" icon="pi pi-check" size="small" onClick={() => void finish(false)} loading={saving} disabled={nothingToFind} />
          : <Button label="Next" icon="pi pi-arrow-right" iconPos="right" size="small" onClick={() => setStep(step + 1)} />}
      </div>
    </div>
  );

  return (
    <Dialog
      visible={visible}
      onHide={() => void finish(true)}
      header={<span className="flex align-items-center gap-2"><OverlookMark size={26} />Set up Overlook</span>}
      footer={footer}
      style={{ width: '36rem' }}
      breakpoints={{ '640px': '95vw' }}
      modal
      closable={!saving}
      aria-label="Set up Overlook"
      contentClassName="pt-4"
    >
      <ol className="list-none p-0 m-0 mb-4 flex flex-wrap gap-3 text-sm" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'font-bold text-primary' : 'text-500'} aria-current={i === step ? 'step' : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-column gap-3 line-height-3">
          <p className="m-0">Overlook keeps track of the projects you work on with Claude Code: progress from your plan files, a task board, git activity and Claude usage.</p>
          <p className="m-0"><i className="pi pi-lock mr-2 text-primary" aria-hidden="true" />Everything stays on this computer. Overlook reads your project folders, plan files, git history and Claude Code logs locally and sends nothing anywhere.</p>
          <p className="m-0 text-500 text-sm">It only edits plan files you change from the app, keeps a backup of each one, and lets you undo.</p>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-column gap-3">
          <p className="m-0">Overlook uses these tools when they are installed. Nothing here is required.</p>
          <ToolList tools={tools} />
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-column gap-4">
          <label className="flex flex-column gap-2">
            <span>Folders that contain your projects</span>
            <Chips value={settings.roots} onChange={(e) => set('roots', e.value ?? [])} separator="," className="w-full chips-full"
              placeholder={settings.roots.length ? '' : 'e.g. C:\\Users\\you\\code'} />
            <small className="text-500">Each folder inside with .git, CLAUDE.md or a plan file becomes a project. Paste a path and press Enter.</small>
          </label>
          {desktop && <div><Button label="Choose folders…" icon="pi pi-folder-open" outlined size="small" onClick={addFolders} /></div>}
          <div className="flex align-items-center justify-content-between gap-3">
            <div>
              <div>Include folders you used Claude Code in</div>
              <small className="text-500">Found from Claude Code's own history, even outside the folders above.</small>
            </div>
            <InputSwitch checked={settings.useClaudeHistory} onChange={(e) => set('useClaudeHistory', !!e.value)} aria-label="Include Claude Code history" />
          </div>
          {tools?.platform === 'win32' && (
            <div className="flex align-items-center justify-content-between gap-3">
              <div>
                <div>Include Claude Code in WSL</div>
                <small className="text-500">{tools.wslClaude.length ? `Found in: ${tools.wslClaude.join(', ')}` : 'Reads history inside running WSL distros.'}</small>
              </div>
              <InputSwitch checked={settings.useWsl} onChange={(e) => set('useWsl', !!e.value)} aria-label="Include Claude Code in WSL" />
            </div>
          )}
          {nothingToFind && <small className="text-orange-500">Add a folder or include Claude Code history so there is something to show.</small>}
        </div>
      )}
    </Dialog>
  );
}
