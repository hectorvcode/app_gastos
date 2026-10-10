import Dexie, { type Table } from 'dexie';
import { idsIniciales, migrarCuentas, type EstadoCatalogo, type ResultadoCatalogo } from './lib/categorias';
import { completarCuenta, CUENTA_INICIAL, CUENTA_PERSONAL_ID } from './lib/cuentas';
import { aplicarMarca, eliminadoDe, restaurarTrasDeshacer, type MarcaPrevia, type PlanMarca } from './lib/exportar';
import { limpiarFotosHuerfanas } from './lib/fotos';
import type { EntradaRespaldo } from './lib/respaldo';
import type { EstadoLocal, RepoRestauracion } from './lib/restaurar';
import type { Ajuste, Categoria, Cuenta, Eliminado, Foto, Gasto } from './types';

export const CATEGORIAS_INICIALES: Categoria[] = [
  ['comida', 'Comida', '🍽️'],
  ['mercado', 'Mercado', '🛒'],
  ['transporte', 'Transporte', '🚌'],
  ['hogar', 'Hogar', '🏠'],
  ['salud', 'Salud', '💊'],
  ['ocio', 'Ocio', '🎉'],
  ['compras', 'Compras', '🛍️'],
  ['servicios', 'Servicios', '💡'],
  ['otros', 'Otros', '📦'],
].map(([id, nombre, emoji], orden) => ({
  id: id as string,
  nombre: nombre as string,
  emoji: emoji as string,
  orden,
  activa: true,
}));

export const AJUSTES_INICIALES: Record<string, unknown> = {
  monedaPredeterminada: 'COP',
  modoRecibo: true,
  monedasVisibles: ['COP', 'USD', 'EUR'],
  ultimaExportacion: null,
  cuentaPredeterminada: CUENTA_PERSONAL_ID,
  versionEsquema: 4,
};

class GastosDB extends Dexie {
  gastos!: Table<Gasto, string>;
  fotos!: Table<Foto, string>;
  categorias!: Table<Categoria, string>;
  cuentas!: Table<Cuenta, string>;
  eliminados!: Table<Eliminado, string>;
  ajustes!: Table<Ajuste, string>;

  constructor() {
    super('gastos');
    this.version(1).stores({
      gastos: 'id, fecha, categoriaId, editadoEn',
      fotos: 'id',
      categorias: 'id, orden',
      ajustes: 'clave',
    });
    // Fase 4b: cuentas. Dexie ejecuta la migración en una sola transacción: si algo falla,
    // la base queda en la versión 1 sin cambios.
    this.version(2)
      .stores({
        gastos: 'id, fecha, categoriaId, cuentaId, editadoEn',
        cuentas: 'id, orden',
      })
      .upgrade(async (tx) => {
        await tx.table('cuentas').put(CUENTA_INICIAL);
        await tx.table('ajustes').put({ clave: 'cuentaPredeterminada', valor: CUENTA_PERSONAL_ID });
        await tx.table('ajustes').put({ clave: 'versionEsquema', valor: 2 });
        await tx
          .table('gastos')
          .toCollection()
          .modify((g: { cuentaId?: string }) => {
            g.cuentaId = completarCuenta(g).cuentaId;
          });
      });
    // Fase 6: gastos eliminados que ya se habían exportado. Solo se agrega una tabla: los datos
    // existentes no se tocan, y si algo falla Dexie deja la base en la versión 2.
    this.version(3)
      .stores({ eliminados: 'id, cuentaId' })
      .upgrade(async (tx) => {
        await tx.table('ajustes').put({ clave: 'versionEsquema', valor: 3 });
      });
    // Fase 7a: cada cuenta guarda qué categorías muestra y en qué orden. No se crean tablas ni se tocan
    // los gastos; si algo falla Dexie deja la base en la versión 3.
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        const categorias = (await tx.table('categorias').toArray()) as Categoria[];
        const cuentas = (await tx.table('cuentas').toArray()) as Cuenta[];
        await tx.table('cuentas').bulkPut(migrarCuentas(cuentas, categorias));
        await tx.table('ajustes').put({ clave: 'versionEsquema', valor: 4 });
      });
    this.on('populate', (tx) => {
      void tx.table('cuentas').bulkAdd([{ ...CUENTA_INICIAL, categoriaIds: idsIniciales(CATEGORIAS_INICIALES) }]);
      void tx.table('categorias').bulkAdd(CATEGORIAS_INICIALES);
      void tx
        .table('ajustes')
        .bulkAdd(Object.entries(AJUSTES_INICIALES).map(([clave, valor]) => ({ clave, valor })));
    });
  }
}

export const db = new GastosDB();

export async function getAjuste<T>(clave: string, porDefecto: T): Promise<T> {
  const fila = await db.ajustes.get(clave);
  return fila ? (fila.valor as T) : porDefecto;
}

export async function setAjuste(clave: string, valor: unknown): Promise<void> {
  await db.ajustes.put({ clave, valor });
}

// ---------- Gastos con foto (cada operación es una sola transacción) ----------

/** Guarda el gasto y su foto: o se guardan las dos o ninguna. */
export function guardarGastoConFoto(gasto: Gasto, foto: Foto | null): Promise<void> {
  return db.transaction('rw', db.gastos, db.fotos, async () => {
    if (foto) await db.fotos.put(foto);
    await db.gastos.add(gasto);
  });
}

/** Borra un gasto y su foto (para Deshacer en Registrar, donde ya no hay nada que recuperar). */
export function borrarGastoConFoto(id: string): Promise<void> {
  return db.transaction('rw', db.gastos, db.fotos, async () => {
    const g = await db.gastos.get(id);
    await db.gastos.delete(id);
    if (g?.fotoId) await db.fotos.delete(g.fotoId);
  });
}

/** Guarda el gasto editado; la foto nueva se agrega y la vieja se elimina recién aquí, en la misma transacción. */
export function guardarEdicionConFoto(gasto: Gasto, fotoNueva: Foto | null, fotoABorrar: string | null): Promise<void> {
  return db.transaction('rw', db.gastos, db.fotos, async () => {
    if (fotoNueva) await db.fotos.put(fotoNueva);
    await db.gastos.put(gasto);
    if (fotoABorrar) await db.fotos.delete(fotoABorrar);
  });
}

/** Borra las fotos sin gasto asociado (quedan así si la app se cierra durante un aviso de Deshacer). */
export function limpiarHuerfanasEnDb(): Promise<number> {
  return db.transaction('rw', db.gastos, db.fotos, () =>
    limpiarFotosHuerfanas({
      leer: async () => {
        const enUso: string[] = [];
        await db.gastos.each((g) => {
          if (g.fotoId) enUso.push(g.fotoId);
        });
        return { fotos: (await db.fotos.toCollection().primaryKeys()) as string[], enUso };
      },
      borrar: (ids) => db.fotos.bulkDelete(ids),
    }),
  );
}

// ---------- Fase 7a: catálogo de categorías ----------

/**
 * Aplica un cambio al catálogo y a las listas de las cuentas en una sola transacción.
 * `contarGastosDe`: id de la categoría cuyos gastos se cuentan dentro de la misma transacción (para borrar).
 */
export function modificarCatalogo(
  operar: (estado: EstadoCatalogo, totalGastos: number) => ResultadoCatalogo,
  contarGastosDe?: string,
): Promise<ResultadoCatalogo> {
  return db.transaction('rw', db.categorias, db.cuentas, db.gastos, async () => {
    const [categorias, cuentas] = await Promise.all([db.categorias.toArray(), db.cuentas.toArray()]);
    const total = contarGastosDe ? await db.gastos.where('categoriaId').equals(contarGastosDe).count() : 0;
    const r = operar({ categorias, cuentas }, total);
    if (!r.ok) return r;
    if (r.borradas.length > 0) await db.categorias.bulkDelete(r.borradas);
    await db.categorias.bulkPut(r.categorias);
    await db.cuentas.bulkPut(r.cuentas);
    return r;
  });
}

export async function borrarAjuste(clave: string): Promise<void> {
  await db.ajustes.delete(clave);
}

/** Borrador del gasto en curso y su foto pendiente (viven en la tabla `ajustes`; sirve sin HTTPS). */
export const repoBorrador = {
  get: (clave: string): Promise<unknown> => getAjuste<unknown>(clave, undefined),
  set: setAjuste,
  delete: borrarAjuste,
};

/** Ajustes en la forma que usa `lib/monedas.ts`. */
export const repoAjustes = {
  get: (clave: string): Promise<unknown> => getAjuste<unknown>(clave, undefined),
  set: setAjuste,
};

// ---------- Fase 6: exportación ----------

/** Borra el gasto desde Historial; si ya se había exportado, deja el registro del borrado (misma transacción). */
export function eliminarGastoRegistrando(id: string): Promise<void> {
  return db.transaction('rw', db.gastos, db.eliminados, async () => {
    const g = await db.gastos.get(id);
    await db.gastos.delete(id);
    const e = g ? eliminadoDe(g, new Date()) : null;
    if (e) await db.eliminados.put(e);
  });
}

/** Deshacer del borrado en Historial: devuelve el gasto y quita el registro del borrado. */
export function restaurarGastoEliminado(g: Gasto): Promise<void> {
  return db.transaction('rw', db.gastos, db.eliminados, async () => {
    const registro = await db.eliminados.get(g.id);
    await db.gastos.add(restaurarTrasDeshacer(g, registro !== undefined));
    if (registro) await db.eliminados.delete(g.id);
  });
}

/** Lo necesario para exportar, leído de una vez. */
export async function leerParaExportar(): Promise<{
  gastos: Gasto[];
  eliminados: Eliminado[];
  categorias: Categoria[];
  cuentas: Cuenta[];
}> {
  const [gastos, eliminados, categorias, cuentas] = await Promise.all([
    db.gastos.toArray(),
    db.eliminados.toArray(),
    db.categorias.toArray(),
    db.cuentas.toArray(),
  ]);
  return { gastos, eliminados, categorias, cuentas };
}

// ---------- Fase 7b: respaldo, restauración y almacenamiento ----------

/**
 * Lee todo lo que va en el respaldo en una sola transacción de lectura (una foto de un instante coherente),
 * incluidos los blobs de las fotos que usan los gastos. Las fotos sin gasto (huérfanas) no se respaldan.
 */
export function leerParaRespaldo(): Promise<EntradaRespaldo> {
  return db.transaction('r', [db.gastos, db.categorias, db.cuentas, db.eliminados, db.ajustes, db.fotos], async () => {
    const [gastos, categorias, cuentas, eliminados, ajustes] = await Promise.all([
      db.gastos.toArray(),
      db.categorias.toArray(),
      db.cuentas.toArray(),
      db.eliminados.toArray(),
      db.ajustes.toArray(),
    ]);
    const ids = [...new Set(gastos.map((g) => g.fotoId).filter((x): x is string => x !== null))];
    const fotos: Foto[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      for (const f of await db.fotos.bulkGet(ids.slice(i, i + 50))) if (f) fotos.push(f);
    }
    return { gastos, categorias, cuentas, eliminados, ajustes, fotos };
  });
}

/** Lo que hay ahora en la base, para planificar la fusión de un respaldo. */
export async function leerEstadoLocal(): Promise<EstadoLocal> {
  const [gastos, categorias, cuentas, eliminados, ajustes, fotosIds] = await Promise.all([
    db.gastos.toArray(),
    db.categorias.toArray(),
    db.cuentas.toArray(),
    db.eliminados.toArray(),
    db.ajustes.toArray(),
    db.fotos.toCollection().primaryKeys(),
  ]);
  return { gastos, categorias, cuentas, eliminados, ajustes, fotosIds: new Set(fotosIds as string[]) };
}

/** Restauración: todas las tablas en UNA transacción; si algo lanza, Dexie la revierte y no queda nada a medias. */
export const repoRestauracion: RepoRestauracion = {
  transaccion: (operar) =>
    db.transaction('rw', [db.gastos, db.fotos, db.categorias, db.cuentas, db.eliminados, db.ajustes], () =>
      operar({
        gastos: (f) => db.gastos.bulkPut(f).then(() => undefined),
        fotos: (f) => db.fotos.bulkPut(f).then(() => undefined),
        categorias: (f) => db.categorias.bulkPut(f).then(() => undefined),
        cuentas: (f) => db.cuentas.bulkPut(f).then(() => undefined),
        eliminados: (f) => db.eliminados.bulkPut(f).then(() => undefined),
        ajustes: (f) => db.ajustes.bulkPut(f).then(() => undefined),
      }),
    ),
};

/** Cantidad de gastos y de fotos, y el peso aproximado de las fotos (suma de los blobs, sin las miniaturas). */
export async function contarAlmacenamiento(): Promise<{ gastos: number; fotos: number; bytesFotos: number }> {
  const [gastos, fotos] = await Promise.all([db.gastos.count(), db.fotos.count()]);
  let bytesFotos = 0;
  await db.fotos.each((f) => {
    bytesFotos += f.blob.size + (f.miniatura?.size ?? 0);
  });
  return { gastos, fotos, bytesFotos };
}

export const repoMarcas = {
  marcar(plan: PlanMarca, ultimaExportacion: string): Promise<MarcaPrevia> {
    return db.transaction('rw', db.gastos, db.eliminados, db.ajustes, async () => {
      const ultimaPrevia = (await db.ajustes.get('ultimaExportacion'))?.valor ?? null;
      const gastos = plan.marca ? (await db.gastos.bulkGet(plan.ids)).filter((g): g is Gasto => g !== undefined) : [];
      const eliminados = plan.marca
        ? (await db.eliminados.bulkGet(plan.eliminadosIds)).filter((e): e is Eliminado => e !== undefined)
        : [];
      const r = aplicarMarca(gastos, eliminados, plan, ultimaPrevia);
      await db.gastos.bulkPut(r.gastos);
      await db.eliminados.bulkDelete(r.eliminadosABorrar);
      await db.ajustes.put({ clave: 'ultimaExportacion', valor: ultimaExportacion });
      return r.previa;
    });
  },
  revertir(previa: MarcaPrevia): Promise<void> {
    return db.transaction('rw', db.gastos, db.eliminados, db.ajustes, async () => {
      // Solo se restaura exportadoEn: si el gasto se editó entremedio, sus demás cambios se conservan.
      for (const x of previa.gastos) await db.gastos.update(x.id, { exportadoEn: x.exportadoEn });
      await db.eliminados.bulkPut(previa.eliminados);
      await db.ajustes.put({ clave: 'ultimaExportacion', valor: previa.ultimaExportacion });
    });
  },
};
