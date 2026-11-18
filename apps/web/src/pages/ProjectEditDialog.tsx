import { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Chips } from 'primereact/chips';
import { Button } from 'primereact/button';
import { PROJECT_STATUSES, type Project, type ProjectPatch, type ProjectStatus } from '@overlook/shared';

interface Props {
  project: Project | null;
  onHide: () => void;
  onSave: (id: string, patch: ProjectPatch) => Promise<void>;
}

const AUTO = '__auto__';

export default function ProjectEditDialog({ project, onHide, onSave }: Props) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string>(AUTO);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setStatus(project.statusOverridden ? project.status : AUTO);
    setTags(project.tags);
  }, [project]);

  const save = async () => {
    if (!project) return;
    setSaving(true);
    try {
      await onSave(project.id, {
        name: name.trim() || null,
        status: status === AUTO ? null : (status as ProjectStatus),
        tags,
      });
      onHide();
    } finally {
      setSaving(false);
    }
  };

  const statusOptions = [
    { label: 'Auto (from activity)', value: AUTO },
    ...PROJECT_STATUSES.map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: s })),
  ];

  return (
    <Dialog
      header={project ? `Edit ${project.name}` : ''}
      visible={!!project}
      onHide={onHide}
      style={{ width: 'min(32rem, 95vw)' }}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancel" text onClick={onHide} />
          <Button label="Save" icon="pi pi-check" loading={saving} onClick={save} />
        </div>
      }
    >
      <div className="flex flex-column gap-3">
        <label className="flex flex-column gap-2">
          <span>Display name</span>
          <InputText value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-column gap-2">
          <span>Status</span>
          <Dropdown value={status} options={statusOptions} onChange={(e) => setStatus(e.value)} />
        </label>
        <label className="flex flex-column gap-2">
          <span>Tags <small className="text-500">(Enter or comma to add)</small></span>
          <Chips value={tags} onChange={(e) => setTags(e.value ?? [])} separator="," />
        </label>
        <small className="text-500 break-all">{project?.path}</small>
      </div>
    </Dialog>
  );
}
