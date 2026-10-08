import { repoAjustes } from '../db';
import { mensajeDeError } from '../lib/compat';
import {
  alternarVisible,
  CATALOGO_MONEDAS,
  cargarConfigMonedas,
  elegirPredeterminada,
  guardarConfigMonedas,
  guardarUltimaMoneda,
  type ConfigMonedas,
  type ResultadoConfig,
} from '../lib/monedas';
import { mostrarError } from './avisos';

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

export interface VistaAjustes {
  el: HTMLElement;
  /** Vuelve a leer los ajustes; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

/** Ajustes: por ahora solo la sección "Monedas" (el resto llega en la Fase 7). */
export function crearAjustes(): VistaAjustes {
  let config: ConfigMonedas | null = null;

  const root = el('section', 'ajustes');
  const seccion = el('div', 'ajustes-seccion');
  const lista = el('div', 'monedas-lista');
  const mensaje = el('p', 'hoja-ayuda');
  mensaje.setAttribute('role', 'status');
  seccion.append(
    el('h2', 'hoja-titulo', 'Monedas'),
    el(
      'p',
      'hoja-ayuda',
      'Elige la moneda predeterminada y cuáles aparecen al registrar. La predeterminada siempre está visible.',
    ),
    lista,
    mensaje,
  );
  root.append(seccion, el('p', 'pronto-resto', 'Categorías, almacenamiento, exportar y respaldo: próximamente'));

  async function aplicar(r: ResultadoConfig, nuevaPredeterminada: boolean): Promise<void> {
    if (!r.ok) {
      mensaje.textContent = r.error;
      return;
    }
    try {
      await guardarConfigMonedas(repoAjustes, r.config);
      // Al cambiar la predeterminada, Registrar también pasa a esa moneda.
      if (nuevaPredeterminada) await guardarUltimaMoneda(repoAjustes, r.config.predeterminada);
    } catch (e) {
      mostrarError(`No se pudo guardar los ajustes de monedas: ${mensajeDeError(e)}`);
      return;
    }
    config = r.config;
    mensaje.textContent = '';
    pintar();
  }

  function pintar(): void {
    const c = config;
    if (!c) return;
    lista.replaceChildren(
      ...CATALOGO_MONEDAS.map((m) => {
        const esPred = m.codigo === c.predeterminada;
        const visible = c.visibles.includes(m.codigo);
        const fila = el('div', 'moneda-fila');
        fila.append(el('span', 'moneda-nombre', `${m.codigo} · ${m.nombre}`));

        const btnVisible = el('button', 'cat-op', visible ? 'Visible' : 'Oculta');
        btnVisible.type = 'button';
        btnVisible.setAttribute('aria-pressed', String(visible));
        btnVisible.setAttribute('aria-label', `${m.codigo}: ${visible ? 'visible' : 'oculta'}`);
        btnVisible.addEventListener('click', () => void aplicar(alternarVisible(c, m.codigo), false));

        const btnPred = el('button', 'cat-op', esPred ? 'Predeterminada' : 'Predeterminar');
        btnPred.type = 'button';
        btnPred.setAttribute('aria-pressed', String(esPred));
        btnPred.disabled = esPred;
        btnPred.addEventListener('click', () => void aplicar(elegirPredeterminada(c, m.codigo), true));

        fila.append(btnVisible, btnPred);
        return fila;
      }),
    );
  }

  async function activar(): Promise<void> {
    config = await cargarConfigMonedas(repoAjustes);
    mensaje.textContent = '';
    pintar();
  }

  return { el: root, activar };
}
