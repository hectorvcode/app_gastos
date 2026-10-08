/** Estado del zoom del visor: escala y desplazamiento (px) respecto al centro. */
export interface Vista {
  escala: number;
  x: number;
  y: number;
}

export interface Punto {
  x: number;
  y: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

export const centrar = (): Vista => ({ escala: 1, x: 0, y: 0 });

const limitar = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/**
 * Aplica un factor de pellizco. `desde` es el punto (relativo al centro del visor) que el usuario
 * tenía bajo los dedos y `hasta` donde está ahora: el contenido bajo los dedos los sigue.
 */
export function aplicarPellizco(v: Vista, factor: number, desde: Punto, hasta: Punto): Vista {
  const escala = limitar(v.escala * factor, ZOOM_MIN, ZOOM_MAX);
  const real = escala / v.escala;
  return {
    escala,
    x: hasta.x - (desde.x - v.x) * real,
    y: hasta.y - (desde.y - v.y) * real,
  };
}

/**
 * Evita que la imagen se salga del visor: con zoom, el desplazamiento llega hasta el borde de la
 * imagen ampliada; sin zoom, queda centrada.
 */
export function limitarDesplazamiento(v: Vista, anchoVisor: number, altoVisor: number, anchoImg: number, altoImg: number): Vista {
  if (v.escala <= ZOOM_MIN) return centrar();
  const maxX = Math.max(0, (anchoImg * v.escala - anchoVisor) / 2);
  const maxY = Math.max(0, (altoImg * v.escala - altoVisor) / 2);
  return { escala: v.escala, x: limitar(v.x, -maxX, maxX), y: limitar(v.y, -maxY, maxY) };
}
