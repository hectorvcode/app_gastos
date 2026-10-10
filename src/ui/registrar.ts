import { borrarGastoConFoto, guardarGastoConFoto, repoAjustes, repoBorrador, db } from '../db';
import { avisoRecuperacion, borrarBorrador, guardarBorrador, guardarFotoPendiente, leerBorrador } from '../lib/borrador';
import { addDays, dayMonthLabel, shortLabel } from '../lib/dates';
import { categoriasDeRegistrar } from '../lib/categorias';
import { mensajeDeError } from '../lib/compat';
import { cargarRecordatorio, cerrarRecordatorio, textoRecordatorio } from '../lib/recordatorio';
import type { Capa } from '../lib/navegacion';
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
  resolverMonedaAlActivar,
  resolverMonedaInicial,
  type ConfigMonedas,
} from '../lib/monedas';
import { ErrorFoto, mensajeErrorAlmacenamiento, textoInfoFoto, type FotoProcesada } from '../lib/fotos';
import { MAX_NOTA } from '../lib/nota';
import {
  aplicarTeclaFisica,
  guardadoRapidoActivo,
  SesionRegistro,
  textoBotonGuardar,
  type CambioMoneda,
  type Falta,
  type ResultadoGuardado,
} from '../lib/registro';
import type { Categoria, Cuenta } from '../types';
import { mostrarAviso, mostrarError } from './avisos';
import { botonAtras, navegacion } from './navegacion';
import { crearSelectorFoto, procesarArchivoElegido } from './foto-selector';
import { cerrarTecladoConEnter } from './teclado';
import { abrirVisor } from './visor';

const DESHACER_MS = 5000;
const FALTA_MS = 2200;
const AVISO_SELECCION_MS = 3500;

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

/** `irARespaldo`: lleva a Ajustes → Respaldo (desde el recordatorio). */
export async function crearRegistrar(irARespaldo: () => void): Promise<VistaRegistrar> {
  let config: ConfigMonedas = await cargarConfigMonedas(repoAjustes);
  const moneda = resolverMonedaInicial(await repoAjustes.get('ultimaMoneda'), config);
  const sesion = new SesionRegistro(moneda, {
    add: guardarGastoConFoto,
    delete: borrarGastoConFoto,
  });
  let cuentas: Cuenta[] = await db.cuentas.toArray();
  let catalogo: Categoria[] = await db.categorias.toArray();
  const estadoCuentas = await cargarEstadoCuentas(repoAjustes, cuentas);
  let cuentaPredeterminada = estadoCuentas.predeterminada;
  sesion.cuentaId = estadoCuentas.actual;
  sesion.guardadoRapido = guardadoRapidoActivo(await repoAjustes.get('guardadoRapido'));
  let toastTimer: number | undefined;
  let enCurso = false; // un guardado en marcha (incluida la espera de la foto): los toques nuevos se ignoran
  let faltaTimer: number | undefined;
  let avisoSeleccionTimer: number | undefined;

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
  const chipFoto = el('button', 'chip');
  chipFoto.type = 'button';
  chips.append(chipFecha, chipMoneda, chipCuenta, chipNota, chipFoto);

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
      programarBorrador();
      sinFoco(e);
    });
    teclado.append(b);
  }

  // --- Categorías ---
  const grid = el('div', 'categorias');

  // --- Botón Guardar (Fase 8): fijo justo encima de la barra inferior; oculto con el guardado rápido ---
  // Nunca lleva `disabled`: sin datos se ve apagado (aria-disabled), pero al tocarlo explica qué falta.
  const guardarBtn = el('button', 'btn-guardar');
  guardarBtn.type = 'button';
  guardarBtn.setAttribute('aria-live', 'polite');
  guardarBtn.addEventListener('click', (e) => {
    sinFoco(e);
    void intentarGuardar();
  });

  // --- Aviso breve cuando se quita la categoría seleccionada ---
  const avisoSeleccion = el('div', 'toast toast-breve');
  avisoSeleccion.hidden = true;
  avisoSeleccion.setAttribute('role', 'status');

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

  // --- Foto del recibo (pendiente para el siguiente gasto, como la nota) ---
  const selector = crearSelectorFoto(recibirArchivo);
  let procesando: Promise<boolean> | null = null;
  let urlMiniatura: string | null = null;
  let fotoPintada: unknown; // undefined = aún no pintado

  // Borrador (resiste a que Android cierre Chrome al abrir la cámara): se guarda mientras hay
  // una foto pendiente o se espera una, y se borra al guardar el gasto o al quitar la foto.
  let esperandoFoto = false;
  let hayBorrador = false;
  let fotoPersistida: FotoProcesada | null = null;
  let colaBorrador: Promise<void> = Promise.resolve();
  let borradorTimer: number | undefined;

  const borradorActivo = (): boolean => sesion.foto !== null || esperandoFoto || procesando !== null;

  /** Escribe (o borra) el borrador en orden, sin que una escritura vieja pise a una nueva. */
  function sincronizarBorrador(): Promise<void> {
    window.clearTimeout(borradorTimer);
    colaBorrador = colaBorrador.then(async () => {
      try {
        if (!borradorActivo()) {
          if (hayBorrador || fotoPersistida) await borrarBorrador(repoBorrador);
          hayBorrador = false;
          fotoPersistida = null;
          return;
        }
        if (sesion.foto !== fotoPersistida) {
          await guardarFotoPendiente(repoBorrador, sesion.foto);
          fotoPersistida = sesion.foto;
        }
        await guardarBorrador(repoBorrador, sesion.instantanea(), esperandoFoto || procesando !== null, Date.now());
        hayBorrador = true;
      } catch (e) {
        mostrarError(`No se pudo guardar el borrador del gasto: ${mensajeErrorAlmacenamiento(e)}`);
      }
    });
    return colaBorrador;
  }

  /** Para cambios frecuentes (teclas, nota): espera un momento y solo escribe si hay un borrador activo. */
  function programarBorrador(): void {
    if (!borradorActivo()) return;
    window.clearTimeout(borradorTimer);
    borradorTimer = window.setTimeout(() => void sincronizarBorrador(), 400);
  }

  /** Abre la cámara o la galería, guardando antes el borrador. */
  async function abrirSelector(abrir: () => void): Promise<void> {
    esperandoFoto = true;
    try {
      await sincronizarBorrador();
    } finally {
      abrir(); // si el borrador falla ya se avisó; el selector se abre igual
    }
  }

  // Si el selector se cierra sin elegir nada, ya no se espera ninguna foto.
  const alVolver = (): void => {
    if (document.hidden || !esperandoFoto) return;
    window.setTimeout(() => {
      if (esperandoFoto && procesando === null) {
        esperandoFoto = false;
        void sincronizarBorrador();
      }
    }, 2500);
  };
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('focus', alVolver);

  // --- Recordatorio de respaldo: franja flotante sobre el espacio libre bajo el monto. No empuja nada, así que
  // no quita lugar a las categorías ni provoca scroll.
  const avisoRespaldo = el('div', 'aviso-respaldo');
  avisoRespaldo.hidden = true;
  const avisoRespaldoTexto = el('span', 'aviso-respaldo-texto');
  const avisoRespaldoIr = el('button', 'aviso-respaldo-btn', 'Respaldar');
  avisoRespaldoIr.type = 'button';
  const avisoRespaldoCerrar = el('button', 'aviso-respaldo-cerrar', '✕');
  avisoRespaldoCerrar.type = 'button';
  avisoRespaldoCerrar.setAttribute('aria-label', 'Cerrar el recordatorio hasta mañana');
  avisoRespaldo.append(avisoRespaldoTexto, avisoRespaldoIr, avisoRespaldoCerrar);
  const zonaMonto = el('div', 'zona-monto');
  zonaMonto.append(monto, avisoRespaldo);

  async function actualizarRecordatorio(): Promise<void> {
    try {
      const r = await cargarRecordatorio(repoAjustes, () => db.gastos.count(), new Date());
      avisoRespaldoTexto.textContent = textoRecordatorio(r.dias);
      avisoRespaldo.hidden = !r.mostrar;
    } catch (e) {
      mostrarError(`No se pudo revisar el recordatorio de respaldo: ${mensajeDeError(e)}`);
    }
  }

  avisoRespaldoIr.addEventListener('click', (e) => {
    sinFoco(e);
    irARespaldo();
  });
  avisoRespaldoCerrar.addEventListener('click', async (e) => {
    sinFoco(e);
    avisoRespaldo.hidden = true;
    try {
      await cerrarRecordatorio(repoAjustes, new Date());
    } catch (err) {
      mostrarError(`No se pudo recordar que cerraste el aviso: ${mensajeDeError(err)}`);
    }
  });

  root.append(chips, zonaMonto, teclado, grid, guardarBtn, toast, avisoMoneda, avisoSeleccion, hoja, selector.el);

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

  function pintarFoto(): void {
    if (procesando) {
      chipFoto.replaceChildren(document.createTextNode('⏳ Procesando foto…'));
      chipFoto.classList.add('chip-alerta');
      chipFoto.disabled = true;
      fotoPintada = 'procesando';
      return;
    }
    chipFoto.disabled = false;
    const f = sesion.foto;
    if (f === fotoPintada) return; // sin cambios: no se vuelve a crear la miniatura
    fotoPintada = f;
    if (urlMiniatura) {
      URL.revokeObjectURL(urlMiniatura);
      urlMiniatura = null;
    }
    chipFoto.classList.toggle('chip-alerta', f !== null);
    if (!f) {
      chipFoto.replaceChildren(document.createTextNode('📷 Foto'));
      chipFoto.setAttribute('aria-label', 'Agregar foto del recibo');
      return;
    }
    urlMiniatura = URL.createObjectURL(f.miniatura);
    const img = el('img', 'chip-miniatura');
    img.src = urlMiniatura;
    img.alt = '';
    chipFoto.replaceChildren(img, document.createTextNode(' Foto ●'));
    chipFoto.setAttribute('aria-label', 'Foto pendiente para el próximo gasto');
  }

  function pintarMonto(): void {
    const partes = formatEntryPartes(sesion.entry, sesion.moneda);
    montoValor.textContent = partes.escrito;
    montoRelleno.textContent = partes.relleno;
    monto.classList.toggle('vacio', entryToNumber(sesion.entry) === 0);
    pintarGuardar();
  }

  const nombreCategoria = (id: string | null): string | null =>
    id === null ? null : (catalogo.find((c) => c.id === id)?.nombre ?? null);

  /** Texto y aspecto del botón Guardar; cualquier cambio de monto o selección borra el mensaje de "falta". */
  function pintarGuardar(): void {
    window.clearTimeout(faltaTimer);
    guardarBtn.hidden = sesion.guardadoRapido;
    root.classList.toggle('con-guardar', !sesion.guardadoRapido);
    guardarBtn.textContent = textoBotonGuardar(sesion.entry, sesion.moneda, nombreCategoria(sesion.categoriaId));
    guardarBtn.classList.remove('falta');
    guardarBtn.setAttribute('aria-disabled', String(sesion.faltante() !== null));
  }

  /** Marca la categoría seleccionada y atenúa las demás. */
  function pintarSeleccion(): void {
    const id = sesion.categoriaId;
    grid.classList.toggle('hay-seleccion', id !== null);
    for (const b of grid.querySelectorAll<HTMLButtonElement>('.cat')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    }
    pintarGuardar();
  }

  /** Dice qué falta en el propio botón (y lo señala), sin guardar nada. */
  function mostrarFalta(f: Falta): void {
    if (f.falta === 'monto') vibrarMonto();
    else {
      grid.classList.remove('pide');
      void grid.offsetWidth;
      grid.classList.add('pide');
    }
    window.clearTimeout(faltaTimer);
    guardarBtn.textContent = f.mensaje;
    guardarBtn.classList.add('falta');
    faltaTimer = window.setTimeout(pintarGuardar, FALTA_MS);
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

  /** Botón Guardar o Enter: guarda la categoría seleccionada, o dice qué falta. */
  async function intentarGuardar(): Promise<void> {
    if (enCurso) return;
    const falta = sesion.faltante();
    if (falta) {
      mostrarFalta(falta);
      return;
    }
    await ejecutarGuardado(() => sesion.guardarSeleccion(), 'Toca Guardar otra vez para guardarlo sin foto.');
  }

  /** Guardado rápido: tocar la categoría guarda al instante (con monto 0, el monto vibra). */
  async function guardarRapido(cat: Categoria): Promise<void> {
    if (enCurso) return;
    if (entryToNumber(sesion.entry) <= 0) {
      vibrarMonto();
      return;
    }
    await ejecutarGuardado(() => sesion.guardar(cat.id), 'Toca la categoría otra vez para guardarlo sin foto.');
  }

  async function ejecutarGuardado(guardar: () => Promise<ResultadoGuardado>, reintento: string): Promise<void> {
    enCurso = true;
    try {
      if (procesando && !(await procesando)) {
        mostrarError(`El gasto no se guardó porque la foto no se pudo procesar. ${reintento}`);
        return;
      }
      const promesa = guardar();
      pintarMonto(); // el monto y la selección ya se limpiaron; la base de datos termina en segundo plano
      pintarNota();
      pintarFoto();
      pintarSeleccion();
      const r = await promesa;
      if (!r.ok) return;
      void sincronizarBorrador(); // ya no hay foto pendiente: se borra el borrador
      pintarFecha();
      const cuenta = cuentas.find((x) => x.id === r.gasto.cuentaId);
      mostrarToast(
        textoGuardado(
          r.esHoy ? null : dayMonthLabel(r.fechaKey),
          cuenta && cuenta.id !== cuentaPredeterminada ? cuenta.nombre : null,
        ),
      );
    } catch (e) {
      // la sesión conserva el monto, la nota, la foto y la categoría seleccionada
      pintarMonto();
      pintarNota();
      pintarFoto();
      pintarSeleccion();
      mostrarError(`No se pudo guardar: ${mensajeErrorAlmacenamiento(e)}`);
    } finally {
      enCurso = false;
    }
  }

  const idsVisibles = (cuentaId: string): string[] => categoriasDeRegistrar(cuentas, cuentaId, catalogo).map((c) => c.id);

  /** Aviso breve (sin acciones) de que se quitó la categoría seleccionada. */
  function avisarSeleccionQuitada(categoriaId: string): void {
    const cuenta = cuentas.find((x) => x.id === sesion.cuentaId);
    const nombre = nombreCategoria(categoriaId) ?? 'La categoría';
    window.clearTimeout(avisoSeleccionTimer);
    avisoSeleccion.textContent = `${nombre} no está en ${cuenta?.nombre ?? 'esta cuenta'}: se quitó la selección`;
    avisoSeleccion.hidden = false;
    avisoSeleccionTimer = window.setTimeout(() => (avisoSeleccion.hidden = true), AVISO_SELECCION_MS);
  }

  /** Toque en una categoría: selecciona (o cambia, o quita) o, con guardado rápido, guarda. */
  async function tocarCategoria(c: Categoria): Promise<void> {
    if (sesion.guardadoRapido) {
      await guardarRapido(c);
      return;
    }
    await sesion.tocarCategoria(c.id);
    pintarSeleccion();
    programarBorrador();
  }

  /** Las categorías visibles de la cuenta actual, en su orden. Se repinta al instante al cambiar de cuenta. */
  function pintarCategorias(): void {
    const cats = categoriasDeRegistrar(cuentas, sesion.cuentaId, catalogo);
    grid.replaceChildren(
      ...cats.map((c) => {
        const b = el('button', 'cat');
        b.type = 'button';
        b.dataset.id = c.id;
        b.append(el('span', 'cat-emoji', c.emoji), el('span', 'cat-nombre', c.nombre));
        b.addEventListener('click', (e) => {
          sinFoco(e);
          void tocarCategoria(c);
        });
        return b;
      }),
    );
    pintarSeleccion();
  }

  // ---------- Selector de fecha ----------
  let capaHoja: Capa | null = null;

  /** Muestra la hoja ya armada y la registra en la pila: el Atrás de Android la cierra. */
  function mostrarHoja(): void {
    hoja.hidden = false;
    hojaPanel.scrollTop = 0;
    capaHoja = navegacion.abrir({ cerrar: ocultarHoja });
  }

  function ocultarHoja(): void {
    capaHoja = null;
    hoja.hidden = true;
    pintarFecha();
    pintarMoneda();
    pintarCuenta();
    pintarNota();
    pintarFoto();
    pintarMonto();
    programarBorrador(); // fecha, moneda, cuenta o nota pudieron cambiar
  }

  function cerrarHoja(): void {
    if (capaHoja) capaHoja.cerrar();
    else ocultarHoja();
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
    // Si la fecha elegida no es Hoy, Ayer ni Antier, el chip puede recortarla: aquí se ve completa.
    const personalizada = !opciones.some(([, dias]) => addDays(h, -dias) === actual);
    const otra = el('button', 'hoja-op', personalizada ? `Elegir fecha… · ${shortLabel(actual)} (${dayMonthLabel(actual)})` : 'Elegir fecha…');
    otra.type = 'button';
    otra.classList.toggle('activa', personalizada);
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

    hojaPanel.replaceChildren(botonAtras(), ...botones, otra, input, cerrar);
    mostrarHoja();
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
    hojaPanel.replaceChildren(botonAtras(), ...botones, cerrar);
    mostrarHoja();
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
        const quitada = sesion.cambiarCuenta(c.id, idsVisibles(c.id));
        void persistirCuenta();
        pintarCategorias();
        if (quitada) {
          avisarSeleccionQuitada(quitada);
          programarBorrador();
        }
        cerrarHoja();
      });
      return b;
    });
    const cerrar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cerrar.type = 'button';
    cerrar.addEventListener('click', cerrarHoja);
    hojaPanel.replaceChildren(botonAtras(), ...botones, cerrar);
    mostrarHoja();
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
      programarBorrador();
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
    hojaPanel.replaceChildren(botonAtras(), titulo, campo, contador, pie);
    mostrarHoja();
  }

  chipNota.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHojaNota();
  });

  // ---------- Foto ----------
  function recibirArchivo(archivo: File): void {
    esperandoFoto = false; // la foto llegó; mientras se procesa, el borrador sigue marcado como "esperando"
    const tarea = (async (): Promise<boolean> => {
      try {
        sesion.ponerFoto(await procesarArchivoElegido(archivo));
        return true;
      } catch (e) {
        mostrarError(e instanceof ErrorFoto ? e.message : `No se pudo procesar la foto: ${mensajeDeError(e)}`);
        return false; // si había otra foto pendiente, se conserva
      }
    })();
    procesando = tarea;
    pintarFoto();
    void sincronizarBorrador();
    void tarea.then(() => {
      if (procesando === tarea) procesando = null;
      pintarFoto();
      void sincronizarBorrador(); // foto lista: se guarda también como pendiente en IndexedDB
    });
  }

  function abrirHojaFoto(): void {
    const f = sesion.foto;
    const opcion = (texto: string, alTocar: () => void, clase = 'hoja-op'): HTMLButtonElement => {
      const b = el('button', clase, texto);
      b.type = 'button';
      b.addEventListener('click', alTocar);
      return b;
    };
    const cancelar = opcion(f ? 'Cerrar' : 'Cancelar', cerrarHoja, 'hoja-op hoja-cerrar');
    const partes: HTMLElement[] = [el('h2', 'hoja-titulo', f ? 'Foto del próximo gasto' : 'Foto del recibo')];
    if (f) {
      partes.push(
        el('p', 'hoja-ayuda', textoInfoFoto(f.blob.size, f.ancho, f.alto)),
        opcion('🔍 Ver foto', () => abrirVisor(f.blob, f.ancho, f.alto)),
        opcion('📸 Tomar otra foto', () => {
          void abrirSelector(selector.tomar);
          cerrarHoja();
        }),
        opcion('🖼️ Elegir otra de la galería', () => {
          void abrirSelector(selector.galeria);
          cerrarHoja();
        }),
        opcion('🗑️ Quitar foto', () => {
          sesion.ponerFoto(null);
          cerrarHoja();
          void sincronizarBorrador(); // sin foto pendiente, el borrador se descarta
        }),
      );
    } else {
      partes.push(
        opcion('📸 Tomar foto', () => {
          void abrirSelector(selector.tomar);
          cerrarHoja();
        }),
        opcion('🖼️ Elegir de la galería', () => {
          void abrirSelector(selector.galeria);
          cerrarHoja();
        }),
      );
    }
    partes.push(cancelar);
    hojaPanel.replaceChildren(botonAtras(), ...partes);
    mostrarHoja();
  }

  chipFoto.addEventListener('click', (e) => {
    sinFoco(e);
    abrirHojaFoto();
  });

  // ---------- Teclado físico ----------
  document.addEventListener('keydown', (e) => {
    if (root.hidden || !hoja.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    const accion = aplicarTeclaFisica(sesion, e.key);
    if (accion === null) return;
    e.preventDefault(); // también evita que Enter active un botón con foco
    if (accion === 'monto') {
      pintarMonto();
      programarBorrador();
    } else if (accion === 'deseleccionar') {
      pintarSeleccion();
      programarBorrador();
    } else if (accion === 'guardar' && !e.repeat) {
      void intentarGuardar(); // igual que el botón: guarda o dice qué falta
    }
  });

  // Mantiene el chip al día (reinicio por inactividad / cambio de día).
  window.setInterval(pintarFecha, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pintarFecha();
  });

  async function activar(): Promise<void> {
    const predeterminadaPrevia = config.predeterminada;
    config = await cargarConfigMonedas(repoAjustes);
    cuentas = await db.cuentas.toArray();
    catalogo = await db.categorias.toArray();
    const estado = await cargarEstadoCuentas(repoAjustes, cuentas);
    const cambioPredeterminada = estado.predeterminada !== cuentaPredeterminada;
    cuentaPredeterminada = estado.predeterminada;
    // Si Ajustes cambió la predeterminada, Registrar pasa a ella; y lo mismo si archivó o borró la cuenta en uso.
    const vigente = cambioPredeterminada
      ? cuentaPredeterminada
      : resolverCuentaActual(sesion.cuentaId, cuentas, cuentaPredeterminada);
    if (vigente !== sesion.cuentaId) {
      sesion.cuentaId = vigente;
      void persistirCuenta();
    }
    pintarCuenta();
    // Guardado rápido (Ajustes): sin selección; el botón Guardar se oculta.
    sesion.guardadoRapido = guardadoRapidoActivo(await repoAjustes.get('guardadoRapido'));
    if (sesion.guardadoRapido) sesion.deseleccionar();
    // Si Ajustes ocultó la categoría seleccionada (o archivó la cuenta), se quita con aviso.
    const quitada = sesion.quitarSiNoVisible(idsVisibles(sesion.cuentaId));
    pintarCategorias();
    if (quitada) avisarSeleccionQuitada(quitada);
    // Si Ajustes cambió la moneda predeterminada, Registrar pasa a ella (igual que con la cuenta); y lo mismo
    // si ocultó la moneda en uso. Con aviso si la nueva moneda pierde decimales.
    const monedaVigente = resolverMonedaAlActivar(sesion.moneda, config, predeterminadaPrevia);
    if (monedaVigente !== sesion.moneda) aplicarMoneda(monedaVigente);
    else pintarMoneda();
    await actualizarRecordatorio();
  }

  // Recupera el gasto en curso si la app se cerró o recargó mientras se tomaba la foto (menos de 15 min).
  try {
    const rec = await leerBorrador(repoBorrador, Date.now());
    if (rec) {
      sesion.restaurar(rec.borrador, config.visibles, cuentasActivas(cuentas).map((c) => c.id), idsVisibles);
      if (rec.foto) {
        sesion.ponerFoto(rec.foto);
        fotoPersistida = rec.foto;
      }
      hayBorrador = true;
      mostrarAviso(avisoRecuperacion(rec));
      void sincronizarBorrador(); // sin foto el borrador se descarta; con foto sigue vigente (ya sin la marca de espera)
    }
  } catch (e) {
    mostrarError(`No se pudo recuperar el gasto en curso: ${mensajeErrorAlmacenamiento(e)}`);
  }

  pintarMonto();
  pintarFecha();
  pintarMoneda();
  pintarCuenta();
  pintarNota();
  pintarFoto();
  pintarCategorias();
  void actualizarRecordatorio();
  return { el: root, activar };
}
