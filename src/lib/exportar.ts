import type { Categoria, Cuenta, Eliminado, Foto, Gasto } from '../types';
import type { ResultadoCompartir } from './compartir';
import { generarCsv, type Cambio, type Decimal, type FilaCsv } from './csv';
import { addDays, fechaHoraAIso, isoAFechaHora, rangoMes, type Mes } from './dates';

// ---------- Qué exportar ----------

export type Alcance =
  | { tipo: 'nuevos' }
  | { tipo: 'mes'; mes: Mes }
  | { tipo: 'rango'; desde: string; hasta: string }
  | { tipo: 'todo' };

export type Formato = 'csv' | 'zip';

export const MENSAJE_SIN_NUEVOS = 'No hay gastos nuevos desde la última exportación';
export const MENSAJE_SIN_GASTOS = 'No hay gastos con esos criterios';

export const AVISO_ZIP_HTTP = 'Por HTTP, Chrome puede bloquear la descarga del ZIP; toca Conservar en el aviso de Chrome.';

/**
 * Aviso tras una descarga directa. En el celular dice dónde quedó el archivo y cómo subirlo a Drive
 * (Android no muestra la notificación); en escritorio conserva el texto de siempre.
 */
export function textoDescarga(nombre: string, movil: boolean): string {
  return movil
    ? `Se guardó ${nombre} en Archivos → Descargas. Para subirlo a Drive: abre Files, mantén presionado el archivo → Compartir → Drive.`
    : `Se descargó ${nombre} en tu carpeta de descargas. No puedo saber si llegó a su destino.`;
}

/** Avisar antes de exportar un ZIP cuando la página no es un contexto seguro (http://<IP-LAN>). */
export const debeAvisarZipHttp = (contextoSeguro: boolean, formato: Formato): boolean => !contextoSeguro && formato === 'zip';

/** Un gasto sale en "Solo nuevos" si nunca se exportó o se editó después de la última exportación. */
export const pendienteDeExportar = (g: Gasto): boolean => g.exportadoEn === null || g.editadoEn > g.exportadoEn;

/**
 * "editado" si Sheets ya conoce el gasto y cambió desde entonces; "nuevo" en el resto de casos
 * (incluye los ya exportados y sin cambios, que en Un mes / Rango / Todo se vuelven a incluir).
 */
export const cambioDe = (g: Gasto): 'nuevo' | 'editado' =>
  g.exportadoEn !== null && g.editadoEn > g.exportadoEn ? 'editado' : 'nuevo';

export interface Seleccion {
  gastos: Gasto[];
  /** Solo en "Solo nuevos". */
  eliminados: Eliminado[];
}

/** Error del rango de fechas, o null si es válido. `hoy` es AAAA-MM-DD local. */
export function validarRango(desde: string, hasta: string, hoy: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(desde)) return 'Elige la fecha "Desde".';
  if (!iso.test(hasta)) return 'Elige la fecha "Hasta".';
  if (hasta > hoy) return 'La fecha "Hasta" no puede ser futura.';
  if (hasta < desde) return 'La fecha "Hasta" no puede ser anterior a "Desde".';
  return null;
}

/** Intervalo ISO [desde, hasta) de un alcance por fechas, o null si el alcance no filtra por fecha. */
function intervaloDe(alcance: Alcance): { desde: string; hasta: string } | null {
  if (alcance.tipo === 'mes') return rangoMes(alcance.mes);
  if (alcance.tipo === 'rango') {
    return { desde: fechaHoraAIso(alcance.desde, '00:00'), hasta: fechaHoraAIso(addDays(alcance.hasta, 1), '00:00') };
  }
  return null;
}

const porFecha = (a: Gasto, b: Gasto): number => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id < b.id ? -1 : 1);

/** Filtra por alcance y cuenta (null = todas). Los eliminados solo cuentan en "Solo nuevos". */
export function seleccionar(
  gastos: readonly Gasto[],
  eliminados: readonly Eliminado[],
  alcance: Alcance,
  cuentaId: string | null,
): Seleccion {
  const intervalo = intervaloDe(alcance);
  const sel = gastos.filter((g) => {
    if (cuentaId && g.cuentaId !== cuentaId) return false;
    if (alcance.tipo === 'nuevos') return pendienteDeExportar(g);
    if (intervalo) return g.fecha >= intervalo.desde && g.fecha < intervalo.hasta;
    return true;
  });
  const borrados =
    alcance.tipo === 'nuevos'
      ? eliminados
          .filter((e) => !cuentaId || e.cuentaId === cuentaId)
          .sort((a, b) => (a.eliminadoEn < b.eliminadoEn ? -1 : a.eliminadoEn > b.eliminadoEn ? 1 : 0))
      : [];
  return { gastos: sel.sort(porFecha), eliminados: borrados };
}

export const totalFilas = (s: Seleccion): number => s.gastos.length + s.eliminados.length;

export const mensajeVacio = (alcance: Alcance): string => (alcance.tipo === 'nuevos' ? MENSAJE_SIN_NUEVOS : MENSAJE_SIN_GASTOS);

// ---------- Nombres de archivo ----------

/** Nombre de cuenta apto para un archivo: letras y números, lo demás pasa a guion. */
export function nombreParaArchivo(nombre: string): string {
  const limpio = nombre.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return limpio || 'cuenta';
}

const dos = (n: number): string => String(n).padStart(2, '0');

/** Fecha y hora local para el nombre del archivo: AAAAMMDD-HHMMSS (evita duplicados entre exportaciones). */
export const marcaDeTiempo = (d: Date): string =>
  `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;

/**
 * Siempre termina en la fecha y hora de la exportación:
 * gastos_AAAAMMDD-HHMMSS (Solo nuevos), gastos_AAAA-MM_AAAAMMDD-HHMMSS (un mes),
 * gastos_AAAA-MM-DD_a_AAAA-MM-DD_AAAAMMDD-HHMMSS (rango) y gastos_completo_AAAAMMDD-HHMMSS (todo).
 * Con una cuenta específica, su nombre va después de "gastos_" (gastos_Hogar_20261008-201005.zip).
 */
export function nombreArchivo(alcance: Alcance, cuentaNombre: string | null, ahora: Date, ext: 'csv' | 'zip'): string {
  const partes: string[] = ['gastos'];
  if (cuentaNombre) partes.push(nombreParaArchivo(cuentaNombre));
  switch (alcance.tipo) {
    case 'nuevos':
      break;
    case 'mes':
      partes.push(`${alcance.mes.anio}-${dos(alcance.mes.mes + 1)}`);
      break;
    case 'rango':
      partes.push(`${alcance.desde}_a_${alcance.hasta}`);
      break;
    case 'todo':
      partes.push('completo');
      break;
  }
  partes.push(marcaDeTiempo(ahora));
  return `${partes.join('_')}.${ext}`;
}

/** Nombre de cada foto dentro del ZIP: los primeros 8 caracteres del id del gasto; si chocan, se alarga. */
export function nombresDeFotos(gastos: readonly Pick<Gasto, 'id' | 'fotoId'>[]): Map<string, string> {
  const usados = new Set<string>();
  const nombres = new Map<string, string>();
  for (const g of gastos) {
    if (!g.fotoId) continue;
    const base = g.id.replace(/[^A-Za-z0-9]/g, '') || 'foto';
    let largo = 8;
    let nombre = base.slice(0, largo);
    while (usados.has(nombre) && largo < base.length) nombre = base.slice(0, (largo += 4));
    for (let n = 2; usados.has(nombre); n++) nombre = `${base}-${n}`;
    usados.add(nombre);
    nombres.set(g.id, `${nombre}.jpg`);
  }
  return nombres;
}

// ---------- Filas del CSV ----------

export function construirFilas(
  sel: Seleccion,
  categorias: readonly Pick<Categoria, 'id' | 'nombre'>[],
  cuentas: readonly Pick<Cuenta, 'id' | 'nombre'>[],
  fotos: ReadonlyMap<string, string>,
): FilaCsv[] {
  const cat = new Map(categorias.map((c) => [c.id, c.nombre]));
  const cta = new Map(cuentas.map((c) => [c.id, c.nombre]));
  const filas: FilaCsv[] = sel.gastos.map((g) => {
    const { fecha, hora } = isoAFechaHora(g.fecha);
    return {
      id: g.id,
      fecha,
      hora,
      monto: g.monto,
      moneda: g.moneda,
      categoria: cat.get(g.categoriaId) ?? g.categoriaId,
      cuenta: cta.get(g.cuentaId) ?? g.cuentaId,
      nota: g.nota,
      foto: fotos.get(g.id) ?? '',
      cambio: cambioDe(g) as Cambio,
    };
  });
  for (const e of sel.eliminados) {
    const { fecha, hora } = isoAFechaHora(e.eliminadoEn);
    filas.push({
      id: e.id,
      fecha,
      hora,
      monto: null,
      moneda: '',
      categoria: '',
      cuenta: cta.get(e.cuentaId) ?? e.cuentaId,
      nota: '',
      foto: '',
      cambio: 'eliminado',
    });
  }
  return filas;
}

// ---------- ZIP ----------

export interface FotoParaZip {
  nombre: string;
  blob: Blob;
}

export type Progreso = (texto: string, fraccion: number) => void;

const cederPantalla = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * ZIP con el CSV en la raíz y las fotos en `fotos/`. Los JPEG ya van comprimidos, así que se guardan
 * sin recomprimir (mucho más rápido). Cede la pantalla cada pocas fotos y reporta el avance (0 a 1).
 */
export async function armarZip(
  csv: string,
  nombreCsv: string,
  fotos: readonly FotoParaZip[],
  onProgreso: Progreso = () => {},
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(nombreCsv, csv);
  const carpeta = zip.folder('fotos');
  if (!carpeta) throw new Error('No se pudo crear la carpeta de fotos');
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i]!;
    carpeta.file(f.nombre, await f.blob.arrayBuffer(), { binary: true, compression: 'STORE' });
    if (i % 10 === 9) {
      onProgreso(`Armando el ZIP: foto ${i + 1} de ${fotos.length}`, ((i + 1) / fotos.length) * 0.5);
      await cederPantalla();
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', streamFiles: true }, (meta) =>
    onProgreso('Comprimiendo el ZIP…', 0.5 + (meta.percent / 100) * 0.5),
  );
}

/** Archivos para "Compartir datos y fotos": el CSV primero y luego cada JPEG con el nombre de la columna foto. */
export function armarLote(csv: string, nombreCsv: string, fotos: readonly FotoParaZip[]): File[] {
  return [
    new File([csv], nombreCsv, { type: 'text/csv' }),
    ...fotos.map((f) => new File([f.blob], f.nombre, { type: 'image/jpeg' })),
  ];
}

// ---------- Armado del archivo ----------

export interface PlanMarca {
  /** true solo en "Solo nuevos": los demás tipos no tocan exportadoEn. */
  marca: boolean;
  ids: string[];
  eliminadosIds: string[];
  /** Instante de la selección: lo editado después de este momento sigue pendiente. */
  corte: string;
}

export interface EntradaArchivo {
  seleccion: Seleccion;
  alcance: Alcance;
  formato: Formato;
  decimal: Decimal;
  categorias: readonly Pick<Categoria, 'id' | 'nombre'>[];
  cuentas: readonly Pick<Cuenta, 'id' | 'nombre'>[];
  cuentaFiltro: string | null;
  /** Instante de la exportación: va en el nombre del archivo y es el corte de lo marcado. */
  corte: Date;
}

export interface ArchivoListo {
  archivo: File;
  /** Solo en ZIP: el CSV y los JPEG como archivos separados (CSV primero, mismos nombres que la columna foto). */
  lote: File[] | null;
  gastos: number;
  eliminados: number;
  /** Gastos cuya foto no se encontró: salen sin foto. */
  fotosFaltantes: number;
  plan: PlanMarca;
}

/** Arma el CSV (o el ZIP con las fotos). Si la selección está vacía no hay archivo: lanza. */
export async function prepararArchivo(
  e: EntradaArchivo,
  leerFoto: (fotoId: string) => Promise<Pick<Foto, 'blob'> | undefined>,
  onProgreso: Progreso = () => {},
): Promise<ArchivoListo> {
  if (totalFilas(e.seleccion) === 0) throw new Error(mensajeVacio(e.alcance));
  const cuentaNombre = e.cuentaFiltro ? (e.cuentas.find((c) => c.id === e.cuentaFiltro)?.nombre ?? e.cuentaFiltro) : null;
  const base = nombreArchivo(e.alcance, cuentaNombre, e.corte, e.formato);
  const nombreCsv = nombreArchivo(e.alcance, cuentaNombre, e.corte, 'csv');

  const fotosZip: FotoParaZip[] = [];
  const nombresFoto = new Map<string, string>();
  let fotosFaltantes = 0;
  if (e.formato === 'zip') {
    const nombres = nombresDeFotos(e.seleccion.gastos);
    const conFoto = e.seleccion.gastos.filter((g) => g.fotoId);
    for (let i = 0; i < conFoto.length; i++) {
      const g = conFoto[i]!;
      const foto = await leerFoto(g.fotoId!);
      if (foto) {
        fotosZip.push({ nombre: nombres.get(g.id)!, blob: foto.blob });
        nombresFoto.set(g.id, nombres.get(g.id)!);
      } else {
        fotosFaltantes++;
      }
      if (i % 20 === 19) {
        onProgreso(`Preparando fotos: ${i + 1} de ${conFoto.length}`, ((i + 1) / conFoto.length) * 0.2);
        await cederPantalla();
      }
    }
  }

  const csv = generarCsv(construirFilas(e.seleccion, e.categorias, e.cuentas, nombresFoto), e.decimal);
  let archivo: File;
  let lote: File[] | null = null;
  if (e.formato === 'zip') {
    lote = armarLote(csv, nombreCsv, fotosZip);
    const zip = await armarZip(csv, nombreCsv, fotosZip, (t, f) => onProgreso(t, 0.2 + f * 0.8));
    archivo = new File([zip], base, { type: 'application/zip' });
  } else {
    archivo = new File([csv], base, { type: 'text/csv' });
  }
  onProgreso('Listo', 1);
  return {
    archivo,
    lote,
    gastos: e.seleccion.gastos.length,
    eliminados: e.seleccion.eliminados.length,
    fotosFaltantes,
    plan: {
      marca: e.alcance.tipo === 'nuevos',
      ids: e.seleccion.gastos.map((g) => g.id),
      eliminadosIds: e.seleccion.eliminados.map((x) => x.id),
      corte: e.corte.toISOString(),
    },
  };
}

// ---------- Marcar lo exportado ----------

/** Estado anterior, para poder deshacer la marca. */
export interface MarcaPrevia {
  gastos: { id: string; exportadoEn: string | null }[];
  eliminados: Eliminado[];
  ultimaExportacion: unknown;
}

/**
 * Marca como exportados los gastos del plan (exportadoEn = corte) y quita los eliminados incluidos.
 * Recibe lo que existe ahora en la base y devuelve qué escribir, qué borrar y cómo revertir.
 */
export function aplicarMarca(
  gastos: readonly Gasto[],
  eliminados: readonly Eliminado[],
  plan: PlanMarca,
  ultimaPrevia: unknown,
): { gastos: Gasto[]; eliminadosABorrar: string[]; previa: MarcaPrevia } {
  if (!plan.marca) {
    return { gastos: [], eliminadosABorrar: [], previa: { gastos: [], eliminados: [], ultimaExportacion: ultimaPrevia } };
  }
  return {
    gastos: gastos.map((g) => ({ ...g, exportadoEn: plan.corte })),
    eliminadosABorrar: eliminados.map((x) => x.id),
    previa: {
      gastos: gastos.map((g) => ({ id: g.id, exportadoEn: g.exportadoEn })),
      eliminados: [...eliminados],
      ultimaExportacion: ultimaPrevia,
    },
  };
}

export interface RepoMarcas {
  /** Aplica la marca en una sola transacción y guarda `ultimaExportacion`. */
  marcar(plan: PlanMarca, ultimaExportacion: string): Promise<MarcaPrevia>;
  /** Deshace la marca (gastos, eliminados y fecha de última exportación). */
  revertir(previa: MarcaPrevia): Promise<void>;
}

/** Tipo genérico para la descarga: con text/csv, Chrome en Windows agrega ".xls" al nombre. */
export const TIPO_DESCARGA = 'application/octet-stream';

/** Mismo contenido y exactamente el mismo nombre, con un tipo que no hace que el navegador cambie la extensión. */
export const archivoParaDescarga = (a: File): File => new File([a], a.name, { type: TIPO_DESCARGA });

export interface EntregaIO {
  compartir(archivo: File): Promise<ResultadoCompartir>;
  descargar(archivo: File): void;
}

export type ResultadoEntrega =
  | { estado: 'compartido'; previa: MarcaPrevia }
  /** Descargado: no se sabe si llegó, por eso la marca se puede deshacer. */
  | { estado: 'descargado'; previa: MarcaPrevia }
  | { estado: 'cancelado' }
  | { estado: 'requiere-gesto' }
  /** Chrome no permite compartir este archivo aunque el toque era reciente. */
  | { estado: 'rechazado' };

/**
 * Entrega el archivo y, solo si salió, marca lo exportado. Si el usuario cancela el menú Compartir
 * (o hace falta un toque nuevo), no se marca nada. Un fallo de compartir se propaga sin marcar.
 */
export async function entregar(
  listo: ArchivoListo,
  io: EntregaIO,
  repo: RepoMarcas,
  ahora: () => Date,
  forzarDescarga = false,
): Promise<ResultadoEntrega> {
  let estado: 'compartido' | 'descargado';
  if (forzarDescarga) {
    io.descargar(archivoParaDescarga(listo.archivo));
    estado = 'descargado';
  } else {
    const r = await io.compartir(listo.archivo);
    if (r === 'cancelado' || r === 'requiere-gesto' || r === 'rechazado') return { estado: r };
    if (r === 'compartido') {
      estado = 'compartido';
    } else {
      io.descargar(archivoParaDescarga(listo.archivo));
      estado = 'descargado';
    }
  }
  const previa = await repo.marcar(listo.plan, ahora().toISOString());
  return { estado, previa };
}

export type ResultadoTanda =
  | { estado: 'tanda'; indice: number; total: number }
  | { estado: 'completo'; total: number; previa: MarcaPrevia }
  | { estado: 'cancelado' | 'rechazado' };

/**
 * Comparte la tanda `indice` (cada una necesita un toque nuevo). Solo cuando se comparte la última se marca
 * lo exportado; si el usuario cancela o Chrome rechaza una tanda, no se marca nada.
 */
export async function entregarTanda(
  tandas: readonly (readonly File[])[],
  indice: number,
  plan: PlanMarca,
  compartir: (archivos: File[]) => Promise<ResultadoCompartir>,
  repo: RepoMarcas,
  ahora: () => Date,
): Promise<ResultadoTanda> {
  const tanda = tandas[indice];
  if (!tanda) throw new Error(`No existe la tanda ${indice + 1}`);
  const r = await compartir([...tanda]);
  if (r === 'cancelado') return { estado: 'cancelado' };
  if (r !== 'compartido') return { estado: 'rechazado' };
  if (indice + 1 < tandas.length) return { estado: 'tanda', indice, total: tandas.length };
  const previa = await repo.marcar(plan, ahora().toISOString());
  return { estado: 'completo', total: tandas.length, previa };
}

// ---------- Gastos eliminados ----------

/** Registro del borrado, o null si el gasto nunca se exportó (Sheets no lo conoce y no hay nada que avisar). */
export function eliminadoDe(g: Gasto, ahora: Date): Eliminado | null {
  return g.exportadoEn === null ? null : { id: g.id, cuentaId: g.cuentaId, eliminadoEn: ahora.toISOString() };
}

/**
 * Gasto a restaurar al tocar Deshacer. Si el aviso de borrado ya se exportó (no queda registro),
 * se restaura como no exportado para que vuelva a salir en "Solo nuevos" y Sheets lo recupere.
 */
export function restaurarTrasDeshacer(g: Gasto, quedabaRegistro: boolean): Gasto {
  return g.exportadoEn !== null && !quedabaRegistro ? { ...g, exportadoEn: null } : g;
}
