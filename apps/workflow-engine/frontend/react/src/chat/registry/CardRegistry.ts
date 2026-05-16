/**
 * Module-scope card registry. Single source of truth for card-type →
 * component mapping. Registrations land at module-load time and live
 * for the lifetime of the page.
 */

import type { CardRegistration } from './types.js';

const registry = new Map<string, CardRegistration>();

export function registerCard(reg: CardRegistration): void {
  if (registry.has(reg.cardType)) {
    // eslint-disable-next-line no-console
    console.warn(`[CardRegistry] overwriting registration for cardType=${reg.cardType}`);
  }
  registry.set(reg.cardType, reg);
}

export function getCard(cardType: string): CardRegistration | null {
  return registry.get(cardType) ?? null;
}

export function listCards(): readonly CardRegistration[] {
  return Array.from(registry.values()).sort((a, b) => a.cardType.localeCompare(b.cardType));
}

export function clearCards(): void {
  registry.clear();
}
