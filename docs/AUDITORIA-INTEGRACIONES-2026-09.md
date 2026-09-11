# Auditoría · Integraciones y Desarrolladores — septiembre de 2026

> Investigación hecha el 11 de septiembre de 2026 sobre `main` (`86c8977d`, con
> las PR #453 Meta y #455 CRM ya reconciliadas) y la rama `claude/meta-fase0`.
> Cada afirmación lleva su archivo y, cuando importa, su línea. Lo que no se
> pudo comprobar en el código no está aquí.
>
> Objetivo: decir qué tiene MembeGo hoy para que **otras apps y herramientas se
> le conecten por API**, qué está bien construido, dónde se rompe, y qué
> mejoras —de estructura y de alcance— lo llevan a estar «100 % capacitado».

---

## 0. La respuesta corta

MembeGo tiene **dos módulos distintos** que el lenguaje cotidiano mezcla bajo
la palabra «integraciones», y la mejora más importante de esta auditoría es
tratarlos como lo que son:

| | **Conectores** (Membego usa a otros) | **Plataforma** (otros usan a Membego) |
|---|---|---|
| Pregunta que responde | «¿Cómo conecto mi WhatsApp / mi Google Calendar / mi CardNET?» | «¿Cómo hace mi POS / mi app / Zapier para leer clientes y recibir eventos?» |
| Quién lo usa | La dueña del negocio, desde `/admin/integraciones` | Un programador, desde `/admin/integraciones/desarrolladores` o un satélite registrado por el superadmin |
| Código | `src/modules/connect/**` (≈ 9 100 líneas) | `src/modules/plataforma/**` (≈ 3 500) + `src/modules/integraciones/**` (≈ 1 400) + `packages/contracts` + `packages/platform-sdk` |
| Estado | Framework maduro, 5 proveedores, Meta a falta de credenciales | API v1 completa con 24 rutas, OAuth de cliente, idempotencia, firma Ed25519, SDK |

**Lo que está bien** es mucho más de lo que se recordaba: 37 archivos de
prueba (8 560 líneas) vigilan estas dos caras, la API tiene un inventario que
la CI compara contra las rutas reales, las credenciales van selladas con
rotación de claves, y el aislamiento por empresa está en la base (UNIQUE) y no
solo en el código.

**Lo que falla** no son piezas sueltas: son **costuras**. Los tres canales
de salida no hablan el mismo idioma; hay tres vocabularios de eventos sin
puente; el framework de conectores promete «tres archivos» y hoy exige entre
cinco y nueve; la API pública no tiene CORS ni paginación; y los paquetes
que un tercero instalaría no se pueden instalar.

Once mejoras, ordenadas por lo que desbloquean (§4), con una hoja de ruta en
seis cortes (§5).

---

## 1. Inventario honesto

### 1.1 Conectores (`src/modules/connect`)

El framework separa cinco preguntas para decidir qué ve una empresa —hay
código, hay metadatos, el superadmin lo publicó, el despliegue lo tiene
configurado, el plan lo permite— y las resuelve en **un solo sitio**,
`decidirEstadoIntegracion()` (`proveedores/tipos.ts:405`). Cada módulo va en
pareja `xNucleo.ts` (puro, sin base ni red, probado de verdad) + `x.ts`
(`server-only`). Es el patrón dominante y es bueno.

| Pieza | Dónde | Estado |
|---|---|---|
| Contrato de proveedor | `proveedores/tipos.ts` (`DefinicionProveedor`, 9 estados humanos, 7 clases de error con CHECK en base) | Completo |
| Registro | `proveedores/indice.ts` — `GOOGLE_CALENDAR`, `WHATSAPP`, `CARDNET`, `FACEBOOK`, `INSTAGRAM` | Completo; invariantes en `problemasDelRegistro()` |
| Catálogo | `catalogo.ts` (ensamblador único), `metadatos.ts` (5 implementados + 9 previstos) | Completo |
| Alta guiada | `altaNucleo.ts` + `alta.ts` + `components/connect/AsistenteAlta.tsx` (527 líneas) | Completo para lo que existe |
| Credenciales | `cifrado.ts` (AES-256-GCM, AAD por fila, rotación por versión) + `credenciales.ts` | Completo, falla cerrado |
| OAuth saliente | `oauthNucleo.ts` (PKCE S256, `state` firmado de un solo uso) + `oauth.ts` | Completo; **solo Google** lo usa |
| Meta | `meta/*` + `metaEmbedded.ts` + `metaNucleo.ts` — cliente Graph único con `appsecret_proof`, webhook firmado, cola, activos por tipo+id UNIQUE | Código completo; **cero credenciales** (Fase 0, ver `docs/connect/meta-arquitectura.md` §13) |
| Salud y bitácora | `registro.ts:anotarSalud` (las clases transitorias no mueven el estado), `bitacoraNucleo.ts` con dos traducciones (técnica / negocio) | Completo, **pasivo** |
| Claves de API y webhooks de empresa | `clavesApi*.ts`, `webhooks*.ts`, `entitlements.ts` | Completo, sin visibilidad de entregas |

### 1.2 Plataforma (`src/modules/plataforma`, `src/modules/integraciones`, paquetes)

Construida como el «Membego Platform Integration Standard v1» en ocho fases
documentadas en `docs/platform/*.md`; `docs/PLATFORM_ARCHITECTURE_REPORT.md`
§17 declara hechas las fases 0–7 y pendientes 7b, 8, 9 y 10.

| Pieza | Dónde | Estado |
|---|---|---|
| API pública | `src/app/api/platform/v1/**` — 24 rutas; guardia única `plataforma/api.ts` con dos principales (`sistema` por OAuth `client_credentials`, `empresa` por clave `mbk_…`) | Completo |
| Errores | 19 códigos estables, `X-Request-Id`, `WWW-Authenticate` (`plataforma/errores.ts`, `packages/contracts/src/errores.ts`) | Completo |
| Idempotencia | `idempotencia*.ts` — reserva UNIQUE `(sistemaId, clave)`, huella del cuerpo, replay con el estado HTTP guardado | Completo |
| Firma de eventos | `plataforma/firma.ts` — Ed25519 + HMAC de legado; clave pública en `/.well-known/keys` | Completo |
| Contratos y SDK | `packages/contracts` (scopes, sobre v2, inventario, OpenAPI, manifiesto, cero dependencias) y `packages/platform-sdk` (cliente con renovación, reintentos y `Idempotency-Key` estable; `verificarWebhook`; inbox) | Completo **como código**; no publicable (§2.6) |
| Satélites | `integraciones/{despacho,sso,panel}.ts`; modelos `SistemaConectado`, `CredencialSistema`, `EmpresaSistema`, `EventoSaliente` | Completo; alta solo por CLI (`scripts/registrar-sistema.ts`) |
| Panel de empresa | `/admin/integraciones/desarrolladores/{claves,webhooks,registros}` + `GuiaDesarrolladores` generada desde el inventario | Completo |
| Panel de superadmin | `/superadmin/connect` (catálogo, concesiones) y `/superadmin/integraciones` (salud de satélites + cola de trabajos) | Parcial: no crea satélites ni rota credenciales |

### 1.3 Lo transversal

- **Bus de eventos**: emisor único `estrategias/eventos.ts:emitirEventoEstrategia` → `DomainEvent` → cola QStash → fan-out triple (automatizaciones, satélites, webhooks de empresa). Catálogo de ≈110 tipos en `src/lib/automation/domain/events.ts`.
- **Cola**: `src/modules/jobs/**` con 7 tipos de trabajo, deduplicación por clave, dead-letter reencolable desde el panel, degradación a ejecución en línea contable cuando no hay QStash.
- **Aislamiento**: `conEmpresa` / `sinEmpresa(motivo)` (`src/lib/tenant.ts`) + RLS capa 2 escrita pero **apagada** (la app entra como `postgres`).
- **Pruebas**: 37 archivos, 8 560 líneas. Muchas son «de nivel fuente» (leen el código como texto para vigilar estructura), y varias son ratchets reales: ruta de API nueva sin inventario = CI roja (`tests/connect-developer.test.ts`).

---

## 2. Problemas encontrados

Ordenados por gravedad. Cada uno con su evidencia.

### 2.1 Tres canales de salida, tres idiomas — y el SDK oficial no puede verificar los webhooks de una empresa

MembeGo avisa hacia fuera por tres caminos, y no se pusieron de acuerdo:

| | Satélites (`integraciones/despacho.ts`) | Webhooks de empresa (`connect/webhooks.ts`) | Automatizaciones `send_webhook` |
|---|---|---|---|
| Cuerpo | `SobreEvento` v2: `eventId`, `eventType`, `version`, `occurredAt`, `traceId`, `data` + claves de legado | `SobreWebhook`: `id`, `event`, `companyId`, `createdAt`, `data` (`webhooks.ts:131-137`) | reutiliza el de empresa |
| `X-Membego-Signature` | **Ed25519** sobre `timestamp.eventId.cuerpo` (`despacho.ts:110-121`) | **HMAC-SHA256 hex del cuerpo** (`webhooks.ts:212`) | idem |
| Anti-replay | `X-Membego-Timestamp` + `X-Membego-Event-Id` **dentro de la firma** | `X-Membego-Timestamp` se manda pero **no se firma** | idem |
| Nombre del evento | interno (`cliente.visita`) | v2 (`visit.completed`) via `tipoV2()` | v2 |

Consecuencias concretas:

- **La misma cabecera significa dos cosas distintas.** Un integrador que lea `docs/platform/eventos-v2.md` y verifique `X-Membego-Signature` como Ed25519 fallará contra un webhook de empresa; uno que siga `GuiaDesarrolladores.tsx:103-125` (HMAC hex) fallará contra un satélite.
- **`verificarWebhook` del SDK no acepta un webhook de empresa.** Con `secretoCompartido` busca `X-Membego-Firma` (`packages/platform-sdk/src/webhooks.ts:84,114`), que la empresa no recibe; y aunque pasara, `interpretar()` exige `eventId` (`:134`) y el cuerpo de empresa trae `id`. Resultado: `SIN_FIRMA` o `CUERPO_INVALIDO`, siempre. La guía del panel, consciente o no, enseña a verificar a mano.
- **Sin anti-replay para empresas**: la firma es solo del cuerpo, así que un aviso capturado se puede reenviar indefinidamente (el sobre v2 nació precisamente para cerrar eso: `packages/contracts/src/eventos.ts:75-84`).

### 2.2 Tres vocabularios de eventos sin puente; eventos que se emiten y nunca salen

| Lista | Dónde | Tamaño |
|---|---|---|
| Catálogo del motor `AUTOMATION_EVENTS` | `src/lib/automation/domain/events.ts` | ≈ 110 |
| Lista blanca hacia satélites `EVENTOS_REENVIADOS` | `src/modules/integraciones/nucleo.ts:10-18` | 7 |
| Mapa de nombres v2 `TIPO_V2` | `packages/contracts/src/eventos.ts:46-57` | 10 |

Nada ata una lista a otra, y se nota:

- `reserva.pagada` **se emite** (`src/modules/excursiones/reservas/actions.ts:767`), está en `TIPO_V2`, pero **no está en `AUTOMATION_EVENTS`** (ninguna automatización puede escucharlo) **ni en `EVENTOS_REENVIADOS`** (ningún satélite lo recibe). `reserva.creada` y `venta.generada` están en el mapa v2 y nadie los emite.
- `mensaje.recibido` y `prospecto.creado` (Meta · Fases 6-7) disparan automatizaciones pero **no salen** por webhook ni a satélites: un CRM externo no puede enterarse de que llegó un WhatsApp.
- **12 emisores usan literales de cadena** en vez de la constante (`registro/actions.ts:355,541`, `pagos/activacion.ts:159-173`, `visitas/canje.ts:483-490`, `referidos/actions.ts:110`, `cliente/afiliacion.ts:159`, `lib/referidos-attribution.ts:268`, `pagos/activacionCompra.ts:175`). Un error de tecleo no lo detecta nadie hasta que una automatización deja de disparar.

### 2.3 El framework de conectores promete «tres archivos» y exige entre cinco y nueve

La promesa está escrita en `proveedores/indice.ts:13-15`: *«un archivo en esta carpeta, su metadata en `metadatos.ts` y una línea aquí. No toca la interfaz, no toca las rutas, no toca la base»*. Hoy se rompe por seis sitios donde el framework pregunta por el slug:

| Dónde | Qué hace | Quién lo sufre |
|---|---|---|
| `proveedores/indice.ts:62` | `if (slug === 'google-calendar') return oauthGoogleCalendar()` | Cualquier OAuth nuevo |
| `alta.ts:175`, `:225`, `:318` | Opciones del paso, validación y configuración visible, solo de Google | Cualquier alta con elección o validación |
| `registro.ts:227`, `:235` | Desconexión remota de WhatsApp y de Facebook | Cualquier proveedor que deba avisar al desconectar |
| `components/connect/AsistenteAlta.tsx:440-459` | Lista blanca literal de cuatro componentes de alta | Cualquier paso `COMPONENTE` nuevo |
| Siembra | Solo por SQL a mano en tres migraciones; `prisma/seed.ts` no toca `conectores` | Un entorno nuevo nace con catálogo vacío |

Y la siembra ya divergió del código: en base, `facebook` e `instagram` se
llaman «Facebook» / «Instagram», categoría **MARKETING**, `authTipo`
**NINGUNA**, estado **DRAFT** (`prisma/migrations/20260903_connect_framework/migration.sql:68-69`);
en código son «Facebook e Instagram», **COMUNICACION**, OAuth por popup, y
declarados implementados (`metadatos.ts:66-81`). El `ON CONFLICT DO NOTHING`
impide que una migración posterior lo corrija.

### 2.4 La API pública no es consumible desde un navegador ni escala en listas

Verificado sobre `src/app/api/platform/**`:

- **CORS: cero.** Ninguna cabecera `Access-Control-*`, ningún manejador `OPTIONS`. Una app web de terceros no puede llamar a la API. No hay `middleware.ts`; `src/proxy.ts` solo protege rutas de sesión.
- **Paginación: ninguna.** Solo `appointments/route.ts:71` tiene un `take` fijo. Las demás listas devuelven `{ recurso: [...] }` sin cursor, sin `hasMore`, sin límite en el contrato. No se puede añadir después sin romper clientes.
- **Límite de peticiones sin señal.** `plataforma/api.ts:56` limita a 600/min (Upstash Redis con respaldo local, `src/lib/rate-limit.ts`), pero no emite `X-RateLimit-*` ni `Retry-After` en 429. El único `Retry-After` del repo está en `src/proxy.ts`.
- **OpenAPI sin esquemas de respuesta.** `packages/contracts/src/openapi.ts:155` declara solo `Error`. Está documentado como decisión, pero significa que un generador de cliente produce `any` para todo.

### 2.5 Nadie ve una entrega de webhook, y los reintentos son diarios

- La empresa puede crear, pausar y apagar suscripciones (`connect/adminActions.ts`) pero **no ver sus entregas**, **no probar** la URL, **no reenviar** un evento. `EntregaWebhook` existe con estado, intentos, `estadoHttp` y `ultimoError` (`prisma/schema/connect.prisma`) y ninguna pantalla de empresa la lee. El superadmin sí tiene sonda y reenvío para satélites.
- `repartirEventoAWebhooks` hace **un** intento inmediato; todo reintento depende del cron `/api/cron/integraciones`, que en `vercel.json` corre **`0 13 * * *`, una vez al día**. `docs/INTEGRACIONES.md` dice «horario». Con `MAX_INTENTOS = 8`, una URL caída diez minutos recibe su segundo intento al día siguiente y tarda **ocho días** en agotar reintentos.
- Sin retención: no hay ningún `deleteMany` sobre `RegistroConector`, `EntregaWebhook` ni `EventoMeta`. Crecen sin límite.

### 2.6 Los paquetes que un tercero instalaría no se pueden instalar

`packages/contracts/package.json` y `packages/platform-sdk/package.json`
declaran `publishConfig` hacia GitHub Packages, pero no tienen `scripts`, ni
`build`, y sus `exports` apuntan a `./src/*.ts` (TypeScript crudo). No hay
workspaces en el `package.json` raíz —se consumen por `paths` de
`tsconfig.json`— ni workflow de publicación (`.github/workflows/` tiene
`ci.yml`, `deploy-migraciones.yml`, `e2e.yml`, `respaldo-verificacion.yml`).
`docs/platform/sdk.md` y los README no dicen cómo instalarlos porque no se
puede.

### 2.7 No existe la figura «app de terceros»

Hoy hay dos maneras de usar la API: ser un **satélite** (lo registra el
superadmin por CLI, con manifiesto) o ser **la propia empresa** (clave
`mbk_…`). No hay modelo `Aplicacion`/`OAuthClient`/`Consentimiento`, no hay
OAuth `authorization_code` **entrante** (`EstadoOAuth` es el saliente hacia
Google), no hay pantalla donde un desarrollador registre una app ni donde una
empresa la autorice. `src/modules/apps/` existe pero es dashboard y reportes.
Y en el catálogo de conectores, `zapier` y `make` aparecen como «previstos»
(`metadatos.ts:147-157`) cuando conceptualmente son **consumidores de la
Plataforma**, no proveedores de Connect: lo que necesitan —clave de API +
webhooks— ya existe.

### 2.8 La reconciliación de las PR #453 y #455 dejó duplicidades en el núcleo

`docs/CRM-IMPLEMENTACION.md` lo reconoce y `prisma/schema/crm.prisma:8-10` lo
escribe: conviven dos CRMs (`Prospecto` automático desde mensajería y `Lead`
manual con Kanban) y dos motores de respuesta (`AutoReplyConfig` por palabras
clave en `mensajeria/autoReply.ts`, y las automatizaciones de `estrategias`
que ya escuchan `mensaje.recibido`). Además:

- **Lógica del vertical Excursiones dentro del núcleo de mensajería**: `mensajeria/intenciones.ts` decide por «tour», «parque», «combo»; `autoReply.ts:280-287` responde con un texto fijo **con emoji** y una URL de respaldo `/empresas/{slug}/excursiones`. Es justo lo que `plataforma/conceptos.ts` advierte que no debe pasar (regla §6: no cablear categorías en el Core).
- `connect/autoReply-actions.ts` protege con la sección `clientes` (no `integraciones`) y hace `revalidatePath('/admin/connect')` (`:88`, `:185`), una ruta que **no existe**.

### 2.9 Aislamiento: una tabla sin política y dependencias implícitas

- La tabla `conectores` **no tiene política RLS**: no lleva `companyId`, su única FK es entrante y **no está** en la lista de catálogos globales de `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql:279` (que sí incluye `sistemas_conectados`). El día que `DATABASE_URL` pase al rol `membego_app`, el catálogo se vacía y `conexiones_empresa` no puede resolver su conector. Arreglo de una línea.
- `EventoMeta` y `TrabajoMuerto` admiten `companyId` nulo; la política de nivel 0 los deja invisibles salvo en modo omnisciente. Funciona porque **todo** el código que los toca usa `sinEmpresa`; nada lo garantiza.

### 2.10 Salud pasiva, conocimiento disperso, documentación desalineada

- Ningún cron inspecciona tokens: `inspeccionarToken` (Meta) solo se llama al elegir Páginas (`meta/paginas.ts:94`); Google refresca solo al usarse. Un token revocado se descubre cuando falla un envío.
- Las decisiones del hub de integraciones (tarjetas, pestañas, «un botón que no hace nada es peor que ningún botón») viven **solo en comentarios de cabecera**; no hay documento. `docs/connect/meta-arquitectura.md` §1 describe un estado anterior a la PR #453 (varios puntos ya resueltos). `docs/GUIA_LENGUAJE_MEMBEGO.md` sigue «BORRADOR PARA APROBACIÓN».
- El superadmin tiene la operación repartida en dos rutas con una barra compartida a propósito (`TabsIntegracionesPlataforma.tsx`), y la cola de trabajos comparte pantalla con los satélites.

---

## 3. Qué NO cambiaría

Antes de las mejoras, lo que esta auditoría recomienda **conservar**, porque
es lo que hace que el resto se pueda arreglar sin miedo:

- El patrón `xNucleo.ts` puro + `x.ts` con base. Es lo que permite probar de verdad sin levantar Postgres.
- Las cinco señales y la regla única de estado (`decidirEstadoIntegracion`). Un solo sitio decide qué ve la empresa.
- `@membego/contracts` como **fuente** y el Core como reexportador (vigilado por `tests/platform-sdk.test.ts`).
- El inventario de la API como origen del OpenAPI y de la guía, con la CI parando si una ruta no está.
- Credenciales selladas con AAD por fila y rotación por versión de clave.
- La estrategia evolutiva de `docs/ESTRATEGIA-PLATAFORMA.md`: nada de mover rutas ni renombrar carpetas en bloque. Ninguna mejora de abajo mueve archivos que ya funcionan.

---

## 4. Las mejoras

Once, ordenadas por lo que desbloquean. Cada una dice qué problema cierra
(§2), qué toca y cuánto pesa.

### M1 · Un solo canal de salida: sobre v2, firma Ed25519 y anti-replay para todos

**Cierra 2.1.** Hoy hay dos sobres y dos firmas; que haya uno.

- `SobreEvento` v2 (`packages/contracts/src/eventos.ts`) pasa a ser **el único** cuerpo que sale de MembeGo. Los webhooks de empresa dejan `SobreWebhook`; se mantienen `id`/`event` como claves de legado dentro del mismo cuerpo durante una ventana, exactamente como ya se hizo para los satélites (`ClavesLegado`).
- Un solo firmador (`plataforma/firma.ts`): Ed25519 sobre `timestamp.eventId.cuerpo` en `X-Membego-Signature`, y el HMAC del secreto de la suscripción en `X-Membego-Firma` mientras dure la migración. Las dos cabeceras significan lo mismo en los tres canales.
- `verificarWebhook` del SDK verifica cualquier aviso de MembeGo sin saber de dónde viene. La guía del panel deja de enseñar HMAC a mano y enseña el SDK.
- Una sola tabla de salida (`EntregaWebhook`) con un campo `destino: SATELITE | EMPRESA | APP` sustituye a `EventoSaliente` + `EntregaWebhook`. Un solo `reintentar`, un solo dead-letter, una sola pantalla.

Peso: medio. Es la mejora con mayor efecto por línea escrita: todo lo que
sigue (portal, apps de terceros, Zapier) se apoya en que «un webhook de
MembeGo» sea una sola cosa.

### M2 · Catálogo de eventos tipado y una prueba que lo ate todo

**Cierra 2.2.** Tres listas se convierten en una tabla con columnas.

```ts
// packages/contracts/src/eventos.ts — la única lista
export const EVENTOS = {
  'cliente.visita':   { v2: 'visit.completed',  sale: true,  automatiza: true },
  'reserva.pagada':   { v2: 'reservation.paid', sale: true,  automatiza: true },
  'mensaje.recibido': { v2: 'message.received', sale: true,  automatiza: true },
  'decision.tomada':  { v2: null,               sale: false, automatiza: true },
  …
} as const satisfies Record<string, DefinicionEvento>
export type TipoEvento = keyof typeof EVENTOS
```

- `emitirEventoEstrategia({ type: TipoEvento })`: el tipo rechaza un literal que no esté en la tabla. Los 12 emisores con cadena sueltas pasan a la constante (cambio mecánico).
- `EVENTOS_REENVIADOS` y `TIPO_V2` se **derivan** de la tabla (`sale === true`), no se escriben.
- Una prueba nueva exige: todo evento emitido en `src/` existe en la tabla; todo evento con `sale: true` tiene nombre v2; ningún nombre v2 se repite.
- `reserva.pagada`, `mensaje.recibido` y `prospecto.creado` entran con `sale: true` y por fin salen.

Peso: bajo-medio. Un día de trabajo bien acotado, sin riesgo de producción.

### M3 · Que el conector nuevo vuelva a ser «tres archivos»

**Cierra 2.3.** Los seis `if (slug === …)` se vuelven ganchos declarados en `DefinicionProveedor`:

```ts
export interface DefinicionProveedor {
  …
  oauth?: () => ConfigOauthConector | null          // sustituye indice.ts:62
  alDesconectar?: (ctx) => Promise<void>            // sustituye registro.ts:227-235
  opcionesDePaso?: (pasoId, ctx) => Promise<Opcion[]>   // sustituye alta.ts:175
  validar?: (ctx) => Promise<ResultadoValidacion>   // sustituye alta.ts:225
  configVisible?: (config) => CampoVisible[]        // sustituye alta.ts:318
}
```

- Los componentes de alta se registran en un mapa cliente (`components/connect/altas/indice.ts`) en vez de la lista literal de `AsistenteAlta.tsx:440-459`. El asistente hace `REGISTRO[paso.componente]`.
- La siembra sale del código: `sembrarConectores()` recorre `METADATOS` y hace `upsert` por slug (nombre, categoría, `authTipo` desde la definición), y se llama desde `prisma/seed.ts` y desde una migración de datos. Corrige de paso la divergencia de `facebook`/`instagram` y elimina el SQL a mano.
- Una prueba de nivel fuente vigila que **no haya `slug ===` fuera de `proveedores/`**. Es el ratchet que impide que la promesa se rompa otra vez.

Peso: medio. Refactor interno sin cambio de comportamiento visible; cada gancho se mueve con su prueba existente.

### M4 · Salud activa y retención

**Cierra 2.10 (salud) y 2.5 (retención).**

- Cron `/api/cron/conectores-salud` (diario): por cada conexión `CONNECTED`, el proveedor declara `comprobarSalud?: (ctx) => Promise<Salud>` — Meta llama a `debug_token` y usa `pideReautorizar` (ya existe en `meta/tokensNucleo.ts`), Google fuerza un refresco. El resultado pasa por `anotarSalud`, que ya sabe mover a `REAUTORIZAR`. La empresa se entera **antes** de que falle un envío.
- Retención declarada en un solo sitio (`connect/retencion.ts`): `RegistroConector` 90 días, `EntregaWebhook` 30 días tras `ENVIADO`/`DEAD_LETTER`, `EventoMeta` procesados 30 días y sin dueño 7 días. Un `deleteMany` por tabla en el cron existente.

Peso: bajo.

### M5 · Reintentos con backoff en la cola, no en el cron diario

**Cierra 2.5 (reintentos).** El intento fallido de un webhook encola un trabajo `entrega-webhook` con `Upstash-Delay` creciente (1 min, 5, 30, 2 h, 12 h, 24 h…), como ya hace `encolar()` para el resto. El cron diario queda como barrido de seguridad, que es lo que debió ser. `docs/INTEGRACIONES.md` deja de decir «horario».

Peso: bajo. Todo lo necesario (`encolar`, `Upstash-Delay`, dead-letter) ya existe.

### M6 · La empresa ve, prueba y reenvía sus webhooks

**Cierra 2.5 (visibilidad).** En `/admin/integraciones/desarrolladores/webhooks`:

- Lista de entregas por suscripción (evento, fecha, estado HTTP, intentos, último error), leyendo `EntregaWebhook`.
- «Probar»: envía un evento `ping` firmado a la URL y muestra la respuesta. Reutiliza la sonda que el superadmin ya tiene para satélites (`integraciones/panelActions.ts:sondearWebhookAction`).
- «Reenviar» sobre una entrega concreta.

Sin métricas inventadas: solo lo que hay en la tabla. Peso: bajo-medio.

### M7 · API pública consumible: CORS, paginación por cursor, señales de límite

**Cierra 2.4.**

- Una envoltura única para la API (`plataforma/api.ts` ya es la guardia): responde `OPTIONS`, emite `Access-Control-Allow-Origin` según los orígenes registrados por la credencial (no `*`), `X-RateLimit-Limit/Remaining/Reset` y `Retry-After` en 429.
- Contrato de lista **antes** de que haya más clientes: `{ data: [...], nextCursor: string | null }` con `limit` máximo declarado en el inventario. Se introduce sin romper: las rutas actuales aceptan `?cursor` y añaden `nextCursor`; la clave del recurso se mantiene una versión.
- El inventario (`packages/contracts/src/inventario.ts`) gana `paginada: boolean` y la prueba de ratchet exige que toda ruta de lista lo declare.

Peso: medio.

### M8 · OpenAPI con esquemas y paquetes publicables

**Cierra 2.4 (esquemas) y 2.6.**

- Los DTO de `packages/contracts/src/api.ts` se describen una vez con `zod` **dentro de contracts** (o, si se quiere mantener cero dependencias, con un generador de JSON Schema en build) y de ahí salen a la vez la validación de entrada de cada `route.ts` (hoy a mano) y los `components.schemas` del OpenAPI. Un generador de cliente deja de producir `any`.
- Los dos paquetes ganan `build` con `tsup` (ESM + CJS + `.d.ts`), `exports` a `dist/`, workspaces en la raíz, y un workflow `publicar-paquetes.yml` que publica a GitHub Packages al etiquetar. `docs/platform/sdk.md` gana la sección «Instalar».

Peso: medio.

### M9 · Portal público de desarrolladores

**Cierra 2.4 y 2.10 (documentación).** Ruta pública `/desarrolladores` (en `src/app/(public)/`) que sirve:

- La referencia generada desde el OpenAPI (Scalar o Swagger UI embebido, sin inventar contenido).
- Las guías de `docs/platform/*.md` renderizadas, con la firma de webhooks explicada **una sola vez** (M1).
- Los eventos disponibles, leídos de la tabla de M2.
- Cómo instalar el SDK (M8).

Hoy la única puerta pública es el JSON de `/api/platform/v1/openapi`, enlazado como «Documentación» en `NavDesarrolladores.tsx:31`. Peso: medio; es casi todo ensamblaje de lo que existe.

### M10 · La figura «app de terceros»: registro, OAuth entrante y consentimiento

**Cierra 2.7.** Es la pieza que convierte «la API existe» en «cualquiera puede construir sobre MembeGo»:

- Modelos: `Aplicacion` (dueño, nombre, `clientId`, hash del secreto, `redirectUris[]`, `scopes[]`, estado DRAFT/PUBLISHED/SUSPENDED), `AutorizacionApp` (`aplicacionId`, `companyId`, scopes concedidos, `revocadaAt`), `TokenApp` (refresh tokens hasheados, con `expiresAt`).
- OAuth 2.1 `authorization_code` + PKCE **entrante** en `/api/platform/v1/oauth/{authorize,token,revoke}` — reutilizando `oauthNucleo.ts` (PKCE y `state` ya están) y `plataforma/token.ts` para los access tokens.
- Pantalla de consentimiento para la empresa (`/admin/integraciones/autorizar?client_id=…`) y pantalla «Apps autorizadas» con revocar.
- La guardia de `plataforma/api.ts` gana un tercer principal: `{ tipo: 'app', aplicacionId, companyId, scopes }`. Los scopes ya existen (`packages/contracts/src/scopes.ts`).
- UI de superadmin para satélites y apps (crear, rotar, revocar `CredencialSistema`) en lugar del CLI.

Con esto, `zapier` y `make` salen del catálogo de conectores y pasan a ser apps publicadas que usan M1 + M7. Peso: alto; es el trabajo de más valor estratégico y el que más se apoya en los anteriores.

### M11 · Sacar del núcleo lo que es del vertical y unificar los dos motores de respuesta

**Cierra 2.8.**

- `intenciones.ts` y el texto con emoji se van de `mensajeria/`: Excursiones declara su intención y su respuesta como **una automatización sembrada** (`Automation` con `triggerEvent: 'mensaje.recibido'`, condición «texto contiene…», acción `send_whatsapp`). El núcleo no sabe qué es un tour.
- `AutoReplyConfig` se conserva como **la vista simple** («palabras clave → respuesta») que **compila** a `Automation`, en vez de un segundo motor con su propio orden de evaluación. Un solo camino de ejecución, una sola bitácora de por qué se respondió.
- `Prospecto` y `Lead`: decidir explícitamente (no en esta auditoría) si `Lead` es la vista manual de `Prospecto` o un concepto distinto, y escribirlo en `crm.prisma`. Hoy conviven sin relación.
- Corregir `autoReply-actions.ts`: sección `integraciones` o `leads` según corresponda y `revalidatePath` a la ruta real (`/admin/crm/configuracion/auto-reply`).

Peso: medio. Es limpieza de la reconciliación; conviene hacerla antes de que crezca sobre ella.

### M0 · Lo que se arregla en una tarde (y no espera a nada)

- Añadir `'conectores'` a los catálogos globales de `2026-07-rls-capa2-aislamiento.sql:279` (2.9).
- Publicar `facebook` e `instagram` en el catálogo y corregir su nombre/categoría en base (2.3) — o esperar a M3 si va a ir en el mismo corte.
- Cambiar los 12 literales de evento por su constante (2.2).
- `revalidatePath('/admin/connect')` → ruta real (2.8).
- `docs/INTEGRACIONES.md`: «cron horario» → diario, hasta M5.
- Anotar en `docs/connect/meta-arquitectura.md` §1 qué puntos ya no describen `main`.

---

## 5. Estructura propuesta del módulo

Sin mover lo que funciona. El cambio es de **fronteras**, no de carpetas, y
se hace con barriles (`index.ts`) y pruebas que vigilan quién importa a quién.

```
src/modules/
  connect/          CONECTORES — Membego usa a otros
    proveedores/    contrato, registro, metadatos, uno por proveedor
    meta/           el único que habla con Graph
    (alta, oauth, credenciales, catalogo, salud, retencion)
  plataforma/       PLATAFORMA — otros usan a Membego
    api/            guardia, principales (sistema | empresa | app), errores, paginación, CORS
    salida/         ← nuevo: el único despachador de webhooks (absorbe integraciones/despacho y connect/webhooks)
    apps/           ← nuevo (M10): registro, OAuth entrante, consentimiento
    satelites/      ← lo que hoy es integraciones/ (registro, SSO, panel)
  eventos/          ← nuevo (M2): la tabla única + emitir(); estrategias/eventos.ts la consume
  mensajeria/, crm/ sin lógica de vertical; los verticales se enganchan por automatizaciones
packages/
  contracts/        la fuente: eventos, scopes, DTO con esquema, inventario, OpenAPI
  platform-sdk/     el cliente publicado
```

Reglas que una prueba de nivel fuente puede exigir desde el primer día:

1. `connect/` no importa de `plataforma/` ni al revés; los dos importan de `eventos/` y de `@membego/contracts`.
2. Nada fuera de `plataforma/salida/` hace `fetch` a una URL de suscripción.
3. Nada fuera de `connect/proveedores/` pregunta por un slug.
4. `mensajeria/` y `crm/` no nombran categorías de negocio.

Y las pantallas se quedan donde están: `/admin/integraciones` (catálogo,
para la dueña), `/admin/integraciones/desarrolladores` (claves, webhooks con
entregas, apps autorizadas), `/superadmin/connect` y `/superadmin/integraciones`
con su barra compartida — más `/desarrolladores` público (M9).

---

## 6. Hoja de ruta

Seis cortes, cada uno entregable y verificable por sí solo, en el orden en
que uno desbloquea al siguiente.

| Corte | Contenido | Desbloquea |
|---|---|---|
| **0 · La tarde** | M0 completo | Nada se rompe el día que se encienda RLS; los eventos ya no se escriben a mano |
| **1 · Un solo idioma** | M2 (tabla de eventos) + M1 (sobre y firma únicos, tabla de salida única) | El SDK verifica cualquier webhook; `reserva.pagada` y `mensaje.recibido` salen |
| **2 · Operación** | M5 (backoff en cola) + M4 (salud activa, retención) + M6 (entregas visibles, probar, reenviar) | La empresa se entera sola de lo que pasa con sus avisos |
| **3 · Framework limpio** | M3 (ganchos por proveedor, registro de componentes, siembra desde código) + M11 (vertical fuera del núcleo, un motor de respuesta) | Añadir un conector vuelve a ser tres archivos; añadir un vertical no toca `mensajeria/` |
| **4 · API para el mundo** | M7 (CORS, cursor, límites) + M8 (esquemas, paquetes publicables) + M9 (portal) | Un desarrollador externo puede empezar solo, desde el navegador, sin hablar con nadie |
| **5 · Apps de terceros** | M10 | Zapier, Make, un POS ajeno o una app propia se registran, piden permiso a la empresa y operan con scopes |

Fase 0 de Meta (las credenciales del panel) va **en paralelo** a todo esto:
no depende de ningún corte y ningún corte depende de ella.

---

## 7. Riesgos de hacerlo y de no hacerlo

| Si se hace | Mitigación |
|---|---|
| M1 cambia el cuerpo que reciben las empresas con webhook | Claves de legado dentro del mismo cuerpo durante una ventana (el patrón ya usado en satélites); `X-Membego-Firma` HMAC se mantiene hasta que nadie la use |
| M7 cambia la forma de las listas | Aditivo: `nextCursor` se añade, la clave actual se conserva una versión; `Sunset` anunciado en cabecera |
| M3 toca el alta de proveedores en producción | Cada gancho se mueve con la prueba que ya lo cubre (`connect-alta`, `connect-oauth`, `connect-calendario-citas`) |

| Si no se hace | Coste |
|---|---|
| Cada integrador nuevo descubre por su cuenta que hay dos firmas | Soporte manual y desconfianza en el primer contacto |
| Cada evento nuevo hay que añadirlo en tres listas | Eventos que se emiten y no salen (ya pasa con `reserva.pagada`) |
| Cada conector nuevo toca de cinco a nueve sitios | El framework deja de ser framework |
| Sin CORS ni paginación | La primera app web de terceros no puede existir; la primera empresa con 10 000 clientes rompe `/customers` |

---

## Documentos relacionados

- `docs/connect/meta-arquitectura.md` — Meta, con la Fase 0 y sus herramientas (§13)
- `docs/platform/*.md` — el estándar de integración v1, fase a fase
- `docs/PLATFORM_ARCHITECTURE_REPORT.md` §17 — fases 7b, 8, 9, 10 pendientes
- `docs/INTEGRACIONES.md` — el contrato con satélites (corregir «cron horario»)
- `docs/CRM-IMPLEMENTACION.md` — la reconciliación que dejó las duplicidades de §2.8
- `docs/ESTRATEGIA-PLATAFORMA.md` — la regla evolutiva que esta auditoría respeta
