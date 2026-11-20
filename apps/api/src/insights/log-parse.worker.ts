/**
 * Worker thread that parses Claude session logs, so multi-gigabyte histories never block the
 * server's event loop. Messages in: { id, file, kind }. Messages out: { id, result } | { id, error }.
 */
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { parentPort } from 'worker_threads';
import { LogAccumulator, type LogSummary } from './session-log';
import { DetailAccumulator, indexAccumulator, type IndexedPrompt, type ParsedDetail } from './session-detail';

/** What to read from a log: the cached summary, the summary plus prompts for the search index, or the full detail. */
export type ParseKind = 'summary' | 'index' | 'detail';

export interface ParseResults {
  summary: LogSummary;
  index: { summary: LogSummary; prompts: IndexedPrompt[] };
  detail: ParsedDetail;
}

async function stream(file: string, add: (line: string) => void) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) add(line);
}

export async function parseLogFile(file: string): Promise<LogSummary> {
  const acc = new LogAccumulator();
  await stream(file, (l) => acc.add(l));
  return acc.summary();
}

export async function parseLog<K extends ParseKind>(file: string, kind: K): Promise<ParseResults[K]> {
  if (kind === 'summary') return parseLogFile(file) as Promise<ParseResults[K]>;
  const acc = kind === 'index' ? indexAccumulator() : new DetailAccumulator();
  await stream(file, (l) => acc.add(l));
  return acc.result() as ParseResults[K];
}

parentPort?.on('message', async (m: { id: number; file: string; kind?: ParseKind }) => {
  try {
    parentPort!.postMessage({ id: m.id, result: await parseLog(m.file, m.kind ?? 'summary') });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: String(e) });
  }
});
