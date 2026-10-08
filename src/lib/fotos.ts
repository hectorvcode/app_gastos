import type { Foto, Gasto } from '../types';
import { mensajeDeError } from './compat';

/** Tope de peso por foto: 500 KB (si no se logra sin bajar de los mínimos, se guarda igual). */
export const LIMITE_BYTES = 500 * 1024;
/** Total de píxeles máximo; el lado corto mínimo (abajo) tiene prioridad sobre este tope. */
export const MAX_PIXELES = 2_500_000;
export const LADO_CORTO_OBJETIVO = 1000;
/** Nunca se reduce por debajo de este lado corto (si la foto original lo tiene). */
export const LADO_CORTO_PISO = 900;
/** Red de seguridad para tiras larguísimas: evita lienzos enormes en el teléfono. */
export const MAX_LADO_LARGO = 8000;
/** Calidades JPEG que se prueban en orden: se usa la más alta que deje la foto bajo el límite. */
export const CALIDADES = [0.85, 0.75, 0.7, 0.6] as const;
export const CALIDAD_MINIMA = 0.6;
export const PASO_RESOLUCION = 0.85;
export const LADO_MINIATURA = 160;

export interface Dimensiones {
  ancho: number;
  alto: number;
}

/** Foto ya procesada, lista para guardarse (todavía sin id). */
export interface FotoProcesada extends Dimensiones {
  blob: Blob;
  miniatura: Blob;
  /** Diagnóstico de la orientación EXIF (p. ej. "EXIF 6 · app"); se muestra en el visor. */
  diag?: string;
}

const redondear = (n: number): number => Math.max(1, Math.round(n));

/**
 * Tamaño al que se reduce la foto: como mucho `MAX_PIXELES` en total, pero conservando un lado
 * corto de 1000 px cuando la original lo tiene (así un recibo largo y angosto sigue legible).
 * Nunca amplía.
 */
export function calcularDimensiones(ancho: number, alto: number): Dimensiones {
  const corto = Math.min(ancho, alto);
  const largo = Math.max(ancho, alto);
  let escala = Math.min(1, Math.sqrt(MAX_PIXELES / (ancho * alto)));
  const cortoMinimo = Math.min(LADO_CORTO_OBJETIVO, corto);
  if (corto * escala < cortoMinimo) escala = cortoMinimo / corto;
  if (largo * escala > MAX_LADO_LARGO) escala = MAX_LADO_LARGO / largo;
  escala = Math.min(1, escala);
  return { ancho: redondear(ancho * escala), alto: redondear(alto * escala) };
}

/** Siguiente tamaño más pequeño sin bajar del piso de lado corto; null si ya no se puede reducir. */
export function reducirDimensiones(d: Dimensiones, piso: number): Dimensiones | null {
  const corto = Math.min(d.ancho, d.alto);
  if (corto <= piso) return null;
  const escala = Math.max(PASO_RESOLUCION, piso / corto);
  return { ancho: redondear(d.ancho * escala), alto: redondear(d.alto * escala) };
}

export interface ResultadoCompresion extends Dimensiones {
  blob: Blob;
  calidad: number;
  /** true si ni con la resolución y la calidad mínimas bajó del límite (se guarda igual). */
  superaLimite: boolean;
}

/**
 * Busca la foto más fiel que cabe en `limite`: al tamaño inicial prueba las calidades 0,85, 0,75, 0,7
 * y 0,6 (solo baja si la anterior se pasa del límite); si no alcanza, reduce la resolución en pasos de 15 % (sin bajar del lado corto de 900 px
 * ni de la calidad 0,6). Si aun así pasa del límite, devuelve el intento más pequeño.
 */
export async function comprimirHastaLimite(
  original: Dimensiones,
  codificar: (ancho: number, alto: number, calidad: number) => Promise<Blob>,
  limite: number = LIMITE_BYTES,
): Promise<ResultadoCompresion> {
  const inicial = calcularDimensiones(original.ancho, original.alto);
  const piso = Math.min(LADO_CORTO_PISO, Math.min(inicial.ancho, inicial.alto));
  let mejor: ResultadoCompresion | null = null;
  let d: Dimensiones | null = inicial;
  while (d) {
    for (const calidad of CALIDADES) {
      const blob = await codificar(d.ancho, d.alto, calidad);
      if (blob.size < limite) return { blob, ancho: d.ancho, alto: d.alto, calidad, superaLimite: false };
      if (!mejor || blob.size < mejor.blob.size) {
        mejor = { blob, ancho: d.ancho, alto: d.alto, calidad, superaLimite: true };
      }
    }
    d = reducirDimensiones(d, piso);
  }
  // `inicial` siempre se intenta, así que `mejor` existe.
  return mejor as ResultadoCompresion;
}

/** Cuadrado de la miniatura: recorte desde arriba al centro (el comercio y el total suelen estar ahí). */
export function recorteMiniatura(ancho: number, alto: number): { sx: number; sy: number; lado: number; destino: number } {
  const lado = Math.min(ancho, alto);
  return { sx: Math.round((ancho - lado) / 2), sy: 0, lado, destino: Math.min(LADO_MINIATURA, lado) };
}

// ---------- Modo recibo ----------

export const CONTRASTE_MODO_RECIBO = 1.2;

/** Escala de grises con un ligero aumento de contraste, sobre RGBA (modifica el arreglo). */
export function aplicarModoRecibo(rgba: Uint8ClampedArray): void {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const gris = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    const v = (gris - 128) * CONTRASTE_MODO_RECIBO + 128; // Uint8ClampedArray recorta a 0-255
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
  }
}

/** El modo recibo está activado salvo que Ajustes lo haya desactivado explícitamente. */
export const modoReciboActivo = (valor: unknown): boolean => valor !== false;

// ---------- Texto ----------

export function textoPeso(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** "412 KB · 1080×2310" */
export const textoInfoFoto = (bytes: number, ancho: number, alto: number): string =>
  `${textoPeso(bytes)} · ${ancho}×${alto}`;

/** Mensaje para un fallo de almacenamiento; explica claramente la falta de espacio. */
export function mensajeErrorAlmacenamiento(e: unknown): string {
  const nombre = (x: unknown): string => (x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : '');
  const inner = e && typeof e === 'object' && 'inner' in e ? (e as { inner: unknown }).inner : undefined;
  if (nombre(e) === 'QuotaExceededError' || nombre(inner) === 'QuotaExceededError') {
    return 'no hay espacio suficiente en el teléfono. Libera espacio e inténtalo de nuevo.';
  }
  return mensajeDeError(e);
}

/** Error al leer o procesar la imagen elegida. */
export class ErrorFoto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFoto';
  }
}

// ---------- Cambios de foto al editar ----------

export type CambioFoto = { tipo: 'ninguno' } | { tipo: 'quitar' } | { tipo: 'reemplazar'; foto: FotoProcesada };

export interface EdicionConFoto {
  gasto: Gasto;
  /** Foto nueva que hay que guardar junto con el gasto. */
  fotoNueva: Foto | null;
  /** Foto anterior que se elimina al guardar (nunca antes). */
  fotoABorrar: string | null;
  /** true si la foto cambió (aunque no cambie ningún otro campo). */
  cambioFoto: boolean;
}

/**
 * Combina el gasto ya validado con el cambio de foto. Si la foto cambia, `editadoEn` se actualiza.
 * `original` es el gasto antes de editar (de él sale la foto vieja).
 */
export function aplicarCambioFoto(
  validado: Gasto,
  original: Gasto,
  cambio: CambioFoto,
  ahora: Date,
  nuevoId: () => string,
): EdicionConFoto {
  if (cambio.tipo === 'ninguno' || (cambio.tipo === 'quitar' && original.fotoId === null)) {
    return { gasto: validado, fotoNueva: null, fotoABorrar: null, cambioFoto: false };
  }
  const editadoEn = ahora.toISOString();
  if (cambio.tipo === 'quitar') {
    return { gasto: { ...validado, fotoId: null, editadoEn }, fotoNueva: null, fotoABorrar: original.fotoId, cambioFoto: true };
  }
  const id = nuevoId();
  return {
    gasto: { ...validado, fotoId: id, editadoEn },
    fotoNueva: fotoDesdeProcesada(id, cambio.foto),
    fotoABorrar: original.fotoId,
    cambioFoto: true,
  };
}

export function fotoDesdeProcesada(id: string, f: FotoProcesada): Foto {
  return { id, blob: f.blob, miniatura: f.miniatura, ancho: f.ancho, alto: f.alto, diag: f.diag };
}

// ---------- Fotos huérfanas ----------

export interface RepoLimpieza {
  /** Ids de fotos guardadas y ids de fotos referenciadas por gastos (se ejecuta dentro de una transacción). */
  leer(): Promise<{ fotos: string[]; enUso: string[] }>;
  borrar(ids: string[]): Promise<void>;
}

export const idsHuerfanos = (fotos: readonly string[], enUso: readonly (string | null)[]): string[] => {
  const usadas = new Set(enUso);
  return fotos.filter((id) => !usadas.has(id));
};

/** Borra las fotos que ningún gasto referencia; devuelve cuántas eliminó. */
export async function limpiarFotosHuerfanas(repo: RepoLimpieza): Promise<number> {
  const { fotos, enUso } = await repo.leer();
  const ids = idsHuerfanos(fotos, enUso);
  if (ids.length > 0) await repo.borrar(ids);
  return ids.length;
}
