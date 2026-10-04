export function formatCents(cents: number): string {
  if (typeof cents !== 'number' || isNaN(cents)) return '$0.00';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  return formatter.format(cents / 100);
}
