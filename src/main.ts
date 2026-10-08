import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { pedirPersistencia, registrarServiceWorker, mensajeDeError } from './lib/compat';
import { instalarManejadorGlobal, mostrarError } from './ui/avisos';
import { crearHistorial } from './ui/historial';
import { crearRegistrar } from './ui/registrar';

instalarManejadorGlobal();

// Sin contexto seguro (http://<IP-LAN>) no hay service worker ni storage: se omiten.
registrarServiceWorker(() => registerSW({ immediate: true }));

// Evita que Chrome borre los datos si el teléfono se queda sin espacio.
void pedirPersistencia();

const TABS = [
  { id: 'registrar', icono: '➕', nombre: 'Registrar' },
  { id: 'historial', icono: '🕒', nombre: 'Historial' },
  { id: 'resumen', icono: '📊', nombre: 'Resumen' },
  { id: 'ajustes', icono: '⚙️', nombre: 'Ajustes' },
] as const;

async function iniciar(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  const vistas = new Map<string, HTMLElement>();
  const contenido = document.createElement('main');
  contenido.className = 'contenido';

  const alMostrar = new Map<string, () => Promise<void>>();

  vistas.set('registrar', await crearRegistrar());
  const historial = crearHistorial(() => mostrar('registrar'));
  vistas.set('historial', historial.el);
  alMostrar.set('historial', historial.activar);
  for (const t of TABS.filter((x) => x.id !== 'registrar' && x.id !== 'historial')) {
    const v = document.createElement('section');
    v.className = 'pronto';
    v.textContent = `${t.nombre}: próximamente`;
    vistas.set(t.id, v);
  }
  contenido.append(...vistas.values());

  const nav = document.createElement('nav');
  nav.className = 'tabs';
  const botones = new Map<string, HTMLButtonElement>();

  function mostrar(id: string): void {
    for (const [vid, v] of vistas) v.hidden = vid !== id;
    for (const [bid, b] of botones) b.setAttribute('aria-current', String(bid === id));
    // Al abrir una pestaña con datos se vuelven a leer (sin recargar la página).
    void alMostrar.get(id)?.().catch((e) => mostrarError(`No se pudo abrir la pantalla: ${mensajeDeError(e)}`));
  }


  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.innerHTML = `<span class="tab-icono">${t.icono}</span><span>${t.nombre}</span>`;
    b.addEventListener('click', () => mostrar(t.id));
    botones.set(t.id, b);
    nav.append(b);
  }

  app.replaceChildren(contenido, nav);
  mostrar('registrar');
}

iniciar().catch((e) => mostrarError(`No se pudo iniciar la app: ${mensajeDeError(e)}`));
