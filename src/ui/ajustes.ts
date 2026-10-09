import { db, repoAjustes } from '../db';
import { generarUuid, mensajeDeError } from '../lib/compat';
import { modoReciboActivo } from '../lib/fotos';
import {
  archivarCuenta,
  borrarCuenta,
  cargarEstadoCuentas,
  crearCuenta,
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
import type { Cuenta } from '../types';
import { mostrarAviso, mostrarError } from './avisos';
import { crearSeccionExportar } from './exportar';
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

/** Ajustes: secciones "Monedas", "Cuentas", "Fotos" y "Exportar" (el resto llega en la Fase 7). */
export function crearAjustes(): VistaAjustes {
  let config: ConfigMonedas | null = null;
  let cuentas: Cuenta[] = [];
  let cuentaPredeterminada = '';
  let gastosPorCuenta = new Map<string, number>();

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
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) hoja.hidden = true;
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
    plegable('Cuentas', seccionCuentas),
    plegable('Monedas', seccion),
    plegable('Fotos', seccionFotos),
    hoja,
    el('p', 'pronto-resto', 'Categorías, almacenamiento y respaldo: próximamente'),
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

  // ---------- Cuentas ----------
  async function leerCuentas(): Promise<void> {
    cuentas = await db.cuentas.toArray();
    cuentaPredeterminada = (await cargarEstadoCuentas(repoAjustes, cuentas)).predeterminada;
    const conteos = await Promise.all(
      cuentas.map(async (c) => [c.id, await db.gastos.where('cuentaId').equals(c.id).count()] as const),
    );
    gastosPorCuenta = new Map(conteos);
    pintarCuentas();
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
    cancelar.addEventListener('click', () => (hoja.hidden = true));

    guardar.addEventListener('click', async () => {
      const r = c
        ? editarCuenta(cuentas, c.id, { nombre: iNombre.value, emoji: iEmoji.value })
        : crearCuenta(cuentas, iNombre.value, iEmoji.value, generarUuid());
      if (!r.ok) {
        error.textContent = r.error;
        error.hidden = false;
        return;
      }
      if (await aplicarCuentas(r)) hoja.hidden = true; // si falla, la hoja sigue abierta con lo escrito
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
          hoja.hidden = true;
          return;
        }
        error.textContent = motivo;
        error.hidden = false;
        mostrarAviso(motivo);
      });
      partes.push(borrar);
    }
    partes.push(cancelar);
    hojaPanel.replaceChildren(...partes);
    hoja.hidden = false;
    hojaPanel.scrollTop = 0;
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
    await leerCuentas();
    await exportar.activar();
  }

  return { el: root, activar };
}
