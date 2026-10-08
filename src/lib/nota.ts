export const MAX_NOTA = 200;

/** Recorta la nota al máximo permitido (el campo ya lleva maxLength; esto cubre pegados y otros caminos). */
export function recortarNota(texto: string): string {
  return texto.slice(0, MAX_NOTA);
}
