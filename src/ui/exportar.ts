import { db, leerParaExportar, repoAjustes, repoMarcas } from '../db';
import { compartirArchivo } from '../lib/compartir';
import { mensajeDeError } from '../lib/compat';
import { etiquetaCuenta, ordenadas } from '../lib/cuentas';
import { decimalDeAjuste, type Decimal } from '../lib/csv';
import { dateKey, desplazarMes, etiquetaMes, formatDdMmAaaa, isoAFechaHora, mesDe, type Mes } from '../lib/dates';
import {
  entregar,
  mensajeVacio,
  pendienteDeExportar,
  prepararArchivo,
  seleccionar,
  totalFilas,
  validarRango,
  type Alcance,
  type ArchivoListo,
  type Formato,
  type MarcaPrevia,
  type ResultadoEntrega,
} from '../lib/exportar';
import { textoPeso } from '../lib/fotos';
import type { Cuenta } from '../types';
import { mostrarAviso, mostrarError } from './avisos';

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

/** Descarga directa: en escritorio y siempre que no haya Web Share (p. ej. por http://<IP-LAN>). */
function descargar(archivo: File): void {
  // `archivo` ya llega con tipo genérico (ver archivoParaDescarga) y su nombre exacto.
  const url = URL.createObjectURL(archivo);
  const a = el('a');
  a.href = url;
  a.download = archivo.name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
  btnCsv.addEventListener('click', () => void exportar('csv'));
  btnZip.addEventListener('click', () => void exportar('zip'));

  const progreso = el('progress', 'exportar-progreso');
  progreso.max = 1;
  progreso.hidden = true;
  const textoProgreso = el('p', 'hoja-ayuda');
  textoProgreso.setAttribute('role', 'status');
  const panelListo = el('div', 'ajustes-seccion');
  panelListo.hidden = true;
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
  cuerpoAvanzadas.append(titulo('Separador decimal del CSV'), filaDecimal, ayudaDecimal);
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
    panelListo.hidden = true;
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
    panelListo.hidden = true;
    if (r.estado === 'cancelado') {
      resultado.textContent = 'Compartir cancelado: no se marcó nada como exportado.';
      mostrarResultado();
      return;
    }
    if (r.estado === 'requiere-gesto') {
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
      resultado.textContent = `Se descargó ${listo.archivo.name} en tu carpeta de descargas. No puedo saber si llegó a su destino.${detalle}${faltan}`;
      if (listo.plan.marca) mostrarDeshacerMarca(r.previa, marcados);
    }
    if (faltan) mostrarAviso(faltan.trim());
    mostrarResultado();
    await pintarUltima();
    void actualizarResumen();
  }

  async function entregarArchivo(listo: ArchivoListo, forzarDescarga: boolean): Promise<void> {
    // Mientras el menú Compartir está abierto la promesa no se resuelve: se avisa para que no parezca colgado.
    if (!forzarDescarga) textoProgreso.textContent = 'Esperando el menú Compartir…';
    let r: ResultadoEntrega;
    try {
      r = await entregar(
        listo,
        { compartir: (f) => compartirArchivo(f), descargar },
        repoMarcas,
        () => new Date(),
        forzarDescarga,
      );
    } finally {
      textoProgreso.textContent = '';
    }
    await terminar(listo, r);
  }

  /** Chrome exige un toque reciente para compartir: si armar el archivo tardó, se pide uno nuevo. */
  function mostrarPanelListo(listo: ArchivoListo): void {
    preparado = { listo };
    const act = (forzar: boolean) => async () => {
      if (ocupado) return;
      bloquear(true);
      try {
        await entregarArchivo(listo, forzar);
      } catch (e) {
        mostrarError(`No se pudo compartir el archivo: ${mensajeDeError(e)}`);
      } finally {
        bloquear(false);
      }
    };
    panelListo.replaceChildren(
      el('p', 'hoja-ayuda', `El archivo ${listo.archivo.name} está listo. Toca para compartirlo.`),
      boton('Compartir', act(false), 'btn-primario'),
      boton('Descargar en lugar de compartir', act(true), 'cat-op'),
    );
    panelListo.hidden = false;
    resultado.textContent = '';
    mostrarAviso(`El archivo ${listo.archivo.name} está listo: toca Compartir o Descargar.`);
    mostrarResultado(panelListo);
  }

  async function exportar(formato: Formato): Promise<void> {
    if (ocupado) return;
    ocultarToast();
    resultado.textContent = '';
    panelListo.hidden = true;
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
      if (totalFilas(seleccion) === 0) {
        resultado.textContent = `${mensajeVacio(a)}.`;
        mostrarAviso(mensajeVacio(a));
        mostrarResultado();
        return;
      }
      progreso.hidden = false;
      progreso.value = 0;
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
      progreso.hidden = true;
      textoProgreso.textContent = '';
      await entregarArchivo(listo, false);
    } catch (e) {
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
