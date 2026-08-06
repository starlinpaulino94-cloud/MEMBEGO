# Integraciones — MembeGo como hub de sistemas satélite

> **Este documento ES el contrato.** El equipo de cada sistema satélite
> (car wash, barbería, gym, …) implementa contra lo que dice aquí. Todo lo
> descrito ya está implementado y en producción del lado de MembeGo.

## Arquitectura en una frase

MembeGo es la capa de **identidad, clientes y fidelización**; cada sistema
satélite es la herramienta **operativa** de una vertical. MembeGo empuja los
datos que le competen a cada satélite (webhooks firmados) y presta la
identidad de su equipo (SSO). El satélite nunca consulta clientes ajenos:
**solo recibe lo de las empresas de su categoría, empresa por empresa**.

```
┌────────────┐  SSO (token firmado)   ┌─────────────────┐
│  MembeGo   │ ─────────────────────► │ Sistema satélite│
│  (hub)     │  Webhooks (HMAC)       │  (ej. car wash) │
│            │ ─────────────────────► │                 │
└────────────┘                        └─────────────────┘
```

## Registro de un sistema (lado MembeGo)

Cada satélite vive en la tabla `sistemas_conectados`:

| Campo        | Ejemplo                            | Notas |
|--------------|------------------------------------|-------|
| `slug`       | `carwash`                          | estable, va en URLs |
| `categoria`  | `CAR_WASH`                         | solo empresas de esta categoría generan eventos |
| `urlBase`    | `https://carwash.tudominio.com`    | raíz del satélite |
| `urlWebhook` | `https://carwash.tudominio.com/api/membego/webhook` | destino de eventos |
| `secreto`    | (64 hex)                           | HMAC compartido; se copia UNA vez al `.env` del satélite como `MEMBEGO_SECRETO` |

## 1) SSO — empleados entran con su cuenta de MembeGo

**Flujo:**

1. El empleado/admin, logueado en MembeGo, visita
   `GET https://www.membego.com/api/integraciones/abrir/{slug}`.
2. MembeGo valida su sesión y su rol de equipo, verifica que su empresa es de
   la categoría del sistema, y lo redirige (302) a
   `{urlBase}/sso/membego?token={TOKEN}`.
3. **El satélite implementa `GET /sso/membego`**: verifica el token con el
   secreto compartido, crea (o encuentra) el usuario local, abre su propia
   sesión, y redirige a su dashboard.

**Formato del token:** `base64url(JSON) + "." + hmacSha256Hex(base64url(JSON), secreto)`

Payload del JSON:

```json
{
  "sub": "<id estable del usuario en MembeGo>",
  "email": "empleado@correo.com",
  "rol": "SUPERADMIN | ADMINISTRADOR | ADMIN_EMPRESA | GERENTE | SUPERVISOR | CAJERO | RECEPCION | MARKETING | EMPLEADO",
  "companyId": "<ID de la empresa en MembeGo — el tenant del satélite>",
  "exp": 1799999999
}
```

**Verificación en el satélite (Node):**

```ts
import { createHmac, timingSafeEqual } from 'crypto'

function verificarTokenMembego(token: string, secreto: string) {
  const punto = token.lastIndexOf('.')
  if (punto <= 0) return null
  const cuerpo = token.slice(0, punto)
  const firma = token.slice(punto + 1)
  const esperada = createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')
  const a = Buffer.from(esperada); const b = Buffer.from(firma)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
  if (typeof datos.exp !== 'number' || datos.exp < Math.floor(Date.now() / 1000)) return null
  if (!datos.sub || !datos.companyId) return null
  return datos // { sub, email, rol, companyId, exp }
}
```

**Vector de prueba (para que el satélite se autoverifique sin depender de
MembeGo):** con el secreto literal `secreto-de-prueba`, este payload produce
exactamente este token. Si el verificador del satélite no lo acepta (poniendo el
reloj antes de `exp`, que es el 17 de marzo de 2030), el fallo está en su
implementación y NO en el secreto compartido.

```
secreto: secreto-de-prueba

JSON:  {"sub":"623d642c-ae5f-445a-99eb-220b55eb0e1c","email":"dueno@ejemplo.com","rol":"ADMIN_EMPRESA","companyId":"cmre1hz570000jp04ad5i0roi","exp":1900000000}

TOKEN: eyJzdWIiOiI2MjNkNjQyYy1hZTVmLTQ0NWEtOTllYi0yMjBiNTVlYjBlMWMiLCJlbWFpbCI6ImR1ZW5vQGVqZW1wbG8uY29tIiwicm9sIjoiQURNSU5fRU1QUkVTQSIsImNvbXBhbnlJZCI6ImNtcmUxaHo1NzAwMDBqcDA0YWQ1aTByb2kiLCJleHAiOjE5MDAwMDAwMDB9.02d8a44d97acc2b4eee1804fbb0a78b351adee9ad8018c335888fe08ac8bc326
```

Errores que producen «token inválido» aunque el secreto sea correcto:

- Firmar/verificar sobre el **JSON** en vez de sobre la **cadena base64url**.
  La firma cubre el texto `eyJzdWIi…` tal cual viaja, no el objeto decodificado.
- Partir el token con `split('.')` y quedarse con 3 partes esperando un JWT:
  esto **no es un JWT** (no hay cabecera). Son dos partes; usa `lastIndexOf('.')`.
- Decodificar con `base64` estándar en vez de `base64url` (`-` y `_` en vez de
  `+` y `/`, sin `=` de relleno).
- Comparar la firma en mayúsculas: el hex va en **minúsculas**.
- Leer el secreto de un `.env` con espacios o salto de línea al final: el HMAC
  cambia entero. Compara `length` y `md5` a ambos lados, nunca el secreto.
- Reloj del servidor atrasado/adelantado más de 90 s: todo token nace vencido.

Reglas para el satélite:

- El token expira en **90 segundos**: verifícalo al llegar y crea TU sesión
  (cookie propia). No guardes el token.
- `companyId` es el **tenant**: toda la sesión queda acotada a esa empresa.
- Mapea `sub` → usuario local (créalo al primer ingreso con `email`/`rol`).
- **Lista COMPLETA de roles que puede traer el token** (`src/types/index.ts`):
  `SUPERADMIN`, `ADMINISTRADOR`, `ADMIN_EMPRESA` (heredado: equivale a
  `ADMINISTRADOR` en cuentas viejas), `GERENTE`, `SUPERVISOR`, `CAJERO`,
  `RECEPCION`, `MARKETING`, `EMPLEADO`. `CLIENTE` existe en MembeGo pero NUNCA
  llega por SSO: los clientes no entran al satélite.
- Mapeo sugerido para un satélite operativo (car wash):
  `SUPERADMIN→superadmin` · `ADMINISTRADOR`/`ADMIN_EMPRESA`→`administrador` ·
  `GERENTE`/`SUPERVISOR`→`supervisor` · `RECEPCION`/`CAJERO`→`recepcionista` ·
  `EMPLEADO`→`operario` · `MARKETING`→ el que corresponda (o el mínimo).
  **Un rol desconocido debe caer al permiso MÍNIMO, nunca al máximo**: si
  MembeGo añade un rol mañana, el satélite no puede regalar acceso de admin.
- Si el rol de MembeGo cambia, el siguiente SSO trae el rol nuevo: actualiza.

## 2) Webhooks — MembeGo empuja los eventos que te competen

**El satélite implementa un endpoint POST** (el `urlWebhook` registrado).
MembeGo envía JSON con header `X-Membego-Firma` = HMAC-SHA256 hex del cuerpo
crudo, con el mismo secreto compartido.

**Verificación:** calcula el HMAC del **cuerpo crudo exacto** (no re-serializar
el JSON) y compáralo con el header en tiempo constante. Firma inválida → 401.

**Sobre de todos los eventos:**

```json
{
  "id": "<id único del evento — clave de idempotencia>",
  "tipo": "cliente.registrado",
  "companyId": "<empresa de MembeGo a la que pertenece el evento>",
  "payload": { "clienteId": "...", "...": "según el tipo" },
  "emitidoEn": "2026-07-31T18:00:00.000Z"
}
```

Reglas para el satélite:

- **Idempotencia:** el mismo `id` puede llegar más de una vez (reintentos).
  Guarda los ids procesados y responde 200 sin repetir el efecto.
- **Responde 2xx rápido** (< 10 s). Si respondes error o no respondes, MembeGo
  reintenta (hasta 8 veces, cron horario) — no se pierden eventos.
- **Aislamiento:** persiste TODO con el `companyId` del evento. Un admin del
  satélite solo ve datos de SU empresa. Jamás muestres datos cruzados.

**Catálogo de eventos (v1):**

| `tipo`                    | Cuándo | Claves útiles en `payload` |
|---------------------------|--------|----------------------------|
| `cliente.registrado`      | Un cliente se registra/afilia a la empresa | `clienteId`, `cliente.nombre`, `cliente.email`, `cliente.telefono` |
| `cliente.primera_visita`  | Primera visita del cliente | `clienteId` |
| `cliente.visita`          | Visita/canje registrado | `clienteId` |
| `cliente.compro_servicio` | Compra confirmada (membresía u oferta) | `clienteId`, `compra.tipo`, `compra.monto`, y según el tipo: `membresia.*` o `promocion.*` |
| `cliente.primera_compra`  | Primera compra confirmada | igual que arriba |
| `membresia.activada`      | Membresía quedó activa | `clienteId`, `membresia.id`, `membresia.planId`, `membresia.plan` |
| `referido.convirtio`      | Un referido completó su conversión | `clienteId` |

### Payloads exactos (v1.1)

**Unidades y tipos, para que no haya que adivinar:**

- **`compra.monto` viene en PESOS con decimales** (`250` o `250.5`), NUNCA en
  centavos. Es el monto NETO ya cobrado (precio menos descuento de bienvenida).
- Los nombres (`membresia.plan`, `promocion.titulo`) son ETIQUETAS y pueden
  cambiar. Para casar contra tu catálogo usa siempre los IDs
  (`membresia.planId`, `promocion.id`), que son estables.
- `clienteId` es el identificador del cliente EN MEMBEGO y es el mismo en todos
  los eventos: úsalo como llave.
- Los campos de contacto pueden venir en `null` (un cliente puede registrarse
  sin teléfono). Nunca faltan como clave, pero pueden ser nulos.

```jsonc
// cliente.registrado
{
  "id": "evt_...", "tipo": "cliente.registrado", "companyId": "cmp_...",
  "payload": {
    "clienteId": "cli_...",
    "cliente": { "nombre": "Juan Pérez", "compras": 0, "visitas": 0,
                 "email": "juan@correo.com", "telefono": "8095551234" }
  },
  "emitidoEn": "2026-08-03T19:40:12.345Z"
}

// cliente.compro_servicio — MEMBRESÍA
{
  "id": "evt_...", "tipo": "cliente.compro_servicio", "companyId": "cmp_...",
  "payload": {
    "clienteId": "cli_...",
    "cliente": { "nombre": "Juan Pérez", "compras": 1,
                 "email": "juan@correo.com", "telefono": "8095551234" },
    "membresia": { "id": "mem_...", "planId": "pln_...", "plan": "Plan Gold",
                   "precio": 1500, "esDePago": true,
                   "vigenteHasta": "2026-09-03T19:40:12.345Z" },
    "compra": { "tipo": "membresia", "monto": 1500 }
  },
  "emitidoEn": "2026-08-03T19:40:12.345Z"
}

// cliente.compro_servicio — PROMOCIÓN / OFERTA
{
  "id": "evt_...", "tipo": "cliente.compro_servicio", "companyId": "cmp_...",
  "payload": {
    "clienteId": "cli_...",
    "cliente": { "nombre": "Juan Pérez",
                 "email": "juan@correo.com", "telefono": "8095551234" },
    "compra": { "tipo": "promocion", "monto": 250,
                "promocion": "Lavado Premium", "promocionId": "pro_..." },
    "promocion": { "id": "pro_...", "titulo": "Lavado Premium",
                   "slug": "lavado-premium" }
  },
  "emitidoEn": "2026-08-03T19:40:12.345Z"
}

// membresia.activada
{
  "id": "evt_...", "tipo": "membresia.activada", "companyId": "cmp_...",
  "payload": {
    "clienteId": "cli_...",
    "cliente": { "nombre": "Juan Pérez", "compras": 1,
                 "email": "juan@correo.com", "telefono": "8095551234" },
    "membresia": { "id": "mem_...", "planId": "pln_...", "plan": "Plan Gold",
                   "precio": 1500, "esDePago": true,
                   "vigenteHasta": "2026-09-03T19:40:12.345Z" }
  },
  "emitidoEn": "2026-08-03T19:40:12.345Z"
}
```

`compra.tipo` distingue el caso: `"membresia"` o `"promocion"`. Los IDs del
ejemplo llevan prefijos ilustrativos; en la realidad son cuid sin prefijo
(`cmd7k2p9x0001qz3f8b2h4t1a`).

El catálogo crecerá (bajas, vencimientos, citas…); los tipos nuevos llegan por
el mismo endpoint — ignora los `tipo` que no conozcas y responde 200.

## 3) Aislamiento por empresa — la regla de oro

Un cliente aparece en tu satélite **únicamente** cuando MembeGo emite un evento
suyo para TU empresa (se registró contigo, te compró, canjeó una oferta tuya).
Existir en MembeGo no basta. Esto se garantiza dos veces: MembeGo solo emite
eventos con el `companyId` correcto hacia sistemas de la categoría correcta, y
el satélite persiste y filtra todo por ese `companyId` (RLS multi-tenant).

## Checklist de implementación del satélite

1. `MEMBEGO_SECRETO` en el `.env` (te lo entrega el dueño de MembeGo).
2. `GET /sso/membego?token=...` → verificar token → sesión propia → dashboard.
3. `POST /api/membego/webhook` → verificar `X-Membego-Firma` → idempotencia por
   `id` → persistir por `companyId` → responder 200.
4. Tabla local `clientes_membego` (o equivalente): `clienteId` de MembeGo +
   `companyId` + lo que el satélite necesite.
5. Probar: MembeGo puede reenviar eventos fallidos (quedan en su outbox).

## Adaptador para satélites con funciones internas ya construidas

Si el satélite ya tiene su propia capa de sincronización (funciones SQL/RPC
idempotentes, como el car wash con `membego_sync_customer`,
`membego_grant_membership`, `membego_grant_promotion`,
`membego_set_promotion_status`), **ese trabajo se conserva completo**: solo se
antepone un endpoint adaptador. El flujo queda:

```
MembeGo ──POST firmado──► /api/membego/webhook (satélite)
                              │ verifica X-Membego-Firma (MEMBEGO_SECRETO)
                              │ idempotencia por `id`
                              └── llama SUS funciones internas con SU
                                  service_role key (que NUNCA sale del satélite)
```

**Regla de seguridad innegociable:** la `service_role key` del satélite jamás
se entrega a MembeGo (ni la de MembeGo al satélite). Cada sistema usa sus
llaves solo dentro de su propio backend; lo único compartido es el secreto
HMAC del webhook/SSO. Así, comprometer un sistema no compromete a los demás.

**Mapa evento → función interna (ejemplo car wash):**

| Evento MembeGo | Función del satélite | Campos del payload |
|---|---|---|
| `cliente.registrado` | `membego_sync_customer` | `clienteId` → `p_membego_customer_id`, `cliente.nombre`, `cliente.email?`, `cliente.telefono?` |
| `membresia.activada` | `membego_grant_membership` | `clienteId`, `membresia.id` → `p_membership_id`, `membresia.plan` → `p_plan_name`, `membresia.esDePago` → `p_is_paid`, `membresia.vigenteHasta` → `p_valid_until` |
| `cliente.compro_servicio` (compra.tipo=`promocion`) | `membego_grant_promotion` | `clienteId`, `compra.monto` |
| `cliente.visita` | (visita/canje local) | `clienteId` |

Notas: `companyId` del sobre ≡ `merchant_id` del satélite. El `id` del sobre es
la clave de idempotencia (equivale a "reintentar no duplica" de sus funciones).
Los eventos que aún no mapeen a nada se responden 200 y se ignoran.

**SSO sin OIDC completo:** el token firmado de MembeGo (§1) ya entrega lo que
un flujo OIDC daría para este caso — identidad verificable, rol y tenant
(`companyId` ≡ `merchant_id`) — con una fracción de la complejidad. El endpoint
`GET /sso/membego` del satélite hace el papel del callback: verificar, mapear
usuario, abrir sesión propia. Si algún día se necesita OIDC real, este token
no estorba: se reemplaza el transporte sin tocar el mapeo de usuarios.

## Operación (lado MembeGo)

- Outbox: tabla `eventos_salientes` (PENDIENTE → ENVIADO/FALLIDO, 8 intentos).
- Cron de reintentos: `/api/cron/integraciones` (cada hora, `CRON_SECRET`).
- Alta de un sistema nuevo: fila en `sistemas_conectados` con secreto de 64 hex
  (`SELECT encode(gen_random_bytes(32), 'hex')`).
