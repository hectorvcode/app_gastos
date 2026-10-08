import { mensajeDeError } from '../lib/compat';

let banner: HTMLDivElement | null = null;
let temporizador: number | undefined;

/** Muestra un aviso de error visible en pantalla (nunca silencioso). */
export function mostrarError(texto: string): void {
  console.error(texto);
  mostrar(texto, false);
}

/**
 * Aviso visible de por qué una acción quedó bloqueada por una regla (no es un fallo).
 * Se ve siempre arriba de la pantalla, aunque el mensaje en línea quede fuera de vista.
 */
export function mostrarAviso(texto: string): void {
  mostrar(texto, true);
}

function mostrar(texto: string, esRegla: boolean): void {
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'aviso-error';
    banner.setAttribute('role', 'alert');
    const msg = document.createElement('span');
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.textContent = 'Cerrar';
    cerrar.addEventListener('click', () => {
      if (banner) banner.hidden = true;
    });
    banner.append(msg, cerrar);
    document.body.append(banner);
  }
  const msg = banner.firstElementChild;
  if (msg) msg.textContent = texto;
  banner.classList.toggle('aviso-regla', esRegla);
  banner.hidden = false;
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    if (banner) banner.hidden = true;
  }, 10_000);
}

/** Muestra en pantalla cualquier error no capturado. */
export function instalarManejadorGlobal(): void {
  window.addEventListener('error', (e) => {
    mostrarError(`Error inesperado: ${e.error ? mensajeDeError(e.error) : e.message}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    mostrarError(`Error inesperado: ${mensajeDeError(e.reason)}`);
  });
}
