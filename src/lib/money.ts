const SIN_DECIMALES = new Set(['COP', 'CLP', 'JPY', 'PYG']);
const MAX_ENTERO = 9;

export function decimalsFor(moneda: string): number {
  return SIN_DECIMALES.has(moneda) ? 0 : 2;
}

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back';

/** Aplica una tecla al monto en curso (cadena como "45000" o "12.5"). */
export function applyKey(entry: string, key: Key, moneda: string): string {
  const decimals = decimalsFor(moneda);
  if (key === 'back') return entry.slice(0, -1);
  if (key === '.') {
    if (decimals === 0 || entry.includes('.')) return entry;
    return (entry === '' ? '0' : entry) + '.';
  }
  const next = entry === '0' || entry === '' ? (key === '00' ? '' : key) : entry + key;
  const [ent = '', dec] = next.split('.');
  if (ent.length > MAX_ENTERO) return entry;
  if (dec !== undefined && dec.length > decimals) return entry;
  return next === '' ? entry : next;
}

export function entryToNumber(entry: string): number {
  const n = parseFloat(entry);
  return Number.isFinite(n) ? n : 0;
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Texto del monto en curso, p. ej. "45.000" o "12,5". */
export function formatEntry(entry: string): string {
  if (entry === '') return '0';
  const [ent = '0', dec] = entry.split('.');
  return groupThousands(ent) + (dec !== undefined ? ',' + dec : '');
}

/** Monto guardado, con los decimales propios de la moneda: "45.000" o "12,50". */
export function formatMonto(monto: number, moneda: string): string {
  const decimals = decimalsFor(moneda);
  const [ent = '0', dec] = Math.abs(monto).toFixed(decimals).split('.');
  return groupThousands(ent) + (dec !== undefined ? ',' + dec : '');
}
