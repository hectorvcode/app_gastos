const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = (n: number): string => String(n).padStart(2, '0');

/** Clave de día en hora local: AAAA-MM-DD. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key: string): Date {
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** "Lun 5 oct" */
export function shortLabel(key: string): string {
  const d = parseDateKey(key);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** "5 oct" */
export function dayMonthLabel(key: string): string {
  const d = parseDateKey(key);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** dd/mm/aaaa */
export function formatDdMmAaaa(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Fecha ISO a guardar: si el día es hoy, la hora actual; si no, 12:00 local.
 */
export function buildFechaIso(key: string, now: Date): string {
  if (key === dateKey(now)) return now.toISOString();
  const d = parseDateKey(key);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export function isFuture(key: string, now: Date): boolean {
  return key > dateKey(now);
}
