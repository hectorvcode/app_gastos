import { dateKey } from './dates';

/**
 * Recordatorio de respaldo en Registrar (Fase 7b): si hay gastos y pasaron más de 7 días desde el último
 * respaldo (o nunca hubo uno), se muestra un aviso discreto. Al cerrarlo no reaparece hasta el día siguiente.
 */

export const DIAS_RECORDATORIO = 7;
const MS_DIA = 24 * 60 * 60 * 1000;

export const CLAVE_ULTIMO_RESPALDO = 'ultimoRespaldo';
export const CLAVE_RECORDATORIO_CERRADO = 'recordatorioRespaldoCerrado';

/** Lo que se guarda en `ajustes.ultimoRespaldo`. */
export interface UltimoRespaldo {
  /** ISO del momento en que se creó el último respaldo. */
  fecha: string;
  gastos: number;
  fotos: number;
}

/** Lee el ajuste guardado; si no tiene la forma esperada devuelve null (como si nunca hubiera respaldo). */
export function leerUltimoRespaldo(v: unknown): UltimoRespaldo | null {
  if (typeof v !== 'object' || v === null) return null;
  const { fecha, gastos, fotos } = v as Record<string, unknown>;
  if (typeof fecha !== 'string' || Number.isNaN(Date.parse(fecha))) return null;
  return {
    fecha,
    gastos: typeof gastos === 'number' ? gastos : 0,
    fotos: typeof fotos === 'number' ? fotos : 0,
  };
}

export interface EstadoRecordatorio {
  mostrar: boolean;
  /** Días completos desde el último respaldo, o null si nunca hubo uno. */
  dias: number | null;
}

/**
 * `cerradoEl`: día (AAAA-MM-DD, hora local) en que se cerró el aviso. Se muestra si hay gastos, no se cerró hoy
 * y el último respaldo fue hace más de 7 días (estrictamente: 7 días justos todavía no) o no existe.
 */
export function evaluarRecordatorio(
  e: { gastos: number; ultimo: UltimoRespaldo | null; cerradoEl: string | null },
  ahora: Date,
): EstadoRecordatorio {
  const transcurrido = e.ultimo ? ahora.getTime() - Date.parse(e.ultimo.fecha) : null;
  const dias = transcurrido === null ? null : Math.max(0, Math.floor(transcurrido / MS_DIA));
  const vencido = transcurrido === null || transcurrido > DIAS_RECORDATORIO * MS_DIA;
  const mostrar = e.gastos > 0 && vencido && e.cerradoEl !== dateKey(ahora);
  return { mostrar, dias };
}

/** "Hace 9 días que no respaldas tus gastos" (el botón "Respaldar" va aparte). */
export const textoRecordatorio = (dias: number | null): string =>
  dias === null ? 'Aún no has respaldado tus gastos' : `Hace ${dias} ${dias === 1 ? 'día' : 'días'} que no respaldas tus gastos`;

export interface RepoAjustesRespaldo {
  get(clave: string): Promise<unknown>;
  set(clave: string, valor: unknown): Promise<void>;
}

export async function cargarRecordatorio(
  repo: Pick<RepoAjustesRespaldo, 'get'>,
  contarGastos: () => Promise<number>,
  ahora: Date,
): Promise<EstadoRecordatorio> {
  const [ultimo, cerrado] = await Promise.all([repo.get(CLAVE_ULTIMO_RESPALDO), repo.get(CLAVE_RECORDATORIO_CERRADO)]);
  const ultimoRespaldo = leerUltimoRespaldo(ultimo);
  const cerradoEl = typeof cerrado === 'string' ? cerrado : null;
  const gastos = await contarGastos();
  return evaluarRecordatorio({ gastos, ultimo: ultimoRespaldo, cerradoEl }, ahora);
}

/** Al cerrar el aviso: no reaparece hasta el día siguiente. */
export function cerrarRecordatorio(repo: Pick<RepoAjustesRespaldo, 'set'>, ahora: Date): Promise<void> {
  return repo.set(CLAVE_RECORDATORIO_CERRADO, dateKey(ahora));
}

export function guardarUltimoRespaldo(repo: Pick<RepoAjustesRespaldo, 'set'>, ultimo: UltimoRespaldo): Promise<void> {
  return repo.set(CLAVE_ULTIMO_RESPALDO, ultimo);
}
