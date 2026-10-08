import { describe, expect, it } from 'vitest';
import {
  decidirOrientacion,
  dimensionesOrientadas,
  leerInfoJpeg,
  matrizOrientacion,
  textoDiagnosticoExif,
  type InfoJpeg,
} from './exif';

/** Arma un JPEG mínimo: SOI + APP1 (EXIF con orientación) + SOF0 con las dimensiones + SOS. */
function jpeg(orientacion: number | null, ancho: number, alto: number, little = true): Uint8Array {
  const partes: number[] = [0xff, 0xd8];
  if (orientacion !== null) {
    const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
    const u32 = (n: number) =>
      little ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    const tiff = [
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(0x2a),
      ...u32(8),
      ...u16(1), // una entrada
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(orientacion),
      0,
      0,
      ...u32(0),
    ];
    const cuerpo = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    partes.push(0xff, 0xe1, (cuerpo.length + 2) >> 8, (cuerpo.length + 2) & 0xff, ...cuerpo);
  }
  partes.push(0xff, 0xc0, 0, 17, 8, alto >> 8, alto & 0xff, ancho >> 8, ancho & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  partes.push(0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0);
  return new Uint8Array(partes);
}

describe('leerInfoJpeg', () => {
  it.each([1, 3, 6, 8])('lee la orientación %i y las dimensiones guardadas (little y big endian)', (o) => {
    for (const little of [true, false]) {
      expect(leerInfoJpeg(jpeg(o, 4000, 3000, little))).toEqual({ orientacion: o, ancho: 4000, alto: 3000 });
    }
  });
  it('sin EXIF la orientación es 1 y aun así lee las dimensiones', () => {
    expect(leerInfoJpeg(jpeg(null, 1200, 800))).toEqual({ orientacion: 1, ancho: 1200, alto: 800 });
  });
  it('un archivo que no es JPEG o está truncado no lanza y da orientación 1', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(leerInfoJpeg(png)).toEqual({ orientacion: 1, ancho: null, alto: null });
    expect(leerInfoJpeg(new Uint8Array())).toEqual({ orientacion: 1, ancho: null, alto: null });
    expect(leerInfoJpeg(jpeg(6, 4000, 3000).slice(0, 12)).orientacion).toBe(1);
  });
  it('ignora valores de orientación fuera de 1-8', () => {
    expect(leerInfoJpeg(jpeg(9, 4000, 3000)).orientacion).toBe(1);
  });
});

describe('dimensiones según la orientación EXIF (archivo crudo 4000×3000)', () => {
  it.each([
    [1, 4000, 3000],
    [3, 4000, 3000],
    [6, 3000, 4000],
    [8, 3000, 4000],
  ])('orientación %i → %i×%i', (o, ancho, alto) => {
    expect(dimensionesOrientadas(4000, 3000, o)).toEqual({ ancho, alto });
  });
});

describe('matrizOrientacion', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('la orientación %i deja las esquinas dentro de la imagen orientada', (o) => {
    const [a, b, c, d, e, f] = matrizOrientacion(o, 4000, 3000);
    const { ancho, alto } = dimensionesOrientadas(4000, 3000, o);
    for (const [x, y] of [
      [0, 0],
      [4000, 0],
      [0, 3000],
      [4000, 3000],
    ] as const) {
      const xp = a * x + c * y + e;
      const yp = b * x + d * y + f;
      expect(xp).toBeGreaterThanOrEqual(0);
      expect(xp).toBeLessThanOrEqual(ancho);
      expect(yp).toBeGreaterThanOrEqual(0);
      expect(yp).toBeLessThanOrEqual(alto);
    }
  });
  it('6 gira 90° a la derecha, 8 a la izquierda y 3 media vuelta', () => {
    const aplicar = (o: number, x: number, y: number) => {
      const [a, b, c, d, e, f] = matrizOrientacion(o, 4000, 3000);
      return [a * x + c * y + e, b * x + d * y + f];
    };
    expect(aplicar(6, 0, 0)).toEqual([3000, 0]); // esquina superior izquierda → superior derecha
    expect(aplicar(8, 0, 0)).toEqual([0, 4000]); // → inferior izquierda
    expect(aplicar(3, 0, 0)).toEqual([4000, 3000]); // → inferior derecha
    expect(aplicar(1, 123, 45)).toEqual([123, 45]);
  });
});

describe('decidirOrientacion: se aplica una sola vez', () => {
  const info = (o: number, ancho = 4000, alto = 3000): InfoJpeg => ({ orientacion: o, ancho, alto });

  it('orientación 1: la app no hace nada', () => {
    expect(decidirOrientacion(info(1), { ancho: 4000, alto: 3000 }, 'bitmap-sin-orientar')).toEqual({ aplicar: 1, quien: 'nadie' });
  });
  it('foto horizontal con EXIF 6 y decodificador que no orienta: la app la gira y queda vertical', () => {
    const d = decidirOrientacion(info(6), { ancho: 4000, alto: 3000 }, 'bitmap-sin-orientar');
    expect(d).toEqual({ aplicar: 6, quien: 'app' });
    expect(dimensionesOrientadas(4000, 3000, d.aplicar)).toEqual({ ancho: 3000, alto: 4000 });
  });
  it('si el navegador ya la orientó (dimensiones intercambiadas), la app NO la gira otra vez', () => {
    for (const metodo of ['bitmap-sin-orientar', 'img'] as const) {
      const d = decidirOrientacion(info(6), { ancho: 3000, alto: 4000 }, metodo);
      expect(d).toEqual({ aplicar: 1, quien: 'navegador' });
      expect(dimensionesOrientadas(3000, 4000, d.aplicar)).toEqual({ ancho: 3000, alto: 4000 });
    }
  });
  it('orientación 8 con el mismo criterio', () => {
    expect(decidirOrientacion(info(8), { ancho: 4000, alto: 3000 }, 'img').aplicar).toBe(8);
    expect(decidirOrientacion(info(8), { ancho: 3000, alto: 4000 }, 'img').aplicar).toBe(1);
  });
  it('orientación 3 no cambia las dimensiones: se confía en el método de lectura', () => {
    expect(decidirOrientacion(info(3), { ancho: 4000, alto: 3000 }, 'bitmap-sin-orientar')).toEqual({ aplicar: 3, quien: 'app' });
    expect(decidirOrientacion(info(3), { ancho: 4000, alto: 3000 }, 'img')).toEqual({ aplicar: 1, quien: 'navegador' });
  });
  it('imagen cuadrada con EXIF 6: no se puede detectar por dimensiones, se confía en el método', () => {
    expect(decidirOrientacion(info(6, 2000, 2000), { ancho: 2000, alto: 2000 }, 'bitmap-sin-orientar').aplicar).toBe(6);
    expect(decidirOrientacion(info(6, 2000, 2000), { ancho: 2000, alto: 2000 }, 'img').aplicar).toBe(1);
  });
  it('sin dimensiones del archivo (no JPEG) se confía en el método', () => {
    const sin: InfoJpeg = { orientacion: 6, ancho: null, alto: null };
    expect(decidirOrientacion(sin, { ancho: 4000, alto: 3000 }, 'bitmap-sin-orientar').aplicar).toBe(6);
  });
  it.each([
    [1, 4000, 3000],
    [3, 4000, 3000],
    [6, 3000, 4000],
    [8, 3000, 4000],
  ])('resultado final con EXIF %i: %i×%i, orientando una sola vez con cualquier decodificador', (o, ancho, alto) => {
    const buscado = { ancho, alto };
    // Decodificador que no orienta
    const crudo = { ancho: 4000, alto: 3000 };
    const a = decidirOrientacion(info(o), crudo, 'bitmap-sin-orientar');
    expect(dimensionesOrientadas(crudo.ancho, crudo.alto, a.aplicar)).toEqual(buscado);
    // Decodificador que ya orientó (<img>)
    const yaOrientado = dimensionesOrientadas(4000, 3000, o);
    const b = decidirOrientacion(info(o), yaOrientado, 'img');
    expect(dimensionesOrientadas(yaOrientado.ancho, yaOrientado.alto, b.aplicar)).toEqual(buscado);
  });
});

describe('textoDiagnosticoExif', () => {
  it('indica la orientación y quién la aplicó', () => {
    expect(textoDiagnosticoExif({ orientacion: 6, ancho: 1, alto: 2 }, { aplicar: 6, quien: 'app' })).toBe('EXIF 6 · app');
    expect(textoDiagnosticoExif({ orientacion: 6, ancho: 1, alto: 2 }, { aplicar: 1, quien: 'navegador' })).toBe('EXIF 6 · navegador');
    expect(textoDiagnosticoExif({ orientacion: 1, ancho: 1, alto: 2 }, { aplicar: 1, quien: 'nadie' })).toBe('EXIF 1');
  });
});
