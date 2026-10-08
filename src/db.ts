import Dexie, { type Table } from 'dexie';
import { completarCuenta, CUENTA_INICIAL, CUENTA_PERSONAL_ID } from './lib/cuentas';
import { limpiarFotosHuerfanas } from './lib/fotos';
import type { Ajuste, Categoria, Cuenta, Foto, Gasto } from './types';

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
  versionEsquema: 2,
};

class GastosDB extends Dexie {
  gastos!: Table<Gasto, string>;
  fotos!: Table<Foto, string>;
  categorias!: Table<Categoria, string>;
  cuentas!: Table<Cuenta, string>;
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
    this.on('populate', (tx) => {
      void tx.table('cuentas').bulkAdd([CUENTA_INICIAL]);
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
