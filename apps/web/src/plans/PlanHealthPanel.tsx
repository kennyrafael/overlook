import { useState } from 'react';
import { Panel } from 'primereact/panel';
import { Tag } from 'primereact/tag';
import type { PlanWarning, PlanWarningKind } from '@overlook/shared';
import { appToast } from '../toast';

const KIND_LABEL: Record<PlanWarningKind, string> = {
  'task-outside-milestone': 'Outside a milestone',
  'duplicate-task': 'Duplicate task',
  'malformed-task': 'Broken checkbox',
  'malformed-heading': 'Heading not read',
  'file-too-large': 'Large file',
};

const where = (w: PlanWarning) => (w.line ? `${w.relFile}:${w.line}` : w.relFile);

/** Copies `path:line`, which editors accept in "Go to file" (VS Code: Ctrl+P). */
async function copyLocation(w: PlanWarning) {
  const text = w.line ? `${w.file}:${w.line}` : w.file;
  try {
    await navigator.clipboard.writeText(text);
    appToast.current?.show({ severity: 'info', summary: 'Location copied', detail: `${text} — paste it into your editor's Go to File.`, life: 3000 });
  } catch {
    appToast.current?.show({ severity: 'info', summary: 'Location', detail: text, life: 6000 });
  }
}

/**
 * Plan health: mistakes in the project's plan files (broken checkboxes, headings that are not read,
 * duplicate tasks, tasks outside a milestone, large files), each with what to change. Nothing is
 * shown for a healthy plan.
 */
export default function PlanHealthPanel({ warnings }: { warnings: PlanWarning[] }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!warnings.length) return null;
  const counts = new Map<PlanWarningKind, number>();
  for (const w of warnings) counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);

  const header = (
    <div className="flex flex-wrap align-items-center gap-2">
      <i className="pi pi-exclamation-triangle text-yellow-500" />
      <span className="font-semibold">Plan health</span>
      <span className="text-500">· {warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
      {[...counts].map(([k, n]) => <Tag key={k} severity="warning" value={`${KIND_LABEL[k]} ${n}`} />)}
    </div>
  );

  return (
    <Panel className="plan-health" header={header} toggleable collapsed={collapsed} onToggle={(e) => setCollapsed(e.value)}>
      <ul className="list-none m-0 p-0 flex flex-column gap-3" aria-label="Plan warnings" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
        {warnings.map((w, i) => (
          <li key={`${w.file}:${w.line}:${w.kind}:${i}`} className="flex gap-3 align-items-start">
            <button type="button" className="plan-health-loc p-0 border-none bg-transparent text-primary cursor-pointer white-space-nowrap text-sm" style={{ fontFamily: "var(--font-mono, monospace)" }}
              title="Copy the file and line" onClick={() => { void copyLocation(w); }}>
              {where(w)}
            </button>
            <div className="flex flex-column gap-1 min-w-0">
              <span>{w.message}</span>
              <small className="text-500"><i className="pi pi-wrench text-xs mr-1" />{w.fix}</small>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
