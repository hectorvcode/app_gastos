import type { Formato } from './exportar';

export type ResultadoCompartir =
  /** El usuario completó el menú Compartir. */
  | 'compartido'
  /** Cerró el menú sin elegir destino. */
  | 'cancelado'
  /** Chrome pide un toque nuevo (pasó demasiado tiempo armando el archivo). */
  | 'requiere-gesto'
  /** Chrome rechazó compartir aunque el toque era reciente (tipo de archivo o tamaño no permitido). */
  | 'rechazado'
  /** No hay Web Share con archivos (p. ej. http://<IP-LAN>, sin contexto seguro). */
  | 'no-disponible';

type NavegadorShare = Partial<Pick<Navigator, 'share' | 'canShare' | 'userAgent'>> & { userAgentData?: { mobile?: boolean } };

/** Registro de pasos para diagnosticar con chrome://inspect o en pantalla. */
export type Anotar = (paso: string, detalle?: unknown) => void;

/**
 * Web Share solo se usa en el celular. En Chrome de escritorio (Windows) abre el panel de compartir del
 * sistema, que puede quedar oculto y dejar la promesa sin resolver: ahí se descarga directamente.
 */
export function esDispositivoMovil(nav: NavegadorShare | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod/i.test(nav.userAgent ?? '');
}

const nombreError = (e: unknown): string =>
  e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';

/** true si el navegador (en el celular) acepta compartir exactamente estos archivos. */
export function puedeCompartir(archivos: readonly File[], nav: NavegadorShare | undefined = globalThis.navigator): boolean {
  if (!esDispositivoMovil(nav)) return false;
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [...archivos] });
  } catch {
    return false;
  }
}

export interface OpcionesCompartir {
  /**
   * true cuando el toque del usuario es reciente (botón del panel "Archivo listo"): si Chrome responde
   * NotAllowedError ya no es por tiempo, sino porque no permite compartir ese archivo → 'rechazado'.
   */
  toqueReciente?: boolean;
  anotar?: Anotar;
}

/**
 * Comparte los archivos con la Web Share API si el navegador lo permite.
 * Cualquier otro fallo se propaga para que la pantalla lo muestre; nunca se traga un error.
 */
export async function compartirArchivos(
  archivos: readonly File[],
  nav: NavegadorShare | undefined = globalThis.navigator,
  opciones: OpcionesCompartir = {},
): Promise<ResultadoCompartir> {
  const anotar = opciones.anotar ?? (() => {});
  const resumen = archivos.map((a) => `${a.name} (${a.type || 'sin tipo'}, ${a.size} B)`);
  if (!esDispositivoMovil(nav)) {
    anotar('compartir: no es celular, se descarga');
    return 'no-disponible';
  }
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function') {
    anotar('compartir: sin share/canShare');
    return 'no-disponible';
  }
  const datos: ShareData = { files: [...archivos], title: archivos[0]?.name };
  const ok = nav.canShare(datos);
  anotar('compartir: canShare', { ok, archivos: resumen.length > 5 ? [...resumen.slice(0, 5), `… ${resumen.length} en total`] : resumen });
  if (!ok) return 'no-disponible';
  try {
    anotar('compartir: share()', { archivos: archivos.length });
    await nav.share(datos);
    anotar('compartir: share() terminó');
    return 'compartido';
  } catch (e) {
    const nombre = nombreError(e);
    anotar('compartir: share() falló', { nombre, mensaje: e instanceof Error ? e.message : String(e) });
    if (nombre === 'AbortError') return 'cancelado';
    if (nombre === 'NotAllowedError') return opciones.toqueReciente ? 'rechazado' : 'requiere-gesto';
    throw e;
  }
}

export const compartirArchivo = (
  archivo: File,
  nav: NavegadorShare | undefined = globalThis.navigator,
  opciones: OpcionesCompartir = {},
): Promise<ResultadoCompartir> => compartirArchivos([archivo], nav, opciones);

// ---------- Compartir datos y fotos (archivos separados) en tandas ----------

/** Chrome limita cuántos archivos y cuántos bytes admite un solo Compartir: se usa un margen prudente. */
export const MAX_ARCHIVOS_TANDA = 10;
export const MAX_BYTES_TANDA = 20 * 1024 * 1024;

/**
 * Reparte los archivos en tandas respetando el orden: el primero (el CSV) queda siempre al principio de la
 * primera tanda. Un archivo que solo ya pasa del tope de bytes va solo en su tanda.
 */
export function dividirEnTandas(
  archivos: readonly File[],
  maxArchivos: number = MAX_ARCHIVOS_TANDA,
  maxBytes: number = MAX_BYTES_TANDA,
): File[][] {
  const tandas: File[][] = [];
  let actual: File[] = [];
  let bytes = 0;
  for (const a of archivos) {
    if (actual.length > 0 && (actual.length >= maxArchivos || bytes + a.size > maxBytes)) {
      tandas.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(a);
    bytes += a.size;
  }
  if (actual.length > 0) tandas.push(actual);
  return tandas;
}

export type PlanLote = { ok: true; tandas: File[][] } | { ok: false; motivo: string };

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Divide en tandas y comprueba con canShare que cada una se puede compartir; si no, dice por qué. */
export function planificarLote(archivos: readonly File[], nav: NavegadorShare | undefined = globalThis.navigator): PlanLote {
  if (!esDispositivoMovil(nav) || typeof nav?.share !== 'function' || typeof nav.canShare !== 'function') {
    return { ok: false, motivo: 'Este navegador no permite compartir archivos.' };
  }
  const tandas = dividirEnTandas(archivos);
  for (const [i, t] of tandas.entries()) {
    if (!puedeCompartir(t, nav)) {
      const bytes = t.reduce((s, f) => s + f.size, 0);
      return {
        ok: false,
        motivo: `Chrome no permite compartir la tanda ${i + 1} de ${tandas.length} (${t.length} archivos, ${mb(bytes)}).`,
      };
    }
  }
  return { ok: true, tandas };
}

export interface OpcionesEntrega {
  /** Compartir el archivo tal cual (CSV, o el ZIP si Chrome lo permite). */
  compartirArchivo: boolean;
  /** "Compartir datos y fotos": el CSV y los JPEG como archivos separados (solo formato ZIP). */
  compartirLote: boolean;
  /** Descargar siempre se ofrece. */
  descargar: true;
}

/** Qué botones ofrecer según el celular, el formato y lo que Chrome acepta compartir. */
export function opcionesDeEntrega(e: {
  formato: Formato;
  movil: boolean;
  puedeCompartirArchivo: boolean;
  lote: PlanLote | null;
}): OpcionesEntrega {
  if (!e.movil) return { compartirArchivo: false, compartirLote: false, descargar: true };
  return {
    compartirArchivo: e.puedeCompartirArchivo,
    compartirLote: e.formato === 'zip' && e.lote?.ok === true,
    descargar: true,
  };
}
