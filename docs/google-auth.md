# Inicio de sesión con Google

Autumn Reader usa el proveedor Google de Supabase Auth con PKCE. En web, el navegador vuelve a la misma URL de la aplicación. En las aplicaciones Tauri, Google se abre en el navegador del sistema y vuelve mediante `autumnreader://auth/callback`.

## Configuración de Google y Supabase

1. En Google Auth Platform, crea un cliente OAuth de tipo **Web application**.
2. En **Authorized redirect URIs**, agrega el callback que muestra Supabase en **Authentication → Sign In / Providers → Google**. Para un proyecto alojado suele ser:

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

3. Copia el Client ID y el Client Secret en el proveedor Google de Supabase y habilítalo. El secreto queda únicamente en Google/Supabase; no se agrega a `.env` ni al bundle de Autumn Reader.
4. En **Authentication → URL Configuration → Redirect URLs**, agrega:

   ```text
   autumnreader://auth/callback**
   http://127.0.0.1:1420/**
   https://<dominio-web-de-la-app>/**
   ```

   El sufijo `**` es necesario porque Supabase añade `sb_flow_id` al callback para asociar el código con el verificador PKCE correcto. Conserva solo los entornos que realmente uses.

No hace falta una migration, una Edge Function ni una variable `VITE_*` adicional. Las cuentas nuevas creadas con Google reciben el perfil de respaldo `reader_<id>` del trigger `private.new_profile()` y después pueden editar nombre público y usuario desde Perfil.

## Validación manual

- Web: iniciar con Google, elegir una cuenta, volver a la aplicación y comprobar que se abre la biblioteca.
- Windows/macOS/Linux: abrir la aplicación al menos una vez antes de probar el acceso y comprobar que el enlace `autumnreader://` enfoca la ventana existente. La versión portable de Windows registra este protocolo al iniciarse, sin requerir instalador.
- Android: repetir el flujo con la app en primer plano y después con la app suspendida.
- Cancelar en Google y comprobar que Autumn Reader conserva la pantalla de acceso y muestra un mensaje localizado.
- Cerrar sesión y entrar con otra cuenta para verificar que la biblioteca local sigue aislada por propietario.

