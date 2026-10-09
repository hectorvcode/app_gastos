export type ResultadoCompartir =
  /** El usuario completó el menú Compartir. */
  | 'compartido'
  /** Cerró el menú sin elegir destino. */
  | 'cancelado'
  /** Chrome pide un toque nuevo (pasó demasiado tiempo armando el archivo). */
  | 'requiere-gesto'
  /** No hay Web Share con archivos (p. ej. http://<IP-LAN>, sin contexto seguro). */
  | 'no-disponible';

type NavegadorShare = Partial<Pick<Navigator, 'share' | 'canShare' | 'userAgent'>> & { userAgentData?: { mobile?: boolean } };

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

/**
 * Comparte el archivo con la Web Share API si el navegador lo permite.
 * Cualquier otro fallo se propaga para que la pantalla lo muestre; nunca se traga un error.
 */
export async function compartirArchivo(
  archivo: File,
  nav: NavegadorShare | undefined = globalThis.navigator,
): Promise<ResultadoCompartir> {
  if (!esDispositivoMovil(nav)) return 'no-disponible';
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function') return 'no-disponible';
  const datos: ShareData = { files: [archivo], title: archivo.name };
  if (!nav.canShare(datos)) return 'no-disponible';
  try {
    await nav.share(datos);
    return 'compartido';
  } catch (e) {
    const nombre = nombreError(e);
    if (nombre === 'AbortError') return 'cancelado';
    if (nombre === 'NotAllowedError') return 'requiere-gesto';
    throw e;
  }
}
