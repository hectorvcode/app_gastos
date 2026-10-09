export interface Gasto {
  id: string;
  fecha: string;
  monto: number;
  moneda: string;
  categoriaId: string;
  cuentaId: string;
  nota: string;
  fotoId: string | null;
  creadoEn: string;
  editadoEn: string;
  exportadoEn: string | null;
}

/** Gasto borrado que ya había salido en una exportación: sirve para avisar a Sheets en la siguiente. */
export interface Eliminado {
  id: string;
  cuentaId: string;
  /** ISO del borrado (el instante en que se tocó "Eliminar"). */
  eliminadoEn: string;
}

export interface Foto {
  id: string;
  blob: Blob;
  /** Miniatura cuadrada de ~160 px para Historial. */
  miniatura?: Blob;
  /** Diagnóstico de la orientación EXIF, solo informativo. */
  diag?: string;
  ancho: number;
  alto: number;
}

export interface Categoria {
  id: string;
  nombre: string;
  emoji: string;
  orden: number;
  activa: boolean;
}

export interface Cuenta {
  id: string;
  nombre: string;
  emoji: string;
  orden: number;
  archivada: boolean;
  /**
   * Ids de las categorías que la cuenta muestra en Registrar, en su orden (máximo 12, mínimo 1).
   * Ausente solo en datos anteriores a la Fase 7a: `lib/categorias.ts` lo completa.
   */
  categoriaIds?: string[];
}

export interface Ajuste {
  clave: string;
  valor: unknown;
}
