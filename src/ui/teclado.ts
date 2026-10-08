import { areaVisible } from '../lib/viewport';

const campoEnfocado = (): boolean =>
  document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;

/**
 * Ajuste reutilizable para el teclado en pantalla (campos de texto y número).
 *
 * - Publica `--vv-alto` y `--vv-arriba` (el área realmente visible) para que las hojas
 *   (`.hoja`) se acomoden encima del teclado, y la clase `teclado-abierto` en <html>.
 * - Complementa a `interactive-widget=resizes-content` del meta viewport; funciona también
 *   en navegadores que lo ignoran y en contextos no seguros (visualViewport no exige HTTPS).
 * - Al enfocar un campo lo deja a la vista.
 */
export function instalarAjusteTeclado(): void {
  const raiz = document.documentElement;
  const vv = window.visualViewport ?? null;
  let anchoRef = window.innerWidth;
  let alturaRef = window.innerHeight;

  const aplicar = (): void => {
    if (window.innerWidth !== anchoRef) {
      // Giro de pantalla: nueva referencia.
      anchoRef = window.innerWidth;
      alturaRef = window.innerHeight;
    }
    // Sin un campo de texto enfocado no puede haber teclado en pantalla: la referencia sigue
    // a la ventana real (también cuando se achica) y nunca se marca "teclado abierto".
    const hayCampo = campoEnfocado();
    alturaRef = hayCampo ? Math.max(alturaRef, window.innerHeight) : window.innerHeight;
    const a = areaVisible({
      alturaReferencia: alturaRef,
      vvAlto: vv ? vv.height : null,
      vvArriba: vv ? vv.offsetTop : 0,
      escala: vv ? vv.scale : 1,
      alturaVentana: window.innerHeight,
    });
    raiz.style.setProperty('--vv-alto', `${a.alto}px`);
    raiz.style.setProperty('--vv-arriba', `${a.arriba}px`);
    raiz.classList.toggle('teclado-abierto', a.tecladoAbierto && hayCampo);
  };

  vv?.addEventListener('resize', aplicar);
  vv?.addEventListener('scroll', aplicar);
  window.addEventListener('resize', aplicar);
  window.addEventListener('orientationchange', aplicar);
  aplicar();
  document.addEventListener('focusout', () => window.setTimeout(aplicar, 0));

  document.addEventListener('focusin', (e) => {
    aplicar();
    const campo = e.target;
    if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement)) return;
    // Espera a que el teclado termine de abrirse.
    window.setTimeout(() => {
      if (document.activeElement === campo) campo.scrollIntoView({ block: 'nearest' });
    }, 300);
  });
}

/** Enter o "Listo" del teclado cierra el teclado sin guardar ni enviar nada. */
export function cerrarTecladoConEnter(campo: HTMLInputElement | HTMLTextAreaElement): void {
  campo.enterKeyHint = 'done';
  (campo as HTMLElement).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    campo.blur();
  });
}
