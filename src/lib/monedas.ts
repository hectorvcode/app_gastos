export interface InfoMoneda {
  codigo: string;
  nombre: string;
}

/** Monedas que se pueden activar en Ajustes. */
export const CATALOGO_MONEDAS: readonly InfoMoneda[] = [
  { codigo: 'COP', nombre: 'Peso colombiano' },
  { codigo: 'USD', nombre: 'Dólar estadounidense' },
  { codigo: 'EUR', nombre: 'Euro' },
  { codigo: 'MXN', nombre: 'Peso mexicano' },
  { codigo: 'BRL', nombre: 'Real brasileño' },
  { codigo: 'PEN', nombre: 'Sol peruano' },
  { codigo: 'CLP', nombre: 'Peso chileno' },
  { codigo: 'ARS', nombre: 'Peso argentino' },
  { codigo: 'GBP', nombre: 'Libra esterlina' },
  { codigo: 'CAD', nombre: 'Dólar canadiense' },
  { codigo: 'JPY', nombre: 'Yen japonés' },
];

export const MONEDA_POR_DEFECTO = 'COP';
export const VISIBLES_POR_DEFECTO: readonly string[] = ['COP', 'USD', 'EUR'];

export interface ConfigMonedas {
  predeterminada: string;
  /** Siempre incluye la predeterminada; en el orden del catálogo. */
  visibles: string[];
}

const enCatalogo = (c: string): boolean => CATALOGO_MONEDAS.some((m) => m.codigo === c);

/**
 * Deja la configuración en un estado válido: solo monedas del catálogo, sin repetidas,
 * con la predeterminada siempre visible y al menos una visible.
 */
export function normalizarConfig(predeterminada: unknown, visibles: unknown): ConfigMonedas {
  const pred = typeof predeterminada === 'string' && enCatalogo(predeterminada) ? predeterminada : MONEDA_POR_DEFECTO;
  const lista = Array.isArray(visibles) ? visibles.filter((v): v is string => typeof v === 'string') : [...VISIBLES_POR_DEFECTO];
  const set = new Set(lista.filter(enCatalogo));
  set.add(pred);
  return { predeterminada: pred, visibles: CATALOGO_MONEDAS.map((m) => m.codigo).filter((c) => set.has(c)) };
}

export type ResultadoConfig = { ok: true; config: ConfigMonedas } | { ok: false; error: string };

/** Muestra u oculta una moneda. La predeterminada no se puede ocultar. */
export function alternarVisible(config: ConfigMonedas, codigo: string): ResultadoConfig {
  if (!enCatalogo(codigo)) return { ok: false, error: 'Esa moneda no está disponible. Elige una de la lista.' };
  if (codigo === config.predeterminada) {
    return { ok: false, error: 'No puedes ocultar la moneda predeterminada. Elige otra como predeterminada primero.' };
  }
  const visibles = config.visibles.includes(codigo)
    ? config.visibles.filter((c) => c !== codigo)
    : [...config.visibles, codigo];
  return { ok: true, config: normalizarConfig(config.predeterminada, visibles) };
}

/** Cambia la predeterminada; si estaba oculta, pasa a visible. */
export function elegirPredeterminada(config: ConfigMonedas, codigo: string): ResultadoConfig {
  if (!enCatalogo(codigo)) return { ok: false, error: 'Esa moneda no está disponible. Elige una de la lista.' };
  return { ok: true, config: normalizarConfig(codigo, config.visibles) };
}

/** Moneda con la que abre Registrar: la última usada si sigue visible; si no, la predeterminada. */
export function resolverMonedaInicial(ultima: unknown, config: ConfigMonedas): string {
  return typeof ultima === 'string' && config.visibles.includes(ultima) ? ultima : config.predeterminada;
}

/**
 * Moneda que debe usar Registrar al volver a la pestaña: si Ajustes cambió la predeterminada,
 * pasa a la nueva; si no, conserva la actual mientras siga visible, o cae en la predeterminada.
 */
export function resolverMonedaAlActivar(actual: string, config: ConfigMonedas, predeterminadaPrevia: string): string {
  if (config.predeterminada !== predeterminadaPrevia) return config.predeterminada;
  return config.visibles.includes(actual) ? actual : config.predeterminada;
}

/** Acceso a los ajustes (clave-valor); en producción es la tabla `ajustes` de Dexie. */
export interface RepoAjustes {
  get(clave: string): Promise<unknown>;
  set(clave: string, valor: unknown): Promise<void>;
}

export async function cargarConfigMonedas(repo: RepoAjustes): Promise<ConfigMonedas> {
  return normalizarConfig(await repo.get('monedaPredeterminada'), await repo.get('monedasVisibles'));
}

export async function guardarConfigMonedas(repo: RepoAjustes, config: ConfigMonedas): Promise<void> {
  await repo.set('monedaPredeterminada', config.predeterminada);
  await repo.set('monedasVisibles', config.visibles);
}

export async function cargarMonedaInicial(repo: RepoAjustes): Promise<string> {
  return resolverMonedaInicial(await repo.get('ultimaMoneda'), await cargarConfigMonedas(repo));
}

export async function guardarUltimaMoneda(repo: RepoAjustes, moneda: string): Promise<void> {
  await repo.set('ultimaMoneda', moneda);
}
