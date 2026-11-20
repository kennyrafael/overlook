import { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { SelectButton } from 'primereact/selectbutton';
import { Message } from 'primereact/message';
import type { PlanTemplate, PlanTemplateId, ProjectDetail } from '@overlook/shared';
import { api } from '../api';
import { appToast } from '../toast';
import { useProjects } from '../store/projects';

/**
 * "Create PLAN.md" for a project without milestones: pick a starter template, read the exact text
 * that will be written, and only then write it (the one file the dashboard ever creates in a project).
 */
export function CreatePlanButton({ project, onCreated }: { project: ProjectDetail; onCreated: (p: ProjectDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<PlanTemplate[] | null>(null);
  const [choice, setChoice] = useState<PlanTemplateId>('basic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshList = useProjects((s) => s.load);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.planTemplates(project.id).then(setTemplates).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, project.id]);

  const selected = templates?.find((t) => t.id === choice) ?? templates?.[0];
  const fileName = templates?.[0]?.fileName ?? 'PLAN.md';

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const p = await api.createPlanFile(project.id, selected.id);
      onCreated(p);
      refreshList();
      setOpen(false);
      appToast.current?.show({ severity: 'success', summary: `${selected.fileName} created`, detail: `${p.milestonesTotal} milestones in ${project.name}`, life: 4000 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!project.exists) return null;
  return (
    <>
      <Button label={`Create ${fileName}`} icon="pi pi-file-plus" size="small" onClick={() => setOpen(true)} />
      <Dialog header={`Create ${fileName} in ${project.name}`} visible={open} onHide={() => setOpen(false)} style={{ width: 'min(40rem, 95vw)' }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancel" text onClick={() => setOpen(false)} />
            <Button label={`Write ${selected?.fileName ?? fileName}`} icon="pi pi-check" loading={busy} disabled={!selected} onClick={create} />
          </div>
        }>
        <div className="flex flex-column gap-3">
          {error && <Message severity="error" text={error} />}
          {templates && (
            <>
              <SelectButton value={choice} onChange={(e) => e.value && setChoice(e.value)} aria-label="Template"
                options={templates.map((t) => ({ label: t.label, value: t.id }))} />
              {selected && <small className="text-500">{selected.description}</small>}
              <div>
                <small className="text-500">Preview — written exactly like this to <code>{project.path}{project.path.includes('\\') ? '\\' : '/'}{selected?.fileName}</code></small>
                <pre className="plan-preview surface-ground border-1 surface-border border-round p-3 m-0 mt-2 overflow-auto text-sm"
                  aria-label="Plan preview" style={{ maxHeight: '20rem', whiteSpace: 'pre-wrap' }}>{selected?.content}</pre>
              </div>
              <small className="text-500">Nothing is written until you press the button below. Edit the file afterwards like any plan.</small>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
