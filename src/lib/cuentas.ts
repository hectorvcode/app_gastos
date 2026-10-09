import type { Cuenta } from '../types';

/** Id fijo de la cuenta que se crea al iniciar y que recibe los gastos anteriores a la Fase 4b. */
export const CUENTA_PERSONAL_ID = 'personal';

export const CUENTA_INICIAL: Cuenta = {
  id: CUENTA_PERSONAL_ID,
  nombre: 'Personal',
  emoji: '👤',
  orden: 0,
  archivada: false,
};

export const MAX_NOMBRE_CUENTA = 24;
export const EMOJI_CUENTA_POR_DEFECTO = '📒';
const MAX_EMOJI = 8; // unidades UTF-16: alcanza para un emoji con modificadores

// ---------- Migración ----------

/** Devuelve el gasto con `cuentaId`; si ya tenía una, no la toca. No cambia el resto del gasto. */
export function completarCuenta<T extends object>(
  gasto: T,
  cuentaId: string = CUENTA_PERSONAL_ID,
): T & { cuentaId: string } {
  return { ...gasto, cuentaId: (gasto as { cuentaId?: string }).cuentaId || cuentaId };
}

// ---------- Consulta ----------

export const ordenadas = (cuentas: readonly Cuenta[]): Cuenta[] =>
  [...cuentas].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

export const cuentasActivas = (cuentas: readonly Cuenta[]): Cuenta[] =>
  ordenadas(cuentas).filter((c) => !c.archivada);

/** El chip de cuenta en Registrar solo aparece si hay donde elegir. */
export const mostrarChipCuenta = (cuentas: readonly Cuenta[]): boolean => cuentasActivas(cuentas).length > 1;

export const etiquetaCuenta = (c: Pick<Cuenta, 'emoji' | 'nombre'>): string => `${c.emoji} ${c.nombre}`;

/** La predeterminada guardada si sigue activa; si no, la primera activa. */
export function resolverPredeterminada(guardada: unknown, cuentas: readonly Cuenta[]): string {
  const activas = cuentasActivas(cuentas);
  if (typeof guardada === 'string' && activas.some((c) => c.id === guardada)) return guardada;
  return activas[0]?.id ?? CUENTA_PERSONAL_ID;
}

/** Cuenta con la que abre Registrar: la última usada si sigue activa; si no, la predeterminada. */
export function resolverCuentaActual(ultima: unknown, cuentas: readonly Cuenta[], predeterminada: string): string {
  return typeof ultima === 'string' && cuentasActivas(cuentas).some((c) => c.id === ultima) ? ultima : predeterminada;
}

/** "Guardado", "Guardado el 5 oct", y " en <cuenta>" cuando no es la predeterminada. */
export function textoGuardado(fechaCorta: string | null, nombreCuenta: string | null): string {
  const base = fechaCorta ? `Guardado el ${fechaCorta}` : 'Guardado';
  return nombreCuenta ? `${base} en ${nombreCuenta}` : base;
}

// ---------- Acceso a ajustes (ultimaCuenta, cuentaPredeterminada) ----------

export interface RepoAjustesCuentas {
  get(clave: string): Promise<unknown>;
  set(clave: string, valor: unknown): Promise<void>;
}

export interface EstadoCuentas {
  predeterminada: string;
  actual: string;
}

export async function cargarEstadoCuentas(repo: RepoAjustesCuentas, cuentas: readonly Cuenta[]): Promise<EstadoCuentas> {
  const predeterminada = resolverPredeterminada(await repo.get('cuentaPredeterminada'), cuentas);
  const actual = resolverCuentaActual(await repo.get('ultimaCuenta'), cuentas, predeterminada);
  return { predeterminada, actual };
}

export async function guardarUltimaCuenta(repo: RepoAjustesCuentas, cuentaId: string): Promise<void> {
  await repo.set('ultimaCuenta', cuentaId);
}

export async function guardarCuentaPredeterminada(repo: RepoAjustesCuentas, cuentaId: string): Promise<void> {
  await repo.set('cuentaPredeterminada', cuentaId);
}

// ---------- Reglas de gestión ----------

/** `cuentas` es la lista completa (con `orden` renumerado) que hay que guardar. */
export type ResultadoCuentas = { ok: true; cuentas: Cuenta[] } | { ok: false; error: string };

const MSG_NO_EXISTE = 'Esa cuenta ya no existe. Cambia de pestaña y vuelve a Ajustes para actualizar la lista.';

const renumerar = (lista: readonly Cuenta[]): Cuenta[] => lista.map((c, orden) => ({ ...c, orden }));
const clave = (nombre: string): string => nombre.trim().toLocaleLowerCase('es');

function validarNombre(cuentas: readonly Cuenta[], nombre: string, idActual: string | null): string | null {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (limpio === '') return 'Escribe un nombre para la cuenta (por ejemplo Hogar).';
  if (limpio.length > MAX_NOMBRE_CUENTA) return `El nombre admite hasta ${MAX_NOMBRE_CUENTA} caracteres. Acórtalo.`;
  if (cuentas.some((c) => c.id !== idActual && clave(c.nombre) === clave(limpio))) {
    return 'Ya existe una cuenta con ese nombre. Escribe uno distinto.';
  }
  return null;
}

function limpiarEmoji(emoji: string): string {
  const e = emoji.trim();
  return e === '' ? EMOJI_CUENTA_POR_DEFECTO : e.slice(0, MAX_EMOJI);
}

/** `categoriaIds`: las categorías con las que empieza la cuenta (ver `idsIniciales` en lib/categorias.ts). */
export function crearCuenta(
  cuentas: readonly Cuenta[],
  nombre: string,
  emoji: string,
  id: string,
  categoriaIds?: string[],
): ResultadoCuentas {
  const error = validarNombre(cuentas, nombre, null);
  if (error) return { ok: false, error };
  const nueva: Cuenta = {
    id,
    nombre: nombre.trim().replace(/\s+/g, ' '),
    emoji: limpiarEmoji(emoji),
    orden: cuentas.length,
    archivada: false,
    ...(categoriaIds ? { categoriaIds: [...categoriaIds] } : {}),
  };
  return { ok: true, cuentas: renumerar([...ordenadas(cuentas), nueva]) };
}

export function editarCuenta(
  cuentas: readonly Cuenta[],
  id: string,
  cambios: { nombre?: string; emoji?: string },
): ResultadoCuentas {
  const actual = cuentas.find((c) => c.id === id);
  if (!actual) return { ok: false, error: MSG_NO_EXISTE };
  let nombre = actual.nombre;
  if (cambios.nombre !== undefined) {
    const error = validarNombre(cuentas, cambios.nombre, id);
    if (error) return { ok: false, error };
    nombre = cambios.nombre.trim().replace(/\s+/g, ' ');
  }
  const emoji = cambios.emoji !== undefined ? limpiarEmoji(cambios.emoji) : actual.emoji;
  return {
    ok: true,
    cuentas: ordenadas(cuentas).map((c) => (c.id === id ? { ...c, nombre, emoji } : c)),
  };
}

/** Sube (-1) o baja (+1) una cuenta entre las de su mismo grupo (activas o archivadas). */
export function moverCuenta(cuentas: readonly Cuenta[], id: string, direccion: -1 | 1): ResultadoCuentas {
  const lista = ordenadas(cuentas);
  const i = lista.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, error: MSG_NO_EXISTE };
  let j = i + direccion;
  while (j >= 0 && j < lista.length && lista[j]!.archivada !== lista[i]!.archivada) j += direccion;
  if (j < 0 || j >= lista.length) {
    return {
      ok: false,
      error: direccion < 0 ? 'Esa cuenta ya es la primera de la lista.' : 'Esa cuenta ya es la última de la lista.',
    };
  }
  [lista[i], lista[j]] = [lista[j]!, lista[i]!];
  return { ok: true, cuentas: renumerar(lista) };
}

/** Valida que `id` pueda ser la predeterminada (existe y está activa). */
export function validarPredeterminada(
  cuentas: readonly Cuenta[],
  id: string,
  actual?: string,
): { ok: true } | { ok: false; error: string } {
  const c = cuentas.find((x) => x.id === id);
  if (!c) return { ok: false, error: MSG_NO_EXISTE };
  if (id === actual) return { ok: false, error: `${c.nombre} ya es la cuenta predeterminada. Para cambiarla, elige otra cuenta.` };
  if (c.archivada) return { ok: false, error: 'Una cuenta archivada no puede ser la predeterminada. Desarchívala primero.' };
  return { ok: true };
}

/** No se archiva la predeterminada, y siempre debe quedar al menos una cuenta activa. */
export function archivarCuenta(cuentas: readonly Cuenta[], id: string, predeterminada: string): ResultadoCuentas {
  const c = cuentas.find((x) => x.id === id);
  if (!c) return { ok: false, error: MSG_NO_EXISTE };
  if (c.archivada) return { ok: true, cuentas: ordenadas(cuentas) };
  if (id === predeterminada) {
    return { ok: false, error: 'No puedes archivar la cuenta predeterminada. Elige otra como predeterminada primero.' };
  }
  if (cuentasActivas(cuentas).filter((x) => x.id !== id).length === 0) {
    return { ok: false, error: 'Debe quedar al menos una cuenta activa. Crea o desarchiva otra primero.' };
  }
  return { ok: true, cuentas: ordenadas(cuentas).map((x) => (x.id === id ? { ...x, archivada: true } : x)) };
}

export function desarchivarCuenta(cuentas: readonly Cuenta[], id: string): ResultadoCuentas {
  if (!cuentas.some((x) => x.id === id)) return { ok: false, error: MSG_NO_EXISTE };
  return { ok: true, cuentas: ordenadas(cuentas).map((x) => (x.id === id ? { ...x, archivada: false } : x)) };
}

/** Solo se borra una cuenta sin gastos (y que no sea la predeterminada). Devuelve la lista restante. */
export function borrarCuenta(
  cuentas: readonly Cuenta[],
  id: string,
  predeterminada: string,
  totalGastos: number,
): ResultadoCuentas {
  if (!cuentas.some((x) => x.id === id)) return { ok: false, error: MSG_NO_EXISTE };
  if (totalGastos > 0) {
    return { ok: false, error: 'Esta cuenta tiene gastos y no se puede borrar. Archívala en su lugar.' };
  }
  if (id === predeterminada) {
    return { ok: false, error: 'No puedes borrar la cuenta predeterminada. Elige otra como predeterminada primero.' };
  }
  const resto = ordenadas(cuentas).filter((x) => x.id !== id);
  if (cuentasActivas(resto).length === 0) return { ok: false, error: 'Debe quedar al menos una cuenta activa. Crea o desarchiva otra primero.' };
  return { ok: true, cuentas: renumerar(resto) };
}
