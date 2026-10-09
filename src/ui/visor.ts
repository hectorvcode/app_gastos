import { textoInfoFoto } from '../lib/fotos';
import { botonAtras, navegacion } from './navegacion';
import { aplicarPellizco, centrar, limitarDesplazamiento, type Vista } from '../lib/zoom';

/**
 * Visor de foto a pantalla completa: zoom de pellizco (y rueda / doble toque), arrastre con zoom
 * y botón "← Atrás" (también cierra con el Atrás de Android). Muestra peso y resolución en letra pequeña.
 * Libera la URL al cerrar.
 */
export function abrirVisor(blob: Blob, ancho: number, alto: number): void {
  const url = URL.createObjectURL(blob);
  const visor = document.createElement('div');
  visor.className = 'visor';
  visor.setAttribute('role', 'dialog');
  visor.setAttribute('aria-label', 'Foto del recibo');

  const escenario = document.createElement('div');
  escenario.className = 'visor-escenario';
  const img = document.createElement('img');
  img.className = 'visor-img';
  img.alt = 'Foto del recibo';
  img.draggable = false;
  img.src = url;
  escenario.append(img);

  const cerrar = botonAtras();
  cerrar.classList.add('visor-cerrar');

  const info = document.createElement('p');
  info.className = 'visor-info';
  info.textContent = textoInfoFoto(blob.size, ancho, alto);

  visor.append(escenario, cerrar, info);
  document.body.append(visor);

  let v: Vista = { escala: 1, x: 0, y: 0 };
  const medidas = (): { w: number; h: number; iw: number; ih: number } => ({
    w: escenario.clientWidth,
    h: escenario.clientHeight,
    iw: img.clientWidth,
    ih: img.clientHeight,
  });
  const pintar = (): void => {
    const m = medidas();
    v = limitarDesplazamiento(v, m.w, m.h, m.iw, m.ih);
    img.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.escala})`;
  };

  // ---- Punteros: 1 = arrastrar, 2 = pellizcar ----
  const punteros = new Map<number, { x: number; y: number }>();
  let distanciaPrevia = 0;
  let ultimoToque = 0;

  const centroDe = (): { x: number; y: number } => {
    const r = escenario.getBoundingClientRect();
    const [a, b] = [...punteros.values()];
    const cx = b ? (a!.x + b.x) / 2 : a!.x;
    const cy = b ? (a!.y + b.y) / 2 : a!.y;
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };

  escenario.addEventListener('pointerdown', (e) => {
    escenario.setPointerCapture?.(e.pointerId);
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      distanciaPrevia = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
    if (punteros.size === 1) {
      const ahora = Date.now();
      if (ahora - ultimoToque < 300) {
        // Doble toque: alterna entre ajustado y 2.5x en ese punto.
        const r = escenario.getBoundingClientRect();
        const p = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
        v = v.escala > 1 ? centrar() : aplicarPellizco(v, 2.5, p, p);
        pintar();
      }
      ultimoToque = ahora;
    }
  });

  escenario.addEventListener('pointermove', (e) => {
    const previo = punteros.get(e.pointerId);
    if (!previo) return;
    const antes = centroDe();
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const despues = centroDe();
    if (punteros.size >= 2) {
      const [a, b] = [...punteros.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (distanciaPrevia > 0) v = aplicarPellizco(v, d / distanciaPrevia, antes, despues);
      distanciaPrevia = d;
      pintar();
    } else if (v.escala > 1) {
      v = { ...v, x: v.x + (despues.x - antes.x), y: v.y + (despues.y - antes.y) };
      pintar();
    }
  });

  const soltar = (e: PointerEvent): void => {
    punteros.delete(e.pointerId);
    distanciaPrevia = 0;
  };
  escenario.addEventListener('pointerup', soltar);
  escenario.addEventListener('pointercancel', soltar);

  // Rueda del ratón (laptop, nivel 1).
  escenario.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = escenario.getBoundingClientRect();
      const p = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
      v = aplicarPellizco(v, e.deltaY < 0 ? 1.2 : 1 / 1.2, p, p);
      pintar();
    },
    { passive: false },
  );

  let cerrado = false;
  const capa = navegacion.abrir({ cerrar: cerrarVisor });
  function cerrarVisor(): void {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alTeclear);
    img.removeAttribute('src');
    URL.revokeObjectURL(url);
    visor.remove();
  }
  function alTeclear(e: KeyboardEvent): void {
    if (e.key === 'Escape') capa.cerrar();
  }
  document.addEventListener('keydown', alTeclear);
  img.addEventListener('error', () => {
    // El blob no se pudo mostrar: se avisa en el propio visor y se puede cerrar.
    info.textContent = 'No se pudo mostrar la foto.';
  });
  cerrar.focus();
}
