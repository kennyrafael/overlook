import { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { confirmDialog } from 'primereact/confirmdialog';
import type { SavedView } from '@overlook/shared';
import { activeFilterCount, useFilters } from '../store/filters';
import { currentFilters, matchesView, useViews } from '../store/views';

/** Saved views: pick one to apply its filters, or save the current filters under a name. */
export default function ViewsControl() {
  const { views, loaded, load, save, overwrite, remove, apply } = useViews();
  const filters = useFilters();
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  const current = useMemo(() => views.find((v) => matchesView(currentFilters(), v.filters)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views, filters]);

  const existing = views.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (existing) await overwrite(existing);
      else await save(name.trim());
      setDialog(false);
    } finally {
      setBusy(false);
    }
  };

  const askDelete = (v: SavedView, e: React.MouseEvent) => {
    e.stopPropagation();
    confirmDialog({
      header: 'Delete view?',
      message: `“${v.name}” will be removed. Your current filters stay as they are.`,
      icon: 'pi pi-trash',
      acceptClassName: 'p-button-danger',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => remove(v),
    });
  };

  const itemTemplate = (v: SavedView) => (
    <div className="flex align-items-center gap-2 w-full">
      <i className="pi pi-bookmark text-500" />
      <span className="flex-grow-1">{v.name}</span>
      <Button icon="pi pi-trash" rounded text size="small" severity="secondary" aria-label={`Delete view ${v.name}`}
        onClick={(e) => askDelete(v, e)} />
    </div>
  );

  return (
    <div className="flex align-items-center gap-1">
      <Dropdown
        value={current?.id ?? null}
        options={views}
        optionLabel="name"
        optionValue="id"
        placeholder={views.length ? 'Saved views' : 'No saved views'}
        emptyMessage="No saved views yet"
        itemTemplate={itemTemplate}
        valueTemplate={(v: SavedView | null) => (v
          ? <span><i className="pi pi-bookmark-fill text-primary mr-2" />{v.name}</span>
          : <span className="text-500"><i className="pi pi-bookmark mr-2" />{views.length ? 'Saved views' : 'No saved views'}</span>)}
        onChange={(e) => { const v = views.find((x) => x.id === e.value); if (v) apply(v); }}
        style={{ minWidth: '11rem' }}
      />
      <Button icon="pi pi-save" rounded text aria-label="Save current filters as a view"
        tooltip="Save current filters as a view" tooltipOptions={{ position: 'top' }}
        disabled={!activeFilterCount(filters) || !!current}
        onClick={() => { setName(''); setDialog(true); }} />

      <Dialog header="Save view" visible={dialog} onHide={() => setDialog(false)} style={{ width: 'min(26rem, 95vw)' }}
        onShow={() => nameRef.current?.focus()}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancel" text onClick={() => setDialog(false)} />
            <Button label={existing ? `Update “${existing.name}”` : 'Save'} icon="pi pi-check" loading={busy} disabled={!name.trim()} onClick={submit} />
          </div>
        }>
        <label className="flex flex-column gap-2">
          <span>Name</span>
          <InputText ref={nameRef} value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="e.g. Active web projects" />
          {existing && <small className="text-500">A view with this name exists; saving replaces its filters.</small>}
        </label>
      </Dialog>
    </div>
  );
}
