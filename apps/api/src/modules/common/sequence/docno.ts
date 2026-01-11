function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Standard format: CODE-YYYYMMDD-0001
 */
export function buildDocNo(code: string, date: Date, seq: number) {
  return `${code}-${ymd(date)}-${String(seq).padStart(4, '0')}`;
}
