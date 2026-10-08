/**
 * Utilidades que no dependen de contextos seguros (HTTPS/localhost).
 * En el celular durante el desarrollo la app se abre por http://<IP-LAN>, donde
 * crypto.randomUUID, navigator.storage, serviceWorker y share no existen.
 */

type CryptoMinimo = Partial<Pick<Crypto, 'randomUUID'>> & Pick<Crypto, 'getRandomValues'>;

/** UUID v4. Usa crypto.randomUUID si existe; si no, lo arma con getRandomValues. */
export function generarUuid(c: CryptoMinimo = globalThis.crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // versión 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Pide almacenamiento persistente si el navegador lo permite.
 * Devuelve true/false según el resultado, o null si no está disponible.
 * Nunca lanza: un fallo aquí no debe impedir iniciar la app.
 */
export async function pedirPersistencia(
  storage: Pick<StorageManager, 'persist'> | undefined = globalThis.navigator?.storage,
): Promise<boolean | null> {
  if (typeof storage?.persist !== 'function') return null;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Registra el service worker solo si existe (contexto seguro); nunca lanza. */
export function registrarServiceWorker(registrar: () => void): void {
  if (!('serviceWorker' in globalThis.navigator)) return;
  try {
    registrar();
  } catch (e) {
    console.warn('No se pudo registrar el service worker', e);
  }
}

export function mensajeDeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'error desconocido';
}
