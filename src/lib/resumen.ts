import type { Categoria, Gasto } from '../types';
import { totalesPorMoneda } from './historial';

/** Cálculos de la pantalla Resumen (Fase 7b): sin DOM y sin convertir divisas, cada moneda por separado. */

const redondear = (n: number): number => Math.round(n * 100) / 100;

export type Variacion =
  | { tipo: 'sube' | 'baja'; porcentaje: number }
  | { tipo: 'igual' }
  /** El mes anterior no tiene gastos en esa moneda: no hay con qué comparar (no se divide por cero). */
  | { tipo: 'sin-anterior' };

/** Variación del mes frente al anterior, en porcentaje entero. */
export function variacion(actual: number, anterior: number): Variacion {
  if (anterior <= 0) return { tipo: 'sin-anterior' };
  const a = redondear(actual);
  const b = redondear(anterior);
  if (a === b) return { tipo: 'igual' };
  return { tipo: a > b ? 'sube' : 'baja', porcentaje: Math.round((Math.abs(a - b) / b) * 100) };
}

/** "↑ 12 % vs septiembre", "↓ 8 % vs septiembre", "= igual que septiembre" o "Sin gastos en septiembre". */
export function textoVariacion(v: Variacion, mesAnterior: string): string {
  if (v.tipo === 'sin-anterior') return `Sin gastos en ${mesAnterior} para comparar`;
  if (v.tipo === 'igual') return `= igual que ${mesAnterior}`;
  const pct = v.porcentaje < 1 ? '<1' : String(v.porcentaje);
  return `${v.tipo === 'sube' ? '↑' : '↓'} ${pct} % vs ${mesAnterior}`;
}

export interface TotalMes {
  moneda: string;
  total: number;
  cantidad: number;
  variacion: Variacion;
}

/** Total del mes por moneda (orden alfabético), con la variación frente al mes anterior en la misma moneda. */
export function totalesDelMes(mes: readonly Gasto[], anterior: readonly Gasto[]): TotalMes[] {
  const previos = new Map(totalesPorMoneda(anterior).map((t) => [t.moneda, t.total]));
  return totalesPorMoneda(mes).map((t) => ({
    moneda: t.moneda,
    total: t.total,
    cantidad: mes.filter((g) => g.moneda === t.moneda).length,
    variacion: variacion(t.total, previos.get(t.moneda) ?? 0),
  }));
}

/**
 * Moneda que se grafica por defecto: la predeterminada si tiene gastos en el mes; si no, la que tiene más gastos
 * (no se pueden comparar montos de monedas distintas sin convertir), y a igual cantidad la de mayor total.
 */
export function monedaPrincipal(totales: readonly TotalMes[], predeterminada?: string): string | null {
  if (predeterminada && totales.some((t) => t.moneda === predeterminada)) return predeterminada;
  let mejor: TotalMes | null = null;
  for (const t of totales) {
    if (!mejor || t.cantidad > mejor.cantidad || (t.cantidad === mejor.cantidad && t.total > mejor.total)) mejor = t;
  }
  return mejor?.moneda ?? null;
}

export interface BarraCategoria {
  categoriaId: string;
  nombre: string;
  emoji: string;
  total: number;
  cantidad: number;
  /** Parte del total de la moneda, de 0 a 100. */
  porcentaje: number;
}

export const NOMBRE_SIN_CATEGORIA = 'Sin categoría';

/** Gasto por categoría en una moneda, de mayor a menor (a igual monto, por nombre). Lo oculto también cuenta. */
export function barrasPorCategoria(
  gastos: readonly Gasto[],
  moneda: string,
  categorias: readonly Pick<Categoria, 'id' | 'nombre' | 'emoji'>[],
): BarraCategoria[] {
  const nombres = new Map(categorias.map((c) => [c.id, c]));
  const acc = new Map<string, { total: number; cantidad: number }>();
  let suma = 0;
  for (const g of gastos) {
    if (g.moneda !== moneda) continue;
    const a = acc.get(g.categoriaId) ?? { total: 0, cantidad: 0 };
    a.total += g.monto;
    a.cantidad++;
    acc.set(g.categoriaId, a);
    suma += g.monto;
  }
  return [...acc]
    .map(([categoriaId, a]) => {
      const c = nombres.get(categoriaId);
      return {
        categoriaId,
        nombre: c?.nombre ?? NOMBRE_SIN_CATEGORIA,
        emoji: c?.emoji ?? '❔',
        total: redondear(a.total),
        cantidad: a.cantidad,
        porcentaje: suma > 0 ? (a.total / suma) * 100 : 0,
      };
    })
    .sort((x, y) => y.total - x.total || x.nombre.localeCompare(y.nombre, 'es'));
}

/** "45 %" o "<1 %" para lo que no llega al 1. */
export const textoPorcentaje = (p: number): string => (p > 0 && p < 1 ? '<1 %' : `${Math.round(p)} %`);
