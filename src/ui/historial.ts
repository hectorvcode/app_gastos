import {
  db,
  eliminarGastoRegistrando,
  guardarEdicionConFoto,
  repoAjustes,
  restaurarGastoEliminado,
} from '../db';
import { marcaOculta, opcionesParaEdicion } from '../lib/categorias';
import { generarUuid, mensajeDeError } from '../lib/compat';
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
import { aplicarCambioFoto, ErrorFoto, mensajeErrorAlmacenamiento, textoInfoFoto, type CambioFoto } from '../lib/fotos';
import {
  agruparPorDia,
  edicionTieneCambios,
  eliminarGasto,
  filtrarGastos,
  validarEdicion,
  type BorradoPendiente,
  type TotalMoneda,
} from '../lib/historial';
import { decimalsFor, formatMonto, montoParaCampo, simboloMoneda } from '../lib/money';
import { CATALOGO_MONEDAS, cargarConfigMonedas } from '../lib/monedas';
import type { Capa } from '../lib/navegacion';
import { MAX_NOTA } from '../lib/nota';
import type { Categoria, Cuenta, Foto, Gasto } from '../types';
import { mostrarError } from './avisos';
import { crearSelectorFoto, procesarArchivoElegido } from './foto-selector';
import { botonAtras, navegacion } from './navegacion';
import { cerrarTecladoConEnter } from './teclado';
import { abrirVisor } from './visor';

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
  /** Deja puestos mes, cuenta y categoría (null = todas); se llama justo antes de mostrar la pestaña (Resumen). */
  filtrar(f: { mes: Mes; cuentaId: string | null; categoriaId: string | null }): void;
  /** Se llama al salir de la pestaña: libera las miniaturas en memoria. */
  desactivar(): void;
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
  let borradoPendiente: BorradoPendiente | null = null;
  // Miniaturas de la lista: se crean por pintado y se liberan (revokeObjectURL) al repintar o salir.
  let urlsMiniaturas: string[] = [];
  let pintado = 0;
  let limpiarEdicion: (() => void) | null = null;

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
  // Segunda hoja, encima de la de edición: listas de moneda, cuenta y origen de la foto.
  const lista2 = el('div', 'hoja hoja-lista');
  lista2.hidden = true;
  const lista2Panel = el('div', 'hoja-panel');
  lista2.append(lista2Panel);
  lista2.addEventListener('click', (e) => {
    if (e.target === lista2) cerrarLista();
  });

  // Selector de archivos compartido por la hoja de edición (cámara y galería).
  let alElegirFoto: ((archivo: File) => void) | null = null;
  const selector = crearSelectorFoto((f) => alElegirFoto?.(f));

  root.append(filtros, lista, toast, hoja, lista2, selector.el);

  function liberarMiniaturas(): void {
    for (const u of urlsMiniaturas) URL.revokeObjectURL(u);
    urlsMiniaturas = [];
  }

  // Las dos hojas se registran en la pila de navegación: el Atrás de Android cierra la de arriba.
  let capaEdicion: Capa | null = null;
  let capaLista: Capa | null = null;

  function ocultarLista(): void {
    capaLista = null;
    lista2.hidden = true;
  }

  function cerrarLista(): void {
    if (capaLista) capaLista.cerrar();
    else ocultarLista();
  }

  function ocultarEdicion(): void {
    capaEdicion = null;
    hoja.hidden = true;
    limpiarEdicion?.();
    limpiarEdicion = null;
  }

  /** Cierra sin preguntar (tras guardar o eliminar). Atrás y Cancelar pasan por navegacion.atras(). */
  function cerrarEdicion(): void {
    if (capaEdicion) capaEdicion.cerrar();
    else ocultarEdicion();
  }

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
      if (categoriaFiltro !== null && !categorias.some((c) => c.id === categoriaFiltro)) categoriaFiltro = null;
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

    pintarOpcionesCategoria();

    // Con una sola cuenta no hay nada que filtrar. Las archivadas siguen apareciendo aquí.
    selCuenta.hidden = cuentas.length <= 1;
    selCuenta.replaceChildren(
      new Option('Todas las cuentas', ''),
      ...ordenadas(cuentas).map((c) => new Option(`${etiquetaCuenta(c)}${c.archivada ? ' (archivada)' : ''}`, c.id)),
    );
    selCuenta.value = cuentaFiltro ?? '';
  }

  /**
   * Todo el catálogo. Con "Todas las cuentas" marca solo las ocultas del catálogo "(oculta)"; con una cuenta
   * específica marca además las que esa cuenta no muestra "(oculta en <cuenta>)".
   */
  function pintarOpcionesCategoria(): void {
    const cuenta = cuentaFiltro === null ? null : cuentas.find((c) => c.id === cuentaFiltro);
    selCategoria.replaceChildren(
      new Option('Todas las categorías', ''),
      ...categorias.map((c) => new Option(`${c.emoji} ${c.nombre}${marcaOculta(c, categorias, cuenta, cuentasActivas(cuentas))}`, c.id)),
    );
    selCategoria.value = categoriaFiltro ?? '';
  }

  function pintarLista(): void {
    liberarMiniaturas();
    const mi = ++pintado;
    const conFoto: { fotoId: string; boton: HTMLElement }[] = [];
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
        frag.append(crearFila(gasto, conFoto));
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
    void cargarMiniaturas(mi, conFoto);
  }

  async function cargarMiniaturas(mi: number, lote: { fotoId: string; boton: HTMLElement }[]): Promise<void> {
    if (lote.length === 0) return;
    try {
      const fotos = await db.fotos.bulkGet(lote.map((x) => x.fotoId));
      if (mi !== pintado) return; // la lista se repintó o se salió de la pestaña
      lote.forEach((x, i) => {
        const f = fotos[i];
        const blob = f?.miniatura ?? f?.blob;
        if (!blob) return; // se queda el ícono 📷
        const url = URL.createObjectURL(blob);
        urlsMiniaturas.push(url);
        const img = el('img');
        img.src = url;
        img.alt = '';
        x.boton.replaceChildren(img);
      });
    } catch (e) {
      mostrarError(`No se pudieron cargar las miniaturas: ${mensajeDeError(e)}`);
    }
  }

  async function verFoto(fotoId: string): Promise<void> {
    try {
      const f = await db.fotos.get(fotoId);
      if (!f) {
        mostrarError('La foto de este gasto ya no está disponible.');
        return;
      }
      abrirVisor(f.blob, f.ancho, f.alto);
    } catch (e) {
      mostrarError(`No se pudo abrir la foto: ${mensajeDeError(e)}`);
    }
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

  function crearFila(g: Gasto, conFoto: { fotoId: string; boton: HTMLElement }[]): HTMLElement {
    const cat = nombreCategoria(g.categoriaId);
    const fila = el('div', 'fila');

    // Miniatura del recibo: botón aparte que abre el visor (el resto de la fila abre la edición).
    if (g.fotoId) {
      const fotoId = g.fotoId;
      const botonFoto = el('button', 'fila-foto', '📷');
      botonFoto.type = 'button';
      botonFoto.setAttribute('aria-label', 'Ver foto del recibo');
      botonFoto.addEventListener('click', () => void verFoto(fotoId));
      fila.append(botonFoto);
      conFoto.push({ fotoId, boton: botonFoto });
    }

    const cuerpo = el('button', 'fila-cuerpo');
    cuerpo.type = 'button';
    cuerpo.addEventListener('click', () => abrirEdicion(g));
    fila.append(cuerpo);
    cuerpo.append(el('span', 'fila-emoji', cat?.emoji ?? '❔'));
    const centro = el('span', 'fila-centro');
    centro.append(el('span', 'fila-nombre', cat?.nombre ?? 'Sin categoría'));
    const cuenta = hayVariasActivas() ? cuentas.find((c) => c.id === g.cuentaId) : undefined;
    const detalle = [isoAFechaHora(g.fecha).hora, cuenta ? etiquetaCuenta(cuenta) : '', g.nota.replace(/\s+/g, ' ')]
      .filter(Boolean)
      .join(' · ');
    centro.append(el('span', 'fila-detalle', detalle));
    cuerpo.append(centro);

    const monto = el('span', 'fila-monto', formatMonto(g.monto, g.moneda));
    monto.append(el('small', '', ` ${g.moneda}`));
    cuerpo.append(monto);
    return fila;
  }

  // ---------- Edición ----------
  function abrirEdicion(g: Gasto): void {
    const { fecha, hora } = isoAFechaHora(g.fecha);
    let categoriaId = g.categoriaId;
    let cuentaId = g.cuentaId;
    let moneda = g.moneda;
    limpiarEdicion?.();
    // Foto: el cambio solo se aplica (y la foto vieja solo se elimina) al tocar Guardar cambios.
    let cambioFoto: CambioFoto = { tipo: 'ninguno' };
    let fotoActual: Foto | null = null;
    let procesandoFoto = false;
    let urlsEdicion: string[] = [];
    let abierta = true;

    const titulo = el('h2', 'hoja-titulo', 'Editar gasto');
    const seccion = (nombre: string, ...hijos: HTMLElement[]): HTMLElement => {
      const s = el('div', 'edit-seccion');
      s.append(el('p', 'edit-titulo', nombre), ...hijos);
      return s;
    };

    // ---- Monto (con el símbolo de su moneda, como en Registrar) ----
    const simbolo = el('span', 'monto-simbolo', simboloMoneda(moneda));
    const iMonto = el('input', 'edit-monto-input');
    iMonto.type = 'text';
    iMonto.inputMode = 'decimal';
    iMonto.autocomplete = 'off';
    const montoInicial = g.monto.toFixed(decimalsFor(g.moneda));
    iMonto.value = montoInicial;
    iMonto.setAttribute('aria-label', `Monto en ${g.moneda}`);
    cerrarTecladoConEnter(iMonto);
    const filaMonto = el('div', 'edit-monto');
    filaMonto.append(simbolo, iMonto);

    // ---- Fecha y hora ----
    const iFecha = el('input', 'nota-input');
    iFecha.type = 'date';
    iFecha.max = dateKey(new Date());
    iFecha.value = fecha;
    iFecha.setAttribute('aria-label', 'Fecha');
    const iHora = el('input', 'nota-input');
    iHora.type = 'time';
    iHora.value = hora;
    iHora.setAttribute('aria-label', 'Hora');
    const filaFecha = el('div', 'campos-fecha');
    filaFecha.append(iFecha, iHora);

    // ---- Listas que se abren desde un chip (moneda, cuenta, origen de la foto) ----
    function abrirLista(nombre: string, opciones: { texto: string; activa?: boolean; alElegir: () => void }[]): void {
      const botones = opciones.map((o) => {
        const b = el('button', 'hoja-op', o.texto);
        b.type = 'button';
        b.classList.toggle('activa', o.activa === true);
        b.addEventListener('click', () => {
          cerrarLista();
          o.alElegir();
        });
        return b;
      });
      const cerrar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
      cerrar.type = 'button';
      cerrar.addEventListener('click', cerrarLista);
      lista2Panel.replaceChildren(botonAtras(), el('h2', 'hoja-titulo', nombre), ...botones, cerrar);
      lista2.hidden = false;
      lista2Panel.scrollTop = 0;
      capaLista = navegacion.abrir({ cerrar: ocultarLista });
    }

    // ---- Moneda ----
    // Monedas visibles; la del gasto siempre aparece aunque se haya ocultado después.
    const codigos = monedasVisibles.includes(g.moneda) ? monedasVisibles : [g.moneda, ...monedasVisibles];
    const nombresMoneda = new Map(CATALOGO_MONEDAS.map((m) => [m.codigo, m.nombre]));
    const chipMoneda = el('button', 'chip chip-grande');
    chipMoneda.type = 'button';
    const pintarChipMoneda = (): void => {
      chipMoneda.textContent = `💱 ${moneda} ▾`;
      chipMoneda.setAttribute('aria-label', `Moneda: ${moneda}. Tocar para cambiar`);
    };
    pintarChipMoneda();
    chipMoneda.addEventListener('click', () =>
      abrirLista(
        'Moneda',
        codigos.map((codigo) => ({
          texto: `${codigo} · ${nombresMoneda.get(codigo) ?? codigo}`,
          activa: codigo === moneda,
          alElegir: () => {
            moneda = codigo;
            pintarChipMoneda();
            simbolo.textContent = simboloMoneda(moneda);
            iMonto.setAttribute('aria-label', `Monto en ${moneda}`);
            // Reformatea el monto (12.00 ↔ 12); si perdería decimales, queda igual y Guardar lo señala.
            iMonto.value = montoParaCampo(iMonto.value, moneda);
          },
        })),
      ),
    );

    // ---- Cuenta: activas, más la del gasto aunque esté archivada. Con una sola opción no se muestra. ----
    const opcionesCuenta = ordenadas(cuentas).filter((c) => !c.archivada || c.id === g.cuentaId);
    const chipCuenta = el('button', 'chip chip-grande');
    chipCuenta.type = 'button';
    const pintarChipCuenta = (): void => {
      const c = cuentas.find((x) => x.id === cuentaId);
      chipCuenta.textContent = `${c ? etiquetaCuenta(c) : '📒 Cuenta'} ▾`;
      chipCuenta.setAttribute('aria-label', `Cuenta: ${c?.nombre ?? 'sin cuenta'}. Tocar para cambiar`);
    };
    pintarChipCuenta();
    chipCuenta.addEventListener('click', () =>
      abrirLista(
        'Cuenta',
        opcionesCuenta.map((c) => ({
          texto: `${etiquetaCuenta(c)}${c.archivada ? ' (archivada)' : ''}`,
          activa: c.id === cuentaId,
          alElegir: () => {
            cuentaId = c.id;
            pintarChipCuenta();
            pintarCategoriasEdicion(); // la categoría elegida se conserva, aunque la nueva cuenta no la muestre
          },
        })),
      ),
    );
    const seccionCuenta = seccion('Cuenta', chipCuenta);
    seccionCuenta.hidden = opcionesCuenta.length <= 1;

    // ---- Categoría: cuadrícula con emoji; la elegida se resalta ----
    // Las visibles de la cuenta del gasto, más la categoría actual si está fuera (marcada).
    const cuadricula = el('div', 'edit-categorias');
    function pintarCategoriasEdicion(): void {
      const opciones = opcionesParaEdicion(
        cuentas.find((x) => x.id === cuentaId),
        categorias,
        g.categoriaId,
        categoriaId,
      );
      cuadricula.replaceChildren(
        ...opciones.map((o) => {
          const b = el('button', 'edit-cat');
          b.type = 'button';
          b.append(el('span', 'edit-cat-emoji', o.categoria.emoji), el('span', 'edit-cat-nombre', o.categoria.nombre));
          const marca = marcaOculta(o.categoria, categorias, cuentas.find((x) => x.id === cuentaId)).trim();
          if (marca) {
            b.append(el('span', 'edit-cat-marca', marca));
            b.setAttribute('aria-label', `${o.categoria.nombre} ${marca}`);
          }
          b.setAttribute('aria-pressed', String(o.categoria.id === categoriaId));
          b.addEventListener('click', () => {
            categoriaId = o.categoria.id;
            pintarCategoriasEdicion();
          });
          return b;
        }),
      );
    }
    pintarCategoriasEdicion();

    // ---- Nota ----
    const iNota = el('input', 'nota-input');
    iNota.type = 'text';
    iNota.maxLength = MAX_NOTA;
    iNota.autocomplete = 'off';
    iNota.placeholder = 'Nota (opcional)';
    iNota.value = g.nota;
    iNota.setAttribute('aria-label', 'Nota');
    cerrarTecladoConEnter(iNota);

    // ---- Foto del recibo: miniatura con Ver / Reemplazar / Quitar, o un solo "Agregar foto" ----
    const cuerpoFoto = el('div', 'foto-seccion');
    const liberarUrlsEdicion = (): void => {
      for (const u of urlsEdicion) URL.revokeObjectURL(u);
      urlsEdicion = [];
    };
    function fotoVigente(): { blob: Blob; miniatura?: Blob; diag?: string; ancho: number; alto: number } | null {
      if (cambioFoto.tipo === 'reemplazar') return cambioFoto.foto;
      if (cambioFoto.tipo === 'quitar') return null;
      return fotoActual;
    }
    const elegirOrigenFoto = (): void =>
      abrirLista('Foto del recibo', [
        { texto: '📸 Tomar foto', alElegir: () => selector.tomar() },
        { texto: '🖼️ Elegir de la galería', alElegir: () => selector.galeria() },
      ]);
    function pintarFotoEdicion(): void {
      liberarUrlsEdicion();
      const v = fotoVigente();
      const fila = el('div', 'foto-fila');
      const mini = el('div', 'foto-mini', '📷');
      const mb = v?.miniatura ?? v?.blob;
      if (mb) {
        const url = URL.createObjectURL(mb);
        urlsEdicion.push(url);
        const img = el('img');
        img.src = url;
        img.alt = '';
        mini.replaceChildren(img);
      }
      let estado = 'Sin foto';
      if (procesandoFoto) estado = '⏳ Procesando foto…';
      else if (cambioFoto.tipo === 'reemplazar') estado = 'Foto nueva (se aplica al guardar) · ' + textoInfoFoto(cambioFoto.foto.blob.size, cambioFoto.foto.ancho, cambioFoto.foto.alto);
      else if (cambioFoto.tipo === 'quitar') estado = 'La foto se quitará al guardar';
      else if (g.fotoId && !fotoActual) estado = 'Cargando foto…';
      else if (fotoActual) estado = 'Foto del recibo · ' + textoInfoFoto(fotoActual.blob.size, fotoActual.ancho, fotoActual.alto);
      fila.append(mini, el('span', 'foto-estado', estado));

      const boton = (texto: string, alTocar: () => void): HTMLButtonElement => {
        const b = el('button', 'cat-op', texto);
        b.type = 'button';
        b.disabled = procesandoFoto;
        b.addEventListener('click', alTocar);
        return b;
      };
      const acciones = el('div', v ? 'foto-acciones' : 'foto-acciones foto-acciones-una');
      if (v) {
        acciones.append(
          boton('🔍 Ver', () => abrirVisor(v.blob, v.ancho, v.alto)),
          boton('🔄 Reemplazar', elegirOrigenFoto),
          boton('🗑️ Quitar', () => {
            cambioFoto = g.fotoId ? { tipo: 'quitar' } : { tipo: 'ninguno' };
            pintarFotoEdicion();
          }),
        );
      } else {
        acciones.append(boton('📷 Agregar foto', elegirOrigenFoto));
        if (cambioFoto.tipo === 'quitar') {
          acciones.append(
            boton('↩️ Conservar la foto', () => {
              cambioFoto = { tipo: 'ninguno' };
              pintarFotoEdicion();
            }),
          );
        }
      }
      cuerpoFoto.replaceChildren(fila, acciones);
    }
    alElegirFoto = (archivo) => {
      procesandoFoto = true;
      pintarFotoEdicion();
      void (async () => {
        try {
          const foto = await procesarArchivoElegido(archivo);
          if (abierta) cambioFoto = { tipo: 'reemplazar', foto };
        } catch (e) {
          mostrarError(e instanceof ErrorFoto ? e.message : `No se pudo procesar la foto: ${mensajeDeError(e)}`);
        } finally {
          procesandoFoto = false;
          if (abierta) pintarFotoEdicion();
        }
      })();
    };
    pintarFotoEdicion();
    if (g.fotoId) {
      const fotoId = g.fotoId;
      void db.fotos
        .get(fotoId)
        .then((f) => {
          if (!abierta) return;
          fotoActual = f ?? null;
          pintarFotoEdicion();
        })
        .catch((e) => mostrarError(`No se pudo cargar la foto: ${mensajeDeError(e)}`));
    }
    limpiarEdicion = () => {
      abierta = false;
      alElegirFoto = null;
      ocultarLista();
      liberarUrlsEdicion();
    };

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
      if (procesandoFoto) {
        error.textContent = 'Espera a que termine de procesarse la foto.';
        error.hidden = false;
        return;
      }
      const ed = aplicarCambioFoto(r.gasto, g, cambioFoto, new Date(), generarUuid);
      try {
        if (r.cambio || ed.cambioFoto) await guardarEdicionConFoto(ed.gasto, ed.fotoNueva, ed.fotoABorrar);
      } catch (err) {
        mostrarError(`No se pudo guardar los cambios: ${mensajeErrorAlmacenamiento(err)}`);
        return; // la hoja sigue abierta con lo escrito
      }
      cerrarEdicion();
      await leer();
    });

    borrar.addEventListener('click', async () => {
      await confirmarBorradoPendiente(); // un borrado anterior ya no se puede deshacer
      let pendiente: BorradoPendiente;
      try {
        pendiente = await eliminarGasto(repoBorrado, g);
      } catch (e) {
        mostrarError(`No se pudo eliminar: ${mensajeDeError(e)}`);
        return;
      }
      cerrarEdicion();
      mostrarToastEliminado(pendiente);
      await leer();
    });

    cancelar.addEventListener('click', () => navegacion.atras()); // con cambios, pregunta "¿Descartar cambios?"

    // Guardar queda fijo al borde inferior de la hoja: visible aunque el teclado esté abierto.
    const pie = el('div', 'hoja-pie');
    pie.append(error, guardar);

    // "Eliminar gasto" va al final, después de Cancelar, para no tocarlo por error.
    panel.replaceChildren(
      botonAtras(),
      titulo,
      seccion('Monto', filaMonto),
      seccion('Fecha y hora', filaFecha),
      seccion('Categoría', cuadricula),
      seccionCuenta,
      seccion('Moneda', chipMoneda),
      seccion('Nota', iNota),
      seccion('Foto', cuerpoFoto),
      pie,
      cancelar,
      borrar,
    );
    hoja.hidden = false;
    panel.scrollTop = 0;
    capaEdicion = navegacion.abrir({
      cerrar: ocultarEdicion,
      hayCambios: () =>
        edicionTieneCambios(
          { monto: montoInicial, fecha, hora, moneda: g.moneda, categoriaId: g.categoriaId, cuentaId: g.cuentaId, nota: g.nota },
          { monto: iMonto.value, fecha: iFecha.value, hora: iHora.value, moneda, categoriaId, cuentaId, nota: iNota.value },
          cambioFoto.tipo !== 'ninguno' || procesandoFoto,
        ),
    });
  }

  const repoBorrado = {
    // Si el gasto ya se había exportado, al borrarlo queda el registro para avisar a Sheets.
    add: (x: Gasto): Promise<void> => restaurarGastoEliminado(x),
    delete: (id: string): Promise<void> => eliminarGastoRegistrando(id),
    borrarFoto: (id: string): Promise<void> => db.fotos.delete(id),
  };

  /** Vence el plazo de Deshacer: ahora sí se elimina la foto del gasto borrado. */
  async function confirmarBorradoPendiente(): Promise<void> {
    const b = borradoPendiente;
    borradoPendiente = null;
    if (!b) return;
    try {
      await b.confirmar();
    } catch (e) {
      mostrarError(`No se pudo eliminar la foto del gasto borrado: ${mensajeDeError(e)}`);
    }
  }

  function mostrarToastEliminado(pendiente: BorradoPendiente): void {
    window.clearTimeout(toastTimer);
    borradoPendiente = pendiente;
    toast.hidden = false;
    toastDeshacer.onclick = async () => {
      window.clearTimeout(toastTimer);
      toast.hidden = true;
      borradoPendiente = null;
      try {
        await pendiente.deshacer(); // el gasto vuelve con su foto, que seguía guardada
      } catch (e) {
        mostrarError(`No se pudo deshacer: ${mensajeDeError(e)}`);
      }
      await leer();
    };
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toastDeshacer.onclick = null;
      void confirmarBorradoPendiente();
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
    pintarOpcionesCategoria();
    limite = FILAS_POR_LOTE;
    pintarLista();
  });
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) navegacion.atras();
  });

  return {
    el: root,
    activar: leer,
    filtrar({ mes, cuentaId, categoriaId }) {
      const hoy = mesDe(new Date());
      mesElegido = mes.anio === hoy.anio && mes.mes === hoy.mes ? null : mes;
      cuentaFiltro = cuentaId;
      categoriaFiltro = categoriaId;
      limite = FILAS_POR_LOTE;
    },
    desactivar() {
      pintado++; // descarta cargas de miniaturas en curso
      liberarMiniaturas();
    },
  };
}
