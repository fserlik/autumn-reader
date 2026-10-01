# Traducción: proveedor y configuración (29-09-2026)

Este documento se creó antes de integrar el proveedor. La primera implementación usa la API oficial de DeepL detrás de una Edge Function Supabase. El lector depende de `TranslationService`, no del proveedor. No se ha creado una cuenta, contratado un plan ni desplegado un servicio.

## Coste y límites

Según [los planes oficiales de la API](https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans), API Developer incluye **1.000.000 de caracteres en total**, sin reinicio mensual: es un crédito de inicio, no un millón gratis cada mes. El antiguo API Free ofrece 500.000/mes para cuentas existentes y ya no se ofrece a nuevas cuentas. Comprueba las condiciones al crear manualmente tu cuenta; no actives Growth ni otro plan de pago para probar esta función. Los precios posteriores dependen del plan/región y no forman parte de esta configuración.

Autumn limita cada fragmento a 2.000 unidades UTF-16, 60 peticiones y 20.000 caracteres por cuenta/día, y 250.000 caracteres globales/mes. Estos límites se reservan atómicamente en PostgreSQL; las peticiones fallidas consumen reserva para impedir abuso/reintentos costosos. Los límites de DeepL siguen aplicándose. El crédito Developer agotado requiere una decisión manual; la aplicación nunca cambia de plan.

## Privacidad

Solo se envía el fragmento seleccionado y los códigos de idioma. No se envían el EPUB/PDF, nombre del archivo, ID del libro, notas completas, email ni ID de cuenta a DeepL. Supabase verifica la sesión y guarda únicamente contadores de uso: no guarda texto ni traducciones. El proveedor recibe la IP del backend y la clave del operador. La UI avisa antes del botón que inicia la petición. No hay traducción automática por seleccionar texto.

El tratamiento/retención del texto depende del plan del proveedor; no se promete ausencia de entrenamiento o borrado inmediato en una cuenta gratuita. Consulta la [política vigente de privacidad](https://www.deepl.com/en/privacy) antes de enviar fragmentos sensibles. La integración usa la [API oficial de texto](https://developers.deepl.com/api-reference/translate/request-translation), con detección automática del idioma al omitir `source_lang`.

## Variables SOLO del backend

- `DEEPL_AUTH_KEY`: clave privada de API, nunca `VITE_*`.
- `DEEPL_API_PLAN=developer`: endpoint `https://api.deepl.com/v2/translate` para Developer. `legacy-free` usa `https://api-free.deepl.com/v2/translate` únicamente si tienes ese plan existente. No se permite una URL arbitraria desde el cliente.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`: ya existentes.

Aplicar la migration de cuotas, configurar secretos y desplegar `translate-text` es un paso manual opcional. Sin clave configurada, leer/buscar/resaltar continúa funcionando y la UI explica que la traducción aún no está configurada. Las pruebas usan respuestas simuladas, sin consumir crédito ni enviar texto real.
