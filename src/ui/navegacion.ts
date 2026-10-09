import { mensajeDeError } from '../lib/compat';
import { PilaNavegacion, pasosParaLimpiar } from '../lib/navegacion';
import { mostrarError } from './avisos';

/**
 * Pila de hojas de toda la app (ver lib/navegacion.ts). `pushState`/`popstate` funcionan también sin
 * contexto seguro (http://<IP-LAN>). Toda hoja o pantalla secundaria debe registrarse con `navegacion.abrir`
 * y cerrarse con la `Capa` que devuelve (o con el botón `botonAtras`), nunca ocultándose por su cuenta.
 */

/** Cuadro "¿Descartar cambios?" y similares: dos botones grandes, sin entrar en la pila. */
function dialogo(mensaje: string, si: string, no: string, peligroso: boolean): { promesa: Promise<boolean>; cancelar(): void } {
  const fondo = document.createElement('div');
  fondo.className = 'hoja hoja-dialogo';
  fondo.setAttribute('role', 'alertdialog');
  fondo.setAttribute('aria-label', mensaje);
  const panel = document.createElement('div');
  panel.className = 'hoja-panel';
  const titulo = document.createElement('h2');
  titulo.className = 'hoja-titulo';
  titulo.textContent = mensaje;
  const bSi = document.createElement('button');
  bSi.type = 'button';
  bSi.className = peligroso ? 'btn-peligro' : 'btn-primario';
  bSi.textContent = si;
  const bNo = document.createElement('button');
  bNo.type = 'button';
  bNo.className = 'btn-primario';
  bNo.textContent = no;
  panel.append(titulo, bNo, bSi);
  fondo.append(panel);
  document.body.append(fondo);
  bNo.focus();

  let resolver: (v: boolean) => void = () => {};
  const promesa = new Promise<boolean>((r) => (resolver = r));
  const terminar = (v: boolean): void => {
    if (!fondo.isConnected) return;
    fondo.remove();
    resolver(v);
  };
  bSi.addEventListener('click', () => terminar(true));
  bNo.addEventListener('click', () => terminar(false));
  fondo.addEventListener('click', (e) => {
    if (e.target === fondo) terminar(false);
  });
  return { promesa, cancelar: () => terminar(false) };
}

export const navegacion = new PilaNavegacion(
  {
    // `n` = entradas sobre la base: si la página se recarga con una hoja abierta, instalarNavegacion las limpia.
    empujar: () => history.pushState({ hoja: true, n: (pasosParaLimpiar(history.state) || 0) + 1 }, ''),
    retroceder: (pasos) => history.go(-pasos),
  },
  // Se llama desde el propio popstate: no puede registrarse como hoja.
  (mensaje, etiquetas) =>
    dialogo(mensaje, etiquetas?.descartar ?? 'Descartar', etiquetas?.seguir ?? 'Seguir editando', true).promesa,
);

/** Se llama una vez al iniciar (main.ts). */
export function instalarNavegacion(): void {
  // Recarga con una hoja abierta: la pila quedó vacía pero el historial conserva sus entradas. Se vuelve a la base
  // (la página se recarga en ella) para que ningún Atrás quede sin efecto visible.
  const sobrantes = pasosParaLimpiar(history.state);
  if (sobrantes > 0) history.go(-sobrantes);
  window.addEventListener('popstate', () => {
    navegacion.alRetroceder().catch((e) => mostrarError(`No se pudo volver atrás: ${mensajeDeError(e)}`));
  });
}

/** Botón "← Atrás" (mínimo 48 px) para la parte de arriba de toda hoja o pantalla secundaria. */
export function botonAtras(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-atras';
  b.textContent = '← Atrás';
  b.setAttribute('aria-label', 'Atrás');
  b.addEventListener('click', () => navegacion.atras());
  return b;
}

/** Pregunta de confirmación que también se cancela con el Atrás de Android. true = confirmó. */
export function confirmarAccion(mensaje: string, si: string, no = 'Cancelar'): Promise<boolean> {
  const d = dialogo(mensaje, si, no, true);
  const capa = navegacion.abrir({ cerrar: d.cancelar });
  return d.promesa.finally(() => capa.cerrar());
}
