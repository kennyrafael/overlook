import type { SystemTools } from '@overlook/shared';
import { Skeleton } from 'primereact/skeleton';

interface Row { label: string; ok: boolean; detail: string; missing: string }

function rows(t: SystemTools): Row[] {
  const history = t.claudeHistory.map((h) => h.label).join(', ');
  return [
    { label: 'Git', ok: t.git, detail: 'Commits, branches and changes per project', missing: 'Install Git to see commit activity; projects are still found.' },
    { label: 'Claude Code', ok: t.claude, detail: '"Start Claude Code" opens it in the project folder', missing: 'The claude command is not on PATH, so "Start Claude Code" is hidden.' },
    { label: 'Claude Code history', ok: t.claudeHistory.length > 0, detail: `Usage and projects from: ${history}`, missing: 'No Claude Code history found yet.' },
    { label: 'VS Code', ok: t.vscode, detail: '"Open in VS Code" is available', missing: 'Not found, so "Open in VS Code" is hidden. Install it with "Add to PATH".' },
    { label: 'Terminal', ok: !!t.terminal, detail: `"Open terminal" uses ${t.terminal}`, missing: 'No terminal found.' },
  ];
}

/** Detected tools with what each one enables (Settings and first-run setup). */
export function ToolList({ tools }: { tools: SystemTools | null }) {
  if (!tools) return <Skeleton height="10rem" />;
  return (
    <ul className="list-none p-0 m-0 flex flex-column gap-3" aria-label="Detected tools">
      {rows(tools).map((r) => (
        <li key={r.label} className="flex gap-2 align-items-start">
          <i className={`pi ${r.ok ? 'pi-check-circle text-green-500' : 'pi-minus-circle text-500'} mt-1`} aria-hidden="true" />
          <div>
            <div>{r.label} <span className="sr-only">{r.ok ? 'found' : 'not found'}</span></div>
            <small className="text-500">{r.ok ? r.detail : r.missing}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
