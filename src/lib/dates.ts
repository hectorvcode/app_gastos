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

const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface Mes {
  anio: number;
  /** 0 = enero */
  mes: number;
}

export function mesDe(d: Date): Mes {
  return { anio: d.getFullYear(), mes: d.getMonth() };
}

export function desplazarMes(m: Mes, delta: number): Mes {
  const d = new Date(m.anio, m.mes + delta, 1);
  return mesDe(d);
}

/** "octubre" */
export const nombreMes = (m: Mes): string => MESES_LARGOS[m.mes] ?? '';

/** "octubre 2026" */
export function etiquetaMes(m: Mes): string {
  return `${MESES_LARGOS[m.mes]} ${m.anio}`;
}

/** Rango ISO [desde, hasta) del mes en hora local, comparable con `gasto.fecha`. */
export function rangoMes(m: Mes): { desde: string; hasta: string } {
  return {
    desde: new Date(m.anio, m.mes, 1).toISOString(),
    hasta: new Date(m.anio, m.mes + 1, 1).toISOString(),
  };
}

/** Día local (AAAA-MM-DD) y hora (HH:MM) de una fecha ISO. */
export function isoAFechaHora(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso);
  return { fecha: dateKey(d), hora: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Fecha ISO a partir de un día local y una hora HH:MM. */
export function fechaHoraAIso(fecha: string, hora: string): string {
  const d = parseDateKey(fecha);
  const [h = 0, min = 0] = hora.split(':').map(Number);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}
