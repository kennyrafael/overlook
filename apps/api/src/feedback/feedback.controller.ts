import { BadRequestException, Body, Controller, HttpException, Logger, Post } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { FEEDBACK_URL, validateFeedback, type FeedbackRecord } from '@overlook/shared';

/** App version from the app root's package.json (repo root or staged app), like the About dialog. */
function appVersion(): string | undefined {
  let dir = __dirname;
  while (!existsSync(join(dir, 'THIRD_PARTY_NOTICES.md')) && dirname(dir) !== dir) dir = dirname(dir);
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || undefined; } catch { return undefined; }
}

/** The JSON sent to the feedback Worker: the validated answers only, plus source and version. */
export function outgoing(r: FeedbackRecord, version = appVersion()): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: r.kind, source: 'app' };
  if (version) body.version = version;
  if (r.kind === 'pro') {
    body.pay = r.pay;
    body.features = r.features;
    if (r.other) body.other = r.other;
    if (r.price) body.price = r.price;
  } else {
    body.text = r.text;
    if (r.category) body.category = r.category;
  }
  if (r.email) { body.email = r.email; body.consent = true; }
  return body;
}

/**
 * Feedback dialog → AgentHub's feedback inbox. The window never talks to the internet (its CSP allows
 * only this local server); this endpoint forwards one form, only when the user presses Send. Nothing
 * else is attached: no project data, paths or usage. Listed in Settings → Network activity.
 */
@Controller('feedback')
export class FeedbackController {
  private readonly log = new Logger('Feedback');

  @Post()
  async send(@Body() body: unknown) {
    const result = validateFeedback(body);
    if (!result.ok) throw new BadRequestException({ statusCode: 400, message: 'Some answers need a look.', errors: result.errors });
    if (result.spam) return { ok: true };

    const url = process.env.OVERLOOK_FEEDBACK_URL || FEEDBACK_URL;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `Overlook/${appVersion() ?? 'dev'}` },
        body: JSON.stringify(outgoing(result.record)),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.log.warn(`Could not reach the feedback inbox: ${e instanceof Error ? e.message : e}`);
      throw new HttpException({ statusCode: 502, message: 'Could not reach the feedback inbox. Check your connection and try again.' }, 502);
    }
    const reply = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; errors?: Record<string, string> } | null;
    if (res.ok && reply?.ok) return { ok: true };
    if (res.status === 429) throw new HttpException({ statusCode: 429, message: 'Too many answers just now. Try again in a minute.' }, 429);
    if (res.status === 400 && reply?.errors) throw new BadRequestException({ statusCode: 400, message: 'Some answers need a look.', errors: reply.errors });
    throw new HttpException({ statusCode: 502, message: reply?.error ?? 'The feedback inbox did not accept the answers. Try again later.' }, 502);
  }
}
