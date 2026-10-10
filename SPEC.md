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

Seis tablas en IndexedDB; las fotos van aparte para que listar gastos sea rápido.

**gastos**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | string (UUID) | Generado con `crypto.randomUUID()` |
| fecha | string ISO 8601 | Hoy por defecto; seleccionable al registrar y editable después |
| monto | number | Siempre positivo; hasta 2 decimales |
| moneda | string | Código ISO 4217: COP, USD, EUR… |
| categoriaId | string | Referencia a categorias |
| cuentaId | string | Referencia a cuentas; los gastos anteriores a la Fase 4b pasan a la cuenta "Personal" |
| nota | string | Opcional, máximo 200 caracteres |
| fotoId | string o null | Referencia a fotos |
| creadoEn / editadoEn | string ISO | Para auditoría y exportación incremental |
| exportadoEn | string ISO o null | Marca la última exportación "Solo nuevos" que lo incluyó (instante en que se armó el archivo) |

**fotos**: id, blob (JPEG comprimido), ancho, alto.

**categorias**: id, nombre, emoji, orden, activa. Precargadas: Comida, Mercado, Transporte, Hogar, Salud, Ocio, Compras, Servicios, Otros. Es **un solo catálogo común a todas las cuentas**: crear, renombrar, cambiar el emoji, ocultar (`activa` = false) y borrar afectan a todas. Cada cuenta decide cuáles muestra y en qué orden (ver "Categorías por cuenta"). Un gasto conserva su `categoriaId` aunque la categoría esté oculta.

**cuentas**: id, nombre, emoji, orden, archivada, categoriaIds (desde la Fase 7a: lista ordenada de ids de las categorías que la cuenta muestra en Registrar). Una cuenta es un libro separado de gastos (Personal, Hogar, Negocio…): solo una etiqueta para registrar y consultar por separado, sin saldo, ingresos, transferencias ni moneda propia. Al iniciar por primera vez se crea "Personal". Una cuenta con gastos no se borra, solo se archiva; siempre queda al menos una cuenta activa y la predeterminada no se puede archivar.

**eliminados**: id (del gasto), cuentaId, eliminadoEn (ISO). Gastos borrados que ya se habían exportado; se vacía lo incluido en cada exportación "Solo nuevos". Se agrega en la Fase 6 (migración de Dexie a versionEsquema 3, que solo añade la tabla).

**ajustes** (clave-valor): monedaPredeterminada (COP), monedasVisibles (COP, USD, EUR), cuentaPredeterminada (id de cuenta), ultimaCuenta (última cuenta usada en Registrar), ultimaExportacion (ISO de la última exportación completada), ultimoRespaldo (`{fecha, gastos, fotos}` del último respaldo creado), recordatorioRespaldoCerrado (día en que se cerró el recordatorio de respaldo), decimalCsv (`coma` por defecto o `punto`), versionEsquema (3 desde la Fase 6, 4 desde la Fase 7a).

No hay conversión de divisas en la app: cada gasto guarda su monto en la moneda original. La conversión se hace en Google Sheets con `GOOGLEFINANCE("CURRENCY:USDCOP")`.

## Pantallas y flujo de registro rápido

La app abre directo en Registrar, con el teclado numérico listo: no hay menú de inicio ni botón "Nuevo gasto".

Flujo de registro:

1. Abrir la app desde el ícono: el monto aparece en 0 y el teclado propio está visible.
2. Escribir el monto. Para COP no se muestran decimales; se ve con separador de miles (45.000).
3. Opcional: tocar el chip de fecha (dice "Hoy") para registrar otro día, el chip de moneda para cambiarla, el chip de cuenta (solo si hay más de una cuenta activa) para registrar en otro libro, el ícono de cámara para la foto o "Nota" para escribir.
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
| Registrar | Monto grande, chips de fecha, moneda y cuenta, cámara, nota, teclado y cuadrícula con las categorías visibles de la cuenta actual (3 columnas, hasta 4 filas, botones de mínimo 64 px, sin scroll) | Guardar con un toque, deshacer |
| Historial | Gastos agrupados por día, del más reciente al más antiguo, con miniatura si hay foto | Tocar para editar, borrar o ver la foto; filtrar por mes, categoría y cuenta |
| Resumen | Total del mes por moneda y por categoría, con barras horizontales simples | Cambiar de mes |
| Ajustes | Secciones plegables, en este orden: Exportar, Respaldo, Categorías, Cuentas, Monedas, Fotos y Almacenamiento | Ver sección de exportación |

**Categorías por cuenta (Fase 7a).** Ajustes → "Categorías" (plegable, entre Exportar y Cuentas):

- Con más de una cuenta activa, arriba hay un selector "Categorías de: <cuenta>" que empieza en la cuenta actual de Registrar. Para esa cuenta se muestra u oculta cada categoría y se reordena con subir/bajar. Cada categoría indica cuántos gastos tiene en total.
- Las acciones del catálogo (crear, renombrar, cambiar emoji, ocultar del catálogo, borrar) están en la hoja de cada categoría, con el aviso "Afecta a todas las cuentas".
- **Reglas:** máximo 12 categorías visibles por cuenta (3 columnas × 4 filas caben en Registrar sin scroll; si se intenta pasar de 12, un aviso lo explica) y al menos 1. Nombres únicos sin distinguir mayúsculas (también frente a las ocultas), hasta 20 caracteres; emoji vacío → 🏷️.
- **Ocultar o borrar:** una categoría con gastos no se borra, solo se oculta del catálogo y entonces desaparece de todas las cuentas (se puede volver a mostrar; vuelve visible solo en la cuenta que se está editando, si hay cupo). Una categoría sin gastos sí se borra y sale de todas las cuentas. No se puede ocultar ni borrar una categoría si alguna cuenta se quedaría sin ninguna.
- **Dos formas de ocultar, con textos distintos:** el interruptor de la lista dice "Visible en <cuenta>" / "Oculta en <cuenta>" y afecta solo a esa cuenta; el botón de la hoja de la categoría dice "Ocultar en todas las cuentas" (catálogo). Ambas actúan sin confirmación previa y muestran un aviso con "Deshacer" (8 s): "Mercado ya no aparece en Hogar" o "Mercado se ocultó en todas las cuentas. Sus N gastos siguen en Historial". Deshacer devuelve la visibilidad y el orden de cada cuenta afectada exactamente como estaban.
- **Categoría nueva:** se agrega visible, al final, a la cuenta seleccionada (si tiene menos de 12) y queda oculta en las demás.
- **Cuentas nuevas** empiezan con todas las categorías activas (hasta 12), en el orden del catálogo.
- **Migración (Dexie versionEsquema 4):** cada cuenta existente recibe todas las categorías activas actuales en su orden actual. No cambia ni pierde gastos; si falla, la base queda en la versión 3.
- **Renombrar o cambiar el emoji no actualiza `editadoEn`** de los gastos (el nombre no se guarda en ellos): no vuelven a salir en "Solo nuevos". La exportación usa siempre el nombre actual. **En Google Sheets, las filas ya importadas conservan el nombre anterior** hasta que ese gasto se vuelva a exportar (para unificarlos: exportar "Todo" y agregarlo a "Importados"; la fórmula se queda con la última versión de cada `id`).
- **Historial y edición:** los gastos se ven con su categoría aunque esté oculta en la cuenta o en el catálogo. "Editar gasto" ofrece las categorías visibles de la cuenta del gasto, más la categoría actual del gasto si no está entre ellas (marcada "oculta aquí"); al cambiar la cuenta del gasto la categoría se conserva, aunque la nueva cuenta no la muestre. El filtro de categoría de Historial lista todo el catálogo: con "Todas las cuentas" marca "(oculta)" si está oculta del catálogo o ninguna cuenta activa la muestra; "(oculta en Hogar)", "(oculta en Hogar y Negocio)" o "(oculta en 3 cuentas)" si solo falta en algunas cuentas activas; sin marca si todas las activas la muestran. Con una cuenta específica: "(oculta en <cuenta>)" si esa cuenta no la muestra. Da igual si se ocultó con el interruptor de una cuenta o con "Ocultar en todas las cuentas". "Editar gasto" usa el criterio de cuenta específica con la cuenta elegida en la hoja.

**Navegación hacia atrás (Fase 7a).** Las pantallas principales son Registrar, Historial, Resumen y Ajustes. Toda hoja o pantalla secundaria (Editar gasto, Nota, Foto, selectores de fecha, moneda y cuenta, visor de fotos, "Archivo listo", hojas de cuenta y de categoría, cuadros de confirmación) cumple:

- Arriba lleva un botón "← Atrás" de al menos 48 px (fijo al desplazar la hoja).
- El botón o gesto Atrás de Android, también en la app instalada, cierra la hoja abierta en lugar de salir de la app: se usa la History API (`pushState` al abrir, `popstate` al cerrar), que funciona también sin HTTPS. Con hojas anidadas se cierra solo la de arriba. En una pantalla principal sin hojas abiertas, Atrás se comporta como siempre. La lógica está en `lib/navegacion.ts` (`PilaNavegacion`).
- Si la hoja tiene cambios sin guardar (p. ej. Editar gasto), Atrás —el botón de la pantalla, el de Android y "Cancelar"— pregunta "¿Descartar cambios?" antes de cerrar. Cerrar por código (tras guardar o eliminar) no pregunta. En "Archivo listo", Atrás pregunta "¿Descartar el archivo preparado?" (Descartar archivo / Conservarlo). Si la página se recarga con una hoja abierta, al iniciar la app vuelve a la base del historial (cada entrada guarda `n`, cuántas hay sobre la base), para que ningún Atrás quede sin efecto visible.

Reglas de interfaz: tema claro y oscuro según el sistema, textos en español, formato de fecha `dd/mm/aaaa`, todo usable con una sola mano. Si el monto es 0, tocar una categoría no guarda nada y el monto vibra.

## Exportación a la laptop y Google Sheets

Reglas: fecha ISO para que Sheets la reconozca, monto sin separador de miles y notas entre comillas cuando lo necesiten. La vía recomendada es exportar "Solo nuevos" y compartir el archivo a Google Drive: desde ahí se agrega a una hoja de Sheets y se conserva la última versión de cada `id`.

**Pantalla Exportar (Ajustes, primera sección).** Arriba, dos opciones: "Período" (Solo nuevos / Un mes / Rango de fechas / Todo) y "Cuenta" (oculta si solo hay una). Debajo, el resumen en una línea ("12 gastos · 3 con foto", más "· N eliminados" si hay) y dos botones grandes, cada uno con una línea de explicación: "Exportar para Google Sheets (CSV)" (solo los datos) y "Exportar con fotos (ZIP)" (los datos más las fotos de los recibos, con el peso aproximado). El separador decimal está en "Opciones avanzadas", plegado.

| Qué exportar | Qué incluye | Archivo |
| --- | --- | --- |
| Solo nuevos (por defecto) | Gastos creados o editados después de su `exportadoEn`, más los eliminados desde la última exportación | `gastos_AAAAMMDD-HHMMSS.csv` |
| Un mes | Todos los gastos del mes elegido | `gastos_AAAA-MM_AAAAMMDD-HHMMSS.csv` |
| Rango de fechas | De "desde" a "hasta", ambos días completos; "hasta" no puede ser futura ni anterior a "desde" | `gastos_AAAA-MM-DD_a_AAAA-MM-DD_AAAAMMDD-HHMMSS.csv` |
| Todo | Todo el historial | `gastos_completo_AAAAMMDD-HHMMSS.csv` |

- **Cuenta:** "Todas" (por defecto) o una cuenta específica; se combina con cualquiera de las opciones. Si no es "Todas", su nombre va después de `gastos_` (`gastos_Hogar_2026-10_20261008-201005.csv`, `gastos_Hogar_20261008-201005.zip`).
- **Formato:** CSV, o ZIP con el CSV en la raíz y los JPEG en `fotos/` (mismo nombre con `.zip`).
- **Nombre del archivo:** todos terminan en la fecha y hora locales de la exportación (`AAAAMMDD-HHMMSS`), para que dos exportaciones nunca se llamen igual.
- **Control de lo exportado:** solo "Solo nuevos" marca `exportadoEn` (y vacía los eliminados incluidos). Un mes, un rango y Todo no marcan nada. Si se exporta una sola cuenta, solo se marcan los gastos y eliminados de esa cuenta.
- **Eliminados:** al borrar en Historial un gasto que ya se había exportado, se guarda en la tabla `eliminados` su `id`, su cuenta y la fecha del borrado. Un gasto que nunca se exportó no deja registro (Sheets no lo conoce). "Deshacer" quita el registro. El registro se escribe al tocar "Eliminar" (en la misma transacción que el borrado) y no al vencer el Deshacer, para que no se pierda si la app se cierra durante esos 5 segundos.
- **Archivo vacío:** si no hay nada que exportar (por ejemplo "Solo nuevos" dos veces seguidas), la app muestra "No hay gastos nuevos desde la última exportación" y no genera archivo.

**Formato del CSV**, codificado en UTF-8 con BOM y fin de línea CRLF (el ejemplo está en modo "decimal con punto"):

```csv
id,fecha,hora,monto,moneda,categoria,cuenta,nota,foto,cambio
3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90,2026-10-07,13:42,45000,COP,Comida,Personal,Almuerzo con equipo,3f2a9c1e.jpg,nuevo
b81d22f0-1c4e-4a7b-8d3f-0e9a6b5c4d21,2026-10-07,18:05,12.5,USD,Compras,Negocio,"Suscripción, anual",,editado
c07e11aa-92d0-4b6e-b1f4-5a3d8e2c7f10,2026-10-08,09:15,,,,Personal,,,eliminado
```

- `fecha` y `hora` son locales (AAAA-MM-DD y HH:MM). `monto` no lleva separador de miles ni ceros sobrantes: COP sin decimales; USD y EUR hasta 2.
- `cambio`: `nuevo` (Sheets todavía no lo conoce, o es la versión vigente de un gasto sin cambios que se vuelve a exportar), `editado` (ya se había exportado y cambió después) o `eliminado` (solo trae `id`, `cuenta` y, en `fecha`/`hora`, el momento del borrado; monto, moneda, categoría, nota y foto van vacíos).
- `foto`: nombre del archivo dentro de `fotos/` del ZIP (los primeros 8 caracteres del `id`, p. ej. `3f2a9c1e.jpg`; si dos chocan, el segundo se alarga); vacía si no hay foto o si se exporta solo CSV.
- Notas con comas, comillas o saltos de línea van entre comillas (las comillas internas se duplican).
- Selector en Ajustes → Exportar, "Decimal con punto / Decimal con coma", guardado en `decimalCsv`. **Por defecto, coma**: el decimal es `12,5` y las columnas se separan con punto y coma (`;`), como espera un Sheets en español de Colombia. Con punto, el decimal es `12.5` y las columnas se separan con coma.

**Pasar el archivo a la laptop.** Al exportar se abre el menú Compartir de Android (Web Share API con archivos):

- Google Drive: guardar en una carpeta "Gastos". Es lo más directo porque Sheets ya está ahí.
- Quick Share: envío directo a Windows 11 con la app Quick Share para Windows instalada.
- Gmail o WhatsApp: envío a uno mismo.
- Solo si el menú Compartir se completa se marca `exportadoEn`; si se cancela, no se marca nada. Si Chrome pide un toque nuevo (armar el ZIP tardó), aparece "Archivo listo" con un botón Compartir.
- **ZIP en el celular:** armar el ZIP tarda, así que el toque original ya expiró; la app muestra "Archivo listo" y solo ofrece lo que Chrome permite según `canShare`: "Compartir datos y fotos" (el CSV primero y cada JPEG como archivo aparte, con los mismos nombres de la columna `foto`), "Compartir el ZIP" (solo si `canShare` lo acepta; Chrome en Android no suele permitir `application/zip`) y "Descargar el ZIP". Si Chrome rechaza un Compartir con toque reciente, esa opción se retira y se muestra el motivo.
- **Compartir datos y fotos en tandas:** cada Compartir admite pocos archivos, así que se reparte en tandas de hasta 10 archivos y 20 MB (el CSV va al principio de la primera), una por toque. Solo se marca `exportadoEn` al terminar la última tanda; si se cancela o Chrome rechaza una, no se marca nada y se puede reintentar esa tanda.
- **Registro de diagnóstico:** cada paso de la exportación (armado, `canShare`, `share`, descarga) se anota en la consola (`[exportar]`, visible con `chrome://inspect`) y en Ajustes → Exportar → Opciones avanzadas → "Registro de la última exportación".
- El menú Compartir solo se usa en el celular. En Chrome de escritorio (Windows) abre el panel del sistema, que puede quedar oculto y dejar la acción sin respuesta, así que ahí el archivo siempre se descarga. La descarga usa el tipo genérico `application/octet-stream` (el archivo compartido conserva `text/csv` o `application/zip`). Ver "Problemas conocidos" si Windows le agrega `.xls`.
- Si el navegador no permite compartir archivos (p. ej. `http://<IP-LAN>`), o en el escritorio, el archivo se descarga directamente en la carpeta Descargas y, como no se puede saber si llegó, la marca de "Solo nuevos" se aplica con un aviso "Deshacer marca" de 10 segundos.
- Tras exportar, el aviso muestra el nombre exacto del archivo. En escritorio: "Se descargó gastos_20261008-203734.csv en tu carpeta de descargas". En el celular (Android no muestra la notificación de la descarga): "Se guardó <nombre> en Archivos → Descargas. Para subirlo a Drive: abre Files, mantén presionado el archivo → Compartir → Drive." Ajustes muestra la fecha y hora de la última exportación.

**Importar en Google Sheets.**

*Primera vez.* Crear una hoja de cálculo con una pestaña llamada **"Importados"**, donde se acumulan todos los CSV. Archivo → Importar → Subir (o elegir el CSV desde Drive) → "Reemplazar hoja actual". Tipo de separador: "Detectar automáticamente" (si las columnas quedan juntas en una sola, elegir "Punto y coma" cuando se exportó con decimal con coma). Dejar activada la conversión de texto a números y fechas.

*Actualizaciones.* Archivo → Importar → elegir el nuevo CSV → **"Agregar a la hoja actual"** (con "Importados" abierta). Las filas nuevas quedan debajo de las anteriores, así que un mismo `id` puede aparecer varias veces (un gasto editado, o uno eliminado), y cada importación vuelve a traer la fila de encabezados.

*Pestaña "Gastos".* Es la que se consulta: muestra la última versión de cada `id` y descarta los eliminados. Se crea una pestaña nueva llamada "Gastos" con dos celdas (fórmula probada en una hoja real de Sheets en español de Colombia, donde los argumentos se separan con `;` y no con `,`):

- En **A1**: `=Importados!A1:J1` (copia los encabezados).
- En **A2**:

```
=LET(datos; FILTER(Importados!A2:J; Importados!A2:A<>""; Importados!A2:A<>"id"); ultimos; SORTN(SORT(datos; SEQUENCE(ROWS(datos)); FALSE); 9^9; 2; 1; TRUE); vivos; FILTER(ultimos; INDEX(ultimos; 0; 10)<>"eliminado"); SORT(vivos; 2; FALSE; 3; FALSE))
```

Cómo funciona: `datos` son las filas de "Importados" sin las vacías ni los encabezados repetidos (`id`); `SORT(...; SEQUENCE(ROWS(datos)); FALSE)` las ordena de la fila más reciente a la más antigua; `SORTN(...; 9^9; 2; 1; TRUE)` conserva solo la primera fila de cada `id` (columna 1), es decir, la última versión importada; `vivos` descarta las que dicen `eliminado` (columna 10); y el `SORT` final deja los gastos del más reciente al más antiguo (fecha y luego hora). Las fotos del ZIP se suben a la carpeta Drive "Gastos/fotos" y la columna `foto` indica qué archivo corresponde a cada gasto. La conversión de divisas se hace sobre "Gastos" con `GOOGLEFINANCE("CURRENCY:USDCOP")`.


**Respaldo y restauración (Fase 7b).** Ajustes → "Respaldo" (plegable, justo después de Exportar).

- **Crear respaldo** genera `respaldo_gastos_AAAAMMDD-HHMMSS.zip` con `datos.json` y las fotos tal como están guardadas (`fotos/<id>.jpg` sin recomprimir; las miniaturas van en `miniaturas/`). `datos.json` lleva `formato` (`app-gastos-respaldo`), `versionFormato` (1), `versionEsquema` (4), `creadoEn`, `gastos`, `categorias`, `cuentas` (con `categoriaIds`), `ajustes` (sin el borrador ni lo que describe al propio respaldo), `eliminados` y los metadatos de las fotos. El archivo siempre se **descarga** (Chrome en Android no comparte ZIP): en el celular el aviso dice "Se guardó <nombre> en Archivos → Descargas. Para subirlo a Drive: abre Files, mantén presionado el archivo → Compartir → Drive."; en escritorio, descarga directa como en Exportar. Ajustes muestra la fecha del último respaldo y cuántos gastos y fotos incluyó. El respaldo **no** cambia `exportadoEn` ni nada de la exportación.
- **Restaurar desde archivo** (`<input type="file">`, funciona por HTTP) valida que sea un ZIP de respaldo, que el formato sea compatible y que `datos.json` esté bien; si algo falla avisa el motivo y no cambia nada. Antes de aplicar muestra "Se agregarán N gastos, se actualizarán M, se omitirán K (iguales o más antiguos); se agregarán X fotos, Y categorías y Z cuentas" con "Restaurar" y "Cancelar".
- **Fusión por `id`, sin borrar nunca nada local.** En los gastos gana la versión con `editadoEn` más reciente (o `creadoEn` si no tiene); las categorías y cuentas nuevas se agregan y las que ya existen conservan su configuración local (incluida la lista de categorías de cada cuenta); las fotos se restauran si faltan; un gasto del respaldo que aparece en la tabla de eliminados locales no se restaura ("omitido (eliminado aquí)"). Se conserva el `exportadoEn` del respaldo (un celular nuevo sigue con "Solo nuevos" al día) y nunca se retrocede el local. Los registros de eliminados que aquí faltan se agregan, para avisar a Sheets. Ajustes: si la base local no tiene gastos (teléfono nuevo o datos borrados) se aplican los del respaldo (moneda predeterminada, monedas visibles, separador decimal, Modo recibo, última cuenta y cuenta predeterminada); si ya tiene gastos mandan los locales y solo se agrega lo que falta, más `ultimaExportacion` si la del respaldo es más reciente. Una categoría o cuenta del respaldo con el mismo nombre que una local (distinto id) se toma como la misma.
- **Todo en una transacción** de IndexedDB: si algo falla a mitad no queda nada a medias. Las fotos se sacan del ZIP antes (con progreso) y se escribe por lotes; funciona con 2.000 gastos y 300 fotos sin congelar la pantalla.
- **Recordatorio:** si hay gastos y pasaron **más de 7 días** desde el último respaldo (o nunca hubo uno), Registrar muestra una franja discreta "Hace N días que no respaldas tus gastos · Respaldar" (sin respaldos: "Aún no has respaldado tus gastos") flotando bajo el monto, sin quitar lugar a las categorías. "Respaldar" lleva a Ajustes → Respaldo; la ✕ la cierra hasta el día siguiente (`recordatorioRespaldoCerrado`).

**Resumen (Fase 7b).** Selector de mes ‹ › y filtro de cuenta (oculto con una sola) como en Historial. Muestra el total del mes por moneda, sin convertir, con la variación frente al mes anterior en la misma moneda ("↑ 12 % vs septiembre"; "Sin gastos en septiembre para comparar" si el mes anterior está en cero), y barras horizontales por categoría de mayor a menor con monto y porcentaje. Con varias monedas hay un selector de moneda para las barras (por defecto la moneda predeterminada si tiene gastos en el mes; si no, la de más gastos, y a igual cantidad la de mayor total). Al tocar una categoría se abre Historial con ese mes, cuenta y categoría ya filtrados. Sin gastos en el mes: estado vacío. Solo HTML y CSS.

**Almacenamiento (Fase 7b).** Ajustes → "Almacenamiento" (última sección): espacio usado y disponible (`navigator.storage.estimate`), si es persistente (con el botón "Pedir almacenamiento persistente" si no lo es), y la cantidad de gastos y fotos con el peso aproximado de las fotos. Si las APIs no existen (p. ej. por HTTP) muestra "No disponible en esta conexión".

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
4b. **Cuentas.** Tabla `cuentas` y campo `cuentaId` en gastos (migración de Dexie a versionEsquema 2: los gastos existentes pasan a "Personal"), chip de cuenta en Registrar (oculto con una sola cuenta activa; se recuerda en `ultimaCuenta`), filtro de cuenta y cuenta visible por fila en Historial, cambio de cuenta al editar, y sección "Cuentas" en Ajustes (crear, renombrar, emoji, reordenar, predeterminada, archivar/desarchivar, borrar solo sin gastos).
   - [ ] La migración conserva todos los gastos existentes (ni se pierden ni se duplican) y los asigna a "Personal".
   - [ ] Registrar un gasto sigue tomando 3 toques; el chip de cuenta cambia de color si no es la predeterminada y el aviso "Guardado · Deshacer" nombra la cuenta.
   - [ ] Historial filtra por cuenta combinado con mes y categoría; los totales por día respetan el filtro y siguen separados por moneda.
   - [ ] Una cuenta con gastos no se puede borrar, solo archivar; siempre queda una cuenta activa.
5. **Fotos del recibo.** Cámara, compresión, miniatura en historial, visor a pantalla completa.
   - [ ] Cada foto guardada pesa menos de 500 KB, salvo cuando no se pueda sin bajar de calidad 0,6 o de 900 px de lado corto; en ese caso se guarda igual.
6. **Exportación.** CSV y ZIP, menú Compartir, "Solo nuevos".
   - [ ] El CSV se importa en Google Sheets con fechas y montos reconocidos como tales.
   - [ ] Exportar "Solo nuevos" dos veces seguidas no genera un segundo archivo: avisa "No hay gastos nuevos desde la última exportación".
7. **Categorías, navegación, respaldo y resumen.** Se divide en dos entregas:
   - **7a. Categorías editables por cuenta, navegación hacia atrás y pendientes.** Catálogo único de categorías con visibilidad y orden por cuenta (migración de Dexie a versionEsquema 4), sección "Categorías" en Ajustes, cuadrícula de Registrar por cuenta, edición y filtro de Historial con categorías ocultas, botón "← Atrás" y Atrás de Android en toda hoja (History API) con "¿Descartar cambios?", aviso de descarga en el celular, visor sin texto de diagnóstico y fórmula de Sheets con "Importados" y "Gastos".
     - [ ] La migración conserva todos los gastos y deja en cada cuenta las categorías activas de antes, en el mismo orden.
     - [ ] Cada cuenta muestra en Registrar sus categorías en su orden (3 columnas, hasta 4 filas, sin scroll) y la cuadrícula cambia al instante al cambiar de cuenta; registrar sigue siendo 3 toques.
     - [ ] El botón Atrás de Android, también en la app instalada, cierra la hoja abierta (la de arriba si hay anidadas) en lugar de salir de la app; con cambios sin guardar pregunta "¿Descartar cambios?".
   - **7b. Respaldo, resumen y almacenamiento.** Respaldo JSON (con las categorías y la lista `categoriaIds` de cada cuenta), restauración con fusión, pantalla Resumen y estado del almacenamiento en Ajustes.
     - [ ] Restaurar un respaldo en un navegador limpio recupera gastos y fotos.

Pruebas: Vitest para la lógica (formato de montos, generación de CSV, fusión de respaldos) y una lista de verificación manual en el celular al cerrar cada fase.

## Problemas conocidos

- **El CSV se descarga como `gastos_….csv.xls` en Windows.** Pasa cuando Chrome tiene activado "Preguntar dónde guardar cada archivo antes de descargar" (`chrome://settings/downloads`) y Excel está instalado: la descarga pasa por el cuadro "Guardar como" de Windows, que toma la extensión del tipo asociado a `.csv` en el registro (`HKCR\.csv` → `application/vnd.ms-excel` → `.xls`) y la agrega al nombre. Excel avisa entonces que el formato y la extensión no coinciden. Solución: desactivar ese ajuste de Chrome (la descarga directa conserva el nombre exacto) o renombrar el archivo quitando `.xls`. Probado: `showSaveFilePicker` usa el mismo cuadro y no lo evita, por eso la app no lo usa.

- **"File can't be downloaded securely" al exportar un ZIP en el celular (nivel 2a).** Chrome bloquea la descarga de archivos comprimidos cuando la página se sirve por HTTP (`http://<IP-LAN>:4173/app_gastos/`); por HTTPS (GitHub Pages, nivel 3, o `localhost`) no ocurre. Es una restricción del navegador, no un fallo de la app. Con HTTP, tocar "Conservar" en el aviso de Chrome (o probar el ZIP en el nivel 3). Antes de exportar, la app avisa: "Por HTTP, Chrome puede bloquear la descarga del ZIP; toca Conservar en el aviso de Chrome". El CSV no se bloquea.
- **Compartir un ZIP no hace nada en la app instalada (Android).** Chrome en Android no permite compartir `application/zip` con la Web Share API (solo imágenes, texto/CSV, PDF, audio y video). La app ya no ofrece "Compartir el ZIP" cuando `canShare` dice que no; usa "Compartir datos y fotos" o "Descargar el ZIP".

## Cómo probar antes de instalar

Cada fase se prueba primero en la laptop y después en el celular, sin instalar la app hasta que todo funcione. Al cerrar cada fase, Claude Code debe dar las instrucciones del nivel que corresponda con las URL y comandos exactos.

| Nivel | Dónde | Cómo | Qué sirve para probar | Límite |
| --- | --- | --- | --- | --- |
| 1. Laptop | Chrome en Windows | `npm run dev`, abrir `http://localhost:5173`, F12 y Ctrl+Shift+M para vista de celular | Flujo completo, IndexedDB (DevTools → Application), modo offline (casilla Offline) | La cámara usa la webcam o un selector de archivos |
| 2a. Celular por Wi‑Fi | Chrome Android, misma red | `npm run dev -- --host`, abrir la IP que indique Claude Code (p. ej. `http://192.168.1.20:5173`) | Interfaz con el dedo, teclado, cámara real, compartir | Sin HTTPS: no hay modo offline ni instalación |
| 2b. Celular por USB | Chrome Android con depuración USB | `chrome://inspect` en la laptop → Port forwarding `5173 → localhost:5173`; abrir `localhost:5173` en el celular | Todo lo anterior + modo offline, y depurar el celular desde la laptop | Requiere activar Opciones de desarrollador |
| 3. Celular en línea | Chrome Android, URL de GitHub Pages | Abrir la URL sin tocar "Instalar app" | Verificación final de la fase, igual a la app real | Ninguno |

**Pruebas con la cámara (nivel 2a).** No uses `npm run dev -- --host` para probar la cámara: el cliente de Vite en desarrollo recarga la página al volver de la cámara y se pierden el monto y la foto. Haz las pruebas con cámara con `npm run build` y `npm run preview -- --host`, y abre `http://<IP-LAN>:4173/app_gastos/` (puerto 4173; hay que volver a correr `npm run build` después de cada cambio). Sigue siendo HTTP, así que no hay modo offline ni instalación, y Chrome puede bloquear la descarga de un ZIP ("File can't be downloaded securely"; ver "Problemas conocidos"): para probar el ZIP y "Compartir datos y fotos" usa el nivel 3.

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
