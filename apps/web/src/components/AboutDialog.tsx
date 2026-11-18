import { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { TabView, TabPanel } from 'primereact/tabview';
import type { AboutInfo } from '@overlook/shared';
import { api } from '../api';
import { OverlookMark } from './OverlookMark';

export const OPEN_ABOUT = 'cpd:open-about';

/** About Overlook: version, independence notice, MIT license and third-party notices. */
export default function AboutDialog() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<AboutInfo | null>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_ABOUT, show);
    return () => window.removeEventListener(OPEN_ABOUT, show);
  }, []);
  useEffect(() => {
    if (open && !info) api.about().then(setInfo).catch(() => setInfo({ version: '', license: '', notices: '' }));
  }, [open, info]);

  const pre = (text: string) => (
    <pre className="text-sm m-0 p-2 surface-ground border-round overflow-auto" style={{ maxHeight: '45vh', whiteSpace: 'pre-wrap' }}>
      {text || 'Not available.'}
    </pre>
  );

  return (
    <Dialog header="About Overlook" visible={open} onHide={() => setOpen(false)} style={{ width: 'min(46rem, 95vw)' }} data-testid="about-dialog">
      <div className="flex align-items-center gap-3 mb-3">
        <OverlookMark size={40} />
        <div>
          <div className="text-xl font-bold">Overlook {info?.version && <span className="text-color-secondary font-normal text-base">v{info.version}</span>}</div>
          <div className="text-color-secondary">A local project dashboard for Claude Code. Free and open source (MIT), by AgentHub.</div>
        </div>
      </div>
      <p className="mt-0" data-testid="about-not-affiliated">
        Overlook is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, PBC.
        "Claude" and "Claude Code" are trademarks of Anthropic, used here only to describe the tool this app works with.
      </p>
      <TabView>
        <TabPanel header="License">{pre(info?.license ?? 'Loading…')}</TabPanel>
        <TabPanel header="Third-party notices">{pre(info?.notices ?? 'Loading…')}</TabPanel>
      </TabView>
    </Dialog>
  );
}
