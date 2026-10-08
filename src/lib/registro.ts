import type { Foto, Gasto } from '../types';
import { generarUuid } from './compat';
import { CUENTA_PERSONAL_ID } from './cuentas';
import { addDays, buildFechaIso, dateKey } from './dates';
import type { InstantaneaRegistro } from './borrador';
import { fotoDesdeProcesada, type FotoProcesada } from './fotos';
import { adaptarEntry, applyKey, entryToNumber, type Key } from './money';
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
      nota: this.nota,
    };
  }

  /**
   * Vuelve a poner lo escrito. Ignora la moneda o la cuenta que ya no estén disponibles
   * (se queda con las actuales) y no admite fechas futuras.
   */
  restaurar(s: InstantaneaRegistro, monedasVisibles: readonly string[], cuentasActivas: readonly string[]): void {
    if (monedasVisibles.includes(s.moneda)) {
      this.moneda = s.moneda;
      this.entry = s.entry;
    } else {
      this.entry = adaptarEntry(s.entry, this.moneda).entry;
    }
    if (cuentasActivas.includes(s.cuentaId)) this.cuentaId = s.cuentaId;
    if (s.fecha) this.elegirFecha(s.fecha);
    this.ponerNota(s.nota);
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

/**
 * Teclado físico en Registrar: dígitos, punto/coma decimal y Backspace.
 * Enter se consume sin hacer nada: guardar exige tocar una categoría.
 * Devuelve true si la tecla se consumió.
 */
export function aplicarTeclaFisica(sesion: SesionRegistro, tecla: string): boolean {
  if (/^[0-9]$/.test(tecla)) {
    sesion.pulsar(tecla as Key);
    return true;
  }
  if (tecla === '.' || tecla === ',') {
    sesion.pulsar('.');
    return true;
  }
  if (tecla === 'Backspace') {
    sesion.pulsar('back');
    return true;
  }
  return tecla === 'Enter';
}
