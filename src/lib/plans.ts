/** Plan catalogue. Prices are integer cents, ordered from cheapest to most expensive. */
export const PLANS = [
  { name: 'Starter', priceCents: 2500 },
  { name: 'Pro', priceCents: 5000 },
  { name: 'Enterprise', priceCents: 15000 },
] as const;

export type Plan = (typeof PLANS)[number];
export type PlanName = Plan['name'];

export function findPlan(name: string | null | undefined): Plan | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return PLANS.find((p) => p.name.toLowerCase() === n);
}

/** The most expensive plan that is still strictly cheaper than `currentPriceCents`, if any. */
export function nextLowerPlan(currentPriceCents: number): Plan | undefined {
  const lower = PLANS.filter((p) => p.priceCents < currentPriceCents);
  return lower.length ? lower[lower.length - 1] : undefined;
}
