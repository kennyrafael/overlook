/**
 * Worker thread that parses Claude session logs, so multi-gigabyte histories never block the
 * server's event loop. Messages in: { id, file }. Messages out: { id, summary } | { id, error }.
 */
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { parentPort } from 'worker_threads';
import { LogAccumulator, type LogSummary } from './session-log';

export async function parseLogFile(file: string): Promise<LogSummary> {
  const acc = new LogAccumulator();
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) acc.add(line);
  return acc.summary();
}

parentPort?.on('message', async (m: { id: number; file: string }) => {
  try {
    parentPort!.postMessage({ id: m.id, summary: await parseLogFile(m.file) });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: String(e) });
  }
});
