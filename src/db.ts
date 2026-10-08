import Dexie, { type Table } from 'dexie';
import type { Ajuste, Categoria, Foto, Gasto } from './types';

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
  monedasVisibles: ['COP', 'USD', 'EUR'],
  ultimaExportacion: null,
  versionEsquema: 1,
};

class GastosDB extends Dexie {
  gastos!: Table<Gasto, string>;
  fotos!: Table<Foto, string>;
  categorias!: Table<Categoria, string>;
  ajustes!: Table<Ajuste, string>;

  constructor() {
    super('gastos');
    this.version(1).stores({
      gastos: 'id, fecha, categoriaId, editadoEn',
      fotos: 'id',
      categorias: 'id, orden',
      ajustes: 'clave',
    });
    this.on('populate', (tx) => {
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
