import { describe, expect, it, vi } from 'vitest';
import type { Gasto } from '../types';
import { dateKey } from './dates';
import type { Key } from './money';
import { aplicarTeclaFisica, SesionRegistro } from './registro';

function crear(moneda = 'COP') {
  const guardados = new Map<string, Gasto>();
  let ahora = new Date(2026, 9, 7, 13, 42); // 7 oct 2026
  let n = 0;
  const sesion = new SesionRegistro(
    moneda,
    {
      add: async (g) => void guardados.set(g.id, g),
      delete: async (id) => void guardados.delete(id),
    },
    () => ahora,
    () => `id-${++n}`,
  );
  return { sesion, guardados, avanzar: (ms: number) => (ahora = new Date(ahora.getTime() + ms)) };
}

const mouse = (s: SesionRegistro, digitos: string) =>
  [...digitos].forEach((d) => s.pulsar(d as Key));
const teclado = (s: SesionRegistro, digitos: string) =>
  [...digitos].forEach((d) => expect(aplicarTeclaFisica(s, d)).toBe('monto'));

function resumen(guardados: Map<string, Gasto>) {
  return [...guardados.values()].map((g) => ({
    fecha: dateKey(new Date(g.fecha)),
    monto: g.monto,
    categoriaId: g.categoriaId,
  }));
}

describe('registro rápido de dos gastos seguidos', () => {
  for (const [nombre, escribir] of [
    ['con mouse (teclado en pantalla)', mouse],
    ['con teclado físico', teclado],
  ] as const) {
    it(`Ayer 78000 Salud y luego 05 oct 90000 Transporte ${nombre}`, async () => {
      const { sesion, guardados } = crear();

      sesion.elegirDiasAtras(1); // Ayer = 06 oct
      escribir(sesion, '78000');
      const r1 = await sesion.guardar('salud');
      expect(r1.ok).toBe(true);
      expect(sesion.entry).toBe('');

      sesion.elegirDiasAtras(2); // Antier = 05 oct
      escribir(sesion, '90000');
      const r2 = await sesion.guardar('transporte');
      expect(r2.ok).toBe(true);

      expect(guardados.size).toBe(2);
      expect(resumen(guardados)).toEqual([
        { fecha: '2026-10-06', monto: 78000, categoriaId: 'salud' },
        { fecha: '2026-10-05', monto: 90000, categoriaId: 'transporte' },
      ]);
      const [a, b] = [...guardados.values()];
      expect(a?.id).not.toBe(b?.id);
    });
  }

  it('un segundo toque inmediato en la categoría no repite el gasto', async () => {
    const { sesion, guardados } = crear();
    mouse(sesion, '78000');
    const [r1, r2] = await Promise.all([sesion.guardar('salud'), sesion.guardar('salud')]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(guardados.size).toBe(1);
  });
});

describe('teclado físico', () => {
  it('Enter por sí solo no guarda: pide a la pantalla ejecutar Guardar', async () => {
    const { sesion, guardados } = crear();
    expect(aplicarTeclaFisica(sesion, 'Enter')).toBe('guardar');
    teclado(sesion, '45000');
    expect(aplicarTeclaFisica(sesion, 'Enter')).toBe('guardar');
    expect(guardados.size).toBe(0);
    expect(sesion.entry).toBe('45000');
  });

  it('Backspace borra y otras teclas no se consumen', () => {
    const { sesion } = crear();
    teclado(sesion, '123');
    expect(aplicarTeclaFisica(sesion, 'Backspace')).toBe('monto');
    expect(sesion.entry).toBe('12');
    expect(aplicarTeclaFisica(sesion, 'a')).toBeNull();
    expect(aplicarTeclaFisica(sesion, 'Tab')).toBeNull();
  });

  it('punto y coma sirven como decimal solo en monedas con decimales', () => {
    const usd = crear('USD').sesion;
    teclado(usd, '12');
    aplicarTeclaFisica(usd, ',');
    teclado(usd, '5');
    expect(usd.entry).toBe('12.5');
    const cop = crear('COP').sesion;
    teclado(cop, '12');
    aplicarTeclaFisica(cop, '.');
    expect(cop.entry).toBe('12');
  });
});

describe('fallos al guardar', () => {
  it('si la base de datos falla conserva el monto y propaga el error', async () => {
    const sesion = new SesionRegistro('COP', {
      add: async () => {
        throw new Error('disco lleno');
      },
      delete: async () => {},
    });
    mouse(sesion, '45000');
    await expect(sesion.guardar('comida')).rejects.toThrow('disco lleno');
    expect(sesion.entry).toBe('45000');
    await sesion.deshacer(); // no queda nada que deshacer ni se rompe
  });

  it('si no se puede generar el id conserva el monto', async () => {
    const sesion = new SesionRegistro(
      'COP',
      { add: async () => {}, delete: async () => {} },
      () => new Date(),
      () => {
        throw new TypeError('crypto.randomUUID is not a function');
      },
    );
    mouse(sesion, '45000');
    await expect(sesion.guardar('comida')).rejects.toThrow('randomUUID');
    expect(sesion.entry).toBe('45000');
  });

  it('guarda con el UUID de respaldo cuando no hay crypto.randomUUID', async () => {
    const guardados = new Map<string, Gasto>();
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    try {
      const sesion = new SesionRegistro('COP', {
        add: async (g) => void guardados.set(g.id, g),
        delete: async () => {},
      });
      mouse(sesion, '45000');
      expect((await sesion.guardar('comida')).ok).toBe(true);
      expect([...guardados.keys()][0]).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('fecha y deshacer', () => {
  it('con monto 0 no guarda', async () => {
    const { sesion, guardados } = crear();
    expect((await sesion.guardar('comida')).ok).toBe(false);
    expect(guardados.size).toBe(0);
  });

  it('no acepta fechas futuras', () => {
    const { sesion } = crear();
    sesion.elegirFecha('2026-10-08');
    expect(sesion.fechaActual).toBe('2026-10-07');
  });

  it('la fecha elegida se mantiene entre gastos y vuelve a Hoy tras 10 minutos', async () => {
    const { sesion, avanzar } = crear();
    sesion.elegirDiasAtras(2);
    mouse(sesion, '1000');
    await sesion.guardar('comida');
    expect(sesion.fechaActual).toBe('2026-10-05');
    avanzar(9 * 60 * 1000);
    expect(sesion.fechaActual).toBe('2026-10-05');
    avanzar(2 * 60 * 1000);
    expect(sesion.fechaActual).toBe('2026-10-07');
  });

  it('deshacer elimina solo el último gasto', async () => {
    const { sesion, guardados } = crear();
    mouse(sesion, '100');
    await sesion.guardar('comida');
    mouse(sesion, '200');
    await sesion.guardar('hogar');
    await sesion.deshacer();
    expect([...guardados.values()].map((g) => g.monto)).toEqual([100]);
    await sesion.deshacer(); // ya no hay nada que deshacer
    expect(guardados.size).toBe(1);
  });
});
