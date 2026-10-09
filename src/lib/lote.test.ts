import { describe, expect, it, vi } from 'vitest';
import type { Gasto } from '../types';
import { crearBitacora } from './bitacora';
import {
  compartirArchivos,
  dividirEnTandas,
  MAX_ARCHIVOS_TANDA,
  MAX_BYTES_TANDA,
  opcionesDeEntrega,
  planificarLote,
  type PlanLote,
  puedeCompartir,
  type ResultadoCompartir,
} from './compartir';
import {
  armarLote,
  AVISO_ZIP_HTTP,
  debeAvisarZipHttp,
  entregar,
  entregarTanda,
  prepararArchivo,
  type ArchivoListo,
  type MarcaPrevia,
  type PlanMarca,
  type RepoMarcas,
} from './exportar';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36';
const error = (name: string): Error => Object.assign(new Error(name), { name });
const archivo = (nombre: string, bytes = 100, tipo = 'image/jpeg'): File => new File([new Uint8Array(bytes)], nombre, { type: tipo });
const fotos = (n: number, bytes = 100): File[] => Array.from({ length: n }, (_, i) => archivo(`f${i}.jpg`, bytes));

/** Chrome en Android: acepta imágenes, texto/CSV y PDF, pero no ZIP. */
function androidSinZip(share = vi.fn(async () => {})) {
  return {
    userAgent: ANDROID,
    share,
    canShare: (d: ShareData) => (d.files ?? []).every((f) => /^(image\/|text\/|application\/pdf)/.test(f.type)) && (d.files?.length ?? 0) <= 10,
  };
}

describe('qué opciones mostrar según canShare y el formato', () => {
  const ok: PlanLote = { ok: true, tandas: [[archivo('a.csv', 1, 'text/csv')]] };
  const no: PlanLote = { ok: false, motivo: 'x' };

  it('en escritorio solo se descarga (aunque el navegador diga que sí puede compartir)', () => {
    for (const formato of ['csv', 'zip'] as const) {
      expect(opcionesDeEntrega({ formato, movil: false, puedeCompartirArchivo: true, lote: ok })).toEqual({
        compartirArchivo: false,
        compartirLote: false,
        descargar: true,
      });
    }
  });
  it('CSV en el celular: compartir si canShare lo permite; nunca el lote', () => {
    expect(opcionesDeEntrega({ formato: 'csv', movil: true, puedeCompartirArchivo: true, lote: null })).toEqual({
      compartirArchivo: true,
      compartirLote: false,
      descargar: true,
    });
    expect(opcionesDeEntrega({ formato: 'csv', movil: true, puedeCompartirArchivo: false, lote: null }).compartirArchivo).toBe(false);
  });
  it('ZIP que Chrome no deja compartir: no se ofrece Compartir ZIP, sí "datos y fotos" y Descargar', () => {
    expect(opcionesDeEntrega({ formato: 'zip', movil: true, puedeCompartirArchivo: false, lote: ok })).toEqual({
      compartirArchivo: false,
      compartirLote: true,
      descargar: true,
    });
  });
  it('ZIP permitido: se ofrecen las tres', () => {
    expect(opcionesDeEntrega({ formato: 'zip', movil: true, puedeCompartirArchivo: true, lote: ok })).toEqual({
      compartirArchivo: true,
      compartirLote: true,
      descargar: true,
    });
  });
  it('si el lote no se puede compartir solo queda Descargar', () => {
    expect(opcionesDeEntrega({ formato: 'zip', movil: true, puedeCompartirArchivo: false, lote: no })).toEqual({
      compartirArchivo: false,
      compartirLote: false,
      descargar: true,
    });
  });
  it('con un Chrome de celular que no admite ZIP, puedeCompartir lo detecta', () => {
    const zip = archivo('gastos.zip', 1000, 'application/zip');
    expect(puedeCompartir([zip], androidSinZip())).toBe(false);
    expect(puedeCompartir([archivo('gastos.csv', 10, 'text/csv')], androidSinZip())).toBe(true);
    expect(puedeCompartir([zip], { userAgent: WINDOWS, share: vi.fn(), canShare: () => true })).toBe(false);
  });
});

describe('lista de archivos de "Compartir datos y fotos"', () => {
  it('el CSV va primero y las fotos conservan los nombres de la columna foto', () => {
    const lote = armarLote('﻿id;foto\r\n', 'gastos_20261008-201005.csv', [
      { nombre: '3f2a9c1e.jpg', blob: new Blob([new Uint8Array(5)]) },
      { nombre: '00000002.jpg', blob: new Blob([new Uint8Array(7)]) },
    ]);
    expect(lote.map((f) => f.name)).toEqual(['gastos_20261008-201005.csv', '3f2a9c1e.jpg', '00000002.jpg']);
    expect(lote.map((f) => f.type)).toEqual(['text/csv', 'image/jpeg', 'image/jpeg']);
    expect(lote[1]!.size).toBe(5);
  });

  it('prepararArchivo en ZIP deja el lote coherente con el CSV y con las fotos del ZIP', async () => {
    const g = (n: number, fotoId: string | null): Gasto => ({
      id: `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`,
      fecha: new Date(2026, 9, 7, 10).toISOString(),
      monto: 1000,
      moneda: 'COP',
      categoriaId: 'comida',
      cuentaId: 'personal',
      nota: '',
      fotoId,
      creadoEn: '2026-10-01T00:00:00.000Z',
      editadoEn: '2026-10-01T00:00:00.000Z',
      exportadoEn: null,
    });
    const gastos = [g(1, 'f1'), g(2, null), g(3, 'f3')];
    const listo = await prepararArchivo(
      {
        seleccion: { gastos, eliminados: [] },
        alcance: { tipo: 'nuevos' },
        formato: 'zip',
        decimal: 'coma',
        categorias: [{ id: 'comida', nombre: 'Comida' }],
        cuentas: [{ id: 'personal', nombre: 'Personal' }],
        cuentaFiltro: null,
        corte: new Date(2026, 9, 8, 20, 10, 5),
      },
      async () => ({ blob: new Blob([new Uint8Array(9)]) }),
    );
    expect(listo.lote).not.toBeNull();
    const [csv, ...fts] = listo.lote!;
    expect(csv!.name).toBe('gastos_20261008-201005.csv');
    expect(fts.map((f) => f.name)).toEqual(['00000001.jpg', '00000003.jpg']);
    const texto = await csv!.text();
    for (const f of fts) expect(texto).toContain(`;${f.name};`);
  });

  it('en CSV no hay lote', async () => {
    const listo = await prepararArchivo(
      {
        seleccion: { gastos: [{ id: 'a', fecha: new Date().toISOString(), monto: 1, moneda: 'COP', categoriaId: 'x', cuentaId: 'p', nota: '', fotoId: null, creadoEn: '', editadoEn: '', exportadoEn: null }], eliminados: [] },
        alcance: { tipo: 'todo' },
        formato: 'csv',
        decimal: 'punto',
        categorias: [],
        cuentas: [],
        cuentaFiltro: null,
        corte: new Date(),
      },
      async () => undefined,
    );
    expect(listo.lote).toBeNull();
  });
});

describe('división en tandas', () => {
  it('pocas fotos caben en una sola tanda', () => {
    const t = dividirEnTandas([archivo('a.csv', 10, 'text/csv'), ...fotos(5)]);
    expect(t).toHaveLength(1);
    expect(t[0]).toHaveLength(6);
  });
  it('por cantidad: el CSV queda primero y cada tanda respeta el máximo', () => {
    const csv = archivo('a.csv', 10, 'text/csv');
    const todos = [csv, ...fotos(25)];
    const t = dividirEnTandas(todos);
    expect(t.map((x) => x.length)).toEqual([MAX_ARCHIVOS_TANDA, MAX_ARCHIVOS_TANDA, 6]);
    expect(t[0]![0]).toBe(csv);
    expect(t.flat()).toEqual(todos); // sin perder ni repetir archivos, en el mismo orden
  });
  it('por peso: no se pasa del tope de bytes por tanda', () => {
    const t = dividirEnTandas(fotos(6, 6 * 1024 * 1024));
    for (const x of t) expect(x.reduce((s, f) => s + f.size, 0)).toBeLessThanOrEqual(MAX_BYTES_TANDA);
    expect(t.length).toBe(2);
    expect(t.flat()).toHaveLength(6);
  });
  it('un archivo más grande que el tope va solo en su tanda', () => {
    const grande = archivo('grande.jpg', MAX_BYTES_TANDA + 1);
    const t = dividirEnTandas([archivo('a.csv', 1, 'text/csv'), grande, archivo('b.jpg', 1)]);
    expect(t.map((x) => x.map((f) => f.name))).toEqual([['a.csv'], ['grande.jpg'], ['b.jpg']]);
  });
  it('sin archivos no hay tandas', () => {
    expect(dividirEnTandas([])).toEqual([]);
  });
});

describe('planificarLote', () => {
  it('con canShare en cada tanda, devuelve las tandas', () => {
    const p = planificarLote([archivo('a.csv', 1, 'text/csv'), ...fotos(12)], androidSinZip());
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.tandas.map((t) => t.length)).toEqual([10, 3]);
  });
  it('si Chrome no acepta una tanda, avisa cuál y por qué', () => {
    const nav = { userAgent: ANDROID, share: vi.fn(), canShare: (d: ShareData) => (d.files?.length ?? 0) <= 3 };
    const p = planificarLote([archivo('a.csv', 1, 'text/csv'), ...fotos(5)], nav);
    expect(p).toEqual({ ok: false, motivo: expect.stringMatching(/tanda 1 de 1 \(6 archivos/) });
  });
  it('en escritorio o sin Web Share no hay lote', () => {
    expect(planificarLote([archivo('a.csv')], { userAgent: WINDOWS, share: vi.fn(), canShare: () => true }).ok).toBe(false);
    expect(planificarLote([archivo('a.csv')], { userAgent: ANDROID }).ok).toBe(false);
  });
});

describe('compartirArchivos', () => {
  it('con toque reciente, NotAllowedError significa que Chrome no permite ese archivo (rechazado)', async () => {
    const share = vi.fn().mockRejectedValue(error('NotAllowedError'));
    const nav = { userAgent: ANDROID, share, canShare: () => true };
    expect(await compartirArchivos([archivo('a.zip', 1, 'application/zip')], nav, { toqueReciente: true })).toBe('rechazado');
    expect(await compartirArchivos([archivo('a.zip', 1, 'application/zip')], nav)).toBe('requiere-gesto');
  });
  it('comparte varios archivos juntos y deja registro de cada paso', async () => {
    const share = vi.fn(async () => {});
    const pasos: string[] = [];
    const r = await compartirArchivos([archivo('a.csv', 1, 'text/csv'), ...fotos(2)], androidSinZip(share), {
      anotar: (p) => pasos.push(p),
    });
    expect(r).toBe('compartido');
    expect((share.mock.calls[0] as unknown as [ShareData])[0].files).toHaveLength(3);
    expect(pasos).toEqual(['compartir: canShare', 'compartir: share()', 'compartir: share() terminó']);
  });
  it('anota por qué falló cuando share() lanza un error', async () => {
    const pasos: unknown[] = [];
    const nav = { userAgent: ANDROID, share: vi.fn().mockRejectedValue(error('DataError')), canShare: () => true };
    await expect(compartirArchivos([archivo('a.csv')], nav, { anotar: (p, d) => pasos.push([p, d]) })).rejects.toThrow('DataError');
    expect(JSON.stringify(pasos)).toContain('DataError');
  });
});

// ---------- Compartir por tandas: marcar solo al terminar ----------

class Repo implements RepoMarcas {
  llamadas = 0;
  async marcar(): Promise<MarcaPrevia> {
    this.llamadas++;
    return { gastos: [], eliminados: [], ultimaExportacion: null };
  }
  async revertir(): Promise<void> {}
}
const PLAN: PlanMarca = { marca: true, ids: ['a'], eliminadosIds: [], corte: '2026-10-08T15:00:00.000Z' };
const AHORA = (): Date => new Date('2026-10-08T15:00:01.000Z');

describe('entregarTanda', () => {
  const tandas = [fotos(2), fotos(2), fotos(1)];

  it('las tandas intermedias no marcan; la última marca una sola vez', async () => {
    const repo = new Repo();
    const compartir = vi.fn(async (): Promise<ResultadoCompartir> => 'compartido');
    expect(await entregarTanda(tandas, 0, PLAN, compartir, repo, AHORA)).toEqual({ estado: 'tanda', indice: 0, total: 3 });
    expect(await entregarTanda(tandas, 1, PLAN, compartir, repo, AHORA)).toEqual({ estado: 'tanda', indice: 1, total: 3 });
    expect(repo.llamadas).toBe(0);
    const ultimo = await entregarTanda(tandas, 2, PLAN, compartir, repo, AHORA);
    expect(ultimo.estado).toBe('completo');
    expect(repo.llamadas).toBe(1);
    expect(compartir).toHaveBeenCalledTimes(3);
  });
  it('cancelar una tanda no marca nada', async () => {
    const repo = new Repo();
    expect(await entregarTanda(tandas, 2, PLAN, async () => 'cancelado', repo, AHORA)).toEqual({ estado: 'cancelado' });
    expect(repo.llamadas).toBe(0);
  });
  it('una tanda rechazada por Chrome no marca nada', async () => {
    const repo = new Repo();
    for (const r of ['rechazado', 'requiere-gesto', 'no-disponible'] as const) {
      expect(await entregarTanda(tandas, 2, PLAN, async () => r, repo, AHORA)).toEqual({ estado: 'rechazado' });
    }
    expect(repo.llamadas).toBe(0);
  });
  it('un error al compartir se propaga sin marcar', async () => {
    const repo = new Repo();
    await expect(entregarTanda(tandas, 0, PLAN, async () => Promise.reject(new Error('boom')), repo, AHORA)).rejects.toThrow('boom');
    expect(repo.llamadas).toBe(0);
  });
  it('una tanda que no existe es un error, no un silencio', async () => {
    await expect(entregarTanda(tandas, 7, PLAN, async () => 'compartido', new Repo(), AHORA)).rejects.toThrow(/tanda 8/);
  });
});

describe('entregar con un archivo rechazado por Chrome', () => {
  it('no marca nada ni descarga por su cuenta', async () => {
    const repo = new Repo();
    const io = { compartir: vi.fn(async (): Promise<ResultadoCompartir> => 'rechazado'), descargar: vi.fn() };
    const listo = { archivo: archivo('a.zip', 1, 'application/zip'), lote: null, gastos: 1, eliminados: 0, fotosFaltantes: 0, plan: PLAN } as ArchivoListo;
    expect(await entregar(listo, io, repo, AHORA)).toEqual({ estado: 'rechazado' });
    expect(repo.llamadas).toBe(0);
    expect(io.descargar).not.toHaveBeenCalled();
  });
});

describe('aviso de ZIP por HTTP', () => {
  it('solo cuando no es contexto seguro y el formato es ZIP', () => {
    expect(debeAvisarZipHttp(false, 'zip')).toBe(true);
    expect(debeAvisarZipHttp(true, 'zip')).toBe(false);
    expect(debeAvisarZipHttp(false, 'csv')).toBe(false);
    expect(AVISO_ZIP_HTTP).toBe('Por HTTP, Chrome puede bloquear la descarga del ZIP; toca Conservar en el aviso de Chrome.');
  });
});

describe('bitácora', () => {
  it('guarda cada paso con la hora, lo manda a la consola y limita el tamaño', () => {
    const consola = { info: vi.fn() };
    const b = crearBitacora(3, () => new Date(2026, 9, 8, 20, 10, 5, 7), consola);
    b.anotar('uno');
    b.anotar('dos', { x: 1 });
    expect(b.texto()).toBe('20:10:05.007 uno\n20:10:05.007 dos {"x":1}');
    expect(consola.info).toHaveBeenCalledWith('[exportar]', 'dos', { x: 1 });
    b.anotar('tres');
    b.anotar('cuatro');
    expect(b.texto().split('\n')).toHaveLength(3);
    expect(b.texto()).not.toContain('uno');
    b.limpiar();
    expect(b.texto()).toBe('');
  });
});
