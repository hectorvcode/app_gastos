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

export interface Foto {
  id: string;
  blob: Blob;
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
}

export interface Ajuste {
  clave: string;
  valor: unknown;
}
