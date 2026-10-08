import type { FotoProcesada } from './fotos';

/**
 * Borrador del gasto en curso. Se guarda mientras hay una foto pendiente o se espera una
 * (la cámara puede hacer que Android cierre Chrome por falta de memoria) y se recupera al
 * volver a abrir la app. Vive en IndexedDB (tabla `ajustes`), que funciona sin HTTPS.
 */

export const BORRADOR_VIGENCIA_MS = 15 * 60 * 1000;
const CLAVE_BORRADOR = 'borrador';
const CLAVE_FOTO = 'fotoPendiente';

export const MSG_RECUPERADO = 'Recuperamos el gasto que estabas registrando.';
export const MSG_FOTO_PERDIDA =
  'La foto se perdió porque Android cerró la app al abrir la cámara. Tómala de nuevo o elígela de la galería.';

/** Lo que Registrar escribió: monto, moneda, fecha elegida (null = Hoy), cuenta y nota. */
export interface InstantaneaRegistro {
  entry: string;
  moneda: string;
  fecha: string | null;
  cuentaId: string;
  nota: string;
}

export interface Borrador extends InstantaneaRegistro {
  /** true si se abrió el selector de foto y la foto todavía no llegó. */
  esperandoFoto: boolean;
  /** Milisegundos desde 1970 de la última vez que se guardó. */
  guardadoEn: number;
}

export interface RepoBorrador {
  get(clave: string): Promise<unknown>;
  set(clave: string, valor: unknown): Promise<void>;
  delete(clave: string): Promise<void>;
}

const esTexto = (x: unknown): x is string => typeof x === 'string';
const esNumero = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validarBorrador(x: unknown): Borrador | null {
  if (!x || typeof x !== 'object') return null;
  const b = x as Record<string, unknown>;
  if (
    !esTexto(b.entry) ||
    !/^[0-9]*\.?[0-9]*$/.test(b.entry) ||
    !esTexto(b.moneda) ||
    !/^[A-Z]{3}$/.test(b.moneda) ||
    !(b.fecha === null || (esTexto(b.fecha) && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha))) ||
    !esTexto(b.cuentaId) ||
    !esTexto(b.nota) ||
    typeof b.esperandoFoto !== 'boolean' ||
    !esNumero(b.guardadoEn)
  ) {
    return null;
  }
  return {
    entry: b.entry,
    moneda: b.moneda,
    fecha: b.fecha as string | null,
    cuentaId: b.cuentaId,
    nota: b.nota,
    esperandoFoto: b.esperandoFoto,
    guardadoEn: b.guardadoEn,
  };
}

/** Un borrador sirve si tiene menos de 15 minutos. */
export const borradorVigente = (b: Borrador, ahora: number): boolean => {
  const edad = ahora - b.guardadoEn;
  return edad >= 0 && edad < BORRADOR_VIGENCIA_MS;
};

export async function guardarBorrador(
  repo: RepoBorrador,
  snap: InstantaneaRegistro,
  esperandoFoto: boolean,
  ahora: number,
): Promise<void> {
  const b: Borrador = { ...snap, esperandoFoto, guardadoEn: ahora };
  await repo.set(CLAVE_BORRADOR, b);
}

/** Guarda la foto ya procesada que está pendiente (o la borra si ya no hay). */
export async function guardarFotoPendiente(repo: RepoBorrador, foto: FotoProcesada | null): Promise<void> {
  if (!foto) {
    await repo.delete(CLAVE_FOTO);
    return;
  }
  const { blob, miniatura, ancho, alto, diag } = foto;
  await repo.set(CLAVE_FOTO, { blob, miniatura, ancho, alto, diag });
}

/** Borra el borrador y la foto pendiente (al guardar el gasto o al descartarlo). */
export async function borrarBorrador(repo: RepoBorrador): Promise<void> {
  await repo.delete(CLAVE_BORRADOR);
  await repo.delete(CLAVE_FOTO);
}

function validarFoto(x: unknown): FotoProcesada | null {
  if (!x || typeof x !== 'object') return null;
  const f = x as Record<string, unknown>;
  if (!(f.blob instanceof Blob) || !(f.miniatura instanceof Blob) || !esNumero(f.ancho) || !esNumero(f.alto)) return null;
  return {
    blob: f.blob,
    miniatura: f.miniatura,
    ancho: f.ancho,
    alto: f.alto,
    ...(esTexto(f.diag) ? { diag: f.diag } : {}),
  };
}

export interface BorradorRecuperado {
  borrador: Borrador;
  foto: FotoProcesada | null;
}

/**
 * Lee el borrador guardado. Si falta, está dañado o tiene 15 minutos o más, se descarta
 * (junto con su foto) sin avisar y devuelve null.
 */
export async function leerBorrador(repo: RepoBorrador, ahora: number): Promise<BorradorRecuperado | null> {
  const borrador = validarBorrador(await repo.get(CLAVE_BORRADOR));
  if (!borrador || !borradorVigente(borrador, ahora)) {
    await borrarBorrador(repo);
    return null;
  }
  return { borrador, foto: validarFoto(await repo.get(CLAVE_FOTO)) };
}

/** Aviso al recuperar: si se esperaba una foto y no llegó (la marca sigue puesta), lo dice. */
export function avisoRecuperacion(r: BorradorRecuperado): string {
  return r.borrador.esperandoFoto ? `${MSG_RECUPERADO} ${MSG_FOTO_PERDIDA}` : MSG_RECUPERADO;
}
