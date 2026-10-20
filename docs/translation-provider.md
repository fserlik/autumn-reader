# DeepL: proveedor, cuotas y despliegue

Autumn Reader usa la API oficial de DeepL desde la Edge Function `translate-text`. La clave nunca llega al cliente y no se guarda el texto de los libros ni la traducción en PostgreSQL. Solo se persisten hashes de solicitud, cantidades de caracteres, estados y un identificador técnico saneado del proveedor.

## Configuración confirmada

La cuenta informada por el propietario corresponde a **API Developer**, sin gasto facturable autorizado. El panel muestra 500.000 caracteres mensuales y también 1.000.000 de caracteres vitalicios. Como `/v2/usage` informa el período actual pero no permite confirmar programáticamente el saldo vitalicio, Autumn Reader aplica ambos límites de forma conservadora.

Cuotas por mes UTC:

| Nivel | Caracteres |
| --- | ---: |
| Free | 2.000 |
| Premium | 20.000 |

Además se aplican un máximo global local de 250.000 caracteres por mes, el saldo actual devuelto por `/v2/usage`, el techo vitalicio de 1.000.000 y el presupuesto monetario de US$0. El presupuesto cero permite usar la capacidad gratuita comprobada, pero no autoriza cambiar a un endpoint o plan facturable.

Antes de cada traducción, la función consulta `/v2/usage`, guarda una instantánea sin contenido y reserva caracteres en una transacción serializada. Las reservas concurrentes, éxitos aún no reflejados por el proveedor y resultados inciertos cuentan contra los límites. Los fallos confirmados antes de que DeepL procese el texto liberan la reserva. Se crean alertas privadas al 80%, 90% y 100%; al alcanzar un techo se bloquean solicitudes nuevas.

## Variables de backend

```dotenv
DEEPL_AUTH_KEY=
DEEPL_API_PLAN=developer-free
DEEPL_API_ENDPOINT=https://api-free.deepl.com
DEEPL_GLOBAL_MONTHLY_CHARACTER_LIMIT=250000
DEEPL_MONTHLY_BUDGET_USD=0
DEEPL_LIFETIME_CHARACTER_LIMIT=1000000
DEEPL_LIFETIME_USED_BASELINE=
```

`DEEPL_LIFETIME_USED_BASELINE` es obligatorio: debe copiarse desde el consumo vitalicio ya utilizado que muestre el panel justo antes de habilitar la función. Si falta, no es entero o el uso del proveedor no puede comprobarse, la integración falla cerrada. No usar `api.deepl.com` mientras el presupuesto sea cero; ese host queda reservado para un plan facturable expresamente autorizado.

## Privacidad y límites técnicos

- Se envía únicamente el fragmento seleccionado y los códigos de idioma.
- Cada solicitud admite como máximo 2.000 unidades UTF-16.
- No se envían EPUB/PDF completos, nombres de archivo, notas, correo ni UUID de cuenta.
- No se registran el texto origen ni el traducido.
- La lectura, las notas y el TTS local siguen funcionando si DeepL queda pausado.

El endpoint efectivo y sus condiciones deben verificarse en Test/Staging con la clave real antes de habilitar producción. Las pruebas locales usan respuestas simuladas y no consumen caracteres.

## Despliegue manual pendiente

Aplicar primero las migraciones `202610180001`, `202610180002` y `202610180003`; configurar los secretos en un proyecto no productivo; desplegar `translate-text`; y probar cuota individual, techo global, instantánea vencida, límite vitalicio y solicitudes concurrentes. Ninguno de esos pasos se ejecutó desde este cambio local.
