import { leerEstadoLocal, leerParaRespaldo, repoAjustes, repoRestauracion } from '../db';
import { mensajeDeError } from '../lib/compat';
import { formatDdMmAaaa, isoAFechaHora } from '../lib/dates';
import { debeAvisarZipHttp, AVISO_ZIP_HTTP, textoDescarga } from '../lib/exportar';
import { esDispositivoMovil } from '../lib/compartir';
import { mensajeErrorAlmacenamiento } from '../lib/fotos';
import type { Capa } from '../lib/navegacion';
import { CLAVE_ULTIMO_RESPALDO, guardarUltimoRespaldo, leerUltimoRespaldo } from '../lib/recordatorio';
import { armarRespaldo, crearDatosRespaldo, ErrorRespaldo, leerRespaldoZip, nombreRespaldo, type RespaldoLeido } from '../lib/respaldo';
import {
  cargarFotos,
  ejecutarRestauracion,
  planificarFusion,
  planVacio,
  textoResultado,
  textoResumen,
  type PlanRestauracion,
} from '../lib/restaurar';
import { mostrarAviso, mostrarError } from './avisos';
import { descargarArchivo } from './descarga';
import { botonAtras, navegacion } from './navegacion';

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

const textoFechaHora = (iso: string): string => {
  const { fecha, hora } = isoAFechaHora(iso);
  return `${formatDdMmAaaa(fecha)} ${hora}`;
};

const cuantos = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export interface SeccionRespaldo {
  el: HTMLElement;
  /** Vuelve a leer la fecha del último respaldo; se llama cada vez que se abre la pestaña. */
  activar(): Promise<void>;
}

/** Ajustes → Respaldo: crear un ZIP con todo (datos y fotos) y restaurarlo fusionando por id. */
export function crearSeccionRespaldo(): SeccionRespaldo {
  let ocupado = false;

  const root = el('div', 'ajustes-seccion');
  root.append(
    el(
      'p',
      'hoja-ayuda',
      'El respaldo guarda todo en un archivo ZIP (gastos, categorías, cuentas, ajustes y las fotos tal como están). Guárdalo también en Drive: si borras los datos de Chrome o cambias de teléfono, es la única copia.',
    ),
  );

  const ultimo = el('p', 'exportar-resumen');
  ultimo.setAttribute('role', 'status');

  const btnCrear = el('button', 'btn-primario', 'Crear respaldo');
  btnCrear.type = 'button';
  const avisoHttp = el('p', 'hoja-ayuda aviso-http', AVISO_ZIP_HTTP);
  avisoHttp.hidden = !debeAvisarZipHttp(window.isSecureContext, 'zip');

  const btnRestaurar = el('button', 'btn-primario', 'Restaurar desde archivo');
  btnRestaurar.type = 'button';
  const ayudaRestaurar = el(
    'p',
    'hoja-ayuda',
    'Elige un respaldo_gastos_….zip. Se fusiona con lo que hay aquí: no se borra nada y, en cada gasto, gana la versión más reciente.',
  );
  // <input type="file"> funciona también por HTTP (sin contexto seguro).
  const archivo = el('input');
  archivo.type = 'file';
  archivo.accept = '.zip,application/zip,application/x-zip-compressed,application/octet-stream';
  archivo.hidden = true;

  const progreso = el('progress', 'exportar-progreso');
  progreso.max = 1;
  progreso.hidden = true;
  const textoProgreso = el('p', 'hoja-ayuda');
  textoProgreso.setAttribute('role', 'status');
  const resultado = el('p', 'exportar-resultado');
  resultado.setAttribute('role', 'status');

  // ---------- Hoja con el resumen previo a restaurar ----------
  const hoja = el('div', 'hoja');
  hoja.hidden = true;
  const hojaPanel = el('div', 'hoja-panel');
  hoja.append(hojaPanel);
  let capaHoja: Capa | null = null;
  function ocultarHoja(): void {
    capaHoja = null;
    hoja.hidden = true;
  }
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) navegacion.atras();
  });

  root.append(btnCrear, avisoHttp, el('hr'), btnRestaurar, ayudaRestaurar, archivo, progreso, textoProgreso, resultado, ultimo, hoja);

  // ---------- Estado ocupado / progreso ----------
  function bloquear(valor: boolean): void {
    ocupado = valor;
    btnCrear.disabled = valor;
    btnRestaurar.disabled = valor;
    if (!valor) {
      progreso.hidden = true;
      textoProgreso.textContent = '';
    }
  }

  /** Sin fracción = indeterminado (barra animada). */
  function mostrarProgreso(texto: string, fraccion?: number): void {
    progreso.hidden = false;
    if (fraccion === undefined) progreso.removeAttribute('value');
    else progreso.value = fraccion;
    textoProgreso.textContent = texto;
  }

  async function pintarUltimo(): Promise<void> {
    const u = leerUltimoRespaldo(await repoAjustes.get(CLAVE_ULTIMO_RESPALDO));
    ultimo.textContent = u
      ? `Último respaldo: ${textoFechaHora(u.fecha)} · ${cuantos(u.gastos, 'gasto', 'gastos')} y ${cuantos(u.fotos, 'foto', 'fotos')}`
      : 'Todavía no has creado un respaldo.';
  }

  // ---------- Crear respaldo ----------
  async function crear(): Promise<void> {
    if (ocupado) return;
    resultado.textContent = '';
    bloquear(true);
    try {
      mostrarProgreso('Leyendo los datos…');
      const ahora = new Date();
      const entrada = await leerParaRespaldo();
      const datos = crearDatosRespaldo(entrada, ahora);
      const conFoto = new Set(entrada.gastos.map((g) => g.fotoId).filter((x): x is string => x !== null));
      const sinFoto = conFoto.size - entrada.fotos.length; // gastos que apuntan a una foto que ya no existe
      const zip = await armarRespaldo(datos, entrada.fotos, (t, f) => mostrarProgreso(t, f));
      const nombre = nombreRespaldo(ahora);
      descargarArchivo(new File([zip], nombre, { type: 'application/zip' }));
      const resumen = `${cuantos(datos.gastos.length, 'gasto', 'gastos')} y ${cuantos(datos.fotos.length, 'foto', 'fotos')}`;
      const faltan = sinFoto > 0 ? ` ${cuantos(sinFoto, 'foto no se encontró', 'fotos no se encontraron')} y quedó fuera.` : '';
      resultado.textContent = `${textoDescarga(nombre, esDispositivoMovil())} Incluye ${resumen}.${faltan}`;
      resultado.scrollIntoView?.({ block: 'nearest' });
      if (faltan) mostrarAviso(faltan.trim());
      try {
        await guardarUltimoRespaldo(repoAjustes, { fecha: ahora.toISOString(), gastos: datos.gastos.length, fotos: datos.fotos.length });
      } catch (e) {
        mostrarError(`El respaldo se descargó, pero no se pudo anotar la fecha: ${mensajeDeError(e)}`);
      }
      await pintarUltimo();
    } catch (e) {
      mostrarError(`No se pudo crear el respaldo: ${mensajeErrorAlmacenamiento(e)}`);
    } finally {
      bloquear(false);
    }
  }

  // ---------- Restaurar ----------
  /** Lee y valida el archivo; si sirve, muestra el resumen con "Restaurar" y "Cancelar". No cambia nada. */
  async function preparar(file: File): Promise<void> {
    if (ocupado) return;
    resultado.textContent = '';
    bloquear(true);
    try {
      mostrarProgreso('Leyendo y validando el archivo…');
      const leido = await leerRespaldoZip(file);
      const plan = planificarFusion(await leerEstadoLocal(), leido.datos);
      bloquear(false);
      if (planVacio(plan)) {
        const texto = `Este respaldo no trae nada nuevo: ${textoResumen(plan)}`;
        resultado.textContent = texto;
        mostrarAviso(texto);
        return;
      }
      abrirResumen(file.name, leido, plan);
    } catch (e) {
      bloquear(false);
      const motivo = e instanceof ErrorRespaldo ? e.message : mensajeErrorAlmacenamiento(e);
      resultado.textContent = `No se pudo restaurar: ${motivo} No se cambió nada.`;
      mostrarError(`No se pudo restaurar: ${motivo} No se cambió nada.`);
    }
  }

  function abrirResumen(nombre: string, leido: RespaldoLeido, plan: PlanRestauracion): void {
    const d = leido.datos;
    const partes: HTMLElement[] = [
      el('h2', 'hoja-titulo', 'Restaurar respaldo'),
      el(
        'p',
        'hoja-ayuda',
        `${nombre} · creado el ${textoFechaHora(d.creadoEn)} · ${cuantos(d.gastos.length, 'gasto', 'gastos')}, ${cuantos(d.fotos.length, 'foto', 'fotos')}`,
      ),
      el('p', 'exportar-resumen', textoResumen(plan)),
      el('p', 'hoja-ayuda', 'No se borra nada de lo que hay aquí. Todo se aplica junto: si algo falla, no queda nada a medias.'),
    ];
    if (leido.fotosAusentes > 0) {
      partes.push(
        el('p', 'hoja-ayuda aviso-http', `${cuantos(leido.fotosAusentes, 'foto declarada', 'fotos declaradas')} en el respaldo no está dentro del ZIP.`),
      );
    }
    const restaurar = el('button', 'btn-primario', 'Restaurar');
    restaurar.type = 'button';
    const cancelar = el('button', 'hoja-op hoja-cerrar', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', () => navegacion.atras());
    restaurar.addEventListener('click', () => {
      capaHoja?.cerrar();
      void aplicar(leido, plan);
    });
    const pie = el('div', 'hoja-pie');
    pie.append(restaurar, cancelar);
    hojaPanel.replaceChildren(botonAtras(), ...partes, pie);
    hoja.hidden = false;
    hojaPanel.scrollTop = 0;
    capaHoja = navegacion.abrir({ cerrar: ocultarHoja });
  }

  async function aplicar(leido: RespaldoLeido, plan: PlanRestauracion): Promise<void> {
    if (ocupado) return;
    bloquear(true);
    try {
      // Mitad de la barra: sacar las fotos del ZIP (fuera de la transacción); mitad: guardar todo en una.
      const fotos = await cargarFotos(plan.fotosAgregar, leido.datos, leido.leerFoto, (t, f) => mostrarProgreso(t, f * 0.5));
      await ejecutarRestauracion(plan, fotos, repoRestauracion, (t, f) => mostrarProgreso(t, 0.5 + f * 0.5));
      const texto = textoResultado(plan);
      resultado.textContent = texto;
      mostrarAviso(texto);
      resultado.scrollIntoView?.({ block: 'nearest' });
    } catch (e) {
      const motivo = e instanceof ErrorRespaldo ? e.message : mensajeErrorAlmacenamiento(e);
      resultado.textContent = `No se pudo restaurar: ${motivo} No se cambió nada.`;
      mostrarError(`No se pudo restaurar: ${motivo} No se cambió nada.`);
    } finally {
      bloquear(false);
    }
  }

  btnCrear.addEventListener('click', () => void crear());
  btnRestaurar.addEventListener('click', () => {
    archivo.value = ''; // permite elegir otra vez el mismo archivo
    archivo.click();
  });
  archivo.addEventListener('change', () => {
    const f = archivo.files?.[0];
    if (f) void preparar(f);
  });

  return { el: root, activar: pintarUltimo };
}
