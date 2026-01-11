export function safeDiv(n: number, d: number) {
  if (Math.abs(d) < 1e-12) return 0;
  return n / d;
}
