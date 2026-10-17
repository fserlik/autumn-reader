# TTS local: arquitectura, modelos y compilación

Autumn Reader ofrece tres motores desde **Configuración → Texto a voz (TTS)**. `system` utiliza las voces offline informadas por Windows Web Speech o por `android.speech.tts.TextToSpeech`. `piper` y `kokoro` sintetizan dentro del proceso de la aplicación mediante `sherpa-onnx` 1.13.8. El texto del libro no se envía a un servicio externo.

## Componentes

- `src/services/tts/engines.ts`: contrato común y adaptadores Sistema/Piper/Kokoro.
- `src/services/tts/catalog.ts` y `catalog-data.json`: registro de compatibilidad para conservar modelos instalados por versiones anteriores; no se presenta como catálogo descargable.
- `src/services/tts/preferences.ts`: motor y voz predeterminados globales; velocidad, tono y voz temporal aislados por cuenta y libro.
- `src/services/tts/player.ts`: ciclo de vida del audio neural.
- `src-tauri/src/tts.rs`: inspección, SHA-256, extracción segura, almacenamiento privado, combinación de voces Kokoro, inicialización sherpa-onnx, síntesis WAV y cancelación.
- `src/main.ts`: cola de párrafos, pre-generación de un fragmento, sincronización visual y controles del lector.

Los modelos se guardan en `<app_data_dir>/tts-models`. El usuario obtiene los archivos por su cuenta y el selector nativo los copia primero a `app_data`; la aplicación no contiene una tienda, un catálogo online ni una ruta de descarga de voces. Un directorio `.importing` solo se renombra después de comprobar estructura, límites de expansión e inicialización. Los restos de una instalación interrumpida se limpian al iniciar.

La pantalla contiene una única **Biblioteca de voces**: voces del sistema detectadas y voces locales realmente instaladas. Permite escuchar una muestra, seleccionar la predeterminada y eliminar únicamente voces administradas por Autumn Reader. La acción **Importar voz** acepta paquetes `.tar.bz2` Piper/Kokoro preparados para sherpa-onnx y bloques individuales Kokoro 1.0 `.bin` de 522.240 bytes. No se confía sólo en la extensión: Rust valida contenido, dimensiones, valores float finitos y genera audio antes de registrar una voz.

Sherpa-onnx exige un `voices.bin` combinado con el número de hablantes fijado por el modelo; no acepta directamente un único bloque `.bin`. Autumn Reader conserva el `voices.bin` original intacto y crea un solo índice derivado por modelo base. Cada voz importada ocupa una ranura distinta de ese índice. Varias voces comparten el mismo modelo ONNX, datos fonéticos e índice combinado; no se duplica el modelo por voz. Al eliminar una voz se reconstruye el índice derivado desde el original y las demás voces, sin borrar el modelo base.

Los nombres `af_*`/`am_*` se detectan como inglés de Estados Unidos y `bf_*`/`bm_*` como inglés británico. Otros prefijos requieren idioma indicado por el usuario porque el frontend de idioma incluido en un paquete sherpa puede no soportarlos. Las voces individuales del repositorio Kokoro 1.0 sólo se habilitan con un modelo base identificado como compatible. Si falta, el diálogo conserva la voz seleccionada mientras el usuario importa manualmente el paquete base.

Una voz importada por el usuario se etiqueta como `licencia no verificada`: Autumn Reader no la redistribuye ni presume que pueda utilizarse comercialmente. El usuario debe revisar la licencia del modelo y de sus datos de voz. Volver a importar el mismo archivo no duplica el modelo, porque el identificador deriva de su SHA-256.

## Compatibilidad y licencias

El registro legado conserva identificadores, tamaños y SHA-256 de los paquetes oficiales que versiones anteriores podían instalar. Sirve para reconocer esas instalaciones, no para mostrarlas ni descargarlas. Los nuevos archivos son aportados por el usuario y Autumn Reader no presume una licencia de redistribución.

Antes de una publicación comercial se deben conservar los avisos Apache-2.0 de sherpa-onnx/Kokoro y comprobar por separado la licencia de cada modelo y voz importada. La aplicación muestra el archivo como importado, no como contenido licenciado o distribuido por Autumn Reader.

## Compilar

Windows (Rust estable y requisitos de Tauri/WebView2):

```powershell
npm ci
npm run desktop:portable
```

Android ARM64 (Java 17, Android SDK y NDK configurados, target Rust `aarch64-linux-android`):

```powershell
npm ci
npm run android:local
```

Antes de compilar Android, `scripts/prepare-android-sherpa.ps1` descarga el AAR oficial `sherpa-onnx-1.13.8.aar`, verifica su SHA-256 fijado y copia únicamente las bibliotecas ARM64 requeridas a `jniLibs`. Esos archivos son artefactos generados y no se versionan. Android enlaza sus `.so` propias; no reutiliza el binario de Windows. La importación y síntesis TTS no necesitan internet; otros servicios de Autumn Reader pueden seguir requiriendo el permiso `INTERNET`.

## Validación manual de entrega

1. En Windows y en un Android físico, importar una voz Piper, reproducir la muestra, reiniciar y leer un EPUB y un PDF sin conexión.
2. Importar un modelo base Kokoro 1.0 y dos voces `.bin`; comprobar que ambas sintetizan y que sólo existe una copia del modelo base.
3. Eliminar una de las voces Kokoro; confirmar que la otra y el modelo base continúan funcionando.
4. Detener, cambiar de libro y cerrar el lector mientras sintetiza; no debe sonar una respuesta tardía.
5. Comprobar pausa/reanudación, cambio de fragmento, resaltado, velocidad y persistencia por libro. El tono solo está activo con el motor del sistema.
6. Reiniciar y comprobar que voces, modelo compartido y preferencias permanecen disponibles.

La emulación móvil de Playwright verifica composición y comportamiento web, pero no reemplaza la prueba del WebView, TTS del fabricante, memoria y audio de un teléfono real.
