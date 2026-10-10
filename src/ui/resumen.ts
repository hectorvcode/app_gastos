import { db } from '../db';
import { mensajeDeError } from '../lib/compat';
import { etiquetaCuenta, ordenadas } from '../lib/cuentas';
import { desplazarMes, etiquetaMes, mesDe, nombreMes, rangoMes, type Mes } from '../lib/dates';
import { filtrarPorCuenta } from '../lib/historial';
import { formatMonto } from '../lib/money';
import {
  barrasPorCategoria,
  monedaPrincipal,
  textoPorcentaje,
  textoVariacion,
  totalesDelMes,
  type TotalMes,
} from '../lib/resumen';
import type { Categoria, Cuenta, Gasto } from '../types';
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

export interface VistaResumen {
  el: HTMLElement;
  /** Vuelve a leer la base de datos; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

/** Resumen del mes: total por moneda con variación, y barras por categoría. Solo HTML y CSS. */
export function crearResumen(
  irARegistrar: () => void,
  abrirHistorial: (f: { mes: Mes; cuentaId: string | null; categoriaId: string }) => void,
): VistaResumen {
  let mesElegido: Mes | null = null; // null = mes actual
  let cuentaFiltro: string | null = null;
  let monedaElegida: string | null = null; // null = la principal del mes
  let categorias: Categoria[] = [];
  let cuentas: Cuenta[] = [];
  let gastosMes: Gasto[] = [];
  let gastosAnterior: Gasto[] = [];
  let lectura = 0;

  const root = el('section', 'resumen');

  // ---------- Filtros (mes y cuenta) ----------
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
  const selCuenta = el('select', 'filtro-categoria');
  selCuenta.setAttribute('aria-label', 'Filtrar por cuenta');
  filtros.append(navMes, selCuenta);

  const cuerpo = el('div', 'resumen-cuerpo');
  root.append(filtros, cuerpo);

  const mesActual = (): Mes => mesElegido ?? mesDe(new Date());

  async function leer(): Promise<void> {
    const mi = ++lectura;
    try {
      const mes = mesActual();
      const a = rangoMes(mes);
      const p = rangoMes(desplazarMes(mes, -1));
      const [cats, cts, actual, previo] = await Promise.all([
        db.categorias.toArray(),
        db.cuentas.toArray(),
        db.gastos.where('fecha').between(a.desde, a.hasta, true, false).toArray(),
        db.gastos.where('fecha').between(p.desde, p.hasta, true, false).toArray(),
      ]);
      if (mi !== lectura) return; // llegó una lectura más nueva
      categorias = cats;
      cuentas = cts;
      if (cuentaFiltro !== null && !cuentas.some((c) => c.id === cuentaFiltro)) cuentaFiltro = null;
      gastosMes = actual;
      gastosAnterior = previo;
      pintar();
    } catch (e) {
      mostrarError(`No se pudo cargar el resumen: ${mensajeDeError(e)}`);
    }
  }

  function pintarFiltros(): void {
    const actual = mesActual();
    etiqueta.textContent = etiquetaMes(actual);
    const hoy = mesDe(new Date());
    btnSiguiente.disabled = actual.anio === hoy.anio && actual.mes === hoy.mes;
    // Con una sola cuenta no hay nada que filtrar. Las archivadas siguen apareciendo aquí.
    selCuenta.hidden = cuentas.length <= 1;
    selCuenta.replaceChildren(
      new Option('Todas las cuentas', ''),
      ...ordenadas(cuentas).map((c) => new Option(`${etiquetaCuenta(c)}${c.archivada ? ' (archivada)' : ''}`, c.id)),
    );
    selCuenta.value = cuentaFiltro ?? '';
  }

  function pintar(): void {
    pintarFiltros();
    const mes = filtrarPorCuenta(gastosMes, cuentaFiltro);
    const anterior = filtrarPorCuenta(gastosAnterior, cuentaFiltro);
    if (mes.length === 0) {
      cuerpo.replaceChildren(estadoVacio());
      return;
    }
    const totales = totalesDelMes(mes, anterior);
    if (monedaElegida === null || !totales.some((t) => t.moneda === monedaElegida)) monedaElegida = null;
    const moneda = monedaElegida ?? monedaPrincipal(totales) ?? totales[0]!.moneda;
    const nombreAnterior = nombreMes(desplazarMes(mesActual(), -1));

    const partes: HTMLElement[] = [el('h2', 'resumen-titulo', 'Total del mes'), ...totales.map((t) => tarjetaTotal(t, nombreAnterior))];
    partes.push(el('h2', 'resumen-titulo', 'Por categoría'));
    if (totales.length > 1) partes.push(selectorMoneda(totales, moneda));
    const barras = barrasPorCategoria(mes, moneda, categorias);
    const lista = el('div', 'resumen-barras');
    lista.append(...barras.map((b) => filaBarra(b, moneda)));
    partes.push(lista);
    cuerpo.replaceChildren(...partes);
  }

  function tarjetaTotal(t: TotalMes, nombreAnterior: string): HTMLElement {
    const c = el('div', 'resumen-total');
    const linea = el('div', 'resumen-total-linea');
    linea.append(
      el('span', 'resumen-total-monto', formatMonto(t.total, t.moneda)),
      el('span', 'resumen-total-moneda', t.moneda),
    );
    const v = el('p', `resumen-variacion resumen-${t.variacion.tipo}`, textoVariacion(t.variacion, nombreAnterior));
    c.append(linea, v);
    return c;
  }

  function selectorMoneda(totales: readonly TotalMes[], actual: string): HTMLElement {
    const fila = el('div', 'cat-selector');
    for (const t of totales) {
      const b = el('button', 'cat-op', t.moneda);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(t.moneda === actual));
      b.setAttribute('aria-label', `Ver las categorías en ${t.moneda}`);
      b.addEventListener('click', () => {
        monedaElegida = t.moneda;
        pintar();
      });
      fila.append(b);
    }
    return fila;
  }

  function filaBarra(b: ReturnType<typeof barrasPorCategoria>[number], moneda: string): HTMLElement {
    const fila = el('button', 'resumen-barra');
    fila.type = 'button';
    const texto = `${b.nombre}: ${formatMonto(b.total, moneda)} ${moneda}, ${textoPorcentaje(b.porcentaje)}`;
    fila.setAttribute('aria-label', `${texto}. Ver estos gastos en Historial`);
    const cab = el('span', 'resumen-barra-cab');
    cab.append(
      el('span', 'resumen-barra-nombre', `${b.emoji} ${b.nombre}`),
      el('span', 'resumen-barra-monto', `${formatMonto(b.total, moneda)} · ${textoPorcentaje(b.porcentaje)}`),
    );
    const pista = el('span', 'resumen-barra-pista');
    const relleno = el('span', 'resumen-barra-relleno');
    relleno.style.width = `${Math.max(2, Math.min(100, b.porcentaje))}%`;
    pista.append(relleno);
    fila.append(cab, pista);
    fila.addEventListener('click', () => abrirHistorial({ mes: mesActual(), cuentaId: cuentaFiltro, categoriaId: b.categoriaId }));
    return fila;
  }

  function estadoVacio(): HTMLElement {
    const v = el('div', 'vacio-historial');
    v.append(
      el('div', 'vacio-emoji', '📊'),
      el(
        'p',
        '',
        cuentaFiltro !== null ? `No hay gastos en ${etiquetaMes(mesActual())} en esa cuenta.` : `No hay gastos en ${etiquetaMes(mesActual())}.`,
      ),
    );
    const b = el('button', 'btn-primario', 'Registrar un gasto');
    b.type = 'button';
    b.addEventListener('click', irARegistrar);
    v.append(b);
    return v;
  }

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
  selCuenta.addEventListener('change', () => {
    cuentaFiltro = selCuenta.value || null;
    pintar();
  });

  return { el: root, activar: leer };
}
