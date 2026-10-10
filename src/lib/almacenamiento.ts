import { pedirPersistencia } from './compat';
import { textoPeso } from './fotos';

/**
 * Estado del almacenamiento (Fase 7b). `navigator.storage` solo existe en contextos seguros: por HTTP
 * (http://<IP-LAN>) no hay estimación ni persistencia, y la pantalla lo dice sin errores.
 */

export const NO_DISPONIBLE = 'No disponible en esta conexión';

type Almacen = Partial<Pick<StorageManager, 'estimate' | 'persisted' | 'persist'>>;

export interface EstadoAlmacenamiento {
  /** null si el navegador no ofrece la estimación. */
  usado: number | null;
  cuota: number | null;
  /** null si el navegador no dice si es persistente. */
  persistente: boolean | null;
  /** Se puede pedir persistencia (existe `persist`). */
  puedePedir: boolean;
}

const almacenDelNavegador = (): Almacen | undefined => globalThis.navigator?.storage;

/** Nunca lanza: lo que falle o no exista queda en null. */
export async function leerAlmacenamiento(storage: Almacen | undefined = almacenDelNavegador()): Promise<EstadoAlmacenamiento> {
  let usado: number | null = null;
  let cuota: number | null = null;
  let persistente: boolean | null = null;
  if (typeof storage?.estimate === 'function') {
    try {
      const e = await storage.estimate();
      if (typeof e.usage === 'number') usado = e.usage;
      if (typeof e.quota === 'number') cuota = e.quota;
    } catch {
      // se queda como "no disponible"
    }
  }
  if (typeof storage?.persisted === 'function') {
    try {
      persistente = await storage.persisted();
    } catch {
      // se queda como "no disponible"
    }
  }
  return { usado, cuota, persistente, puedePedir: typeof storage?.persist === 'function' };
}

/** "12,3 MB usados de 1,2 GB · quedan 1,2 GB" o "No disponible en esta conexión". */
export function textoEspacio(e: Pick<EstadoAlmacenamiento, 'usado' | 'cuota'>): string {
  if (e.usado === null || e.cuota === null) return NO_DISPONIBLE;
  const libre = Math.max(0, e.cuota - e.usado);
  return `${textoPesoGrande(e.usado)} usados de ${textoPesoGrande(e.cuota)} · quedan ${textoPesoGrande(libre)}`;
}

function textoPesoGrande(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : textoPeso(bytes);
}

export function textoPersistencia(persistente: boolean | null): string {
  if (persistente === null) return NO_DISPONIBLE;
  return persistente
    ? 'Persistente: Chrome no borrará tus datos aunque falte espacio.'
    : 'No persistente: Chrome podría borrar los datos si el teléfono se queda sin espacio.';
}

/** Pide almacenamiento persistente (reutiliza compat.ts). null = no disponible. */
export const pedirAlmacenamientoPersistente = (storage: Almacen | undefined = almacenDelNavegador()): Promise<boolean | null> =>
  pedirPersistencia(storage as Parameters<typeof pedirPersistencia>[0]);

/** Cantidad de gastos y de fotos y su peso aproximado. */
export function textoConteos(gastos: number, fotos: number, bytesFotos: number): string {
  const g = `${gastos} ${gastos === 1 ? 'gasto' : 'gastos'}`;
  const f = `${fotos} ${fotos === 1 ? 'foto' : 'fotos'}`;
  return fotos === 0 ? `${g} · ${f}` : `${g} · ${f} (unos ${textoPeso(bytesFotos)})`;
}
