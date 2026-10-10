import { archivoParaDescarga } from '../lib/exportar';

/**
 * Descarga directa de un archivo (escritorio y celular: Chrome en Android no comparte ZIP). Usa el tipo genérico
 * y el nombre exacto, y conserva el enlace y la URL un buen rato: en la app instalada, soltarlos antes puede
 * cortar la descarga.
 */
export function descargarArchivo(archivo: File): void {
  const descarga = archivoParaDescarga(archivo);
  const url = URL.createObjectURL(descarga);
  const a = document.createElement('a');
  a.href = url;
  a.download = descarga.name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  window.setTimeout(() => a.remove(), 1000);
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}
