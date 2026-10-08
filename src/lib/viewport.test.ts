import { describe, expect, it } from 'vitest';
import { areaVisible, type EntradaArea } from './viewport';

const base: EntradaArea = {
  alturaReferencia: 780,
  alturaVentana: 780,
  vvAlto: 780,
  vvArriba: 0,
  escala: 1,
};

describe('areaVisible', () => {
  it('sin teclado: toda la ventana', () => {
    expect(areaVisible(base)).toEqual({ alto: 780, arriba: 0, tecladoAbierto: false });
  });
  it('resizes-visual: solo se achica el viewport visual', () => {
    expect(areaVisible({ ...base, vvAlto: 470 })).toEqual({ alto: 470, arriba: 0, tecladoAbierto: true });
  });
  it('resizes-content: se achica la ventana completa', () => {
    expect(areaVisible({ ...base, alturaVentana: 470, vvAlto: 470 })).toEqual({
      alto: 470,
      arriba: 0,
      tecladoAbierto: true,
    });
  });
  it('respeta el desplazamiento del viewport visual', () => {
    expect(areaVisible({ ...base, vvAlto: 470, vvArriba: 40 }).arriba).toBe(40);
    expect(areaVisible({ ...base, vvAlto: 470, vvArriba: -3 }).arriba).toBe(0);
  });
  it('la barra de URL (≈56 px) no cuenta como teclado', () => {
    expect(areaVisible({ ...base, alturaVentana: 724, vvAlto: 724 }).tecladoAbierto).toBe(false);
  });
  it('sin visualViewport usa la ventana', () => {
    expect(areaVisible({ ...base, vvAlto: null })).toEqual({ alto: 780, arriba: 0, tecladoAbierto: false });
  });
  it('con zoom de pellizco no ajusta nada', () => {
    expect(areaVisible({ ...base, vvAlto: 300, escala: 2 })).toEqual({ alto: 780, arriba: 0, tecladoAbierto: false });
  });
  it('nunca supera la altura de la ventana', () => {
    expect(areaVisible({ ...base, vvAlto: 900 }).alto).toBe(780);
  });
});
