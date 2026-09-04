# Meta en MembeGo · auditoría y arquitectura definitiva

> Auditoría hecha el 4 de septiembre de 2026 sobre `main` (`34bcff26` + #451),
> contra la documentación oficial de Meta indicada en «Documentación oficial de
> Meta para Membego». Cada afirmación técnica sobre Meta lleva su fuente; lo
> que no se pudo verificar en la documentación se marca con ⚠ y NO se
> implementa hasta confirmarlo en el panel real.
>
> Sustituye en alcance a `whatsapp-embedded-signup.md`, que sigue siendo válido
> como investigación del alta incrustada.

---

## 1. Estado actual

### 1.1 Lo que es REAL (llama a Meta o procesa eventos firmados)

| Pieza | Archivo | Qué hace | Ejecutado contra Meta |
|---|---|---|---|
| Envío de texto por Cloud API | `src/modules/connect/whatsapp.ts:152-218` | `POST /{phone_number_id}/messages` con `messaging_product: whatsapp` | Sí (alta manual con token) |
| Alta manual con token permanente | `whatsapp.ts:66-110` + `AltaWhatsapp.tsx` | Verifica el número (`GET /{phone_number_id}?fields=display_phone_number,verified_name`) y sella la credencial | Sí |
| Alta incrustada (Embedded Signup), servidor | `src/modules/connect/metaEmbedded.ts` | Canje `GET /oauth/access_token` → `debug_token` (permisos + `granular_scopes.target_ids`) → `GET /{waba}/phone_numbers` → reclamo UNIQUE en base → `POST /{phone}/register` con PIN → `POST /{waba}/subscribed_apps` → credencial sellada | **Nunca** (`metaEmbedded.ts:43`) |
| Alta incrustada, navegador | `src/components/connect/AltaMetaWhatsapp.tsx` + `metaNavegador.ts` | SDK `connect.facebook.net`, `FB.login({config_id, response_type:'code', override_default_response_type:true, extras})`, lectura de `WA_EMBEDDED_SIGNUP` por `postMessage` con origen exacto, recolector de la carrera código/mensaje | **Nunca** (`AltaMetaWhatsapp.tsx:45`) |
| Webhook de Meta | `src/app/api/connect/meta/webhook/route.ts` | GET handshake (`hub.verify_token` → `hub.challenge`), POST con firma `X-Hub-Signature-256` sobre el cuerpo crudo, resolución de empresa por `(conectorId, cuentaExterna)` UNIQUE | **Nunca** (`route.ts:28`) |
| Motor de automatizaciones | `src/modules/estrategias/actionSink.ts:130-152` | `send_whatsapp` envía de verdad si hay conexión; si no, degrada a `simulated: true` | Sí |
| Aislamiento multiempresa | `prisma/schema/connect.prisma:140-143` | `@@unique([companyId, conectorId])` y `@@unique([conectorId, cuentaExterna])` | — |
| Credenciales | `src/modules/connect/credenciales.ts` | AES-256-GCM con AAD por fila, `CONNECT_CLAVES_MAESTRAS` con rotación, falla cerrado | — |
| CSP | `next.config.ts:132,143,155` | `connect.facebook.net`, `graph.facebook.com`, `www/web.facebook.com` exactos | — |

### 1.2 Lo que es INCOMPLETO

- **El webhook descarta el contenido** (`route.ts:114-124`): guarda `meta.<field>` y `{ wabaId }` en la bitácora. No persiste mensajes ni estados (`statuses`), no maneja `account_update`. Nada de lo que un cliente escribe llega a ninguna pantalla.
- **No hay plantillas de WhatsApp**: fuera de la ventana de 24 h Meta exige una plantilla aprobada; hoy el envío falla y queda en la salud (`whatsapp.ts:143-151`). No hay sincronización de plantillas (`GET /{waba}/message_templates`) ni envío `type: template`.
- **Dos versiones de Graph conviven**: `v21.0` fija en `whatsapp.ts:27`; `v25.0` configurable en `metaNucleo.ts:57`.
- **`appsecret_proof` no se manda** en ninguna llamada de servidor. Meta lo recomienda para toda llamada desde servidor y permite exigirlo («Require App Secret»); sin él, un token robado se usa desde cualquier sitio.
- **Desconectar WhatsApp no toca Meta**: borra la credencial y ya. La app sigue suscrita a los webhooks del WABA del cliente (`/{waba}/subscribed_apps`).
- **Salud pasiva**: no hay comprobación periódica del token/número; el estado solo cambia cuando un envío falla.
- **Los parámetros `extras` del diálogo** (`AltaMetaWhatsapp.tsx:191`: `featureType: ''`, `sessionInfoVersion: '3'`) no aparecen en la página oficial de implementación consultada, que solo documenta `extras: { setup: {} }`. ⚠ Confirmar en el panel de Meta contra la v4 antes de la primera prueba real.

### 1.3 Lo que es MOCK / DEMO

| Pantalla | Evidencia |
|---|---|
| `/admin/crm/conversaciones` (bandeja WhatsApp · Instagram · Messenger · Email) | `page.tsx:1` `'use client'`; `:58-174` `INITIAL_CONVERSATIONS` inventadas; `:221-237` «enviar» solo hace `setState`. Cero base, cero Meta. |
| `/admin/crm` (prospectos) | `page.tsx:135` `INITIAL_LEADS` |
| `/admin/crm/seguimientos` | `page.tsx:71-77` `MOCK_LEADS`, `INITIAL_ACTIVIDADES` |
| `/admin/crm/metricas` | `page.tsx:15-49` `STATS`, `FUENTES`, `ASIGNADOS` hardcoded |
| `/admin/crm/configuracion` | `page.tsx:52-60` `DEFAULT_STAGES`, `DEFAULT_CAMPOS` |

### 1.4 Lo que es SOLO METADATOS

- **Facebook e Instagram**: tarjetas del catálogo en `METADATOS_PREVISTOS` (`proveedores/metadatos.ts:86-98`), sembradas en `DRAFT` con `authTipo='NINGUNA'` (`20260903_connect_framework/migration.sql:68-69`). No hay ni una línea de Facebook Login, Pages, Messenger o Instagram Graph.
- `WhatsAppConfig` (`soporte.prisma:31-47`) y `WhatsAppButton.tsx` son el enlace `wa.me` del botón de contacto; no tienen relación con la Cloud API.
- `Company.whatsapp/instagram/facebook` son URLs del perfil público.

---

## 2. Problemas encontrados

1. **Nada del camino Meta se ha ejecutado contra Meta.** Tres archivos lo declaran. El código está bien construido pero es teoría hasta la primera alta real.
2. **Aislamiento incompleto para lo que viene.** El UNIQUE protege el WABA. No existe modelo para Páginas de Facebook ni cuentas de Instagram, ni para conversaciones/contactos/mensajes: no hay nada que aislar todavía, pero tampoco nada que lo garantice cuando exista.
3. **La bandeja del CRM engaña.** Un administrador ve conversaciones «de WhatsApp» que no existen y un botón de enviar que no envía. Contradice la regla del proyecto («no números inventados») y la instrucción de esta integración.
4. **Sin plantillas no hay mensajería saliente real** fuera de 24 h: recordatorios de citas, avisos de vencimiento y campañas dependen de plantillas aprobadas.
5. **Seguridad de llamadas**: sin `appsecret_proof`; el `client_secret` viaja en query string en el canje (es lo documentado por Meta, pero obliga a que ninguna capa registre URLs completas: hoy `canjearCodigo` ya lo cuida en el `catch`, `metaEmbedded.ts:179-180`).
6. **Desconexión asimétrica**: para Google se revoca; para WhatsApp no se anula la suscripción del WABA. La empresa cree que apagó y Meta sigue mandándonos sus eventos (que el webhook descarta por no tener dueño, pero llegan).
7. **Versión de Graph inconsistente** y la retirada de Embedded Signup v2 el 15 de octubre de 2026 (`whatsapp-embedded-signup.md:40`).
8. **Sin cola para el webhook**: Meta reintenta durante 36 horas y no garantiza orden ni ausencia de duplicados (webhooks getting-started). El handler procesa en línea dentro de la petición; con mensajes reales eso son timeouts en Vercel y duplicados en la base.

## 3. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Límite de **10 altas por 7 días** sin Verificación de Negocio + App Review | Pruebas y primeros clientes limitados | Iniciar Verificación de Negocio ya; probar con pocas cuentas |
| **App Review** para `pages_messaging`, `instagram_manage_messages` (Acceso avanzado, vídeo por permiso) | Facebook/Instagram no se pueden ofrecer a terceros hasta aprobación (semanas) | Construir y grabar con la app en modo desarrollo sobre una Página propia; pedir revisión con el prototipo |
| **Token de usuario de larga duración caduca a 60 días**; no existe refresco de servidor (get-long-lived) | Instagram/Facebook piden reconectar periódicamente | Los tokens de Página de larga duración no caducan: usar siempre token de Página; guardar `expires_at` y `data_access_expires_at` de `debug_token` y avisar antes |
| **`data_access_expires_at`** (90 días) | Acceso a datos caduca aunque el token viva | Vigilarlo en la salud; estado `REAUTORIZAR` |
| **Coste de conversaciones** de WhatsApp lo paga la empresa (método de pago en WhatsApp Manager) | Empresas sin método de pago no envían | Ya está en el paso «Antes de empezar»; añadir chequeo de salud |
| **Registro del número: 10 intentos / 72 h** (error 133016) | Reintentos en bucle bloquean el número | Ya contemplado (`metaEmbedded.ts:144-147`); no reintentar automáticamente |
| Webhook público en Vercel: tiempo de respuesta y reintentos 36 h | Duplicados, pérdida por timeout | Persistir crudo + deduplicar por id de mensaje + procesar en cola (QStash ya existe en `modules/jobs`) |
| Secreto de app y tokens | Fuga = suplantación total | Sellado existente; `appsecret_proof`; «Require App Secret» en el panel de Meta |

---

## 4. Arquitectura propuesta

```
                    ┌──────────────── Meta ────────────────┐
                    │  Facebook Login for Business (2 configs)│
                    │  Graph API vX (única, configurable)     │
                    │  Webhooks: whatsapp_business_account,   │
                    │            page, instagram              │
                    └───────┬─────────────────▲──────────────┘
                            │ eventos firmados │ llamadas con appsecret_proof
                            ▼                 │
   /api/connect/meta/webhook  ──►  EventoMeta (crudo, dedupe, cola)
            │                            │
            │  resolver activo → empresa │ (ActivoMeta UNIQUE por idExterno)
            ▼                            ▼
   ┌──────────────── modules/connect/meta/ ────────────────┐
   │ graph.ts (cliente único)   tokens.ts (canje, larga     │
   │ activos.ts (Páginas, IG,   duración, debug, revocar)   │
   │   WABA, números)           webhookDispatcher.ts        │
   │ whatsapp/ (envío, plantillas, ventana 24h)             │
   │ messenger/ (Send API)      instagram/ (mensajes)       │
   └───────────────┬────────────────────────┬──────────────┘
                   ▼                        ▼
        modules/mensajeria/            modules/crm/  ·  estrategias/
        Conversacion · Mensaje ·       Prospecto desde conversación
        Contacto (por empresa)         Automatizaciones: disparadores
                   ▼                    y acciones por canal
        Bandeja unificada (/admin/crm/conversaciones, REAL)
```

### 4.1 Decisiones

1. **Una app de Meta** (tipo Business), **dos configuraciones** de Facebook Login for Business: la de WhatsApp (Embedded Signup, ya existe: `NEXT_PUBLIC_META_CONFIG_ID`) y una nueva para Páginas + Instagram (token de usuario). Facebook Login for Business sustituye `scope` por `config_id` (doc «Facebook Login for Business»).
2. **Dos conectores en el catálogo, no tres.** `whatsapp` (existe) y `facebook` renombrado a **«Facebook e Instagram»**: una sola autorización de Meta devuelve las Páginas y, por cada Página, su cuenta profesional de Instagram (`GET /{page-id}?fields=instagram_business_account`). La tarjeta `instagram` pasa a ADAPTADA y lleva a la misma conexión, para que quien busque «Instagram» la encuentre. Pedir dos logins para lo que Meta entrega en uno sería peor UX y el doble de tokens que custodiar.
3. **Conexión ↔ activos.** `ConexionEmpresa` sigue siendo «la empresa autorizó a MembeGo con Meta»; los activos (Páginas, cuentas IG, WABA, números) viven en una tabla nueva `ActivoMeta` con UNIQUE `(tipo, idExterno)`: un activo pertenece a una sola empresa **por construcción de la base**, igual que hoy el WABA.
4. **Un solo webhook, un solo dispatcher.** La ruta existente se conserva; el POST solo verifica firma, guarda el evento crudo con clave de deduplicación y responde 200. El procesamiento (mensajes, estados, comentarios, `account_update`) va en cola por empresa.
5. **La mensajería es un módulo propio** (`modules/mensajeria`), no una extensión del CRM: WhatsApp, Messenger e Instagram escriben en `Conversacion`/`Mensaje`, y el CRM, las automatizaciones y la bandeja LEEN de ahí. Un contacto externo (`wa_id`, PSID, IGSID) se enlaza a un `Cliente` cuando se puede, nunca se adivina.
6. **Ningún token baja al navegador.** Lo único público: `NEXT_PUBLIC_META_APP_ID` y los `config_id`. El SDK de Meta solo se usa para el diálogo de WhatsApp; Facebook/Instagram usan redirección OAuth de servidor con el módulo `oauth.ts` que ya existe (PKCE, `state` firmado).
7. **Versión de Graph única** (`META_GRAPH_VERSION`, por defecto la de `metaNucleo.ts`), consumida por todos los módulos a través de un cliente único con `appsecret_proof`.

### 4.2 Lo que se reutiliza tal cual
`credenciales.ts` (sellado), `oauth.ts`/`oauthNucleo.ts` (redirección + PKCE + state), `registro.ts` (ciclo de vida y salud), `bitacora.ts`, `metaNucleo.ts` (firma, handshake, PIN), `metaEmbedded.ts` (alta incrustada), `whatsapp.ts` (envío, tras unificar versión), el catálogo y el asistente de alta, el motor de automatizaciones, `modules/jobs` (cola).

### 4.3 Lo que se reemplaza
Las cinco pantallas mock del CRM (por datos reales del módulo de mensajería y de prospectos); el cuerpo del POST del webhook (por persistencia + cola); el envío de WhatsApp (por texto **o plantilla** según la ventana).

---

## 5. Modelo de datos necesario

Todas las tablas nuevas llevan `companyId` y entran en RLS como el resto (`ci.yml` lo comprueba).

```prisma
/// Un activo de Meta que una empresa autorizó: Página, cuenta IG, WABA o número.
model ActivoMeta {
  id          String   @id @default(cuid())
  companyId   String
  conexionId  String
  tipo        String   // PAGE | IG_ACCOUNT | WABA | PHONE_NUMBER
  idExterno   String   // page id · ig user id · waba id · phone_number_id
  nombre      String?
  padreId     String?  // IG_ACCOUNT → su PAGE; PHONE_NUMBER → su WABA
  /// Token de Página de larga duración, sellado (solo PAGE). AAD = activo.
  sellado     String?
  keyVersion  Int?
  metadata    Json?    // username IG, tareas de la Página, número visible…
  suscritoAt  DateTime? // cuándo se suscribió la app a sus webhooks
  estado      String   @default("ACTIVE") // ACTIVE | PAUSED | REMOVED
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([tipo, idExterno])           // un activo, UNA empresa
  @@index([companyId, tipo])
  @@index([conexionId])
}

/// Cada notificación de Meta, cruda, deduplicada. Se procesa en cola.
model EventoMeta {
  id           String    @id @default(cuid())
  objeto       String    // whatsapp_business_account | page | instagram
  entryId      String    // entry[].id
  campo        String    // messages | statuses | account_update | comments…
  claveDedupe  String    @unique // objeto:entryId:campo:id-del-item (o hash)
  companyId    String?   // null hasta resolver el dueño
  activoId     String?
  payload      Json
  recibidoAt   DateTime  @default(now())
  procesadoAt  DateTime?
  error        String?
  @@index([companyId, recibidoAt])
  @@index([procesadoAt])
}

model Contacto {          // la persona al otro lado, POR EMPRESA
  id            String   @id @default(cuid())
  companyId     String
  canal         String   // WHATSAPP | MESSENGER | INSTAGRAM
  idExterno     String   // wa_id | PSID | IGSID (los PSID/IGSID son por Página/app)
  nombre        String?
  telefono      String?  // solo WhatsApp (wa_id es E.164)
  clienteId     String?  // enlace a Cliente cuando se identifica
  metadata      Json?
  @@unique([companyId, canal, idExterno])
}

model Conversacion {
  id              String   @id @default(cuid())
  companyId       String
  canal           String
  activoId        String   // por qué número/Página/cuenta entró
  contactoId      String
  estado          String   @default("ABIERTA") // ABIERTA | CERRADA | ARCHIVADA
  asignadoAId     String?
  ultimoEntranteAt DateTime? // base de la ventana de 24 h
  ultimoMensajeAt  DateTime?
  noLeidos        Int      @default(0)
  @@unique([companyId, activoId, contactoId])
  @@index([companyId, ultimoMensajeAt])
}

model Mensaje {
  id             String   @id @default(cuid())
  companyId      String
  conversacionId String
  direccion      String   // ENTRANTE | SALIENTE
  idExterno      String?  // wamid / mid; UNIQUE con canal
  canal          String
  tipo           String   // text | image | audio | document | template | …
  texto          String?
  adjuntos       Json?
  plantilla      Json?    // nombre, idioma, parámetros (SALIENTE)
  estado         String   @default("ENVIANDO") // ENVIANDO | ENVIADO | ENTREGADO | LEIDO | FALLIDO | RECIBIDO
  errorCodigo    Int?
  errorDetalle   String?
  enviadoPorId   String?  // usuario, o null si automatización
  origen         String?  // 'bandeja' | 'automatizacion:<id>' | 'sistema'
  timestamp      DateTime // el de Meta
  createdAt      DateTime @default(now())
  @@unique([canal, idExterno])
  @@index([conversacionId, timestamp])
}

model PlantillaWhatsapp {
  id          String   @id @default(cuid())
  companyId   String
  activoId    String   // el WABA
  idExterno   String   // id de plantilla en Meta
  nombre      String
  idioma      String
  categoria   String   // MARKETING | UTILITY | AUTHENTICATION
  estado      String   // APPROVED | PENDING | REJECTED | PAUSED…
  componentes Json
  sincronizadoAt DateTime
  @@unique([activoId, nombre, idioma])
}
```

`ConexionEmpresa.cuentaExterna/recursoExterno` se mantienen para WhatsApp (compatibilidad con el webhook actual) y se rellenan también en `ActivoMeta`; a medio plazo el webhook resuelve solo por `ActivoMeta`.

---

## 6. Endpoints

### De Meta que MembeGo consume (todos por servidor, con `appsecret_proof`)

| Uso | Endpoint | Token | Fuente |
|---|---|---|---|
| Canje del alta incrustada | `GET /oauth/access_token?client_id&client_secret&code` | — | Embedded Signup · Tech Provider |
| Canje de Facebook Login (redirección) | `GET /oauth/access_token?client_id&client_secret&redirect_uri&code` | — | Facebook Login |
| Token de larga duración | `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` → `expires_in` (~60 días) | usuario corto | Access tokens · get-long-lived |
| Inspección | `GET /debug_token?input_token=…` con token de app → `is_valid, expires_at, data_access_expires_at, scopes, granular_scopes[].target_ids` | app | Graph · debug_token |
| Páginas y sus tokens | `GET /{user-id}/accounts` (con token largo → tokens de Página **sin caducidad**) | usuario largo | get-long-lived · Pages |
| Cuenta IG de una Página | `GET /{page-id}?fields=instagram_business_account` | Página | Instagram · get-started |
| Suscribir Página/IG | `POST /{page-id}/subscribed_apps?subscribed_fields=messages,…` | Página (MODERATE) | Messenger · webhooks |
| Suscribir WABA | `POST /{waba-id}/subscribed_apps` | negocio | Tech Provider |
| Registrar número | `POST /{phone-number-id}/register` `{messaging_product, pin}` | negocio | Tech Provider |
| Enviar WhatsApp | `POST /{phone-number-id}/messages` (text · template) | negocio | Cloud API |
| Plantillas | `GET /{waba-id}/message_templates` ⚠ (campos a confirmar) | negocio | Cloud API |
| Enviar Messenger | `POST /{page-id}/messages` `{recipient:{id}, messaging_type, message}` | Página | Send API |
| Enviar Instagram | `POST /{ig-user-id}/messages` ⚠ (confirmar forma exacta) | Página | Messenger for IG |
| Revocar (Facebook/IG) | `DELETE /{user-id}/permissions/{permission}` por cada permiso | usuario o app | Graph · permissions |
| Desconectar WABA | `DELETE /{waba-id}/subscribed_apps` ⚠ (confirmar) | negocio | — |

### De MembeGo

| Ruta | Estado | Cambio |
|---|---|---|
| `GET/POST /api/connect/meta/webhook` | existe | POST: firmar → `EventoMeta` (dedupe) → 200 → cola |
| `GET /api/connect/oauth/[slug]/iniciar` y `/callback` | existen | proveedor `facebook` con `extra: { config_id }` (Login for Business) |
| `POST /api/jobs` (QStash) | existe | nuevo trabajo `meta.evento` |
| Server actions `modules/mensajeria/actions.ts` | nuevo | listar conversaciones, enviar, marcar leído, asignar |
| Server actions de activos | nuevo | elegir Páginas, sincronizar plantillas, desconectar |

---

## 7. Permisos de Meta (mínimo privilegio)

| Canal | Permiso | Para qué | Fuente |
|---|---|---|---|
| WhatsApp | `whatsapp_business_management` | cuenta, números, plantillas | Embedded Signup |
| WhatsApp | `whatsapp_business_messaging` | registrar número, enviar/recibir | Embedded Signup |
| Facebook | `pages_show_list` | listar Páginas | Pages API |
| Facebook | `pages_manage_metadata` | suscribir webhooks de la Página | Messenger webhooks |
| Facebook | `pages_messaging` | Messenger Send API | Send API |
| Instagram | `instagram_basic` | cuenta IG enlazada | IG get-started |
| Instagram | `instagram_manage_messages` | mensajes directos | Messenger for IG |

**No se piden**: `pages_read_engagement`/`pages_manage_posts` (no publicamos ni leemos el muro), `instagram_manage_comments` (fase posterior, exige Acceso avanzado), `instagram_content_publish` (publicar no está en el alcance), `business_management` (no gestionamos portafolios). Para servir a empresas ajenas hace falta **Acceso avanzado** vía App Review de cada permiso (Facebook Login for Business).

---

## 8. Variables de entorno

| Variable | Estado | Uso |
|---|---|---|
| `NEXT_PUBLIC_META_APP_ID` | existe | id de la app (SDK y diálogos) |
| `META_APP_SECRET` | existe | canje, `debug_token`, firma de webhooks, `appsecret_proof` |
| `NEXT_PUBLIC_META_CONFIG_ID` | existe | configuración de Login for Business para **WhatsApp** |
| `NEXT_PUBLIC_META_CONFIG_ID_PAGES` | **nueva** | configuración de Login for Business para **Páginas + Instagram** |
| `META_WEBHOOK_VERIFY_TOKEN` | existe | handshake |
| `META_GRAPH_VERSION` | existe | versión única de Graph (se aplica también al envío) |
| `PLATFORM_TOKEN_SECRET`, `CONNECT_CLAVES_MAESTRAS` | existen | firma del `state`, sellado |
| `QSTASH_*` | existen | cola de eventos |

En Meta: URL del webhook `https://membego.com/api/connect/meta/webhook`, dominio en «Allowed domains» y `https://membego.com/api/connect/oauth/callback` en «Valid OAuth redirect URIs». «Require App Secret» activado cuando todas las llamadas lleven `appsecret_proof`.

---

## 9. Estrategia de tokens

| Canal | Token | Vida | Dónde | Renovación | Revocación |
|---|---|---|---|---|---|
| WhatsApp (alta incrustada) | Business Integration System User token | no caduca por defecto | `CredencialConexion` sellado (con PIN) | ninguna; `debug_token` en la salud | ⚠ anular `subscribed_apps` + borrar; el token de negocio no tiene revocación documentada en lo consultado |
| WhatsApp (manual, provisional) | token de Usuario del Sistema | no caduca | igual | — | borrar |
| Facebook/IG | usuario largo (60 d) | `expires_at`, `data_access_expires_at` | `CredencialConexion` OAUTH_TOKENS | **no existe refresco de servidor**: reconectar (estado `REAUTORIZAR` antes de vencer) | `DELETE /{user}/permissions/{p}` |
| Facebook/IG | Página de larga duración | sin caducidad | `ActivoMeta.sellado` por Página | se regeneran con `/{user}/accounts` mientras el de usuario viva | cae con el de usuario |

Reglas: nunca en claro, nunca al navegador, nunca en logs (los `catch` no serializan URLs), `debug_token` al conectar para guardar permisos concedidos y fechas, `appsecret_proof` en cada llamada.

---

## 10. Estrategia de webhooks

1. **Una URL**, tres objetos: `whatsapp_business_account`, `page`, `instagram`. Suscripción a nivel de app en el panel; a nivel de activo con `subscribed_apps` en el momento de conectar.
2. **Campos**: WhatsApp `messages` (trae mensajes y `statuses`), `account_update`; Página `messages, messaging_postbacks, message_deliveries, message_reads`; Instagram `messages` (+ `comments` cuando haya Acceso avanzado).
3. **Ruta**: firma `X-Hub-Signature-256` sobre el crudo → parsear → por cada item una fila `EventoMeta` con `claveDedupe` (id del mensaje/estado, o hash del item) → 200 inmediato. Meta reintenta 36 h y no garantiza orden: la unicidad hace inofensivo el duplicado.
4. **Procesamiento en cola** por evento: resolver `ActivoMeta` por `entry.id` (WABA / page id / IG id) → empresa → handler por campo → `Conversacion`/`Mensaje` → disparadores de automatización. Sin dueño: se conserva 7 días marcado `sin_dueño` (puede ser un alta en curso) y se descarta.
5. **Privacidad**: el crudo se guarda para reprocesar, con retención corta (30 días) y sin bitácora del contenido.
6. **Estados salientes**: `statuses` (sent/delivered/read/failed) actualizan `Mensaje.estado` por `idExterno`; `failed` con `errors[].code` alimenta la salud de la conexión (clase por código).

---

## 11. Fases de implementación

| Fase | Entrega | Verificación |
|---|---|---|
| **0 · Preparación** (plataforma) | App de Meta configurada (Business), 2 configs de Login for Business, webhook y dominios; `.env`; unificar versión de Graph; cliente Graph único con `appsecret_proof`; helper de `debug_token` | Alta incrustada de WhatsApp **ejecutada de verdad** con una cuenta de prueba; ⚠ resueltos |
| **1 · Núcleo Meta** | `ActivoMeta`, `EventoMeta`; dispatcher de webhooks + cola; salud con `debug_token`; desconectar anula suscripciones; migraciones aditivas | Webhook real recibido, deduplicado y atribuido; tests unitarios del dispatcher |
| **2 · WhatsApp completo** | Mensajes entrantes y estados persistidos; plantillas (sync + envío); ventana 24 h; `Contacto`/`Conversacion`/`Mensaje` | Conversación real ida y vuelta; recordatorio de cita por plantilla |
| **3 · Facebook (Páginas + Messenger)** | Conector `facebook` con Login for Business; elegir Páginas; tokens de Página sellados; suscripción; entrantes + Send API | Mensaje real desde una Página propia |
| **4 · Instagram** | Cuenta IG por Página; `messages`; envío | DM real |
| **5 · Bandeja unificada** | `/admin/crm/conversaciones` real: lista, hilo, envío, asignación, indicador de ventana, selector de plantilla; mocks retirados | E2E con datos de la base |
| **6 · CRM** | Prospecto desde primera conversación entrante; origen por canal; retirar mocks de prospectos/seguimientos/métricas | Datos reales en las 4 pantallas |
| **7 · Automatizaciones** | Disparador «mensaje entrante», acciones `send_whatsapp` con plantilla, `send_messenger`, `send_instagram` | Regla real de extremo a extremo |

Cada fase termina con: tests (unitarios + fuente), suite completa en verde, PR propio, y una comprobación **contra Meta** de lo que toca Meta. Las fases 3–4 requieren App Review para terceros: se desarrollan con Páginas propias y se pide la revisión con el prototipo grabado.

## 12. Estado de la implementación (4 de septiembre de 2026)

Las siete fases de código están en la rama `claude/meta-integracion` (PR #453), cada una con sus pruebas y la suite completa en verde:

| Fase | Estado | Dónde |
|---|---|---|
| 1 · Núcleo | Hecha | `modules/connect/meta/*`, `ActivoMeta`, `EventoMeta`, cola `meta-evento` |
| 2 · WhatsApp | Hecha | `modules/mensajeria/{entrantes,salientes,plantillas,contactos}.ts` |
| 3 · Facebook | Hecha | conector `facebook` («Facebook e Instagram»), `modules/connect/meta/paginas.ts`, `modules/mensajeria/messenger.ts` |
| 4 · Instagram | Hecha | tarjeta adaptada; DM por `POST /{PAGE-ID}/messages` con token de Página (verificado) |
| 5 · Bandeja | Hecha | `/admin/crm/conversaciones`, `modules/mensajeria/{bandeja,actions}.ts` |
| 6 · CRM | Hecha | `modules/crm/*`, prospecto automático en `modules/mensajeria/trasEntrante.ts` |
| 7 · Automatizaciones | Hecha | `mensaje.recibido`, `prospecto.creado`; `send_whatsapp` (plantilla), `send_messenger`, `send_instagram` |

**Lo que NO se ha hecho todavía** (y no puede hacerse desde el código):

- La fase 0 del panel de Meta: app de tipo Business, las dos configuraciones de Login for Business (`NEXT_PUBLIC_META_CONFIG_ID` para WhatsApp, `NEXT_PUBLIC_META_CONFIG_ID_PAGES` para Páginas), el webhook en `https://membego.com/api/connect/meta/webhook` con `META_WEBHOOK_VERIFY_TOKEN`, dominios, Tech Provider y verificación del negocio; y las variables en `.env.local` y Vercel.
- La comprobación **contra Meta** de cada fase (alta incrustada real, un mensaje real por cada canal, un webhook real).
- Tres puntos marcados ⚠ en el código porque la documentación no pudo confirmarlos: el cuerpo de envío de plantilla (`cuerpoMensajePlantilla`, verificar con la colección de Postman antes del primer envío real), la forma de `delivery`/`read` de Messenger (solo se aplican con `mids`), y los `extras` del Embedded Signup v4.
- Tras desplegar: `bun run db:migrate:deploy` y reaplicar `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` (hay seis tablas nuevas con `companyId`); el superadmin debe publicar los conectores `facebook` e `instagram` en el catálogo.
