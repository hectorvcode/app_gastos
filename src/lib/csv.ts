import { decimalsFor } from './money';

export const COLUMNAS = ['id', 'fecha', 'hora', 'monto', 'moneda', 'categoria', 'cuenta', 'nota', 'foto', 'cambio'] as const;

export type Cambio = 'nuevo' | 'editado' | 'eliminado';
/** "coma": decimal con coma y columnas separadas por punto y coma (Sheets en español). "punto": decimal con punto y columnas con coma. */
export type Decimal = 'coma' | 'punto';

export interface FilaCsv {
  id: string;
  /** AAAA-MM-DD (hora local) */
  fecha: string;
  /** HH:MM */
  hora: string;
  /** null en las filas "eliminado" (solo se conoce el id) */
  monto: number | null;
  moneda: string;
  categoria: string;
  cuenta: string;
  nota: string;
  /** Nombre del archivo dentro del ZIP; vacío si no hay foto o si es solo CSV */
  foto: string;
  cambio: Cambio;
}

export const BOM = '﻿';
const FIN_DE_LINEA = '\r\n';

/** Decimal por defecto: coma, porque la hoja de Sheets está en español de Colombia. */
export const DECIMAL_POR_DEFECTO: Decimal = 'coma';

export const decimalDeAjuste = (valor: unknown): Decimal => (valor === 'punto' ? 'punto' : DECIMAL_POR_DEFECTO);

export const separadorDe = (d: Decimal): string => (d === 'coma' ? ';' : ',');

/** Monto sin separador de miles y sin ceros sobrantes: "45000", "12.5" (o "12,5" con coma). */
export function formatearMontoCsv(monto: number, moneda: string, decimal: Decimal): string {
  const texto = String(Number(monto.toFixed(decimalsFor(moneda))));
  return decimal === 'coma' ? texto.replace('.', ',') : texto;
}

/** Entre comillas si tiene separadores, comillas o saltos de línea; las comillas internas se duplican. */
export function escaparCampo(valor: string): string {
  return /[",;\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** CSV completo: BOM, encabezado y una fila por gasto, con fin de línea CRLF. */
export function generarCsv(filas: readonly FilaCsv[], decimal: Decimal): string {
  const sep = separadorDe(decimal);
  const lineas = [COLUMNAS.join(sep)];
  for (const f of filas) {
    // El monto nunca se entrecomilla: su coma decimal no es un separador de columnas.
    const monto = f.monto === null ? '' : formatearMontoCsv(f.monto, f.moneda, decimal);
    const texto = [f.id, f.fecha, f.hora];
    const resto = [f.moneda, f.categoria, f.cuenta, f.nota, f.foto, f.cambio];
    lineas.push([...texto.map(escaparCampo), monto, ...resto.map(escaparCampo)].join(sep));
  }
  return BOM + lineas.join(FIN_DE_LINEA) + FIN_DE_LINEA;
}
