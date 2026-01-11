function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatJeNo(date: Date, seq: number) {
  return `JE-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}
