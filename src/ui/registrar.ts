import { db, getAjuste } from '../db';
import { addDays, dayMonthLabel, shortLabel } from '../lib/dates';
import { mensajeDeError } from '../lib/compat';
import { formatEntry, entryToNumber, type Key } from '../lib/money';
import { aplicarTeclaFisica, SesionRegistro } from '../lib/registro';
import type { Categoria } from '../types';
import { mostrarError } from './avisos';

const DESHACER_MS = 5000;

const TECLAS: { key: Key; label: string; aria?: string }[] = [
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: '7', label: '7' },
  { key: '8', label: '8' },
  { key: '9', label: '9' },
  { key: '00', label: '00' },
  { key: '0', label: '0' },
  { key: 'back', label: '⌫', aria: 'Borrar' },
];

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

/** Quita el foco del botón tocado: Enter o espacio no deben repetir la acción. */
function sinFoco(e: Event): void {
  (e.currentTarget as HTMLElement | null)?.blur();
}

export async function crearRegistrar(): Promise<HTMLElement> {
  const moneda = await getAjuste('monedaPredeterminada', 'COP');
  const sesion = new SesionRegistro(moneda, {
    add: async (g) => void (await db.gastos.add(g)),
    delete: (id) => db.gastos.delete(id),
  });
  let toastTimer: number | undefined;

  const root = el('section', 'registrar');

  // --- Fila de chips ---
  const chips = el('div', 'chips');
  const chipFecha = el('button', 'chip');
  chipFecha.type = 'button';
  const chipMoneda = el('span', 'chip chip-info', moneda);
  chips.append(chipFecha, chipMoneda);

  // --- Monto ---
  const monto = el('div', 'monto');
  monto.setAttribute('role', 'status');
  const montoSimbolo = el('span', 'monto-simbolo', '$');
  const montoValor = el('span', 'monto-valor');
  monto.append(montoSimbolo, montoValor);

  // --- Teclado ---
  const teclado = el('div', 'teclado');
  for (const t of TECLAS) {
    const b = el('button', 'tecla', t.label);
    b.type = 'button';
    if (t.aria) b.setAttribute('aria-label', t.aria);
    b.addEventListener('click', (e) => {
      sesion.pulsar(t.key);
      pintarMonto();
      sinFoco(e);
    });
    teclado.append(b);
  }

  // --- Categorías ---
  const grid = el('div', 'categorias');

  // --- Aviso "Guardado · Deshacer" ---
  const toast = el('div', 'toast');
  toast.hidden = true;
  const toastTexto = el('span');
  const toastDeshacer = el('button', 'toast-btn', 'Deshacer');
  toastDeshacer.type = 'button';
  toast.append(toastTexto, toastDeshacer);

  // --- Hoja de fecha ---
  const hoja = el('div', 'hoja');
  hoja.hidden = true;
  const hojaPanel = el('div', 'hoja-panel');
  hoja.append(hojaPanel);

  root.append(chips, monto, teclado, grid, toast, hoja);

  // ---------- Pintado ----------
  function pintarFecha(): void {
    const key = sesion.fechaActual;
    const esHoy = key === sesion.hoy;
    chipFecha.textContent = `📅 ${esHoy ? 'Hoy' : shortLabel(key)}`;
    chipFecha.classList.toggle('chip-alerta', !esHoy);
  }

  function pintarMonto(): void {
    montoValor.textContent = formatEntry(sesion.entry);
    monto.classList.toggle('vacio', entryToNumber(sesion.entry) === 0);
  }

  function vibrarMonto(): void {
    monto.classList.remove('vibra');
    void monto.offsetWidth;
    monto.classList.add('vibra');
    navigator.vibrate?.(120);
  }

  function mostrarToast(texto: string): void {
    window.clearTimeout(toastTimer);
    toastTexto.textContent = texto;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      sesion.olvidarUltimo();
    }, DESHACER_MS);
  }

  toastDeshacer.addEventListener('click', async () => {
    window.clearTimeout(toastTimer);
    toast.hidden = true;
    try {
      await sesion.deshacer();
    } catch (e) {
      mostrarError(`No se pudo deshacer: ${mensajeDeError(e)}`);
    }
  });

  async function guardar(cat: Categoria): Promise<void> {
    if (entryToNumber(sesion.entry) <= 0) {
      vibrarMonto();
      return;
    }
    try {
      const promesa = sesion.guardar(cat.id);
      pintarMonto(); // el monto ya se limpió; la base de datos termina en segundo plano
      const r = await promesa;
      if (!r.ok) return;
      pintarFecha();
      mostrarToast(r.esHoy ? 'Guardado' : `Guardado el ${dayMonthLabel(r.fechaKey)}`);
    } catch (e) {
      pintarMonto(); // la sesión conserva el monto escrito
      mostrarError(`No se pudo guardar: ${mensajeDeError(e)}`);
    }
  }

  async function pintarCategorias(): Promise<void> {
    const cats = (await db.categorias.orderBy('orden').toArray()).filter((c) => c.activa);
    grid.replaceChildren(
      ...cats.map((c) => {
        const b = el('button', 'cat');
        b.type = 'button';
        b.append(el('span', 'cat-emoji', c.emoji), el('span', 'cat-nombre', c.nombre));
        b.addEventListener('click', (e) => {
          sinFoco(e);
          void guardar(c);
        });
        return b;
      }),
    );
  }

  // ---------- Selector de fecha ----------
  function cerrarHoja(): void {
    hoja.hidden = true;
    pintarFecha();
  }

  function abrirHoja(): void {
    const h = sesion.hoy;
    const actual = sesion.fechaActual;
    const opciones: [string, number][] = [
      ['Hoy', 0],
      ['Ayer', 1],
      ['Antier', 2],
    ];
    const botones = opciones.map(([label, dias]) => {
      const key = addDays(h, -dias);
      const b = el('button', 'hoja-op', `${label} · ${dayMonthLabel(key)}`);
      b.type = 'button';
      b.classList.toggle('activa', key === actual);
      b.addEventListener('click', () => {
        sesion.elegirDiasAtras(dias);
        cerrarHoja();
      });
      return b;
    });

    const input = el('input', 'fecha-input');
    input.type = 'date';
    input.max = h;
    input.value = actual;
    input.addEventListener('change', () => {
      if (!input.value) return;
      sesion.elegirFecha(input.value);
      cerrarHoja();
    });
    const otra = el('button', 'hoja-op', 'Elegir fecha…');
    otra.type = 'button';
    otra.addEventListener('click', () => {
      try {
        input.showPicker();
      } catch {
        input.focus();
        input.click();
      }
    });

    const cerrar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cerrar.type = 'button';
    cerrar.addEventListener('click', () => (hoja.hidden = true));

    hojaPanel.replaceChildren(...botones, otra, input, cerrar);
    hoja.hidden = false;
  }

  chipFecha.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHoja();
  });
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) hoja.hidden = true;
  });

  // ---------- Teclado físico ----------
  document.addEventListener('keydown', (e) => {
    if (root.hidden || !hoja.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    if (aplicarTeclaFisica(sesion, e.key)) {
      e.preventDefault(); // también evita que Enter active un botón con foco
      pintarMonto();
    }
  });

  // Mantiene el chip al día (reinicio por inactividad / cambio de día).
  window.setInterval(pintarFecha, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pintarFecha();
  });

  pintarMonto();
  pintarFecha();
  await pintarCategorias();
  return root;
}
