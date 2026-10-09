import type { Categoria, Cuenta } from '../types';

/** Lo que cabe en Registrar sin scroll: 3 columnas por 4 filas. */
export const MAX_VISIBLES = 12;
export const MAX_NOMBRE_CATEGORIA = 20;
export const EMOJI_CATEGORIA_POR_DEFECTO = '🏷️';
const MAX_EMOJI = 8; // unidades UTF-16: alcanza para un emoji con modificadores

const porOrden = (a: Categoria, b: Categoria): number => a.orden - b.orden || a.nombre.localeCompare(b.nombre);

export const catalogoActivo = (catalogo: readonly Categoria[]): Categoria[] =>
  [...catalogo].filter((c) => c.activa).sort(porOrden);

// ---------- Consulta ----------

/** Ids que una cuenta nueva (o una anterior a la Fase 7a) muestra: todas las activas, hasta 12, en el orden del catálogo. */
export const idsIniciales = (catalogo: readonly Categoria[]): string[] =>
  catalogoActivo(catalogo)
    .slice(0, MAX_VISIBLES)
    .map((c) => c.id);

/**
 * Ids visibles de la cuenta, en su orden. Descarta los que ya no existen o están ocultos del catálogo.
 * Si la lista quedara vacía (datos dañados) vuelve a las iniciales, para que Registrar nunca quede sin categorías.
 */
export function idsVisibles(cuenta: Pick<Cuenta, 'categoriaIds'> | undefined, catalogo: readonly Categoria[]): string[] {
  const activas = new Set(catalogoActivo(catalogo).map((c) => c.id));
  const propios = cuenta?.categoriaIds ? [...new Set(cuenta.categoriaIds)].filter((id) => activas.has(id)) : [];
  const ids = propios.slice(0, MAX_VISIBLES);
  return ids.length > 0 ? ids : idsIniciales(catalogo);
}

/** Las categorías que Registrar muestra para esa cuenta, en su orden. */
export function categoriasVisibles(cuenta: Pick<Cuenta, 'categoriaIds'> | undefined, catalogo: readonly Categoria[]): Categoria[] {
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  return idsVisibles(cuenta, catalogo).map((id) => porId.get(id)!);
}

/** Registrar: la cuadrícula de la cuenta actual (cambia al cambiar de cuenta). */
export function categoriasDeRegistrar(
  cuentas: readonly Cuenta[],
  cuentaId: string,
  catalogo: readonly Categoria[],
): Categoria[] {
  return categoriasVisibles(cuentas.find((c) => c.id === cuentaId), catalogo);
}

export interface OpcionCategoria {
  categoria: Categoria;
  /** false = no está en la cuadrícula de la cuenta (o está oculta del catálogo): se marca. */
  visible: boolean;
}

/**
 * Editar gasto: las visibles de la cuenta elegida, más la categoría original del gasto y la elegida
 * ahora cuando no están entre ellas (marcadas), para no perder la categoría al cambiar de cuenta.
 */
export function opcionesParaEdicion(
  cuenta: Pick<Cuenta, 'categoriaIds'> | undefined,
  catalogo: readonly Categoria[],
  originalId: string,
  elegidaId: string,
): OpcionCategoria[] {
  const lista: OpcionCategoria[] = categoriasVisibles(cuenta, catalogo).map((categoria) => ({ categoria, visible: true }));
  const enLista = new Set(lista.map((o) => o.categoria.id));
  for (const id of [originalId, elegidaId]) {
    const categoria = catalogo.find((c) => c.id === id);
    if (categoria && !enLista.has(id)) {
      enLista.add(id);
      lista.push({ categoria, visible: false });
    }
  }
  return lista;
}

/**
 * Marca de una categoría oculta en el filtro de Historial y en "Editar gasto". Visible: cadena vacía.
 * - Con una cuenta específica: oculta del catálogo → "(oculta)"; si esa cuenta no la muestra → "(oculta en <cuenta>)".
 * - Con "Todas las cuentas" (`cuenta` null, se pasan las cuentas activas): oculta del catálogo o sin ninguna cuenta
 *   activa que la muestre → "(oculta)"; si falta solo en algunas → "(oculta en Hogar)", "(oculta en Hogar y Negocio)"
 *   o, con 3 o más, "(oculta en 3 cuentas)"; visible en todas → sin marca.
 */
export function marcaOculta(
  categoria: Categoria,
  catalogo: readonly Categoria[],
  cuenta: Pick<Cuenta, 'nombre' | 'categoriaIds'> | null | undefined,
  activas: readonly Pick<Cuenta, 'nombre' | 'categoriaIds'>[] = [],
): string {
  if (!categoria.activa) return ' (oculta)';
  if (cuenta) return idsVisibles(cuenta, catalogo).includes(categoria.id) ? '' : ` (oculta en ${cuenta.nombre})`;
  const sin = activas.filter((c) => !idsVisibles(c, catalogo).includes(categoria.id));
  if (sin.length === 0) return '';
  if (sin.length === activas.length) return ' (oculta)';
  if (sin.length === 1) return ` (oculta en ${sin[0]!.nombre})`;
  if (sin.length === 2) return ` (oculta en ${sin[0]!.nombre} y ${sin[1]!.nombre})`;
  return ` (oculta en ${sin.length} cuentas)`;
}

// ---------- Avisos y Deshacer al ocultar ----------

export const textoOcultaEnCuenta = (categoria: string, cuenta: string): string => `${categoria} ya no aparece en ${cuenta}`;

export const textoOcultaEnTodas = (categoria: string, gastos: number): string =>
  `${categoria} se ocultó en todas las cuentas.` +
  (gastos === 0 ? '' : gastos === 1 ? ' Su gasto sigue en Historial' : ` Sus ${gastos} gastos siguen en Historial`);

/** Cómo estaba la visibilidad de una categoría antes de ocultarla, para deshacer exactamente. */
export interface PreviaVisibilidad {
  categoriaId: string;
  activa: boolean;
  listas: { cuentaId: string; ids: string[] }[];
}

/** Guarda el estado previo: la lista (con su orden) de la cuenta, o de todas si `cuentaId` es null. */
export function capturarPrevia(estado: EstadoCatalogo, categoriaId: string, cuentaId: string | null): PreviaVisibilidad {
  const cuentas = cuentaId === null ? estado.cuentas : estado.cuentas.filter((c) => c.id === cuentaId);
  return {
    categoriaId,
    activa: estado.categorias.find((c) => c.id === categoriaId)?.activa ?? true,
    listas: cuentas.map((c) => ({ cuentaId: c.id, ids: idsVisibles(c, estado.categorias) })),
  };
}

/** Deshacer: devuelve `activa` y las listas de las cuentas capturadas tal como estaban; no toca lo demás. */
export function deshacerVisibilidad(estado: EstadoCatalogo, previa: PreviaVisibilidad): ResultadoCatalogo {
  if (!estado.categorias.some((c) => c.id === previa.categoriaId)) return { ok: false, error: MSG_NO_EXISTE };
  const listas = new Map(previa.listas.map((l) => [l.cuentaId, l.ids]));
  return {
    ok: true,
    categorias: estado.categorias.map((c) => (c.id === previa.categoriaId ? { ...c, activa: previa.activa } : c)),
    cuentas: estado.cuentas.map((c) => (listas.has(c.id) ? { ...c, categoriaIds: [...listas.get(c.id)!] } : c)),
    borradas: [],
  };
}

// ---------- Migración ----------

/**
 * Fase 7a: las cuentas sin lista reciben todas las categorías activas actuales en su orden actual.
 * Las que ya tienen lista no se tocan. No toca gastos.
 */
export function migrarCuentas(cuentas: readonly Cuenta[], catalogo: readonly Categoria[]): Cuenta[] {
  const iniciales = idsIniciales(catalogo);
  return cuentas.map((c) => (Array.isArray(c.categoriaIds) ? c : { ...c, categoriaIds: [...iniciales] }));
}

// ---------- Reglas de gestión ----------

export interface EstadoCatalogo {
  categorias: Categoria[];
  cuentas: Cuenta[];
}

/**
 * `categorias` y `cuentas` son las listas completas que hay que guardar; `borradas` son los ids
 * que hay que quitar de la tabla. `aviso` explica algo que no fue un error (p. ej. no cupo en la cuenta).
 */
export type ResultadoCatalogo =
  | { ok: true; categorias: Categoria[]; cuentas: Cuenta[]; borradas: string[]; aviso?: string }
  | { ok: false; error: string };

const MSG_NO_EXISTE = 'Esa categoría ya no existe. Cambia de pestaña y vuelve a Ajustes para actualizar la lista.';
const MSG_CUENTA_NO_EXISTE = 'Esa cuenta ya no existe. Cambia de pestaña y vuelve a Ajustes para actualizar la lista.';
const MSG_LLENA =
  'Esta cuenta ya muestra 12 categorías. No caben más en Registrar sin scroll: oculta otra primero.';

const limpiarNombre = (nombre: string): string => nombre.trim().replace(/\s+/g, ' ');
const clave = (nombre: string): string => limpiarNombre(nombre).toLocaleLowerCase('es');

function limpiarEmoji(emoji: string): string {
  const e = emoji.trim();
  return e === '' ? EMOJI_CATEGORIA_POR_DEFECTO : e.slice(0, MAX_EMOJI);
}

function validarNombre(categorias: readonly Categoria[], nombre: string, idActual: string | null): string | null {
  const limpio = limpiarNombre(nombre);
  if (limpio === '') return 'Escribe un nombre para la categoría (por ejemplo Mascotas).';
  if (limpio.length > MAX_NOMBRE_CATEGORIA) {
    return `El nombre admite hasta ${MAX_NOMBRE_CATEGORIA} caracteres. Acórtalo.`;
  }
  if (categorias.some((c) => c.id !== idActual && clave(c.nombre) === clave(limpio))) {
    return 'Ya existe una categoría con ese nombre (aunque esté oculta). Escribe uno distinto.';
  }
  return null;
}

/** Cuentas con su lista ya completada (migración tardía) y limpia de categorías inactivas. */
function normalizarCuentas(estado: EstadoCatalogo): Cuenta[] {
  return migrarCuentas(estado.cuentas, estado.categorias).map((c) => ({ ...c, categoriaIds: idsVisibles(c, estado.categorias) }));
}

const conLista = (cuentas: readonly Cuenta[], cuentaId: string, ids: string[]): Cuenta[] =>
  cuentas.map((c) => (c.id === cuentaId ? { ...c, categoriaIds: ids } : c));

function cuentaDe(estado: EstadoCatalogo, cuentaId: string): { cuentas: Cuenta[]; ids: string[] } | null {
  const cuentas = normalizarCuentas(estado);
  const cuenta = cuentas.find((c) => c.id === cuentaId);
  return cuenta ? { cuentas, ids: cuenta.categoriaIds ?? [] } : null;
}

/** Muestra una categoría activa en la cuenta (al final de su lista). Máximo 12. */
export function mostrarEnCuenta(estado: EstadoCatalogo, cuentaId: string, categoriaId: string): ResultadoCatalogo {
  const cat = estado.categorias.find((c) => c.id === categoriaId);
  if (!cat) return { ok: false, error: MSG_NO_EXISTE };
  const base = cuentaDe(estado, cuentaId);
  if (!base) return { ok: false, error: MSG_CUENTA_NO_EXISTE };
  if (!cat.activa) {
    return { ok: false, error: `${cat.nombre} está oculta del catálogo. Muéstrala primero en la hoja de la categoría.` };
  }
  if (base.ids.includes(categoriaId)) return { ok: true, categorias: estado.categorias, cuentas: base.cuentas, borradas: [] };
  if (base.ids.length >= MAX_VISIBLES) return { ok: false, error: MSG_LLENA };
  return {
    ok: true,
    categorias: estado.categorias,
    cuentas: conLista(base.cuentas, cuentaId, [...base.ids, categoriaId]),
    borradas: [],
  };
}

/** Oculta una categoría solo en esa cuenta. Debe quedar al menos 1 visible. */
export function ocultarEnCuenta(estado: EstadoCatalogo, cuentaId: string, categoriaId: string): ResultadoCatalogo {
  const base = cuentaDe(estado, cuentaId);
  if (!base) return { ok: false, error: MSG_CUENTA_NO_EXISTE };
  if (!base.ids.includes(categoriaId)) return { ok: true, categorias: estado.categorias, cuentas: base.cuentas, borradas: [] };
  if (base.ids.length <= 1) {
    return { ok: false, error: 'Cada cuenta debe mostrar al menos 1 categoría. Muestra otra antes de ocultar esta.' };
  }
  return {
    ok: true,
    categorias: estado.categorias,
    cuentas: conLista(base.cuentas, cuentaId, base.ids.filter((id) => id !== categoriaId)),
    borradas: [],
  };
}

/** Sube (-1) o baja (+1) una categoría dentro del orden de esa cuenta. */
export function moverEnCuenta(
  estado: EstadoCatalogo,
  cuentaId: string,
  categoriaId: string,
  direccion: -1 | 1,
): ResultadoCatalogo {
  const base = cuentaDe(estado, cuentaId);
  if (!base) return { ok: false, error: MSG_CUENTA_NO_EXISTE };
  const i = base.ids.indexOf(categoriaId);
  if (i < 0) return { ok: false, error: 'Esa categoría no está visible en esta cuenta. Muéstrala para poder moverla.' };
  const j = i + direccion;
  if (j < 0 || j >= base.ids.length) {
    return {
      ok: false,
      error: direccion < 0 ? 'Esa categoría ya es la primera de la cuenta.' : 'Esa categoría ya es la última de la cuenta.',
    };
  }
  const ids = [...base.ids];
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return { ok: true, categorias: estado.categorias, cuentas: conLista(base.cuentas, cuentaId, ids), borradas: [] };
}

/**
 * Crea una categoría en el catálogo. Queda visible en la cuenta elegida (si hay cupo) y oculta en las demás.
 * Si la cuenta ya tiene 12, se crea igual, oculta, y `aviso` lo explica.
 */
export function crearCategoria(
  estado: EstadoCatalogo,
  nombre: string,
  emoji: string,
  id: string,
  cuentaId: string,
): ResultadoCatalogo {
  const error = validarNombre(estado.categorias, nombre, null);
  if (error) return { ok: false, error };
  const base = cuentaDe(estado, cuentaId);
  if (!base) return { ok: false, error: MSG_CUENTA_NO_EXISTE };
  const orden = estado.categorias.reduce((m, c) => Math.max(m, c.orden), -1) + 1;
  const nueva: Categoria = { id, nombre: limpiarNombre(nombre), emoji: limpiarEmoji(emoji), orden, activa: true };
  const cabe = base.ids.length < MAX_VISIBLES;
  return {
    ok: true,
    categorias: [...estado.categorias, nueva],
    cuentas: cabe ? conLista(base.cuentas, cuentaId, [...base.ids, id]) : base.cuentas,
    borradas: [],
    ...(cabe ? {} : { aviso: `${nueva.nombre} se creó, pero esta cuenta ya muestra 12 categorías: quedó oculta. Oculta otra para mostrarla.` }),
  };
}

/** Renombra o cambia el emoji. Solo toca el catálogo: los gastos (y su `editadoEn`) quedan intactos. */
export function editarCategoria(
  estado: EstadoCatalogo,
  id: string,
  cambios: { nombre?: string; emoji?: string },
): ResultadoCatalogo {
  const actual = estado.categorias.find((c) => c.id === id);
  if (!actual) return { ok: false, error: MSG_NO_EXISTE };
  let nombre = actual.nombre;
  if (cambios.nombre !== undefined) {
    const error = validarNombre(estado.categorias, cambios.nombre, id);
    if (error) return { ok: false, error };
    nombre = limpiarNombre(cambios.nombre);
  }
  const emoji = cambios.emoji !== undefined ? limpiarEmoji(cambios.emoji) : actual.emoji;
  return {
    ok: true,
    categorias: estado.categorias.map((c) => (c.id === id ? { ...c, nombre, emoji } : c)),
    cuentas: estado.cuentas,
    borradas: [],
  };
}

/** Quita `id` de todas las cuentas; falla si alguna se quedaría sin categorías. */
function quitarDeTodas(estado: EstadoCatalogo, id: string, categorias: Categoria[]): { cuentas: Cuenta[] } | { error: string } {
  const cuentas = normalizarCuentas(estado).map((c) => ({
    ...c,
    categoriaIds: (c.categoriaIds ?? []).filter((x) => x !== id),
  }));
  const vacia = cuentas.find((c) => idsVisiblesSinRespaldo(c, categorias).length === 0);
  if (vacia) {
    return {
      error: `La cuenta ${vacia.nombre} se quedaría sin categorías. Muestra otra en esa cuenta antes de quitar esta.`,
    };
  }
  return { cuentas };
}

const idsVisiblesSinRespaldo = (c: Cuenta, categorias: readonly Categoria[]): string[] => {
  const activas = new Set(catalogoActivo(categorias).map((x) => x.id));
  return (c.categoriaIds ?? []).filter((x) => activas.has(x));
};

/** Oculta del catálogo: desaparece de todas las cuentas (y se puede volver a mostrar). Los gastos conservan su categoría. */
export function ocultarDelCatalogo(estado: EstadoCatalogo, id: string): ResultadoCatalogo {
  const actual = estado.categorias.find((c) => c.id === id);
  if (!actual) return { ok: false, error: MSG_NO_EXISTE };
  const categorias = estado.categorias.map((c) => (c.id === id ? { ...c, activa: false } : c));
  const r = quitarDeTodas(estado, id, categorias);
  if ('error' in r) return { ok: false, error: r.error };
  return { ok: true, categorias, cuentas: r.cuentas, borradas: [] };
}

/** Vuelve a mostrar en el catálogo; queda visible en la cuenta elegida si hay cupo (como una categoría nueva). */
export function mostrarEnCatalogo(estado: EstadoCatalogo, id: string, cuentaId: string): ResultadoCatalogo {
  const actual = estado.categorias.find((c) => c.id === id);
  if (!actual) return { ok: false, error: MSG_NO_EXISTE };
  const base = cuentaDe(estado, cuentaId);
  if (!base) return { ok: false, error: MSG_CUENTA_NO_EXISTE };
  const categorias = estado.categorias.map((c) => (c.id === id ? { ...c, activa: true } : c));
  const cabe = base.ids.length < MAX_VISIBLES && !base.ids.includes(id);
  return {
    ok: true,
    categorias,
    cuentas: cabe ? conLista(base.cuentas, cuentaId, [...base.ids, id]) : base.cuentas,
    borradas: [],
    ...(cabe || base.ids.includes(id)
      ? {}
      : { aviso: `${actual.nombre} vuelve al catálogo, pero esta cuenta ya muestra 12 categorías: quedó oculta.` }),
  };
}

/** Borra del catálogo y de todas las cuentas. Solo si no tiene gastos; si los tiene, hay que ocultarla. */
export function borrarCategoria(estado: EstadoCatalogo, id: string, totalGastos: number): ResultadoCatalogo {
  const actual = estado.categorias.find((c) => c.id === id);
  if (!actual) return { ok: false, error: MSG_NO_EXISTE };
  if (totalGastos > 0) {
    return { ok: false, error: `${actual.nombre} tiene gastos y no se puede borrar. Ocúltala del catálogo en su lugar.` };
  }
  const resto = estado.categorias.filter((c) => c.id !== id);
  const r = quitarDeTodas(estado, id, resto);
  if ('error' in r) return { ok: false, error: r.error };
  return { ok: true, categorias: resto, cuentas: r.cuentas, borradas: [id] };
}
