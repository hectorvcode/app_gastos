import type { Gasto } from '../types';
import { generarUuid } from './compat';
import { addDays, buildFechaIso, dateKey } from './dates';
import { applyKey, entryToNumber, type Key } from './money';

export const REINICIO_FECHA_MS = 10 * 60 * 1000;

export interface RepoGastos {
  add(gasto: Gasto): Promise<void>;
  delete(id: string): Promise<void>;
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
        nota: '',
        fotoId: null,
        creadoEn: iso,
        editadoEn: iso,
        exportadoEn: null,
      };
      // El monto se limpia antes de esperar a la base de datos: un segundo toque
      // inmediato no puede guardar el mismo importe dos veces.
      this.entry = '';
      this.ultimoGastoId = gasto.id;
      this.ultimaActividad = ahora.getTime();
      await this.repo.add(gasto);
      return { ok: true, gasto, fechaKey, esHoy: fechaKey === this.hoy };
    } catch (e) {
      if (this.entry === '') this.entry = entryPrevio;
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
