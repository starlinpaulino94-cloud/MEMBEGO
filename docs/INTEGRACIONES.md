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
  "rol": "ADMIN_EMPRESA | GERENTE | RECEPCION | EMPLEADO | SUPERADMIN",
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

Reglas para el satélite:

- El token expira en **90 segundos**: verifícalo al llegar y crea TU sesión
  (cookie propia). No guardes el token.
- `companyId` es el **tenant**: toda la sesión queda acotada a esa empresa.
- Mapea `sub` → usuario local (créalo al primer ingreso con `email`/`rol`).
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
| `cliente.registrado`      | Un cliente se registra/afilia a la empresa | `clienteId`, `cliente.nombre` |
| `cliente.primera_visita`  | Primera visita del cliente | `clienteId` |
| `cliente.visita`          | Visita/canje registrado | `clienteId` |
| `cliente.compro_servicio` | Compra confirmada (membresía u oferta) | `clienteId`, `compra.tipo`, `compra.monto`, `membresia.plan` |
| `cliente.primera_compra`  | Primera compra confirmada | igual que arriba |
| `membresia.activada`      | Membresía quedó activa | `clienteId`, `membresia.plan` |
| `referido.convirtio`      | Un referido completó su conversión | `clienteId` |

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

## Operación (lado MembeGo)

- Outbox: tabla `eventos_salientes` (PENDIENTE → ENVIADO/FALLIDO, 8 intentos).
- Cron de reintentos: `/api/cron/integraciones` (cada hora, `CRON_SECRET`).
- Alta de un sistema nuevo: fila en `sistemas_conectados` con secreto de 64 hex
  (`SELECT encode(gen_random_bytes(32), 'hex')`).
