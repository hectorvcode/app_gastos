# App de gastos (PWA)

Especificación completa en `SPEC.md`. Este archivo resume las decisiones clave.

## Metodología de trabajo (obligatoria, todas las sesiones)
1. Un planificador (Claude en la web) redacta los prompts; el usuario me los pasa y le devuelve mis resultados. Actúo solo sobre lo que pide cada prompt.
2. Si algo es ambiguo, hago las preguntas y me detengo, sin implementar suposiciones.
3. Git lo maneja el usuario manualmente. **Nunca ejecuto comandos de git** (ni commit, ni push, ni add, ni checkout, ni branch, ni otros). Solo leo el estado con `git status` o `git diff` si el usuario lo pide. El despliegue ocurre cuando el usuario hace push.
4. Cada respuesta termina con un bloque `REPORTE PARA EL PLANIFICADOR` con este formato exacto:
   - Fase y estado: (en curso / lista para probar / cerrada)
   - Qué cambió: (máximo 5 viñetas)
   - Archivos tocados:
   - Pruebas: (cuántas pasan, cuáles nuevas)
   - Decisiones que tomé: (con el motivo, en una línea cada una)
   - Preguntas para mí:
   - Lista de verificación manual: (solo lo nuevo o lo que cambió, indicando el nivel 1, 2a o 3 de SPEC.md)
   - Commit sugerido: (Conventional Commits, para que el usuario lo ejecute)
   - Siguiente paso propuesto:
5. Si un fallo reportado no se puede reproducir, primero agrego el registro o la prueba que haga falta para encontrarlo, en lugar de solo pedir datos.

## Reglas del proyecto
- Implementar las fases de SPEC.md en orden, una a la vez. Al terminar cada una: correr pruebas y entregar el reporte con la lista de verificación manual (comandos, URL e IP de la laptop). Esperar confirmación antes de la siguiente fase.
- Si algo de SPEC.md es ambiguo o imposible técnicamente, preguntar antes de decidir.
- Lógica de pantallas en módulos sin DOM (`src/lib/`) para poder probarla con Vitest; la UI (`src/ui/`) solo conecta.
- **La app debe funcionar sin errores con `window.isSecureContext` en `false`**, porque así se prueba en el celular durante el desarrollo (`http://<IP-LAN>:5173`, nivel 2a). En ese contexto no existen `crypto.randomUUID`, `navigator.storage`, `navigator.serviceWorker`, `navigator.share`/`canShare`, entre otros: usar siempre `src/lib/compat.ts` (`generarUuid`, `pedirPersistencia`, `registrarServiceWorker`) y comprobar que la API exista antes de usarla (en Fase 6, Web Share con descarga como respaldo). Nunca depender de una API solo-HTTPS sin alternativa.
- Ningún error es silencioso: si guardar o cualquier acción falla, se muestra un aviso en pantalla (`mostrarError`) y no se pierde lo que el usuario escribió. Hay un manejador global de errores no capturados en `main.ts`.
- **Campos de texto/número y teclado en pantalla:** el meta viewport lleva `interactive-widget=resizes-content` y `ui/teclado.ts` (`instalarAjusteTeclado`, `cerrarTecladoConEnter`) publica `--vv-alto`/`--vv-arriba`. Toda hoja usa `.hoja` + `.hoja-panel`, y su acción principal va en un `.hoja-pie` (sticky) para que quede visible con el teclado abierto. Los campos numéricos llevan `inputMode="decimal"` y `cerrarTecladoConEnter` (Enter/"Listo" cierra el teclado sin guardar). Aplica a la nota de Fase 4.
- Tras tocar un botón de la pantalla Registrar se le quita el foco, para que Enter o espacio no repitan la acción.
- Teclado físico en Registrar: dígitos, `.`/`,` (monedas con decimales) y Backspace. Enter se ignora: guardar exige tocar una categoría.

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
