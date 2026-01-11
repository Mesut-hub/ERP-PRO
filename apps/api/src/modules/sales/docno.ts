function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatSoNo(date: Date, seq: number) {
  return `SO-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}

export function formatSdNo(date: Date, seq: number) {
  return `DEL-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}

export function formatCiNo(date: Date, seq: number) {
  return `CI-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}
