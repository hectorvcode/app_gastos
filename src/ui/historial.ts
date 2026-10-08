import { db, repoAjustes } from '../db';
import { mensajeDeError } from '../lib/compat';
import { cuentasActivas, etiquetaCuenta, ordenadas } from '../lib/cuentas';
import {
  dateKey,
  desplazarMes,
  etiquetaMes,
  isoAFechaHora,
  mesDe,
  rangoMes,
  type Mes,
} from '../lib/dates';
import {
  agruparPorDia,
  eliminarGasto,
  filtrarGastos,
  validarEdicion,
  type TotalMoneda,
} from '../lib/historial';
import { decimalsFor, formatMonto, montoParaCampo } from '../lib/money';
import { cargarConfigMonedas } from '../lib/monedas';
import { MAX_NOTA } from '../lib/nota';
import type { Categoria, Cuenta, Gasto } from '../types';
import { mostrarError } from './avisos';
import { cerrarTecladoConEnter } from './teclado';

const FILAS_POR_LOTE = 300;
const DESHACER_MS = 5000;

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

const textoTotales = (totales: TotalMoneda[]): string =>
  totales.map((t) => `${formatMonto(t.total, t.moneda)} ${t.moneda}`).join(' · ');

export interface VistaHistorial {
  el: HTMLElement;
  /** Vuelve a leer la base de datos; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

export function crearHistorial(irARegistrar: () => void): VistaHistorial {
  let mesElegido: Mes | null = null; // null = mes actual
  let categoriaFiltro: string | null = null;
  let cuentaFiltro: string | null = null;
  let categorias: Categoria[] = [];
  let cuentas: Cuenta[] = [];
  let monedasVisibles: string[] = [];
  let gastosMes: Gasto[] = [];
  let limite = FILAS_POR_LOTE;
  let lectura = 0;
  let toastTimer: number | undefined;

  const root = el('section', 'historial');

  // ---------- Filtros ----------
  const filtros = el('div', 'filtros');
  const navMes = el('div', 'nav-mes');
  const btnAnterior = el('button', 'nav-btn', '‹');
  btnAnterior.type = 'button';
  btnAnterior.setAttribute('aria-label', 'Mes anterior');
  const etiqueta = el('div', 'nav-etiqueta');
  const btnSiguiente = el('button', 'nav-btn', '›');
  btnSiguiente.type = 'button';
  btnSiguiente.setAttribute('aria-label', 'Mes siguiente');
  navMes.append(btnAnterior, etiqueta, btnSiguiente);

  const selCategoria = el('select', 'filtro-categoria');
  selCategoria.setAttribute('aria-label', 'Filtrar por categoría');
  const selCuenta = el('select', 'filtro-categoria');
  selCuenta.setAttribute('aria-label', 'Filtrar por cuenta');
  filtros.append(navMes, selCuenta, selCategoria);

  const lista = el('div', 'lista');

  // ---------- Aviso "Gasto eliminado · Deshacer" ----------
  const toast = el('div', 'toast');
  toast.hidden = true;
  const toastTexto = el('span', '', 'Gasto eliminado');
  const toastDeshacer = el('button', 'toast-btn', 'Deshacer');
  toastDeshacer.type = 'button';
  toast.append(toastTexto, toastDeshacer);

  // ---------- Hoja de edición ----------
  const hoja = el('div', 'hoja');
  hoja.hidden = true;
  const panel = el('div', 'hoja-panel hoja-editar');
  hoja.append(panel);

  root.append(filtros, lista, toast, hoja);

  // ---------- Datos ----------
  const mesActual = (): Mes => mesElegido ?? mesDe(new Date());
  const hayVariasActivas = (): boolean => cuentasActivas(cuentas).length > 1;
  const nombreCategoria = (id: string): Categoria | undefined => categorias.find((c) => c.id === id);

  async function leer(): Promise<void> {
    const mi = ++lectura;
    try {
      const { desde, hasta } = rangoMes(mesActual());
      const [cats, cts, config, gastos] = await Promise.all([
        db.categorias.orderBy('orden').toArray(),
        db.cuentas.toArray(),
        cargarConfigMonedas(repoAjustes),
        db.gastos.where('fecha').between(desde, hasta, true, false).toArray(),
      ]);
      if (mi !== lectura) return; // llegó una lectura más nueva
      categorias = cats;
      cuentas = cts;
      // Si la cuenta filtrada ya no existe (se borró), se vuelve a "Todas".
      if (cuentaFiltro !== null && !cuentas.some((c) => c.id === cuentaFiltro)) cuentaFiltro = null;
      monedasVisibles = config.visibles;
      gastosMes = gastos;
      limite = FILAS_POR_LOTE;
      pintarFiltros();
      pintarLista();
    } catch (e) {
      mostrarError(`No se pudo cargar el historial: ${mensajeDeError(e)}`);
    }
  }

  // ---------- Pintado ----------
  function pintarFiltros(): void {
    const actual = mesActual();
    etiqueta.textContent = etiquetaMes(actual);
    const hoy = mesDe(new Date());
    btnSiguiente.disabled = actual.anio === hoy.anio && actual.mes === hoy.mes;

    selCategoria.replaceChildren(
      new Option('Todas las categorías', ''),
      ...categorias.map((c) => new Option(`${c.emoji} ${c.nombre}`, c.id)),
    );
    selCategoria.value = categoriaFiltro ?? '';

    // Con una sola cuenta no hay nada que filtrar. Las archivadas siguen apareciendo aquí.
    selCuenta.hidden = cuentas.length <= 1;
    selCuenta.replaceChildren(
      new Option('Todas las cuentas', ''),
      ...ordenadas(cuentas).map((c) => new Option(`${etiquetaCuenta(c)}${c.archivada ? ' (archivada)' : ''}`, c.id)),
    );
    selCuenta.value = cuentaFiltro ?? '';
  }

  function pintarLista(): void {
    const hoy = dateKey(new Date());
    const grupos = agruparPorDia(filtrarGastos(gastosMes, { categoriaId: categoriaFiltro, cuentaId: cuentaFiltro }), hoy);

    if (grupos.length === 0) {
      lista.replaceChildren(estadoVacio());
      return;
    }

    const frag = document.createDocumentFragment();
    let pintadas = 0;
    let total = 0;
    for (const g of grupos) total += g.gastos.length;

    for (const grupo of grupos) {
      if (pintadas >= limite) break;
      const cab = el('div', 'dia');
      cab.append(el('span', 'dia-titulo', grupo.titulo), el('span', 'dia-total', textoTotales(grupo.totales)));
      frag.append(cab);
      for (const gasto of grupo.gastos) {
        if (pintadas >= limite) break;
        frag.append(crearFila(gasto));
        pintadas++;
      }
    }

    if (pintadas < total) {
      const mas = el('button', 'mas', `Mostrar más (${total - pintadas})`);
      mas.type = 'button';
      mas.addEventListener('click', () => {
        limite += FILAS_POR_LOTE;
        pintarLista();
      });
      frag.append(mas);
    }
    lista.replaceChildren(frag);
  }

  function estadoVacio(): HTMLElement {
    const v = el('div', 'vacio-historial');
    const hayFiltro = categoriaFiltro !== null || cuentaFiltro !== null;
    v.append(
      el('div', 'vacio-emoji', '🧾'),
      el(
        'p',
        '',
        hayFiltro
          ? `No hay gastos con esos filtros en ${etiquetaMes(mesActual())}.`
          : `No hay gastos en ${etiquetaMes(mesActual())}.`,
      ),
    );
    const b = el('button', 'btn-primario', 'Registrar un gasto');
    b.type = 'button';
    b.addEventListener('click', irARegistrar);
    v.append(b);
    return v;
  }

  function crearFila(g: Gasto): HTMLButtonElement {
    const cat = nombreCategoria(g.categoriaId);
    const fila = el('button', 'fila');
    fila.type = 'button';

    // Espacio reservado para la miniatura del recibo (se llena en la Fase 5).
    if (g.fotoId) fila.append(el('span', 'fila-foto', '📷'));

    fila.append(el('span', 'fila-emoji', cat?.emoji ?? '❔'));
    const centro = el('span', 'fila-centro');
    centro.append(el('span', 'fila-nombre', cat?.nombre ?? 'Sin categoría'));
    const cuenta = hayVariasActivas() ? cuentas.find((c) => c.id === g.cuentaId) : undefined;
    const detalle = [isoAFechaHora(g.fecha).hora, cuenta ? etiquetaCuenta(cuenta) : '', g.nota.replace(/s+/g, ' ')]
      .filter(Boolean)
      .join(' · ');
    centro.append(el('span', 'fila-detalle', detalle));
    fila.append(centro);

    const monto = el('span', 'fila-monto', formatMonto(g.monto, g.moneda));
    monto.append(el('small', '', ` ${g.moneda}`));
    fila.append(monto);

    fila.addEventListener('click', () => abrirEdicion(g));
    return fila;
  }

  // ---------- Edición ----------
  function abrirEdicion(g: Gasto): void {
    const { fecha, hora } = isoAFechaHora(g.fecha);
    let categoriaId = g.categoriaId;
    let cuentaId = g.cuentaId;
    let moneda = g.moneda;

    const titulo = el('h2', 'hoja-titulo', 'Editar gasto');

    const campos = el('div', 'campos');
    const iFecha = el('input');
    iFecha.type = 'date';
    iFecha.max = dateKey(new Date());
    iFecha.value = fecha;
    iFecha.setAttribute('aria-label', 'Fecha');
    const iHora = el('input');
    iHora.type = 'time';
    iHora.value = hora;
    iHora.setAttribute('aria-label', 'Hora');
    const iMonto = el('input');
    iMonto.type = 'text';
    iMonto.inputMode = 'decimal';
    iMonto.autocomplete = 'off';
    iMonto.value = g.monto.toFixed(decimalsFor(g.moneda));
    iMonto.setAttribute('aria-label', `Monto en ${g.moneda}`);
    cerrarTecladoConEnter(iMonto);
    campos.append(iMonto, iFecha, iHora);

    // Monedas visibles; la del gasto siempre aparece aunque se haya ocultado después.
    const codigos = monedasVisibles.includes(g.moneda) ? monedasVisibles : [g.moneda, ...monedasVisibles];
    const monedas = el('div', 'moneda-selector');
    const botonesMoneda = codigos.map((codigo) => {
      const b = el('button', 'cat-op', codigo);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(codigo === moneda));
      b.addEventListener('click', () => {
        moneda = codigo;
        for (const o of botonesMoneda) o.setAttribute('aria-pressed', String(o === b));
        iMonto.setAttribute('aria-label', `Monto en ${moneda}`);
        // Reformatea el monto (12.00 ↔ 12); si perdería decimales, queda igual y Guardar lo señala.
        iMonto.value = montoParaCampo(iMonto.value, moneda);
      });
      return b;
    });
    monedas.append(...botonesMoneda);

    const iNota = el('input', 'nota-input');
    iNota.type = 'text';
    iNota.maxLength = MAX_NOTA;
    iNota.autocomplete = 'off';
    iNota.placeholder = 'Nota (opcional)';
    iNota.value = g.nota;
    iNota.setAttribute('aria-label', 'Nota');
    cerrarTecladoConEnter(iNota);

    const cats = el('div', 'cat-selector');
    const botonesCat = categorias.map((c) => {
      const b = el('button', 'cat-op', `${c.emoji} ${c.nombre}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c.id === categoriaId));
      b.addEventListener('click', () => {
        categoriaId = c.id;
        for (const o of botonesCat) o.setAttribute('aria-pressed', String(o === b));
      });
      return b;
    });
    cats.append(...botonesCat);

    // Activas; la cuenta del gasto siempre aparece aunque esté archivada. Con una sola cuenta no se muestra.
    const opciones = ordenadas(cuentas).filter((c) => !c.archivada || c.id === g.cuentaId);
    const selectorCuenta = el('div', 'cat-selector');
    const botonesCuenta = opciones.map((c) => {
      const b = el('button', 'cat-op', etiquetaCuenta(c));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c.id === cuentaId));
      b.addEventListener('click', () => {
        cuentaId = c.id;
        for (const o of botonesCuenta) o.setAttribute('aria-pressed', String(o === b));
      });
      return b;
    });
    selectorCuenta.append(...botonesCuenta);
    selectorCuenta.hidden = cuentas.length <= 1;

    const error = el('p', 'hoja-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;

    const guardar = el('button', 'btn-primario', 'Guardar cambios');
    guardar.type = 'button';
    const borrar = el('button', 'btn-peligro', 'Eliminar gasto');
    borrar.type = 'button';
    const cancelar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cancelar.type = 'button';

    guardar.addEventListener('click', async () => {
      const r = validarEdicion(
        g,
        { fecha: iFecha.value, hora: iHora.value, monto: iMonto.value, categoriaId, cuentaId, moneda, nota: iNota.value },
        new Date(),
      );
      if (!r.ok) {
        error.textContent = r.error;
        error.hidden = false;
        return;
      }
      try {
        if (r.cambio) await db.gastos.put(r.gasto);
      } catch (e) {
        mostrarError(`No se pudo guardar los cambios: ${mensajeDeError(e)}`);
        return; // la hoja sigue abierta con lo escrito
      }
      hoja.hidden = true;
      await leer();
    });

    borrar.addEventListener('click', async () => {
      let deshacer: () => Promise<void>;
      try {
        deshacer = await eliminarGasto({ add: async (x) => void (await db.gastos.add(x)), delete: (id) => db.gastos.delete(id) }, g);
      } catch (e) {
        mostrarError(`No se pudo eliminar: ${mensajeDeError(e)}`);
        return;
      }
      hoja.hidden = true;
      mostrarToastEliminado(deshacer);
      await leer();
    });

    cancelar.addEventListener('click', () => (hoja.hidden = true));

    // Guardar queda fijo al borde inferior de la hoja: visible aunque el teclado esté abierto.
    const pie = el('div', 'hoja-pie');
    pie.append(error, guardar);

    panel.replaceChildren(titulo, campos, monedas, iNota, selectorCuenta, cats, pie, borrar, cancelar);
    hoja.hidden = false;
    panel.scrollTop = 0;
  }

  function mostrarToastEliminado(deshacer: () => Promise<void>): void {
    window.clearTimeout(toastTimer);
    toast.hidden = false;
    toastDeshacer.onclick = async () => {
      window.clearTimeout(toastTimer);
      toast.hidden = true;
      try {
        await deshacer();
      } catch (e) {
        mostrarError(`No se pudo deshacer: ${mensajeDeError(e)}`);
      }
      await leer();
    };
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toastDeshacer.onclick = null;
    }, DESHACER_MS);
  }

  // ---------- Eventos ----------
  btnAnterior.addEventListener('click', () => {
    mesElegido = desplazarMes(mesActual(), -1);
    void leer();
  });
  btnSiguiente.addEventListener('click', () => {
    const siguiente = desplazarMes(mesActual(), 1);
    const hoy = mesDe(new Date());
    mesElegido = siguiente.anio === hoy.anio && siguiente.mes === hoy.mes ? null : siguiente;
    void leer();
  });
  selCategoria.addEventListener('change', () => {
    categoriaFiltro = selCategoria.value || null;
    limite = FILAS_POR_LOTE;
    pintarLista();
  });
  selCuenta.addEventListener('change', () => {
    cuentaFiltro = selCuenta.value || null;
    limite = FILAS_POR_LOTE;
    pintarLista();
  });
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) hoja.hidden = true;
  });

  return { el: root, activar: leer };
}
