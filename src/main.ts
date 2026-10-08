import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { crearRegistrar } from './ui/registrar';

registerSW({ immediate: true });

// Evita que Chrome borre los datos si el teléfono se queda sin espacio.
void navigator.storage?.persist?.();

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

  vistas.set('registrar', await crearRegistrar());
  for (const t of TABS.slice(1)) {
    const v = document.createElement('section');
    v.className = 'pronto';
    v.textContent = `${t.nombre}: próximamente`;
    vistas.set(t.id, v);
  }
  contenido.append(...vistas.values());

  const nav = document.createElement('nav');
  nav.className = 'tabs';
  const botones = new Map<string, HTMLButtonElement>();

  const mostrar = (id: string): void => {
    for (const [vid, v] of vistas) v.hidden = vid !== id;
    for (const [bid, b] of botones) b.setAttribute('aria-current', String(bid === id));
  };

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

void iniciar();
