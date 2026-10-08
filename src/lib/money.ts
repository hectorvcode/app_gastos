const SIN_DECIMALES = new Set(['COP', 'CLP', 'JPY', 'PYG']);
const MAX_ENTERO = 9;

export function decimalsFor(moneda: string): number {
  return SIN_DECIMALES.has(moneda) ? 0 : 2;
}

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back';

/**
 * Tecla de la esquina inferior izquierda del teclado propio: "," (decimal) si la moneda
 * admite decimales, "00" si no. Internamente la coma es la tecla '.', igual que el teclado físico.
 */
export function teclaExtra(moneda: string): { key: Key; label: string; aria: string } {
  return decimalsFor(moneda) > 0
    ? { key: '.', label: ',', aria: 'Coma decimal' }
    : { key: '00', label: '00', aria: 'Doble cero' };
}

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

const SIMBOLOS: Record<string, string> = { COP: '$', USD: 'US$', EUR: '€', GBP: '£', MXN: 'MX$', JPY: '¥' };

/** Símbolo que se muestra junto al monto en curso; si no hay uno propio, el código. */
export function simboloMoneda(moneda: string): string {
  return SIMBOLOS[moneda] ?? moneda;
}

/**
 * Monto en curso dividido en lo escrito y el relleno gris hasta completar los decimales
 * de la moneda: USD "12.5" → { escrito: "12,5", relleno: "0" }; COP nunca lleva relleno.
 */
export function formatEntryPartes(entry: string, moneda: string): { escrito: string; relleno: string } {
  const decimals = decimalsFor(moneda);
  const escrito = formatEntry(entry);
  if (decimals === 0) return { escrito, relleno: '' };
  const dec = entry.split('.')[1];
  if (dec === undefined) return { escrito, relleno: ',' + '0'.repeat(decimals) };
  return { escrito, relleno: '0'.repeat(Math.max(0, decimals - dec.length)) };
}

/**
 * Pasa el monto en curso a otra moneda. Si la nueva moneda tiene menos decimales se
 * truncan (no se redondea, para no inflar el monto) y se devuelve lo descartado para
 * poder avisarlo y deshacerlo.
 */
export function adaptarEntry(entry: string, moneda: string): { entry: string; descartados: string } {
  const decimals = decimalsFor(moneda);
  const [ent = '', dec] = entry.split('.');
  if (dec === undefined) return { entry, descartados: '' };
  if (decimals === 0 && dec === '') return { entry: ent, descartados: '' }; // "12." → "12"
  if (dec.length <= decimals) return { entry, descartados: '' };
  const conservados = dec.slice(0, decimals);
  return {
    entry: decimals === 0 ? ent : `${ent}.${conservados}`,
    descartados: dec.slice(decimals),
  };
}

/**
 * Reformatea el texto de un campo de monto (hoja de edición) al cambiar de moneda:
 * "12.00" → "12" en COP, "45000" → "45000.00" en USD. Si el texto no es un número
 * válido, o perdería decimales distintos de cero, se deja tal cual para que la
 * validación lo señale en vez de cambiarlo en silencio.
 */
export function montoParaCampo(texto: string, moneda: string): string {
  const t = texto.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d+)?$/.test(t)) return texto;
  const n = Number(t);
  const decimals = decimalsFor(moneda);
  if (Math.abs(n - Number(n.toFixed(decimals))) > 1e-9) return texto;
  return n.toFixed(decimals);
}
