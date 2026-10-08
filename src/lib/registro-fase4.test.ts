import { describe, expect, it } from 'vitest';
import type { Gasto } from '../types';
import type { Key } from './money';
import { MAX_NOTA } from './nota';
import { SesionRegistro } from './registro';

function crear(moneda = 'COP') {
  const guardados = new Map<string, Gasto>();
  let n = 0;
  const sesion = new SesionRegistro(
    moneda,
    {
      add: async (g) => void guardados.set(g.id, g),
      delete: async (id) => void guardados.delete(id),
    },
    () => new Date(2026, 9, 7, 13, 42),
    () => `id-${++n}`,
  );
  return { sesion, guardados };
}

const teclear = (s: SesionRegistro, digitos: string) => [...digitos].forEach((d) => s.pulsar(d as Key));

describe('moneda en Registrar', () => {
  it('cambiar a COP con decimales trunca, informa lo descartado y se puede deshacer', () => {
    const { sesion } = crear('USD');
    teclear(sesion, '12');
    sesion.pulsar('.');
    teclear(sesion, '75');
    expect(sesion.entry).toBe('12.75');
    const cambio = sesion.cambiarMoneda('COP');
    expect(cambio?.descartados).toBe('75');
    expect(sesion.moneda).toBe('COP');
    expect(sesion.entry).toBe('12');
    sesion.restaurarMoneda(cambio!.previa);
    expect(sesion.moneda).toBe('USD');
    expect(sesion.entry).toBe('12.75');
  });
  it('de COP a USD conserva el monto; la misma moneda no hace nada', () => {
    const { sesion } = crear('COP');
    teclear(sesion, '45000');
    expect(sesion.cambiarMoneda('COP')).toBeNull();
    expect(sesion.cambiarMoneda('USD')?.descartados).toBe('');
    expect(sesion.entry).toBe('45000');
  });
  it('el gasto se guarda en la moneda elegida, que se mantiene para el siguiente', async () => {
    const { sesion, guardados } = crear('COP');
    sesion.cambiarMoneda('USD');
    teclear(sesion, '9');
    sesion.pulsar('.');
    teclear(sesion, '5');
    await sesion.guardar('ocio');
    expect([...guardados.values()][0]).toMatchObject({ monto: 9.5, moneda: 'USD' });
    expect(sesion.moneda).toBe('USD');
  });
});

describe('nota en Registrar', () => {
  it('se guarda con el siguiente gasto y luego se limpia', async () => {
    const { sesion, guardados } = crear();
    sesion.ponerNota('  Almuerzo con equipo ');
    teclear(sesion, '45000');
    await sesion.guardar('comida');
    expect([...guardados.values()][0]?.nota).toBe('Almuerzo con equipo');
    expect(sesion.nota).toBe('');
    teclear(sesion, '1000');
    await sesion.guardar('otros');
    expect([...guardados.values()][1]?.nota).toBe('');
  });
  it('admite hasta 200 caracteres', () => {
    const { sesion } = crear();
    sesion.ponerNota('a'.repeat(250));
    expect(sesion.nota).toHaveLength(MAX_NOTA);
    expect(MAX_NOTA).toBe(200);
  });
  it('con monto 0 no guarda y conserva la nota', async () => {
    const { sesion, guardados } = crear();
    sesion.ponerNota('pendiente');
    expect((await sesion.guardar('comida')).ok).toBe(false);
    expect(guardados.size).toBe(0);
    expect(sesion.nota).toBe('pendiente');
  });
  it('si guardar falla, la nota y el monto escritos se conservan', async () => {
    const sesion = new SesionRegistro('COP', {
      add: async () => {
        throw new Error('disco lleno');
      },
      delete: async () => {},
    });
    sesion.ponerNota('importante');
    teclear(sesion, '500');
    await expect(sesion.guardar('comida')).rejects.toThrow('disco lleno');
    expect(sesion.nota).toBe('importante');
    expect(sesion.entry).toBe('500');
  });
});
