# Autumn Reader: facturación, derechos y presupuestos

## Catálogo definitivo

| Modalidad | Precio | Almacenamiento | Dispositivos | Polly Neural | DeepL |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | US$0 | 1 GiB | 2 | No incluido | 2.000 caracteres/mes |
| Autumn Pro mensual | US$5,99/mes | 25 GiB | Ilimitados | 25.000 caracteres/mes | 20.000 caracteres/mes |
| Autumn Pro Lifetime | US$119,99 una vez | 25 GiB | Ilimitados | 25.000 caracteres/mes | 20.000 caracteres/mes |

Mensual y Lifetime conceden el mismo nivel funcional interno `premium`. El tipo de derecho se conserva aparte como `monthly`, `lifetime` o `legacy`. Lifetime significa acceso permanente a las funciones de Autumn Pro bajo las condiciones de compra; no significa consumo ilimitado de proveedores. El TTS local, la lectura offline, la sincronización y la cantidad de libros no tienen cuota numérica. Los límites globales compartidos pueden pausar temporalmente DeepL o Polly antes de que una cuenta agote su cuota individual.

## Fuente de verdad

```text
Webhook Lemon Squeezy firmado
  -> subscriptions / purchases / legacy_billing_records
  -> access_grants (derechos aditivos independientes)
  -> effective_access_tier() [free | premium]
  -> get_user_entitlements()
  -> clientes Windows, Android y web
```

Cancelar una suscripción no afecta una compra Lifetime. Un reembolso total o contracargo perdido revoca únicamente el derecho vinculado a esa compra; nunca elimina la cuenta, los libros ni otro derecho válido. El reembolso parcial se registra en `billing_adjustments` con revisión requerida y no revoca acceso. Las disputas quedan en `billing_disputes`; un resultado favorable puede restaurar exactamente el derecho previamente afectado.

Los identificadores históricos `plus` y `pro` permanecen únicamente en migraciones, compatibilidad de webhooks y registros archivados. Se mantienen precio, ciclo, vencimiento, transacciones y derechos adquiridos; no se cambia el precio de clientes existentes.

## Migraciones

1. `202610180001_premium_entitlements.sql`: niveles `free|premium`, ofertas mensual/Lifetime, compras, suscripciones normalizadas, derechos aditivos y backfill histórico.
2. `202610180002_service_quotas.sql`: Polly Neural a 25.000 caracteres por mes UTC, presupuesto global efectivo y cuotas DeepL 2.000/20.000.
3. `202610180003_provider_controls_billing_audit_and_r2_gc.sql`: reservas DeepL atómicas, instantáneas `/v2/usage`, alertas 80/90/100, auditoría de reembolsos/disputas, resumen centralizado de consumo y recolector R2 exclusivamente en simulación.

Son migraciones aditivas: no eliminan libros, transacciones, suscripciones ni tablas históricas. Antes de aplicarlas se debe crear un backup y comparar los conteos del backfill. El rollback seguro consiste en deshabilitar nuevos checkouts/funciones y restaurar el snapshot previo; no se deben borrar las tablas nuevas una vez que contengan compras reales.

## Lemon Squeezy

```dotenv
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_MODE=test
LEMONSQUEEZY_PREMIUM_MONTHLY_VARIANT_ID=2236412
LEMONSQUEEZY_PREMIUM_LIFETIME_VARIANT_ID=2236414
```

Cada proyecto Supabase debe tener un conjunto coherente de Test o Live Mode. Antes de habilitar pagos, ejecutar `npm run verify:billing-config` con las variables del entorno correspondiente. El verificador consulta la API y confirma tienda, modo, estado, precio y que 2236412 sea mensual recurrente por US$5,99 y 2236414 pago único por US$119,99. No imprime secretos. `billing-checkout` repite esas comprobaciones contra la API antes de crear un checkout y falla cerrado si existe una discrepancia.

El webhook debe apuntar a:

```text
https://PROJECT_REF.supabase.co/functions/v1/lemonsqueezy-webhook
```

Suscribir `order_created`, `order_refunded` y los eventos de ciclo/pago de suscripción manejados por la función. La firma HMAC se valida contra el cuerpo original, `store_id` y `test_mode` deben coincidir con el entorno configurado y las claves de evento hacen el procesamiento idempotente. Un reembolso se considera total automáticamente solo cuando la señal firmada del proveedor y los importes en centavos coinciden; cualquier inconsistencia queda como parcial para revisión.

Lemon Squeezy no expone un webhook específico de contracargo en su lista actual. Un operador debe registrar el caso mediante la RPC exclusiva de service role `record_purchase_dispute(...)` después de verificar la evidencia: `opened`, `lost` o `won`.

## Presupuestos y observabilidad

- Polly Neural: 25.000 caracteres por usuario Premium/mes, US$10 globales/mes, costo estimado US$16 por millón. La reutilización de caché no consume cuota.
- DeepL: 2.000 Free/20.000 Premium, 250.000 globales/mes, US$0 de gasto adicional y techo vitalicio conservador de 1.000.000.
- R2: 1 GiB Free/25 GiB Premium; se cuentan bytes canónicos referenciados y reservas de subida.

`provider_usage_summary()` entrega consumo por proveedor, costo estimado de Polly, presupuesto y alertas. Para R2 muestra bytes canónicos conocidos y una estimación bruta de almacenamiento Standard a US$0,015/GB-mes; no incluye operaciones ni audio porque sus bytes físicos no están disponibles en PostgreSQL. `service_usage_for_user()` entrega el resumen individual. La configuración está en `private.service_quota_config`, modificable por backend sin recompilar clientes. Los logs no incluyen texto de libros ni credenciales.

El endpoint interno `r2-orphan-collector` y `preview_r2_orphan_collection()` son solo simulación: registran candidatos sin referencias activas ni subidas pendientes, exigen siete días de observación y siempre informan `physicalDeletes: 0`. Esta versión no contiene ninguna operación física de borrado.

## Orden de despliegue pendiente

1. Crear backup y auditar suscripciones, compras Microsoft Store y conteos históricos.
2. Aplicar las tres migraciones en un proyecto Supabase no productivo.
3. Configurar secretos Test Mode y ejecutar `npm run verify:billing-config`.
4. Desplegar en staging `billing-checkout`, `billing-portal`, `lemonsqueezy-webhook`, `ai-speech`, `translate-text`, `book-storage` y `r2-orphan-collector`.
5. Probar ambos checkouts, renovaciones, fallos, cancelaciones, duplicados, orden temporal, reembolsos parciales/totales, disputas y restauración.
6. Validar DeepL, Polly, R2, Windows y Android con servicios reales de prueba.
7. Repetir con credenciales Live solo después de revisión y autorización explícita.

Ningún paso de despliegue ni modificación de producción fue ejecutado por estos cambios locales.
