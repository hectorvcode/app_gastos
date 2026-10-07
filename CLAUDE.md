# App de gastos (PWA)

Especificación completa en `SPEC.md`. Este archivo resume las decisiones clave.

## Reglas de trabajo (obligatorias)
- **Nunca ejecutar `git commit` ni `git push`.** Al cerrar cada fase se entrega un mensaje de commit sugerido y el usuario lo hace a mano. El despliegue ocurre cuando el usuario hace push.
- Implementar las fases de SPEC.md en orden, una a la vez. Al terminar cada una: correr pruebas, dar mensaje de commit sugerido y la lista de verificación manual (niveles de "Cómo probar antes de instalar": comandos, URL y la IP de la laptop). Esperar confirmación antes de la siguiente fase.
- Si algo de SPEC.md es ambiguo o imposible técnicamente, preguntar antes de decidir.

## Decisiones clave
- Sitio estático: TypeScript estricto + Vite, sin frameworks de UI, HTML + CSS propio.
- Dependencias permitidas: Dexie, vite-plugin-pwa, JSZip, Vitest. Nada más.
- Datos solo en IndexedDB (Dexie) en el celular. **Nunca enviar datos de gastos a ningún servidor.**
- Interfaz en español, una sola mano, botones de mínimo 64 px, tema claro/oscuro según el sistema, fechas `dd/mm/aaaa`.
- Monto: COP sin decimales con separador de miles; USD/EUR con 2 decimales. Sin conversión de divisas.
- Registrar abre directo con teclado propio; guardar = tocar categoría; "Guardado · Deshacer" 5 s.
- Fecha por defecto hoy; no se permiten fechas futuras; vuelve a "Hoy" al cerrar o tras 10 min.
- `navigator.storage.persist()` al iniciar.
- CSV UTF-8 con BOM, columnas `id,fecha,hora,monto,moneda,categoria,nota,foto`.
- Hosting: GitHub Pages vía GitHub Actions. Repo `hectorvcode/app_gastos`, base de Vite `/app_gastos/`.

## Comandos
- `npm install` — instalar dependencias
- `npm run dev` — desarrollo en `http://localhost:5173`
- `npm run dev -- --host` — accesible desde el celular por Wi-Fi (sin HTTPS)
- `npm run build` — typecheck + build a `dist/`
- `npm run preview` — servir el build
- `npm test` — Vitest
- `npm run icons` — regenerar íconos PNG de `public/`
