import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { Message } from 'primereact/message';
import type { ClaudeSearchHit } from '@overlook/shared';
import { api } from '../api';
import { relativeTime } from '../format';
import { resumeSession, useClaudeAvailable } from '../actions/projectActions';

const DEBOUNCE_MS = 250;

/** Snippet text with the server's \u0002…\u0003 marks turned into <mark> (rendered as text, never as HTML). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <>{parts.map((p, i) => (p.startsWith('\u0002')
      ? <mark key={i}>{p.slice(1, -1)}</mark>
      : <Fragment key={i}>{p.replace(/[\u0002\u0003]/g, '')}</Fragment>))}</>
  );
}

/** Full-text search over session titles and typed prompts (a local SQLite index). */
export default function PromptSearch({ projectIds, single }: { projectIds?: string[]; single?: boolean }) {
  const claudeOk = useClaudeAvailable();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ClaudeSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = projectIds?.join(',') ?? 'all';

  useEffect(() => {
    if (!q.trim()) { setHits(null); setError(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchClaude(q, projectIds)
        .then((h) => { if (!cancelled) { setHits(h); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, key]);

  return (
    <Card title="Search prompts" subTitle="Session titles and the prompts you typed, all time · kept in a local index">
      <IconField iconPosition="left" className="mb-2">
        <InputIcon className="pi pi-search" />
        <InputText className="w-full" placeholder="Search what you asked Claude…" aria-label="Search prompts"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </IconField>
      {error && <Message severity="error" text={`Search failed: ${error}`} />}
      {hits && !hits.length && <p className="text-500 m-0">No sessions match.</p>}
      {hits && hits.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-column" data-testid="search-results">
          {hits.map((h) => (
            <li key={h.id} className="flex gap-2 align-items-start py-2 border-bottom-1 surface-border">
              <div className="flex-grow-1 min-w-0">
                <div className="flex flex-wrap align-items-baseline gap-2">
                  <Link to={`/claude/sessions/${h.id}`} className="font-semibold no-underline text-primary">{h.title ?? 'Untitled session'}</Link>
                  {!single && <small className="text-500">{h.projectName}</small>}
                  <small className="text-500" title={h.endedAt}>{relativeTime(h.endedAt)}</small>
                </div>
                <div className="text-sm text-700 mt-1" style={{ overflowWrap: 'anywhere' }}>
                  {h.matchedIn === 'title' && <small className="text-500 mr-1">Title:</small>}
                  <Snippet text={h.snippet} />
                </div>
              </div>
              {claudeOk && h.projectId && h.resumable && (
                <Button icon="pi pi-replay" rounded text size="small" aria-label={`Resume ${h.title ?? 'session'}`}
                  title="Resume in a terminal (claude --resume)" onClick={() => { void resumeSession(h.projectId!, h.id, h.title); }} />
              )}
            </li>
          ))}
        </ul>
      )}
      {hits && hits.length >= 50 && <small className="text-500">Showing the 50 newest matches; add a word to narrow down.</small>}
    </Card>
  );
}
