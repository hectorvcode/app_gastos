import { describe, expect, it } from 'vitest';
import type { Gasto } from '../types';
import {
  barrasPorCategoria,
  monedaPrincipal,
  textoPorcentaje,
  textoVariacion,
  totalesDelMes,
  variacion,
} from './resumen';

const gasto = (monto: number, moneda: string, categoriaId: string, extra: Partial<Gasto> = {}): Gasto => ({
  id: `${Math.random()}`,
  fecha: '2026-10-05T12:00:00.000Z',
  monto,
  moneda,
  categoriaId,
  cuentaId: 'personal',
  nota: '',
  fotoId: null,
  creadoEn: '2026-10-05T12:00:00.000Z',
  editadoEn: '2026-10-05T12:00:00.000Z',
  exportadoEn: null,
  ...extra,
});

const categorias = [
  { id: 'comida', nombre: 'Comida', emoji: '🍽️' },
  { id: 'hogar', nombre: 'Hogar', emoji: '🏠' },
  { id: 'ocio', nombre: 'Ocio', emoji: '🎉' },
];

describe('totales del mes por moneda', () => {
  it('suma por moneda sin convertir, con la cantidad de gastos', () => {
    const t = totalesDelMes(
      [gasto(1000, 'COP', 'comida'), gasto(2500, 'COP', 'hogar'), gasto(12.5, 'USD', 'ocio'), gasto(7.25, 'USD', 'ocio')],
      [],
    );
    expect(t.map((x) => [x.moneda, x.total, x.cantidad])).toEqual([
      ['COP', 3500, 2],
      ['USD', 19.75, 2],
    ]);
  });

  it('redondea a centavos (sin errores de coma flotante)', () => {
    const t = totalesDelMes([gasto(0.1, 'USD', 'comida'), gasto(0.2, 'USD', 'comida')], []);
    expect(t[0]!.total).toBe(0.3);
  });

  it('compara cada moneda con la misma moneda del mes anterior', () => {
    const t = totalesDelMes(
      [gasto(1120, 'COP', 'comida'), gasto(50, 'USD', 'comida')],
      [gasto(1000, 'COP', 'comida'), gasto(999, 'EUR', 'comida')],
    );
    expect(t.find((x) => x.moneda === 'COP')!.variacion).toEqual({ tipo: 'sube', porcentaje: 12 });
    expect(t.find((x) => x.moneda === 'USD')!.variacion).toEqual({ tipo: 'sin-anterior' });
    expect(t.find((x) => x.moneda === 'EUR')).toBeUndefined(); // lo que no se gastó este mes no aparece
  });

  it('sin gastos en el mes no hay totales', () => {
    expect(totalesDelMes([], [gasto(5, 'COP', 'comida')])).toEqual([]);
  });
});

describe('variación frente al mes anterior', () => {
  it('sube, baja e igual, en porcentaje entero', () => {
    expect(variacion(112, 100)).toEqual({ tipo: 'sube', porcentaje: 12 });
    expect(variacion(80, 100)).toEqual({ tipo: 'baja', porcentaje: 20 });
    expect(variacion(100, 100)).toEqual({ tipo: 'igual' });
    expect(variacion(200, 100)).toEqual({ tipo: 'sube', porcentaje: 100 });
    expect(variacion(1, 3)).toEqual({ tipo: 'baja', porcentaje: 67 });
  });

  it('con el mes anterior en cero no divide por cero', () => {
    expect(variacion(500, 0)).toEqual({ tipo: 'sin-anterior' });
    expect(variacion(0, 0)).toEqual({ tipo: 'sin-anterior' });
    expect(Number.isFinite((variacion(500, 0) as { porcentaje?: number }).porcentaje ?? 0)).toBe(true);
  });

  it('el texto usa flechas y el nombre del mes anterior', () => {
    expect(textoVariacion({ tipo: 'sube', porcentaje: 12 }, 'septiembre')).toBe('↑ 12 % vs septiembre');
    expect(textoVariacion({ tipo: 'baja', porcentaje: 8 }, 'septiembre')).toBe('↓ 8 % vs septiembre');
    expect(textoVariacion({ tipo: 'igual' }, 'septiembre')).toBe('= igual que septiembre');
    expect(textoVariacion({ tipo: 'sin-anterior' }, 'septiembre')).toBe('Sin gastos en septiembre para comparar');
    expect(textoVariacion(variacion(100.4, 100), 'agosto')).toBe('↑ <1 % vs agosto');
  });
});

describe('barras por categoría', () => {
  const gastos = [
    gasto(30000, 'COP', 'comida'),
    gasto(10000, 'COP', 'comida'),
    gasto(40000, 'COP', 'hogar'),
    gasto(20000, 'COP', 'ocio'),
    gasto(99, 'USD', 'ocio'),
  ];

  it('ordena de mayor a menor y calcula el porcentaje de la moneda', () => {
    const b = barrasPorCategoria(gastos, 'COP', categorias);
    expect(b.map((x) => [x.nombre, x.total, x.cantidad])).toEqual([
      ['Comida', 40000, 2],
      ['Hogar', 40000, 1],
      ['Ocio', 20000, 1],
    ]);
    expect(b.map((x) => x.porcentaje)).toEqual([40, 40, 20]);
    expect(b.reduce((s, x) => s + x.porcentaje, 0)).toBeCloseTo(100);
  });

  it('a igual monto desempata por nombre y ordena de mayor a menor', () => {
    const b = barrasPorCategoria([gasto(5, 'COP', 'ocio'), gasto(5, 'COP', 'comida'), gasto(9, 'COP', 'hogar')], 'COP', categorias);
    expect(b.map((x) => x.nombre)).toEqual(['Hogar', 'Comida', 'Ocio']);
  });

  it('solo cuenta la moneda pedida', () => {
    const b = barrasPorCategoria(gastos, 'USD', categorias);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ nombre: 'Ocio', total: 99, porcentaje: 100 });
  });

  it('una categoría borrada o desconocida aparece como "Sin categoría"', () => {
    const b = barrasPorCategoria([gasto(1, 'COP', 'borrada')], 'COP', categorias);
    expect(b[0]).toMatchObject({ categoriaId: 'borrada', nombre: 'Sin categoría' });
  });

  it('sin gastos en esa moneda no hay barras', () => {
    expect(barrasPorCategoria(gastos, 'EUR', categorias)).toEqual([]);
  });

  it('el porcentaje se muestra entero, o "<1 %" si es muy pequeño', () => {
    expect(textoPorcentaje(40)).toBe('40 %');
    expect(textoPorcentaje(33.333)).toBe('33 %');
    expect(textoPorcentaje(0.4)).toBe('<1 %');
    expect(textoPorcentaje(100)).toBe('100 %');
  });
});

describe('moneda por defecto de las barras', () => {
  it('es la que tiene más gastos en el mes (no se pueden comparar montos sin convertir)', () => {
    const t = totalesDelMes(
      [gasto(500000, 'COP', 'comida'), gasto(10, 'USD', 'comida'), gasto(20, 'USD', 'comida'), gasto(30, 'USD', 'comida')],
      [],
    );
    expect(monedaPrincipal(t)).toBe('USD');
  });

  it('si empatan en cantidad, la de mayor total', () => {
    const t = totalesDelMes([gasto(500000, 'COP', 'comida'), gasto(10, 'USD', 'comida')], []);
    expect(monedaPrincipal(t)).toBe('COP');
  });

  it('sin totales no hay moneda', () => {
    expect(monedaPrincipal([])).toBeNull();
  });
});
