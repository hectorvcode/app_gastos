import './style.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main class="base">
      <h1>Gastos</h1>
      <p>Base instalable lista. El registro rápido llega en la Fase 2.</p>
    </main>
  `;
}
