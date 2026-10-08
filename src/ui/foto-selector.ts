import { repoAjustes } from '../db';
import { modoReciboActivo, type FotoProcesada } from '../lib/fotos';
import { procesarFoto } from './imagen';

export interface SelectorFoto {
  /** Contiene los <input type="file"> ocultos; hay que agregarlo al DOM. */
  el: HTMLElement;
  /** Abre la cámara trasera. Debe llamarse dentro de un toque del usuario. */
  tomar(): void;
  /** Abre la galería / selector de archivos. */
  galeria(): void;
}

function crearInput(capturar: boolean, alElegir: (f: File) => void): HTMLInputElement {
  // <input type="file"> funciona también sin HTTPS (no se usa getUserMedia).
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (capturar) input.setAttribute('capture', 'environment');
  input.className = 'archivo-input';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.addEventListener('change', () => {
    const archivo = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo
    if (archivo) alElegir(archivo);
  });
  return input;
}

export function crearSelectorFoto(alElegir: (archivo: File) => void): SelectorFoto {
  const el = document.createElement('div');
  const camara = crearInput(true, alElegir);
  const galeria = crearInput(false, alElegir);
  el.append(camara, galeria);
  return { el, tomar: () => camara.click(), galeria: () => galeria.click() };
}

/** Procesa el archivo con el "Modo recibo" que haya en Ajustes (activado por defecto). */
export async function procesarArchivoElegido(archivo: Blob): Promise<FotoProcesada> {
  const valor = await repoAjustes.get('modoRecibo');
  return procesarFoto(archivo, modoReciboActivo(valor));
}
