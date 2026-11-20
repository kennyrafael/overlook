import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_CLAUDE_TASK_PROMPT, DEFAULT_SETTINGS, ModelPrice, Settings } from '@overlook/shared';
import { SettingEntity } from './setting.entity';

const KEY = 'settings';

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(SettingEntity) private repo: Repository<SettingEntity>) {}

  async get(): Promise<Settings> {
    const row = await this.repo.findOneBy({ key: KEY });
    return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : DEFAULT_SETTINGS;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const known = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
    const clean: Partial<Settings> = Object.fromEntries(
      Object.entries(patch ?? {}).filter(([k, v]) =>
        known.includes(k as keyof Settings) && typeof v === typeof DEFAULT_SETTINGS[k as keyof Settings]
          && Array.isArray(v) === Array.isArray(DEFAULT_SETTINGS[k as keyof Settings])),
    );
    if ('modelPrices' in clean) {
      const prices: Record<string, ModelPrice> = {};
      for (const [k, v] of Object.entries(clean.modelPrices as Record<string, Partial<ModelPrice>>)) {
        const key = k.trim();
        const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
        if (key && v && typeof v === 'object') prices[key] = { input: num(v.input), output: num(v.output), cacheRead: num(v.cacheRead) };
      }
      clean.modelPrices = prices;
    }
    for (const k of ['cacheWrite5mMultiplier', 'cacheWrite1hMultiplier', 'staleDays', 'maxDepth'] as const) {
      if (k in clean && !(Number.isFinite(clean[k]) && (clean[k] as number) >= 0)) delete clean[k];
    }
    if ('staleTaskDays' in clean) {
      // Whole days, at least 1 (0 would call every in-progress task stale); anything else keeps the old value.
      const n = clean.staleTaskDays as number;
      if (Number.isFinite(n) && n >= 1) clean.staleTaskDays = Math.min(3650, Math.floor(n));
      else delete clean.staleTaskDays;
    }
    if ('claudeTaskPrompt' in clean) {
      // One line, bounded, and always about the task: an empty template goes back to the default.
      let t = (clean.claudeTaskPrompt as string).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
      if (!t) t = DEFAULT_CLAUDE_TASK_PROMPT;
      else if (!t.includes('{task}')) t = `${t} {task}`;
      clean.claudeTaskPrompt = t;
    }
    const next = { ...(await this.get()), ...clean };
    await this.repo.save({ key: KEY, value: JSON.stringify(next) });
    return next;
  }
}
