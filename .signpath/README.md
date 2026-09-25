# Firma de instaladores Windows

La release pública actual `v0.4.1` no está firmada. Este flujo solo publica una nueva release en borrador si SignPath devuelve un instalador con una firma Authenticode válida de SignPath Foundation.

## Solicitud a SignPath Foundation

Solicitar el programa gratuito en <https://signpath.org/apply> con estos datos públicos:

- Proyecto: Autumn Reader
- Repositorio: <https://github.com/fserlik/autumn-reader>
- Descargas y política de firma: <https://autumnreader.lat/#descargas> y <https://autumnreader.lat/firma.html>
- Política de privacidad: <https://autumnreader.lat/privacidad.html>
- Licencia: MIT
- Descripción: lector de libros de escritorio de código abierto. La biblioteca se guarda localmente y el usuario puede crear copias opcionales en su propia cuenta de Google Drive.

SignPath Foundation revisa la solicitud y puede rechazar proyectos que aún no tengan reputación pública suficiente. La cuenta de GitHub y las cuentas de SignPath con acceso deben usar autenticación de dos factores.

## Configuración después de la aprobación

1. En SignPath, crear o usar el proyecto aprobado y cargar [artifact-configurations/windows-installer.xml](artifact-configurations/windows-installer.xml) con el slug `windows-installer`.
2. Configurar una política de firma de release para las compilaciones de etiquetas del repositorio, con verificación del origen y aprobación manual.
3. En GitHub Actions, crear el secreto `SIGNPATH_API_TOKEN` y las variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` y `SIGNPATH_SIGNING_POLICY_SLUG` con los valores de la cuenta y la política aprobadas.
4. Incrementar la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`; crear la etiqueta correspondiente, por ejemplo `v0.4.2` para la versión `0.4.2`.
5. El flujo [release.yml](../.github/workflows/release.yml) compila el instalador en GitHub, solicita la firma, comprueba que sea válida y crea una release en borrador. Revisar el borrador antes de publicarlo.

El flujo falla antes de publicar si faltan las credenciales, la versión no coincide o la firma no es válida. Los instaladores anteriores no se vuelven firmados al activar este proceso.
