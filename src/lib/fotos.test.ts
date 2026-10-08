import { describe, expect, it } from 'vitest';
import type { Foto, Gasto } from '../types';
import {
  aplicarCambioFoto,
  aplicarModoRecibo,
  CALIDADES,
  calcularDimensiones,
  comprimirHastaLimite,
  idsHuerfanos,
  LIMITE_BYTES,
  limpiarFotosHuerfanas,
  mensajeErrorAlmacenamiento,
  modoReciboActivo,
  recorteMiniatura,
  reducirDimensiones,
  textoInfoFoto,
  type FotoProcesada,
} from './fotos';
import { aplicarPellizco, limitarDesplazamiento, ZOOM_MAX } from './zoom';

const pixeles = (d: { ancho: number; alto: number }) => d.ancho * d.alto;
const blobDe = (bytes: number) => new Blob([new Uint8Array(bytes)]);

describe('calcularDimensiones', () => {
  it('recibo normal 3000×4000: ~2,5 MP, conserva la proporción y el lado corto ≥ 1000', () => {
    const d = calcularDimensiones(3000, 4000);
    expect(pixeles(d)).toBeLessThanOrEqual(2_500_000 * 1.001);
    expect(Math.min(d.ancho, d.alto)).toBeGreaterThanOrEqual(1000);
    expect(d.ancho / d.alto).toBeCloseTo(0.75, 2);
    expect(d).toEqual({ ancho: 1369, alto: 1826 });
  });
  it('recibo largo 1:4 (1500×6000): conserva el lado corto de 1000 aunque pase de 2,5 MP', () => {
    const d = calcularDimensiones(1500, 6000);
    expect(d).toEqual({ ancho: 1000, alto: 4000 });
    expect(pixeles(d)).toBeGreaterThan(2_500_000);
  });
  it('foto horizontal 4000×3000: se reduce a ~2,5 MP sin cambiar la orientación', () => {
    const d = calcularDimensiones(4000, 3000);
    expect(d.ancho).toBeGreaterThan(d.alto);
    expect(pixeles(d)).toBeLessThanOrEqual(2_500_000 * 1.001);
    expect(d.ancho / d.alto).toBeCloseTo(4 / 3, 2);
  });
  it('foto pequeña 800×600: no se amplía', () => {
    expect(calcularDimensiones(800, 600)).toEqual({ ancho: 800, alto: 600 });
  });
  it('si el lado corto original es menor a 1000 no se reduce por ese motivo ni se amplía', () => {
    expect(calcularDimensiones(700, 4000)).toEqual({ ancho: 700, alto: 4000 });
  });
  it('una tira larguísima no genera un lienzo gigante (tope de 8000 px de largo)', () => {
    const d = calcularDimensiones(1200, 24000);
    expect(d.alto).toBe(8000);
    expect(d.ancho).toBe(400);
  });
  it('nunca amplía', () => {
    for (const [a, h] of [
      [500, 500],
      [1000, 1000],
      [1200, 3000],
      [2000, 1000],
    ] as const) {
      const d = calcularDimensiones(a, h);
      expect(d.ancho).toBeLessThanOrEqual(a);
      expect(d.alto).toBeLessThanOrEqual(h);
    }
  });
});

describe('reducirDimensiones', () => {
  it('reduce en pasos de 15 % sin bajar del piso de lado corto', () => {
    expect(reducirDimensiones({ ancho: 1000, alto: 4000 }, 900)).toEqual({ ancho: 900, alto: 3600 });
    expect(reducirDimensiones({ ancho: 1369, alto: 1826 }, 900)).toEqual({ ancho: 1164, alto: 1552 });
  });
  it('devuelve null cuando ya está en el piso', () => {
    expect(reducirDimensiones({ ancho: 900, alto: 3600 }, 900)).toBeNull();
    expect(reducirDimensiones({ ancho: 700, alto: 4000 }, 700)).toBeNull();
  });
});

describe('comprimirHastaLimite (límite de 500 KB)', () => {
  const original = { ancho: 3000, alto: 4000 };
  /** Peso simulado: proporcional a los píxeles y a la calidad. */
  const simular = (bytesPorPixelAlta: number) => {
    const llamadas: { ancho: number; alto: number; calidad: number }[] = [];
    const codificar = async (ancho: number, alto: number, calidad: number) => {
      llamadas.push({ ancho, alto, calidad });
      return blobDe(Math.round(ancho * alto * bytesPorPixelAlta * (calidad / 0.7)));
    };
    return { llamadas, codificar };
  };

  it('el límite es 500 KB', () => {
    expect(LIMITE_BYTES).toBe(512_000);
  });
  it('la escala de calidad es 0,85 → 0,75 → 0,7 → 0,6', () => {
    expect(CALIDADES).toEqual([0.85, 0.75, 0.7, 0.6]);
  });
  it('si cabe al primer intento usa la calidad más alta (0,85) y el tamaño inicial', async () => {
    const { llamadas, codificar } = simular(0.1); // ~300 KB a 0,85
    const r = await comprimirHastaLimite(original, codificar);
    expect(llamadas).toHaveLength(1);
    expect(r.calidad).toBe(0.85);
    expect(r).toMatchObject({ ancho: 1369, alto: 1826, superaLimite: false });
    expect(r.blob.size).toBeLessThan(LIMITE_BYTES);
  });
  it('un peso exactamente igual al límite no cuenta como "menos de 500 KB"', async () => {
    const r = await comprimirHastaLimite(original, async () => blobDe(LIMITE_BYTES), LIMITE_BYTES);
    expect(r.superaLimite).toBe(true);
    const ok = await comprimirHastaLimite(original, async () => blobDe(LIMITE_BYTES - 1), LIMITE_BYTES);
    expect(ok.superaLimite).toBe(false);
  });
  it('baja la calidad solo lo necesario: usa la más alta que cabe', async () => {
    const { llamadas, codificar } = simular(0.19); // 0,85 → ~577 KB; 0,75 → ~509 KB
    const r = await comprimirHastaLimite(original, codificar);
    expect(llamadas.map((l) => l.calidad)).toEqual([0.85, 0.75]);
    expect(r.calidad).toBe(0.75);
    expect(r.superaLimite).toBe(false);
  });
  it('si no cabe antes, llega a 0,6 sin reducir la resolución', async () => {
    const { llamadas, codificar } = simular(0.23); // 0,7 → ~575 KB; 0,6 → ~493 KB
    const r = await comprimirHastaLimite(original, codificar);
    expect(llamadas.map((l) => l.calidad)).toEqual([0.85, 0.75, 0.7, 0.6]);
    expect(llamadas[1]).toMatchObject({ ancho: 1369, alto: 1826 });
    expect(r.calidad).toBe(0.6);
  });
  it('si aún no cabe, reduce la resolución en pasos', async () => {
    const { llamadas, codificar } = simular(0.3);
    const r = await comprimirHastaLimite(original, codificar);
    expect(r.superaLimite).toBe(false);
    expect(r.ancho).toBeLessThan(1369);
    expect(llamadas.length).toBeGreaterThan(2);
  });
  it('nunca baja de calidad 0,6 ni de 900 px de lado corto, y guarda la más pequeña si aun así pasa de 500 KB', async () => {
    const { llamadas, codificar } = simular(5); // imposible de cumplir
    const r = await comprimirHastaLimite(original, codificar);
    for (const l of llamadas) {
      expect(l.calidad).toBeGreaterThanOrEqual(0.6);
      expect(Math.min(l.ancho, l.alto)).toBeGreaterThanOrEqual(900);
    }
    expect(r.superaLimite).toBe(true);
    const minimo = Math.min(...llamadas.map((l) => l.ancho * l.alto * 5 * (l.calidad / 0.7)));
    expect(r.blob.size).toBe(Math.round(minimo));
    expect(Math.min(r.ancho, r.alto)).toBe(900);
    expect(r.calidad).toBe(0.6);
  });
  it('recibo largo 1:4: se prueba 1000×4000 y luego 900×3600, nunca menos', async () => {
    const { llamadas, codificar } = simular(5);
    await comprimirHastaLimite({ ancho: 1500, alto: 6000 }, codificar);
    const tamanos = [...new Set(llamadas.map((l) => `${l.ancho}×${l.alto}`))];
    expect(tamanos).toEqual(['1000×4000', '900×3600']);
  });
  it('foto pequeña (800×600) que pesa de más: se guarda igual, sin reducir ni ampliar', async () => {
    const { llamadas, codificar } = simular(5);
    const r = await comprimirHastaLimite({ ancho: 800, alto: 600 }, codificar);
    expect(new Set(llamadas.map((l) => `${l.ancho}×${l.alto}`))).toEqual(new Set(['800×600']));
    expect(r.superaLimite).toBe(true);
    expect(r.blob.size).toBeGreaterThan(0);
  });
});

describe('miniatura', () => {
  it('recorta un cuadrado desde arriba y al centro, de ~160 px', () => {
    expect(recorteMiniatura(1000, 4000)).toEqual({ sx: 0, sy: 0, lado: 1000, destino: 160 });
    expect(recorteMiniatura(4000, 3000)).toEqual({ sx: 500, sy: 0, lado: 3000, destino: 160 });
  });
  it('una foto pequeña no se amplía', () => {
    expect(recorteMiniatura(100, 300).destino).toBe(100);
  });
});

describe('modo recibo', () => {
  it('está activado salvo que Ajustes lo desactive explícitamente', () => {
    expect(modoReciboActivo(undefined)).toBe(true);
    expect(modoReciboActivo(true)).toBe(true);
    expect(modoReciboActivo(false)).toBe(false);
  });
  it('pasa a gris, sube un poco el contraste y no toca la transparencia', () => {
    const px = new Uint8ClampedArray([200, 100, 50, 255, 20, 20, 20, 128, 250, 250, 250, 255]);
    aplicarModoRecibo(px);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[3]).toBe(255);
    expect(px[7]).toBe(128);
    // Oscuro más oscuro, claro más claro (y recortado a 0-255).
    expect(px[4]!).toBeLessThan(20);
    expect(px[8]).toBe(255);
  });
});

describe('textos', () => {
  it('muestra peso y resolución como en el visor', () => {
    expect(textoInfoFoto(412 * 1024, 1080, 2310)).toBe('412 KB · 1080×2310');
    expect(textoInfoFoto(1.5 * 1024 * 1024, 10, 10)).toBe('1.5 MB · 10×10');
  });
  it('explica la falta de espacio en español', () => {
    const cuota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    expect(mensajeErrorAlmacenamiento(cuota)).toMatch(/espacio/);
    expect(mensajeErrorAlmacenamiento({ name: 'AbortError', inner: cuota })).toMatch(/espacio/);
    expect(mensajeErrorAlmacenamiento(new Error('otro fallo'))).toBe('otro fallo');
  });
});

// ---------- Edición: reemplazar / quitar ----------

const AHORA = new Date(2026, 9, 8, 10, 0);
const gasto = (p: Partial<Gasto> = {}): Gasto => ({
  id: 'g1',
  fecha: '2026-10-07T18:00:00.000Z',
  monto: 1000,
  moneda: 'COP',
  categoriaId: 'comida',
  cuentaId: 'personal',
  nota: '',
  fotoId: null,
  creadoEn: '2026-10-01T00:00:00.000Z',
  editadoEn: '2026-10-01T00:00:00.000Z',
  exportadoEn: null,
  ...p,
});
const procesada: FotoProcesada = { blob: blobDe(10), miniatura: blobDe(2), ancho: 1000, alto: 4000 };

describe('aplicarCambioFoto (edición)', () => {
  it('sin cambio de foto no toca nada', () => {
    const g = gasto({ fotoId: 'f1' });
    const r = aplicarCambioFoto(g, g, { tipo: 'ninguno' }, AHORA, () => 'nuevo');
    expect(r).toEqual({ gasto: g, fotoNueva: null, fotoABorrar: null, cambioFoto: false });
  });
  it('reemplazar: foto nueva con id nuevo, la vieja se marca para borrar al guardar y editadoEn se actualiza', () => {
    const g = gasto({ fotoId: 'vieja' });
    const r = aplicarCambioFoto(g, g, { tipo: 'reemplazar', foto: procesada }, AHORA, () => 'nueva');
    expect(r.gasto.fotoId).toBe('nueva');
    expect(r.gasto.editadoEn).toBe(AHORA.toISOString());
    expect(r.gasto.editadoEn).not.toBe(g.editadoEn);
    expect(r.fotoNueva).toMatchObject({ id: 'nueva', ancho: 1000, alto: 4000 });
    expect(r.fotoABorrar).toBe('vieja');
    expect(g.fotoId).toBe('vieja'); // el original no se modifica
  });
  it('agregar foto a un gasto sin foto: no hay nada que borrar', () => {
    const g = gasto();
    const r = aplicarCambioFoto(g, g, { tipo: 'reemplazar', foto: procesada }, AHORA, () => 'nueva');
    expect(r.fotoABorrar).toBeNull();
    expect(r.gasto.fotoId).toBe('nueva');
    expect(r.cambioFoto).toBe(true);
  });
  it('quitar: fotoId queda en null, se borra la vieja y editadoEn se actualiza', () => {
    const g = gasto({ fotoId: 'vieja' });
    const r = aplicarCambioFoto(g, g, { tipo: 'quitar' }, AHORA, () => 'x');
    expect(r.gasto.fotoId).toBeNull();
    expect(r.fotoNueva).toBeNull();
    expect(r.fotoABorrar).toBe('vieja');
    expect(r.gasto.editadoEn).toBe(AHORA.toISOString());
  });
  it('quitar en un gasto sin foto no cambia nada', () => {
    const g = gasto();
    expect(aplicarCambioFoto(g, g, { tipo: 'quitar' }, AHORA, () => 'x').cambioFoto).toBe(false);
  });
  it('conserva los demás cambios ya validados del gasto', () => {
    const original = gasto({ fotoId: 'vieja' });
    const validado = { ...original, monto: 2500, nota: 'cambiada' };
    const r = aplicarCambioFoto(validado, original, { tipo: 'quitar' }, AHORA, () => 'x');
    expect(r.gasto).toMatchObject({ monto: 2500, nota: 'cambiada', fotoId: null });
  });
});

// ---------- Limpieza de fotos huérfanas ----------

describe('limpiarFotosHuerfanas', () => {
  const foto = (id: string): Foto => ({ id, blob: blobDe(1), ancho: 1, alto: 1 });
  function entorno(fotos: string[], gastos: Gasto[]) {
    const guardadas = new Map(fotos.map((id) => [id, foto(id)]));
    return {
      guardadas,
      repo: {
        leer: async () => ({
          fotos: [...guardadas.keys()],
          enUso: gastos.flatMap((g) => (g.fotoId ? [g.fotoId] : [])),
        }),
        borrar: async (ids: string[]) => void ids.forEach((id) => guardadas.delete(id)),
      },
    };
  }
  it('borra solo las fotos sin gasto asociado', async () => {
    const { guardadas, repo } = entorno(['a', 'b', 'c'], [gasto({ id: '1', fotoId: 'a' }), gasto({ id: '2' })]);
    expect(await limpiarFotosHuerfanas(repo)).toBe(2);
    expect([...guardadas.keys()]).toEqual(['a']);
  });
  it('no borra nada si todas las fotos están en uso o no hay fotos', async () => {
    const uno = entorno(['a'], [gasto({ fotoId: 'a' })]);
    expect(await limpiarFotosHuerfanas(uno.repo)).toBe(0);
    expect(uno.guardadas.size).toBe(1);
    expect(await limpiarFotosHuerfanas(entorno([], []).repo)).toBe(0);
  });
  it('idsHuerfanos ignora referencias nulas', () => {
    expect(idsHuerfanos(['a', 'b'], [null, 'a'])).toEqual(['b']);
  });
});

// ---------- Zoom del visor ----------

describe('zoom del visor', () => {
  it('el pellizco mantiene bajo los dedos el mismo punto de la imagen', () => {
    const v = aplicarPellizco({ escala: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, { x: 100, y: 50 });
    expect(v).toEqual({ escala: 2, x: -100, y: -50 });
  });
  it('limita el zoom máximo y no baja de 1', () => {
    expect(aplicarPellizco({ escala: 5, x: 0, y: 0 }, 10, { x: 0, y: 0 }, { x: 0, y: 0 }).escala).toBe(ZOOM_MAX);
    expect(aplicarPellizco({ escala: 1.5, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }, { x: 0, y: 0 }).escala).toBe(1);
  });
  it('sin zoom la imagen queda centrada; con zoom no se sale del visor', () => {
    expect(limitarDesplazamiento({ escala: 1, x: 40, y: 40 }, 400, 800, 400, 700)).toEqual({ escala: 1, x: 0, y: 0 });
    const v = limitarDesplazamiento({ escala: 2, x: 9999, y: -9999 }, 400, 800, 400, 700);
    expect(v.x).toBe(200); // (400*2 - 400) / 2
    expect(v.y).toBe(-300); // (700*2 - 800) / 2
  });
});
