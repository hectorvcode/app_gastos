import { db, repoAjustes } from '../db';
import { addDays, dayMonthLabel, shortLabel } from '../lib/dates';
import { mensajeDeError } from '../lib/compat';
import {
  cargarEstadoCuentas,
  cuentasActivas,
  etiquetaCuenta,
  guardarUltimaCuenta,
  mostrarChipCuenta,
  resolverCuentaActual,
  textoGuardado,
} from '../lib/cuentas';
import { formatEntryPartes, entryToNumber, simboloMoneda, formatMonto, teclaExtra, type Key } from '../lib/money';
import {
  CATALOGO_MONEDAS,
  cargarConfigMonedas,
  guardarUltimaMoneda,
  resolverMonedaInicial,
  type ConfigMonedas,
} from '../lib/monedas';
import { MAX_NOTA } from '../lib/nota';
import { aplicarTeclaFisica, SesionRegistro, type CambioMoneda } from '../lib/registro';
import type { Categoria, Cuenta } from '../types';
import { mostrarError } from './avisos';
import { cerrarTecladoConEnter } from './teclado';

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
  { key: '.', label: '', aria: '' }, // tecla "00" / "," según la moneda (ver pintarMoneda)
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

export interface VistaRegistrar {
  el: HTMLElement;
  /** Relee los ajustes de monedas; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

export async function crearRegistrar(): Promise<VistaRegistrar> {
  let config: ConfigMonedas = await cargarConfigMonedas(repoAjustes);
  const moneda = resolverMonedaInicial(await repoAjustes.get('ultimaMoneda'), config);
  const sesion = new SesionRegistro(moneda, {
    add: async (g) => void (await db.gastos.add(g)),
    delete: (id) => db.gastos.delete(id),
  });
  let cuentas: Cuenta[] = await db.cuentas.toArray();
  const estadoCuentas = await cargarEstadoCuentas(repoAjustes, cuentas);
  let cuentaPredeterminada = estadoCuentas.predeterminada;
  sesion.cuentaId = estadoCuentas.actual;
  let toastTimer: number | undefined;

  const root = el('section', 'registrar');

  // --- Fila de chips ---
  const chips = el('div', 'chips');
  const chipFecha = el('button', 'chip');
  chipFecha.type = 'button';
  const chipMoneda = el('button', 'chip');
  chipMoneda.type = 'button';
  const chipCuenta = el('button', 'chip');
  chipCuenta.type = 'button';
  const chipNota = el('button', 'chip');
  chipNota.type = 'button';
  chips.append(chipFecha, chipMoneda, chipCuenta, chipNota);

  // --- Monto ---
  const monto = el('div', 'monto');
  monto.setAttribute('role', 'status');
  const montoSimbolo = el('span', 'monto-simbolo', '$');
  const montoValor = el('span', 'monto-valor');
  const montoRelleno = el('span', 'monto-relleno');
  monto.append(montoSimbolo, montoValor, montoRelleno);

  // --- Teclado ---
  const teclado = el('div', 'teclado');
  let teclaExtraBtn: HTMLButtonElement | undefined;
  for (const t of TECLAS) {
    const b = el('button', 'tecla', t.label);
    b.type = 'button';
    if (t.aria) b.setAttribute('aria-label', t.aria);
    const esExtra = t.label === '';
    if (esExtra) teclaExtraBtn = b;
    b.addEventListener('click', (e) => {
      sesion.pulsar(esExtra ? teclaExtra(sesion.moneda).key : t.key);
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

  // --- Aviso de decimales descartados al cambiar de moneda ---
  const avisoMoneda = el('div', 'toast');
  avisoMoneda.hidden = true;
  const avisoMonedaTexto = el('span');
  const avisoMonedaDeshacer = el('button', 'toast-btn', 'Deshacer');
  avisoMonedaDeshacer.type = 'button';
  avisoMoneda.append(avisoMonedaTexto, avisoMonedaDeshacer);
  let avisoMonedaTimer: number | undefined;

  // --- Hoja (fecha, moneda y nota) ---
  const hoja = el('div', 'hoja');
  hoja.hidden = true;
  const hojaPanel = el('div', 'hoja-panel');
  hoja.append(hojaPanel);

  root.append(chips, monto, teclado, grid, toast, avisoMoneda, hoja);

  // ---------- Pintado ----------
  function pintarFecha(): void {
    const key = sesion.fechaActual;
    const esHoy = key === sesion.hoy;
    chipFecha.textContent = `📅 ${esHoy ? 'Hoy' : shortLabel(key)}`;
    chipFecha.classList.toggle('chip-alerta', !esHoy);
  }

  function pintarMoneda(): void {
    chipMoneda.textContent = `💱 ${sesion.moneda}`;
    chipMoneda.classList.toggle('chip-alerta', sesion.moneda !== config.predeterminada);
    montoSimbolo.textContent = simboloMoneda(sesion.moneda);
    if (teclaExtraBtn) {
      const extra = teclaExtra(sesion.moneda);
      teclaExtraBtn.textContent = extra.label;
      teclaExtraBtn.setAttribute('aria-label', extra.aria);
    }
  }

  function pintarCuenta(): void {
    chipCuenta.hidden = !mostrarChipCuenta(cuentas);
    const c = cuentas.find((x) => x.id === sesion.cuentaId);
    chipCuenta.textContent = c ? etiquetaCuenta(c) : '📒 Cuenta';
    chipCuenta.classList.toggle('chip-alerta', sesion.cuentaId !== cuentaPredeterminada);
  }

  function pintarNota(): void {
    const hay = sesion.nota !== '';
    chipNota.textContent = hay ? '📝 Nota ●' : '📝 Nota';
    chipNota.classList.toggle('chip-alerta', hay);
    chipNota.setAttribute('aria-label', hay ? 'Nota pendiente para el próximo gasto' : 'Agregar nota');
  }

  function pintarMonto(): void {
    const partes = formatEntryPartes(sesion.entry, sesion.moneda);
    montoValor.textContent = partes.escrito;
    montoRelleno.textContent = partes.relleno;
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
      pintarNota();
      const r = await promesa;
      if (!r.ok) return;
      pintarFecha();
      const cuenta = cuentas.find((x) => x.id === r.gasto.cuentaId);
      mostrarToast(
        textoGuardado(
          r.esHoy ? null : dayMonthLabel(r.fechaKey),
          cuenta && cuenta.id !== cuentaPredeterminada ? cuenta.nombre : null,
        ),
      );
    } catch (e) {
      pintarMonto(); // la sesión conserva el monto y la nota escritos
      pintarNota();
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
    pintarMoneda();
    pintarCuenta();
    pintarNota();
    pintarMonto();
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
    cerrar.addEventListener('click', cerrarHoja);

    hojaPanel.replaceChildren(...botones, otra, input, cerrar);
    hoja.hidden = false;
  }

  chipFecha.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHoja();
  });
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) cerrarHoja();
  });

  // ---------- Selector de moneda ----------
  async function persistirMoneda(): Promise<void> {
    try {
      await guardarUltimaMoneda(repoAjustes, sesion.moneda);
    } catch (e) {
      mostrarError(`No se pudo recordar la moneda elegida: ${mensajeDeError(e)}`);
    }
  }

  /** Aplica el cambio y, si se descartaron decimales, lo avisa con opción de deshacer. */
  function aplicarMoneda(codigo: string): void {
    const cambio = sesion.cambiarMoneda(codigo);
    if (!cambio) return;
    void persistirMoneda();
    pintarMoneda();
    pintarMonto();
    if (cambio.descartados !== '') avisarDecimales(cambio);
  }

  function avisarDecimales(cambio: CambioMoneda): void {
    const antes = formatMonto(entryToNumber(cambio.previa.entry), cambio.previa.moneda);
    const ahora = formatMonto(entryToNumber(sesion.entry), sesion.moneda);
    window.clearTimeout(avisoMonedaTimer);
    avisoMonedaTexto.textContent = `${sesion.moneda} no usa decimales: ${antes} → ${ahora}`;
    avisoMoneda.hidden = false;
    avisoMonedaDeshacer.onclick = () => {
      window.clearTimeout(avisoMonedaTimer);
      avisoMoneda.hidden = true;
      sesion.restaurarMoneda(cambio.previa);
      void persistirMoneda();
      pintarMoneda();
      pintarMonto();
    };
    avisoMonedaTimer = window.setTimeout(() => (avisoMoneda.hidden = true), 8000);
  }

  function abrirHojaMoneda(): void {
    const nombres = new Map(CATALOGO_MONEDAS.map((m) => [m.codigo, m.nombre]));
    const botones = config.visibles.map((codigo) => {
      const pred = codigo === config.predeterminada ? ' · predeterminada' : '';
      const b = el('button', 'hoja-op', `${codigo} · ${nombres.get(codigo) ?? codigo}${pred}`);
      b.type = 'button';
      b.classList.toggle('activa', codigo === sesion.moneda);
      b.addEventListener('click', () => {
        aplicarMoneda(codigo);
        cerrarHoja();
      });
      return b;
    });
    const cerrar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cerrar.type = 'button';
    cerrar.addEventListener('click', cerrarHoja);
    hojaPanel.replaceChildren(...botones, cerrar);
    hoja.hidden = false;
  }

  chipMoneda.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHojaMoneda();
  });

  // ---------- Selector de cuenta ----------
  async function persistirCuenta(): Promise<void> {
    try {
      await guardarUltimaCuenta(repoAjustes, sesion.cuentaId);
    } catch (e) {
      mostrarError(`No se pudo recordar la cuenta elegida: ${mensajeDeError(e)}`);
    }
  }

  function abrirHojaCuenta(): void {
    const botones = cuentasActivas(cuentas).map((c) => {
      const pred = c.id === cuentaPredeterminada ? ' · predeterminada' : '';
      const b = el('button', 'hoja-op', `${etiquetaCuenta(c)}${pred}`);
      b.type = 'button';
      b.classList.toggle('activa', c.id === sesion.cuentaId);
      b.addEventListener('click', () => {
        sesion.cuentaId = c.id;
        void persistirCuenta();
        cerrarHoja();
      });
      return b;
    });
    const cerrar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cerrar.type = 'button';
    cerrar.addEventListener('click', cerrarHoja);
    hojaPanel.replaceChildren(...botones, cerrar);
    hoja.hidden = false;
  }

  chipCuenta.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHojaCuenta();
  });

  // ---------- Nota ----------
  function abrirHojaNota(): void {
    const titulo = el('h2', 'hoja-titulo', 'Nota del próximo gasto');
    const campo = el('input', 'nota-input');
    campo.type = 'text';
    campo.maxLength = MAX_NOTA;
    campo.autocomplete = 'off';
    campo.placeholder = 'Ej. Almuerzo con equipo';
    campo.value = sesion.nota;
    campo.setAttribute('aria-label', 'Nota');
    cerrarTecladoConEnter(campo);
    const contador = el('p', 'hoja-ayuda');
    const pintarContador = (): void => {
      contador.textContent = `${campo.value.length}/${MAX_NOTA}`;
    };
    pintarContador();
    // Lo escrito se guarda en la sesión al instante: tocar fuera de la hoja no pierde nada.
    campo.addEventListener('input', () => {
      sesion.ponerNota(campo.value);
      pintarContador();
    });
    const listo = el('button', 'btn-primario', 'Listo');
    listo.type = 'button';
    listo.addEventListener('click', cerrarHoja);
    const borrar = el('button', 'hoja-op hoja-cerrar', 'Quitar nota');
    borrar.type = 'button';
    borrar.addEventListener('click', () => {
      sesion.ponerNota('');
      cerrarHoja();
    });
    const pie = el('div', 'hoja-pie');
    pie.append(listo, borrar);
    hojaPanel.replaceChildren(titulo, campo, contador, pie);
    hoja.hidden = false;
    hojaPanel.scrollTop = 0;
  }

  chipNota.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHojaNota();
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

  async function activar(): Promise<void> {
    config = await cargarConfigMonedas(repoAjustes);
    cuentas = await db.cuentas.toArray();
    const estado = await cargarEstadoCuentas(repoAjustes, cuentas);
    cuentaPredeterminada = estado.predeterminada;
    // Si Ajustes archivó o borró la cuenta en uso, Registrar pasa a la predeterminada.
    const vigente = resolverCuentaActual(sesion.cuentaId, cuentas, cuentaPredeterminada);
    if (vigente !== sesion.cuentaId) {
      sesion.cuentaId = vigente;
      void persistirCuenta();
    }
    pintarCuenta();
    // Si Ajustes ocultó la moneda en uso, se pasa a la predeterminada (con aviso si pierde decimales).
    if (!config.visibles.includes(sesion.moneda)) aplicarMoneda(config.predeterminada);
    else pintarMoneda();
  }

  pintarMonto();
  pintarFecha();
  pintarMoneda();
  pintarCuenta();
  pintarNota();
  await pintarCategorias();
  return { el: root, activar };
}
