import type { Ajuste, Categoria, Cuenta, Eliminado, Foto, Gasto } from '../types';
import { idsVisibles } from './categorias';
import type { Progreso } from './exportar';
import { ErrorRespaldo, esAjusteRespaldable, type DatosRespaldo, type FotoLeida } from './respaldo';

/**
 * Fusión de un respaldo con los datos locales (Fase 7b). Por id, sin borrar nunca nada local:
 * en los gastos gana la versión más reciente; categorías y cuentas nuevas se agregan y las que ya existen
 * conservan su configuración local; las fotos se restauran si faltan. Sin DOM: se prueba con Vitest.
 */

/** Lo que hay ahora en la base, leído antes de planificar. */
export interface EstadoLocal {
  gastos: readonly Gasto[];
  categorias: readonly Categoria[];
  cuentas: readonly Cuenta[];
  eliminados: readonly Eliminado[];
  /** Ids de las fotos guardadas. */
  fotosIds: ReadonlySet<string>;
  ajustes: readonly Ajuste[];
}

export interface PlanRestauracion {
  gastosNuevos: Gasto[];
  gastosActualizados: Gasto[];
  /** Gastos del respaldo iguales o más antiguos que los locales. */
  omitidosIguales: number;
  /** Gastos del respaldo que aquí se eliminaron (siguen en la tabla de eliminados): no se restauran. */
  omitidosEliminados: number;
  categoriasNuevas: Categoria[];
  cuentasNuevas: Cuenta[];
  /** Registros de gastos eliminados que Sheets aún no conoce como eliminados y aquí faltan. */
  eliminadosNuevos: Eliminado[];
  /** Ids de las fotos que se restauran desde el ZIP. */
  fotosAgregar: string[];
  /** Gastos cuya foto no está ni en el respaldo ni aquí: se restauran sin foto. */
  fotosFaltantes: number;
  ajustes: Ajuste[];
}

/** Preferencias que el respaldo impone cuando aquí no hay gastos todavía. */
const AJUSTES_DE_PREFERENCIAS = new Set([
  'monedaPredeterminada',
  'monedasVisibles',
  'decimalCsv',
  'modoRecibo',
  'ultimaCuenta',
  'cuentaPredeterminada',
]);

const claveNombre = (nombre: string): string => nombre.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

/** Versión de un gasto: cuándo se editó por última vez (o se creó, si nunca se editó). */
export const versionDeGasto = (g: Pick<Gasto, 'creadoEn' | 'editadoEn'>): string => g.editadoEn || g.creadoEn;

/** true si `a` es estrictamente más reciente que `b`. */
export function esMasReciente(a: Pick<Gasto, 'creadoEn' | 'editadoEn'>, b: Pick<Gasto, 'creadoEn' | 'editadoEn'>): boolean {
  const ta = Date.parse(versionDeGasto(a));
  const tb = Date.parse(versionDeGasto(b));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return versionDeGasto(a) > versionDeGasto(b);
  return ta > tb;
}

const masTarde = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
};

export function planificarFusion(local: EstadoLocal, datos: DatosRespaldo): PlanRestauracion {
  const fotosEnArchivo = new Set(datos.fotos.map((f) => f.id));

  // ---- Categorías: las que ya existen no se tocan; una con el mismo nombre se toma como la misma ----
  const catPorId = new Set(local.categorias.map((c) => c.id));
  const catPorNombre = new Map(local.categorias.map((c) => [claveNombre(c.nombre), c.id]));
  const mapaCategorias = new Map<string, string>();
  const categoriasNuevas: Categoria[] = [];
  let ordenCat = local.categorias.reduce((m, c) => Math.max(m, c.orden), -1) + 1;
  for (const c of datos.categorias) {
    if (catPorId.has(c.id)) continue;
    const igual = catPorNombre.get(claveNombre(c.nombre));
    if (igual) {
      mapaCategorias.set(c.id, igual);
      continue;
    }
    categoriasNuevas.push({ ...c, orden: ordenCat++ });
    catPorNombre.set(claveNombre(c.nombre), c.id);
  }
  const catalogoFinal = [...local.categorias, ...categoriasNuevas];

  // ---- Cuentas: las que ya existen conservan su configuración local (incluida su lista de categorías) ----
  const ctaPorId = new Set(local.cuentas.map((c) => c.id));
  const ctaPorNombre = new Map(local.cuentas.map((c) => [claveNombre(c.nombre), c.id]));
  const mapaCuentas = new Map<string, string>();
  const cuentasNuevas: Cuenta[] = [];
  let ordenCta = local.cuentas.reduce((m, c) => Math.max(m, c.orden), -1) + 1;
  for (const c of datos.cuentas) {
    if (ctaPorId.has(c.id)) continue;
    const igual = ctaPorNombre.get(claveNombre(c.nombre));
    if (igual) {
      mapaCuentas.set(c.id, igual);
      continue;
    }
    const propias = c.categoriaIds?.map((id) => mapaCategorias.get(id) ?? id);
    const nueva: Cuenta = { ...c, orden: ordenCta++, categoriaIds: propias };
    nueva.categoriaIds = idsVisibles(nueva, catalogoFinal); // solo las que existen y están activas, máx. 12, mín. 1
    cuentasNuevas.push(nueva);
    ctaPorNombre.set(claveNombre(c.nombre), c.id);
  }
  const cuentasFinales = new Set([...local.cuentas, ...cuentasNuevas].map((c) => c.id));

  // ---- Gastos ----
  const gastoLocal = new Map(local.gastos.map((g) => [g.id, g]));
  const eliminadoLocal = new Set(local.eliminados.map((e) => e.id));
  const gastosNuevos: Gasto[] = [];
  const gastosActualizados: Gasto[] = [];
  const fotosAgregar = new Set<string>();
  let omitidosIguales = 0;
  let omitidosEliminados = 0;
  let fotosFaltantes = 0;
  const idsDelRespaldo = new Set<string>();

  const necesitaFoto = (fotoId: string | null): void => {
    if (fotoId && !local.fotosIds.has(fotoId) && fotosEnArchivo.has(fotoId)) fotosAgregar.add(fotoId);
  };

  for (const g of datos.gastos) {
    idsDelRespaldo.add(g.id);
    if (eliminadoLocal.has(g.id)) {
      omitidosEliminados++;
      continue;
    }
    const cuentaId = mapaCuentas.get(g.cuentaId) ?? g.cuentaId;
    if (!cuentasFinales.has(cuentaId)) {
      throw new ErrorRespaldo(
        `El gasto ${g.id} usa una cuenta (${g.cuentaId}) que no está en el respaldo ni en este teléfono. El archivo está dañado.`,
      );
    }
    const actual = gastoLocal.get(g.id);
    if (actual && !esMasReciente(g, actual)) {
      omitidosIguales++;
      necesitaFoto(actual.fotoId); // la foto del gasto local, por si faltaba
      continue;
    }
    let fotoId = g.fotoId;
    if (fotoId && !local.fotosIds.has(fotoId) && !fotosEnArchivo.has(fotoId)) {
      fotoId = null;
      fotosFaltantes++;
    }
    necesitaFoto(fotoId);
    const gasto: Gasto = {
      ...g,
      categoriaId: mapaCategorias.get(g.categoriaId) ?? g.categoriaId,
      cuentaId,
      fotoId,
      // Se conserva el exportadoEn del respaldo ("Solo nuevos" sigue funcionando en un teléfono nuevo);
      // si aquí ya se había exportado más tarde, no se retrocede.
      exportadoEn: actual ? masTarde(g.exportadoEn, actual.exportadoEn) : g.exportadoEn,
    };
    (actual ? gastosActualizados : gastosNuevos).push(gasto);
  }

  // ---- Eliminados: se agregan los que aquí faltan (para avisar a Sheets), sin tocar gastos locales ----
  const eliminadosNuevos = datos.eliminados.filter(
    (e) => !eliminadoLocal.has(e.id) && !gastoLocal.has(e.id) && !idsDelRespaldo.has(e.id),
  );

  // ---- Ajustes: con la base local sin gastos (teléfono nuevo o datos borrados) mandan los del respaldo; con
  // gastos, lo local manda y solo se agrega lo que falta (y la última exportación, si es más reciente) ----
  const baseVacia = local.gastos.length === 0;
  const ajustesLocales = new Map(local.ajustes.map((a) => [a.clave, a.valor]));
  const ajustes: Ajuste[] = [];
  for (const [clave, valorOriginal] of Object.entries(datos.ajustes)) {
    if (!esAjusteRespaldable(clave)) continue;
    let valor = valorOriginal;
    const propio = ajustesLocales.get(clave);
    if (baseVacia && AJUSTES_DE_PREFERENCIAS.has(clave)) {
      if (clave === 'ultimaCuenta' || clave === 'cuentaPredeterminada') {
        // La cuenta puede haberse tomado como otra del mismo nombre; si ya no existe, se deja la local.
        valor = typeof valor === 'string' ? (mapaCuentas.get(valor) ?? valor) : valor;
        if (typeof valor !== 'string' || !cuentasFinales.has(valor)) continue;
      }
      ajustes.push({ clave, valor });
    } else if (clave === 'ultimaExportacion') {
      const mia = typeof propio === 'string' ? propio : null;
      const suya = typeof valor === 'string' ? valor : null;
      const gana = masTarde(mia, suya);
      if (gana !== null && gana !== mia) ajustes.push({ clave, valor: gana });
    } else if (propio === undefined || propio === null) {
      ajustes.push({ clave, valor });
    }
  }

  return {
    gastosNuevos,
    gastosActualizados,
    omitidosIguales,
    omitidosEliminados,
    categoriasNuevas,
    cuentasNuevas,
    eliminadosNuevos,
    fotosAgregar: [...fotosAgregar],
    fotosFaltantes,
    ajustes,
  };
}

// ---------- Resumen para el usuario ----------

const cuantos = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;
const se = (n: number, verbo: string): string => (n === 1 ? verbo : `${verbo}n`);

/** "Se agregarán N gastos, se actualizarán M, se omitirán K (iguales o más antiguos); se agregarán X fotos, Y categorías y Z cuentas." */
export function textoResumen(p: PlanRestauracion): string {
  const n = p.gastosNuevos.length;
  const m = p.gastosActualizados.length;
  const k = p.omitidosIguales;
  const x = p.fotosAgregar.length;
  const y = p.categoriasNuevas.length;
  const z = p.cuentasNuevas.length;
  const partes = [
    `Se ${se(n, 'agregará')} ${cuantos(n, 'gasto', 'gastos')}, se ${se(m, 'actualizará')} ${m}, se ${se(k, 'omitirá')} ${k} (iguales o más antiguos)`,
  ];
  if (p.omitidosEliminados > 0) partes[0] += ` y ${p.omitidosEliminados} (eliminados aquí)`;
  partes.push(
    `se ${se(x, 'agregará')} ${cuantos(x, 'foto', 'fotos')}, ${cuantos(y, 'categoría', 'categorías')} y ${cuantos(z, 'cuenta', 'cuentas')}`,
  );
  let texto = `${partes.join('; ')}.`;
  if (p.fotosFaltantes > 0) {
    texto += ` ${cuantos(p.fotosFaltantes, 'gasto se restaurará', 'gastos se restaurarán')} sin foto (no está en el respaldo).`;
  }
  return texto;
}

/** Aviso final, con lo que de verdad se aplicó. */
export function textoResultado(p: PlanRestauracion): string {
  const base = `Restauración lista: ${cuantos(p.gastosNuevos.length, 'gasto agregado', 'gastos agregados')}, ${p.gastosActualizados.length} actualizados, ${p.omitidosIguales + p.omitidosEliminados} omitidos; ${cuantos(p.fotosAgregar.length, 'foto', 'fotos')}, ${cuantos(p.categoriasNuevas.length, 'categoría', 'categorías')} y ${cuantos(p.cuentasNuevas.length, 'cuenta', 'cuentas')} agregadas.`;
  return p.fotosFaltantes > 0 ? `${base} ${cuantos(p.fotosFaltantes, 'gasto quedó', 'gastos quedaron')} sin foto.` : base;
}

/** true si aplicar el plan no cambiaría nada. */
export const planVacio = (p: PlanRestauracion): boolean =>
  p.gastosNuevos.length +
    p.gastosActualizados.length +
    p.categoriasNuevas.length +
    p.cuentasNuevas.length +
    p.eliminadosNuevos.length +
    p.fotosAgregar.length +
    p.ajustes.length ===
  0;

// ---------- Aplicar ----------

const cederPantalla = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Extrae del ZIP las fotos que se van a restaurar. Va ANTES de la transacción: esperar al ZIP dentro de
 * una transacción de IndexedDB la cerraría. Cede la pantalla cada pocas fotos y reporta el avance.
 */
export async function cargarFotos(
  ids: readonly string[],
  datos: Pick<DatosRespaldo, 'fotos'>,
  leer: (id: string) => Promise<FotoLeida>,
  onProgreso: Progreso = () => {},
): Promise<Map<string, Foto>> {
  const meta = new Map(datos.fotos.map((f) => [f.id, f]));
  const fotos = new Map<string, Foto>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const leida = await leer(id);
    const m = meta.get(id);
    fotos.set(id, { id, blob: leida.blob, ...(leida.miniatura ? { miniatura: leida.miniatura } : {}), ancho: m?.ancho ?? 0, alto: m?.alto ?? 0 });
    if (i % 10 === 9 || i === ids.length - 1) {
      onProgreso(`Leyendo fotos del respaldo: ${i + 1} de ${ids.length}`, (i + 1) / ids.length);
      await cederPantalla();
    }
  }
  return fotos;
}

/** Escritura dentro de la transacción. Cada método agrega o reemplaza por id (nunca borra). */
export interface EscrituraRestauracion {
  gastos(filas: Gasto[]): Promise<void>;
  fotos(filas: Foto[]): Promise<void>;
  categorias(filas: Categoria[]): Promise<void>;
  cuentas(filas: Cuenta[]): Promise<void>;
  eliminados(filas: Eliminado[]): Promise<void>;
  ajustes(filas: Ajuste[]): Promise<void>;
}

export interface RepoRestauracion {
  /** Ejecuta `operar` en UNA transacción: si lanza, no queda nada escrito. */
  transaccion<T>(operar: (e: EscrituraRestauracion) => Promise<T>): Promise<T>;
}

const TAMANO_LOTE = 250;

function* lotes<T>(lista: readonly T[], tamano = TAMANO_LOTE): Generator<T[]> {
  for (let i = 0; i < lista.length; i += tamano) yield lista.slice(i, i + tamano);
}

/**
 * Aplica el plan en una sola transacción: todo o nada. Antes de escribir comprueba que estén todas las fotos
 * a restaurar. Escribe por lotes para mostrar el avance sin congelar la pantalla (no cede con setTimeout
 * dentro de la transacción: cada lote espera a IndexedDB, que ya deja respirar al navegador).
 */
export async function ejecutarRestauracion(
  plan: PlanRestauracion,
  fotos: ReadonlyMap<string, Foto>,
  repo: RepoRestauracion,
  onProgreso: Progreso = () => {},
): Promise<void> {
  const aEscribir = plan.fotosAgregar.map((id) => {
    const f = fotos.get(id);
    if (!f) throw new ErrorRespaldo(`No se pudo leer la foto ${id} del respaldo: no se cambió nada.`);
    return f;
  });
  const gastos = [...plan.gastosNuevos, ...plan.gastosActualizados];
  const total = Math.max(1, gastos.length + aEscribir.length);
  let hecho = 0;
  await repo.transaccion(async (e) => {
    await e.categorias(plan.categoriasNuevas);
    await e.cuentas(plan.cuentasNuevas);
    await e.eliminados(plan.eliminadosNuevos);
    await e.ajustes(plan.ajustes);
    // Las fotos van primero: ningún gasto queda apuntando a una foto que todavía no existe.
    for (const lote of lotes(aEscribir, 50)) {
      await e.fotos(lote);
      hecho += lote.length;
      onProgreso(`Guardando: ${hecho} de ${total}`, hecho / total);
    }
    for (const lote of lotes(gastos)) {
      await e.gastos(lote);
      hecho += lote.length;
      onProgreso(`Guardando: ${hecho} de ${total}`, hecho / total);
    }
  });
  onProgreso('Listo', 1);
}
