import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import type { Eliminado, Gasto } from '../types';
import type { ResultadoCompartir } from './compartir';
import { fechaHoraAIso } from './dates';
import {
  aplicarMarca,
  armarZip,
  archivoParaDescarga,
  marcaDeTiempo,
  cambioDe,
  construirFilas,
  eliminadoDe,
  entregar,
  MENSAJE_SIN_NUEVOS,
  mensajeVacio,
  nombreArchivo,
  nombreParaArchivo,
  nombresDeFotos,
  prepararArchivo,
  restaurarTrasDeshacer,
  seleccionar,
  totalFilas,
  validarRango,
  type ArchivoListo,
  type EntradaArchivo,
  type MarcaPrevia,
  type PlanMarca,
  type RepoMarcas,
} from './exportar';

const HOY = '2026-10-08';
/** 8 oct 2026, 20:10:05 hora local (el nombre del archivo usa la hora local). */
const NOMBRE = new Date(2026, 9, 8, 20, 10, 5);
const T0 = '2026-10-01T00:00:00.000Z';
const T1 = '2026-10-05T00:00:00.000Z';
const T2 = '2026-10-06T00:00:00.000Z';

let contador = 0;
function gasto(p: Partial<Gasto> & { dia?: string; hora?: string } = {}): Gasto {
  const { dia = '2026-10-07', hora = '10:00', ...resto } = p;
  contador++;
  return {
    id: `${String(contador).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`,
    fecha: fechaHoraAIso(dia, hora),
    monto: 1000,
    moneda: 'COP',
    categoriaId: 'comida',
    cuentaId: 'personal',
    nota: '',
    fotoId: null,
    creadoEn: T0,
    editadoEn: T0,
    exportadoEn: null,
    ...resto,
  };
}

const CATEGORIAS = [
  { id: 'comida', nombre: 'Comida' },
  { id: 'hogar', nombre: 'Hogar' },
];
const CUENTAS = [
  { id: 'personal', nombre: 'Personal' },
  { id: 'hogar', nombre: 'Hogar' },
];

const ids = (gs: readonly Gasto[]): string[] => gs.map((g) => g.id);

describe('cambioDe', () => {
  it('nuevo si nunca se exportó, editado si cambió después de exportarse', () => {
    expect(cambioDe(gasto())).toBe('nuevo');
    expect(cambioDe(gasto({ exportadoEn: T1, editadoEn: T2 }))).toBe('editado');
  });
  it('ya exportado y sin cambios cuenta como nuevo (versión vigente)', () => {
    expect(cambioDe(gasto({ exportadoEn: T2, editadoEn: T1 }))).toBe('nuevo');
  });
});

describe('validarRango', () => {
  it('acepta desde <= hasta <= hoy', () => {
    expect(validarRango('2026-10-01', '2026-10-08', HOY)).toBeNull();
    expect(validarRango('2026-10-08', '2026-10-08', HOY)).toBeNull();
  });
  it('rechaza vacíos, futuras y rangos invertidos', () => {
    expect(validarRango('', '2026-10-08', HOY)).toMatch(/Desde/);
    expect(validarRango('2026-10-01', '', HOY)).toMatch(/Hasta/);
    expect(validarRango('2026-10-01', '2026-10-09', HOY)).toMatch(/futura/);
    expect(validarRango('2026-10-05', '2026-10-04', HOY)).toMatch(/anterior/);
  });
});

describe('seleccionar: mes, rango, todo y cuenta', () => {
  const sep = gasto({ dia: '2026-09-30', hora: '23:59' });
  const oct1 = gasto({ dia: '2026-10-01', hora: '00:00' });
  const oct31 = gasto({ dia: '2026-10-31', hora: '23:59' });
  const nov1 = gasto({ dia: '2026-11-01', hora: '00:00' });
  const hogar = gasto({ dia: '2026-10-15', cuentaId: 'hogar' });
  const todos = [nov1, oct31, sep, hogar, oct1];

  it('un mes incluye del día 1 a las 00:00 hasta el último minuto, y nada más', () => {
    const r = seleccionar(todos, [], { tipo: 'mes', mes: { anio: 2026, mes: 9 } }, null);
    expect(ids(r.gastos).sort()).toEqual(ids([oct1, hogar, oct31]).sort());
  });
  it('un mes combinado con una cuenta', () => {
    const r = seleccionar(todos, [], { tipo: 'mes', mes: { anio: 2026, mes: 9 } }, 'hogar');
    expect(ids(r.gastos)).toEqual(ids([hogar]));
  });
  it('un rango incluye los dos extremos completos', () => {
    const r = seleccionar(todos, [], { tipo: 'rango', desde: '2026-09-30', hasta: '2026-10-01' }, null);
    expect(ids(r.gastos)).toEqual(ids([sep, oct1]));
  });
  it('todo trae todo, ordenado por fecha; con cuenta solo esa', () => {
    const r = seleccionar(todos, [], { tipo: 'todo' }, null);
    expect(ids(r.gastos)).toEqual(ids([sep, oct1, hogar, oct31, nov1]));
    expect(ids(seleccionar(todos, [], { tipo: 'todo' }, 'hogar').gastos)).toEqual(ids([hogar]));
  });
  it('mes, rango y todo nunca incluyen eliminados', () => {
    const borrado: Eliminado = { id: 'x', cuentaId: 'personal', eliminadoEn: T2 };
    for (const a of [
      { tipo: 'mes', mes: { anio: 2026, mes: 9 } },
      { tipo: 'rango', desde: '2026-10-01', hasta: HOY },
      { tipo: 'todo' },
    ] as const) {
      expect(seleccionar(todos, [borrado], a, null).eliminados).toEqual([]);
    }
  });
});

describe('seleccionar: Solo nuevos', () => {
  const nuevo = gasto();
  const editado = gasto({ exportadoEn: T1, editadoEn: T2 });
  const exportado = gasto({ exportadoEn: T2, editadoEn: T1 });
  const hogarNuevo = gasto({ cuentaId: 'hogar' });
  const borrado: Eliminado = { id: 'b1', cuentaId: 'personal', eliminadoEn: T2 };
  const borradoHogar: Eliminado = { id: 'b2', cuentaId: 'hogar', eliminadoEn: T2 };
  const todos = [nuevo, editado, exportado, hogarNuevo];

  it('incluye nuevos, editados y eliminados; deja fuera lo ya exportado sin cambios', () => {
    const r = seleccionar(todos, [borrado, borradoHogar], { tipo: 'nuevos' }, null);
    expect(ids(r.gastos).sort()).toEqual(ids([nuevo, editado, hogarNuevo]).sort());
    expect(r.eliminados.map((e) => e.id)).toEqual(['b1', 'b2']);
    expect(totalFilas(r)).toBe(5);
  });
  it('con una cuenta, solo sus gastos y sus eliminados', () => {
    const r = seleccionar(todos, [borrado, borradoHogar], { tipo: 'nuevos' }, 'hogar');
    expect(ids(r.gastos)).toEqual(ids([hogarNuevo]));
    expect(r.eliminados.map((e) => e.id)).toEqual(['b2']);
  });
  it('sin pendientes la selección queda vacía', () => {
    const r = seleccionar([exportado], [], { tipo: 'nuevos' }, null);
    expect(totalFilas(r)).toBe(0);
    expect(mensajeVacio({ tipo: 'nuevos' })).toBe(MENSAJE_SIN_NUEVOS);
  });
});

describe('nombres de archivo', () => {
  it('Solo nuevos, un mes, rango y todo', () => {
    expect(nombreArchivo({ tipo: 'nuevos' }, null, NOMBRE, 'csv')).toBe('gastos_20261008-201005.csv');
    expect(nombreArchivo({ tipo: 'mes', mes: { anio: 2026, mes: 9 } }, null, NOMBRE, 'csv')).toBe('gastos_2026-10_20261008-201005.csv');
    expect(nombreArchivo({ tipo: 'mes', mes: { anio: 2026, mes: 0 } }, null, NOMBRE, 'csv')).toBe('gastos_2026-01_20261008-201005.csv');
    expect(nombreArchivo({ tipo: 'rango', desde: '2026-10-01', hasta: '2026-10-07' }, null, NOMBRE, 'csv')).toBe(
      'gastos_2026-10-01_a_2026-10-07_20261008-201005.csv',
    );
    expect(nombreArchivo({ tipo: 'todo' }, null, NOMBRE, 'csv')).toBe('gastos_completo_20261008-201005.csv');
  });
  it('con una cuenta, su nombre va después de "gastos_"', () => {
    expect(nombreArchivo({ tipo: 'mes', mes: { anio: 2026, mes: 9 } }, 'Hogar', NOMBRE, 'csv')).toBe('gastos_Hogar_2026-10_20261008-201005.csv');
    expect(nombreArchivo({ tipo: 'nuevos' }, 'Hogar', NOMBRE, 'zip')).toBe('gastos_Hogar_20261008-201005.zip');
    expect(nombreArchivo({ tipo: 'rango', desde: '2026-10-01', hasta: '2026-10-07' }, 'Hogar', NOMBRE, 'csv')).toBe(
      'gastos_Hogar_2026-10-01_a_2026-10-07_20261008-201005.csv',
    );
    expect(nombreArchivo({ tipo: 'todo' }, 'Hogar', NOMBRE, 'csv')).toBe('gastos_Hogar_completo_20261008-201005.csv');
  });
  it('el ZIP lleva el mismo nombre con extensión .zip', () => {
    expect(nombreArchivo({ tipo: 'nuevos' }, null, NOMBRE, 'zip')).toBe('gastos_20261008-201005.zip');
  });
  it('la fecha y la hora usan ceros a la izquierda y hora local de 24 h', () => {
    expect(marcaDeTiempo(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
    expect(marcaDeTiempo(new Date(2026, 11, 31, 23, 59, 59))).toBe('20261231-235959');
  });
  it('dos exportaciones en segundos distintos nunca comparten nombre', () => {
    const a = nombreArchivo({ tipo: 'todo' }, null, new Date(2026, 9, 8, 20, 10, 5), 'csv');
    const b = nombreArchivo({ tipo: 'todo' }, null, new Date(2026, 9, 8, 20, 10, 6), 'csv');
    expect(a).not.toBe(b);
  });
  it('el nombre de la cuenta se limpia de caracteres problemáticos', () => {
    expect(nombreParaArchivo('Mi negocio / 2026')).toBe('Mi-negocio-2026');
    expect(nombreParaArchivo('Café ñandú')).toBe('Café-ñandú');
    expect(nombreParaArchivo('///')).toBe('cuenta');
  });
});

describe('nombresDeFotos', () => {
  it('usa los primeros 8 caracteres del id con extensión .jpg', () => {
    const g = { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', fotoId: 'f1' };
    expect(nombresDeFotos([g]).get(g.id)).toBe('3f2a9c1e.jpg');
  });
  it('omite los gastos sin foto', () => {
    expect(nombresDeFotos([{ id: 'aaaaaaaa-1', fotoId: null }]).size).toBe(0);
  });
  it('si dos ids chocan en los primeros 8 caracteres, el segundo se alarga', () => {
    const a = { id: '3f2a9c1e-0000-4000-8000-000000000001', fotoId: 'f1' };
    const b = { id: '3f2a9c1e-0000-4000-8000-000000000002', fotoId: 'f2' };
    const n = nombresDeFotos([a, b]);
    expect(n.get(a.id)).toBe('3f2a9c1e.jpg');
    expect(n.get(b.id)).not.toBe(n.get(a.id));
    expect(new Set(n.values()).size).toBe(2);
  });
});

describe('construirFilas', () => {
  it('arma gastos con cuenta, categoría, foto y cambio, y los eliminados al final', () => {
    const g1 = gasto({ nota: 'pan', fotoId: 'f1', categoriaId: 'hogar', cuentaId: 'hogar', monto: 12.5, moneda: 'USD' });
    const g2 = gasto({ exportadoEn: T1, editadoEn: T2 });
    const e: Eliminado = { id: 'zzz', cuentaId: 'hogar', eliminadoEn: fechaHoraAIso('2026-10-08', '09:15') };
    const filas = construirFilas(
      { gastos: [g1, g2], eliminados: [e] },
      CATEGORIAS,
      CUENTAS,
      new Map([[g1.id, '00000001.jpg']]),
    );
    expect(filas).toHaveLength(3);
    expect(filas[0]).toMatchObject({
      id: g1.id,
      fecha: '2026-10-07',
      hora: '10:00',
      monto: 12.5,
      moneda: 'USD',
      categoria: 'Hogar',
      cuenta: 'Hogar',
      nota: 'pan',
      foto: '00000001.jpg',
      cambio: 'nuevo',
    });
    expect(filas[1]).toMatchObject({ foto: '', cambio: 'editado', cuenta: 'Personal' });
    expect(filas[2]).toEqual({
      id: 'zzz',
      fecha: '2026-10-08',
      hora: '09:15',
      monto: null,
      moneda: '',
      categoria: '',
      cuenta: 'Hogar',
      nota: '',
      foto: '',
      cambio: 'eliminado',
    });
  });
});

describe('armarZip', () => {
  const jpeg = (bytes: number[]): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('trae el CSV en la raíz (con BOM) y las fotos en fotos/', async () => {
    const csv = '﻿id;nota\r\nx;ñandú\r\n';
    const zip = await armarZip(csv, 'gastos_2026-10-08.csv', [
      { nombre: '3f2a9c1e.jpg', blob: jpeg([1, 2, 3]) },
      { nombre: '00000002.jpg', blob: jpeg([9, 8, 7, 6]) },
    ]);
    const leido = await JSZip.loadAsync(await zip.arrayBuffer());
    expect(Object.keys(leido.files).sort()).toEqual(
      ['fotos/', 'fotos/00000002.jpg', 'fotos/3f2a9c1e.jpg', 'gastos_2026-10-08.csv'].sort(),
    );
    const bytesCsv = await leido.file('gastos_2026-10-08.csv')!.async('uint8array');
    expect([...bytesCsv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await leido.file('gastos_2026-10-08.csv')!.async('string')).toBe(csv);
    expect([...(await leido.file('fotos/3f2a9c1e.jpg')!.async('uint8array'))]).toEqual([1, 2, 3]);
    expect([...(await leido.file('fotos/00000002.jpg')!.async('uint8array'))]).toEqual([9, 8, 7, 6]);
  });
  it('con muchas fotos reporta el avance de 0 a 1', async () => {
    const fotos = Array.from({ length: 25 }, (_, i) => ({ nombre: `f${i}.jpg`, blob: jpeg([i]) }));
    const avances: number[] = [];
    await armarZip('x', 'a.csv', fotos, (_t, f) => avances.push(f));
    expect(avances.length).toBeGreaterThan(2);
    expect(Math.max(...avances)).toBeLessThanOrEqual(1);
    expect(avances).toEqual([...avances].sort((a, b) => a - b));
  });
});

describe('prepararArchivo', () => {
  function entrada(p: Partial<EntradaArchivo> & { gastos?: Gasto[]; eliminados?: Eliminado[] } = {}): EntradaArchivo {
    const { gastos = [gasto()], eliminados = [], ...resto } = p;
    return {
      seleccion: { gastos, eliminados },
      alcance: { tipo: 'nuevos' },
      formato: 'csv',
      decimal: 'coma',
      categorias: CATEGORIAS,
      cuentas: CUENTAS,
      cuentaFiltro: null,
      corte: NOMBRE,
      ...resto,
    };
  }
  const sinFotos = async (): Promise<undefined> => undefined;

  it('CSV: archivo con el nombre, tipo y contenido esperados', async () => {
    const g = gasto({ nota: 'a, b', monto: 12.5, moneda: 'USD', fotoId: 'f1' });
    const r = await prepararArchivo(entrada({ gastos: [g] }), sinFotos);
    expect(r.archivo.name).toBe('gastos_20261008-201005.csv');
    expect(r.archivo.type).toBe('text/csv');
    const texto = await r.archivo.text();
    expect(texto).toContain(';"a, b";;nuevo');
    expect(texto).toContain(';12,5;USD;');
    expect(r.fotosFaltantes).toBe(0); // solo CSV: no se buscan fotos
    expect(r.plan).toEqual({ marca: true, ids: [g.id], eliminadosIds: [], corte: NOMBRE.toISOString() });
  });
  it('CSV de un mes y de un rango no marcan', async () => {
    const mes = await prepararArchivo(entrada({ alcance: { tipo: 'mes', mes: { anio: 2026, mes: 9 } } }), sinFotos);
    expect(mes.plan.marca).toBe(false);
    expect(mes.archivo.name).toBe('gastos_2026-10_20261008-201005.csv');
    const rango = await prepararArchivo(
      entrada({ alcance: { tipo: 'rango', desde: '2026-10-01', hasta: HOY }, cuentaFiltro: 'hogar' }),
      sinFotos,
    );
    expect(rango.plan.marca).toBe(false);
    expect(rango.archivo.name).toBe('gastos_Hogar_2026-10-01_a_2026-10-08_20261008-201005.csv');
  });
  it('ZIP: incluye el CSV con el nombre de la foto y la foto en fotos/', async () => {
    const g = gasto({ fotoId: 'f1' });
    const sinFoto = gasto();
    const leerFoto = vi.fn(async (id: string) => (id === 'f1' ? { blob: new Blob([new Uint8Array([5, 5, 5])]) } : undefined));
    const r = await prepararArchivo(entrada({ gastos: [g, sinFoto], formato: 'zip' }), leerFoto);
    expect(r.archivo.name).toBe('gastos_20261008-201005.zip');
    expect(r.archivo.type).toBe('application/zip');
    expect(leerFoto).toHaveBeenCalledTimes(1);
    const zip = await JSZip.loadAsync(await r.archivo.arrayBuffer());
    const nombreFoto = `${g.id.slice(0, 8)}.jpg`;
    expect([...(await zip.file(`fotos/${nombreFoto}`)!.async('uint8array'))]).toEqual([5, 5, 5]);
    const csv = await zip.file('gastos_20261008-201005.csv')!.async('string');
    expect(csv).toContain(`;${nombreFoto};nuevo`);
    expect(csv.split('\r\n')[2]).toMatch(/;;nuevo$/); // el gasto sin foto deja la columna vacía
  });
  it('ZIP: una foto que no se encuentra sale sin foto y se cuenta', async () => {
    const g = gasto({ fotoId: 'perdida' });
    const r = await prepararArchivo(entrada({ gastos: [g], formato: 'zip' }), sinFotos);
    expect(r.fotosFaltantes).toBe(1);
    const zip = await JSZip.loadAsync(await r.archivo.arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => n.startsWith('fotos/') && n !== 'fotos/')).toEqual([]);
    expect(await zip.file('gastos_20261008-201005.csv')!.async('string')).toMatch(/;;nuevo\r\n$/);
  });
  it('con la selección vacía no genera archivo', async () => {
    await expect(prepararArchivo(entrada({ gastos: [] }), sinFotos)).rejects.toThrow(MENSAJE_SIN_NUEVOS);
  });
  it('con 2.000 gastos y 300 fotos arma el ZIP y avisa del progreso', async () => {
    const gastos = Array.from({ length: 2000 }, (_, i) => gasto({ fotoId: i < 300 ? `f${i}` : null, monto: 1000 + i }));
    const avances: number[] = [];
    const r = await prepararArchivo(
      entrada({ gastos, formato: 'zip' }),
      async () => ({ blob: new Blob([new Uint8Array(2048)]) }),
      (_t, f) => avances.push(f),
    );
    expect(r.gastos).toBe(2000);
    const zip = await JSZip.loadAsync(await r.archivo.arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => n.endsWith('.jpg'))).toHaveLength(300);
    expect(avances.at(-1)).toBe(1);
    expect(avances.length).toBeGreaterThan(10);
  }, 30_000);
});

// ---------- Flujo de "Solo nuevos": marcar, cancelar, doble exportación ----------

class Almacen implements RepoMarcas {
  ultima: unknown = null;
  constructor(
    public gastos: Gasto[],
    public eliminados: Eliminado[] = [],
  ) {}
  marcarLlamadas = 0;
  async marcar(plan: PlanMarca, ultimaExportacion: string): Promise<MarcaPrevia> {
    this.marcarLlamadas++;
    const enPlan = new Set(plan.ids);
    const borrar = new Set(plan.eliminadosIds);
    const r = aplicarMarca(
      this.gastos.filter((g) => enPlan.has(g.id)),
      this.eliminados.filter((e) => borrar.has(e.id)),
      plan,
      this.ultima,
    );
    const nuevos = new Map(r.gastos.map((g) => [g.id, g]));
    this.gastos = this.gastos.map((g) => nuevos.get(g.id) ?? g);
    this.eliminados = this.eliminados.filter((e) => !r.eliminadosABorrar.includes(e.id));
    this.ultima = ultimaExportacion;
    return r.previa;
  }
  async revertir(previa: MarcaPrevia): Promise<void> {
    const antes = new Map(previa.gastos.map((x) => [x.id, x.exportadoEn]));
    this.gastos = this.gastos.map((g) => (antes.has(g.id) ? { ...g, exportadoEn: antes.get(g.id)! } : g));
    this.eliminados = [...this.eliminados, ...previa.eliminados];
    this.ultima = previa.ultimaExportacion;
  }
}

function io(resultado: ResultadoCompartir) {
  return {
    compartir: vi.fn(async (): Promise<ResultadoCompartir> => resultado),
    descargar: vi.fn(),
  };
}

async function armar(a: Almacen, alcance: EntradaArchivo['alcance'] = { tipo: 'nuevos' }, cuentaFiltro: string | null = null, corte = new Date('2026-10-08T15:00:00.000Z')): Promise<ArchivoListo> {
  return prepararArchivo(
    {
      seleccion: seleccionar(a.gastos, a.eliminados, alcance, cuentaFiltro),
      alcance,
      formato: 'csv',
      decimal: 'coma',
      categorias: CATEGORIAS,
      cuentas: CUENTAS,
      cuentaFiltro,
      corte,
    },
    async () => undefined,
  );
}

const AHORA = (): Date => new Date('2026-10-08T15:00:01.000Z');
const pendientes = (a: Almacen, cuenta: string | null = null): number =>
  totalFilas(seleccionar(a.gastos, a.eliminados, { tipo: 'nuevos' }, cuenta));

describe('entregar y marcar', () => {
  it('compartir completo marca los gastos y la fecha de última exportación', async () => {
    const a = new Almacen([gasto(), gasto({ exportadoEn: T1, editadoEn: T2 })]);
    const r = await entregar(await armar(a), io('compartido'), a, AHORA);
    expect(r.estado).toBe('compartido');
    expect(a.gastos.every((g) => g.exportadoEn === '2026-10-08T15:00:00.000Z')).toBe(true);
    expect(a.ultima).toBe('2026-10-08T15:00:01.000Z');
  });

  it('exportar "Solo nuevos" dos veces seguidas: la segunda queda vacía y no hay archivo', async () => {
    const a = new Almacen([gasto(), gasto()]);
    await entregar(await armar(a), io('compartido'), a, AHORA);
    expect(pendientes(a)).toBe(0);
    await expect(armar(a)).rejects.toThrow('No hay gastos nuevos desde la última exportación');
  });

  it('cancelar el menú Compartir no marca nada', async () => {
    const a = new Almacen([gasto(), gasto()], [{ id: 'b', cuentaId: 'personal', eliminadoEn: T2 }]);
    const antes = structuredClone(a.gastos);
    const r = await entregar(await armar(a), io('cancelado'), a, AHORA);
    expect(r.estado).toBe('cancelado');
    expect(a.marcarLlamadas).toBe(0);
    expect(a.gastos).toEqual(antes);
    expect(a.eliminados).toHaveLength(1);
    expect(a.ultima).toBeNull();
    expect(pendientes(a)).toBe(3); // sigue todo pendiente
  });

  it('si hace falta un toque nuevo, tampoco marca', async () => {
    const a = new Almacen([gasto()]);
    const r = await entregar(await armar(a), io('requiere-gesto'), a, AHORA);
    expect(r.estado).toBe('requiere-gesto');
    expect(a.marcarLlamadas).toBe(0);
  });

  it('un error al compartir se propaga y no marca', async () => {
    const a = new Almacen([gasto()]);
    const falla = { compartir: vi.fn().mockRejectedValue(new Error('boom')), descargar: vi.fn() };
    await expect(entregar(await armar(a), falla, a, AHORA)).rejects.toThrow('boom');
    expect(a.marcarLlamadas).toBe(0);
    expect(falla.descargar).not.toHaveBeenCalled();
  });

  it('sin Web Share descarga y marca; "Deshacer marca" lo devuelve todo a pendiente', async () => {
    const a = new Almacen([gasto(), gasto({ exportadoEn: T1, editadoEn: T2 })], [{ id: 'b', cuentaId: 'personal', eliminadoEn: T2 }]);
    a.ultima = '2026-09-01T00:00:00.000Z';
    const original = structuredClone(a.gastos);
    const dispositivo = io('no-disponible');
    const listo = await armar(a);
    const r = await entregar(listo, dispositivo, a, AHORA);
    expect(r.estado).toBe('descargado');
    expect(dispositivo.descargar).toHaveBeenCalledTimes(1);
    const descargado = dispositivo.descargar.mock.calls[0]![0] as File;
    expect(descargado.name).toBe(listo.archivo.name);
    expect(descargado.type).toBe('application/octet-stream');
    expect(pendientes(a)).toBe(0);
    if (r.estado !== 'descargado') throw new Error('esperaba descargado');
    await a.revertir(r.previa);
    expect(a.gastos).toEqual(original);
    expect(a.eliminados.map((e) => e.id)).toEqual(['b']);
    expect(a.ultima).toBe('2026-09-01T00:00:00.000Z');
    expect(pendientes(a)).toBe(3);
  });

  it('deshacer marca tras compartir restaura exactamente los gastos de esa exportación y deja intactos los demás', async () => {
    const previoEditado = gasto({ exportadoEn: T1, editadoEn: T2 });
    const nuevo = gasto();
    const otraCuenta = gasto({ cuentaId: 'hogar' });
    const borrado: Eliminado = { id: 'b', cuentaId: 'personal', eliminadoEn: T2 };
    const a = new Almacen([previoEditado, nuevo, otraCuenta], [borrado]);
    a.ultima = '2026-09-01T00:00:00.000Z';
    const r = await entregar(await armar(a, { tipo: 'nuevos' }, 'personal'), io('compartido'), a, AHORA);
    if (r.estado !== 'compartido') throw new Error('esperaba compartido');
    expect(a.gastos.find((g) => g.id === otraCuenta.id)!.exportadoEn).toBeNull(); // otra cuenta: no se marcó
    expect(a.eliminados).toEqual([]);
    await a.revertir(r.previa);
    expect(a.gastos.find((g) => g.id === previoEditado.id)!.exportadoEn).toBe(T1); // el valor anterior exacto
    expect(a.gastos.find((g) => g.id === nuevo.id)!.exportadoEn).toBeNull();
    expect(a.gastos.find((g) => g.id === otraCuenta.id)!.exportadoEn).toBeNull();
    expect(a.eliminados).toEqual([borrado]);
    expect(a.ultima).toBe('2026-09-01T00:00:00.000Z');
    expect(pendientes(a, 'personal')).toBe(3);
  });

  it('forzar la descarga (desde el panel "Archivo listo") descarga y marca', async () => {
    const a = new Almacen([gasto()]);
    const dispositivo = io('compartido');
    const r = await entregar(await armar(a), dispositivo, a, AHORA, true);
    expect(r.estado).toBe('descargado');
    expect(dispositivo.compartir).not.toHaveBeenCalled();
    expect(pendientes(a)).toBe(0);
  });

  it('exportar un solo mes o un rango no marca gastos pero sí guarda la fecha de exportación', async () => {
    const a = new Almacen([gasto({ dia: '2026-10-03' })]);
    const antes = structuredClone(a.gastos);
    const r = await entregar(await armar(a, { tipo: 'mes', mes: { anio: 2026, mes: 9 } }), io('compartido'), a, AHORA);
    expect(r.estado).toBe('compartido');
    expect(a.gastos).toEqual(antes);
    expect(pendientes(a)).toBe(1);
    expect(a.ultima).toBe('2026-10-08T15:00:01.000Z');
    await entregar(await armar(a, { tipo: 'rango', desde: '2026-10-01', hasta: HOY }), io('compartido'), a, AHORA);
    expect(a.gastos).toEqual(antes);
  });

  it('exportar una sola cuenta marca solo los gastos y eliminados de esa cuenta', async () => {
    const personal = gasto();
    const hogar = gasto({ cuentaId: 'hogar' });
    const a = new Almacen(
      [personal, hogar],
      [
        { id: 'bp', cuentaId: 'personal', eliminadoEn: T2 },
        { id: 'bh', cuentaId: 'hogar', eliminadoEn: T2 },
      ],
    );
    await entregar(await armar(a, { tipo: 'nuevos' }, 'hogar'), io('compartido'), a, AHORA);
    expect(a.gastos.find((g) => g.id === hogar.id)!.exportadoEn).not.toBeNull();
    expect(a.gastos.find((g) => g.id === personal.id)!.exportadoEn).toBeNull();
    expect(a.eliminados.map((e) => e.id)).toEqual(['bp']);
    expect(pendientes(a, 'personal')).toBe(2);
    expect(pendientes(a, 'hogar')).toBe(0);
  });

  it('un gasto editado mientras se exportaba sigue pendiente', async () => {
    const g = gasto();
    const a = new Almacen([g]);
    const listo = await armar(a); // corte = 15:00:00
    a.gastos = [{ ...g, editadoEn: '2026-10-08T15:00:00.500Z' }]; // se edita antes de terminar de compartir
    await entregar(listo, io('compartido'), a, AHORA);
    expect(pendientes(a)).toBe(1);
  });

  it('el eliminado sale una vez como "eliminado" y luego no vuelve a salir', async () => {
    const a = new Almacen([], [{ id: 'borrado-1', cuentaId: 'personal', eliminadoEn: fechaHoraAIso('2026-10-07', '18:30') }]);
    const listo = await armar(a);
    expect(listo.eliminados).toBe(1);
    expect(await listo.archivo.text()).toContain('borrado-1;2026-10-07;18:30;;;;Personal;;;eliminado');
    await entregar(listo, io('compartido'), a, AHORA);
    expect(a.eliminados).toEqual([]);
    await expect(armar(a)).rejects.toThrow(MENSAJE_SIN_NUEVOS);
  });

  it('un gasto editado después de exportarse vuelve a salir como "editado"', async () => {
    const a = new Almacen([gasto()]);
    await entregar(await armar(a), io('compartido'), a, AHORA);
    a.gastos = a.gastos.map((g) => ({ ...g, nota: 'cambió', editadoEn: '2026-10-09T10:00:00.000Z' }));
    const listo = await armar(a, { tipo: 'nuevos' }, null, new Date('2026-10-09T11:00:00.000Z'));
    expect(await listo.archivo.text()).toMatch(/;cambió;;editado\r\n$/);
  });
});

describe('nombre y tipo del archivo entregado', () => {
  const csv = async (formato: 'csv' | 'zip') => {
    const a = new Almacen([gasto()]);
    const listo = await prepararArchivo(
      {
        seleccion: seleccionar(a.gastos, [], { tipo: 'nuevos' }, 'personal'),
        alcance: { tipo: 'nuevos' },
        formato,
        decimal: 'coma',
        categorias: CATEGORIAS,
        cuentas: CUENTAS,
        cuentaFiltro: 'personal',
        corte: NOMBRE,
      },
      async () => undefined,
    );
    return { a, listo };
  };

  it('el archivo creado conserva su tipo real (para Compartir) y el nombre pedido, sin doble extensión', async () => {
    const { listo } = await csv('csv');
    expect(listo.archivo.name).toBe('gastos_Personal_20261008-201005.csv');
    expect(listo.archivo.type).toBe('text/csv');
    expect((await csv('zip')).listo.archivo.name).toBe('gastos_Personal_20261008-201005.zip');
    expect((await csv('zip')).listo.archivo.type).toBe('application/zip');
  });
  it('la descarga usa application/octet-stream y exactamente el mismo nombre (evita ".csv.xls")', async () => {
    for (const formato of ['csv', 'zip'] as const) {
      const { listo } = await csv(formato);
      const d = archivoParaDescarga(listo.archivo);
      expect(d.type).toBe('application/octet-stream');
      expect(d.name).toBe(listo.archivo.name);
      expect(d.name).not.toMatch(/.(csv|zip).[a-z]+$/);
      expect(d.size).toBe(listo.archivo.size);
    }
  });
  it('el contenido de la descarga es idéntico (BOM incluido)', async () => {
    const { listo } = await csv('csv');
    const bytes = new Uint8Array(await archivoParaDescarga(listo.archivo).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it('al descargar, entregar pasa a io.descargar el archivo con tipo genérico, tanto sin Web Share como forzado', async () => {
    for (const forzar of [false, true]) {
      const { a, listo } = await csv('csv');
      const dispositivo = io('no-disponible');
      await entregar(listo, dispositivo, a, AHORA, forzar);
      const f = dispositivo.descargar.mock.calls[0]![0] as File;
      expect([f.name, f.type]).toEqual(['gastos_Personal_20261008-201005.csv', 'application/octet-stream']);
    }
  });
});

describe('registro de eliminados', () => {
  it('un gasto nunca exportado no deja registro (Sheets no lo conoce)', () => {
    expect(eliminadoDe(gasto(), new Date(T2))).toBeNull();
  });
  it('un gasto exportado deja id, cuenta y fecha del borrado', () => {
    const g = gasto({ exportadoEn: T1, cuentaId: 'hogar' });
    expect(eliminadoDe(g, new Date('2026-10-08T12:00:00.000Z'))).toEqual({
      id: g.id,
      cuentaId: 'hogar',
      eliminadoEn: '2026-10-08T12:00:00.000Z',
    });
  });
  it('Deshacer con el registro todavía guardado restaura el gasto tal cual', () => {
    const g = gasto({ exportadoEn: T1 });
    expect(restaurarTrasDeshacer(g, true)).toBe(g);
    expect(restaurarTrasDeshacer(gasto(), false).exportadoEn).toBeNull();
  });
  it('Deshacer cuando el borrado ya se exportó vuelve a dejar el gasto pendiente', () => {
    const g = gasto({ exportadoEn: T1 });
    expect(restaurarTrasDeshacer(g, false)).toEqual({ ...g, exportadoEn: null });
  });
});
