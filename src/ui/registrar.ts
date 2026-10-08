import { db, getAjuste } from '../db';
import type { Categoria, Gasto } from '../types';
import { addDays, buildFechaIso, dateKey, dayMonthLabel, shortLabel } from '../lib/dates';
import { applyKey, entryToNumber, formatEntry, type Key } from '../lib/money';

const REINICIO_FECHA_MS = 10 * 60 * 1000;
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

export async function crearRegistrar(): Promise<HTMLElement> {
  let moneda = await getAjuste('monedaPredeterminada', 'COP');
  let entry = '';
  /** null = "Hoy" (sigue al reloj, incluso pasada la medianoche). */
  let fechaElegida: string | null = null;
  let ultimaActividad = Date.now();
  let ultimoGastoId: string | null = null;
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
    b.addEventListener('click', () => {
      entry = applyKey(entry, t.key, moneda);
      pintarMonto();
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

  // ---------- Lógica ----------
  const hoy = (): string => dateKey(new Date());

  /** Vuelve a "Hoy" si pasaron 10 minutos sin registrar. */
  function revisarReinicioFecha(): void {
    if (fechaElegida !== null && Date.now() - ultimaActividad > REINICIO_FECHA_MS) {
      fechaElegida = null;
    }
  }

  function fechaActual(): string {
    revisarReinicioFecha();
    return fechaElegida ?? hoy();
  }

  function pintarFecha(): void {
    const key = fechaActual();
    const esHoy = key === hoy();
    chipFecha.textContent = `📅 ${esHoy ? 'Hoy' : shortLabel(key)}`;
    chipFecha.classList.toggle('chip-alerta', !esHoy);
  }

  function pintarMonto(): void {
    montoValor.textContent = formatEntry(entry);
    monto.classList.toggle('vacio', entry === '' || entryToNumber(entry) === 0);
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
      ultimoGastoId = null;
    }, DESHACER_MS);
  }

  toastDeshacer.addEventListener('click', async () => {
    window.clearTimeout(toastTimer);
    toast.hidden = true;
    if (ultimoGastoId) {
      await db.gastos.delete(ultimoGastoId);
      ultimoGastoId = null;
    }
  });

  async function guardar(cat: Categoria): Promise<void> {
    const importe = entryToNumber(entry);
    if (importe <= 0) {
      vibrarMonto();
      return;
    }
    const ahora = new Date();
    const key = fechaActual();
    const iso = ahora.toISOString();
    const gasto: Gasto = {
      id: crypto.randomUUID(),
      fecha: buildFechaIso(key, ahora),
      monto: importe,
      moneda,
      categoriaId: cat.id,
      nota: '',
      fotoId: null,
      creadoEn: iso,
      editadoEn: iso,
      exportadoEn: null,
    };
    await db.gastos.add(gasto);
    ultimoGastoId = gasto.id;
    ultimaActividad = Date.now();
    entry = '';
    pintarMonto();
    pintarFecha();
    mostrarToast(key === hoy() ? 'Guardado' : `Guardado el ${dayMonthLabel(key)}`);
  }

  async function pintarCategorias(): Promise<void> {
    const cats = (await db.categorias.orderBy('orden').toArray()).filter((c) => c.activa);
    grid.replaceChildren(
      ...cats.map((c) => {
        const b = el('button', 'cat');
        b.type = 'button';
        b.append(el('span', 'cat-emoji', c.emoji), el('span', 'cat-nombre', c.nombre));
        b.addEventListener('click', () => void guardar(c));
        return b;
      }),
    );
  }

  // ---------- Selector de fecha ----------
  function elegirFecha(key: string | null): void {
    fechaElegida = key === hoy() ? null : key;
    ultimaActividad = Date.now();
    hoja.hidden = true;
    pintarFecha();
  }

  function abrirHoja(): void {
    const h = hoy();
    const opciones: [string, string][] = [
      ['Hoy', h],
      ['Ayer', addDays(h, -1)],
      ['Antier', addDays(h, -2)],
    ];
    const actual = fechaActual();
    const botones = opciones.map(([label, key]) => {
      const b = el('button', 'hoja-op', `${label} · ${dayMonthLabel(key)}`);
      b.type = 'button';
      b.classList.toggle('activa', key === actual);
      b.addEventListener('click', () => elegirFecha(key));
      return b;
    });

    const input = el('input', 'fecha-input');
    input.type = 'date';
    input.max = h;
    input.value = actual;
    input.addEventListener('change', () => {
      if (input.value && input.value <= hoy()) elegirFecha(input.value);
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

  chipFecha.addEventListener('click', abrirHoja);
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) hoja.hidden = true;
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
