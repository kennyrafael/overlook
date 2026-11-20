import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import type { AwaySummary } from '@overlook/shared';
import { api } from '../api';
import { formatUsd, relativeTime } from '../format';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';
import './daily.css';

const DEVICE_KEY = 'cpd-device-id';

/**
 * A random id for this browser (or app window), kept in localStorage. "Last visit" is stored per device on
 * the server, so a laptop and a desktop each get their own away card. Null when storage is blocked.
 */
export function deviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="away-stat flex align-items-center gap-2">
      <i className={`${icon} text-primary`} />
      <span className="text-xl font-bold">{value}</span>
      <span className="text-500 text-sm">{label}</span>
    </div>
  );
}

/** "Since you were away" on the Overview: what happened since this device last pressed "Mark as seen". */
export default function AwayCard() {
  const [device] = useState(deviceId);
  const [data, setData] = useState<AwaySummary | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    if (!device) return;
    try {
      const d = await api.away(device);
      // First visit ever: start counting from now and show nothing yet.
      if (!d.since) await api.markSeen(device);
      setData(d);
    } catch {
      setData(null); // the card is a convenience; the rest of the page works without it
    }
  }, [device]);

  useEffect(() => { load(); }, [load]);
  const changes = useLive((s) => `${s.git}|${s.claude}|${s.snapshots}`);
  useOnChange(changes, load);

  const markSeen = async () => {
    if (!device) return;
    setMarking(true);
    try {
      await api.markSeen(device);
      await load();
    } finally {
      setMarking(false);
    }
  };

  if (!data?.since) return null;
  const nothing = !data.tasksCompleted && !data.commits && !data.sessions;
  if (nothing) return null;

  return (
    <Card className="away-card" data-testid="away-card">
      <div className="flex flex-wrap align-items-center gap-3">
        <div className="flex flex-column">
          <span className="font-bold text-lg">Since you were away</span>
          <small className="text-500" title={new Date(data.since).toLocaleString()}>Last marked as seen {relativeTime(data.since)}</small>
        </div>
        <div className="flex flex-wrap gap-4 flex-1">
          <Stat label={data.tasksCompleted === 1 ? 'task completed' : 'tasks completed'} value={data.tasksCompleted} icon="pi pi-check-circle" />
          <Stat label={data.commits === 1 ? 'commit' : 'commits'} value={data.commits} icon="pi pi-history" />
          <Stat label={data.sessions === 1 ? 'Claude session' : 'Claude sessions'} value={data.sessions} icon="pi pi-microchip-ai" />
          <Stat label="estimated" value={formatUsd(data.costUsd)} icon="pi pi-dollar" />
        </div>
        <Button label="Mark as seen" icon="pi pi-eye" size="small" outlined loading={marking} onClick={markSeen} />
      </div>
      {(data.completed.length > 0 || data.projects.length > 0) && (
        <div className="flex flex-column md:flex-row gap-3 mt-3">
          {data.completed.length > 0 && (
            <ul className="away-list m-0 p-0 list-none flex-1">
              {data.completed.slice(0, 5).map((t, i) => (
                <li key={`${t.projectId}-${i}`} className="flex align-items-center gap-2 py-1">
                  <i className="pi pi-check text-green-500 text-sm" />
                  <span className="white-space-nowrap overflow-hidden text-overflow-ellipsis" title={t.text}>{t.text}</span>
                  <Link to={`/projects/${t.projectId}`} className="text-500 text-sm no-underline hover:text-primary white-space-nowrap">{t.projectName}</Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 align-content-start flex-1">
            {data.projects.slice(0, 8).map((p) => (
              <Link key={p.projectId} to={`/projects/${p.projectId}`} className="away-project no-underline text-color text-sm">
                <strong>{p.name}</strong>
                <span className="text-500">
                  {[p.tasksCompleted && `${p.tasksCompleted} done`, p.commits && `${p.commits} commit${p.commits === 1 ? '' : 's'}`, p.sessions && `${p.sessions} session${p.sessions === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
