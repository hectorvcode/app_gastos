import { describe, expect, it } from 'vitest';
import { fechaHoraAIso } from './dates';
import { totalesPorMoneda, validarEdicion, type CambiosGasto } from './historial';
import type { Gasto } from '../types';

const AHORA = new Date(2026, 9, 7, 13, 42);
const HOY = '2026-10-07';

function gasto(p: Partial<Gasto> = {}): Gasto {
  return {
    id: 'g1',
    fecha: fechaHoraAIso(HOY, '10:00'),
    monto: 45000,
    moneda: 'COP',
    categoriaId: 'comida',
    cuentaId: 'personal',
    nota: '',
    fotoId: null,
    creadoEn: '2026-10-07T15:00:00.000Z',
    editadoEn: '2026-10-07T15:00:00.000Z',
    exportadoEn: null,
    ...p,
  };
}

const base: CambiosGasto = {
  fecha: HOY,
  hora: '10:00',
  monto: '45000',
  categoriaId: 'comida',
  moneda: 'COP',
  nota: '',
};

describe('validarEdicion: moneda y nota', () => {
  const original = gasto();
  const editar = (c: Partial<CambiosGasto>, g = original) => validarEdicion(g, { ...base, ...c }, AHORA);

  it('cambiar la moneda actualiza editadoEn', () => {
    const r = editar({ moneda: 'USD', monto: '12,50' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cambio).toBe(true);
    expect(r.gasto).toMatchObject({ moneda: 'USD', monto: 12.5, editadoEn: AHORA.toISOString() });
  });
  it('cambiar solo la moneda (mismo número) también cuenta como cambio', () => {
    const r = editar({ moneda: 'USD' });
    expect(r.ok && r.cambio).toBe(true);
  });
  it('editar la nota actualiza editadoEn y recorta espacios', () => {
    const r = editar({ nota: '  Taxi al aeropuerto ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gasto.nota).toBe('Taxi al aeropuerto');
    expect(r.gasto.editadoEn).toBe(AHORA.toISOString());
  });
  it('borrar la nota también es un cambio', () => {
    const r = editar({ nota: '' }, gasto({ nota: 'algo' }));
    expect(r.ok && r.cambio).toBe(true);
    expect(r.ok && r.gasto.nota).toBe('');
  });
  it('sin cambios no toca editadoEn', () => {
    const r = editar({});
    expect(r.ok && r.cambio).toBe(false);
    expect(r.ok && r.gasto.editadoEn).toBe(original.editadoEn);
  });
  it('la nota admite 200 caracteres y rechaza 201', () => {
    expect(editar({ nota: 'a'.repeat(200) }).ok).toBe(true);
    expect(editar({ nota: 'a'.repeat(201) }).ok).toBe(false);
  });
  it('pasar a COP con decimales no redondea en silencio: da error', () => {
    const usd = gasto({ moneda: 'USD', monto: 12.5 });
    expect(editar({ moneda: 'COP', monto: '12.50' }, usd).ok).toBe(false);
  });
});

describe('totales del día separados por moneda', () => {
  it('no mezcla ni convierte monedas', () => {
    const t = totalesPorMoneda([
      gasto({ moneda: 'COP', monto: 45000 }),
      gasto({ moneda: 'USD', monto: 12.5 }),
      gasto({ moneda: 'USD', monto: 0.1 }),
      gasto({ moneda: 'EUR', monto: 3 }),
    ]);
    expect(t).toEqual([
      { moneda: 'COP', total: 45000 },
      { moneda: 'EUR', total: 3 },
      { moneda: 'USD', total: 12.6 },
    ]);
  });
});
