import { db, leerParaExportar, repoAjustes, repoMarcas } from '../db';
import { crearBitacora } from '../lib/bitacora';
import {
  compartirArchivo,
  compartirArchivos,
  esDispositivoMovil,
  opcionesDeEntrega,
  planificarLote,
  puedeCompartir,
  type PlanLote,
} from '../lib/compartir';
import { mensajeDeError } from '../lib/compat';
import { etiquetaCuenta, ordenadas } from '../lib/cuentas';
import { decimalDeAjuste, type Decimal } from '../lib/csv';
import { dateKey, desplazarMes, etiquetaMes, formatDdMmAaaa, isoAFechaHora, mesDe, type Mes } from '../lib/dates';
import {
  AVISO_ZIP_HTTP,
  debeAvisarZipHttp,
  entregar,
  entregarTanda,
  mensajeVacio,
  pendienteDeExportar,
  prepararArchivo,
  seleccionar,
  textoDescarga,
  totalFilas,
  validarRango,
  type Alcance,
  type ArchivoListo,
  type Formato,
  type MarcaPrevia,
  type ResultadoEntrega,
  type ResultadoTanda,
} from '../lib/exportar';
import { textoPeso } from '../lib/fotos';
import type { Cuenta } from '../types';
import type { Capa } from '../lib/navegacion';
import { mostrarAviso, mostrarError } from './avisos';
import { botonAtras, navegacion } from './navegacion';

const DESHACER_MARCA_MS = 10_000;

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

function boton(texto: string, alTocar: () => void, className = 'cat-op'): HTMLButtonElement {
  const b = el('button', className, texto);
  b.type = 'button';
  b.addEventListener('click', alTocar);
  return b;
}

const bitacora = crearBitacora();
const registroPantalla = document.createElement('pre');
registroPantalla.className = 'exportar-registro';
/** Anota un paso en la consola (chrome://inspect) y en "Opciones avanzadas → Registro". */
function anotar(paso: string, detalle?: unknown): void {
  bitacora.anotar(paso, detalle);
  registroPantalla.textContent = bitacora.texto();
}

/** Descarga directa: en escritorio y siempre que no haya Web Share (p. ej. por http://<IP-LAN>). */
function descargar(archivo: File): void {
  anotar('descarga: inicio', { nombre: archivo.name, tipo: archivo.type, bytes: archivo.size });
  // `archivo` ya llega con tipo genérico (ver archivoParaDescarga) y su nombre exacto.
  const url = URL.createObjectURL(archivo);
  const a = el('a');
  a.href = url;
  a.download = archivo.name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  anotar('descarga: clic en el enlace hecho');
  // El enlace y la URL se conservan un buen rato: en la app instalada, soltarlos antes puede cortar la descarga.
  window.setTimeout(() => a.remove(), 1000);
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}

const textoFechaHora = (iso: string): string => {
  const { fecha, hora } = isoAFechaHora(iso);
  return `${formatDdMmAaaa(fecha)} ${hora}`;
};

const OPCIONES_ALCANCE = [
  ['nuevos', 'Solo nuevos'],
  ['mes', 'Un mes'],
  ['rango', 'Rango de fechas'],
  ['todo', 'Todo'],
] as const;

type TipoAlcance = (typeof OPCIONES_ALCANCE)[number][0];

interface ResumenSeleccion {
  gastos: number;
  eliminados: number;
  conFoto: number;
  bytesFotos: number;
}

export interface SeccionExportar {
  el: HTMLElement;
  /** Vuelve a leer datos y ajustes; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

/** Ajustes → Exportar: período y cuenta, resumen, dos botones (CSV o ZIP con fotos) y opciones avanzadas. */
export function crearSeccionExportar(): SeccionExportar {
  let tipo: TipoAlcance = 'nuevos';
  let mes: Mes | null = null; // null = mes actual
  let desde = '';
  let hasta = '';
  let cuentaId: string | null = null;
  let decimal: Decimal = 'coma';
  let cuentas: Cuenta[] = [];
  let ocupado = false;
  let lectura = 0;
  let timerMarca: number | undefined;
  let preparado: { listo: ArchivoListo } | null = null;
  let avanzadasAbiertas = false;
  // Estado del panel "Archivo listo": opciones que Chrome ya rechazó y siguiente tanda de "datos y fotos".
  let estadoPanel: { zipRechazado: boolean; loteRechazado: string | null; siguienteTanda: number } = {
    zipRechazado: false,
    loteRechazado: null,
    siguienteTanda: 0,
  };

  const hoy = (): string => dateKey(new Date());
  const mesActual = (): Mes => mes ?? mesDe(new Date());

  const root = el('div', 'ajustes-seccion');
  const titulo = (texto: string): HTMLElement => el('p', 'edit-titulo', texto);
  root.append(
    el(
      'p',
      'hoja-ayuda',
      '"Solo nuevos" incluye lo creado o editado desde la última exportación y lo eliminado desde entonces. Los demás períodos no cambian el control de lo ya exportado.',
    ),
  );

  // ---------- Período ----------
  const filaAlcance = el('div', 'cat-selector opciones-2');
  const botonesAlcance = OPCIONES_ALCANCE.map(([id, texto]) => {
    const b = boton(texto, () => {
      tipo = id;
      pintar();
    });
    return [id, b] as const;
  });
  filaAlcance.append(...botonesAlcance.map(([, b]) => b));

  const navMes = el('div', 'nav-mes');
  const btnAnterior = boton(
    '‹',
    () => {
      mes = desplazarMes(mesActual(), -1);
      pintar();
    },
    'nav-btn',
  );
  btnAnterior.setAttribute('aria-label', 'Mes anterior');
  const etiqueta = el('div', 'nav-etiqueta');
  const btnSiguiente = boton(
    '›',
    () => {
      const siguiente = desplazarMes(mesActual(), 1);
      const actual = mesDe(new Date());
      mes = siguiente.anio === actual.anio && siguiente.mes === actual.mes ? null : siguiente;
      pintar();
    },
    'nav-btn',
  );
  btnSiguiente.setAttribute('aria-label', 'Mes siguiente');
  navMes.append(btnAnterior, etiqueta, btnSiguiente);

  const iDesde = el('input', 'nota-input');
  iDesde.type = 'date';
  iDesde.setAttribute('aria-label', 'Desde');
  const iHasta = el('input', 'nota-input');
  iHasta.type = 'date';
  iHasta.setAttribute('aria-label', 'Hasta');
  const etDesde = el('label', 'campo-fecha', 'Desde');
  etDesde.append(iDesde);
  const etHasta = el('label', 'campo-fecha', 'Hasta');
  etHasta.append(iHasta);
  const filaRango = el('div', 'campos-fecha');
  filaRango.append(etDesde, etHasta);
  iDesde.addEventListener('change', () => {
    desde = iDesde.value;
    pintar();
  });
  iHasta.addEventListener('change', () => {
    hasta = iHasta.value;
    pintar();
  });

  const errorRango = el('p', 'hoja-error');
  errorRango.setAttribute('role', 'alert');

  // ---------- Cuenta ----------
  const selCuenta = el('select', 'filtro-categoria');
  selCuenta.setAttribute('aria-label', 'Cuenta a exportar');
  selCuenta.addEventListener('change', () => {
    cuentaId = selCuenta.value || null;
    pintar();
  });
  const bloqueCuenta = el('div', 'edit-seccion');
  bloqueCuenta.append(titulo('Cuenta'), selCuenta);

  // ---------- Resumen y los dos botones ----------
  const resumen = el('p', 'exportar-resumen');
  resumen.setAttribute('role', 'status');

  const btnCsv = el('button', 'btn-primario', 'Exportar para Google Sheets (CSV)');
  btnCsv.type = 'button';
  const ayudaCsv = el('p', 'hoja-ayuda', 'Solo los datos, sin fotos.');
  const btnZip = el('button', 'btn-primario', 'Exportar con fotos (ZIP)');
  btnZip.type = 'button';
  const ayudaZip = el('p', 'hoja-ayuda');
  // Por HTTP (p. ej. http://<IP-LAN>:4173) Chrome puede bloquear la descarga de un ZIP.
  const avisoHttp = el('p', 'hoja-ayuda aviso-http', AVISO_ZIP_HTTP);
  avisoHttp.hidden = !debeAvisarZipHttp(window.isSecureContext, 'zip');
  btnCsv.addEventListener('click', () => void exportar('csv'));
  btnZip.addEventListener('click', () => void exportar('zip'));

  const progreso = el('progress', 'exportar-progreso');
  progreso.max = 1;
  progreso.hidden = true;
  const textoProgreso = el('p', 'hoja-ayuda');
  textoProgreso.setAttribute('role', 'status');
  const panelListo = el('div', 'ajustes-seccion');
  panelListo.hidden = true;
  // "Archivo listo" es una pantalla secundaria: se registra en la pila y el Atrás de Android la cierra.
  let capaListo: Capa | null = null;
  function ocultarListo(): void {
    capaListo = null;
    preparado = null; // el archivo armado se descarta; se vuelve a armar al exportar
    panelListo.hidden = true;
  }
  function cerrarListo(): void {
    if (capaListo) capaListo.cerrar();
    else ocultarListo();
  }
  const resultado = el('p', 'exportar-resultado');
  resultado.setAttribute('role', 'status');
  const ultima = el('p', 'hoja-ayuda');

  // ---------- Opciones avanzadas (plegadas): separador decimal ----------
  const btnAvanzadas = el('button', 'cat-op acordeon-mas');
  btnAvanzadas.type = 'button';
  const cuerpoAvanzadas = el('div', 'ajustes-seccion');
  cuerpoAvanzadas.hidden = true;
  const filaDecimal = el('div', 'cat-selector opciones-2');
  const btnComa = boton('Decimal con coma', () => void cambiarDecimal('coma'));
  const btnPunto = boton('Decimal con punto', () => void cambiarDecimal('punto'));
  filaDecimal.append(btnComa, btnPunto);
  const ayudaDecimal = el('p', 'hoja-ayuda');
  cuerpoAvanzadas.append(
    titulo('Separador decimal del CSV'),
    filaDecimal,
    ayudaDecimal,
    titulo('Registro de la última exportación'),
    registroPantalla,
  );
  btnAvanzadas.addEventListener('click', () => {
    avanzadasAbiertas = !avanzadasAbiertas;
    pintarAvanzadas();
  });

  function pintarAvanzadas(): void {
    btnAvanzadas.textContent = `${avanzadasAbiertas ? '▲' : '▼'} Opciones avanzadas`;
    btnAvanzadas.setAttribute('aria-expanded', String(avanzadasAbiertas));
    cuerpoAvanzadas.hidden = !avanzadasAbiertas;
  }

  async function cambiarDecimal(nuevo: Decimal): Promise<void> {
    try {
      await repoAjustes.set('decimalCsv', nuevo);
    } catch (e) {
      mostrarError(`No se pudo guardar el formato decimal: ${mensajeDeError(e)}`);
      return;
    }
    decimal = nuevo;
    pintar();
  }

  // ---------- Aviso "Deshacer marca" (10 s) ----------
  const toast = el('div', 'toast');
  toast.hidden = true;
  const toastTexto = el('span');
  const toastDeshacer = el('button', 'toast-btn', 'Deshacer marca');
  toastDeshacer.type = 'button';
  toast.append(toastTexto, toastDeshacer);

  root.append(
    titulo('Período'),
    filaAlcance,
    navMes,
    filaRango,
    errorRango,
    bloqueCuenta,
    resumen,
    btnCsv,
    ayudaCsv,
    btnZip,
    ayudaZip,
    avisoHttp,
    progreso,
    textoProgreso,
    panelListo,
    resultado,
    ultima,
    btnAvanzadas,
    cuerpoAvanzadas,
    toast,
  );

  // ---------- Alcance actual ----------
  function alcance(): Alcance {
    if (tipo === 'mes') return { tipo, mes: mesActual() };
    if (tipo === 'rango') return { tipo, desde, hasta };
    return { tipo };
  }

  const bloquear = (valor: boolean): void => {
    ocupado = valor;
    btnCsv.disabled = valor;
    btnZip.disabled = valor;
    for (const [, b] of botonesAlcance) b.disabled = valor;
    for (const b of [btnAnterior, btnSiguiente, btnComa, btnPunto]) b.disabled = valor;
    selCuenta.disabled = valor;
    iDesde.disabled = valor;
    iHasta.disabled = valor;
  };

  // ---------- Pintado ----------
  function pintar(): void {
    for (const [id, b] of botonesAlcance) b.setAttribute('aria-pressed', String(id === tipo));
    btnComa.setAttribute('aria-pressed', String(decimal === 'coma'));
    btnPunto.setAttribute('aria-pressed', String(decimal === 'punto'));
    ayudaDecimal.textContent =
      decimal === 'coma'
        ? 'Decimal con coma: columnas separadas por punto y coma. Úsalo si tu Google Sheets está en español de Colombia.'
        : 'Decimal con punto: columnas separadas por coma. Úsalo si tu Google Sheets está en inglés.';
    pintarAvanzadas();

    navMes.hidden = tipo !== 'mes';
    filaRango.hidden = tipo !== 'rango';
    const actual = mesActual();
    etiqueta.textContent = etiquetaMes(actual);
    const ahora = mesDe(new Date());
    btnSiguiente.disabled = ocupado || (actual.anio === ahora.anio && actual.mes === ahora.mes);

    const maximo = hoy();
    iDesde.max = hasta && hasta < maximo ? hasta : maximo;
    iHasta.max = maximo;
    iHasta.min = desde;
    iDesde.value = desde;
    iHasta.value = hasta;

    bloqueCuenta.hidden = cuentas.length <= 1;
    selCuenta.replaceChildren(
      new Option('Todas las cuentas', ''),
      ...ordenadas(cuentas).map((c) => new Option(`${etiquetaCuenta(c)}${c.archivada ? ' (archivada)' : ''}`, c.id)),
    );
    selCuenta.value = cuentaId ?? '';

    // Cambiar cualquier opción descarta el archivo que esperaba un toque para compartirse.
    preparado = null;
    cerrarListo();
    void actualizarResumen();
  }

  async function calcularResumen(a: Alcance): Promise<ResumenSeleccion> {
    const datos = await leerParaExportar();
    const sel = seleccionar(datos.gastos, datos.eliminados, a, cuentaId);
    const ids = sel.gastos.map((g) => g.fotoId).filter((x): x is string => x !== null);
    const fotos = ids.length ? await db.fotos.bulkGet(ids) : [];
    return {
      gastos: sel.gastos.length,
      eliminados: sel.eliminados.length,
      conFoto: ids.length,
      bytesFotos: fotos.reduce((s, f) => s + (f?.blob.size ?? 0), 0),
    };
  }

  async function actualizarResumen(): Promise<void> {
    const mi = ++lectura;
    const a = alcance();
    const problema = a.tipo === 'rango' ? validarRango(a.desde, a.hasta, hoy()) : null;
    errorRango.textContent = a.tipo === 'rango' && (desde || hasta) ? (problema ?? '') : '';
    errorRango.hidden = !errorRango.textContent;
    if (problema) {
      resumen.textContent = 'Elige un rango de fechas válido.';
      ayudaZip.textContent = 'Los datos más las fotos de los recibos.';
      return;
    }
    try {
      const r = await calcularResumen(a);
      if (mi !== lectura) return;
      if (r.gastos + r.eliminados === 0) {
        resumen.textContent = `${mensajeVacio(a)}.`;
        ayudaZip.textContent = 'Los datos más las fotos de los recibos.';
        return;
      }
      const partes = [r.gastos === 1 ? '1 gasto' : `${r.gastos} gastos`, `${r.conFoto} con foto`];
      if (r.eliminados > 0) partes.push(r.eliminados === 1 ? '1 eliminado' : `${r.eliminados} eliminados`);
      resumen.textContent = partes.join(' · ');
      ayudaZip.textContent =
        r.conFoto > 0
          ? `Los datos más las fotos de los recibos · ZIP de unos ${textoPeso(r.bytesFotos)}.`
          : 'Los datos más las fotos de los recibos (en esta selección no hay fotos).';
    } catch (e) {
      if (mi === lectura) resumen.textContent = '';
      mostrarError(`No se pudo calcular el resumen de la exportación: ${mensajeDeError(e)}`);
    }
  }

  async function pintarUltima(): Promise<void> {
    const v = await repoAjustes.get('ultimaExportacion');
    ultima.textContent =
      typeof v === 'string' && v ? `Última exportación: ${textoFechaHora(v)}` : 'Todavía no has exportado.';
  }

  // ---------- Exportar ----------
  /** Lleva el resultado (o el panel "Archivo listo") a la vista: nunca debe quedar fuera de pantalla. */
  function mostrarResultado(destino: HTMLElement = resultado): void {
    destino.scrollIntoView?.({ block: 'nearest' });
  }

  function ocultarToast(): void {
    window.clearTimeout(timerMarca);
    toast.hidden = true;
    toastDeshacer.onclick = null;
  }

  function mostrarDeshacerMarca(previa: MarcaPrevia, cantidad: number): void {
    window.clearTimeout(timerMarca);
    toastTexto.textContent = `${cantidad === 1 ? '1 gasto marcado' : `${cantidad} gastos marcados`} como exportado${cantidad === 1 ? '' : 's'}`;
    toast.hidden = false;
    toastDeshacer.onclick = async () => {
      ocultarToast();
      try {
        await repoMarcas.revertir(previa);
        // Se vuelve a leer la base para comprobar que esos gastos están pendientes otra vez.
        const datos = await leerParaExportar();
        const restaurar = new Set(previa.gastos.map((x) => x.id));
        const pendientes = datos.gastos.filter((g) => restaurar.has(g.id) && pendienteDeExportar(g)).length;
        if (pendientes !== previa.gastos.length) {
          mostrarError(`La marca no se deshizo del todo: ${pendientes} de ${previa.gastos.length} gastos volvieron a pendientes.`);
        }
        resultado.textContent = `Marca deshecha: ${pendientes} gastos y ${previa.eliminados.length} eliminados vuelven a "Solo nuevos".`;
        mostrarResultado();
      } catch (e) {
        mostrarError(`No se pudo deshacer la marca: ${mensajeDeError(e)}`);
      }
      await pintarUltima();
      void actualizarResumen();
    };
    timerMarca = window.setTimeout(ocultarToast, DESHACER_MARCA_MS);
  }

  async function terminar(listo: ArchivoListo, r: ResultadoEntrega): Promise<void> {
    anotar('entrega: resultado', { estado: r.estado });
    cerrarListo();
    if (r.estado === 'cancelado') {
      resultado.textContent = 'Compartir cancelado: no se marcó nada como exportado.';
      mostrarResultado();
      return;
    }
    if (r.estado === 'requiere-gesto') {
      mostrarPanelListo(listo, true);
      return;
    }
    if (r.estado === 'rechazado') {
      estadoPanel.zipRechazado = true;
      mostrarError('Chrome no permite compartir este archivo. Usa "Compartir datos y fotos" o descárgalo.');
      mostrarPanelListo(listo);
      return;
    }
    preparado = null;
    const marcados = listo.plan.marca ? listo.gastos + listo.eliminados : 0;
    const detalle = listo.plan.marca ? ` ${marcados} marcados como exportados.` : '';
    const faltan = listo.fotosFaltantes > 0 ? ` ${listo.fotosFaltantes} fotos no se encontraron y salieron sin foto.` : '';
    if (r.estado === 'compartido') {
      resultado.textContent = `Listo: ${listo.archivo.name} compartido.${detalle}${faltan}`;
      // Compartir terminado no garantiza que el destino lo reciba: también se puede deshacer la marca.
      if (listo.plan.marca) mostrarDeshacerMarca(r.previa, marcados);
    } else {
      resultado.textContent = `${textoDescarga(listo.archivo.name, esDispositivoMovil())}${detalle}${faltan}`;
      if (listo.plan.marca) mostrarDeshacerMarca(r.previa, marcados);
    }
    if (faltan) mostrarAviso(faltan.trim());
    mostrarResultado();
    await pintarUltima();
    void actualizarResumen();
  }

  async function entregarArchivo(listo: ArchivoListo, forzarDescarga: boolean, toqueReciente = false): Promise<void> {
    // Mientras el menú Compartir está abierto la promesa no se resuelve: se avisa para que no parezca colgado.
    if (!forzarDescarga) textoProgreso.textContent = 'Esperando el menú Compartir…';
    anotar('entrega: inicio', { archivo: listo.archivo.name, forzarDescarga, toqueReciente });
    let r: ResultadoEntrega;
    try {
      r = await entregar(
        listo,
        { compartir: (f) => compartirArchivo(f, undefined, { toqueReciente, anotar }), descargar },
        repoMarcas,
        () => new Date(),
        forzarDescarga,
      );
    } finally {
      textoProgreso.textContent = '';
    }
    await terminar(listo, r);
  }

  /** Comparte la siguiente tanda de "datos y fotos" (cada tanda necesita un toque nuevo). */
  async function compartirSiguienteTanda(listo: ArchivoListo, tandas: File[][]): Promise<void> {
    const i = estadoPanel.siguienteTanda;
    anotar('lote: compartir tanda', { tanda: i + 1, de: tandas.length, archivos: tandas[i]?.length });
    textoProgreso.textContent = 'Esperando el menú Compartir…';
    let r: ResultadoTanda;
    try {
      r = await entregarTanda(
        tandas,
        i,
        listo.plan,
        (files) => compartirArchivos(files, undefined, { toqueReciente: true, anotar }),
        repoMarcas,
        () => new Date(),
      );
    } finally {
      textoProgreso.textContent = '';
    }
    anotar('lote: resultado', { estado: r.estado });
    if (r.estado === 'tanda') {
      estadoPanel.siguienteTanda = i + 1;
      resultado.textContent = `Tanda ${i + 1} de ${r.total} compartida. Toca el botón para la tanda ${i + 2}. Solo se marca como exportado al terminar la última.`;
      mostrarPanelListo(listo);
      mostrarResultado();
    } else if (r.estado === 'completo') {
      preparado = null;
      cerrarListo();
      const marcados = listo.plan.marca ? listo.gastos + listo.eliminados : 0;
      const detalle = listo.plan.marca ? ` ${marcados} marcados como exportados.` : '';
      resultado.textContent = `Listo: datos y fotos compartidos (${listo.lote?.length ?? 0} archivos en ${r.total} ${r.total === 1 ? 'tanda' : 'tandas'}).${detalle}`;
      if (listo.plan.marca) mostrarDeshacerMarca(r.previa, marcados);
      mostrarResultado();
      await pintarUltima();
      void actualizarResumen();
    } else if (r.estado === 'cancelado') {
      resultado.textContent = `Compartir cancelado en la tanda ${i + 1} de ${tandas.length}: no se marcó nada como exportado. Toca el botón para reintentar esa tanda.`;
      mostrarPanelListo(listo);
      mostrarResultado();
    } else {
      estadoPanel.loteRechazado = `Chrome no permitió compartir la tanda ${i + 1} de ${tandas.length}.`;
      mostrarError(`${estadoPanel.loteRechazado} Descarga el ZIP en su lugar.`);
      mostrarPanelListo(listo);
    }
  }

  /**
   * "Archivo listo": se muestran solo las opciones que Chrome permite (según canShare), cada una con un toque
   * reciente. Para un ZIP en el celular siempre se pasa por aquí: armarlo tarda y el toque original ya expiró.
   */
  function mostrarPanelListo(listo: ArchivoListo, avisar = false): void {
    preparado = { listo };
    const movil = esDispositivoMovil();
    const esZip = listo.lote !== null;
    const lote: PlanLote | null =
      esZip && movil
        ? estadoPanel.loteRechazado
          ? { ok: false, motivo: estadoPanel.loteRechazado }
          : planificarLote(listo.lote!)
        : null;
    const opciones = opcionesDeEntrega({
      formato: esZip ? 'zip' : 'csv',
      movil,
      puedeCompartirArchivo: movil && !estadoPanel.zipRechazado && puedeCompartir([listo.archivo]),
      lote,
    });
    anotar('panel: opciones', { ...opciones, motivoSinLote: lote && !lote.ok ? lote.motivo : undefined });

    const protegido = (accion: () => Promise<void>, texto: string) => async () => {
      if (ocupado) {
        mostrarAviso('Espera a que termine la acción anterior.');
        return;
      }
      bloquear(true);
      try {
        await accion();
      } catch (e) {
        anotar(`${texto}: error`, { mensaje: mensajeDeError(e) });
        mostrarError(`${texto}: ${mensajeDeError(e)}`);
      } finally {
        bloquear(false);
      }
    };

    const partes: HTMLElement[] = [el('p', 'hoja-ayuda', `El archivo ${listo.archivo.name} está listo. Elige qué hacer:`)];
    if (opciones.compartirLote && lote?.ok) {
      const t = lote.tandas;
      const i = Math.min(estadoPanel.siguienteTanda, t.length - 1);
      partes.push(
        boton(
          t.length === 1 ? `Compartir datos y fotos (${listo.lote!.length} archivos)` : `Compartir datos y fotos · tanda ${i + 1} de ${t.length}`,
          protegido(() => compartirSiguienteTanda(listo, t), 'No se pudo compartir los datos y fotos'),
          'btn-primario',
        ),
        el(
          'p',
          'hoja-ayuda',
          t.length === 1
            ? 'Comparte el CSV y cada foto como archivos separados.'
            : `Comparte el CSV y cada foto como archivos separados, en ${t.length} tandas (Chrome limita cuántos admite cada vez). Solo se marca como exportado al terminar la última.`,
        ),
      );
    } else if (esZip && movil) {
      partes.push(el('p', 'hoja-ayuda', `No se pueden compartir datos y fotos por separado. ${lote && !lote.ok ? lote.motivo : ''}`.trim()));
    }
    if (opciones.compartirArchivo) {
      partes.push(
        boton(
          esZip ? 'Compartir el ZIP' : 'Compartir',
          protegido(() => entregarArchivo(listo, false, true), 'No se pudo compartir el archivo'),
          esZip ? 'cat-op' : 'btn-primario',
        ),
      );
    } else if (esZip && movil) {
      partes.push(el('p', 'hoja-ayuda', 'Chrome no permite compartir un archivo ZIP.'));
    }
    partes.push(
      boton(
        esZip ? 'Descargar el ZIP' : 'Descargar',
        protegido(() => entregarArchivo(listo, true), 'No se pudo descargar el archivo'),
        'cat-op',
      ),
    );
    panelListo.replaceChildren(botonAtras(), ...partes);
    panelListo.hidden = false;
    // Atrás (botón o Android) pregunta antes de descartar el archivo ya armado; cerrar por código no pregunta.
    if (!capaListo) {
      capaListo = navegacion.abrir({
        cerrar: ocultarListo,
        hayCambios: () => preparado !== null,
        confirmacion: { mensaje: '¿Descartar el archivo preparado?', descartar: 'Descartar archivo', seguir: 'Conservarlo' },
      });
    }
    if (avisar) {
      resultado.textContent = '';
      mostrarAviso(`El archivo ${listo.archivo.name} está listo: elige cómo compartirlo o descargarlo.`);
    }
    mostrarResultado(panelListo);
  }

  async function exportar(formato: Formato): Promise<void> {
    if (ocupado) return;
    ocultarToast();
    resultado.textContent = '';
    cerrarListo();
    estadoPanel = { zipRechazado: false, loteRechazado: null, siguienteTanda: 0 };
    bitacora.limpiar();
    anotar('exportar: inicio', {
      formato,
      seguro: window.isSecureContext,
      movil: esDispositivoMovil(),
      standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
      agente: navigator.userAgent,
    });
    const a = alcance();
    if (a.tipo === 'rango') {
      const problema = validarRango(a.desde, a.hasta, hoy());
      if (problema) {
        mostrarAviso(problema);
        return;
      }
    }
    bloquear(true);
    try {
      const ahora = new Date();
      const datos = await leerParaExportar();
      const seleccion = seleccionar(datos.gastos, datos.eliminados, a, cuentaId);
      anotar('exportar: selección', { gastos: seleccion.gastos.length, eliminados: seleccion.eliminados.length });
      if (totalFilas(seleccion) === 0) {
        resultado.textContent = `${mensajeVacio(a)}.`;
        mostrarAviso(mensajeVacio(a));
        mostrarResultado();
        return;
      }
      progreso.hidden = false;
      progreso.value = 0;
      const t0 = performance.now();
      const listo = await prepararArchivo(
        {
          seleccion,
          alcance: a,
          formato,
          decimal,
          categorias: datos.categorias,
          cuentas: datos.cuentas,
          cuentaFiltro: cuentaId,
          corte: ahora,
        },
        (fotoId) => db.fotos.get(fotoId),
        (texto, fraccion) => {
          textoProgreso.textContent = texto;
          progreso.value = fraccion;
        },
      );
      anotar('exportar: archivo armado', {
        nombre: listo.archivo.name,
        tipo: listo.archivo.type,
        bytes: listo.archivo.size,
        ms: Math.round(performance.now() - t0),
        archivosDelLote: listo.lote?.length ?? 0,
      });
      progreso.hidden = true;
      textoProgreso.textContent = '';
      if (formato === 'zip' && esDispositivoMovil()) mostrarPanelListo(listo, true);
      else await entregarArchivo(listo, false);
    } catch (e) {
      anotar('exportar: error', { mensaje: mensajeDeError(e) });
      mostrarError(`No se pudo exportar: ${mensajeDeError(e)}`);
    } finally {
      progreso.hidden = true;
      textoProgreso.textContent = '';
      bloquear(false);
      repintarConservandoListo();
    }
  }

  /** Refresca botones deshabilitados sin descartar el archivo que espera un toque. */
  function repintarConservandoListo(): void {
    const guardado = preparado;
    pintar();
    if (guardado) mostrarPanelListo(guardado.listo);
  }

  async function activar(): Promise<void> {
    const [datos, dec] = await Promise.all([leerParaExportar(), repoAjustes.get('decimalCsv')]);
    cuentas = datos.cuentas;
    if (cuentaId !== null && !cuentas.some((c) => c.id === cuentaId)) cuentaId = null;
    decimal = decimalDeAjuste(dec);
    if (!hasta) hasta = hoy();
    if (!desde) desde = `${hoy().slice(0, 8)}01`;
    pintar();
    await pintarUltima();
  }

  return { el: root, activar };
}
