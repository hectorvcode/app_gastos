import { contarAlmacenamiento } from '../db';
import { mensajeDeError } from '../lib/compat';
import {
  leerAlmacenamiento,
  NO_DISPONIBLE,
  pedirAlmacenamientoPersistente,
  textoConteos,
  textoEspacio,
  textoPersistencia,
} from '../lib/almacenamiento';
import { mostrarAviso, mostrarError } from './avisos';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export interface SeccionAlmacenamiento {
  el: HTMLElement;
  /** Vuelve a leer el estado; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

/** Ajustes → Almacenamiento: espacio, persistencia y cuánto ocupan los gastos y las fotos. */
export function crearSeccionAlmacenamiento(): SeccionAlmacenamiento {
  const root = el('div', 'ajustes-seccion');
  const espacio = el('p', 'exportar-resumen');
  const persistencia = el('p', 'hoja-ayuda');
  const conteos = el('p', 'exportar-resumen');
  const btnPersistente = el('button', 'btn-primario', 'Pedir almacenamiento persistente');
  btnPersistente.type = 'button';
  btnPersistente.hidden = true;
  root.append(
    el('p', 'hoja-ayuda', 'Tus gastos y fotos viven solo en este teléfono, dentro de Chrome. Haz respaldos con regularidad.'),
    el('p', 'edit-titulo', 'Espacio'),
    espacio,
    persistencia,
    btnPersistente,
    el('p', 'edit-titulo', 'Tus datos'),
    conteos,
  );

  async function activar(): Promise<void> {
    const estado = await leerAlmacenamiento();
    espacio.textContent = textoEspacio(estado);
    persistencia.textContent = textoPersistencia(estado.persistente);
    // Solo se ofrece pedirlo si se puede y todavía no lo es.
    btnPersistente.hidden = !(estado.puedePedir && estado.persistente === false);
    try {
      const c = await contarAlmacenamiento();
      conteos.textContent = textoConteos(c.gastos, c.fotos, c.bytesFotos);
    } catch (e) {
      conteos.textContent = NO_DISPONIBLE;
      mostrarError(`No se pudo leer la cantidad de gastos y fotos: ${mensajeDeError(e)}`);
    }
  }

  btnPersistente.addEventListener('click', async () => {
    btnPersistente.disabled = true;
    try {
      const r = await pedirAlmacenamientoPersistente();
      if (r === true) mostrarAviso('Listo: Chrome marcó el almacenamiento como persistente.');
      else if (r === false) {
        mostrarAviso(
          'Chrome no concedió el almacenamiento persistente. Suele darlo si instalas la app o la usas seguido; puedes volver a intentarlo más tarde.',
        );
      } else mostrarAviso(`Almacenamiento persistente: ${NO_DISPONIBLE.toLowerCase()}.`);
      await activar();
    } catch (e) {
      mostrarError(`No se pudo pedir el almacenamiento persistente: ${mensajeDeError(e)}`);
    } finally {
      btnPersistente.disabled = false;
    }
  });

  return { el: root, activar };
}
