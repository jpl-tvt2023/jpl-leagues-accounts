/**
 * Sports, as people see them. Leagues store a short `sport` slug ("fpl", "cricket"); everywhere
 * leagues are listed — the home page, the public landing and the league picker — groups them under
 * these labels, Football first.
 *
 * The sports themselves (and their formats) are defined in ./registry.ts.
 *
 * Plain module (no react/next) so server routes, client components and unit tests share it.
 */

import { SPORTS, isKnownSport } from "./registry";

export interface SportInfo {
  sport: string;
  label: string;
  icon: string;
}

/** Label and icon for a sport slug. Unknown slugs get a capitalised label and a trophy. */
export function sportInfo(sport: string): SportInfo {
  if (isKnownSport(sport)) return { sport, label: SPORTS[sport].label, icon: SPORTS[sport].icon };
  const label = sport ? sport.charAt(0).toUpperCase() + sport.slice(1) : "Other";
  return { sport, label, icon: "🏆" };
}

/** Sort comparator for sport slugs: Football first, then by label. */
export function compareSports(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "fpl") return -1;
  if (b === "fpl") return 1;
  return sportInfo(a).label.localeCompare(sportInfo(b).label);
}

/**
 * Splits items into one group per sport, in sport order, keeping each group's items in the order
 * they arrived. Sports with no items don't appear.
 */
export function groupBySport<T extends { sport: string }>(items: readonly T[]): Array<SportInfo & { items: T[] }> {
  const bySport = new Map<string, T[]>();
  for (const item of items) {
    const list = bySport.get(item.sport);
    if (list) list.push(item);
    else bySport.set(item.sport, [item]);
  }
  return [...bySport.keys()].sort(compareSports).map((sport) => ({ ...sportInfo(sport), items: bySport.get(sport)! }));
}
