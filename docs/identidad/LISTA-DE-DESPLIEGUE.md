# Verificación de identidad · Lista de despliegue

Para pasar la verificación de identidad de «construida y apagada» a «encendida en producción». **Nada de esto se hace con documentos reales
antes del paso 1.** Cada casilla dice quién la hace y cómo se comprueba. Si un paso falla, se para: la verificación nace apagada y
quedarse apagada no rompe nada (ninguna compra, promoción, membresía, renovación ni acceso depende de ella).

Orden: **A** (antes de tocar nada) → **B** (base de datos) → **C** (despliegue del código) → **D** (proveedor) → **E** (encender) →
**F** (después de encender). Marcha atrás al final.

## A · Antes de tocar nada

| ☐ | Paso | Quién | Cómo se comprueba |
|---|---|---|---|
| ☐ A1 | **Dictamen legal escrito** sobre la Ley 4-23 (arts. 58 a 60: ¿puede una entidad privada tratar biometría con consentimiento, o el art. 60 lo impide?) y la Ley 358-05 (¿se puede condicionar un pago a una verificación?). Revisar el texto de `/privacy` §7, el párrafo de «un solo caso» y los textos de consentimiento | Tú + abogado | El dictamen firmado, archivado fuera del repositorio |
| ☐ A2 | **Contrato / acuerdo de encargo (DPA) con Didit**: seguridad, secreto, finalidad, subencargados, borrado certificado, asistencia a derechos ARCO, aviso de incidentes, fuente de la consulta de cédula | Tú | Contrato firmado |
| ☐ A3 | **Transferencia internacional**: el proveedor procesa en la Unión Europea; el texto del permiso (`IDENTIDAD_TRANSFERENCIA_INTERNACIONAL`) lo cubre | Tú + abogado | Revisión del texto en `identidadConsentimientosCore.ts` |
| ☐ A4 | **Costes**: según la auditoría (corte del 21-oct-2026), las 500 primeras verificaciones al mes son gratis hasta el 31-oct-2026; desde el 1-nov, US$ 0,33 por verificación completa. **Confírmalo con el proveedor** antes de encender | Tú | Factura o plan en la consola de Didit |
| ☐ A5 | Decidir quién atiende los casos: **solo SUPERADMIN** puede revisar casos, incidencias y borrados. Si hace falta más gente, es una decisión de roles aparte (y de contrato) | Tú | — |

## B · Base de datos

Las migraciones **van antes que el código** (el código usa valores de enum nuevos; sin ellas, los asientos y avisos fallarían).

| ☐ | Paso | Cómo se comprueba |
|---|---|---|
| ☐ B1 | **Respaldo** de la base | `npm run respaldo:verificar` |
| ☐ B2 | Aplicar **en este orden** las diez migraciones: `20261078_identidad_acciones_enum`, `20261079_identidad_verificacion`, `20261080_identidad_acciones_proveedor`, `20261081_identidad_proveedor`, `20261082_identidad_avisos_incidencias_enums`, `20261083_identidad_incidencias`, `20261084_identidad_admin_enums`, `20261085_identidad_incidencias_respuesta`, `20261086_identidad_reglas_enums`, `20261087_identidad_reglas` (`npm run db:migrate:deploy`). Las de enum van **solas** en su migración: no las juntes | `npm run migraciones:pendientes` no lista ninguna; `prisma migrate diff --from-url <base> --to-schema-datamodel prisma/schema --exit-code` → «No difference detected» |
| ☐ B3 | Comprobar que las tablas nacieron con RLS activado: `identidad_verificaciones`, `identidad_intentos`, `identidad_consentimientos`, `identidad_incidencias`, `identidad_interruptores`, `identidad_eventos_externos`, `identidad_reglas` | `SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'identidad\_%' AND relkind='r'` → todas `true` |
| ☐ B4 | Comprobar que **nace apagada y sin reglas**: `identidad_interruptores` tiene `VERIFICACION_IDENTIDAD` con `enabled = false`, y `identidad_reglas` está vacía | `SELECT * FROM identidad_interruptores; SELECT count(*) FROM identidad_reglas;` |
| ☐ B5 | **Políticas de seguridad por fila de identidad** (`prisma/migrations_manual/2026-10-rls-identidad.sql`): aplicarlas **si la Capa 2 de RLS ya está instalada** (existe el rol `membego_app`; el archivo se detiene con un mensaje claro si no). Si todavía no hay Capa 2, **este archivo se aplica en el mismo momento que ella**, antes del paso de `rls-encender.md` que cambia `DATABASE_URL` | `SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'identidad\_%'` → una política por tabla (siete) |
| ☐ B6 | Cuando se cambie `DATABASE_URL` a `membego_app` (ver `docs/runbooks/rls-encender.md`): `membego_app` necesita permisos de tabla (`GRANT SELECT, INSERT, UPDATE, DELETE`) sobre las **siete** tablas de identidad, y las políticas del B5 ya puestas. **Hasta ese cambio, las políticas no protegen nada**: la aplicación usa `postgres`, que se las salta; la defensa real es el código | `npm run rls:probar` en la base de pruebas; `node scripts/rls-cobertura.mjs` y `node scripts/rls-capa2-preflight.mjs` en verde |

## C · Despliegue del código

| ☐ | Paso | Cómo se comprueba |
|---|---|---|
| ☐ C1 | CI en verde: `npm test`, `npm run test:db` (incluye las pruebas de identidad con base de datos, las de rutas y las de RLS), `npx tsc --noEmit`, `npx eslint` | Todo verde, salvo `reportes-excel` si el entorno no trae `write-excel-file/node` |
| ☐ C2 | La ruta `/api/webhooks/identidad/didit` está **fuera del proxy de sesión** (`src/proxy.ts` excluye `api/webhooks`) y el cron `0 8 * * *` de `/api/cron/identidad` figura en `vercel.json` | `tests/identidad-guardas.test.ts` lo vigila |
| ☐ C3 | `CRON_SECRET` configurado (si falta, el cron responde 503) | Una llamada manual al cron con la cabecera correcta devuelve `ok: true` |
| ☐ C4 | Limitador de uso **distribuido** (Upstash) configurado en producción; sin él, los límites (6 sesiones cada 5 minutos, 30 consultas por minuto) son por instancia y valen menos | `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` presentes; `src/lib/rate-limit.ts` |
| ☐ C5 | Correo saliente configurado (`RESEND_API_KEY`): los avisos de resultado se mandan también por correo. Sin él, solo campana y push | Un aviso de prueba llega |
| ☐ C6 | Capacidad `VERIFICACION_IDENTIDAD` **solo** en las empresas que deban ver la insignia «identidad verificada» en la ficha de sus clientes (SUPERADMIN → empresa → capacidades). No es necesaria para que una persona se verifique | — |

## D · Proveedor (Didit)

Detalle en el apartado «Configuración del proveedor» de [FASE-7-VALIDACION-FINAL.md](./FASE-7-VALIDACION-FINAL.md).

| ☐ | Paso | Cómo se comprueba |
|---|---|---|
| ☐ D1 | Flujo (workflow) en la consola: documento de identidad + prueba de vida + comparación facial; solo cédula (y los documentos que decidas); **edad mínima 18**; retención mínima | Un flujo con las tres pruebas. (Un flujo con menos va a «en revisión» y nunca acredita) |
| ☐ D2 | Variables de entorno **de producción** (no se reutilizan las de pruebas): `IDENTIDAD_CLAVES_MAESTRAS` (`1:<base64 de 32 bytes>`), `IDENTIDAD_PEPPER_DEDUPE` (mínimo 32 caracteres), `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`; opcional `DIDIT_API_BASE` (solo https). **Guarda una copia de las claves maestras fuera del sistema**: perderlas deja ilegibles las referencias ya selladas | `faltantesIdentidad()` vacío: el panel del equipo no muestra «Falta configurar» |
| ☐ D3 | Destino del webhook: `https://<dominio>/api/webhooks/identidad/didit`, evento `status.updated`; su secreto compartido en `DIDIT_WEBHOOK_SECRET` | «Try Webhook» en la consola → 200 |
| ☐ D4 | `npm run identidad:probar-didit` con las claves de pruebas del sandbox (crea una sesión, la lee, la traduce y la borra; no usa documentos) | Termina sin error |
| ☐ D5 | Una **verificación de punta a punta en el sandbox** con las muestras sintéticas que entrega el proveedor: aprobada, rechazada por documento vencido, rechazada por selfie que no coincide; y comprobar que cada sesión se borra en la consola de Didit al concluir | Resultados esperados + sesiones borradas |

## E · Encender

| ☐ | Paso | Cómo se comprueba |
|---|---|---|
| ☐ E1 | `/superadmin/identidad` → **Resumen**: la compuerta no pide nada por configurar; encender el interruptor **con motivo** | La compuerta dice «Encendida»; queda un asiento `IDENTIDAD_INTERRUPTOR_CAMBIADO` con tu nombre |
| ☐ E2 | Verificar **una cuenta de prueba tuya** por la web y por la app (navegador del sistema → vuelta a la app) | Estado «Verificada», aviso en la campana, sesión borrada en Didit |
| ☐ E3 | Revisar las pantallas con sesión real: `/cliente/identidad`, `/cliente/ajustes`, `/superadmin/identidad` (las seis pestañas), la ficha de un cliente con la insignia y, si aplica, `/admin/supply/identidad` | Revisión visual y de accesibilidad hecha por una persona |
| ☐ E4 | **Reglas por función**: déjalas apagadas. Solo se enciende «Pago a un proveedor» (pestaña **Reglas**) cuando A1 lo permita y los proveedores con representante sin verificar (el panel lo cuenta) estén avisados | Panel de reglas |

## F · Después de encender

| ☐ | Paso | Cuándo |
|---|---|---|
| ☐ F1 | Mirar el **Resumen** del panel: borrados pendientes en el proveedor, avisos sin procesar, borrados pedidos sin completar, casos en revisión, incidencias abiertas | A diario la primera semana |
| ☐ F2 | Confirmar que el cron diario corrió (la respuesta trae `expiradas`, `intentosAbandonados`, `proximasARevalidar`, `avisos`, `reconciliacion`) | Al día siguiente |
| ☐ F3 | Revisar en el log del servidor las líneas con contexto `identidad:*` (cada fallo se anota con su contexto: `identidad:crear-sesion`, `identidad:procesar-evento`, `identidad:purgar-sesion`, `identidad:reconciliar`…) | Primera semana |
| ☐ F4 | Comprobar que **ninguna compra, renovación ni acceso** cambió de comportamiento (la verificación es opcional) | Primer día |

## Marcha atrás

1. **Apagar el interruptor** (`/superadmin/identidad` → Resumen → «Apagar la verificación», con motivo): nadie puede empezar una verificación; lo que está en curso se sigue resolviendo; las reglas encendidas pasan a «en pausa» y **no frenan ningún pago**. Es inmediato y no pierde datos.
2. Si una regla frena un pago que debe salir: apagar la regla (pestaña **Reglas**) o apagar el interruptor.
3. Si hay que volver atrás del todo, **no** se borran las tablas: se dejan apagadas. Las migraciones son aditivas.
4. Una clave expuesta: ver `docs/runbooks/credencial-filtrada.md` y el manual de operación de identidad.
