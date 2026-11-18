import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable, interval, map, merge, of } from 'rxjs';
import type { LiveEvent } from '@overlook/shared';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private events: EventsService) {}

  /** Server-Sent Events stream of live updates. Comments every 25 s keep proxies from closing it. */
  @Sse()
  stream(): Observable<MessageEvent> {
    const hello: LiveEvent = { type: 'hello', at: new Date().toISOString() };
    return merge(
      of(hello),
      this.events.stream,
      interval(25_000).pipe(map((): LiveEvent | null => null)),
    ).pipe(map((e) => (e ? { type: e.type, data: e } : { type: 'ping', data: '' })));
  }
}
