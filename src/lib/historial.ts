import type { Gasto } from '../types';
import { addDays, dateKey, fechaHoraAIso, isoAFechaHora, shortLabel } from './dates';
import { decimalsFor } from './money';
import { MAX_NOTA } from './nota';

export interface TotalMoneda {
  moneda: string;
  total: number;
}

export interface GrupoDia {
  /** AAAA-MM-DD en hora local */
  key: string;
  /** "Hoy", "Ayer" o "Lun 5 oct" */
  titulo: string;
  totales: TotalMoneda[];
  /** Del más reciente al más antiguo */
  gastos: Gasto[];
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

export function totalesPorMoneda(gastos: readonly Gasto[]): TotalMoneda[] {
  const acc = new Map<string, number>();
  for (const g of gastos) acc.set(g.moneda, (acc.get(g.moneda) ?? 0) + g.monto);
  return [...acc]
    .map(([moneda, total]) => ({ moneda, total: redondear(total) }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}

export function filtrarPorCategoria(gastos: readonly Gasto[], categoriaId: string | null): Gasto[] {
  return categoriaId ? gastos.filter((g) => g.categoriaId === categoriaId) : [...gastos];
}

export function filtrarPorCuenta(gastos: readonly Gasto[], cuentaId: string | null): Gasto[] {
  return cuentaId ? gastos.filter((g) => g.cuentaId === cuentaId) : [...gastos];
}

/** Aplica a la vez los filtros de categoría y cuenta (null = todas). El mes se filtra al leer. */
export function filtrarGastos(
  gastos: readonly Gasto[],
  filtros: { categoriaId: string | null; cuentaId: string | null },
): Gasto[] {
  return filtrarPorCuenta(filtrarPorCategoria(gastos, filtros.categoriaId), filtros.cuentaId);
}

export function tituloDia(key: string, hoy: string): string {
  if (key === hoy) return 'Hoy';
  if (key === addDays(hoy, -1)) return 'Ayer';
  return shortLabel(key);
}

/** Agrupa por día local, días y gastos del más reciente al más antiguo. */
export function agruparPorDia(gastos: readonly Gasto[], hoy: string): GrupoDia[] {
  const porDia = new Map<string, Gasto[]>();
  for (const g of gastos) {
    const key = dateKey(new Date(g.fecha));
    const lista = porDia.get(key);
    if (lista) lista.push(g);
    else porDia.set(key, [g]);
  }
  return [...porDia]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, lista]) => {
      const ordenados = lista.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
      return { key, titulo: tituloDia(key, hoy), totales: totalesPorMoneda(ordenados), gastos: ordenados };
    });
}

// ---------- Edición ----------

export interface CambiosGasto {
  /** AAAA-MM-DD */
  fecha: string;
  /** HH:MM */
  hora: string;
  /** Texto escrito por el usuario; admite coma o punto decimal */
  monto: string;
  categoriaId: string;
  /** Si se omite, se conserva la cuenta del gasto */
  cuentaId?: string;
  moneda: string;
  /** Texto de la nota (puede ir vacío) */
  nota: string;
}

export type ResultadoEdicion = { ok: true; gasto: Gasto; cambio: boolean } | { ok: false; error: string };

/** Valida los cambios y devuelve el gasto actualizado (con `editadoEn` nuevo si hubo cambios). */
export function validarEdicion(original: Gasto, c: CambiosGasto, ahora: Date): ResultadoEdicion {
  const texto = c.monto.trim().replace(',', '.');
  const decimales = decimalsFor(c.moneda);
  const patron = decimales === 0 ? /^\d{1,9}$/ : new RegExp(`^\\d{1,9}(\\.\\d{1,${decimales}})?$`);
  if (!patron.test(texto)) {
    return {
      ok: false,
      error: decimales === 0 ? 'Escribe un monto sin decimales.' : 'Escribe un monto válido (hasta 2 decimales).',
    };
  }
  const monto = Number(texto);
  if (monto <= 0) return { ok: false, error: 'El monto debe ser mayor que 0.' };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) return { ok: false, error: 'Elige una fecha.' };
  if (!/^\d{2}:\d{2}$/.test(c.hora)) return { ok: false, error: 'Elige una hora.' };

  // Si no cambió ni el día ni la hora, se conserva la fecha original exacta.
  const previa = isoAFechaHora(original.fecha);
  const fecha =
    previa.fecha === c.fecha && previa.hora === c.hora ? original.fecha : fechaHoraAIso(c.fecha, c.hora);
  if (new Date(fecha).getTime() > ahora.getTime()) {
    return { ok: false, error: 'La fecha y la hora no pueden ser futuras.' };
  }

  if (c.nota.length > MAX_NOTA) return { ok: false, error: `La nota admite hasta ${MAX_NOTA} caracteres.` };
  const nota = c.nota.trim();
  if (!/^[A-Z]{3}$/.test(c.moneda)) return { ok: false, error: 'Elige una moneda.' };

  const cuentaId = c.cuentaId ?? original.cuentaId;
  if (!cuentaId) return { ok: false, error: 'Elige una cuenta.' };

  const cambio =
    fecha !== original.fecha ||
    monto !== original.monto ||
    c.categoriaId !== original.categoriaId ||
    cuentaId !== original.cuentaId ||
    c.moneda !== original.moneda ||
    nota !== original.nota;
  if (!cambio) return { ok: true, gasto: original, cambio: false };
  return {
    ok: true,
    cambio: true,
    gasto: { ...original, fecha, monto, moneda: c.moneda, nota, categoriaId: c.categoriaId, cuentaId, editadoEn: ahora.toISOString() },
  };
}

// ---------- Borrado con deshacer ----------

export interface RepoHistorial {
  add(gasto: Gasto): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Elimina el gasto y devuelve la función que lo restaura tal como estaba. */
export async function eliminarGasto(repo: RepoHistorial, gasto: Gasto): Promise<() => Promise<void>> {
  await repo.delete(gasto.id);
  return () => repo.add(gasto);
}
