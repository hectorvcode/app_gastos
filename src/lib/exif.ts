/**
 * Orientación EXIF de las fotos JPEG, sin DOM para poder probarla.
 *
 * Por qué existe: según el navegador y el método de lectura, la orientación EXIF se aplica sola
 * al decodificar o no se aplica. Aquí se lee la etiqueta, se compara con lo que realmente
 * devolvió el decodificador y se aplica UNA sola vez, solo si hace falta.
 */

export interface InfoJpeg {
  /** 1-8 según EXIF; 1 si no hay etiqueta o no es un JPEG. */
  orientacion: number;
  /** Dimensiones guardadas en el archivo (antes de orientar); null si no se pudieron leer. */
  ancho: number | null;
  alto: number | null;
}

const SIN_INFO: InfoJpeg = { orientacion: 1, ancho: null, alto: null };

/** Lee la orientación y las dimensiones de un JPEG recorriendo sus segmentos. Nunca lanza. */
export function leerInfoJpeg(bytes: Uint8Array): InfoJpeg {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return SIN_INFO;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let orientacion = 1;
    let ancho: number | null = null;
    let alto: number | null = null;
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marcador = bytes[i + 1]!;
      if (marcador === 0xff) {
        i++; // relleno
        continue;
      }
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
        i += 2; // marcadores sin longitud
        continue;
      }
      if (marcador === 0xd9 || marcador === 0xda) break; // fin de imagen / comienzo de datos
      const largo = v.getUint16(i + 2);
      if (largo < 2) break;
      const cuerpo = i + 4;
      if (marcador === 0xe1 && orientacion === 1) {
        orientacion = orientacionDeExif(v, cuerpo, Math.min(i + 2 + largo, bytes.length)) ?? 1;
      } else if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
        if (cuerpo + 5 <= bytes.length) {
          alto = v.getUint16(cuerpo + 1);
          ancho = v.getUint16(cuerpo + 3);
        }
        break;
      }
      i += 2 + largo;
    }
    return { orientacion, ancho, alto };
  } catch {
    return SIN_INFO;
  }
}

function orientacionDeExif(v: DataView, inicio: number, fin: number): number | null {
  // "Exif\0\0" + cabecera TIFF
  if (inicio + 14 > fin || v.getUint32(inicio) !== 0x45786966 || v.getUint16(inicio + 4) !== 0) return null;
  const tiff = inicio + 6;
  const bom = v.getUint16(tiff);
  const little = bom === 0x4949;
  if (!little && bom !== 0x4d4d) return null;
  if (v.getUint16(tiff + 2, little) !== 0x002a) return null;
  const ifd = tiff + v.getUint32(tiff + 4, little);
  if (ifd + 2 > fin) return null;
  const n = v.getUint16(ifd, little);
  for (let k = 0; k < n; k++) {
    const entrada = ifd + 2 + k * 12;
    if (entrada + 12 > fin) return null;
    if (v.getUint16(entrada, little) === 0x0112) {
      const o = v.getUint16(entrada + 8, little);
      return o >= 1 && o <= 8 ? o : null;
    }
  }
  return null;
}

/** Con orientaciones 5-8 la imagen se muestra con el ancho y el alto intercambiados. */
export const intercambiaLados = (orientacion: number): boolean => orientacion >= 5 && orientacion <= 8;

export function dimensionesOrientadas(ancho: number, alto: number, orientacion: number): { ancho: number; alto: number } {
  return intercambiaLados(orientacion) ? { ancho: alto, alto: ancho } : { ancho, alto };
}

export type Matriz = [number, number, number, number, number, number];

/**
 * Matriz de canvas (`setTransform`) que lleva una imagen cruda de `ancho`×`alto` a su posición
 * correcta según la orientación EXIF: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
export function matrizOrientacion(orientacion: number, ancho: number, alto: number): Matriz {
  switch (orientacion) {
    case 2:
      return [-1, 0, 0, 1, ancho, 0];
    case 3:
      return [-1, 0, 0, -1, ancho, alto];
    case 4:
      return [1, 0, 0, -1, 0, alto];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, alto, 0];
    case 7:
      return [0, -1, -1, 0, alto, ancho];
    case 8:
      return [0, -1, 1, 0, 0, ancho];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/** Escala la matriz y la desplaza para recortar: (dx, dy) es la esquina del recorte ya orientada. */
export function matrizDestino(m: Matriz, escala: number, dx = 0, dy = 0): Matriz {
  return [m[0] * escala, m[1] * escala, m[2] * escala, m[3] * escala, (m[4] - dx) * escala, (m[5] - dy) * escala];
}

export type MetodoLectura = 'bitmap-sin-orientar' | 'img';

export interface DecisionOrientacion {
  /** Orientación que debe aplicar la app (1 = ninguna). */
  aplicar: number;
  /** Quién orientó la foto, para el texto de diagnóstico. */
  quien: 'app' | 'navegador' | 'nadie';
}

/**
 * Decide si la app debe orientar la imagen, comparando las dimensiones guardadas en el archivo
 * con las que devolvió el decodificador:
 * - orientaciones 5-8 cambian ancho y alto, así que se detecta si el navegador ya la aplicó;
 * - orientaciones 2-4 no cambian las dimensiones: se confía en el método
 *   (`createImageBitmap` con `imageOrientation: 'none'` no orienta; `<img>` sí).
 */
export function decidirOrientacion(
  info: InfoJpeg,
  decodificado: { ancho: number; alto: number },
  metodo: MetodoLectura,
): DecisionOrientacion {
  const o = info.orientacion;
  if (o === 1) return { aplicar: 1, quien: 'nadie' };
  if (intercambiaLados(o) && info.ancho !== null && info.alto !== null && info.ancho !== info.alto) {
    const igualAlCrudo = decodificado.ancho === info.ancho && decodificado.alto === info.alto;
    const intercambiado = decodificado.ancho === info.alto && decodificado.alto === info.ancho;
    if (intercambiado) return { aplicar: 1, quien: 'navegador' };
    if (igualAlCrudo) return { aplicar: o, quien: 'app' };
  }
  return metodo === 'img' ? { aplicar: 1, quien: 'navegador' } : { aplicar: o, quien: 'app' };
}

/** Texto corto para el visor, p. ej. "EXIF 6 · app". */
export const textoDiagnosticoExif = (info: InfoJpeg, d: DecisionOrientacion): string =>
  `EXIF ${info.orientacion}${d.quien === 'nadie' ? '' : ` · ${d.quien}`}`;
