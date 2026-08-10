# MEMBEGO PLATFORM ARCHITECTURE REPORT

Auditoría previa al *Membego Platform Integration Standard v1*.
**No se ha modificado código.** Este documento es el entregable para revisión.

> **Corrección de partida.** El encargo dice «analiza la integración actual
> Car Wash ↔ Membego». Esa integración **no existe**. Car Wash no es un sistema
> conectado: es un módulo dentro del monolito. Lo que sí existe es una
> infraestructura de satélites completa —registro, outbox, firma HMAC, SSO en
> ambos sentidos— que **ningún sistema usa todavía**.
>
> El trabajo no es migrar una integración. Es **extraer un vertical** y
> **completar una plataforma a medio construir**.

---

## 1 · Arquitectura actual

### 1.1 Dos modelos de integración coexisten

| | Vertical **embebido** | Vertical **satélite** |
|---|---|---|
| Ejemplo | Car Wash (hoy) | ninguno todavía |
| Código | `src/modules/carwash/` (19 archivos) | — |
| Datos | `prisma/schema/carwash.prisma` · **20 modelos**, 661 líneas | base propia |
| Rutas | `/admin/app/carwash/*` (13 secciones) | dominio propio |
| Acceso | capacidades + rol | SSO firmado |
| Aislamiento | `companyId` aplicativo | `companyId` en el token |

**Car Wash está embebido.** Comparte proceso, base de datos, despliegue,
esquema Prisma y sesión con el Core.

### 1.2 Lo que ya existe de plataforma

Esto es bastante más de lo que el encargo asume, y es sólido:

**`SistemaConectado`** (`prisma/schema/integraciones.prisma`) — registro de
sistemas: `slug`, `nombre`, `categoria`, `urlBase`, `urlWebhook`, `secreto`,
`activo`.

**`EventoSaliente`** — **outbox real**. El evento se persiste antes de
intentar entregarlo; `estado` PENDIENTE→ENVIADO|FALLIDO, `intentos`,
`ultimoError`. Un cron (`/api/cron/integraciones`, autenticado con
`CRON_SECRET`) reintenta hasta **8 veces**. Nada se pierde en silencio.

**`modules/integraciones/nucleo.ts`** — núcleo **puro**, sin Prisma ni red:
firma HMAC-SHA256, comparación `timingSafeEqual`, creación y verificación de
tokens SSO en los dos sentidos. Está escrito explícitamente para que el
satélite implemente *las mismas operaciones*. Es, de hecho, el primer contrato
del sistema.

**SSO bidireccional** — `urlAperturaSSO()` genera un token de **90 segundos**
con `sub`, `email`, `rol`, `companyId`, `exp`. `/sso/entrar` acepta el camino
inverso. La verificación de *nuestros* tokens es deliberadamente más estricta
que la de los entrantes, y está comentado por qué.

**Capacidades** (`modules/capacidades/`) — catálogo puro de categorías y
funciones, con paquete base por categoría y overrides por empresa.

**App Launcher** (`modules/apps/catalogo.ts`) — catálogo declarativo de
aplicaciones por categoría. Su propio comentario dice: *«montar una categoría
nueva debe ser agregar una entrada aquí»*.

**Aislamiento** — `conEmpresa()` / `sinEmpresa()` / `conUsuario()`, con
`SET LOCAL` (no `SET`, por el pooler) y `sinEmpresa` exigiendo un `motivo`
escrito. `tests/aislamiento.test.ts` analiza el código fuente y falla si una
consulta múltiple sobre un modelo con `companyId` no lo filtra.

### 1.3 Cifras

| Métrica | Valor |
|---|---|
| Modelos Prisma | **130** |
| Modelos con `companyId` | **130** |
| Modelos del vertical Car Wash | 20 |
| Eventos reenviados a satélites | 7 |
| Endpoints de API entrante para satélites | **0** |
| Referencias a categoría fuera del vertical | **107** |

---

## 2 · Problemas actuales

### 2.1 No hay API de entrada — el hueco central

La integración es **de una sola dirección**. Membego empuja eventos y abre
sesiones; el satélite **no puede preguntar nada**.

No existe:

```
customers.lookup      memberships.getActive
benefits.evaluate     redemptions.consume
qr.validate           branches.list
```

Un satélite no puede saber si una membresía está activa, ni consumir un
beneficio. **Sin esto no hay plataforma**: hay notificaciones.

Es el punto §66/§67 del encargo, y es el que hay que construir primero.

### 2.2 Un sistema ↔ una categoría

`SistemaConectado.categoria` es **un `String`**. El encargo (§9) exige N:M:
un *Beauty System* sirviendo `SALON` + `BARBERSHOP` + `SPA`.

El filtro de despacho (`despacho.ts`) y la comprobación de SSO (`sso.ts`)
comparan `categoria !== sistema.categoria`. Cambiar la cardinalidad toca los
dos sitios, y solo esos dos. **Barato ahora, caro con veinte sistemas.**

### 2.3 No hay entitlements

Hoy el acceso es: *categoría compatible* + *sistema activo*. No existe
`CompanySystemEntitlement`. Si registro el Restaurant System, **todas** las
empresas de categoría `RESTAURANTE` lo tienen al instante. No hay forma de
habilitarlo por empresa, ni de suspenderlo, ni de asociarlo a un plan.

### 2.4 Las capacidades mezclan dos cosas incompatibles

`CAPACIDADES` tiene 19 valores en una sola lista:

- **Plataforma**: `PAGO_TRANSFERENCIA`, `PAGO_CARDNET`, `POS_CAJA`, `RULETA`,
  `CITAS`, `GIFT_CARDS`, `SEGUIMIENTO`, `NAVEGACION_V2`
- **Dominio Car Wash**: `COLA_VEHICULOS`, `EVIDENCIA_FOTOS`, `COMISIONES`,
  `INCIDENCIAS`, `COMPRAS`, `ACTIVOS`, `TURNOS`, `CUENTAS_CORPORATIVAS`,
  `INVENTARIO`

**Esto es el §6 del encargo en su forma concreta.** Cuando llegue Restaurant,
la lista crecerá con `MESAS`, `COCINA`, `RESERVAS`, `DELIVERY`; con Gym,
`RUTINAS`, `CLASES`, `ACCESOS`. Con diez verticales son doscientos valores en
un enum del Core que nadie puede leer entero.

Y **choca de frente con el concepto de capability del encargo** (§19), que es
otra cosa: `CUSTOMER_LOOKUP`, `BENEFIT_REDEMPTION` — *qué necesita un sistema
del Core*, no *qué funciones tiene una empresa*.

> **Dos conceptos, un nombre.** Hay que separarlos y bautizarlos distinto antes
> de escribir una línea. Propuesta en §6 de este informe.

### 2.5 El secreto compartido, en claro

`SistemaConectado.secreto` es `String` sin cifrar. El encargo (§25, §94) exige
«nunca guardar secretos en texto plano».

**Pero no es un descuido, y no se arregla hasheando.** Un secreto HMAC es
*simétrico*: para firmar hay que poder recuperarlo. Un hash lo haría inservible.

Las salidas reales son tres, y hay que elegir conscientemente:

| Opción | Coste | Qué resuelve |
|---|---|---|
| Cifrado en reposo (KMS / `pgcrypto`) | bajo | Un volcado de la base no entrega las firmas |
| Migrar a **par de claves asimétrico** (Ed25519) | medio | Membego firma con privada, el satélite verifica con pública. **Solo Membego guarda secreto** |
| OAuth2 client credentials para la API entrante | medio | Ahí sí `clientSecretHash`, porque el flujo es asimétrico |

**Recomendación:** asimétrico para eventos salientes, `clientSecretHash` para
la API entrante. Distinta dirección, distinto mecanismo.

### 2.6 RLS construido pero apagado

`prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` existe, está
probado, y `docs/DEVOPS.md` dice **«NO aplicar todavía»**. La aplicación se
conecta como `postgres`, que se salta RLS.

El aislamiento hoy es **100 % aplicativo**. La guardia estática es buena, pero
lee código: no protege de una consulta cruda, ni de un satélite que algún día
reciba credenciales de base de datos.

Con un vertical fuera del monolito, esto pasa de deuda a riesgo.

### 2.7 107 referencias a categoría fuera del vertical

Repartidas por `geo`, `onboarding`, `scanner`, `registro`, `superadmin` y
varias páginas. No todas son deuda —`flujoRequiereVehiculo()` es una
abstracción legítima— pero **el patrón que el §6 prohíbe ya está presente**.

### 2.8 Sin idempotencia end-to-end

`EventoSaliente.id` viaja en el cuerpo y sirve de deduplicador para el
receptor. Pero:

- No hay `idempotencyKey` en operaciones de escritura (no hay API de escritura)
- No hay patrón **inbox** documentado para el satélite
- No hay `DEAD_LETTER`: tras 8 intentos queda `FALLIDO`, sin reproceso

### 2.9 Sin observabilidad de integración

No hay `healthCheckUrl`, ni métricas de entrega, ni panel que diga *«Restaurant
lleva 40 minutos sin recibir webhooks»*. El estado vive en filas de
`eventos_salientes` que nadie mira.

---

## 3 · Qué se reutiliza

Esto **no se toca**; se extiende.

| Activo | Estado | Por qué sirve |
|---|---|---|
| `nucleo.ts` (HMAC + SSO) | ✅ producción | Puro, probado, ya es un contrato |
| Outbox `EventoSaliente` | ✅ producción | Patrón correcto; faltan DLQ y métricas |
| Cron de reintentos | ✅ producción | Backoff y tope de intentos |
| `conEmpresa` / `sinEmpresa` | ✅ producción | Base del multi-tenant; `motivo` obligatorio |
| `tests/aislamiento.test.ts` | ✅ producción | Guardia estática cross-tenant |
| Catálogo de capacidades | ⚠️ dividir | La mecánica sirve; la lista mezcla conceptos |
| `apps/catalogo.ts` | ✅ | Ya es un App Launcher declarativo |
| Motor de elegibilidad | ✅ | **Ya es el Benefit Engine único** que pide §18 |
| RLS Capa 2 | ⏸ escrito | Encenderlo es requisito para sacar verticales |

> **`modules/elegibilidad/` merece una nota.** Su `decidir.ts` es puro, sin
> Prisma, y responde *«¿puede comprar este plan y a qué precio?»* con
> `{ puedeComprar, precio, precioOrigen, motivo, opciones }`. **Eso es
> exactamente el contrato de `benefits.evaluate`** (§66). No hay que diseñarlo:
> hay que exponerlo por HTTP.

---

## 4 · Qué se reemplaza

| Hoy | Mañana | Por qué |
|---|---|---|
| `SistemaConectado.categoria: String` | Tabla N:M | §9 |
| Acceso por categoría | + `CompanySystemEntitlement` | §10 |
| `CAPACIDADES` (lista mixta) | `Feature` (empresa) + `Capability` (contrato) | §6, §19 |
| `secreto` en claro | Asimétrico + `clientSecretHash` | §25 |
| Sin API entrante | `/api/platform/v1/*` | §20 |
| Sin scopes | `scopes` en credencial | §26 |
| `FALLIDO` terminal | `DEAD_LETTER` + replay | §74, §75 |
| Car Wash embebido | Vertical extraído | §76 |

---

## 5 · Systems Registry

```
VerticalSystem
  id · systemKey · name · description
  baseUrl · webhookUrl · healthCheckUrl
  apiVersion · manifestVersion
  status: DRAFT | ACTIVE | SUSPENDED | RETIRED
  icon · metadata · createdAt · updatedAt
```

`SistemaConectado` **se renombra y se extiende**; no se recrea. `slug` →
`systemKey`, `activo: Boolean` → `status` (cuatro estados: hoy no se puede
distinguir «aún no lanzado» de «suspendido por incidente»).

---

## 6 · BusinessType — y la separación de conceptos

```
BusinessType
  id · code · name · description
  status · icon · metadata
```

Migración desde `CATEGORIAS` (hoy 4 valores en un `as const`) a tabla, con el
`as const` conservado como **semilla y tipo derivado**: perder el tipado
estático sería un retroceso.

### La separación que hay que hacer primero

```
Feature      →  qué puede hacer una EMPRESA dentro de Membego
                RULETA, POS_CAJA, PAGO_CARDNET, CITAS…
                (hoy: CAPACIDADES, parte «plataforma»)

Capability   →  qué necesita un SISTEMA del Core
                CUSTOMER_LOOKUP, BENEFIT_REDEMPTION, QR_VALIDATION…
                (hoy: no existe)

Vertical
  Module     →  qué módulos tiene un VERTICAL
                COLA_VEHICULOS, COMISIONES, MESAS, COCINA…
                (hoy: CAPACIDADES, parte «Car Wash» — debe SALIR del Core)
```

**Sin esta separación, todo lo demás se construye torcido.** Es el primer
trabajo de la Fase 1.

---

## 7 · Entitlements

```
CompanySystemEntitlement
  id · companyId · systemId
  status: AVAILABLE | ENABLED | DISABLED | SUSPENDED
  enabledAt · disabledAt · plan · configuration · metadata
  @@unique([companyId, systemId])
```

Regla de acceso, evaluada **siempre en servidor**:

```
BusinessType compatible
    ∧ entitlement.status = ENABLED
    ∧ system.status = ACTIVE
    ∧ usuario con acceso al sistema
```

**Compatibilidad:** al desplegar, generar un entitlement `ENABLED` para toda
empresa que hoy ya accede por categoría. Nadie pierde acceso el día del cambio.

---

## 8 · Credenciales

```
SystemCredential
  id · systemId · clientId · clientSecretHash
  publicKey            ← verificación de eventos salientes
  scopes[] · status
  createdAt · lastUsedAt · rotatedAt · expiresAt
```

**Dos mecanismos, dos direcciones:**

**Salida (Membego → satélite):** firma **Ed25519**. Membego guarda la privada;
el satélite solo la pública. Un volcado de la base del satélite no permite
falsificar eventos. Migración compatible: firmar con ambos (HMAC + Ed25519)
durante una ventana, y retirar HMAC cuando todos verifiquen la nueva.

**Entrada (satélite → Membego):** **OAuth2 client credentials**. `clientId` +
`clientSecret` → token de vida corta con `scopes`. Solo se guarda el hash. Es
lo que pide §25 y lo que permite rotar sin desplegar el satélite.

> **Descartado: JWT firmado por el satélite.** Exigiría que Membego confiara en
> la hora del satélite y complicaría la revocación. Con cientos de sistemas, la
> revocación instantánea vale más que ahorrar un salto de red.

---

## 9 · Scopes

```
customers:read       memberships:read      benefits:read
benefits:redeem      promotions:read       branches:read
qr:validate          transactions:write    visits:write
events:publish
```

Concesión **mínima**: Car Wash no obtiene `promotions:read` si no lo usa. El
manifest declara lo que pide; el superadmin aprueba.

---

## 10 · Platform API v1

```
/api/platform/v1/
  GET  /companies/{id}
  GET  /branches?companyId=
  GET  /customers/{id}
  GET  /customers/resolve?qr=|email=|phone=|membershipId=
  GET  /memberships/active?customerId=&companyId=
  POST /benefits/evaluate
  POST /redemptions              ← idempotente
  POST /visits
  POST /transactions
  GET  /systems/me
  GET  /entitlements
```

**DTOs, nunca modelos Prisma.** Un `CustomerReference` lleva `{ id, nombre,
email }` — no las 40 columnas de `Cliente`. Minimización de datos por defecto
(§69).

Contrato de error uniforme (§64):

```json
{ "error": { "code": "MEMBERSHIP_INACTIVE", "message": "…", "requestId": "…" } }
```

`code` estable y documentado; `message` para humanos, nunca para lógica.

---

## 11 · SDK

`@membego/platform-sdk` — **sí, y es de las piezas más rentables**, porque
todos los verticales los construimos nosotros.

```ts
const membego = createMembegoClient({ clientId, clientSecret, baseUrl })

await membego.customers.resolve({ qr })
await membego.benefits.evaluate({ customerId, companyId, context })
await membego.redemptions.consume({ …, idempotencyKey })
```

Server-side only (§24). Responsabilidades: token OAuth + refresco, reintentos
con backoff, timeouts, `idempotencyKey` automática, `traceId`, verificación de
firma de webhooks, y **helper de inbox** para deduplicar.

`@membego/contracts` aparte: tipos + esquemas **Zod** compartidos entre Core y
satélites, versionados. Ya hay Zod en el proyecto.

> **Circuit breaker (§72): todavía no.** Con reintentos y timeouts bien puestos,
> añadirlo antes de tener tráfico real es complejidad sin evidencia. Se decide
> cuando haya números.

---

## 12 · Eventos y webhooks

Envelope estándar (§29):

```json
{
  "eventId": "evt_…", "eventType": "membership.activated", "version": 1,
  "occurredAt": "…", "companyId": "…", "customerId": "…",
  "source": "membego", "traceId": "…", "data": {}
}
```

Los 7 eventos actuales se mantienen y se **renombran al espacio nuevo** con
alias durante una ventana: `cliente.visita` → `visit.completed`. Nada se rompe.

Entrega: outbox existente + `DEAD_LETTER` tras agotar intentos + replay desde
el panel del superadmin (§74). El payload original se conserva.

Firma: `X-Membego-Signature` (Ed25519), `X-Membego-Timestamp`,
`X-Membego-Event-Id`. Anti-replay por ventana temporal + inbox del receptor.

---

## 13 · SSO

**Lo que existe ya es correcto en su forma** —token corto, firmado, con
tenant— pero hay que endurecerlo:

| Hoy | Cambio |
|---|---|
| Token reutilizable en sus 90 s | **Un solo uso**: `jti` + registro de canje |
| HMAC simétrico | Ed25519 |
| Sin `returnUrl` | `returnUrl` validado contra `baseUrl` del sistema |
| Sin rol del vertical | + `systemRole` resuelto por `UserSystemAccess` |

```
UserSystemAccess
  userId · companyId · systemId
  systemRole   ← MESERO, COCINA, LAVADOR: string libre del vertical
  status · permissions
```

**El Core no conoce los roles de cada industria** (§50). Guarda una cadena y la
transporta; interpretarla es del vertical.

---

## 14 · Data ownership

| Dominio | Dueño |
|---|---|
| Identidad, usuarios, empresas, sucursales | **Core** |
| Cliente global, relación cliente-empresa | **Core** |
| Membresías, beneficios, promociones, referidos, QR | **Core** |
| Elegibilidad y redenciones | **Core** |
| Registro de sistemas, entitlements, credenciales | **Core** |
| Servicios, cola, bahías, órdenes, inventario | **Vertical** |
| Menú, mesas, cocina, tickets | **Vertical** |
| Roles internos del vertical | **Vertical** |
| Configuración operativa del vertical | **Vertical** |

**El Core no replica operación. El vertical no replica reglas de membresía.**

---

## 15 · Flujos

**Redención (Car Wash y Restaurant son el mismo flujo):**

```
Vertical: identifica cliente (QR / email / placa)
   → POST /benefits/evaluate      → { eligible, benefits, adjustments, reasons }
   → presta el servicio
   → POST /redemptions            (idempotencyKey)
   → Core: consume, audita, emite benefit.redeemed
   → Vertical: POST /transactions (transaction.completed)
```

**Tercer sistema (la prueba del §99):** crear proyecto desde el template ·
registrar `VerticalSystem` · declarar manifest · asociar BusinessTypes ·
generar credenciales · implementar webhook + SSO · activar entitlements.

**Cero cambios en el Core.** Si alguno hiciera falta, la arquitectura falló.

---

## 16 · Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **Extraer Car Wash rompe producción** | 🔴 alta | No extraer todavía. Primero contratos; el vertical embebido los consume *internamente*. La extracción física es la última fase |
| RLS apagado con verticales fuera | 🔴 alta | Encender Capa 2 **antes** de la primera extracción |
| Secreto simétrico en claro | 🟠 media | Ed25519 + cifrado en reposo |
| SSO reutilizable en su ventana | 🟠 media | `jti` de un solo uso |
| Enum de capacidades desbordado | 🟠 media | Separar los tres conceptos en Fase 1 |
| Sobre-ingeniería | 🟡 baja | Sin microservicios (§79). Monolito modular + contratos |

> **El riesgo mayor no es técnico: es de secuencia.** Extraer Car Wash antes de
> tener API, contratos y RLS significa reescribir la extracción dos veces.

---

## 17 · Plan por fases

| Fase | Alcance | Entregable |
|---|---|---|
| **0** | Esta auditoría | ✅ este documento |
| **1** | Separar `Feature` / `Capability` / `VerticalModule`. `BusinessType` a tabla. Registry N:M. Entitlements | ✅ `docs/platform/conceptos.md` · `docs/platform/registro.md` |
| **2** | `/api/platform/v1` · DTOs · OAuth2 · scopes · rate limit · `requestId` | ✅ `docs/platform/api-v1.md` (lectura; las escrituras van con la Fase 3) |
| **3** | Envelope · Ed25519 · DLQ · replay · idempotencia · inbox | ✅ `docs/platform/eventos-v2.md` |
| **3b** | Extraer el canje del Server Action · `redemptions` · `transactions` | ✅ `docs/platform/canje.md` |
| **4** | `@membego/contracts` + `@membego/platform-sdk` | ✅ `docs/platform/sdk.md` |
| **5** | SSO de un solo uso · `UserSystemAccess` · App Launcher por entitlement | Acceso |
| **6** | Car Wash consume la API **sin salir del monolito** | Validación del contrato |
| **7** | Restaurant como **primer satélite real** | Prueba de la arquitectura |
| **8** | Health · métricas de entrega · panel de sistemas | Observabilidad |
| **9** | `create-membego-system` · `docs/platform/` | Developer experience |
| **10** | Encender RLS Capa 2 · extraer Car Wash | Separación física |

**Diferencia con el orden propuesto:** el encargo pone «migrar Car Wash» en la
Fase 6. Aquí la Fase 6 es *que Car Wash use los contratos desde dentro*. Salir
del monolito es la Fase 10, después de que Restaurant haya demostrado que el
estándar funciona.

Extraer primero significaría validar el contrato con el sistema más grande y
más crítico del negocio. Restaurant nace sin usuarios: es el lugar barato para
equivocarse.

---

## 18 · Definition of Done

De los 20 puntos del §93, el estado real hoy:

| | Punto | Estado |
|---|---|---|
| 1 | Systems Registry | 🟢 estado de ciclo de vida (Fase 1b) |
| 2 | System ↔ BusinessType | 🟢 N:M sobre `tipos_negocio` (Fase 1b) |
| 3 | Entitlements | 🟢 `empresas_sistemas` (Fase 1b) |
| 4 | Auth service-to-service | 🟢 OAuth2 client credentials (Fase 2) |
| 5 | Scopes | 🟢 emitidos e intersecados por petición (Fase 2) |
| 6 | API versionada | 🟢 `/api/platform/v1` (Fase 2) |
| 7 | Contratos reutilizables | 🟢 `@membego/contracts`, fuente única (Fase 4) |
| 8 | Webhooks estándar | 🟢 existe |
| 9 | Event envelope | 🟢 sobre v2 con alias de legado (Fase 3) |
| 10 | Idempotencia | 🟢 `claves_idempotencia` + inbox en el SDK (Fases 3 y 4) |
| 11 | Audit trail | 🟢 `auditLog` |
| 12 | Outbox / retry | 🟢 + DEAD_LETTER y replay (Fase 3) |
| 13 | Tenant isolation | 🟡 aplicativo + habilitaciones en la API; RLS apagado |
| 14 | Autorización por categoría | 🟢 sustituida por habilitaciones (Fase 1b) |
| 15 | SSO | 🟢 existe, endurecer |
| 16 | App Launcher | 🟢 existe |
| 17 | Documentación | 🟢 `docs/platform/` + README de los paquetes |
| 18 | Car Wash migrable | 🟡 el canje ya es un servicio reutilizable (Fase 3b) |
| 19 | Restaurant sobre el estándar | 🔴 sin estándar |
| 20 | Tercer sistema sin rediseño | 🔴 |

Al cerrar la auditoría: **5 verdes, 6 amarillos, 9 rojos**. Tras la Fase 1:
**8 verdes, 6 amarillos, 6 rojos**. Tras la Fase 2: **11 verdes, 6 amarillos,
3 rojos**. Tras la Fase 3: **13 verdes, 4 amarillos, 3 rojos**. Tras la 3b, con
el canje ya expuesto sobre un servicio único: **14 verdes, 3 amarillos, 3
rojos**. Tras la Fase 4: **16 verdes, 1 amarillo, 3 rojos**. El cimiento es mejor de lo que sugiere el
encargo; lo que falta es casi todo el lado de entrada.

---

## Recomendación

Empezar por la **Fase 1**, y dentro de ella por **la separación de los tres
conceptos** hoy llamados «capacidades». Es media jornada de diseño y condiciona
todo lo demás; hacerlo después obligaría a migrar datos ya escritos.

### Estado

**Fase 1 completa.**

- **1a** — los tres conceptos separados y probados: `docs/platform/conceptos.md`.
- **1b** — tipos de negocio a tabla, registro N:M y habilitaciones por empresa:
  `docs/platform/registro.md`.

**Fase 2 completa** — `docs/platform/api-v1.md`: OAuth2 client credentials,
scopes efectivos por petición, contrato de error con `requestId`, DTOs atados a
los contratos de proyección y siete endpoints de lectura.

Los cuatro endpoints que ESCRIBEN (`benefits/evaluate`, `redemptions`, `visits`,
`transactions`) no van aquí: evaluar sin poder canjear no sirve, y canjear sin
idempotencia es peor que no canjear. Llegan juntos con la Fase 3, que es donde
vive su idempotencia.

**Fase 3 completa** — `docs/platform/eventos-v2.md`: sobre v2 con alias de
legado, firma Ed25519 junto al HMAC, cola de descarte con replay, idempotencia
de escrituras y `POST /benefits/evaluate`.

**Fase 3b completa** — `docs/platform/canje.md`: el canje extraído a
`modules/visitas/canje.ts` (el Server Action pasó de 937 líneas a autenticar y
parsear), `POST /redemptions` y `POST /transactions` encima, y supresión del eco
al satélite que provoca el evento.

`POST /visits` no existe y no es un olvido: en el modelo de MembeGo una visita ES
un canje —`Visit.membershipId` es obligatorio y la visita nace dentro del mismo
núcleo atómico que descuenta el saldo—. `/redemptions` devuelve el `visitId`.

**Fase 4 completa** — `docs/platform/sdk.md`: `@membego/contracts` como fuente
única del vocabulario (el Core reexporta desde ahí, no al revés) y
`@membego/platform-sdk` con token, reintentos que conservan la clave de
idempotencia, verificación de webhooks e inbox.

Siguiente: **Fase 5** — SSO de un solo uso, `UserSystemAccess` y App Launcher
por habilitación.
