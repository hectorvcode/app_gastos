import { describe, expect, it } from 'vitest';
import { fechaHoraAIso, rangoMes, desplazarMes, etiquetaMes } from './dates';
import {
  agruparPorDia,
  eliminarGasto,
  filtrarPorCategoria,
  totalesPorMoneda,
  validarEdicion,
  type CambiosGasto,
} from './historial';
import type { Gasto } from '../types';

const AHORA = new Date(2026, 9, 7, 13, 42); // 7 oct 2026, 13:42 local
const HOY = '2026-10-07';

function gasto(p: Partial<Gasto> & { dia?: string; hora?: string } = {}): Gasto {
  const { dia = HOY, hora = '10:00', ...resto } = p;
  return {
    id: crypto.randomUUID(),
    fecha: fechaHoraAIso(dia, hora),
    monto: 1000,
    moneda: 'COP',
    categoriaId: 'comida',
    cuentaId: 'personal',
    nota: '',
    fotoId: null,
    creadoEn: '2026-10-01T00:00:00.000Z',
    editadoEn: '2026-10-01T00:00:00.000Z',
    exportadoEn: null,
    ...resto,
  };
}

describe('totalesPorMoneda', () => {
  it('suma por moneda sin errores de coma flotante', () => {
    const gs = [
      gasto({ monto: 0.1, moneda: 'USD' }),
      gasto({ monto: 0.2, moneda: 'USD' }),
      gasto({ monto: 45000 }),
      gasto({ monto: 5000 }),
      gasto({ monto: 10, moneda: 'EUR' }),
    ];
    expect(totalesPorMoneda(gs)).toEqual([
      { moneda: 'COP', total: 50000 },
      { moneda: 'EUR', total: 10 },
      { moneda: 'USD', total: 0.3 },
    ]);
  });
  it('lista vacía', () => expect(totalesPorMoneda([])).toEqual([]));
});

describe('agruparPorDia', () => {
  const gs = [
    gasto({ dia: '2026-10-05', hora: '09:00', monto: 100 }),
    gasto({ dia: HOY, hora: '08:00', monto: 200 }),
    gasto({ dia: '2026-10-06', hora: '12:00', monto: 300 }),
    gasto({ dia: HOY, hora: '13:30', monto: 400 }),
    gasto({ dia: HOY, hora: '11:00', monto: 50, moneda: 'USD' }),
  ];
  const grupos = agruparPorDia(gs, HOY);

  it('ordena los días del más reciente al más antiguo', () => {
    expect(grupos.map((g) => g.key)).toEqual(['2026-10-07', '2026-10-06', '2026-10-05']);
  });
  it('titula Hoy, Ayer y la fecha corta', () => {
    expect(grupos.map((g) => g.titulo)).toEqual(['Hoy', 'Ayer', 'Lun 5 oct']);
  });
  it('ordena los gastos de un día del más reciente al más antiguo', () => {
    expect(grupos[0]?.gastos.map((g) => g.monto)).toEqual([400, 50, 200]);
  });
  it('calcula el total del día por moneda', () => {
    expect(grupos[0]?.totales).toEqual([
      { moneda: 'COP', total: 600 },
      { moneda: 'USD', total: 50 },
    ]);
    expect(grupos[1]?.totales).toEqual([{ moneda: 'COP', total: 300 }]);
  });
  it('sin gastos no hay grupos', () => expect(agruparPorDia([], HOY)).toEqual([]));
  it('con 2.000 gastos agrupa rápido', () => {
    const muchos = Array.from({ length: 2000 }, (_, i) =>
      gasto({ dia: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, monto: i + 1 }),
    );
    const t0 = performance.now();
    const g = agruparPorDia(muchos, HOY);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(g).toHaveLength(28);
    expect(g.reduce((n, x) => n + x.gastos.length, 0)).toBe(2000);
  });
});

describe('filtros', () => {
  const gs = [
    gasto({ categoriaId: 'comida' }),
    gasto({ categoriaId: 'salud' }),
    gasto({ categoriaId: 'comida' }),
  ];
  it('por categoría', () => {
    expect(filtrarPorCategoria(gs, 'comida')).toHaveLength(2);
    expect(filtrarPorCategoria(gs, 'hogar')).toHaveLength(0);
  });
  it('sin categoría devuelve todo', () => expect(filtrarPorCategoria(gs, null)).toHaveLength(3));

  it('rango del mes incluye el día 1 y excluye el día 1 del mes siguiente', () => {
    const { desde, hasta } = rangoMes({ anio: 2026, mes: 9 });
    const dentro = (iso: string) => iso >= desde && iso < hasta;
    expect(dentro(fechaHoraAIso('2026-10-01', '00:00'))).toBe(true);
    expect(dentro(fechaHoraAIso('2026-10-31', '23:59'))).toBe(true);
    expect(dentro(fechaHoraAIso('2026-09-30', '23:59'))).toBe(false);
    expect(dentro(fechaHoraAIso('2026-11-01', '00:00'))).toBe(false);
  });
  it('navega entre meses y años', () => {
    expect(desplazarMes({ anio: 2026, mes: 0 }, -1)).toEqual({ anio: 2025, mes: 11 });
    expect(desplazarMes({ anio: 2026, mes: 11 }, 1)).toEqual({ anio: 2027, mes: 0 });
    expect(etiquetaMes({ anio: 2026, mes: 9 })).toBe('octubre 2026');
  });
});

describe('validarEdicion', () => {
  const original = gasto({ monto: 45000, categoriaId: 'comida', hora: '10:00' });
  const base: CambiosGasto = { fecha: HOY, hora: '10:00', monto: '45000', categoriaId: 'comida', moneda: 'COP', nota: '' };
  const editar = (c: Partial<CambiosGasto>, g = original) => validarEdicion(g, { ...base, ...c }, AHORA);

  it('actualiza editadoEn y conserva el resto', () => {
    const r = editar({ monto: '50000', categoriaId: 'salud' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cambio).toBe(true);
    expect(r.gasto.monto).toBe(50000);
    expect(r.gasto.categoriaId).toBe('salud');
    expect(r.gasto.editadoEn).toBe(AHORA.toISOString());
    expect(r.gasto.id).toBe(original.id);
    expect(r.gasto.creadoEn).toBe(original.creadoEn);
    expect(r.gasto.moneda).toBe('COP');
  });
  it('cambiar fecha y hora actualiza fecha y editadoEn', () => {
    const r = editar({ fecha: '2026-10-05', hora: '18:30' });
    expect(r.ok && r.gasto.fecha).toBe(fechaHoraAIso('2026-10-05', '18:30'));
    expect(r.ok && r.gasto.editadoEn).toBe(AHORA.toISOString());
  });
  it('sin cambios no toca editadoEn ni la fecha exacta', () => {
    const r = editar({});
    expect(r.ok && r.cambio).toBe(false);
    expect(r.ok && r.gasto).toBe(original);
  });
  it('rechaza monto 0, vacío o inválido', () => {
    for (const monto of ['0', '', 'abc', '-5', '12.5']) expect(editar({ monto }).ok).toBe(false);
  });
  it('USD acepta coma o punto y hasta 2 decimales', () => {
    const usd = gasto({ moneda: 'USD', monto: 12.5 });
    const r = validarEdicion(usd, { ...base, monto: '12,75', moneda: 'USD' }, AHORA);
    expect(r.ok && r.gasto.monto).toBe(12.75);
    expect(validarEdicion(usd, { ...base, monto: '1.234', moneda: 'USD' }, AHORA).ok).toBe(false);
  });
  it('rechaza fechas y horas futuras', () => {
    expect(editar({ fecha: '2026-10-08' }).ok).toBe(false);
    expect(editar({ hora: '13:43' }).ok).toBe(false);
    expect(editar({ hora: '13:42' }).ok).toBe(true);
  });
  it('rechaza fecha u hora vacías', () => {
    expect(editar({ fecha: '' }).ok).toBe(false);
    expect(editar({ hora: '' }).ok).toBe(false);
  });
});

describe('eliminarGasto', () => {
  function entorno(g: Gasto) {
    const guardados = new Map<string, Gasto>([[g.id, g]]);
    const fotos = new Set<string>(g.fotoId ? [g.fotoId] : []);
    const repo = {
      add: async (x: Gasto) => void guardados.set(x.id, x),
      delete: async (id: string) => void guardados.delete(id),
      borrarFoto: async (id: string) => void fotos.delete(id),
    };
    return { guardados, fotos, repo };
  }
  it('borra y deshacer lo restaura idéntico', async () => {
    const g = gasto({ nota: 'almuerzo' });
    const { guardados, repo } = entorno(g);
    const pendiente = await eliminarGasto(repo, g);
    expect(guardados.size).toBe(0);
    await pendiente.deshacer();
    expect(guardados.get(g.id)).toEqual(g);
  });
  it('la foto sigue guardada mientras dura el aviso y se elimina solo al vencer', async () => {
    const g = gasto({ fotoId: 'f1' });
    const { fotos, repo } = entorno(g);
    const pendiente = await eliminarGasto(repo, g);
    expect(fotos.has('f1')).toBe(true);
    await pendiente.confirmar();
    expect(fotos.has('f1')).toBe(false);
  });
  it('deshacer recupera también la foto y confirmar después ya no la borra', async () => {
    const g = gasto({ fotoId: 'f1' });
    const { guardados, fotos, repo } = entorno(g);
    const pendiente = await eliminarGasto(repo, g);
    await pendiente.deshacer();
    await pendiente.confirmar();
    expect(guardados.get(g.id)?.fotoId).toBe('f1');
    expect(fotos.has('f1')).toBe(true);
  });
  it('no se puede deshacer una vez vencido el plazo', async () => {
    const g = gasto({ fotoId: 'f1' });
    const { guardados, repo } = entorno(g);
    const pendiente = await eliminarGasto(repo, g);
    await pendiente.confirmar();
    await expect(pendiente.deshacer()).rejects.toThrow('plazo');
    expect(guardados.size).toBe(0);
  });
  it('un gasto sin foto no toca la tabla de fotos', async () => {
    const g = gasto();
    const { fotos, repo } = entorno(g);
    fotos.add('otra');
    await (await eliminarGasto(repo, g)).confirmar();
    expect(fotos.has('otra')).toBe(true);
  });
  it('si borrar falla propaga el error y no devuelve deshacer', async () => {
    const repo = {
      add: async () => {},
      borrarFoto: async () => {},
      delete: async () => {
        throw new Error('sin acceso');
      },
    };
    await expect(eliminarGasto(repo, gasto())).rejects.toThrow('sin acceso');
  });
});
