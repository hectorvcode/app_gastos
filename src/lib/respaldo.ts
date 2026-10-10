import type { Ajuste, Categoria, Cuenta, Eliminado, Foto, Gasto } from '../types';
import { marcaDeTiempo, type Progreso } from './exportar';

/**
 * Respaldo completo (Fase 7b): un ZIP con `datos.json` y los JPEG tal como están guardados
 * (`fotos/<id>.jpg`, más una miniatura en `miniaturas/<id>.jpg` para que Historial no cargue las fotos enteras).
 * Sin DOM: se prueba con Vitest.
 */

export const FORMATO_RESPALDO = 'app-gastos-respaldo';
/** Cambia solo si el diseño del archivo deja de ser legible por las versiones anteriores. */
export const VERSION_FORMATO = 1;
/** `versionEsquema` de la base de datos (Dexie) con la que se creó el respaldo. */
export const VERSION_ESQUEMA = 4;

export const ARCHIVO_DATOS = 'datos.json';

/** Ajustes que no se respaldan: son temporales o describen al propio respaldo. */
const AJUSTES_EXCLUIDOS = new Set([
  'borrador',
  'fotoPendiente',
  'ultimoRespaldo',
  'recordatorioRespaldoCerrado',
  'versionEsquema',
]);
export const esAjusteRespaldable = (clave: string): boolean => !AJUSTES_EXCLUIDOS.has(clave);

export interface FotoMeta {
  id: string;
  /** Ruta dentro del ZIP: `fotos/<id>.jpg`. */
  archivo: string;
  /** Ruta de la miniatura dentro del ZIP, o null si la foto no tenía. */
  miniatura: string | null;
  ancho: number;
  alto: number;
  bytes: number;
}

export interface DatosRespaldo {
  formato: typeof FORMATO_RESPALDO;
  versionFormato: number;
  versionEsquema: number;
  /** ISO del momento en que se creó el respaldo. */
  creadoEn: string;
  gastos: Gasto[];
  categorias: Categoria[];
  /** Con su `categoriaIds` (categorías visibles y orden). */
  cuentas: Cuenta[];
  ajustes: Record<string, unknown>;
  eliminados: Eliminado[];
  fotos: FotoMeta[];
}

/** Un archivo que no sirve como respaldo; el mensaje dice el motivo y se muestra tal cual. */
export class ErrorRespaldo extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErrorRespaldo';
  }
}

/** `respaldo_gastos_AAAAMMDD-HHMMSS.zip` (fecha y hora locales). */
export const nombreRespaldo = (ahora: Date): string => `respaldo_gastos_${marcaDeTiempo(ahora)}.zip`;

// ---------- Crear ----------

export type FotoRespaldable = Pick<Foto, 'id' | 'blob' | 'ancho' | 'alto'> & Partial<Pick<Foto, 'miniatura'>>;

export interface EntradaRespaldo {
  gastos: readonly Gasto[];
  categorias: readonly Categoria[];
  cuentas: readonly Cuenta[];
  eliminados: readonly Eliminado[];
  ajustes: readonly Ajuste[];
  fotos: readonly FotoRespaldable[];
}

/** Contenido de `datos.json`. Las fotos y sus metadatos van solo si se pasan (las que no se encontraron no se declaran). */
export function crearDatosRespaldo(e: EntradaRespaldo, ahora: Date): DatosRespaldo {
  const ajustes: Record<string, unknown> = {};
  for (const a of e.ajustes) if (esAjusteRespaldable(a.clave)) ajustes[a.clave] = a.valor;
  return {
    formato: FORMATO_RESPALDO,
    versionFormato: VERSION_FORMATO,
    versionEsquema: VERSION_ESQUEMA,
    creadoEn: ahora.toISOString(),
    gastos: [...e.gastos],
    categorias: [...e.categorias],
    cuentas: [...e.cuentas],
    ajustes,
    eliminados: [...e.eliminados],
    fotos: e.fotos.map((f) => ({
      id: f.id,
      archivo: rutaFoto(f.id),
      miniatura: f.miniatura ? rutaMiniatura(f.id) : null,
      ancho: f.ancho,
      alto: f.alto,
      bytes: f.blob.size,
    })),
  };
}

const nombreSeguro = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');
const rutaFoto = (id: string): string => `fotos/${nombreSeguro(id)}.jpg`;
const rutaMiniatura = (id: string): string => `miniaturas/${nombreSeguro(id)}.jpg`;

const cederPantalla = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Arma el ZIP. Los JPEG ya van comprimidos: se guardan tal cual (sin recomprimir). Cede la pantalla cada
 * pocas fotos y reporta el avance (0 a 1).
 */
export async function armarRespaldo(
  datos: DatosRespaldo,
  fotos: readonly FotoRespaldable[],
  onProgreso: Progreso = () => {},
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(ARCHIVO_DATOS, JSON.stringify(datos));
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i]!;
    zip.file(rutaFoto(f.id), await f.blob.arrayBuffer(), { binary: true, compression: 'STORE' });
    if (f.miniatura) zip.file(rutaMiniatura(f.id), await f.miniatura.arrayBuffer(), { binary: true, compression: 'STORE' });
    if (i % 10 === 9) {
      onProgreso(`Armando el respaldo: foto ${i + 1} de ${fotos.length}`, ((i + 1) / fotos.length) * 0.6);
      await cederPantalla();
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', streamFiles: true }, (meta) =>
    onProgreso('Comprimiendo el respaldo…', 0.6 + (meta.percent / 100) * 0.4),
  );
}

// ---------- Leer y validar ----------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === 'string' && v !== '';
const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const esFechaIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function listaDe(json: Record<string, unknown>, campo: string, obligatoria: boolean): unknown[] {
  const v = json[campo];
  if (v === undefined && !obligatoria) return [];
  if (!Array.isArray(v)) throw new ErrorRespaldo(`El archivo está dañado: falta la lista "${campo}" en datos.json.`);
  return v;
}

function gastoValido(v: unknown, i: number): Gasto {
  const donde = `El gasto número ${i + 1} de datos.json`;
  if (!esObjeto(v)) throw new ErrorRespaldo(`${donde} está dañado.`);
  if (!esTexto(v.id)) throw new ErrorRespaldo(`${donde} no tiene id.`);
  if (!esFechaIso(v.fecha)) throw new ErrorRespaldo(`${donde} (${v.id}) no tiene una fecha válida.`);
  if (!esNumero(v.monto) || v.monto <= 0) throw new ErrorRespaldo(`${donde} (${v.id}) no tiene un monto válido.`);
  if (typeof v.moneda !== 'string' || !/^[A-Z]{3}$/.test(v.moneda)) {
    throw new ErrorRespaldo(`${donde} (${v.id}) no tiene una moneda válida.`);
  }
  if (!esTexto(v.categoriaId)) throw new ErrorRespaldo(`${donde} (${v.id}) no tiene categoría.`);
  if (!esTexto(v.cuentaId)) throw new ErrorRespaldo(`${donde} (${v.id}) no tiene cuenta.`);
  const creadoEn = esFechaIso(v.creadoEn) ? v.creadoEn : v.fecha;
  return {
    id: v.id,
    fecha: v.fecha,
    monto: v.monto,
    moneda: v.moneda,
    categoriaId: v.categoriaId,
    cuentaId: v.cuentaId,
    nota: typeof v.nota === 'string' ? v.nota : '',
    fotoId: esTexto(v.fotoId) ? v.fotoId : null,
    creadoEn,
    editadoEn: esFechaIso(v.editadoEn) ? v.editadoEn : creadoEn,
    exportadoEn: esFechaIso(v.exportadoEn) ? v.exportadoEn : null,
  };
}

function categoriaValida(v: unknown, i: number): Categoria {
  if (!esObjeto(v) || !esTexto(v.id) || !esTexto(v.nombre)) {
    throw new ErrorRespaldo(`La categoría número ${i + 1} de datos.json está dañada.`);
  }
  return {
    id: v.id,
    nombre: v.nombre,
    emoji: typeof v.emoji === 'string' && v.emoji !== '' ? v.emoji : '🏷️',
    orden: esNumero(v.orden) ? v.orden : i,
    activa: v.activa !== false,
  };
}

function cuentaValida(v: unknown, i: number): Cuenta {
  if (!esObjeto(v) || !esTexto(v.id) || !esTexto(v.nombre)) {
    throw new ErrorRespaldo(`La cuenta número ${i + 1} de datos.json está dañada.`);
  }
  const ids = Array.isArray(v.categoriaIds) ? v.categoriaIds.filter(esTexto) : undefined;
  return {
    id: v.id,
    nombre: v.nombre,
    emoji: typeof v.emoji === 'string' && v.emoji !== '' ? v.emoji : '📒',
    orden: esNumero(v.orden) ? v.orden : i,
    archivada: v.archivada === true,
    ...(ids ? { categoriaIds: ids } : {}),
  };
}

function eliminadoValido(v: unknown, i: number): Eliminado {
  if (!esObjeto(v) || !esTexto(v.id) || !esTexto(v.cuentaId) || !esFechaIso(v.eliminadoEn)) {
    throw new ErrorRespaldo(`El registro de eliminado número ${i + 1} de datos.json está dañado.`);
  }
  return { id: v.id, cuentaId: v.cuentaId, eliminadoEn: v.eliminadoEn };
}

function fotoMetaValida(v: unknown, i: number): FotoMeta {
  if (!esObjeto(v) || !esTexto(v.id) || typeof v.archivo !== 'string' || !/^fotos\/[^/\\]+$/.test(v.archivo)) {
    throw new ErrorRespaldo(`Los datos de la foto número ${i + 1} de datos.json están dañados.`);
  }
  const miniatura = typeof v.miniatura === 'string' && /^miniaturas\/[^/\\]+$/.test(v.miniatura) ? v.miniatura : null;
  return {
    id: v.id,
    archivo: v.archivo,
    miniatura,
    ancho: esNumero(v.ancho) ? v.ancho : 0,
    alto: esNumero(v.alto) ? v.alto : 0,
    bytes: esNumero(v.bytes) ? v.bytes : 0,
  };
}

function sinRepetidos(ids: readonly string[], que: string): void {
  const vistos = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) throw new ErrorRespaldo(`El archivo está dañado: ${que} repetido (${id}).`);
    vistos.add(id);
  }
}

/** Valida el contenido de `datos.json`. Si algo falla lanza `ErrorRespaldo` con el motivo y no se cambia nada. */
export function validarDatos(json: unknown): DatosRespaldo {
  if (!esObjeto(json) || json.formato !== FORMATO_RESPALDO) {
    throw new ErrorRespaldo('Este archivo no es un respaldo de la app de gastos (datos.json no tiene el formato esperado).');
  }
  const vf = json.versionFormato;
  if (!esNumero(vf) || !Number.isInteger(vf) || vf < 1) {
    throw new ErrorRespaldo('El formato del respaldo no es compatible (no indica su versión).');
  }
  if (vf > VERSION_FORMATO) {
    throw new ErrorRespaldo(
      `El respaldo usa el formato ${vf}, de una versión más nueva de la app (esta entiende hasta el ${VERSION_FORMATO}). Actualiza la app e inténtalo de nuevo.`,
    );
  }
  const ve = json.versionEsquema;
  if (!esNumero(ve) || ve < 1) throw new ErrorRespaldo('El respaldo no indica la versión de sus datos (versionEsquema).');
  if (ve > VERSION_ESQUEMA) {
    throw new ErrorRespaldo(
      `El respaldo se creó con una versión más nueva de los datos (${ve}; esta app entiende hasta la ${VERSION_ESQUEMA}). Actualiza la app e inténtalo de nuevo.`,
    );
  }
  const gastos = listaDe(json, 'gastos', true).map(gastoValido);
  const categorias = listaDe(json, 'categorias', true).map(categoriaValida);
  const cuentas = listaDe(json, 'cuentas', true).map(cuentaValida);
  const eliminados = listaDe(json, 'eliminados', false).map(eliminadoValido);
  const fotos = listaDe(json, 'fotos', false).map(fotoMetaValida);
  if (json.ajustes !== undefined && !esObjeto(json.ajustes)) {
    throw new ErrorRespaldo('El archivo está dañado: "ajustes" no tiene el formato esperado en datos.json.');
  }
  sinRepetidos(gastos.map((g) => g.id), 'gasto');
  sinRepetidos(categorias.map((c) => c.id), 'categoría');
  sinRepetidos(cuentas.map((c) => c.id), 'cuenta');
  sinRepetidos(fotos.map((f) => f.id), 'foto');
  return {
    formato: FORMATO_RESPALDO,
    versionFormato: vf,
    versionEsquema: ve,
    creadoEn: esFechaIso(json.creadoEn) ? json.creadoEn : new Date(0).toISOString(),
    gastos,
    categorias,
    cuentas,
    ajustes: { ...((json.ajustes as Record<string, unknown> | undefined) ?? {}) },
    eliminados,
    fotos,
  };
}

export interface FotoLeida {
  blob: Blob;
  miniatura?: Blob;
}

export interface RespaldoLeido {
  /** `fotos` solo lista las que están de verdad dentro del ZIP. */
  datos: DatosRespaldo;
  /** Fotos declaradas en datos.json que no estaban en el ZIP. */
  fotosAusentes: number;
  leerFoto(id: string): Promise<FotoLeida>;
}

/** Abre el ZIP y valida `datos.json`. Lanza `ErrorRespaldo` si no es un respaldo utilizable. */
export async function leerRespaldoZip(archivo: Blob | ArrayBuffer | Uint8Array): Promise<RespaldoLeido> {
  const { default: JSZip } = await import('jszip');
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(archivo);
  } catch {
    throw new ErrorRespaldo('El archivo no es un ZIP válido (o está dañado). Elige un respaldo_gastos_….zip creado por esta app.');
  }
  const entrada = zip.file(ARCHIVO_DATOS);
  if (!entrada) {
    throw new ErrorRespaldo(`El ZIP no contiene ${ARCHIVO_DATOS}: no es un respaldo de la app de gastos.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(await entrada.async('string'));
  } catch {
    throw new ErrorRespaldo(`${ARCHIVO_DATOS} está dañado: no se pudo leer como JSON.`);
  }
  const datos = validarDatos(json);
  const presentes = datos.fotos.filter((f) => zip.file(f.archivo) !== null);
  const meta = new Map(presentes.map((f) => [f.id, f]));
  return {
    datos: { ...datos, fotos: presentes },
    fotosAusentes: datos.fotos.length - presentes.length,
    async leerFoto(id) {
      const m = meta.get(id);
      const f = m ? zip.file(m.archivo) : null;
      if (!m || !f) throw new ErrorRespaldo(`La foto ${id} no está en el respaldo.`);
      const blob = new Blob([await f.async('arraybuffer')], { type: 'image/jpeg' });
      const mini = m.miniatura ? zip.file(m.miniatura) : null;
      return mini ? { blob, miniatura: new Blob([await mini.async('arraybuffer')], { type: 'image/jpeg' }) } : { blob };
    },
  };
}
