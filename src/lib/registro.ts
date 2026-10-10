import type { Foto, Gasto } from '../types';
import { generarUuid } from './compat';
import { CUENTA_PERSONAL_ID } from './cuentas';
import { addDays, buildFechaIso, dateKey } from './dates';
import type { InstantaneaRegistro } from './borrador';
import { fotoDesdeProcesada, type FotoProcesada } from './fotos';
import { adaptarEntry, applyKey, entryToNumber, formatMonto, type Key } from './money';
import { recortarNota } from './nota';

export const REINICIO_FECHA_MS = 10 * 60 * 1000;

export interface RepoGastos {
  /** Guarda el gasto y su foto (si hay) de forma atómica: o se guardan las dos o ninguna. */
  add(gasto: Gasto, foto: Foto | null): Promise<void>;
  /** Borra el gasto y su foto. */
  delete(id: string): Promise<void>;
}

/** Lo necesario para revertir un cambio de moneda que descartó decimales. */
export interface CambioMoneda {
  previa: { moneda: string; entry: string };
  /** Decimales que no caben en la nueva moneda (vacío si no se perdió nada). */
  descartados: string;
}

export type ResultadoGuardado =
  | { ok: false }
  | { ok: true; gasto: Gasto; fechaKey: string; esHoy: boolean };

export const MSG_FALTA_MONTO = 'Escribe el monto';
export const MSG_FALTA_CATEGORIA = 'Elige una categoría';

/** Qué le falta al gasto en curso para poder guardarse con el botón Guardar (o con Enter). */
export type Falta = { falta: 'monto' | 'categoria'; mensaje: string };

/** "Guardado rápido" (Ajustes): solo se activa con `true`; por defecto, desactivado. */
export const guardadoRapidoActivo = (valor: unknown): boolean => valor === true;

/**
 * Texto del botón Guardar: resume lo que se guardará ("Guardar 45.000 COP · Comida").
 * Con monto 0 o sin categoría muestra solo lo que ya hay.
 */
export function textoBotonGuardar(entry: string, moneda: string, nombreCategoria: string | null): string {
  const monto = entryToNumber(entry);
  const parteMonto = monto > 0 ? ` ${formatMonto(monto, moneda)} ${moneda}` : '';
  return `Guardar${parteMonto}${nombreCategoria ? ` · ${nombreCategoria}` : ''}`;
}

/**
 * Estado de la pantalla Registrar (monto en curso, fecha elegida, último gasto),
 * sin DOM, para poder probarlo.
 */
export class SesionRegistro {
  entry = '';
  /** Nota pendiente: se guarda con el siguiente gasto y luego se limpia. */
  nota = '';
  /** Foto pendiente: se guarda con el siguiente gasto y luego se limpia (igual que la nota). */
  foto: FotoProcesada | null = null;
  /** Cuenta en la que se guarda el siguiente gasto; la fija la UI al abrir y al elegir. */
  cuentaId: string = CUENTA_PERSONAL_ID;
  /** Categoría seleccionada para el siguiente gasto (Fase 8); null = ninguna. */
  categoriaId: string | null = null;
  /** Ajustes → "Guardado rápido": tocar una categoría guarda al instante y no hay selección. */
  guardadoRapido = false;
  /** null = "Hoy" (sigue al reloj, incluso pasada la medianoche). */
  private fechaElegida: string | null = null;
  private ultimaActividad: number;
  private ultimoGastoId: string | null = null;

  constructor(
    public moneda: string,
    private repo: RepoGastos,
    private reloj: () => Date = () => new Date(),
    private uuid: () => string = generarUuid,
  ) {
    this.ultimaActividad = reloj().getTime();
  }

  get hoy(): string {
    return dateKey(this.reloj());
  }

  /** Fecha vigente; vuelve a "Hoy" tras 10 minutos sin registrar. */
  get fechaActual(): string {
    if (
      this.fechaElegida !== null &&
      this.reloj().getTime() - this.ultimaActividad > REINICIO_FECHA_MS
    ) {
      this.fechaElegida = null;
    }
    return this.fechaElegida ?? this.hoy;
  }

  /** Accesos rápidos: 0 = Hoy, 1 = Ayer, 2 = Antier. */
  elegirDiasAtras(dias: number): void {
    this.elegirFecha(addDays(this.hoy, -dias));
  }

  elegirFecha(key: string): void {
    if (key > this.hoy) return;
    this.fechaElegida = key === this.hoy ? null : key;
    this.ultimaActividad = this.reloj().getTime();
  }

  ponerNota(texto: string): void {
    this.nota = recortarNota(texto);
  }

  ponerFoto(foto: FotoProcesada | null): void {
    this.foto = foto;
  }

  /** Lo que hay escrito ahora, para el borrador (fecha null = Hoy). */
  instantanea(): InstantaneaRegistro {
    const fecha = this.fechaActual;
    return {
      entry: this.entry,
      moneda: this.moneda,
      fecha: fecha === this.hoy ? null : fecha,
      cuentaId: this.cuentaId,
      categoriaId: this.categoriaId,
      nota: this.nota,
    };
  }

  /**
   * Vuelve a poner lo escrito. Ignora la moneda o la cuenta que ya no estén disponibles
   * (se queda con las actuales) y no admite fechas futuras. La categoría solo vuelve si la
   * cuenta resultante todavía la muestra (`categoriasVisibles` da los ids de esa cuenta).
   */
  restaurar(
    s: InstantaneaRegistro,
    monedasVisibles: readonly string[],
    cuentasActivas: readonly string[],
    categoriasVisibles: (cuentaId: string) => readonly string[] = () => [],
  ): void {
    if (monedasVisibles.includes(s.moneda)) {
      this.moneda = s.moneda;
      this.entry = s.entry;
    } else {
      this.entry = adaptarEntry(s.entry, this.moneda).entry;
    }
    if (cuentasActivas.includes(s.cuentaId)) this.cuentaId = s.cuentaId;
    if (s.fecha) this.elegirFecha(s.fecha);
    this.ponerNota(s.nota);
    this.categoriaId =
      !this.guardadoRapido && s.categoriaId && categoriasVisibles(this.cuentaId).includes(s.categoriaId)
        ? s.categoriaId
        : null;
  }

  // ---------- Selección de categoría (Fase 8) ----------

  /**
   * Toque en una categoría. Con guardado rápido guarda al instante (monto 0 → `{ ok: false }`);
   * si no, la selecciona, cambia la selección o, si era la misma, la quita, y devuelve null.
   */
  async tocarCategoria(id: string): Promise<ResultadoGuardado | null> {
    if (this.guardadoRapido) return this.guardar(id);
    this.categoriaId = this.categoriaId === id ? null : id;
    return null;
  }

  /** Quita la selección (Escape). Devuelve true si había una. */
  deseleccionar(): boolean {
    const habia = this.categoriaId !== null;
    this.categoriaId = null;
    return habia;
  }

  /**
   * Cambia de cuenta. Si la categoría seleccionada no está entre las visibles de la nueva
   * cuenta, se deselecciona; devuelve su id para que la pantalla lo avise.
   */
  cambiarCuenta(cuentaId: string, categoriasVisibles: readonly string[]): string | null {
    this.cuentaId = cuentaId;
    return this.quitarSiNoVisible(categoriasVisibles);
  }

  /** Deselecciona la categoría si ya no está entre `categoriasVisibles`; devuelve la que quitó. */
  quitarSiNoVisible(categoriasVisibles: readonly string[]): string | null {
    const id = this.categoriaId;
    if (id === null || categoriasVisibles.includes(id)) return null;
    this.categoriaId = null;
    return id;
  }

  /** Lo que falta para guardar con el botón o con Enter; null si ya se puede. El monto va primero. */
  faltante(): Falta | null {
    if (entryToNumber(this.entry) <= 0) return { falta: 'monto', mensaje: MSG_FALTA_MONTO };
    if (this.categoriaId === null) return { falta: 'categoria', mensaje: MSG_FALTA_CATEGORIA };
    return null;
  }

  /**
   * Guarda con la categoría seleccionada (botón Guardar o Enter). Al guardar, el monto y la
   * selección se limpian al instante (antes de esperar a la base de datos), así que un segundo
   * toque inmediato no crea otro gasto. Si falta algo no guarda (`{ ok: false }`); si falla,
   * la selección vuelve junto con el monto, la nota y la foto.
   */
  async guardarSeleccion(): Promise<ResultadoGuardado> {
    const categoria = this.categoriaId;
    if (categoria === null || this.faltante()) return { ok: false };
    this.categoriaId = null;
    try {
      const r = await this.guardar(categoria);
      if (!r.ok && this.categoriaId === null) this.categoriaId = categoria;
      return r;
    } catch (e) {
      if (this.categoriaId === null) this.categoriaId = categoria;
      throw e;
    }
  }

  /**
   * Cambia la moneda. Si el monto en curso tiene decimales que la nueva moneda no admite,
   * se truncan y se devuelve lo descartado y el estado previo para avisar y poder deshacer.
   */
  cambiarMoneda(moneda: string): CambioMoneda | null {
    if (moneda === this.moneda) return null;
    const previa = { moneda: this.moneda, entry: this.entry };
    const r = adaptarEntry(this.entry, moneda);
    this.moneda = moneda;
    this.entry = r.entry;
    return { previa, descartados: r.descartados };
  }

  restaurarMoneda(previa: CambioMoneda['previa']): void {
    this.moneda = previa.moneda;
    this.entry = previa.entry;
  }

  pulsar(key: Key): void {
    this.entry = applyKey(this.entry, key, this.moneda);
  }

  /**
   * Guarda el gasto con la categoría elegida. Con monto 0 no guarda nada.
   * Si algo falla, el monto escrito se conserva y el error se propaga.
   */
  async guardar(categoriaId: string): Promise<ResultadoGuardado> {
    const monto = entryToNumber(this.entry);
    if (monto <= 0) return { ok: false };
    const entryPrevio = this.entry;
    const notaPrevia = this.nota;
    const fotoPrevia = this.foto;
    const gastoPrevio = this.ultimoGastoId;
    const actividadPrevia = this.ultimaActividad;
    try {
      const ahora = this.reloj();
      const fechaKey = this.fechaActual;
      const iso = ahora.toISOString();
      const gasto: Gasto = {
        id: this.uuid(),
        fecha: buildFechaIso(fechaKey, ahora),
        monto,
        moneda: this.moneda,
        categoriaId,
        cuentaId: this.cuentaId,
        nota: recortarNota(notaPrevia.trim()),
        fotoId: fotoPrevia ? this.uuid() : null,
        creadoEn: iso,
        editadoEn: iso,
        exportadoEn: null,
      };
      // El monto se limpia antes de esperar a la base de datos: un segundo toque
      // inmediato no puede guardar el mismo importe dos veces.
      this.entry = '';
      this.nota = '';
      this.foto = null;
      this.ultimoGastoId = gasto.id;
      this.ultimaActividad = ahora.getTime();
      await this.repo.add(gasto, fotoPrevia && gasto.fotoId ? fotoDesdeProcesada(gasto.fotoId, fotoPrevia) : null);
      return { ok: true, gasto, fechaKey, esHoy: fechaKey === this.hoy };
    } catch (e) {
      if (this.entry === '') this.entry = entryPrevio;
      if (this.nota === '') this.nota = notaPrevia;
      if (this.foto === null) this.foto = fotoPrevia;
      this.ultimoGastoId = gastoPrevio;
      this.ultimaActividad = actividadPrevia;
      throw e;
    }
  }

  /** Borra el último gasto guardado, si sigue disponible para deshacer. */
  async deshacer(): Promise<void> {
    const id = this.ultimoGastoId;
    this.ultimoGastoId = null;
    if (id) await this.repo.delete(id);
  }

  olvidarUltimo(): void {
    this.ultimoGastoId = null;
  }
}

/** Qué hizo (o debe hacer la pantalla con) una tecla física en Registrar. */
export type AccionTecla =
  | 'monto' // dígito, decimal o Backspace: ya se aplicó, la pantalla repinta el monto
  | 'guardar' // Enter: la pantalla ejecuta Guardar (o dice qué falta)
  | 'deseleccionar' // Escape con una categoría seleccionada: ya se quitó
  | 'ignorada'; // consumida sin efecto (Enter con guardado rápido)

/**
 * Teclado físico en Registrar: dígitos, punto/coma decimal y Backspace aplican al monto;
 * Enter guarda (como el botón Guardar) y Escape quita la categoría seleccionada. Con guardado
 * rápido Enter se ignora: guardar exige tocar una categoría. Devuelve null si la tecla no se
 * consume (la pantalla no debe llamar a `preventDefault`).
 */
export function aplicarTeclaFisica(sesion: SesionRegistro, tecla: string): AccionTecla | null {
  if (/^[0-9]$/.test(tecla)) {
    sesion.pulsar(tecla as Key);
    return 'monto';
  }
  if (tecla === '.' || tecla === ',') {
    sesion.pulsar('.');
    return 'monto';
  }
  if (tecla === 'Backspace') {
    sesion.pulsar('back');
    return 'monto';
  }
  if (tecla === 'Enter') return sesion.guardadoRapido ? 'ignorada' : 'guardar';
  if (tecla === 'Escape') return sesion.deseleccionar() ? 'deseleccionar' : null;
  return null;
}
