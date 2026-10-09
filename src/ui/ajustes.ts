import { db, modificarCatalogo, repoAjustes } from '../db';
import {
  borrarCategoria,
  capturarPrevia,
  crearCategoria,
  deshacerVisibilidad,
  editarCategoria,
  EMOJI_CATEGORIA_POR_DEFECTO,
  idsIniciales,
  idsVisibles,
  MAX_NOMBRE_CATEGORIA,
  MAX_VISIBLES,
  moverEnCuenta,
  mostrarEnCatalogo,
  mostrarEnCuenta,
  ocultarDelCatalogo,
  ocultarEnCuenta,
  textoOcultaEnCuenta,
  textoOcultaEnTodas,
  type EstadoCatalogo,
  type PreviaVisibilidad,
  type ResultadoCatalogo,
} from '../lib/categorias';
import { generarUuid, mensajeDeError } from '../lib/compat';
import { modoReciboActivo } from '../lib/fotos';
import {
  archivarCuenta,
  borrarCuenta,
  cargarEstadoCuentas,
  crearCuenta,
  cuentasActivas,
  desarchivarCuenta,
  editarCuenta,
  etiquetaCuenta,
  guardarCuentaPredeterminada,
  guardarUltimaCuenta,
  MAX_NOMBRE_CUENTA,
  moverCuenta,
  ordenadas,
  validarPredeterminada,
  type ResultadoCuentas,
} from '../lib/cuentas';
import {
  alternarVisible,
  cargarConfigMonedas,
  elegirPredeterminada,
  guardarConfigMonedas,
  guardarUltimaMoneda,
  separarMonedas,
  type ConfigMonedas,
  type ResultadoConfig,
} from '../lib/monedas';
import type { Capa } from '../lib/navegacion';
import type { Categoria, Cuenta } from '../types';
import { mostrarAviso, mostrarError } from './avisos';
import { crearSeccionExportar } from './exportar';
import { botonAtras, confirmarAccion, navegacion } from './navegacion';
import { cerrarTecladoConEnter } from './teclado';

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

/** Ajustes: secciones "Exportar", "Categorías", "Cuentas", "Monedas" y "Fotos" (almacenamiento y respaldo llegan en la Fase 7b). */
export function crearAjustes(): VistaAjustes {
  let config: ConfigMonedas | null = null;
  let cuentas: Cuenta[] = [];
  let cuentaPredeterminada = '';
  let gastosPorCuenta = new Map<string, number>();
  let catalogo: Categoria[] = [];
  let gastosPorCategoria = new Map<string, number>();
  /** Cuenta cuyas categorías se están editando (empieza en la cuenta actual de Registrar). */
  let cuentaCats = '';

  const root = el('section', 'ajustes');
  const seccion = el('div', 'ajustes-seccion');
  const lista = el('div', 'monedas-lista');
  const btnMas = el('button', 'cat-op acordeon-mas');
  btnMas.type = 'button';
  const listaResto = el('div', 'monedas-lista');
  listaResto.hidden = true;
  let masAbierto = false;
  const mensaje = el('p', 'hoja-ayuda');
  mensaje.setAttribute('role', 'status');
  seccion.append(
    el(
      'p',
      'hoja-ayuda',
      'Elige la moneda predeterminada y cuáles aparecen al registrar. La predeterminada siempre está visible.',
    ),
    lista,
    btnMas,
    listaResto,
    mensaje,
  );
  btnMas.addEventListener('click', () => {
    masAbierto = !masAbierto;
    pintar();
  });

  // ---------- Sección Cuentas ----------
  const seccionCuentas = el('div', 'ajustes-seccion');
  const listaCuentas = el('div', 'monedas-lista');
  const mensajeCuentas = el('p', 'hoja-ayuda');
  mensajeCuentas.setAttribute('role', 'status');
  const btnNueva = el('button', 'btn-primario', 'Nueva cuenta');
  btnNueva.type = 'button';
  seccionCuentas.append(
    el(
      'p',
      'hoja-ayuda',
      'Una cuenta es un libro separado de gastos (Personal, Hogar, Negocio…). Solo sirve para registrar y consultar por separado. Una cuenta con gastos no se borra, solo se archiva.',
    ),
    listaCuentas,
    mensajeCuentas,
    btnNueva,
  );

  // ---------- Sección Categorías ----------
  const seccionCategorias = el('div', 'ajustes-seccion');
  const bloqueCuentaCats = el('div', 'edit-seccion');
  const selCuentaCats = el('select', 'filtro-categoria');
  selCuentaCats.setAttribute('aria-label', 'Categorías de la cuenta');
  bloqueCuentaCats.append(el('p', 'edit-titulo', 'Categorías de'), selCuentaCats);
  const resumenCats = el('p', 'exportar-resumen');
  const listaCats = el('div', 'monedas-lista');
  const mensajeCats = el('p', 'hoja-ayuda');
  mensajeCats.setAttribute('role', 'status');
  const btnNuevaCat = el('button', 'btn-primario', 'Nueva categoría');
  btnNuevaCat.type = 'button';
  seccionCategorias.append(
    el(
      'p',
      'hoja-ayuda',
      'Las categorías son las mismas en todas las cuentas; cada cuenta elige cuáles muestra en Registrar (máximo 12, para que quepan sin scroll) y en qué orden. Renombrar, cambiar el emoji, ocultar o borrar una categoría afecta a todas las cuentas.',
    ),
    bloqueCuentaCats,
    resumenCats,
    listaCats,
    mensajeCats,
    btnNuevaCat,
  );
  selCuentaCats.addEventListener('change', () => {
    cuentaCats = selCuentaCats.value;
    mensajeCats.textContent = '';
    pintarCategorias();
  });

  // ---------- Sección Fotos ----------
  const seccionFotos = el('div', 'ajustes-seccion');
  const btnModoRecibo = el('button', 'cat-op fila-interruptor');
  btnModoRecibo.type = 'button';
  btnModoRecibo.setAttribute('role', 'switch');
  seccionFotos.append(
    el(
      'p',
      'hoja-ayuda',
      'Modo recibo: guarda la foto en escala de grises y con un poco más de contraste, para que se lean mejor los montos y el texto con menos peso. Desactívalo si prefieres fotos a color. Solo afecta a las fotos nuevas.',
    ),
    btnModoRecibo,
  );
  let modoRecibo = true;

  function pintarModoRecibo(): void {
    btnModoRecibo.textContent = modoRecibo ? 'Modo recibo: activado' : 'Modo recibo: desactivado (a color)';
    btnModoRecibo.setAttribute('aria-checked', String(modoRecibo));
    btnModoRecibo.setAttribute('aria-pressed', String(modoRecibo));
  }

  btnModoRecibo.addEventListener('click', async () => {
    const nuevo = !modoRecibo;
    try {
      await repoAjustes.set('modoRecibo', nuevo);
    } catch (e) {
      mostrarError(`No se pudo guardar el modo recibo: ${mensajeDeError(e)}`);
      return;
    }
    modoRecibo = nuevo;
    pintarModoRecibo();
  });

  const hoja = el('div', 'hoja');
  hoja.hidden = true;
  const hojaPanel = el('div', 'hoja-panel');
  hoja.append(hojaPanel);
  let capaHoja: Capa | null = null;
  let hayCambiosHoja: (() => boolean) | undefined;
  function ocultarHoja(): void {
    capaHoja = null;
    hayCambiosHoja = undefined;
    hoja.hidden = true;
  }
  /** Cierra la hoja sin preguntar (tras guardar). Atrás, Cancelar y tocar fuera usan navegacion.atras(). */
  function cerrarHoja(): void {
    if (capaHoja) capaHoja.cerrar();
    else ocultarHoja();
  }
  /** Muestra la hoja ya armada y la registra en la pila: el Atrás de Android la cierra. */
  function mostrarHoja(hayCambios?: () => boolean): void {
    hayCambiosHoja = hayCambios;
    hoja.hidden = false;
    hojaPanel.scrollTop = 0;
    capaHoja = navegacion.abrir({ cerrar: ocultarHoja, hayCambios: () => hayCambiosHoja?.() ?? false });
  }
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) navegacion.atras();
  });

  const exportar = crearSeccionExportar();

  // Secciones plegables, Exportar primero; solo una abierta a la vez.
  const cabeceras: { boton: HTMLButtonElement; cuerpo: HTMLElement }[] = [];
  function abrirSeccion(abierta: HTMLElement | null): void {
    for (const c of cabeceras) {
      const abre = c.cuerpo === abierta;
      c.cuerpo.hidden = !abre;
      c.boton.setAttribute('aria-expanded', String(abre));
      c.boton.querySelector('.acordeon-flecha')!.textContent = abre ? '▲' : '▼';
    }
  }
  function plegable(titulo: string, cuerpo: HTMLElement): HTMLElement {
    const grupo = el('div', 'acordeon');
    const boton = el('button', 'acordeon-cabecera');
    boton.type = 'button';
    boton.append(el('span', '', titulo), el('span', 'acordeon-flecha'));
    cuerpo.hidden = true;
    boton.addEventListener('click', () => {
      abrirSeccion(cuerpo.hidden ? cuerpo : null);
      if (!cuerpo.hidden) boton.scrollIntoView?.({ block: 'start' });
    });
    cabeceras.push({ boton, cuerpo });
    grupo.append(boton, cuerpo);
    return grupo;
  }

  root.append(
    plegable('Exportar', exportar.el),
    plegable('Categorías', seccionCategorias),
    plegable('Cuentas', seccionCuentas),
    plegable('Monedas', seccion),
    plegable('Fotos', seccionFotos),
    hoja,
    el('p', 'pronto-resto', 'Almacenamiento y respaldo: próximamente'),
  );

  /** Dice por qué se bloqueó una acción: en línea y en el aviso fijo de arriba (siempre a la vista). */
  function avisarRegla(destino: HTMLElement, texto: string): void {
    destino.textContent = texto;
    mostrarAviso(texto);
  }

  // ---------- Monedas ----------
  async function aplicar(r: ResultadoConfig, nuevaPredeterminada: boolean): Promise<void> {
    if (!r.ok) {
      avisarRegla(mensaje, r.error);
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
    const filaMoneda = (m: { codigo: string; nombre: string }): HTMLElement => {
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
      btnPred.addEventListener('click', () => {
        if (esPred) avisarRegla(mensaje, `${m.codigo} ya es la moneda predeterminada. Para cambiarla, elige otra moneda.`);
        else void aplicar(elegirPredeterminada(c, m.codigo), true);
      });

      fila.append(btnVisible, btnPred);
      return fila;
    };
    const { principales, resto } = separarMonedas(c);
    lista.replaceChildren(...principales.map(filaMoneda));
    listaResto.replaceChildren(...resto.map(filaMoneda));
    btnMas.hidden = resto.length === 0;
    btnMas.textContent = `${masAbierto ? '▲' : '▼'} Más monedas (${resto.length})`;
    btnMas.setAttribute('aria-expanded', String(masAbierto));
    listaResto.hidden = !masAbierto || resto.length === 0;
  }

  // ---------- Categorías ----------
  async function leerCategorias(): Promise<void> {
    catalogo = await db.categorias.orderBy('orden').toArray();
    const conteos = await Promise.all(
      catalogo.map(async (c) => [c.id, await db.gastos.where('categoriaId').equals(c.id).count()] as const),
    );
    gastosPorCategoria = new Map(conteos);
    pintarCategorias();
  }

  /**
   * Aplica un cambio al catálogo (una sola transacción). Si una regla lo impide, lo dice en pantalla y
   * devuelve su error; si se guardó devuelve null.
   */
  async function aplicarCategorias(
    operar: (estado: EstadoCatalogo, totalGastos: number) => ResultadoCatalogo,
    contarGastosDe?: string,
  ): Promise<string | null> {
    let r: ResultadoCatalogo;
    try {
      r = await modificarCatalogo(operar, contarGastosDe);
    } catch (e) {
      mostrarError(`No se pudo guardar las categorías: ${mensajeDeError(e)}`);
      return 'No se pudo guardar las categorías.';
    }
    if (!r.ok) {
      avisarRegla(mensajeCats, r.error);
      return r.error;
    }
    mensajeCats.textContent = r.aviso ?? '';
    if (r.aviso) mostrarAviso(r.aviso);
    try {
      cuentas = await db.cuentas.toArray();
      await leerCategorias();
    } catch (e) {
      mostrarError(`No se pudo actualizar la lista de categorías: ${mensajeDeError(e)}`);
    }
    return null;
  }

  // ---- Aviso "… Deshacer" al ocultar (en una cuenta o en todas): nunca queda sin respuesta visible ----
  const avisoDeshacer = el('div', 'toast');
  avisoDeshacer.hidden = true;
  avisoDeshacer.setAttribute('role', 'status');
  const avisoDeshacerTexto = el('span');
  const avisoDeshacerBtn = el('button', 'toast-btn', 'Deshacer');
  avisoDeshacerBtn.type = 'button';
  avisoDeshacer.append(avisoDeshacerTexto, avisoDeshacerBtn);
  root.append(avisoDeshacer);
  let avisoDeshacerTimer: number | undefined;
  const DESHACER_OCULTAR_MS = 8000;

  function ocultarAvisoDeshacer(): void {
    window.clearTimeout(avisoDeshacerTimer);
    avisoDeshacer.hidden = true;
    avisoDeshacerBtn.onclick = null;
  }

  function mostrarAvisoDeshacer(texto: string, previa: PreviaVisibilidad): void {
    window.clearTimeout(avisoDeshacerTimer);
    avisoDeshacerTexto.textContent = texto;
    avisoDeshacer.hidden = false;
    avisoDeshacerBtn.onclick = async () => {
      ocultarAvisoDeshacer();
      // Devuelve la visibilidad y el orden de cada cuenta tal como estaban antes de ocultar.
      const motivo = await aplicarCategorias((e) => deshacerVisibilidad(e, previa));
      if (motivo === null) mostrarAviso('Se restauró la visibilidad de la categoría.');
    };
    avisoDeshacerTimer = window.setTimeout(ocultarAvisoDeshacer, DESHACER_OCULTAR_MS);
  }

  /**
   * Oculta una categoría solo en la cuenta seleccionada (`enTodas` = false) o en todo el catálogo, sin pedir
   * confirmación, y lo dice con un aviso que permite deshacer. Devuelve el error de la regla, o null si se ocultó.
   */
  async function ocultarConDeshacer(c: Categoria, enTodas: boolean): Promise<string | null> {
    const cuenta = cuentas.find((x) => x.id === cuentaCats);
    const previa: { valor: PreviaVisibilidad | null } = { valor: null };
    const total = gastosPorCategoria.get(c.id) ?? 0;
    const motivo = await aplicarCategorias((e) => {
      previa.valor = capturarPrevia(e, c.id, enTodas ? null : cuentaCats);
      return enTodas ? ocultarDelCatalogo(e, c.id) : ocultarEnCuenta(e, cuentaCats, c.id);
    });
    if (motivo === null && previa.valor) {
      mostrarAvisoDeshacer(
        enTodas ? textoOcultaEnTodas(c.nombre, total) : textoOcultaEnCuenta(c.nombre, cuenta?.nombre ?? 'esta cuenta'),
        previa.valor,
      );
    }
    return motivo;
  }

  function pintarCategorias(): void {
    const activas = cuentasActivas(cuentas);
    if (!activas.some((c) => c.id === cuentaCats)) cuentaCats = activas[0]?.id ?? '';
    bloqueCuentaCats.hidden = activas.length <= 1;
    selCuentaCats.replaceChildren(...activas.map((c) => new Option(etiquetaCuenta(c), c.id)));
    selCuentaCats.value = cuentaCats;

    const cuenta = cuentas.find((c) => c.id === cuentaCats);
    const ids = idsVisibles(cuenta, catalogo);
    const porId = new Map(catalogo.map((c) => [c.id, c]));
    const visibles = ids.map((id) => porId.get(id)).filter((c): c is Categoria => c !== undefined);
    const resto = catalogo.filter((c) => c.activa && !ids.includes(c.id));
    const fueraDelCatalogo = catalogo.filter((c) => !c.activa);
    const nombreCuenta = cuenta && activas.length > 1 ? ` en ${cuenta.nombre}` : '';
    resumenCats.textContent = `Visibles en Registrar${nombreCuenta}: ${visibles.length} de ${MAX_VISIBLES}`;

    const fila = (c: Categoria, posicion: number | null): HTMLElement => {
      const n = gastosPorCategoria.get(c.id) ?? 0;
      const f = el('div', 'moneda-fila');
      const nota = c.activa ? '' : ' · oculta del catálogo';
      f.append(el('span', 'moneda-nombre', `${c.emoji} ${c.nombre}${nota}`));
      f.append(el('span', 'hoja-ayuda cuenta-total', n === 1 ? '1 gasto' : `${n} gastos`));
      if (c.activa) {
        const visible = posicion !== null;
        if (visible) {
          const sube = el('button', 'cat-op', '▲ Subir');
          sube.type = 'button';
          sube.setAttribute('aria-label', `Subir ${c.nombre}`);
          sube.addEventListener('click', () => void aplicarCategorias((e) => moverEnCuenta(e, cuentaCats, c.id, -1)));
          const baja = el('button', 'cat-op', '▼ Bajar');
          baja.type = 'button';
          baja.setAttribute('aria-label', `Bajar ${c.nombre}`);
          baja.addEventListener('click', () => void aplicarCategorias((e) => moverEnCuenta(e, cuentaCats, c.id, 1)));
          f.append(sube, baja);
        }
        const nombreCuenta = cuenta?.nombre ?? 'la cuenta';
        const alterna = el('button', 'cat-op', visible ? `Visible en ${nombreCuenta}` : `Oculta en ${nombreCuenta}`);
        alterna.type = 'button';
        alterna.setAttribute('aria-pressed', String(visible));
        alterna.setAttribute('aria-label', `${c.nombre}: ${visible ? 'visible' : 'oculta'} en ${nombreCuenta}. Toca para ${visible ? 'ocultarla' : 'mostrarla'} solo en esta cuenta`);
        alterna.addEventListener('click', () => {
          if (visible) void ocultarConDeshacer(c, false);
          else void aplicarCategorias((e) => mostrarEnCuenta(e, cuentaCats, c.id));
        });
        f.append(alterna);
      }
      const editar = el('button', 'cat-op', '✏️ Editar');
      editar.type = 'button';
      editar.setAttribute('aria-label', `Editar ${c.nombre}`);
      editar.addEventListener('click', () => abrirHojaCategoria(c));
      f.append(editar);
      return f;
    };
    listaCats.replaceChildren(
      ...visibles.map((c, i) => fila(c, i)),
      ...resto.map((c) => fila(c, null)),
      ...fueraDelCatalogo.map((c) => fila(c, null)),
    );
  }

  /** Hoja para crear (c = null) o editar una categoría del catálogo. */
  function abrirHojaCategoria(c: Categoria | null): void {
    const cuentaDestino = cuentas.find((x) => x.id === cuentaCats);
    const titulo = el('h2', 'hoja-titulo', c ? 'Editar categoría' : 'Nueva categoría');
    const aviso = el('p', 'hoja-ayuda aviso-http', 'Afecta a todas las cuentas.');
    const detalle = el(
      'p',
      'hoja-ayuda',
      c
        ? `Tiene ${gastosPorCategoria.get(c.id) ?? 0} gastos en total. Renombrarla no cambia los gastos; en Google Sheets, las filas ya importadas conservan el nombre anterior.`
        : `Se mostrará en ${cuentaDestino?.nombre ?? 'esta cuenta'} (si hay lugar) y quedará oculta en las demás cuentas.`,
    );
    const iEmoji = el('input', 'nota-input');
    iEmoji.type = 'text';
    iEmoji.maxLength = 8;
    iEmoji.autocomplete = 'off';
    iEmoji.placeholder = `Emoji (vacío = ${EMOJI_CATEGORIA_POR_DEFECTO})`;
    iEmoji.value = c?.emoji ?? '';
    iEmoji.setAttribute('aria-label', 'Emoji de la categoría');
    cerrarTecladoConEnter(iEmoji);
    const iNombre = el('input', 'nota-input');
    iNombre.type = 'text';
    iNombre.maxLength = MAX_NOMBRE_CATEGORIA;
    iNombre.autocomplete = 'off';
    iNombre.placeholder = 'Nombre (ej. Mascotas)';
    iNombre.value = c?.nombre ?? '';
    iNombre.setAttribute('aria-label', 'Nombre de la categoría');
    cerrarTecladoConEnter(iNombre);

    const error = el('p', 'hoja-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const guardar = el('button', 'btn-primario', c ? 'Guardar cambios' : 'Crear categoría');
    guardar.type = 'button';
    const cancelar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', () => navegacion.atras());

    /** Ejecuta la operación; si una regla la bloquea, la hoja sigue abierta con el motivo. */
    const ejecutar = async (
      operar: (estado: EstadoCatalogo, total: number) => ResultadoCatalogo,
      contarGastosDe?: string,
    ): Promise<void> => {
      const motivo = await aplicarCategorias(operar, contarGastosDe);
      if (motivo === null) {
        cerrarHoja();
        return;
      }
      error.textContent = motivo;
      error.hidden = false;
    };

    guardar.addEventListener('click', () =>
      void ejecutar((estado) =>
        c
          ? editarCategoria(estado, c.id, { nombre: iNombre.value, emoji: iEmoji.value })
          : crearCategoria(estado, iNombre.value, iEmoji.value, generarUuid(), cuentaCats),
      ),
    );

    // Guardar queda fijo al borde inferior de la hoja: visible aunque el teclado esté abierto.
    const pie = el('div', 'hoja-pie');
    pie.append(error, guardar);
    const partes: HTMLElement[] = [titulo, aviso, detalle, iEmoji, iNombre, pie];

    if (c) {
      const alternaCatalogo = el('button', 'hoja-op', c.activa ? 'Ocultar en todas las cuentas' : 'Mostrar en el catálogo');
      alternaCatalogo.type = 'button';
      alternaCatalogo.addEventListener('click', async () => {
        if (!c.activa) {
          await ejecutar((estado) => mostrarEnCatalogo(estado, c.id, cuentaCats));
          return;
        }
        const motivo = await ocultarConDeshacer(c, true);
        if (motivo === null) {
          cerrarHoja();
          return;
        }
        error.textContent = motivo;
        error.hidden = false;
      });
      const ayudaCatalogo = el(
        'p',
        'hoja-ayuda',
        c.activa
          ? 'Ocultarla la quita de todas las cuentas; sus gastos la conservan y siguen en Historial. Puedes deshacerlo al instante o volver a mostrarla después. Para ocultarla solo en una cuenta, usa el interruptor "Visible en …" de la lista.'
          : 'Está oculta del catálogo. Al mostrarla vuelve a la cuenta que estás editando (si hay lugar).',
      );
      const borrar = el('button', 'btn-peligro', 'Eliminar categoría');
      borrar.type = 'button';
      borrar.addEventListener('click', async () => {
        if ((gastosPorCategoria.get(c.id) ?? 0) > 0) {
          const motivo = `${c.nombre} tiene gastos y no se puede borrar. Ocúltala del catálogo en su lugar.`;
          error.textContent = motivo;
          error.hidden = false;
          mostrarAviso(motivo);
          return;
        }
        if (!(await confirmarAccion(`¿Eliminar ${c.nombre} de todas las cuentas?`, 'Eliminar'))) return;
        await ejecutar((estado, n) => borrarCategoria(estado, c.id, n), c.id);
      });
      partes.push(alternaCatalogo, ayudaCatalogo, borrar);
    }
    partes.push(cancelar);
    hojaPanel.replaceChildren(botonAtras(), ...partes);
    mostrarHoja(() => iEmoji.value.trim() !== (c?.emoji ?? '') || iNombre.value.trim() !== (c?.nombre ?? ''));
  }

  btnNuevaCat.addEventListener('click', () => abrirHojaCategoria(null));

  // ---------- Cuentas ----------
  async function leerCuentas(): Promise<void> {
    cuentas = await db.cuentas.toArray();
    cuentaPredeterminada = (await cargarEstadoCuentas(repoAjustes, cuentas)).predeterminada;
    const conteos = await Promise.all(
      cuentas.map(async (c) => [c.id, await db.gastos.where('cuentaId').equals(c.id).count()] as const),
    );
    gastosPorCuenta = new Map(conteos);
    pintarCuentas();
    pintarCategorias();
  }

  /** Guarda el resultado de una regla; si no se cumple, lo dice en pantalla. Devuelve true si se guardó. */
  async function aplicarCuentas(r: ResultadoCuentas, despues?: () => Promise<void>): Promise<boolean> {
    if (!r.ok) {
      avisarRegla(mensajeCuentas, r.error);
      return false;
    }
    try {
      await db.cuentas.bulkPut(r.cuentas);
      await despues?.();
      mensajeCuentas.textContent = '';
      await leerCuentas();
    } catch (e) {
      mostrarError(`No se pudo guardar las cuentas: ${mensajeDeError(e)}`);
      return false;
    }
    return true;
  }

  async function archivar(c: Cuenta): Promise<void> {
    await aplicarCuentas(archivarCuenta(cuentas, c.id, cuentaPredeterminada), async () => {
      // Si Registrar estaba en esta cuenta, recuerda la predeterminada (Registrar también lo comprueba al abrirse).
      if ((await repoAjustes.get('ultimaCuenta')) === c.id) await guardarUltimaCuenta(repoAjustes, cuentaPredeterminada);
    });
  }

  async function predeterminar(c: Cuenta): Promise<void> {
    const v = validarPredeterminada(cuentas, c.id, cuentaPredeterminada);
    if (!v.ok) {
      avisarRegla(mensajeCuentas, v.error);
      return;
    }
    try {
      await guardarCuentaPredeterminada(repoAjustes, c.id);
      // Registrar también pasa a la nueva predeterminada, igual que con la moneda.
      await guardarUltimaCuenta(repoAjustes, c.id);
      mensajeCuentas.textContent = '';
      await leerCuentas();
    } catch (e) {
      mostrarError(`No se pudo guardar la cuenta predeterminada: ${mensajeDeError(e)}`);
    }
  }

  /** Borra la cuenta si las reglas lo permiten. Devuelve el error de la regla, o null si se borró. */
  async function eliminar(c: Cuenta): Promise<string | null> {
    try {
      // El conteo y el borrado van en una transacción: un gasto nuevo no se cuela entre los dos.
      const resultado = await db.transaction('rw', db.cuentas, db.gastos, async () => {
        const total = await db.gastos.where('cuentaId').equals(c.id).count();
        const r = borrarCuenta(cuentas, c.id, cuentaPredeterminada, total);
        if (r.ok) {
          await db.cuentas.delete(c.id);
          await db.cuentas.bulkPut(r.cuentas);
        }
        return r;
      });
      if (!resultado.ok) return resultado.error;
      mensajeCuentas.textContent = '';
      await leerCuentas();
      return null;
    } catch (e) {
      mostrarError(`No se pudo borrar la cuenta: ${mensajeDeError(e)}`);
      return 'No se pudo borrar la cuenta.';
    }
  }

  /** Hoja para crear (c = null) o editar una cuenta. */
  function abrirHojaCuenta(c: Cuenta | null): void {
    const titulo = el('h2', 'hoja-titulo', c ? 'Editar cuenta' : 'Nueva cuenta');
    const iEmoji = el('input', 'nota-input');
    iEmoji.type = 'text';
    iEmoji.maxLength = 8;
    iEmoji.autocomplete = 'off';
    iEmoji.placeholder = 'Emoji (ej. 🏠)';
    iEmoji.value = c?.emoji ?? '';
    iEmoji.setAttribute('aria-label', 'Emoji de la cuenta');
    cerrarTecladoConEnter(iEmoji);
    const iNombre = el('input', 'nota-input');
    iNombre.type = 'text';
    iNombre.maxLength = MAX_NOMBRE_CUENTA;
    iNombre.autocomplete = 'off';
    iNombre.placeholder = 'Nombre (ej. Hogar)';
    iNombre.value = c?.nombre ?? '';
    iNombre.setAttribute('aria-label', 'Nombre de la cuenta');
    cerrarTecladoConEnter(iNombre);

    const error = el('p', 'hoja-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const guardar = el('button', 'btn-primario', c ? 'Guardar cambios' : 'Crear cuenta');
    guardar.type = 'button';
    const cancelar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', () => navegacion.atras());

    guardar.addEventListener('click', async () => {
      const r = c
        ? editarCuenta(cuentas, c.id, { nombre: iNombre.value, emoji: iEmoji.value })
        : crearCuenta(cuentas, iNombre.value, iEmoji.value, generarUuid(), idsIniciales(catalogo));
      if (!r.ok) {
        error.textContent = r.error;
        error.hidden = false;
        return;
      }
      if (await aplicarCuentas(r)) cerrarHoja(); // si falla, la hoja sigue abierta con lo escrito
    });

    // Guardar queda fijo al borde inferior de la hoja: visible aunque el teclado esté abierto.
    const pie = el('div', 'hoja-pie');
    pie.append(error, guardar);
    const partes: HTMLElement[] = [titulo, iEmoji, iNombre, pie];

    if (c) {
      const borrar = el('button', 'btn-peligro', 'Eliminar cuenta');
      borrar.type = 'button';
      borrar.addEventListener('click', async () => {
        const motivo = await eliminar(c);
        if (motivo === null) {
          cerrarHoja();
          return;
        }
        error.textContent = motivo;
        error.hidden = false;
        mostrarAviso(motivo);
      });
      partes.push(borrar);
    }
    partes.push(cancelar);
    hojaPanel.replaceChildren(botonAtras(), ...partes);
    mostrarHoja(() => iEmoji.value.trim() !== (c?.emoji ?? '') || iNombre.value.trim() !== (c?.nombre ?? ''));
  }

  btnNueva.addEventListener('click', () => abrirHojaCuenta(null));

  function pintarCuentas(): void {
    listaCuentas.replaceChildren(
      ...ordenadas(cuentas).map((c) => {
        const esPred = c.id === cuentaPredeterminada;
        const n = gastosPorCuenta.get(c.id) ?? 0;
        const fila = el('div', 'moneda-fila');
        const etiquetas = [esPred ? 'predeterminada' : '', c.archivada ? 'archivada' : ''].filter(Boolean).join(' · ');
        fila.append(el('span', 'moneda-nombre', `${etiquetaCuenta(c)}${etiquetas ? ` · ${etiquetas}` : ''}`));
        fila.append(el('span', 'hoja-ayuda cuenta-total', n === 1 ? '1 gasto' : `${n} gastos`));

        const btnSube = el('button', 'cat-op', '▲ Subir');
        btnSube.type = 'button';
        btnSube.setAttribute('aria-label', `Subir ${c.nombre}`);
        btnSube.addEventListener('click', () => void aplicarCuentas(moverCuenta(cuentas, c.id, -1)));
        const btnBaja = el('button', 'cat-op', '▼ Bajar');
        btnBaja.type = 'button';
        btnBaja.setAttribute('aria-label', `Bajar ${c.nombre}`);
        btnBaja.addEventListener('click', () => void aplicarCuentas(moverCuenta(cuentas, c.id, 1)));

        const btnEditar = el('button', 'cat-op', '✏️ Editar');
        btnEditar.type = 'button';
        btnEditar.setAttribute('aria-label', `Editar ${c.nombre}`);
        btnEditar.addEventListener('click', () => abrirHojaCuenta(c));

        const btnPred = el('button', 'cat-op', esPred ? 'Predeterminada' : 'Predeterminar');
        btnPred.type = 'button';
        btnPred.setAttribute('aria-pressed', String(esPred));
        btnPred.addEventListener('click', () => void predeterminar(c));

        const btnArchivo = el('button', 'cat-op', c.archivada ? 'Desarchivar' : 'Archivar');
        btnArchivo.type = 'button';
        btnArchivo.addEventListener('click', () => {
          if (c.archivada) void aplicarCuentas(desarchivarCuenta(cuentas, c.id));
          else void archivar(c);
        });

        fila.append(btnSube, btnBaja, btnEditar, btnPred, btnArchivo);
        return fila;
      }),
    );
  }

  async function activar(): Promise<void> {
    if (!cabeceras.some((c) => !c.cuerpo.hidden)) abrirSeccion(exportar.el);
    config = await cargarConfigMonedas(repoAjustes);
    mensaje.textContent = '';
    mensajeCuentas.textContent = '';
    pintar();
    modoRecibo = modoReciboActivo(await repoAjustes.get('modoRecibo'));
    pintarModoRecibo();
    await leerCategorias();
    await leerCuentas();
    cuentaCats = (await cargarEstadoCuentas(repoAjustes, cuentas)).actual; // empieza en la cuenta actual de Registrar
    pintarCategorias();
    mensajeCats.textContent = '';
    await exportar.activar();
  }

  return { el: root, activar };
}
