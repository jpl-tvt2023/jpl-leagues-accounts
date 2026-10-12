// Shared currency formatter for purse / spend / income / payout values across the app.
// Pulled out of per-page local copies so admin + team-facing surfaces render values identically.
//
// Behavior:
//   - ≥£1M  → "£X.XXM" (2 decimals by default; pass `decimals: 1` for confirm-dialog brevity)
//   - ≥£1K  → "£XK"    (0 decimals)
//   - <£1K  → "£X"
//   - negative → "-£X..." prefix preserved

export interface FormatCurrencyOptions {
  /** Decimal places to show for the £M tier. 2 for tables/ledgers, 1 for compact confirm dialogs. */
  decimals?: 1 | 2;
}

export function formatCurrency(amount: number, opts?: FormatCurrencyOptions): string {
  const decimals = opts?.decimals ?? 2;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${sign}£${(abs / 1_000).toFixed(0)}K`;
  return `${sign}£${abs}`;
}

/**
 * Cricket money. Amounts are stored in LAKHS (100 lakhs = ₹1 crore), as whole numbers.
 *   formatLakhs(50)   → "₹50 L"
 *   formatLakhs(200)  → "₹2 Cr"
 *   formatLakhs(1625) → "₹16.25 Cr"
 */
export function formatLakhs(lakhs: number): string {
  const sign = lakhs < 0 ? "-" : "";
  const abs = Math.abs(lakhs);
  const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, "");
  return abs >= 100 ? `${sign}₹${trim(abs / 100)} Cr` : `${sign}₹${trim(abs)} L`;
}
