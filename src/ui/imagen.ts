import { mensajeDeError } from '../lib/compat';
import {
  decidirOrientacion,
  dimensionesOrientadas,
  leerInfoJpeg,
  matrizDestino,
  matrizOrientacion,
  textoDiagnosticoExif,
  type InfoJpeg,
  type MetodoLectura,
} from '../lib/exif';
import {
  aplicarModoRecibo,
  comprimirHastaLimite,
  ErrorFoto,
  recorteMiniatura,
  type FotoProcesada,
} from '../lib/fotos';

interface Decodificada {
  fuente: CanvasImageSource;
  /** Dimensiones tal como las devolvió el decodificador. */
  ancho: number;
  alto: number;
  metodo: MetodoLectura;
  liberar(): void;
}

/**
 * Lee la imagen. Primero con `createImageBitmap` y `imageOrientation: 'none'` (no orienta);
 * si no está disponible, con <img>. La orientación EXIF la decide `decidirOrientacion`
 * para que se aplique una sola vez. No usa APIs solo-HTTPS.
 */
async function decodificar(archivo: Blob): Promise<Decodificada> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'none' });
      return { fuente: bmp, ancho: bmp.width, alto: bmp.height, metodo: 'bitmap-sin-orientar', liberar: () => bmp.close() };
    } catch {
      // Navegador sin esa opción o imagen que no decodifica así: se prueba con <img>.
    }
  }
  // La URL se libera al terminar de usar la imagen (no antes: drawImage la sigue necesitando).
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, metodo: 'img', liberar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Orientación y dimensiones guardadas en el JPEG (el EXIF vive al principio del archivo). */
async function leerInfo(archivo: Blob): Promise<InfoJpeg> {
  try {
    return leerInfoJpeg(new Uint8Array(await archivo.slice(0, 512 * 1024).arrayBuffer()));
  } catch {
    return { orientacion: 1, ancho: null, alto: null };
  }
}

function aBlobJpeg(canvas: HTMLCanvasElement, calidad: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ErrorFoto('No se pudo comprimir la imagen.'))),
      'image/jpeg',
      calidad,
    );
  });
}

function contexto(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ErrorFoto('Este navegador no permite procesar imágenes.');
  return ctx;
}

const IDENTIDAD = [1, 0, 0, 1, 0, 0] as const;

/**
 * Convierte la foto elegida en un JPEG liviano (≤ ~500 KB, legible) más una miniatura.
 * Todo ocurre en el teléfono. Lanza `ErrorFoto` con un mensaje claro si algo falla.
 */
export async function procesarFoto(archivo: Blob, modoRecibo: boolean): Promise<FotoProcesada> {
  if (archivo.type && !archivo.type.startsWith('image/')) {
    throw new ErrorFoto('El archivo elegido no es una imagen.');
  }
  let origen: Decodificada;
  try {
    origen = await decodificar(archivo);
  } catch {
    throw new ErrorFoto(
      'No se pudo leer la imagen. El formato puede no ser compatible o el archivo estar dañado. Prueba con otra foto.',
    );
  }
  const canvas = document.createElement('canvas');
  try {
    if (!origen.ancho || !origen.alto) throw new ErrorFoto('La imagen está vacía o dañada. Prueba con otra foto.');

    // Orientación EXIF: se aplica una sola vez, y solo si el decodificador no la aplicó.
    const info = await leerInfo(archivo);
    const decision = decidirOrientacion(info, { ancho: origen.ancho, alto: origen.alto }, origen.metodo);
    const diag = textoDiagnosticoExif(info, decision);
    const matriz = matrizOrientacion(decision.aplicar, origen.ancho, origen.alto);
    const orientada = dimensionesOrientadas(origen.ancho, origen.alto, decision.aplicar);
    console.info(
      `Foto: ${origen.metodo}, decodificada ${origen.ancho}×${origen.alto}, archivo ${info.ancho ?? '?'}×${info.alto ?? '?'}, ${diag} → ${orientada.ancho}×${orientada.alto}`,
    );

    const ctx = contexto(canvas);
    let dibujado = '';
    const resultado = await comprimirHastaLimite(orientada, async (ancho, alto, calidad) => {
      const clave = `${ancho}x${alto}`;
      if (clave !== dibujado) {
        // Se vuelve a dibujar solo si cambió el tamaño; la calidad no exige redibujar.
        canvas.width = ancho;
        canvas.height = alto;
        ctx.setTransform(...IDENTIDAD);
        ctx.fillStyle = '#fff'; // JPEG no tiene transparencia
        ctx.fillRect(0, 0, ancho, alto);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(...matrizDestino(matriz, ancho / orientada.ancho));
        ctx.drawImage(origen.fuente, 0, 0, origen.ancho, origen.alto);
        ctx.setTransform(...IDENTIDAD);
        if (modoRecibo) {
          const datos = ctx.getImageData(0, 0, ancho, alto);
          aplicarModoRecibo(datos.data);
          ctx.putImageData(datos, 0, 0);
        }
        dibujado = clave;
      }
      return aBlobJpeg(canvas, calidad);
    });

    // Miniatura cuadrada tomada de la imagen ya orientada.
    const r = recorteMiniatura(orientada.ancho, orientada.alto);
    const mini = document.createElement('canvas');
    mini.width = r.destino;
    mini.height = r.destino;
    const mctx = contexto(mini);
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, r.destino, r.destino);
    mctx.imageSmoothingQuality = 'high';
    mctx.setTransform(...matrizDestino(matriz, r.destino / r.lado, r.sx, r.sy));
    mctx.drawImage(origen.fuente, 0, 0, origen.ancho, origen.alto);
    mctx.setTransform(...IDENTIDAD);
    if (modoRecibo) {
      const d = mctx.getImageData(0, 0, r.destino, r.destino);
      aplicarModoRecibo(d.data);
      mctx.putImageData(d, 0, 0);
    }
    const miniatura = await aBlobJpeg(mini, 0.7);
    mini.width = 0;

    return { blob: resultado.blob, miniatura, ancho: resultado.ancho, alto: resultado.alto, diag };
  } catch (e) {
    if (e instanceof ErrorFoto) throw e;
    throw new ErrorFoto(`No se pudo procesar la foto: ${mensajeDeError(e)}`);
  } finally {
    canvas.width = 0; // libera la memoria del lienzo
    origen.liberar();
  }
}
