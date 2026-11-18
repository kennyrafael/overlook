import { useEffect, useRef, useState, type RefObject } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { confirmDialog } from 'primereact/confirmdialog';
import type { Toast } from 'primereact/toast';
import type { SystemInfo } from '@overlook/shared';
import { api } from '../api';
import { useProjects } from '../store/projects';

/** Settings cards: export/import/reset, log folder, and the list of network calls. */
export function AppDataCards({ toast, onChanged }: { toast: RefObject<Toast | null>; onChanged: () => void }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { api.systemInfo().then(setInfo).catch(() => undefined); }, []);

  const fail = (summary: string, e: unknown) =>
    toast.current?.show({ severity: 'error', summary, detail: e instanceof Error ? e.message : String(e) });

  const exportData = async () => {
    setBusy('export');
    try {
      const data = await api.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `overlook-settings-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { fail('Export failed', e); } finally { setBusy(null); }
  };

  const importFile = async (file: File) => {
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { return fail('Import failed', new Error('The file is not valid JSON')); }
    confirmDialog({
      header: 'Import settings?',
      message: 'This replaces your settings, project names, statuses, tags and saved views with the ones in the file.',
      icon: 'pi pi-upload',
      acceptLabel: 'Import',
      rejectLabel: 'Cancel',
      accept: async () => {
        setBusy('import');
        try {
          const r = await api.importData(data);
          await useProjects.getState().load();
          onChanged();
          toast.current?.show({ severity: 'success', summary: 'Settings imported', detail: `${r.projectOverrides} project edits, ${r.views} saved views` });
        } catch (e) { fail('Import failed', e); } finally { setBusy(null); }
      },
    });
  };

  const reset = () => confirmDialog({
    header: 'Reset app data?',
    message: 'Deletes all settings, project edits, saved views and progress history stored by Overlook. Your plan files and Claude Code logs are not touched. This cannot be undone; export first if you may want it back.',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Reset',
    rejectLabel: 'Cancel',
    acceptClassName: 'p-button-danger',
    defaultFocus: 'reject',
    accept: async () => {
      setBusy('reset');
      try {
        await api.resetData();
        window.location.assign('/');
      } catch (e) { fail('Reset failed', e); setBusy(null); }
    },
  });

  const openLogs = async () => {
    try { await api.openLogs(); } catch (e) { fail('Could not open the log folder', e); }
  };

  return (
    <>
      <Card title="Your data" className="mt-3" data-testid="app-data-card">
        <div className="flex flex-wrap gap-2">
          <Button label="Export settings" icon="pi pi-download" size="small" outlined loading={busy === 'export'} onClick={exportData} />
          <Button label="Import settings…" icon="pi pi-upload" size="small" outlined loading={busy === 'import'} onClick={() => fileInput.current?.click()} />
          <Button label="Open log folder" icon="pi pi-folder-open" size="small" outlined onClick={openLogs} />
          <Button label="Reset app data…" icon="pi pi-trash" size="small" severity="danger" outlined loading={busy === 'reset'} onClick={reset} />
          <input ref={fileInput} type="file" accept="application/json,.json" hidden data-testid="import-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        </div>
        <small className="text-500 block mt-2">
          Export saves settings, project edits and saved views as JSON.
          {info && <> Data folder: <code>{info.dataDir}</code></>}
        </small>
      </Card>
      <Card title="Network activity" className="mt-3" data-testid="network-card">
        <p className="mt-0">No project data ever leaves your machine. These are all the requests Overlook can make:</p>
        <ul className="m-0 pl-3 flex flex-column gap-2">
          {(info?.network ?? []).map((c) => (
            <li key={c.what}>
              <strong>{c.what}</strong> {c.active ? null : <Tag value="not in this version" severity="secondary" className="ml-1" />}
              <div className="text-sm text-500">To {c.destination}. {c.when}. Sends: {c.sends}.</div>
            </li>
          ))}
        </ul>
        <small className="text-500 block mt-2">Links you click (for example to install git) open in your browser.</small>
      </Card>
    </>
  );
}
