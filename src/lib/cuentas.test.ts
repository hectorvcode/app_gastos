import { describe, expect, it } from 'vitest';
import type { Cuenta, Gasto } from '../types';
import {
  archivarCuenta,
  borrarCuenta,
  cargarEstadoCuentas,
  completarCuenta,
  crearCuenta,
  cuentasActivas,
  desarchivarCuenta,
  editarCuenta,
  guardarCuentaPredeterminada,
  guardarUltimaCuenta,
  moverCuenta,
  mostrarChipCuenta,
  resolverCuentaActual,
  textoGuardado,
  validarPredeterminada,
  CUENTA_INICIAL,
  CUENTA_PERSONAL_ID,
} from './cuentas';
import { fechaHoraAIso, rangoMes } from './dates';
import { agruparPorDia, filtrarGastos, validarEdicion, type CambiosGasto } from './historial';
import type { Key } from './money';
import { SesionRegistro } from './registro';

const cuenta = (id: string, orden: number, extra: Partial<Cuenta> = {}): Cuenta => ({
  id,
  nombre: id[0]!.toUpperCase() + id.slice(1),
  emoji: '📒',
  orden,
  archivada: false,
  ...extra,
});
const PERSONAL = CUENTA_INICIAL;
const HOGAR = cuenta('hogar', 1);
const NEGOCIO = cuenta('negocio', 2);

function repoAjustes(inicial: Record<string, unknown> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    get: async (k: string) => datos.get(k),
    set: async (k: string, v: unknown) => void datos.set(k, v),
  };
}

describe('migración de gastos existentes a la cuenta Personal', () => {
  // Gastos tal como estaban guardados en la versión 1 (sin cuentaId).
  const v1 = [
    { id: 'a', monto: 45000, moneda: 'COP', categoriaId: 'comida', nota: 'x', fotoId: null },
    { id: 'b', monto: 12.5, moneda: 'USD', categoriaId: 'compras', nota: '', fotoId: 'f1' },
    { id: 'c', monto: 1, moneda: 'EUR', categoriaId: 'otros', nota: '', fotoId: null },
  ];

  it('asigna "Personal" a todos sin perder ni duplicar ninguno', () => {
    const migrados = v1.map((g) => completarCuenta(g));
    expect(migrados).toHaveLength(v1.length);
    expect(new Set(migrados.map((g) => g.id)).size).toBe(v1.length);
    expect(migrados.every((g) => g.cuentaId === CUENTA_PERSONAL_ID)).toBe(true);
  });

  it('conserva el resto de los campos intactos', () => {
    for (const [i, g] of v1.entries()) {
      const { cuentaId, ...resto } = completarCuenta(g);
      expect(cuentaId).toBe('personal');
      expect(resto).toEqual(v1[i]);
    }
  });

  it('no sobrescribe una cuenta ya asignada (migración repetida)', () => {
    expect(completarCuenta({ id: 'z', cuentaId: 'hogar' }).cuentaId).toBe('hogar');
    expect(completarCuenta(completarCuenta(v1[0]!)).cuentaId).toBe('personal');
  });

  it('no modifica el objeto original', () => {
    const g = { id: 'a' };
    completarCuenta(g);
    expect(g).toEqual({ id: 'a' });
  });
});

describe('ultimaCuenta: persistencia', () => {
  const cuentas = [PERSONAL, HOGAR];

  it('sin valor guardado abre en la predeterminada', async () => {
    const repo = repoAjustes({ cuentaPredeterminada: 'personal' });
    expect(await cargarEstadoCuentas(repo, cuentas)).toEqual({ predeterminada: 'personal', actual: 'personal' });
  });

  it('recuerda la última cuenta al reabrir la app', async () => {
    const repo = repoAjustes({ cuentaPredeterminada: 'personal' });
    await guardarUltimaCuenta(repo, 'hogar');
    expect(repo.datos.get('ultimaCuenta')).toBe('hogar');
    expect((await cargarEstadoCuentas(repo, cuentas)).actual).toBe('hogar');
  });

  it('si la última cuenta se archivó o no existe, vuelve a la predeterminada', async () => {
    const repo = repoAjustes({ cuentaPredeterminada: 'personal', ultimaCuenta: 'hogar' });
    expect((await cargarEstadoCuentas(repo, [PERSONAL, { ...HOGAR, archivada: true }])).actual).toBe('personal');
    expect((await cargarEstadoCuentas(repo, [PERSONAL])).actual).toBe('personal');
  });

  it('si la predeterminada guardada ya no es válida, usa la primera activa', async () => {
    const repo = repoAjustes({ cuentaPredeterminada: 'borrada' });
    expect((await cargarEstadoCuentas(repo, cuentas)).predeterminada).toBe('personal');
    await guardarCuentaPredeterminada(repo, 'hogar');
    expect((await cargarEstadoCuentas(repo, cuentas)).predeterminada).toBe('hogar');
  });

  it('al archivar la cuenta en uso, Registrar pasa a la predeterminada', () => {
    expect(resolverCuentaActual('hogar', [PERSONAL, { ...HOGAR, archivada: true }], 'personal')).toBe('personal');
    expect(resolverCuentaActual('hogar', cuentas, 'personal')).toBe('hogar');
  });
});

describe('chip de cuenta en Registrar', () => {
  it('se oculta con una sola cuenta activa', () => {
    expect(mostrarChipCuenta([PERSONAL])).toBe(false);
  });
  it('se oculta si las demás están archivadas', () => {
    expect(mostrarChipCuenta([PERSONAL, { ...HOGAR, archivada: true }])).toBe(false);
  });
  it('se muestra con dos o más cuentas activas', () => {
    expect(mostrarChipCuenta([PERSONAL, HOGAR])).toBe(true);
  });
  it('el aviso de guardado nombra la cuenta solo si se le pasa (no es la predeterminada)', () => {
    expect(textoGuardado(null, null)).toBe('Guardado');
    expect(textoGuardado(null, 'Negocio')).toBe('Guardado en Negocio');
    expect(textoGuardado('5 oct', null)).toBe('Guardado el 5 oct');
    expect(textoGuardado('5 oct', 'Negocio')).toBe('Guardado el 5 oct en Negocio');
  });
});

describe('Registrar guarda en la cuenta elegida', () => {
  it('el gasto lleva el cuentaId de la sesión', async () => {
    const guardados: Gasto[] = [];
    const s = new SesionRegistro(
      'COP',
      { add: async (g) => void guardados.push(g), delete: async () => {} },
      () => new Date(2026, 9, 7, 13, 0),
      () => 'id-1',
    );
    expect(s.cuentaId).toBe('personal');
    s.cuentaId = 'negocio';
    for (const d of '5000') s.pulsar(d as Key);
    await s.guardar('comida');
    expect(guardados[0]!.cuentaId).toBe('negocio');
  });
});

describe('reglas de archivar', () => {
  const cuentas = [PERSONAL, HOGAR];

  it('archiva una cuenta que no es la predeterminada', () => {
    const r = archivarCuenta(cuentas, 'hogar', 'personal');
    expect(r.ok && r.cuentas.find((c) => c.id === 'hogar')?.archivada).toBe(true);
  });
  it('no archiva la predeterminada', () => {
    expect(archivarCuenta(cuentas, 'personal', 'personal').ok).toBe(false);
  });
  it('siempre queda al menos una cuenta activa', () => {
    expect(archivarCuenta([PERSONAL, { ...HOGAR, archivada: true }], 'personal', 'hogar').ok).toBe(false);
    expect(archivarCuenta([PERSONAL], 'personal', 'otra').ok).toBe(false);
  });
  it('se puede desarchivar', () => {
    const r = desarchivarCuenta([PERSONAL, { ...HOGAR, archivada: true }], 'hogar');
    expect(r.ok && cuentasActivas(r.cuentas).map((c) => c.id)).toEqual(['personal', 'hogar']);
  });
  it('una archivada no puede ser la predeterminada', () => {
    expect(validarPredeterminada([PERSONAL, { ...HOGAR, archivada: true }], 'hogar').ok).toBe(false);
    expect(validarPredeterminada(cuentas, 'hogar').ok).toBe(true);
  });
});

describe('reglas de borrar', () => {
  const cuentas = [PERSONAL, HOGAR];

  it('borra una cuenta sin gastos', () => {
    const r = borrarCuenta(cuentas, 'hogar', 'personal', 0);
    expect(r.ok && r.cuentas.map((c) => c.id)).toEqual(['personal']);
  });
  it('no borra una cuenta con gastos: solo archivar', () => {
    const r = borrarCuenta(cuentas, 'hogar', 'personal', 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/archivar/);
  });
  it('no borra la predeterminada aunque no tenga gastos', () => {
    expect(borrarCuenta(cuentas, 'personal', 'personal', 0).ok).toBe(false);
  });
  it('no deja el sistema sin cuentas activas', () => {
    expect(borrarCuenta([PERSONAL, { ...HOGAR, archivada: true }], 'personal', 'hogar', 0).ok).toBe(false);
  });
});

describe('crear, renombrar y reordenar', () => {
  it('crea con orden al final y rechaza nombres vacíos o repetidos', () => {
    const r = crearCuenta([PERSONAL], '  Hogar ', '🏠', 'h1');
    expect(r.ok && r.cuentas.map((c) => [c.nombre, c.orden])).toEqual([
      ['Personal', 0],
      ['Hogar', 1],
    ]);
    expect(crearCuenta([PERSONAL], '   ', '🏠', 'x').ok).toBe(false);
    expect(crearCuenta([PERSONAL], 'personal', '🏠', 'x').ok).toBe(false);
  });
  it('renombra y cambia emoji, y permite conservar el mismo nombre', () => {
    const r = editarCuenta([PERSONAL, HOGAR], 'hogar', { nombre: 'Casa', emoji: '🏡' });
    expect(r.ok && r.cuentas.find((c) => c.id === 'hogar')).toMatchObject({ nombre: 'Casa', emoji: '🏡' });
    expect(editarCuenta([PERSONAL, HOGAR], 'hogar', { nombre: 'Hogar' }).ok).toBe(true);
    expect(editarCuenta([PERSONAL, HOGAR], 'hogar', { nombre: 'Personal' }).ok).toBe(false);
  });
  it('reordena subiendo y bajando', () => {
    const lista = [PERSONAL, HOGAR, NEGOCIO];
    const sube = moverCuenta(lista, 'negocio', -1);
    expect(sube.ok && sube.cuentas.map((c) => c.id)).toEqual(['personal', 'negocio', 'hogar']);
    const baja = moverCuenta(lista, 'personal', 1);
    expect(baja.ok && baja.cuentas.map((c) => c.id)).toEqual(['hogar', 'personal', 'negocio']);
    const tope = moverCuenta(lista, 'personal', -1);
    expect(tope.ok && tope.cuentas.map((c) => c.id)).toEqual(['personal', 'hogar', 'negocio']);
  });
});

function gasto(p: Partial<Gasto> & { dia?: string; hora?: string } = {}): Gasto {
  const { dia = '2026-10-07', hora = '10:00', ...resto } = p;
  return {
    id: `${dia}-${hora}-${Math.random()}`,
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

describe('Historial: filtro de cuenta combinado con mes y categoría', () => {
  const gastos = [
    gasto({ dia: '2026-10-05', cuentaId: 'personal', categoriaId: 'comida', monto: 100 }),
    gasto({ dia: '2026-10-05', cuentaId: 'hogar', categoriaId: 'comida', monto: 200 }),
    gasto({ dia: '2026-10-05', cuentaId: 'hogar', categoriaId: 'mercado', monto: 300 }),
    gasto({ dia: '2026-10-06', cuentaId: 'hogar', categoriaId: 'comida', monto: 50, moneda: 'USD' }),
    gasto({ dia: '2026-09-20', cuentaId: 'hogar', categoriaId: 'comida', monto: 999 }), // otro mes
  ];
  // La pantalla lee el mes de la base de datos por rango de fecha; aquí se hace igual en memoria.
  const { desde, hasta } = rangoMes({ anio: 2026, mes: 9 });
  const octubre = gastos.filter((g) => g.fecha >= desde && g.fecha < hasta);

  it('"Todas" (null) no filtra por cuenta', () => {
    expect(filtrarGastos(octubre, { categoriaId: null, cuentaId: null })).toHaveLength(4);
  });
  it('solo cuenta', () => {
    expect(filtrarGastos(octubre, { categoriaId: null, cuentaId: 'hogar' })).toHaveLength(3);
  });
  it('cuenta + categoría + mes', () => {
    const r = filtrarGastos(octubre, { categoriaId: 'comida', cuentaId: 'hogar' });
    expect(r.map((g) => g.monto).sort((a, b) => a - b)).toEqual([50, 200]);
    expect(r.some((g) => g.monto === 999)).toBe(false);
  });
  it('los totales por día respetan el filtro y siguen separados por moneda', () => {
    const grupos = agruparPorDia(filtrarGastos(octubre, { categoriaId: null, cuentaId: 'hogar' }), '2026-10-07');
    const por = Object.fromEntries(grupos.map((g) => [g.key, g.totales]));
    expect(por['2026-10-05']).toEqual([{ moneda: 'COP', total: 500 }]);
    expect(por['2026-10-06']).toEqual([{ moneda: 'USD', total: 50 }]);
  });
});

describe('edición de la cuenta de un gasto', () => {
  const AHORA = new Date(2026, 9, 7, 15, 0);
  const original = gasto({ cuentaId: 'personal', monto: 45000 });
  const base: CambiosGasto = {
    fecha: '2026-10-07',
    hora: '10:00',
    monto: '45000',
    categoriaId: 'comida',
    moneda: 'COP',
    nota: '',
  };

  it('cambiar la cuenta actualiza cuentaId y editadoEn', () => {
    const r = validarEdicion(original, { ...base, cuentaId: 'hogar' }, AHORA);
    expect(r.ok && r.cambio).toBe(true);
    if (r.ok) {
      expect(r.gasto.cuentaId).toBe('hogar');
      expect(r.gasto.editadoEn).toBe(AHORA.toISOString());
      expect(r.gasto.id).toBe(original.id);
    }
  });
  it('dejar la misma cuenta (o no enviarla) no cuenta como cambio ni toca editadoEn', () => {
    for (const c of [{ ...base, cuentaId: 'personal' }, base]) {
      const r = validarEdicion(original, c, AHORA);
      expect(r.ok && r.cambio).toBe(false);
      if (r.ok) expect(r.gasto.editadoEn).toBe(original.editadoEn);
    }
  });
});
