import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_SETTINGS, ModelPrice, Settings } from '@overlook/shared';
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
    const next = { ...(await this.get()), ...clean };
    await this.repo.save({ key: KEY, value: JSON.stringify(next) });
    return next;
  }
}
