# App de gastos (PWA) — Especificación para Claude Code

Oct 7, 2026 · @NATALIA CARDENAS

## Resumen y objetivos

Se construirá una PWA (app web instalable) que guarda los gastos solo en el celular Android y los exporta a un archivo CSV que se importa en Google Sheets desde la laptop. No hay servidor ni base de datos en la nube: el código se aloja gratis en GitHub Pages y los datos nunca salen del teléfono salvo cuando el usuario exporta.

Objetivos medibles:

- Registrar un gasto en 3 toques y menos de 5 segundos: abrir la app, escribir el monto, tocar la categoría.
- Funcionar sin internet desde el primer uso tras la instalación.
- Guardar por gasto: monto, moneda, categoría, fecha y hora, nota opcional y foto del recibo opcional.
- Exportar a la laptop en menos de 1 minuto, con un CSV que Google Sheets abre sin ajustes manuales.
- No perder datos: respaldo completo (incluidas fotos) y restauración desde archivo.

Fuera de alcance en la versión 1: sincronización automática, conversión de divisas en línea, presupuestos, varios usuarios y publicación en Play Store.

## Arquitectura y stack técnico

La app es un sitio estático: GitHub Pages solo entrega el código, y todo lo demás ocurre dentro de Chrome en el celular.

&#91;embedded content: arquitectura · celular, archivo exportado y laptop\]

La única salida de datos del celular es el archivo que el usuario exporta y comparte.

| Pieza | Elección | Por qué |
| --- | --- | --- |
| Lenguaje y build | TypeScript + Vite | Build rápido, sin framework pesado; fácil de mantener con Claude Code |
| Interfaz | HTML + CSS propio, sin librerías de UI | Carga instantánea y botones grandes pensados para el pulgar |
| Almacenamiento | IndexedDB mediante Dexie.js | Guarda miles de registros y fotos (Blob) de forma local |
| Offline e instalación | vite-plugin-pwa (service worker + manifest) | Permite "Instalar app" en Chrome y funcionar sin red |
| Fotos | Captura con `<input type="file" accept="image/*" capture="environment">` y compresión con canvas | Abre la cámara directo; reduce cada foto a \~1600 px de lado y JPEG calidad 0.7 |
| Exportación | CSV propio + JSZip | CSV para Sheets; ZIP para incluir las fotos |
| Compartir | Web Share API con archivos, con descarga como respaldo | Envía el archivo por Quick Share, Drive, Gmail o WhatsApp |
| Hosting | GitHub Pages con GitHub Actions | Gratis, HTTPS (obligatorio para instalar una PWA) y despliegue con cada `git push` |

Requisitos en la laptop Windows 11 para Claude Code: Node.js LTS, Git, una cuenta de GitHub y GitHub CLI (`gh`) autenticado.

Para evitar que Chrome borre los datos si el teléfono se queda sin espacio, la app llama a `navigator.storage.persist()` al iniciar y muestra en Ajustes si el almacenamiento quedó marcado como persistente.

## Modelo de datos

Cuatro tablas en IndexedDB; las fotos van aparte para que listar gastos sea rápido.

**gastos**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | string (UUID) | Generado con `crypto.randomUUID()` |
| fecha | string ISO 8601 | Hoy por defecto; seleccionable al registrar y editable después |
| monto | number | Siempre positivo; hasta 2 decimales |
| moneda | string | Código ISO 4217: COP, USD, EUR… |
| categoriaId | string | Referencia a categorias |
| nota | string | Opcional, máximo 200 caracteres |
| fotoId | string o null | Referencia a fotos |
| creadoEn / editadoEn | string ISO | Para auditoría y exportación incremental |
| exportadoEn | string ISO o null | Marca la última exportación que lo incluyó |

**fotos**: id, blob (JPEG comprimido), ancho, alto.

**categorias**: id, nombre, emoji, orden, activa. Precargadas: Comida, Mercado, Transporte, Hogar, Salud, Ocio, Compras, Servicios, Otros. El usuario puede renombrar, reordenar y ocultar.

**ajustes** (clave-valor): monedaPredeterminada (COP), monedasVisibles (COP, USD, EUR), ultimaExportacion, versionEsquema.

No hay conversión de divisas en la app: cada gasto guarda su monto en la moneda original. La conversión se hace en Google Sheets con `GOOGLEFINANCE("CURRENCY:USDCOP")`.

## Pantallas y flujo de registro rápido

La app abre directo en Registrar, con el teclado numérico listo: no hay menú de inicio ni botón "Nuevo gasto".

Flujo de registro:

1. Abrir la app desde el ícono: el monto aparece en 0 y el teclado propio está visible.
2. Escribir el monto. Para COP no se muestran decimales; se ve con separador de miles (45.000).
3. Opcional: tocar el chip de fecha (dice "Hoy") para registrar otro día, el chip de moneda para cambiarla, el ícono de cámara para la foto o "Nota" para escribir.
4. Tocar una categoría de la cuadrícula: el gasto se guarda al instante y aparece "Guardado · Deshacer" durante 5 segundos.
5. La pantalla vuelve a 0, lista para el siguiente gasto.

**Fecha del gasto.** Por defecto cada gasto queda con la fecha de hoy, sin ningún toque extra. Para otro día:

- El chip de fecha, junto al de moneda, muestra "Hoy". Al tocarlo aparecen accesos rápidos "Hoy", "Ayer" y "Antier", más "Elegir fecha", que abre el calendario nativo de Android (`<input type="date">`).
- No se permiten fechas futuras.
- Si se elige un día distinto de hoy, el chip cambia de color y muestra la fecha ("Lun 5 oct"), para que no pase desapercibido.
- La fecha elegida se mantiene para los siguientes gastos, útil al ingresar varios recibos de un mismo día. Vuelve sola a "Hoy" al cerrar la app o tras 10 minutos sin registrar.
- Hora: si la fecha es hoy, se guarda la hora actual; si es otro día, se guarda 12:00 y se puede ajustar luego desde Historial.
- El aviso "Guardado · Deshacer" incluye la fecha cuando no es hoy ("Guardado el 5 oct · Deshacer").

Pantallas (barra inferior con 4 pestañas):

| Pantalla | Qué muestra | Acciones |
| --- | --- | --- |
| Registrar | Monto grande, chip de moneda, cámara, nota, teclado y cuadrícula de categorías (3 columnas, botones de mínimo 64 px) | Guardar con un toque, deshacer |
| Historial | Gastos agrupados por día, del más reciente al más antiguo, con miniatura si hay foto | Tocar para editar, borrar o ver la foto; filtrar por mes y categoría |
| Resumen | Total del mes por moneda y por categoría, con barras horizontales simples | Cambiar de mes |
| Ajustes | Categorías, monedas, estado del almacenamiento, exportar, respaldar y restaurar | Ver sección de exportación |

Reglas de interfaz: tema claro y oscuro según el sistema, textos en español, formato de fecha `dd/mm/aaaa`, todo usable con una sola mano. Si el monto es 0, tocar una categoría no guarda nada y el monto vibra.

## Exportación a la laptop y Google Sheets

Reglas: fecha ISO para que Sheets la reconozca, monto sin separador de miles, notLa vía recomendada es exportar "Solo nuevos" y compartir el archivo a Google Drive: desde ahí se agrega a una hoja maestra de Sheets sin duplicar filas.

**Opciones de exportación (en Ajustes → Exportar):**

| Opción | Qué incluye | Archivo |
| --- | --- | --- |
| Solo nuevos | Gastos creados o editados desde la última exportación | `gastos_AAAA-MM-DD.csv` |
| Un mes | Todos los gastos del mes elegido | `gastos_AAAA-MM.csv` |
| Todo | Todo el historial | `gastos_completo_AAAA-MM-DD.csv` |
| Con fotos | Cualquiera de las anteriores + carpeta `fotos/` | `.zip` con el CSV y los JPEG |

**Formato del CSV**, codificado en UTF-8 con BOM:

```csv
id,fecha,hora,monto,moneda,categoria,nota,foto
3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90,2026-10-07,13:42,45000,COP,Comida,Almuerzo con equipo,3f2a9c1e.jpg
b81d22f0-1c4e-4a7b-8d3f-0e9a6b5c4d21,2026-10-07,18:05,12.5,USD,Compras,Suscripción,
```

a entre comillas si tiene comas. En Ajustes hay un selector "Decimal con punto / Decimal con coma"; con coma, el separador de columnas pasa a ser punto y coma. Si la hoja de Sheets está configurada en español de Colombia, se usa la opción con coma.

**Pasar el archivo a la laptop.** Al exportar se abre el menú Compartir de Android:

- Google Drive: guardar en una carpeta "Gastos". Es lo más directo porque Sheets ya está ahí.
- Quick Share: envío directo a Windows 11 con la app Quick Share para Windows instalada.
- Gmail o WhatsApp: envío a uno mismo.
- Si el navegador no permite compartir archivos, el archivo se descarga en la carpeta Descargas.

**Importar en Google Sheets.** Crear una vez una hoja "Gastos" con la fila de encabezados. Luego, con cada exportación: Archivo → Importar → elegir el CSV → "Agregar a la hoja actual". La columna `id` permite detectar duplicados con `COUNTIF`. Las fotos del ZIP se suben a la carpeta Drive "Gastos/fotos" y la columna `foto` indica qué archivo corresponde a cada gasto.

**Respaldo y restauración.** "Crear respaldo" genera `respaldo_gastos_AAAA-MM-DD.json` con gastos, categorías, ajustes y fotos en base64. "Restaurar" lo lee y fusiona por `id` sin duplicar. Si pasan más de 7 días sin respaldo, la pantalla Registrar muestra un aviso discreto.

## Fases de desarrollo y criterios de aceptación

Cada fase termina con algo que se puede probar en el celular; Claude Code debe hacer commit y desplegar al final de cada una.

1. **Base instalable.** Proyecto Vite + TypeScript, PWA con manifest e íconos, despliegue automático a GitHub Pages.
   - [ ] La URL de GitHub Pages abre en Chrome Android y ofrece "Instalar app".
   - [ ] Instalada, abre sin barra del navegador y funciona en modo avión.
2. **Registro rápido.** Pantalla Registrar, teclado propio, categorías precargadas, selector de fecha (Hoy, Ayer, Antier, calendario), guardado en IndexedDB.
   - [ ] Un gasto de hoy se guarda con 3 toques y sobrevive a cerrar la app; uno de otro día se guarda con la fecha elegida y el chip vuelve a "Hoy" al reabrir.
   - [ ] "Deshacer" elimina el último gasto durante 5 segundos.
3. **Historial y edición.** Lista por día, editar y borrar, filtros por mes y categoría.
   - [ ] Editar fecha, monto, moneda, categoría y nota actualiza `editadoEn`.
4. **Monedas y notas.** Chip de moneda, moneda predeterminada configurable, campo de nota.
   - [ ] COP se muestra sin decimales; USD y EUR con 2.
5. **Fotos del recibo.** Cámara, compresión, miniatura en historial, visor a pantalla completa.
   - [ ] Cada foto guardada pesa menos de 400 KB.
6. **Exportación.** CSV y ZIP, menú Compartir, "Solo nuevos".
   - [ ] El CSV se importa en Google Sheets con fechas y montos reconocidos como tales.
   - [ ] Exportar "Solo nuevos" dos veces seguidas genera un segundo archivo vacío.
7. **Respaldo, resumen y ajustes.** Respaldo JSON, restauración con fusión, pantalla Resumen, gestión de categorías.
   - [ ] Restaurar un respaldo en un navegador limpio recupera gastos y fotos.

Pruebas: Vitest para la lógica (formato de montos, generación de CSV, fusión de respaldos) y una lista de verificación manual en el celular al cerrar cada fase.

## Cómo probar antes de instalar

Cada fase se prueba primero en la laptop y después en el celular, sin instalar la app hasta que todo funcione. Al cerrar cada fase, Claude Code debe dar las instrucciones del nivel que corresponda con las URL y comandos exactos.

| Nivel | Dónde | Cómo | Qué sirve para probar | Límite |
| --- | --- | --- | --- | --- |
| 1. Laptop | Chrome en Windows | `npm run dev`, abrir `http://localhost:5173`, F12 y Ctrl+Shift+M para vista de celular | Flujo completo, IndexedDB (DevTools → Application), modo offline (casilla Offline) | La cámara usa la webcam o un selector de archivos |
| 2a. Celular por Wi‑Fi | Chrome Android, misma red | `npm run dev -- --host`, abrir la IP que indique Claude Code (p. ej. `http://192.168.1.20:5173`) | Interfaz con el dedo, teclado, cámara real, compartir | Sin HTTPS: no hay modo offline ni instalación |
| 2b. Celular por USB | Chrome Android con depuración USB | `chrome://inspect` en la laptop → Port forwarding `5173 → localhost:5173`; abrir `localhost:5173` en el celular | Todo lo anterior + modo offline, y depurar el celular desde la laptop | Requiere activar Opciones de desarrollador |
| 3. Celular en línea | Chrome Android, URL de GitHub Pages | Abrir la URL sin tocar "Instalar app" | Verificación final de la fase, igual a la app real | Ninguno |

Uso recomendado: nivel 1 mientras se desarrolla cada fase, nivel 2a cuando cambie algo táctil (teclado, cámara, compartir) y nivel 3 para dar la fase por cerrada.

Los gastos que se registren en el nivel 3 se conservan al instalar la app después, porque la página y la app instalada comparten el mismo almacenamiento. Los datos de los niveles 1 y 2 son de prueba y quedan separados.

Para activar la depuración USB en Android: Ajustes → Acerca del teléfono → tocar 7 veces "Número de compilación"; luego Ajustes → Sistema → Opciones de desarrollador → Depuración USB. La ruta exacta varía según la marca del teléfono.

## Prompt para Claude Code

Exporta este documento como Markdown, guárdalo como `SPEC.md` en una carpeta vacía (por ejemplo `C:\proyectos\app-gastos`), abre Claude Code en esa carpeta y pega el prompt siguiente.

```text
Vas a construir una PWA de registro de gastos siguiendo SPEC.md, que está en esta carpeta. Léelo completo antes de empezar.

Contexto:
- Trabajo en Windows 11 (PowerShell). Uso la app en Chrome para Android.
- Los datos se guardan solo en el celular (IndexedDB). No hay backend.
- El código se despliega en GitHub Pages con GitHub Actions.

Forma de trabajo:
1. Verifica que tengo Node.js LTS, Git y GitHub CLI autenticado. Si falta algo, dime cómo instalarlo y espera.
2. Crea un CLAUDE.md con las decisiones clave de SPEC.md y los comandos del proyecto.
3. Implementa las fases de SPEC.md en orden, una a la vez.
4. Al terminar cada fase: corre las pruebas, haz commit, despliega y dame la lista de verificación manual con las instrucciones de prueba de la sección "Cómo probar antes de instalar" de SPEC.md (comandos, URL y la IP de mi laptop cuando aplique). Espera mi confirmación antes de pasar a la siguiente fase.
5. Si algo de SPEC.md es ambiguo o no es posible técnicamente, pregúntame antes de decidir.

Restricciones:
- TypeScript estricto, sin frameworks de UI. Dependencias permitidas: Dexie, vite-plugin-pwa, JSZip, Vitest.
- Interfaz en español, pensada para una mano, botones de mínimo 64 px.
- Nunca enviar datos de gastos a ningún servidor.

Empieza por la verificación del entorno y la Fase 1.
```

Para ver la app en el celular mientras se desarrolla, Claude Code puede correr `npm run dev -- --host` y abrir la IP de la laptop en Chrome del celular (misma red Wi‑Fi). La instalación como app solo funciona desde la URL de GitHub Pages, porque exige HTTPS.

## Instalación en Android y uso diario

La app se instala una sola vez desde Chrome y luego se usa como cualquier otra app del teléfono.

1. En el celular, abrir en Chrome la URL de GitHub Pages que entregue Claude Code.
2. Menú ⋮ → "Instalar app" (o "Agregar a pantalla principal").
3. Abrir desde el ícono nuevo y confirmar que funciona en modo avión.
4. Mover el ícono a la barra inferior del escritorio para tenerlo a un toque.

Rutina sugerida:

- Cada gasto: registrarlo en el momento, con foto solo si el recibo importa (garantía, reembolso, impuestos).
- Cada semana: Exportar → Solo nuevos → Google Drive, y luego importar en la hoja "Gastos".
- Cada semana o mes: Crear respaldo y guardarlo también en Drive.

Cuidados: no borrar los datos de Chrome ni desinstalar la app sin un respaldo reciente, porque ahí viven los gastos. Las actualizaciones que haga Claude Code llegan solas al abrir la app con internet.
