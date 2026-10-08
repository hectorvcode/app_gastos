import type { Gasto } from '../types';
import { generarUuid } from './compat';
import { CUENTA_PERSONAL_ID } from './cuentas';
import { addDays, buildFechaIso, dateKey } from './dates';
import { adaptarEntry, applyKey, entryToNumber, type Key } from './money';
import { recortarNota } from './nota';

export const REINICIO_FECHA_MS = 10 * 60 * 1000;

export interface RepoGastos {
  add(gasto: Gasto): Promise<void>;
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
        fotoId: null,
        creadoEn: iso,
        editadoEn: iso,
        exportadoEn: null,
      };
      // El monto se limpia antes de esperar a la base de datos: un segundo toque
      // inmediato no puede guardar el mismo importe dos veces.
      this.entry = '';
      this.nota = '';
      this.ultimoGastoId = gasto.id;
      this.ultimaActividad = ahora.getTime();
      await this.repo.add(gasto);
      return { ok: true, gasto, fechaKey, esHoy: fechaKey === this.hoy };
    } catch (e) {
      if (this.entry === '') this.entry = entryPrevio;
      if (this.nota === '') this.nota = notaPrevia;
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
