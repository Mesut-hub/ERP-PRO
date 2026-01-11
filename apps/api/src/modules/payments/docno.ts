function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatPayNo(date: Date, seq: number) {
  return `PAY-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}
