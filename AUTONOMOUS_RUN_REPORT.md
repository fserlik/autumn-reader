# Autumn Reader — informe de ejecución autónoma

Informe inicial: 28/09/2026. Última fase: 29/09/2026. Workspace: `D:\autumn-reader`.

## Actualización: biblioteca compacta, idiomas y EPUB histórico (29/09/2026)

**Causa raíz del error de sincronización:** `shared/book-file.ts` exigía que el miembro `mimetype` fuese la **primera entrada** del ZIP EPUB. Algunos EPUB que el lector ya abre tienen otros miembros antes; su Blob histórico de IndexedDB puede además carecer de MIME y de `format`. El cliente abortaba antes del hashing con `invalid_format`, y el backend compartía la validación restrictiva. Nombres con guiones/underscores/Unicode no son la causa.

**Solución:** el cliente identifica PDF por `%PDF-`/`%%EOF` y EPUB por el directorio central ZIP, un miembro `mimetype` real sin compresión con `application/epub+zip`, `META-INF/container.xml` y un `.opf`. Acepta `mimetype` en otra posición, pero rechaza un ZIP cualquiera renombrado. Normaliza `format` del libro antiguo en IndexedDB sin modificar el Blob ni el SHA-256, y el backend vuelve a validar los bytes de staging antes de crear el objeto canónico o autorizar el libro. Errores `corrupt_epub`, `corrupt_pdf` y `unrecognized_format` tienen mensajes diferenciados. El archivo original queda intacto; no hay que reimportarlo.

La UI de biblioteca de escritorio usa tarjetas horizontales compactas con portada, autor, estado de lectura, progreso y estado cloud (local/nube/sincronizando/error). Acciones secundarias están en el menú `⋮`; estado y carpeta siguen visibles para teclado/touch. Se añadieron cuadrícula/lista y seis ordenamientos locales, ambos con preferencia de vista persistida, y contadores por carpeta. En desktop el libro se arrastra con una miniatura flotante de portada que se reduce y sigue el puntero; la carpeta muestra borde y “Soltar aquí”, y confirma visualmente el drop. Un drop fuera se cancela. El movimiento se aplica en IndexedDB de inmediato y usa el outbox existente; Android conserva el selector sin drag de escritorio.

Las cadenas de carpetas, búsqueda, historial, espaciado, traducción, sincronización, errores, cuenta, reseñas, perfiles, menús y ARIA ahora usan el sistema i18n existente para **inglés, español, italiano y francés**. Como el idioma previo ya requería reinicio, las nuevas pantallas adoptan el idioma guardado al iniciar igual que el resto. `tests/unit/i18n.test.ts` verifica presencia de claves, placeholders, colores y selección de idioma. Se revisaron las cadenas españolas fuera de los diccionarios; los nombres propios de idiomas del selector se muestran en su propio idioma.

Archivos principales: `shared/book-file.ts`, `src/services/storage/index.ts`, `src/services/sync/migration.ts`, `src/services/errors.ts`, `src/main.ts`, `src/style.css`, `src/ui/library-drag.ts`, `src/ui/folders.ts`, `src/ui/sync.ts`, `src/ui/account.ts`, `src/ui/reviews.ts`, `src/ui/social-details.ts`, `src/ui/book-search.ts`, `src/ui/translation.ts`, `src/i18n.ts`, `src/i18n-extra.ts`, `src/i18n-extra-more.ts` y `supabase/functions/book-storage/handler.ts`. Tests nuevos/actualizados: `tests/unit/book-file.test.ts`, `tests/unit/i18n.test.ts`, `tests/library-ux.spec.ts`, regresiones previas de lector y `supabase/functions/book-storage/handler_test.ts`.

**Nuevas migrations que debes aplicar: ninguna en esta fase.** La última sigue siendo `202609290011_folder_note_colors.sql`. No ejecutar `npx supabase db push` por estos cambios si 001–011 ya están aplicadas; si faltan migrations previas, seguir la guía existente. **Edge Function modificada:** `book-storage`. Una vez revisado en tu proyecto de pruebas, ejecutar `npx supabase functions deploy book-storage --no-verify-jwt`. No hay Edge Function nueva ni variables de entorno nuevas. No se desplegó nada ni se modificaron recursos cloud reales.

Validación final: `npm run build` correcto; `npm test` **45/45**; `npm run check:backend` correcto; `npm run test:backend` **11/11**; `npm run test:reader` **82 aprobadas, 8 omisiones esperadas entre desktop/touch**; tras localizar nombres de colores, **6/6** regresiones de carpeta/nota en escritorio y Android; `cargo check --manifest-path src-tauri/Cargo.toml` correcto; `git diff --check` sin errores. Se probaron en navegador la sincronización de EPUB histórico sin MIME/format, error específico de EPUB dañado sin request al backend, drag offline/cancelación/sync posterior, vista/orden persistentes y viewport Android. `npm run desktop:portable` generó **`local-builds/AutumnReader-PC-portable.exe` (9,6 MiB)** y actualizó `local-builds/Autumn Reader.lnk`, verificando el hash de la copia. No se construyó un APK nuevo durante esta actualización.

Pruebas manuales recomendadas: en **Windows**, abrir un EPUB anterior que daba el error, sincronizarlo y abrirlo en otro dispositivo; comprobar un PDF, modo lista/cuadrícula/orden, menú, drag con miniatura/feedback/cancelación, movimiento offline y reintento de sync, y los cuatro idiomas tras reiniciar. En **Android**, verificar importación `content://`, lectura/descarga EPUB y PDF, selector de carpeta sin drag, textos traducidos, persistencia offline y sincronización PC↔Android. Las pruebas automatizadas Android usan viewport/touch de Chromium; falta validar WebView, SAF y lifecycle en un dispositivo físico. Supabase/R2 reales tampoco se probaron por falta de configuración externa.

## Última actualización: animación de página configurable (29/09/2026)

Se inspeccionaron `src/readers/page-turn.ts`, `gestures.ts`, el flujo EPUB.js/PDF.js en `main.ts`, preferencias por dispositivo, Configuración → Interfaz y las pruebas actuales antes de modificar. No se sustituyeron lectores, archivos locales, sincronización ni controles de notas.

- Botones, flechas del teclado y taps laterales usan ahora la transición de página que ya acompañaba al swipe. La hoja visible se desplaza con una inclinación máxima de 2,4° y una sombra de borde suave; el pase confirmado dura unos 260 ms. La vista adyacente sigue usando el libro abierto, sin nueva descarga ni requests por frame.
- Un interruptor accesible en **Configuración → Interfaz** activa/desactiva el efecto. Su valor persiste en `localStorage.autumn-page-turn-animation` y funciona offline. Desactivarlo conserva swipe, botones y teclado, con cambio inmediato de página. `prefers-reduced-motion` del sistema desactiva el efecto visual aunque el ajuste esté activado.
- La posición EPUB/PDF, las notas, resaltados, selección de texto, scroll vertical y la protección del gesto de retorno Android siguen usando el flujo existente. El progreso se persiste después de completar el pase, nunca durante la animación.
- Archivos: `src/main.ts`, `src/readers/page-turn.ts`, `src/style.css`, `src/i18n.ts`; nueva prueba `tests/unit/page-turn.test.ts`, ampliadas `tests/reader-features.spec.ts`; documentación en `docs/cloud-architecture.md` y este informe.
- **Nueva migration para esta actualización: ninguna.** No hay Edge Functions, variables de entorno, servicios cloud, dependencias ni permisos Android nuevos. Aplicar 010/011 de fases anteriores si aún están pendientes.
- Probar manualmente en Windows y Android físico: EPUB/PDF con botones y swipe, cancelar un swipe corto, alternar el interruptor, reiniciar, probar teclado y preferencia del sistema de reducir movimiento. Chromium desktop/touch comprueba comportamiento, pero no mide FPS del WebView real ni sustituye una prueba visual en hardware.

### Validación y portable de esta actualización

`npm run build` pasó con TypeScript estricto; `npm test` pasó 40/40 en 11 archivos; `npm run check:backend` pasó; `npm run test:backend` pasó 10/10; `npm run test:reader` pasó 77/77 con 3 casos no aplicables a escritorio omitidos; `cargo check --manifest-path src-tauri/Cargo.toml` pasó. Las seis pruebas anteriores de PDF se adaptaron para esperar la transición y apuntar al contenido real, no a la copia visual temporal. `git diff --check` no detectó errores (solo avisos de conversión de fin de línea en archivos previos).

`npm run desktop:portable` compiló el release Windows y creó `local-builds/AutumnReader-PC-portable-20260929-164008.exe` (9.999.360 bytes). La aplicación anterior estaba abierta, por lo que el empaquetador conservó el ejecutable base anterior y actualizó `local-builds/Autumn Reader.lnk` para abrir el nuevo. Se verificó que el SHA-256 del destino del acceso directo coincide con `src-tauri/target/release/autumn-reader.exe`. Cerrar la instancia anterior antes de abrir el acceso directo. El aviso de Vite por tamaño de bundles no impide la compilación.

## Actualización anterior: colores de carpetas y notas (29/09/2026)

Se revisaron el almacenamiento y outbox de carpetas, la constraint SQL original de seis colores de nota, el editor y los marcadores EPUB/PDF, así como las pruebas actuales. Los lectores, las notas anteriores, los colores automáticos de carpetas y el trabajo previo del workspace se conservaron.

- Crear/editar carpeta ofrece 14 colores sugeridos, selector nativo para cualquier `#RRGGBB` y **Automático**. El color elegido se guarda localmente con la operación pendiente y viaja a Supabase entre dispositivos; las carpetas antiguas siguen usando el color estable derivado del UUID. La etiqueta alterna blanco/negro según la luminosidad del fondo.
- El editor de notas mantiene los seis colores previos y añade ocho tonos de otras familias, además de un selector RGB personalizado. El color se aplica a la nota, su marcador y el resaltado; se conserva al editar y reabrir EPUB/PDF. El formulario cabe en pantallas móviles con desplazamiento interno.
- `src/book-colors.ts` centraliza paleta, validación estricta y contraste. `src/ui/folders.ts`, `src/services/folders/index.ts`, `src/services/types.ts`, `src/main.ts`, `src/style.css` y `src/i18n.ts` conectan UI, IndexedDB/outbox y lector. `tests/unit/folders.test.ts`, `tests/unit/schema.test.ts` y `tests/reader-features.spec.ts` cubren persistencia offline, sincronización, RLS, colores inválidos y EPUB/PDF. `docs/cloud-architecture.md` documenta el flujo.
- **Nueva migration que debes aplicar:** `supabase/migrations/202609290011_folder_note_colors.sql`, después de 010. Añade `library_folders.color` opcional, permite RGB válido en `notes.color` y actualiza `sync_changes` manteniendo permisos, timestamps y tombstones. Un cliente antiguo sin campo color no borra el color elegido. Ejecutar `npx supabase db push` con el proyecto enlazado y el historial previo registrado. No se modificaron migrations anteriores, ni se aplicó SQL en producción.
- **Edge Functions, variables de entorno, Cloudflare R2 y permisos Android nuevos:** ninguno. Sigue siendo necesario aplicar también la migration 010 de reseñas si está pendiente.
- Pruebas manuales pendientes en servicios reales: cambiar color offline en PC, volver online y abrir la misma carpeta en Android; editar color desde Android y comprobarlo en PC; usar el selector nativo en Windows/Android, cambiar una nota EPUB/PDF y confirmar su marcador tras reinicio. El backend y los dispositivos físicos no se configuraron ni modificaron.

### Validación de esta actualización

| Comando | Resultado |
| --- | --- |
| `npm run build` | TypeScript estricto y Vite correctos; repetido al empaquetar |
| `npm test` | 39/39 en diez archivos; incluye migration 011, RLS, notas RGB, color de carpetas y outbox offline |
| `npm run check:backend` | Correcto |
| `npm run test:backend` | 10/10 |
| `npm run test:reader` | 72 aprobadas y 2 omitidas de 74 combinaciones desktop/Android; las omitidas son gestos touch en desktop, ejecutados en Android |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Correcto en Windows |
| `npm run desktop:portable` | Release Windows correcto |

Se revisaron capturas de carpeta personalizada y del editor de notas en escritorio/móvil. Portable final: **`local-builds/AutumnReader-PC-portable.exe`** (9.998.336 bytes). **`local-builds/Autumn Reader.lnk`** apunta a ese archivo; SHA-256 coincide con el binario release compilado. Cierra la instancia anterior y abre el acceso directo para usar esta versión. No se cerró ningún proceso, no se borraron artefactos previos ni se aplicaron migrations en producción. `git diff --check` terminó sin errores; el bundle no contiene nombres de variables privadas R2/service-role/DeepL. El aviso anterior de Vite sobre tamaño de bundles permanece sin impedir la compilación.

**Limitaciones:** Las pruebas Android usan Chromium con viewport/touch; queda verificar el picker nativo en un Android físico. No se generó APK nuevo ni se compiló para Linux/macOS. La sincronización de colores cloud fue probada con mock y PostgreSQL/PGlite; aplicar 011 y probar entre PC/Android reales es el paso manual pendiente.

## Actualización anterior: reseñas personales y retirada de Vista (29/09/2026)

Se revisaron de nuevo biblioteca/carpetas, perfil personal y público, servicios de reseñas, caché IndexedDB, tipos, autorización de archivos y las nueve migrations existentes. Se conservaron los cambios anteriores del workspace y los lectores EPUB.js/PDF.js. El usuario confirmó que también quiere reseñar libros exclusivamente locales.

### Funcionalidades y arquitectura

- Se eliminó el selector **Vista**, junto con sus vistas alternativas. Biblioteca muestra carpetas y libros sueltos; abrir una carpeta muestra sus libros y Volver a biblioteca regresa a la raíz. Se conservan búsqueda, organización, sincronización y todos los libros.
- **★ Reseñar** en las tarjetas abre un formulario con 1–5 estrellas y comentario opcional. Las estrellas funcionan con touch y teclado, tienen etiquetas accesibles y muestran también el valor numérico. **Mis reseñas** en Perfil muestra título, estrellas y comentario, con edición, eliminación y paginación de 20. Los perfiles públicos también muestran las reseñas, sin permitir editar las ajenas.
- Los libros exclusivamente locales publican solo título/autor/formato y reseña mediante `publish_book_review`. No se envían bytes, hash ni filename del archivo; no se crea relación `user_books` ni `book_files`, no se usa R2 y no aumenta la cuota de archivos sincronizados. Los libros cloud reutilizan su metadata existente, que el formulario no permite modificar.
- La RPC deriva el propietario de Auth y valida rating, comentario y metadata. Conserva UNIQUE por usuario/libro y las RLS anteriores. Un índice y bloqueo por cuenta limitan a 100 fichas nuevas en 24 horas; los recibos privados no son accesibles al cliente y permanecen al eliminar una reseña. Reseñar nunca concede acceso al EPUB/PDF de otra cuenta.
- Los borradores y páginas de reseñas cargadas se guardan por propietario en el store IndexedDB `cloud_state`, sin cambiar la versión ni borrar datos existentes. Debounce y guardado al cerrar/ocultar preservan cambios locales. Offline se pueden consultar reseñas cacheadas y editar/guardar borradores; publicar o eliminar del servidor requiere conexión. Publicar es explícito: los borradores no se envían automáticamente al reconectar.
- Se reutilizan las pantallas sociales y servicios actuales; no se añadieron dependencias, plugins de plataforma, secretos frontend ni llamadas R2 desde componentes.

### Archivos principales

- `src/ui/folders.ts`, `src/main.ts`, `src/style.css`: retirada del selector, botones de reseña y presentación adaptable.
- Nuevos `src/services/reviews/personal.ts` y `src/ui/reviews.ts`: servicio de publicación, caché/borradores privados, estrellas y reseñas personales.
- `src/ui/profile-page.ts`, `src/ui/social-details.ts`: integración en perfiles y fichas públicas, edición/eliminación y reutilización del formulario.
- `src/services/types.ts`: firma estricta de la RPC.
- Nueva `supabase/migrations/202609290010_review_catalog.sql`: catálogo de metadata, recibos privados y RPC autenticada.
- Nuevos `tests/unit/reviews.test.ts`, `tests/reviews.spec.ts`; ampliados `tests/unit/schema.test.ts`, `tests/helpers/cloud.ts`, `tests/reader-features.spec.ts`.
- `docs/cloud-architecture.md` y este informe: arquitectura, configuración y pruebas manuales.

### Validación

| Comando | Resultado |
| --- | --- |
| `npm run build` | TypeScript estricto y Vite correctos |
| `npm test` | 37/37 en diez archivos, incluidos permisos SQL mediante PostgreSQL/PGlite |
| `npm run check:backend` | Correcto |
| `npm run test:backend` | 10/10 |
| `npm run test:reader` | 66 aprobadas y 2 omitidas de 68 combinaciones desktop/Android; las omitidas son gestos touch en desktop, ejecutados en Android |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Correcto en Windows |
| `npm run desktop:portable` | Release Windows correcto; copia y acceso directo verificados |

Las pruebas nuevas verifican publicación local sin upload/download, estrellas/comentario, edición/eliminación sin pérdida de libros, borradores tras reiniciar/offline, errores conservando texto, aislamiento entre cuentas, lectura pública, permisos RLS y paginación. Se revisaron capturas del formulario y perfil en escritorio/móvil. El build mantiene el aviso previo sobre bundles grandes, sin errores. No se eliminaron pruebas existentes para ocultar fallos.

### Configuración manual al volver

**Nuevas migrations que debes aplicar:** `202609290010_review_catalog.sql`, después de 009. Con el proyecto Supabase ya enlazado y las anteriores registradas en el historial:

```sh
npx supabase db push
```

Si venías aplicando SQL manualmente, ejecutar el contenido completo de la nueva migration en SQL Editor y alinear el historial antes de pasar al CLI. No se modificaron migrations anteriores ni se ejecutó SQL sobre producción. Sin esta migration los borradores siguen disponibles y la publicación informa que falta configurar las reseñas.

**Edge Functions nuevas/modificadas: ninguna. Variables nuevas: ninguna. Configuración adicional de Cloudflare R2: ninguna.** Se mantiene la configuración Supabase/Auth/R2 de las fases anteriores; no hace falta volver a desplegar funciones por esta actualización.

**Windows:** cerrar la app anterior y abrir el acceso directo de `local-builds`; reseñar un libro local, comprobar que no aumenta la biblioteca cloud, ver/editar/borrar desde Perfil y confirmar que el libro permanece. Repetir offline guardando un borrador y reiniciando. Probar estrellas con teclado y abrir/cerrar carpetas sin el selector Vista.

**Android:** probar estrellas y comentario con teclado virtual, scroll del formulario, orientación, suspensión/reanudación y borradores offline. Con la migration aplicada, abrir la misma cuenta en otro dispositivo y comprobar las reseñas publicadas; con B comprobar lectura de A y denegación de edición/descarga del archivo.

**Limitaciones pendientes:** Android se validó mediante Chromium con viewport/touch, no con WebView físico; no se generó APK nuevo ni builds Linux/macOS. Supabase/R2 reales requieren las pruebas manuales indicadas. Los borradores son locales y no se sincronizan hasta publicar. Importaciones locales independientes pueden crear fichas públicas distintas para el mismo título; un UUID estable permite reintentar en el mismo dispositivo, y `migrationSources` conserva el vínculo al migrar su libro a cloud. No se introdujo deduplicación por título ni se alteró la deduplicación de archivos por SHA-256.

### Portable

Portable final: **`local-builds/AutumnReader-PC-portable.exe`**, **9.996.800 bytes**. **`local-builds/Autumn Reader.lnk`** apunta a ese ejecutable y usa `local-builds` como directorio de trabajo. SHA-256 de la copia coincide con `src-tauri/target/release/autumn-reader.exe`. Las versiones anteriores se conservaron; no se cerró ningún proceso del usuario. Cierra la versión abierta y vuelve a iniciar desde el acceso directo para cargar esta actualización. El empaquetado volvió a ejecutar TypeScript/Vite correctamente. La inspección de bundles JavaScript no encontró los nombres de las variables privadas R2, service-role ni DeepL. `git diff --check` terminó correctamente.

## Actualización anterior: carpetas visuales y menú de selección (29/09/2026)

Se inspeccionaron la biblioteca actual, `FolderUI`, servicios privados de carpetas, IndexedDB/outbox, selección/notas y pruebas del lector antes de editar. El punto de partida pasó build, 32 tests unitarios, 10 backend, 58 de navegador y cargo check. Se reutilizaron los lectores y la organización ya implementada.

### Comportamiento implementado

- Se retiraron el botón **Resaltar** y su handler del menú EPUB/PDF. Permanecen **Agregar nota** y **Traducir**. Las notas siguen marcando su fragmento; los resaltados antiguos guardados como notas «Resaltado» se conservan y pueden consultarse/navegarse tras reiniciar.
- Biblioteca abre con **carpetas que tienen silueta de carpeta, nombre y cantidad de libros**, junto a los libros sueltos. El dibujo es SVG original, ligero y local; ocho colores se derivan del UUID para mantenerse entre dispositivos. No se copió la imagen de referencia ni se añadieron dependencias.
- Al asignar un libro a una carpeta desaparece de la raíz. Clic/tap/Enter en la carpeta abre sus libros y muestra la ruta y **Volver a biblioteca**. Desde allí puede renombrarse o eliminarse. Sacar un libro mediante Sin carpeta lo devuelve a la raíz. Eliminar la carpeta conserva libros, archivos, notas y progreso.
- **Todos los libros** continúa como vista opcional. La búsqueda en la raíz encuentra también títulos dentro de carpetas y nombres de carpetas. Entrar en una carpeta/cambiar de vista limpia el filtro anterior; buscar dentro limita los resultados a sus libros.
- Se mantienen persistencia offline, aislamiento por cuenta, outbox y sincronización Supabase existentes. Mover libros no cambia su estado local/cloud ni provoca uploads/downloads R2. No se tocaron servicios, RLS, esquemas de libros o archivos del usuario.
- Nombres insertados mediante textContent, labels accesibles completos, foco de teclado, colores con contraste mínimo 4,5:1, temas claro/oscuro, reduced-motion y layout móvil de 320/390 px. Los nombres largos se limitan visualmente a dos líneas y se muestran completos en la carpeta abierta.

### Archivos de esta actualización

- `src/ui/folders.ts`: raíz, tarjetas SVG, navegación, conteos, filtros y conexión al servicio existente.
- `src/main.ts`: composición de la biblioteca y retirada de Resaltar.
- `src/style.css`: silueta/etiquetas de carpetas y layout adaptable.
- `tests/reader-features.spec.ts`: abrir carpetas, mover/sacar libros, rename/delete sin pérdida, búsqueda, reload offline, fresh-device sin descarga, aislamiento, teclado, nombres seguros/largos, colores estables/contraste y conservación de notas/resaltados EPUB/PDF.
- `docs/cloud-architecture.md`: funcionamiento actual de carpetas y selección.
- Este informe y el portable/acceso directo de `local-builds`.

### Validación final

| Comando | Resultado |
| --- | --- |
| `npm run build` | TypeScript estricto y Vite correctos; también ejecutado al empaquetar Tauri |
| `npm test` | 32/32, nueve archivos |
| `npm run check:backend` | Correcto |
| `npm run test:backend` | 10/10 |
| `npm run test:reader` | 60 aprobadas, 2 omitidas de 62 combinaciones desktop/Android; las omitidas son gestos touch de desktop, ejecutados en Android |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Correcto en Windows |
| `npm run desktop:portable` | Release Windows correcto; copia portable verificada por SHA-256 |

Se revisaron capturas desktop/móvil y claro/oscuro. La última suite completa volvió a pasar después del ajuste para pantallas estrechas. Se corrigió el filtro heredado al abrir carpetas desde búsqueda y el espacio de nombres en móvil. Las pruebas de datos antiguos descargan primero la UI del lector antes de preparar la fixture, evitando que sus escrituras pendientes sustituyan los datos de prueba. Las aserciones de historial comprueban posición real (CFI/página/offset/porcentaje), sin confundir timestamps generales con progreso. No se eliminaron pruebas para ocultar errores.

El empaquetado mantuvo el aviso anterior de Vite sobre tamaño de bundles; no impide compilar. No se encontraron nombres de secretos R2/service-role/DeepL en los bundles JavaScript.

### Portable y pasos al volver

La aplicación estaba abierta y Windows bloqueó el EXE anterior. Se conservó la sesión del usuario y se generó **`local-builds/AutumnReader-PC-portable-20260929-100137.exe`**. **`local-builds/Autumn Reader.lnk`** apunta a esa versión nueva; las versiones anteriores quedan conservadas. Cierra Autumn Reader y vuelve a abrirla desde ese acceso directo para ver los cambios. No se cerró ningún proceso del usuario.

**Nuevas migrations que debes aplicar: ninguna para esta actualización.** No hay Edge Functions ni variables nuevas; no requiere un nuevo `supabase db push` o despliegue. Las migrations 008/009 y la configuración cloud de la fase previa siguen siendo necesarias si aún no las aplicaste.

**Prueba manual en Windows:** mover un libro a una carpeta y comprobar que desaparece de la raíz; abrir la carpeta; sacarlo; renombrar/eliminar sin perderlo; repetir offline y tras reinicio; consultar notas antiguas EPUB/PDF; comprobar que la selección solo ofrece Nota/Traducir. **Android:** repetir tap/apertura/retorno, scroll y nombres largos en portrait/landscape; verificar organización entre PC y móvil contra el proyecto real.

Limitaciones: Android fue probado mediante Chromium con viewport móvil/touch, no en un WebView físico. No se generó un APK nuevo ni builds nativos Linux/macOS. Supabase/R2 se simulan en las pruebas de navegador; no se configuró ni desplegó producción. Los conteos usan la metadata cargada localmente, incluyendo más libros al paginar con Cargar más. Los controles nuevos siguen en español, como los controles de carpetas anteriores.

## Resultado

Se implementaron las cinco fases posibles sin credenciales externas: cuentas Supabase, perfiles, esquema PostgreSQL/RLS, archivos privados en R2 mediante Edge Function, biblioteca cloud lazy, caché IndexedDB, cola offline, migración reanudable y funciones sociales. Se conservaron lectores EPUB/PDF, notas, progreso, favoritos, lectura local y ajustes existentes. Se retiró posteriormente la integración de backup por pedido del usuario, conservando sus archivos ya importados. No se realizó reescritura ni despliegue a producción.

La navegación actual reemplaza Comunidad por Perfil personal con foto, descripción, favoritos y terminados. Configuración está dividida en Cuenta, Página e Interfaz. Las últimas actualizaciones y su validación se detallan al final del informe.

La fase del 29/09 añade carpetas privadas offline/sincronizadas, espaciado real EPUB/PDF reflow, búsqueda local, historial temporal separado del progreso, swipe con vista adyacente y traducción opcional mediante backend. El informe específico de fases A–E se encuentra al final; las cifras y artefactos de apartados anteriores corresponden a ejecuciones anteriores.

La nube queda deshabilitada si faltan variables públicas. Para activarla hay que crear/configurar los servicios indicados en [docs/cloud-architecture.md](docs/cloud-architecture.md). No se presume que esos servicios ya existen.

Se analizaron primero estructura, IndexedDB/StoredBook, PDF/EPUB, notas, progreso, favoritos, portadas, Drive, routing, Tauri/Rust/Kotlin y Android. Se presentó el análisis antes de editar. El build inicial y las seis regresiones PDF iniciales pasaron. El repositorio ya contenía cambios locales del usuario; se conservaron. El diff total incluye esos cambios previos y no debe atribuirse completamente a esta ejecución.

## Fases realizadas

| Fase | Implementación y decisiones | Validación y configuración manual |
| --- | --- | --- |
| 1 | Esquema completo, permisos/grants/RLS, Supabase client estricto, Auth email/password, signup, recovery por TokenHash, persistencia y estados loading/anonymous/authenticated/expired, editor de perfil. Servicios separados de UI. | Build/TypeScript, pruebas SQL/RLS locales y regresiones PDF aprobados. Configurar Supabase, migrations, Auth/SMTP y plantillas. |
| 2 | Backend R2 autenticado, intents, presigned PUT/GET, hash incremental, validación posterior de bytes, objetos inmutables/deduplicados, caché lazy y abstracciones multiplataforma. Portadas optimizadas/locales. | Build, hashing/formato, comprobación Deno y lector aprobados. Crear bucket privado, credenciales acotadas, CORS/secrets/Function. |
| 3 | user_books, progreso/offset PDF/CFI, notas, favorito/status, timestamps separados, outbox transaccional/debounce/batches/backoff, merge preservando offline y migración por checkpoints. | Build, cola/modelos/migración/IDB y lector aprobados. Probar dos cuentas/dispositivos reales y librería existente antes de distribuir. |
| 4 | Páginas públicas de perfil/libro, reviews CRUD/rating, likes, comentarios propios, follows/followers/following, listas públicas/privadas/items y navegación social. | Build, RLS/privacidad social y regresiones lectores aprobados. Verificar policies con A/B en el proyecto propio. |
| 5 | Feed derivado/keyset, índices/paginación, PDF.js dinámico, caché inmediata sin esperar HTTP, offline/logout/aislamiento, reanudación de uploads seleccionados, guía y este informe. | Validación final indicada abajo. No se ejecutó aceptación cloud/device ni pgTAP completo por condiciones externas. |

Los errores encontrados se investigaron y corrigieron: tipos de tablas SDK Supabase, Uint8Array/ArrayBuffer Deno, validaciones SQL de anchors no nulos, carreras entre descarga/merge y ediciones locales, permisos de upsert, pruebas con locators ambiguos, simulación de assets locales offline, logout sin HTTP y watcher Vite sobre artifacts Android bloqueados. No quedan errores de build/test conocidos.

## Archivos importantes

Integración conservando código existente:

- `src/storage.ts`: IDB v2, campos account/cloud, persistencia libro/outbox atómica, aislamiento por cuenta, adapter nativo conservado, archivo cloud en el mismo contrato del lector y actualización independiente de portadas.
- `src/main.ts`: cuenta/sync/perfil, configuración por apartados, importación compartida exclusivamente local, sincronización por selección, biblioteca paginada, descarga al abrir, refresco paralelo del progreso cacheado, notas existentes, status y porcentaje.
- `src/backup.ts`: eliminado al retirar Google Drive/backup; los archivos Android existentes siguen accesibles mediante el adapter local.
- `src/style.css`: paneles y vistas sociales con estilos existentes/responsive.
- `src/readers/pdf-engine.ts`: carga diferida PDF.js/worker; mismas funciones de lectura.

Servicios/UI nuevos:

- `src/services/types.ts`, `client.ts`, `errors.ts`: tipos Book/UserBook/ReadingProgress/Note/Review/Profile/Follow/BookList y SDK/RPC, errores y cliente único.
- `src/services/auth/`, `profiles/`: sesión, lifecycle, login/signup/logout/recovery y perfil.
- `src/services/local/`, `platform/`: IndexedDB preservado, selección File/Blob, UUID compatible y timeouts.
- `src/services/storage/`, `shared/book-file.ts`: BookCache, upload/download, hash, portada y validación compartida.
- `src/services/books/`: transformación y merge cloud↔StoredBook, biblioteca lazy y notas por libro.
- `src/services/sync/`: diff de entidades, cola versionada, drenaje y migración reanudable.
- `src/services/reviews/`, `social/`, `src/ui/`: servicios sociales, cuenta, migración, perfil y detalles públicos sin llamadas R2 en componentes; Comunidad ya no forma parte de la navegación.

Backend/configuración/pruebas:

- `supabase/migrations/202609280001_cloud_schema.sql`
- `supabase/migrations/202609280002_storage_backend.sql`
- `supabase/migrations/202609280003_sync.sql`
- `supabase/migrations/202609280004_activity.sql`
- `supabase/migrations/202609280005_signup_username.sql`
- `supabase/migrations/202609280006_cloud_limits.sql`
- `supabase/migrations/202609280007_profile_avatars.sql`
- `supabase/functions/book-storage/{index,handler,handler_test}.ts`, `deno.json`, `deno.lock`, `supabase/config.toml`.
- `supabase/tests/permissions.test.sql`: pgTAP de roles/permisos.
- `.env.example`, `supabase/.env.example`, `.gitignore`, `scripts/configure-cloud-csp.mjs`, `vite.config.ts`, configs CSP Tauri.
- `tests/unit/`, `tests/cloud.spec.ts`, `playwright.config.ts`, `vitest.config.ts`, package.json/lock.
- `docs/cloud-architecture.md`, `README.md`, este informe.

Se conservaron los cambios preexistentes en iconos, PDF y lectores. El código nativo de backup/OAuth se retiró por pedido explícito posterior del usuario; los archivos locales heredados y su adapter se conservan. No se cambiaron ramas/historial.

Dependencias runtime añadidas: `@supabase/supabase-js` y `@noble/hashes`. Dev: Vitest, fake-indexeddb y PGlite. Backend aws4fetch/Supabase con imports/lock Deno. No framework nuevo, servidor persistente ni Supabase Storage para libros.

## Arquitectura y seguridad implementadas

Cliente Tauri/Vite/TS compartido → Auth/PostgREST + RLS → Edge Function con secretos → bucket R2 privado. IndexedDB es caché y estado durable offline. Los adapters nativos existentes siguen sirviendo archivos Android de Drive. El lector recibe el Blob/ArrayBuffer de siempre.

Book público y autorización user_book se separan de private.book_files. Metadata/reviews/listas públicas no autorizan descargar. Solo backend crea relaciones después de comprobar autenticación y validar archivo. Hash/formato UNIQUE, objeto condicional y lock SQL resuelven uploads iguales simultáneos. Para un usuario nuevo, saber el hash no evita tener que subir los bytes; para un propietario existente se reutiliza la autorización. PUT expira en 5 min, GET en 2 min, intent en 15 min; firmas acotadas a objeto/método/headers/tamaño. Backend no entrega credenciales ni permiso de listado.

Notas/progreso/biblioteca son privados. Reviews/comentarios solo editables por autor; follows solo por follower; listas/items dependen de dueño/visibilidad. Grants por columnas impiden mover dueños/IDs. Funciones privilegiadas revocadas para clientes. Todos los datos de usuario tienen RLS; schema privado no expuesto. No secretos VITE/Rust; build comprueba credenciales privadas conocidas antes de empaquetar.

Ediciones de lectura local + outbox en la misma transacción, sin HTTP en navegación. Debounce 1,5 s, batch 100, versiones de operaciones y retries. LWW separado para progreso/user_book y por nota; tombstones para borrado. Conflictos/errores conservan datos locales. IndexedDB se actualiza de v1 a v2 agregando stores. Migración guarda selección y checkpoints, conserva originales/copia local y reanuda solo uploads autorizados. Caché se particiona por cuenta; sesión expirada permite leer offline y logout explícito oculta datos cloud de esa cuenta.

## Validación final

| Comando/prueba | Resultado |
| --- | --- |
| `npm run build` | PASS: TypeScript estricto y build Vite; también ejecutado por build Android final. |
| `npm test` | PASS: **18 pruebas** en 4 archivos, incluidos hash, validación, IDB legacy, cola/versiones, modelos, merge, portada sin sobrescribir progreso, migración con fallos y permisos PostgreSQL/RLS en PGlite, incluyendo avatares. |
| `npm run check:backend` | PASS: Deno comprueba Edge Function. |
| `npm run test:backend` | PASS: **6 pruebas**; auth/origin, firma limitada, B sin descarga, expiración, bytes alterados y validación antes de autorizar. |
| `npm run test:reader` | PASS: **30 pruebas**; lectores PDF/EPUB, login/registro/recuperación, usuario enviado a Auth, confirmación automática, importación local sin upload por encima de cuota cloud, perfil personal/selector de foto/optimización/reintento/favoritos/terminados y alternativa PNG, configuración por apartados/teclado, caché/offline/recarga/aislamiento, viewport desktop y Android. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS en Windows; sin dependencias de OAuth/backup. |
| `npm run tauri -- android build --debug --target aarch64 --apk --ci` | PASS: Rust ARM64 + Kotlin/Gradle + APK final reconstruido. Java 17/NDK 27.2.12479018. |
| `git diff --check` | PASS sin errores de whitespace; avisos normales LF→CRLF. |
| Auditoría npm al instalar | 0 vulnerabilidades reportadas. |
| pgTAP Supabase completo | NO EJECUTADO: Docker daemon no disponible. Archivo listo; RLS sí ejecutado en PostgreSQL PGlite con roles/Auth simulados. |
| Android real/SAF y sync entre dispositivos | NO EJECUTADO: sin dispositivo conectado ni credenciales cloud. Playwright Android es emulación de viewport. |
| Builds nativos Linux/macOS | NO EJECUTADOS: este entorno es Windows. Código compartido/adapters revisados; aceptación nativa pendiente. |

Frontend: chunk principal ~727 kB Windows / ~734 kB Android y PDF ~495 kB Windows / ~542 kB Android, worker PDF ~1.317 kB. Warning Vite de chunks >500 kB permanece; no es error y PDF ya no aumenta arranque cuando solo se lee EPUB. Gradle informa deprecaciones de dependencias/configuración existentes, sin fallar.

APK generado (debug, ARM64):

`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

Los builds portables se actualizan conservando copia de las versiones anteriores. No se ejecutó el helper Android que limpia directorios. Los builds actuales requieren configurar las variables públicas de Supabase y aplicar las siete migrations; no hay entrada sin cuenta.

## Límites y TODO pendientes

1. Configuración/aceptación real Supabase/R2/SMTP/CORS/firma, pgTAP completo y dispositivos multiplataforma. Nada desplegado, ninguna compra/servicio pago activado.
2. Cloud admite 32 MiB/archivo y cuota lógica inicial 1 GiB/cuenta. Libros locales mayores permanecen intactos. Multipart/validador streaming quedan preparados por abstracción, no implementados.
3. Portadas optimizadas solo en caché local; no subida cloud. cover_url permite extensión separada. Las fotos de perfil sí se importan, optimizan y suben al bucket exclusivo de avatares; requieren migration 007.
4. OAuth/deep links futuros, listas compartidas, realtime, outbox de entidades sociales y feed optativo de libros terminados no implementados. Las funciones sociales actuales requieren conexión; lectura/notas/favoritos sí son offline.
5. Clock futuro >5 min provoca conflicto conservado; corregir reloj y reeditar. Sin realtime, cambios remotos se reciben en refresh/apertura y metadata paginada.
6. IndexedDB no es cifrado ni protección contra acceso al dispositivo; WebView puede rechazar persistencia. Pruebas reales determinarán si añadir adapter filesystem privado para archivos cloud. No se garantiza offline después de limpiar datos/desinstalar.
7. Garbage collection de archivos canónicos sin referencias requiere tarea administrativa segura; no se elimina automáticamente un libro físico compartido. Lifecycle staging y mantenimiento intents se documentaron.
8. Revisar política pública de privacidad antes de distribuir cuentas/social: la página publicada previamente describe una aplicación principalmente local. No se modificó ninguna web externa.

## Pasos al volver

1. Revisar diff conservando tus cambios previos y leer [la guía completa](docs/cloud-architecture.md). No borrar IndexedDB/origen para probar una actualización.
2. Crear proyecto Supabase, aplicar las 7 migrations y configurar Auth/SMTP/plantillas TokenHash; mantener schema private no expuesto.
3. Crear bucket privado R2 de pruebas, credenciales Object Read & Write limitadas, CORS exacto y lifecycle staging/.
4. Completar `supabase/.env` a partir de su ejemplo; cargar secrets y desplegar manualmente book-storage. URL/service_role provistas por runtime cloud. No introducir ningún secreto en VITE.
5. Completar `.env` frontend con VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY **o** ANON_KEY y VITE_R2_ACCOUNT_ID público. `npm run cloud:csp`; construir usando override generado.
6. Ejecutar `npx supabase test db` con Docker, repetir los comandos automatizados y matriz A/B: A sube/B no descarga, reviews públicas/B no edita A, listas privadas, hash alterado, carreras y expiración.
7. Probar una biblioteca original/backup en copia de desarrollo y migración con fallo intermedio. Migrar desde Configuración conserva originales; verificar cola pendiente antes de cambiar dispositivos.
8. Instalar builds en PC/Android reales, probar SAF/content://, suspensión/reanudación/kill/offline y sincronización PC→Android, Android→PC, PC→PC y Android→Android. Probar Linux/macOS en sus entornos.

Variables frontend: `VITE_SUPABASE_URL`, una key pública `VITE_SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_ANON_KEY`, `VITE_R2_ACCOUNT_ID` público. Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (runtime), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `ALLOWED_ORIGINS`. No subir archivos .env a Git.

## Actualización: acceso antes de la biblioteca

Se añadió pantalla inicial con inicio de sesión/registro y flujos de confirmación/recovery. La biblioteca permanece oculta mientras se carga la sesión; sesión guardada válida abre directamente y caché de cuenta expirada permite continuar offline. Se eliminó posteriormente la entrada sin cuenta por pedido del usuario; una sesión previamente autenticada permite seguir leyendo offline. Cerrar sesión devuelve a la pantalla inicial y limpia los formularios. Configuración solo contiene el botón «Cerrar sesión» en su área de cuenta; editor de perfil reubicado en Comunidad → Mi perfil y mis listas. Se mantiene todo el almacenamiento/lector.

Archivos: src/ui/account.ts, nuevo src/ui/profile.ts, src/ui/community.ts, src/main.ts, src/style.css y tests de navegador. Validación: build TypeScript/Vite correcto, 14 tests unitarios y **16 tests Playwright** aprobados, con revisión de capturas responsive. Los tests nuevos cubren entrada antes de biblioteca, login persistido, registro con confirmación, recovery/password antes de entrar, logout, perfil reubicado y reinicio offline con cuenta expirada. Los tests del backend siguen sin cambios. Portable Windows actualizado en local-builds/AutumnReader-PC-portable.exe conservando copia de la versión previa y el destino del acceso directo.

## Actualización final: cuenta obligatoria, biblioteca local y cuota cloud

Se retiró completamente la integración de Google Drive del cliente y del código nativo: panel, callbacks, OAuth, ZIP backup, IPC, servicio Android, permisos exclusivos, dependencia Play Services Auth y dependencias Rust exclusivas. build.rs y el empaquetado MSIX ya no leen ni incorporan secretos OAuth. Se conserva `LocalLibraryPlugin`/`NativeLibrary` y la ruta histórica `drive-library` exclusivamente para acceder a libros ya importados, sin conexión a Google. No se borraron bibliotecas locales, copias externas ni recursos cloud.

La pantalla de entrada exige login/registro. Se eliminaron «Ya tengo un código de email» y «Continuar sin cuenta» y el selector de tipo. Registro pide Usuario (3–30 caracteres, minúsculas/números/guion bajo). Auth recibe `options.data.username`; la migration 005 crea el perfil atómicamente, normaliza y aplica UNIQUE. No se modifican nombres de perfiles existentes. Registro y recuperación determinan automáticamente el tipo de verificación. El paso pendiente sobrevive al reinicio sin guardar contraseña/token; login con email aún no confirmado vuelve automáticamente al formulario de registro. La sesión persistida y lectura offline de una cuenta recordada se mantienen. Configuración conserva solo logout en su sección de cuenta.

Importar EPUB/PDF guarda localmente y no inicia upload ni genera operaciones cloud. No hay límite artificial de cantidad local; depende del espacio del dispositivo. Los nuevos libros locales quedan asociados a la cuenta importadora y se ocultan para otras cuentas. «Sincronizar» en cada tarjeta elige un libro; también existe selección explícita de toda la biblioteca. La migración reanudable acepta libros antiguos y locales de la cuenta, excluye otras cuentas y libros ya cloud, conserva originales y oculta duplicados tras completar.

Migration 006 agrega `private.cloud_limits`: **1.000 libros / 1 GiB iniciales por cuenta**, preservando los valores anteriores y haciéndolos configurables por administrador. La RPC `library_quota()` muestra solo uso propio. Reservas cuentan uploads pendientes y un trigger evita exceder límites por insert/restauración, incluso fuera del frontend. El límite de archivo cloud sigue en 32 MiB. Errores/cuota no borran ni bloquean libros locales. No se implementaron planes comerciales ni cobros.

Archivos importantes: src/main.ts, src/ui/account.ts, src/ui/sync.ts, src/services/auth/index.ts, src/services/books/index.ts, src/services/types.ts, src/services/sync/migration.ts, src/storage.ts, src/i18n.ts, src/style.css; migrations 005/006; Rust lib/build/Cargo; LocalLibraryPlugin y NativeLibrary; manifest/Gradle Android; tests/helpers/cloud.ts y pruebas de schema/migración/lectores; scripts de portable/MSIX, .env.example, README, docs/cloud-architecture.md y páginas locales de presentación/privacidad. Las páginas externas no se publicaron.

Validación final:

- TypeScript/build Vite: correcto; warning habitual de tamaño de chunks, sin errores.
- `npm test`: **17/17**. Incluye usuario único/rollback y cuota con reservas/restauraciones, además de migración de cuentas y almacenamiento anterior.
- `npm run test:reader`: **20/20**, escritorio y viewport Android; importación offline de tres libros con cuota cloud de uno, sin upload; registro con usuario y sin botones retirados; confirmación/recuperación automáticas; lectores, notas, progreso, persistencia y aislamiento.
- Deno backend: **6/6** y comprobación de tipos correcta. Permisos/firma siguen intactos.
- Rust check y Windows release: correctos; portable **9,5 MiB**, hash idéntico al binario compilado.
- Android debug ARM64: Rust/Kotlin/Gradle/APK correctos. Verificado que el APK contiene LocalLibraryPlugin, no contiene DriveAuthPlugin/DriveImportService y su biblioteca nativa coincide por SHA-256 con el último build. Pruebas Android físicas/SAF y Supabase/R2 reales siguen pendientes.
- `git diff --check`: correcto. Se corrigió una respuesta simulada de error Auth en el test para incluir los headers de versión/CORS exigidos por el SDK; la suite final pasa completa.
- Portable y APK actualizados en local-builds; versiones previas conservadas en previous-builds. El acceso directo apunta al mismo ejecutable. El helper portable ahora conserva otros artefactos y la caché de compilación.

Al volver:

1. Si las migrations 001–004 ya están aplicadas, ejecutar en orden **202609280005_signup_username.sql** y **202609280006_cloud_limits.sql** desde SQL Editor o mediante Supabase CLI. En una base nueva aplicar las seis. No se ejecutaron cambios sobre Supabase de producción.
2. Elegir el límite deseado desde SQL administrativo: `update private.cloud_limits set max_books=50 where singleton;` es un ejemplo; no cambia ni borra libros existentes. No permitir al cliente editar esa tabla.
3. Mantener Confirm signup con `{{ .TokenHash }}` y Reset password con su propio `{{ .TokenHash }}`; SMTP/Auth y R2 privado/CORS se configuran según docs/cloud-architecture.md. No hay selector para el usuario. Confirmación real y carreras entre cuentas requieren probar contra el proyecto configurado.
4. Revisar variables públicas VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (o ANON_KEY) y VITE_R2_ACCOUNT_ID. Secretos R2 y service_role siguen exclusivamente en backend; ya no se requiere configuración OAuth de Google.
5. Usar `local-builds/Autumn Reader.lnk` o AutumnReader-PC-portable.exe. APK actualizado: local-builds/AutumnReader-Android-ARM64-debug.apk. Probar PC↔Android reales, reinicio/offline y la matriz A/B de permisos. Revisar y publicar manualmente las páginas locales de privacidad cuando corresponda; no se realizó despliegue.

## Actualización: Perfil y Configuración por apartados

Se reemplazó Comunidad en el menú por Perfil. La vista personal muestra foto (URL HTTPS), nombre, usuario, descripción, libros favoritos y libros terminados. «Editar perfil» guarda identidad en Supabase utilizando las políticas existentes. La metadata de identidad/URL de foto tiene caché por cuenta para visualizar el perfil offline; si la imagen externa no está disponible se muestran iniciales. El editor requiere conexión. No se publican favoritos ni terminados de otra persona: se consultan solamente las relaciones privadas de la cuenta actual.

Favoritos/terminados tienen consultas filtradas y páginas de 50, por lo que aparecen aunque estén fuera de la primera página general de la biblioteca. Listar el perfil no descarga EPUB/PDF. Las tarjetas reutilizan el lector y sus controles; un libro descargado abre offline y «Volver» regresa a Perfil. Estado de lectura y favoritos también se pueden cambiar en libros exclusivamente locales, sin subirlos automáticamente. Los cambios actualizan Perfil, Inicio y Biblioteca; se preservan la cola durable y el aislamiento entre cuentas.

Configuración se divide en tres pestañas:

- **Cuenta:** cerrar sesión, uso/límite cloud, sincronización y biblioteca del dispositivo.
- **Página:** fuente de los libros; mantiene el punto de extensión para futuros ajustes de lectura.
- **Interfaz:** colores/tema e idioma.

Se conserva la estética, traducciones en español/inglés/italiano/francés, navegación por teclado y layout móvil con cuatro accesos. La página y feed de Comunidad se retiraron de la UI. Las páginas de reseñas/listas/perfiles públicos conservan sus servicios y enlaces desde los libros; no se eliminaron sus datos.

Archivos principales: `src/main.ts`, `src/style.css`, `src/i18n.ts`, nuevos `src/ui/profile-page.ts` y `src/ui/settings.ts`, `src/ui/profile.ts`, `src/ui/account.ts`, `src/ui/social-details.ts` (sustituye `community.ts`), `src/services/profiles/index.ts`, `src/services/books/index.ts`, `tests/profile-settings.spec.ts`, `tests/cloud.spec.ts`, `tests/helpers/cloud.ts` y `docs/cloud-architecture.md`.

No se necesita una migration adicional: se utilizan `profiles.avatar_url/bio/display_name/username` y `user_books.favorite/status` existentes. No se cambiaron permisos cloud, secretos, cuotas ni recursos de producción.

Validación de esta actualización:

- `npm test`: **17/17**.
- `npm run test:reader`: **26/26** en escritorio y viewport Android. Después del ajuste final de actualización de Biblioteca, se volvieron a ejecutar los seis casos de Perfil/Configuración: **6/6**.
- Pruebas nuevas: perfil fuera de la primera página general sin descargar archivos, edición persistida de foto/descripción, lectura offline, volver desde lector, cambios locales sin upload, logout/cambio de cuenta sin datos ajenos, apartados y navegación por teclado.
- Se corrigieron dos problemas del código de pruebas: una aserción de visibilidad con múltiples elementos y una aserción que no esperaba la respuesta asíncrona de Auth. No se ocultaron fallos ni se omitieron casos.
- Capturas revisadas en escritorio y móvil, temas claro/oscuro.
- Windows: TypeScript/Vite y release Tauri correctos; portable de **9,5 MiB** actualizado, SHA-256 verificado y acceso directo conservado.
- Android: TypeScript/Vite, Rust ARM64 y Gradle/APK debug correctos. `local-builds/AutumnReader-Android-ARM64-debug.apk` actualizado (**170.450.991 bytes**); SHA-256 de la copia y biblioteca nativa incorporada verificados. Versiones anteriores de ambos builds conservadas. Pruebas físicas Android y servicios cloud reales pendientes de la configuración/dispositivos indicados anteriormente.
- `git diff --check`: correcto; permanecen avisos normales de conversión LF→CRLF.

En esa actualización la foto se editaba mediante enlace HTTPS. El selector de archivos se implementa en la actualización siguiente. La configuración inicial de Supabase/R2 y las pruebas físicas PC↔Android siguen los pasos anteriores.

## Actualización: foto seleccionada desde archivos

Se eliminó el campo de URL del editor. «Seleccionar imagen» abre el selector File/Blob del WebView, compatible con escritorio y Android sin interpretar rutas/content://. Admite JPG/PNG/WebP de hasta 10 MiB, muestra vista previa circular y nombre, permite descartar el cambio, decodifica/reduce a 256 px y reencodifica WebP de hasta 512 KiB reutilizando la optimización existente. PNG es la alternativa para WebView sin encoder WebP, sin agregar librerías; se preserva el MIME real y la misma clave fija sin extensión. Archivo inválido bloquea guardar hasta sustituirlo o descartarlo. Un fallo de upload conserva la selección y los textos para reintentar.

La foto se sube con la sesión del propietario a **Supabase Storage, bucket exclusivo `avatars`**. Las fotos públicas son independientes de los archivos EPUB/PDF, que permanecen exclusivamente en R2 privado. No hay credenciales privadas nuevas ni dependencias añadidas. Un único objeto `<user_id>/avatar` acota almacenamiento por cuenta; la URL pública versionada se guarda en `profiles.avatar_url`. La caché local conserva también el Blob, actualizado por versión y separado por cuenta, para mostrarlo offline. Se impide que una descarga anterior reemplace la caché de una foto recién editada. CSP admite imágenes del proyecto Supabase sin habilitar imágenes de cualquier dominio.

Migration nueva: **`supabase/migrations/202609280007_profile_avatars.sql`**. Crea automáticamente el bucket público con límite 524288 bytes y MIME `image/webp`/`image/png`, políticas de SELECT/INSERT/UPDATE para el objeto propio y una política restrictiva que bloquea rutas ajenas incluso si existe otra política Storage demasiado permisiva. El servicio Storage impone límites/MIME; el frontend decodifica y reencodifica las imágenes antes de subirlas. La migration no modifica R2 ni las relaciones/permisos de libros.

Archivos: `src/ui/profile.ts`, `src/ui/profile-page.ts`, nuevo `src/services/profiles/avatar.ts`, `src/services/profiles/index.ts`, `src/style.css`, `src/i18n.ts`, CSP desktop/Android y generador, migration 007, tests SQL y navegador, helper portable y documentación. El helper portable ahora prepara una versión nueva y actualiza el acceso directo cuando Windows tiene bloqueado el ejecutable que está abierto, sin cerrar la app ni borrar artefactos.

Validación:

- TypeScript estricto y Vite correctos; build nativo Windows release correcto.
- `npm test`: **18/18**, incluyendo RLS de avatars con una política permisiva adicional simulada: B no puede listar/reemplazar/borrar la foto de A, A no puede crear otras rutas, anónimo no puede listar.
- `npm run test:reader`: **30/30**. Selector/reducción/MIME/tamaño, persistencia de foto y metadata, foto offline, aislamiento de cuentas, archivos inválidos/oversize, upload fallido y reintento, WebView sin encoder WebP con alternativa PNG; lectura EPUB/PDF conservada. Capturas del selector revisadas en escritorio y Android.
- El primer empaquetado encontró el portable abierto y bloqueado: se preparó `local-builds/AutumnReader-PC-portable-20260928-214739.exe` (**9.980.928 bytes**) y se actualizó el acceso directo, sin cerrar la app. El empaquetado final con alternativa PNG ya pudo actualizar el archivo habitual `local-builds/AutumnReader-PC-portable.exe`; SHA-256 verificado y `Autumn Reader.lnk` apunta a este build final. Versiones previas conservadas.
- APK final ARM64 debug actualizado en `local-builds/AutumnReader-Android-ARM64-debug.apk` (**170.450.991 bytes**). TypeScript/Vite, Rust y Gradle correctos; SHA-256 de la copia y biblioteca nativa incluida verificados. `git diff --check` correcto. No se realizaron pruebas físicas macOS/Linux/Android ni subidas al proyecto Supabase real.

Al volver:

1. En Supabase → **SQL Editor**, ejecutar una vez el contenido completo de `supabase/migrations/202609280007_profile_avatars.sql` (001–006 deben estar aplicadas). No se ejecutó esta migration en tu proyecto remoto.
2. Revisar Storage → Buckets → `avatars`: público, 512 KiB, solo WebP/PNG. No hacer público el bucket de libros en R2. No necesita nuevas variables/secrets ni otro backend.
3. Cerrar normalmente la app anterior y abrir **`local-builds/Autumn Reader.lnk`**, que apunta a la versión nueva; Perfil → Editar perfil → Seleccionar imagen → Guardar perfil.
4. Probar en dos cuentas/dispositivos reales: misma cuenta ve su foto, otra cuenta ve la foto pública pero no puede modificarla; reinicio/offline conserva la imagen cacheada. Pruebas reales Supabase/Storage y Android físico pendientes; las automatizadas usan servicios simulados y viewport Android.

## Fase A–E: organización y nuevas funciones del lector (29/09/2026)

### 1. Estado actual analizado antes de editar

Se inspeccionaron de nuevo el árbol y los cambios locales actuales, `main.ts`, ambos motores, PdfTextView, StoredBook/BookNote, IndexedDB/outbox, servicios de biblioteca y migración, Supabase/R2, las siete migrations vigentes, preferencias y tabs, Kotlin/Manifest/Tauri/CSP y selector File/Blob/SAF. Baseline: build correcto, 18 unitarias, 6 backend, 30 navegador y cargo check Windows. Se conservó el trabajo previo del usuario; el diff total incluye cambios de otras fases. No se reescribió el lector ni se cambiaron EPUB.js/PDF.js.

### 2. Funcionalidades implementadas

| Fase | Resultado |
| --- | --- |
| A | Carpetas privadas: crear, renombrar, eliminar sin borrar libros, mover/sacar, Todos/Sin carpeta. Una carpeta por libro inicialmente. IndexedDB v3 y outbox transaccional, sincronización LWW por entidad, aislamiento por cuenta, transferencia de asignación al migrar un libro a cloud. Espaciado global del dispositivo con rangos/reset/persistencia y aplicación real al EPUB adaptable y PDF reflow. PDF original y EPUB fijo conservan layout. |
| B | Historial preciso CFI o página/offset/scroll, volver/adelante/retorno/adopción explícita. Búsqueda de palabras/frases sin distinguir mayúsculas, extracción incremental local, debounce/cache/cancelación, resultados paginados visualmente, navegación y resaltado temporal. Notas/resaltados, enlaces internos y TOC usan posición temporal; no reemplazan el progreso real. PDF sin texto explica la limitación. |
| C | Gestos touch en lector e iframe, contenido siguiendo el dedo, revelación de la página adyacente, animación de completar/cancelar, protección de selección/long press/scroll/controles/multitouch/bordes del sistema, movimiento reducido y cancelación en resize/suspensión. Botones y teclado conservados. |
| D | TranslationService desacoplado, menú Resaltar/Nota/Traducir, selección y destino, detección de idioma, aviso previo al envío, estados offline/error/cuota/configuración. DeepL solamente desde Edge Function autenticada; límite 2.000 caracteres y cuotas atómicas. Proveedor/coste/privacidad documentados antes de integrar. |
| E | Pruebas de regresión y nuevas, RLS/SQL local, preservación v1/v2→v3, límites de memoria/resultados, refresh de carpetas acotado a libros cargados, documentación técnica/configuración/matriz manual y privacidad local actualizadas. Portable Windows preparado conservando versiones previas. |

La posición real permanece en StoredBook; una consulta tiene su propio cursor en ReaderHistory. Consultar una nota o resultado y cerrar conserva el progreso anterior. Continuar leyendo aquí guarda CFI/página y porcentaje nuevos. El historial flota sobre el lector y no cambia su tamaño/paginación. Las preferencias nuevas son globales **por dispositivo**, como tema/familia/idioma existentes, sin introducir sincronización de preferencias que antes no existía.

### 3. Archivos principales de esta fase

- `src/main.ts`, `src/style.css`, `src/pdf-text.ts`: integración en biblioteca, configuración, lector, menús, notas/highlights, navegación y animación.
- `src/services/local/database.ts`: upgrade aditivo a v3; `src/services/types.ts`: tipos de carpetas/asignaciones.
- `src/services/folders/index.ts`, `src/ui/folders.ts`: organización privada, cache/outbox/UI.
- `src/services/sync/operations.ts`, `src/services/sync/index.ts`, `src/services/books/migration.ts`: nuevas entidades, orden de envío y conservación de carpeta al subir.
- `src/services/preferences/page.ts`: valores globales, validación, persistencia y CSS.
- `src/readers/history.ts`, `search.ts`, `gestures.ts`, `page-turn.ts`, `pdf-navigation.ts`: lógica compartida sin APIs exclusivas desktop.
- `src/ui/book-search.ts`, `src/ui/translation.ts`, `src/services/translation/index.ts`, `shared/translation.ts`: paneles y contrato de traducción.
- `supabase/migrations/202609290008_library_folders.sql`, `202609290009_translation_limits.sql`, `supabase/functions/translate-text/`, `supabase/config.toml`, `supabase/.env.example`.
- `tests/reader-features.spec.ts`, helpers EPUB/PDF/cloud y tests unitarios de carpetas/preferencias/historial/gestos/traducción/storage/schema; `package.json` amplía checks backend.
- `vite.config.ts`: excluye `local-builds` del watcher para evitar EXE bloqueados en Windows y rechaza claves privadas de traducción en variables VITE.
- `docs/cloud-architecture.md`, `docs/translation-provider.md`, `docs/privacidad.html`, `README.md` y este informe. La página de privacidad local no se publicó.

No se añadieron dependencias runtime. Las llamadas Supabase permanecen en servicios; R2 no está expuesto a componentes.

### 4. SQL/RLS y backend

**Nuevas migrations que debes aplicar:**

1. **202609290008_library_folders.sql**: library_folders/library_folder_books privadas con RLS del propietario, FK compuestas, índices, tombstones y wrapper sync_changes. La función anterior se conserva como helper privado sin grants a clientes. No elimina libros ni modifica SQL de migrations ya aplicadas.
2. **202609290009_translation_limits.sql**: contadores privados user/day y reserve_translation exclusivamente service_role. No almacena texto. Cuotas por cuenta y presupuesto global protegidos mediante transacción/lock.

Edge Function nueva: **translate-text** (index/handler/tests). La función book-storage se conserva sin cambios en esta fase. verify_jwt=false en config porque el handler verifica sesión con Auth.getUser, como el backend existente; no permite solicitudes anónimas al proveedor. Valida origen exacto, POST, idiomas, cuerpo máximo 16 KiB y fragmento máximo 2.000 caracteres. Solo texto/idiomas salen a DeepL, sin cuenta, email, filename, libro ni notas completas. Timeout 15 s, sin reintentos automáticos y sin errores crudos del proveedor al cliente.

### 5. Variables y configuración al volver

Variables nuevas **solo backend**: `DEEPL_AUTH_KEY` y `DEEPL_API_PLAN=developer` (o legacy-free exclusivamente para un plan antiguo existente). Ninguna nueva variable VITE. SUPABASE_URL/SERVICE_ROLE son inyectadas por el runtime cloud; ALLOWED_ORIGINS se reutiliza. R2/credenciales/CORS/bucket privado no cambian.

1. Enlazar/revisar tu proyecto Supabase y verificar que 001–007 estén aplicadas. Si se usó SQL Editor anteriormente, reconciliar el historial CLI antes de volver a aplicar SQL. No marcar migrations como aplicadas sin comprobarlas.
2. Ejecutar **`npx supabase db push`** para añadir 008/009, o ejecutar los dos archivos completos una vez en SQL Editor, en ese orden. Verificar tablas/RLS propias con dos cuentas. No se ejecutó SQL sobre tu base remota.
3. Abrir el cliente actualizado: los datos IndexedDB se actualizan automáticamente a v3. No limpiar cache/datos ni cambiar el identifier/origen Tauri. Las carpetas funcionan localmente; sincronización requiere 008.
4. Traducción opcional: revisar `docs/translation-provider.md`, obtener manualmente una clave API, completar variables en `supabase/.env` ignorado y mantener ALLOWED_ORIGINS exactos. No crear un plan pago automáticamente.
5. Ejecutar manualmente `npx supabase secrets set --env-file supabase/.env` y **`npx supabase functions deploy translate-text`**. El archivo de secretos CLI no debe incluir nombres SUPABASE_* reservados. Sin clave/despliegue, el resto del lector funciona; traducción informa que falta configurar el servicio.
6. Revisar y publicar personalmente la página de privacidad si corresponde. No se desplegó ni publicó código, SQL, Functions ni sitio durante esta fase.
7. Hacer la matriz de pruebas Windows/Android y PC↔Android con cuentas A/B, descrita en la arquitectura. Linux/macOS necesitan compilación/aceptación en sus entornos nativos.

### 6. Tests y build

| Comando | Resultado final |
| --- | --- |
| npm run build | Correcto: TypeScript estricto + Vite. Aviso de chunks grandes de los lectores conservado. |
| npm test | **32/32**, 9 archivos: hash, modelos/migración/outbox, upgrade v1/v2→v3, organización offline, preferencias, historial, búsqueda, gestos, traducción y las nueve migrations/RLS en PGlite. |
| npm run check:backend | Correcto para book-storage y translate-text. |
| npm run test:backend | **10/10**, 6 almacenamiento + 4 traducción: Auth/origin, permisos/hash/upload, límites/error/cuotas/privacidad. No llaman al proveedor real. |
| npm run test:reader | **58 aprobadas, 2 omitidas**, 60 combinaciones desktop/Android. Los dos casos touch se omiten en desktop sin touch y sí pasan en Android. Se conservan las 30 regresiones previas. |
| cargo check --manifest-path src-tauri/Cargo.toml | Correcto en Windows. |
| npm run desktop:portable | Release Tauri Windows correcto; copia/shortcut conservando versiones anteriores. |
| git diff --check | Correcto, únicamente avisos LF→CRLF. |

Se revisaron capturas del arrastre EPUB/PDF: la página actual se desplaza y se revela contenido distinto de la siguiente. Las pruebas touch usan eventos de entrada Chromium y comprueban que preview/gestos cancelados/selección/vertical no cambian el progreso. Las nuevas pruebas comprueban carpeta offline/reinicio/fresh-device sin descarga y aislamiento, espaciado en capítulo nuevo/tema/tamaño/reapertura, original PDF intacto, frases entre tags EPUB, índice/enlaces/teclado iframe, vuelta precisa sin pérdida de progreso, highlights persistentes y selección enviada al traductor sin metadata.

Tras la suite completa se ejecutaron además **4/4** casos de traducción EPUB/PDF desktop/Android con espera explícita del debounce móvil: el menú no reaparece sobre el traductor. Se comprobó que los bundles no contienen nombres de secretos R2/service_role/DeepL.

El historial también actualiza el ancla si se vuelve a la lectura y se avanza normalmente antes de usar Adelante. La prueba unitaria comprueba A187→consulta42→Volver→leer188→Adelante42→retornar188.

Después del ajuste final se volvió a ejecutar toda la suite de navegador: **58 aprobadas y 2 omitidas (solo touch en desktop)**. Release Windows final correcto: `local-builds/AutumnReader-PC-portable.exe`, aproximadamente 9,5 MiB, con copia SHA-256 verificada. `local-builds/Autumn Reader.lnk` apunta al portable actualizado. Las versiones anteriores se conservaron en `local-builds/previous-builds`; no se cerró la aplicación del usuario ni se borraron artifacts.

Fallos investigados/corregidos: notificación EPUB relocated tardía al volver, barra de historial que repaginaba PDF reflow, precisión decimal en una aserción de estilos, consulta de fixture equivocada, menú de selección móvil con timer pendiente que reaparecía sobre traducción y watcher Vite intentando vigilar un EXE bloqueado durante el empaquetado. Se corrigió el código o el fixture según correspondía y se repitieron las pruebas; no se eliminaron pruebas existentes.

### 7. Limitaciones y pruebas manuales pendientes

- Supabase/R2/DeepL reales no se probaron ni configuraron remotamente. Las automatizadas usan servicios simulados y SQL PostgreSQL local en PGlite; pgTAP contra Supabase completo requiere Docker/proyecto de pruebas.
- Android fue validado en viewport Chromium touch; falta WebView/dispositivo físico, SAF real, lifecycle y Back del sistema. No se generó un APK nuevo en esta fase: el APK anterior de local-builds corresponde a la fase previa. Construir con el comando oficial de la guía; no usar el helper que borra artifacts.
- No se hizo build nativo Linux/macOS. La lógica nueva compartida es TypeScript/File/Blob/WebView, sin rutas de Windows ni nuevos permisos/plugins de escritorio.
- Búsqueda sin OCR; índice por sesión con presupuesto de 20 MiB (una unidad individual grande puede superar el presupuesto), límite 10.000 resultados y ventana visual de 20. Reabrir reconstruye el índice; unidades expulsadas se reextraen sin descargar el archivo. El recorrido EPUB cede ejecución cada 256 nodos, además de entre capítulos/páginas; parsear un capítulo excepcionalmente grande aún depende de EPUB.js/navegador.
- Historial limitado a 50 entradas por sesión; el progreso real es durable. Si quieres convertir una consulta en lectura, usar Continuar leyendo aquí.
- PDF original mantiene layout; su resaltado de búsqueda marca una línea aproximada. Enlaces internos embebidos tienen controles en modo original; PDF reflow permite TOC/notas/búsqueda pero no convierte esos enlaces.
- Traducción requiere Internet, servicio configurado y crédito del proveedor. API Developer ofrece crédito inicial total de 1.000.000 caracteres, sin reinicio mensual; las condiciones/privacidad se revisan manualmente. El límite de la app es 60 peticiones/20.000 caracteres por cuenta/día y 250.000 globales/mes. Los fallos consumen reserva. Sin proveedor configurado no hay traducción, pero las demás funciones trabajan offline.
- Las preferencias de espaciado/destino son por dispositivo; no se añadió sincronización cloud de preferencias. La localización pendiente de esta fase quedó completada en la actualización de biblioteca e idiomas descrita arriba.

**Windows:** abrir biblioteca existente y EPUB/PDF antiguos; carpeta CRUD offline y eliminación sin pérdida; espaciado/capítulos/tema/tamaño; original PDF intacto; A→buscar/nota/enlace/TOC B→volver/adelante/A y comprobar A desde otro equipo; adopción explícita; Ctrl/Cmd+F/flechas/Escape, reduced-motion, traducción seleccionada/offline/error/límite.

**Android:** repetir desde Downloads/proveedores content:// sin rutas tradicionales; portrait/landscape, teclado virtual, cierre de búsqueda, selección/long press/menú; swipe corto/largo/rápido, capítulo siguiente, contenido siguiendo el dedo, vertical/multitouch/borde Back; suspender/resume/rotar a mitad del gesto, cierre forzado con cola pendiente; poco espacio; carpetas/notas/progreso PC→Android y Android→PC. Verificar A/B y traducción contra los servicios reales de pruebas antes de distribuir.

# Rediseño de Home y Profile — 30 de septiembre de 2026

Home muestra el último libro en lectura con portada, título, autor y porcentaje reales. El botón abre el lector en la posición guardada. Debajo hay galerías visuales de lecturas en curso y favoritos, sin controles de administración. Los estados vacíos distinguen una biblioteca vacía de otra con libros todavía sin empezar.

Profile conserva el avatar, la edición y las reseñas existentes. Añade banner ambiental mediante gradientes CSS, estadísticas calculadas a partir de la biblioteca local cargada, estantes de libros en lectura, completados, por leer y favoritos, y una cita local traducida. «Ver todos» abre Library con el filtro apropiado. Library conserva sus controles, grid/list y arrastrar a carpetas.

La tarjeta visual se comparte entre Home y Profile en `src/ui/book-presentation.ts`; el porcentaje procede del mismo `StoredBook.percentage` que utiliza el lector. `src/main.ts` conserva la tarjeta administrativa en Library y reutiliza object URLs de portadas hasta cambiar de cuenta. `src/style.css` implementa variantes claro/oscuro con tokens, layout tablet y móvil, scroll horizontal táctil, safe areas y reduced motion. `src/i18n-presentation.ts` añade todos los textos nuevos en inglés, español, italiano y francés.

Pruebas nuevas o ampliadas: `tests/home-profile-presentation.spec.ts`, `tests/profile-settings.spec.ts`, `tests/unit/book-presentation.test.ts` y `tests/unit/i18n.test.ts`. Se verificaron datos reales, apertura, estadísticas, estados vacíos, ausencia de controles administrativos, enlace a Library, i18n y ausencia de desbordamiento en móvil/tablet. Se inspeccionaron capturas de Home claro y Profile oscuro en escritorio y móvil.

Validación final:

- `npm run build`: correcto, con el aviso preexistente de chunks grandes.
- `npm test`: 49/49.
- `npm run test:reader`: 90 aprobadas, 8 omitidas según plataforma. Tras las últimas aserciones, casos focalizados Home/Profile: 18/18.
- `npm run check:backend`: correcto.
- `npm run test:backend`: 11/11.
- `cargo check --manifest-path src-tauri/Cargo.toml`: correcto en Windows.
- `npm run desktop:portable`: release Windows correcto; ejecutable y acceso directo actualizados en `local-builds`, copia SHA-256 verificada y versión anterior conservada.
- `git diff --check`: correcto; Git solo avisó sobre normalización LF/CRLF.

No hay migrations, Edge Functions ni variables de entorno nuevas para este rediseño. No hace falta ejecutar `supabase db push` ni desplegar funciones específicamente por estos cambios. Las instrucciones cloud pendientes de fases anteriores se mantienen por separado.

Prueba manual en PC: abrir un EPUB y PDF, avanzar y volver a Home; comprobar portada, porcentaje y reanudación. Cambiar estado y favorito en Library y revisar Home/Profile. Alternar tema, idioma y tamaño de ventana; usar «Ver todos» y restablecer el filtro. En Android físico: repetir con orientación vertical/horizontal, carruseles táctiles, safe areas, suspensión/reanudación y lectura offline. Las pruebas automáticas Android emplearon viewport táctil Chromium; todavía falta validar WebView y dispositivo físico. Linux y macOS requieren comprobación nativa.

Limitación: las estadísticas de Profile se calculan sobre libros ya cargados en la caché local. En una biblioteca cloud paginada pueden aumentar al cargar más páginas; no se añadió una consulta cloud solo para contadores.

## Iteración posterior: Home y Profile simplificados

Home conserva solo el hero del último libro en curso y el estante «Continuar leyendo». Se retiraron el botón de importación de esta pantalla y la sección de favoritos; Library mantiene la importación y todas sus herramientas. El estante conserva el desplazamiento nativo con scrollbar visual oculta. En escritorio muestra flechas si hay más libros, admite teclado/trackpad/Shift + rueda y respeta movimiento reducido. En Android permite el gesto horizontal sin flechas grandes.

Profile conserva identidad, edición y contadores. Debajo presenta solo favoritos y reseñas reales con miniatura o portada, valoración y texto; se retiraron los estantes de lectura, completados y por leer. Los libros favoritos abren el lector propio, y «Ver todos» abre Library filtrada por favoritos. No se cambió la lógica del lector, IndexedDB, Supabase ni R2.

Archivos de esta iteración: `src/main.ts`, `src/ui/profile-page.ts`, `src/ui/reviews.ts`, `src/ui/book-carousel.ts`, `src/style.css`, `src/i18n-presentation.ts`, `tests/home-profile-presentation.spec.ts`, `tests/profile-settings.spec.ts`, `tests/unit/i18n.test.ts`, `docs/home-profile-redesign.md`. Traducciones nuevas en inglés, español, italiano y francés; etiquetas accesibles incluidas.

Validación: `npm run build` correcto; `npm test` 49/49; `npm run test:reader` 92 aprobadas y 8 omisiones por plataforma; prueba focalizada de gesto táctil real y controles de carrusel 2/2; `npm run check:backend` correcto; `npm run test:backend` 11/11; `cargo check --manifest-path src-tauri/Cargo.toml` correcto. Sin migrations, Edge Functions ni variables nuevas; no se requiere `supabase db push` ni desplegar funciones para esta iteración. La validación de Android fue con emulación táctil Chromium; sigue pendiente comprobar Android WebView físico, Linux y macOS.

Se reconstruyó `local-builds/AutumnReader-PC-portable.exe` mediante `npm run desktop:portable`; el script conservó la versión anterior, verificó SHA-256 y actualizó `local-builds/Autumn Reader.lnk`. Estos artefactos locales están ignorados por Git.

## Iteración global: barras de scroll invisibles

`src/style.css` aplica `scrollbar-width: none` y `::-webkit-scrollbar { display: none; width: 0; height: 0; }` a los contenedores de la aplicación, sin cambiar `overflow` ni eventos de rueda/touch/teclado. Se eliminó la regla duplicada de las galerías. Los capítulos EPUB son documentos iframe: `standardizeEpubPage()` en `src/main.ts` les añade `autumn-scrollbars` en cada capítulo, incluidos los de la vista previa de página. PDF.js usa la regla global del DOM principal.

Se conservaron el scroll vertical de Home/Library/Settings/Profile, el scroll del lector, PDF original, carruseles, notas, búsqueda y diálogos. La auditoría de layout no encontró desbordamiento horizontal accidental de la página o `.content-area` entre 320 y 1200 px, incluidos Library grid/list con libros. El desbordamiento interno de carruseles y PDF original es intencional. Los menús nativos de `<select>` son dibujados por el WebView/SO fuera del DOM, por lo que una barra propia del menú del sistema puede permanecer.

Se añadieron `tests/global-scrollbars.spec.ts` y `docs/ui-scrollbars.md`. Validación: `npm run build` correcto; `npm test` 49/49; `npm run test:reader` 96 aprobadas y 8 omisiones previstas por plataforma; `npm run check:backend` correcto; `npm run test:backend` 11/11; `cargo check --manifest-path src-tauri/Cargo.toml` correcto. Pruebas Chromium de escritorio y Android emulado verificaron scroll con rueda, Page Down y touch, estilo invisible en EPUB/PDF/diálogo y ausencia de overflow accidental. Android WebView físico, WebKit, Firefox, Linux y macOS requieren comprobación manual. No hubo migrations, Edge Functions, variables ni dependencias nuevas.

`npm run desktop:portable` volvió a compilar la versión Windows y actualizó `local-builds/AutumnReader-PC-portable.exe` y su acceso directo. El script verificó que la copia coincide por SHA-256 con el build release.

## Iteración: edición de libros, reseñas en Profile, hero y animación de página

Library abre el libro al pulsar su tarjeta o portada. El menú de tres puntos ya no ofrece «Abrir» y ahora incluye «Editar libro». El editor permite cambiar título visible, autor y portada con vista previa, validación de tipo/decodificación y optimización WebP. Cancelar no guarda. El nombre físico, los bytes EPUB/PDF, SHA-256, deduplicación y clave R2 no cambian. Home, Profile, Reader y Library usan de inmediato la metadata local. La edición funciona offline mediante IndexedDB y outbox.

La nueva migration `supabase/migrations/202609300001_private_book_metadata.sql` agrega overrides privados por usuario en `user_books`: `display_title`, `display_author`, `cover_path` y `metadata_updated_at`. El RPC `sync_changes` valida propietario y relación activa y resuelve esas ediciones mediante last-write-wins. La portada optimizada queda en IndexedDB y, al volver la conexión, se sube con la sesión del propietario al bucket **privado** `book-covers` de Supabase Storage, creado por la migration con RLS de propietario y pertenencia al libro. Otro dispositivo la descarga al entrar en el viewport. Los archivos EPUB/PDF permanecen exclusivamente en R2; no hay cambios a la Edge Function `book-storage`, a R2 ni a variables de entorno. El catálogo social compartido conserva su metadata original para no alterar las reseñas y vistas de otras cuentas.

Las reseñas propias en Profile son tarjetas estáticas con miniatura de portada real o placeholder existente, libro, autor, estrellas y texto. Pulsarlas no abre detalle. Solo su propietario ve Editar/Eliminar; el borrado exige confirmación y RLS sigue imponiendo propiedad. La vista pública del **libro** continúa disponible para likes y comentarios. Editar/eliminar reseñas todavía requiere conexión; los borradores editables se conservan localmente.

La portada del hero estaba anidada dentro de `.hero-art`, pero la regla CSS genérica `.hero-art img` le aplicaba otra rotación a la imagen además de la rotación del contenedor. Se limitó esa regla a hijos directos y la imagen se recorta dentro de la tarjeta inclinada con `object-fit: contain`; se verificó en desktop y viewport móvil.

Diagnóstico del lector: las animaciones EPUB/PDF no habían sido eliminadas por el CSS global de scrollbars. La animación WAAPI anterior duraba 260 ms con una curva muy adelantada (`cubic-bezier(.22,.72,.24,1)`): en Chromium, el desplazamiento ocurría casi entero durante los primeros ~100 ms y el contenido se percibía como un salto. Las pruebas antiguas solo verificaban existencia de la capa. La transición dura ahora 360 ms y usa `cubic-bezier(.42,0,.28,1)`. Nuevas pruebas muestrean los `transform` de la página y la vista adyacente durante fotogramas intermedios en EPUB, PDF reflow, PDF original y cambio de capítulo, tanto desktop como viewport táctil Android. Botones, teclado, swipe cancelado, selección de texto y progreso mantienen sus pruebas previas. Cuando el SO activa `prefers-reduced-motion`, Configuración → Interfaz muestra «Reducida por el sistema» en los cuatro idiomas; no se puede afirmar que esa preferencia estuviera activa en el equipo del usuario sin probar el WebView instalado.

Archivos principales: `src/main.ts`, `src/storage.ts`, `src/style.css`, `src/ui/edit-book.ts`, `src/ui/reviews.ts`, `src/ui/profile-page.ts`, `src/ui/book-presentation.ts`, `src/readers/page-turn.ts`, `src/services/storage/book-covers.ts`, `src/services/books/models.ts`, `src/services/books/merge.ts`, `src/services/sync/index.ts`, `src/services/sync/operations.ts`, `src/services/sync/migration.ts`, `src/i18n-edit-book.ts`, `docs/cloud-architecture.md` y la migration nueva. Tests nuevos/ampliados: `tests/book-edit.spec.ts`, `tests/reader-animation-visual.spec.ts`, `tests/reviews.spec.ts`, `tests/home-profile-presentation.spec.ts`, `tests/unit/schema.test.ts`, `tests/unit/sync.test.ts`, `tests/unit/i18n.test.ts`.

Validación: `npm run build` correcto; `npm test` **52/52**; `npm run check:backend` correcto; `npm run test:backend` **11/11**; `npm run test:reader` **108 aprobadas, 8 omitidas** según plataforma; pruebas focalizadas finales de editor y animación **14/14** en desktop/Android emulado, incluida transición entre capítulos; `cargo check --manifest-path src-tauri/Cargo.toml` correcto. `git diff --check` sin errores (Git advirtió LF/CRLF). El bundle mantiene el aviso previo de chunk grande. El build portable Windows se ejecutó de nuevo después de estas validaciones.

Al volver: aplicar **`npx supabase db push`** en el proyecto correcto para la migration nueva y desplegar el cliente actualizado. **No hay ninguna Edge Function que volver a desplegar ni variables nuevas.** La migration crea el bucket privado automáticamente; no hacerlo público. Comprobar con cuentas A/B que B no lee una portada privada ni edita metadata de A. En PC y Android reales: editar offline/reiniciar/reconectar, abrir el mismo libro en otro dispositivo, comprobar título/autor/portada y EPUB/PDF original, editar y borrar una reseña propia, probar la vista ajena, hero claro/oscuro y cambio de página con botones/teclado/swipe. Android WebView físico, Linux y macOS siguen pendientes de validación nativa; las pruebas móviles automatizadas usan Chromium con viewport y entrada táctil.

## Corrección de cuota y reintentos cloud — 30 de septiembre de 2026

La captura 14/50 y 19,3/1024 MiB no demostraba que la cuota de libros o bytes estuviera agotada. Settings obtenía esos números de `public.library_quota()` (relaciones `public.user_books` confirmadas y tamaños de `private.book_files`). En cambio, `public.reserve_book_upload()` también rechazaba a partir de tres filas activas de `private.upload_intents` o de sesenta **filas creadas** en una hora, incluso completadas o expiradas. Devolvía `quota_exceeded` para las cuatro condiciones. Además, solo reutilizaba un intent si restaban más de cinco minutos: el mismo libro podía crear filas/slots adicionales al reintentarlo cerca de la expiración. «Reintentar sincronización» vaciaba `pending_sync_operations`, pero no procesaba los libros fallidos en `migration_state`. Estos son defectos demostrados en el código; no hubo acceso privilegiado de lectura a la base remota para determinar cuál de las dos condiciones internas disparó precisamente la captura de esa cuenta.

Hay tres pendientes diferentes: (1) outbox IndexedDB para notas/progreso/metadata, (2) libros locales seleccionados y fallidos en `migration_state`, (3) reservas de subida del servidor en `private.upload_intents`. Settings ahora los distingue y muestra reservas activas/bytes reservados obtenidos por la RPC autenticada. La Edge Function registra solo decisiones de cuota y contadores agregados al rechazar, sin cuenta, hash, nombre, URL ni secretos. El documento `docs/cloud-architecture.md` incluye SQL de solo lectura para comprobar los contadores de una cuenta después de desplegar la migration.

La migration nueva `supabase/migrations/202609300002_upload_quota_retries.sql` deja intactos `private.cloud_limits` (la configuración actual 50 libros/1024 MiB). `private.upload_quota_snapshot()` cuenta relaciones confirmadas, reservas **lógicas distintas** por hash/formato/tamaño no expiradas ni completadas y solo si el usuario aún no posee el libro; suma bytes con la misma definición. El rate limit independiente sigue en 60 archivos **distintos** preparados durante una hora, no 60 filas de retries. Un prepare repetido reutiliza y extiende el intent incluso cerca de expirar; si ya venció, comprueba de nuevo libros, bytes, tres subidas simultáneas y tasa antes de reactivarlo. El lock de `profiles` serializa prepares/commits de la misma cuenta; `complete_book_upload` toma los locks en el mismo orden para evitar deadlock. El trigger de `user_books` vuelve a comprobar libros y bytes al confirmar/restaurar, incluso si otro dispositivo completó mientras tanto. El archivo R2 canónico sigue deduplicado, y cada cuenta requiere su propia relación.

Los intents incompletos dejan de contar a los 15 minutos. La migration y futuras preparaciones eliminan **solo** checkpoints incompletos vencidos hace más de un día; no borran subidas activas, libros locales, relaciones confirmadas ni archivos canónicos. Objetos R2 abandonados en `staging/` dependen de la regla lifecycle ya documentada para ese prefijo, sin afectar `books/`. `book-storage` devuelve errores separados: `book_limit`, `storage_limit`, `pending_upload_limit`, `upload_rate_limited`. Las traducciones nuevas cubren inglés, español, italiano y francés. El botón manual de reintento ahora incluye libros fallidos por cuota y continúa vaciando el outbox; las operaciones de libro conservan sus checkpoints.

Archivos importantes: la migration nueva; `supabase/functions/book-storage/handler.ts` y su test; `src/services/books/index.ts`, `src/services/types.ts`, `src/services/storage/index.ts`, `src/services/errors.ts`, `src/services/sync/migration.ts`, `src/ui/sync.ts`, `src/i18n-upload-quota.ts`, `src/i18n-extra.ts`; `tests/unit/upload-quota.test.ts`, `tests/unit/migration.test.ts`, `tests/unit/schema.test.ts`, `tests/unit/i18n.test.ts`, `tests/upload-quota-ui.spec.ts`, `tests/helpers/cloud.ts`; `docs/cloud-architecture.md`.

Pruebas SQL locales cubren: 14 confirmados + 17 nuevos = 31; 49+1 y 50+1; 49+1 pending; 14+36 pending válidos o vencidos; retries repetidos del mismo archivo; subida fallida/retry; commit idempotente; bytes confirmados/reservados; límite de tres reservas; tasa de 60 archivos distintos; dos dispositivos compitiendo por la última plaza; y limpieza que preserva activos. Playwright prueba los tres contadores de Settings, fallo temporal/reintento y ausencia de uploads duplicados en desktop y viewport táctil Android. Las pruebas son PostgreSQL local simulado con PGlite y servicios mock; falta verificación contra Supabase/R2 reales y Android WebView físico.

**Despliegue manual, en este orden:** `npx supabase functions deploy book-storage --no-verify-jwt` (la función nueva entiende también el error antiguo), luego `npx supabase db push` para aplicar 202609300001 pendiente si corresponde y 202609300002. No desplegar `translate-text`; no hay variables nuevas. Actualizar el cliente instalado. No es necesario cambiar R2 para esta corrección; verificar la regla lifecycle ya prevista para `staging/` de un día si aún no estaba configurada. No se ejecutó ningún comando contra el proyecto cloud ni se limpiaron datos remotos. Tras aplicar, revisar los contadores en Settings y la consulta diagnóstica de la arquitectura; probar el caso 14+17 y 49+1 en un proyecto de pruebas antes de producción. Si hubiese tres reservas realmente activas o sesenta archivos distintos preparados recientemente, se mostrará ese motivo concreto en vez de indicar falsamente que se acabaron los libros.

Validación final de esta corrección: `npm run build` correcto; `npm test` **70/70**; `npm run check:backend` correcto; `npm run test:backend` **12/12**; `npm run test:reader` **112 aprobadas, 8 omisiones** previstas por plataforma, más **4/4** pruebas focalizadas tras añadir el caso de doble clic; `cargo check --manifest-path src-tauri/Cargo.toml` correcto; `git diff --check` sin errores. `npm run desktop:portable` generó un ejecutable Windows nuevo y actualizó el acceso directo; como el ejecutable anterior estaba abierto, el script conservó ambos y apuntó el acceso directo al nuevo archivo con sufijo temporal. La copia fue verificada por SHA-256 contra el release. El warning de Vite por chunk grande es preexistente.

El acceso directo `local-builds/Autumn Reader.lnk` apunta finalmente a `local-builds/AutumnReader-PC-portable-20260930-203148.exe`. No hace falta cerrar la aplicación que estaba abierta para conservar sus datos; hay que iniciar la nueva versión desde el acceso directo tras aplicar los cambios cloud.
