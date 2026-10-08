/** Umbral para decidir que el teclado en pantalla está abierto (la barra de URL cambia ~56 px). */
export const UMBRAL_TECLADO_PX = 120;

export interface EntradaArea {
  /** Mayor alto de ventana visto con el mismo ancho (pantalla sin teclado). */
  alturaReferencia: number;
  /** Alto del viewport visual (`visualViewport.height`); null si el navegador no lo ofrece. */
  vvAlto: number | null;
  vvArriba: number;
  /** Zoom de pellizco; con zoom no se ajusta nada. */
  escala: number;
  /** Alto actual de la ventana (`innerHeight`). */
  alturaVentana: number;
}

export interface AreaVisible {
  /** Alto del área que el usuario realmente ve (sin teclado). */
  alto: number;
  /** Distancia desde el borde superior del viewport de diseño hasta el área visible. */
  arriba: number;
  tecladoAbierto: boolean;
}

/**
 * Calcula el área visible. Sirve en los dos modos de Chrome Android:
 * - `resizes-content`: el viewport de diseño ya se achicó (alturaVentana baja).
 * - `resizes-visual`: solo se achica el viewport visual (vvAlto baja).
 */
export function areaVisible(e: EntradaArea): AreaVisible {
  const sinAjuste: AreaVisible = { alto: e.alturaVentana, arriba: 0, tecladoAbierto: false };
  if (e.escala > 1.01) return sinAjuste;
  const alto = Math.round(Math.min(e.vvAlto ?? e.alturaVentana, e.alturaVentana));
  const arriba = Math.max(0, Math.round(e.vvArriba));
  return {
    alto,
    arriba,
    tecladoAbierto: e.alturaReferencia - alto > UMBRAL_TECLADO_PX,
  };
}
