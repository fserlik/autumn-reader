# Autumn Reader

Lector de libros de escritorio, hecho con Tauri 2 y TypeScript. La biblioteca, las cubiertas, los favoritos y el progreso se guardan en este dispositivo. Se puede leer sin cuenta ni conexión.

## Descargar

La versión para Windows está en [GitHub Releases](https://github.com/fserlik/autumn-reader/releases). Descarga el archivo `Autumn Reader_*_x64-setup.exe` de la versión más reciente.

La [página principal](https://autumnreader.lat/) presenta la aplicación y enlaza a la [política de privacidad](https://autumnreader.lat/privacidad.html). Ambas páginas se mantienen como archivos estáticos en [`docs/`](docs/) y se publican en el dominio propio `autumnreader.lat` mediante GitHub Pages.

## Funciones

- Inicio con lecturas recientes y favoritos.
- Biblioteca con búsqueda, cubiertas y gestión de libros.
- Lector con navegación, tamaño ajustable y notas sobre texto seleccionado. Selecciona un fragmento, haz clic derecho y elige **Agregar nota**; la marca de color aparece en el margen y se puede abrir, editar o eliminar.
- Configuración de tema y tamaño inicial del texto.
- Copias manuales en Google Drive para guardar e importar la biblioteca completa.

## Desarrollo

Requisitos: Node.js 24, npm, Rust y los [prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/). En Windows hacen falta Microsoft C++ Build Tools y WebView2.

```bash
npm ci
npm run tauri -- dev
```

Para compilar la interfaz:

```bash
npm run build
```

Para crear un instalador de Windows:

```bash
npm run tauri -- build --bundles nsis
```

Los archivos compatibles para importar son PDF y EPUB; la interfaz los presenta a todos como libros.

## Configurar Google Drive para la release

La integración es opcional. La persona que publica Autumn Reader registra un cliente OAuth una sola vez. Quienes instalen la release solo verán **Iniciar sesión con Google**; no tendrán que introducir un Client ID. Para preparar la integración:

1. Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. [Habilita la Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
3. [Configura la pantalla de consentimiento OAuth](https://console.cloud.google.com/auth/overview). Si tu aplicación está en modo de prueba, añade la cuenta de Google que usarás como usuario de prueba.
4. [Crea un cliente OAuth](https://console.cloud.google.com/auth/clients) de tipo **Aplicación de escritorio** y conserva el JSON descargado. Necesitas su **Client ID** y **Client Secret**.
5. Para desarrollo local, copia [.env.example](.env.example) a `.env` y rellena `VITE_GOOGLE_CLIENT_ID` y `AUTUMN_GOOGLE_CLIENT_SECRET` con los valores del JSON.
6. Para las releases de GitHub Actions, crea la variable de repositorio `GOOGLE_OAUTH_CLIENT_ID` y el secreto de Actions `GOOGLE_OAUTH_CLIENT_SECRET`. El workflow pasa ambos a la compilación.

El Client ID es público. En una aplicación de escritorio, el Client Secret también queda incluido en el ejecutable y no puede tratarse como confidencial; se usa porque el endpoint de Google lo exige para este cliente. El archivo `.env` está excluido de Git. Si falta el Client ID, el botón de Google queda desactivado; si falta el Client Secret, la app avisa antes de abrir el navegador. La cuenta de Google se autoriza en el navegador del sistema.

**Guardar copia** crea un ZIP con los archivos de los libros, cubiertas, favoritos, notas y posiciones de lectura. **Importar copia** añade los libros y actualiza los que tengan el mismo identificador; conserva los demás libros locales. La importación pide confirmación. Las copias se almacenan en el [espacio de datos privado de la aplicación en Drive](https://developers.google.com/workspace/drive/api/guides/appdata), así que no aparecen entre los archivos normales de Mi unidad. Para acceder a ellas desde otra instalación, usa la misma cuenta de Google y una compilación con el mismo cliente OAuth. Cada copia admite hasta 250 MB. Las copias son manuales: guardar una nueva no ocurre automáticamente después de leer.

La conexión usa OAuth para aplicaciones de escritorio con PKCE y un callback local temporal. Solicita únicamente el permiso `drive.appdata`. El token de acceso se conserva en memoria durante la sesión; al reiniciar la app o vencer el token, hay que conectar otra vez. No se guarda un refresh token. Si Google devuelve un error, la app muestra el código y la descripción para facilitar el diagnóstico.

Consulta la [guía OAuth para apps de escritorio](https://developers.google.com/identity/protocols/oauth2/native-app) y la [documentación del espacio de datos de Drive](https://developers.google.com/workspace/drive/api/guides/appdata) para más detalles.

## Publicar una release

El workflow de GitHub Actions genera un borrador de release para Windows al subir una etiqueta que comience por `v`. Primero actualiza la versión en `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`. Después:

```bash
git tag v0.4.1
git push origin v0.4.1
```

Revisa el instalador generado en el borrador de GitHub Releases y publícalo cuando esté listo. El workflow produce una release de Windows; macOS y Linux se pueden compilar localmente con los prerrequisitos de Tauri.

## Identidad visual

La interfaz usa la paleta otoñal proporcionada para el proyecto. La hoja de `src/assets/autumn-leaf.png` procede de la imagen de referencia facilitada para Autumn Reader, preparada con fondo transparente para la interfaz y el icono.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
