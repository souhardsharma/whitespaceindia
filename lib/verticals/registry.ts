import type { VerticalConfig } from './types';
import { csrConfig } from '@/lib/csr/config';
import { healthConfig } from '@/lib/health/config';
import { energyConfig } from '@/lib/energy/config';
import { educationConfig } from '@/lib/education/config';

const verticals: Map<string, VerticalConfig> = new Map([
  [csrConfig.slug, csrConfig],
  [healthConfig.slug, healthConfig],
  [energyConfig.slug, energyConfig],
  [educationConfig.slug, educationConfig],
]);

export function getVerticalConfig(slug: string): VerticalConfig | undefined {
  return verticals.get(slug);
}

export function getAllVerticals(): VerticalConfig[] {
  return Array.from(verticals.values());
}

export function getActiveVerticals(): VerticalConfig[] {
  return getAllVerticals().filter((v) => !v.comingSoon);
}

export function registerVertical(config: VerticalConfig): void {
  verticals.set(config.slug, config);
}
