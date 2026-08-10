# Platform API v1

Fase 2 del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/registro.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §8–§10, §20, §26.

---

## Qué abre

Hasta ahora MembeGo tenía **cero endpoints de entrada**. Los satélites recibían
webhooks y podían abrir sesión por SSO, pero no podían *preguntar* nada: un
restaurante no tenía forma de saber si el cliente que está en la mesa es cliente
de MembeGo, ni cómo se llama, ni en qué sucursal está.

`/api/platform/v1` es esa dirección.

```
POST /oauth/token                                 obtener un token
GET  /systems/me                                  quién soy y qué puedo
GET  /entitlements                                sobre qué empresas actúo
GET  /companies/{id}                              cabecera, moneda, zona horaria
GET  /branches?companyId=                         sucursales
GET  /customers/{id}?companyId=                   ficha mínima
GET  /customers/resolve?companyId=&email=|phone=  «¿quién es este?»
GET  /memberships/active?companyId=&customerId=   estado, para PINTAR
```

---

## Las tres barreras, en este orden

```
1 · ¿Quién eres?      token válido + credencial ACTIVE
2 · ¿Puedes hacerlo?  scope requerido ∈ scopes efectivos
3 · ¿Sobre quién?     esa empresa está habilitada para tu sistema
```

El orden no es decorativo. Sin (1) no hay a quién contarle nada de (2), y
contestar (3) antes que (2) le diría a un sistema sin permisos qué empresas
existen.

### La regla que no se puede romper

> **El `companyId` que llega por la red no se cree nunca.**

Un satélite manda `?companyId=…` porque tiene que decir de qué empresa habla.
Eso no lo autoriza a hablar de ella.

`autenticarSobreEmpresa` lo contrasta, en cada petición, con las habilitaciones
de la Fase 1b — la misma regla que usan el SSO y el despacho de eventos. Sin esa
comprobación, el sistema del restaurante de la esquina pediría el `companyId`
del car wash y leería sus clientes. No haría falta ningún fallo: sería el
comportamiento.

Por eso **el token no lleva la empresa dentro**. Si viajara firmada, saltarse la
comprobación parecería razonable el primer día que alguien optimice.

---

## Autenticación

OAuth2 *client credentials*.

```bash
curl -X POST https://membego.com/api/platform/v1/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials",
       "client_id":"mgc_…","client_secret":"mgs_…",
       "scope":"customers:read branches:read"}'
```

```json
{ "access_token": "…", "token_type": "Bearer", "expires_in": 900,
  "scope": "branches:read customers:read" }
```

Después, `Authorization: Bearer …` en cada llamada.

### El secreto no se guarda

Se enseña **una vez** al crear la credencial; después solo queda
`scrypt$N$r$p$sal$hash`. Si se pierde, se rota — y esa es la propiedad que se
busca, no un inconveniente: un secreto recuperable es un secreto que alguien
puede recuperar.

`scrypt` y no SHA-256 porque un secreto es material que se puede probar por
fuerza bruta: con SHA-256 una GPU prueba miles de millones por segundo; con
scrypt el coste en memoria lo hace inviable. El parámetro va **dentro** del hash
para poder subirlo mañana sin invalidar los de hoy.

### Todos los fallos son el mismo error

`client_id` inexistente, secreto incorrecto, credencial revocada y credencial
caducada devuelven exactamente `INVALID_CLIENT`. Distinguirlos convertiría el
endpoint en un oráculo para averiguar qué `client_id` existen.

Y el secreto se verifica con scrypt **incluso cuando el `client_id` no existe**,
contra un hash señuelo. Sin eso, «no existe» respondería en un milisegundo y
«existe pero la clave está mal» en cincuenta: el tiempo de respuesta sería el
oráculo que el mensaje común pretende evitar.

---

## Scopes

| Scope | Da acceso a |
|---|---|
| `customers:read` | `/customers/{id}`, `/customers/resolve` |
| `memberships:read` | `/memberships/active` |
| `branches:read` | `/branches` |
| `benefits:read`, `benefits:redeem`, `promotions:read`, `qr:validate`, `visits:write`, `transactions:write`, `events:publish` | Fase 3 |

**Los scopes efectivos son la intersección** de los que el token pidió con los
que la credencial tiene concedidos **hoy**, recalculada en cada petición.

Recortar una credencial surte efecto de inmediato. Sin esa intersección por
petición, quitar `benefits:redeem` sería una intención con quince minutos de
retraso.

`/systems/me`, `/entitlements` y `/companies/{id}` no piden scope: describen la
relación del sistema con MembeGo, no un recurso de una empresa. Un permiso que
todo manifest incluiría siempre no decide nada y solo alarga la revisión.

---

## Errores

```json
{ "error": { "code": "INSUFFICIENT_SCOPE",
             "message": "The access token does not grant the required scope.",
             "requestId": "req_…", "requiredScope": "customers:read" } }
```

| `code` | HTTP | Qué hacer |
|---|---|---|
| `INVALID_REQUEST` | 400 | Revisar parámetros |
| `INVALID_CLIENT` | 401 | Revisar credenciales |
| `INVALID_TOKEN` | 401 | Pedir token |
| `TOKEN_EXPIRED` | 401 | Pedir token |
| `INSUFFICIENT_SCOPE` | 403 | Pedir el scope en el manifest |
| `COMPANY_NOT_ENTITLED` | 403 | Hablar con MembeGo |
| `NOT_FOUND` | 404 | — |
| `RATE_LIMITED` | 429 | Esperar |
| `PLATFORM_API_UNCONFIGURED` | 503 | Falta `PLATFORM_TOKEN_SECRET` |

`code` es **estable**: es API, y cambiarlo rompe satélites. `message` es para
personas y puede cambiar cuando se quiera — ramificar leyendo `message` falla el
día que alguien corrija una tilde.

`INSUFFICIENT_SCOPE` es **403 y no 401**: sabemos quién eres, lo que no puedes es
esto. Un satélite que recibiera 401 pediría otro token en bucle sin resolver
nunca un problema de permisos.

Todas las respuestas llevan `X-Request-Id`, en la cabecera **y** en el cuerpo:
cuando el del satélite escribe «me da 403», la única pregunta útil es cuál de los
cientos de 403 de hoy.

---

## Minimización de datos

**Nunca se devuelve un modelo de Prisma.** `Cliente` tiene cuarenta columnas,
entre ellas `cardnetCustomerId`, `fechaNacimiento` y el `supabaseId` que
identifica la cuenta en el proveedor de identidad.

Los DTOs emiten **exactamente** los campos que la Fase 1a declaró proyectables en
`proyecciones.ts`, y una prueba lo compara campo por campo. Sin esa atadura
serían dos listas escritas por separado que empiezan iguales y se separan a la
tercera semana: la API devolvería un campo que el contrato prohíbe proyectar y el
satélite lo guardaría sin saber que no debía.

| Entidad | Campos |
|---|---|
| `Company` | id, nombre, slug, logoUrl, moneda, zonaHoraria, idioma |
| `Branch` | id, companyId, nombre, direccion, activa |
| `Customer` | id, nombre, email, telefono |
| `MembershipSummary` | id, customerId, companyId, planNombre, estado, vigenteHasta |

---

## Lo que esta fase NO abre, y por qué

**Nada que decida dinero.** `POST /benefits/evaluate`, `POST /redemptions`,
`POST /visits` y `POST /transactions` no están.

No es que falte tiempo: es que **evaluar sin poder canjear no sirve**, y canjear
sin idempotencia es peor que no canjear. Un reintento de red sobre un canje sin
clave de idempotencia consume el beneficio dos veces, y el satélite no puede
distinguir «no llegó» de «llegó y se perdió la respuesta».

La idempotencia y el *inbox* son la Fase 3. Los cuatro endpoints llegan **juntos**
con ella. Hasta entonces el canje sigue ocurriendo dentro de MembeGo, como hoy.

Por el mismo motivo `/memberships/active` responde con `"autoriza": false`. Una
membresía activa no dice que a ese cliente le quede el beneficio, ni que no lo
haya consumido hace diez minutos en otra sucursal. Quien lea ese JSON en un log
tiene la advertencia delante sin haber leído esta página.

**`resolve` no acepta `qr=`.** Validar un QR es un acto con consecuencias — un
token de un solo uso —, no una consulta.

---

## Despliegue

Requiere `PLATFORM_TOKEN_SECRET` (mínimo 32 caracteres,
`openssl rand -base64 48`) y la migración `20260804_platform_api_credenciales`.

**Sin la variable, la API responde 503 y no emite ni acepta un solo token.** No
hay valor por defecto ni derivación de otra clave: un default débil aquí sería la
diferencia entre «la API está apagada» y «la API está encendida y cualquiera
puede fabricarse un token», y solo una de esas dos se nota desde fuera.

Rotarla invalida los tokens vivos (que caducan en 15 minutos de todas formas). No
invalida las credenciales de los satélites, que viven en la base.

### Dar de alta un satélite

Todavía por SQL; la pantalla llega con el App Launcher.

```ts
import { nuevoClientId, nuevoClientSecret, hashearSecreto }
  from '@/modules/plataforma/credenciales'

const clientId = nuevoClientId()
const secret = nuevoClientSecret()   // enseñar UNA vez; no se puede recuperar
await prisma.credencialSistema.create({
  data: { sistemaId, clientId, clientSecretHash: hashearSecreto(secret),
          scopes: ['customers:read', 'branches:read'] },
})
```

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **Ninguna ruta usa el `companyId` de la red sin validarlo** | La fuga entre empresas más fácil de escribir |
| Toda ruta se autentica | Un endpoint nuevo abierto por olvido |
| El token no lleva la empresa dentro | Que confiar en ella parezca razonable |
| Los scopes efectivos son una intersección | Que un token se dé permisos de más |
| Recortar la credencial surte efecto ya | Revocar con quince minutos de retraso |
| Los DTOs = el contrato de proyección | Emitir un campo que no se puede proyectar |
| Un coste absurdo de scrypt no bloquea | Una denegación de servicio escrita en la base |
| El endpoint de token no filtra por qué falló | Enumerar `client_id` |
| Ninguna respuesta se puede cachear | Servirle a un sistema la respuesta de otro |

La primera es la que de verdad importa. Las demás protegen el contrato; esa
protege el aislamiento entre empresas.

Además del análisis estático, el camino completo se probó contra una base real:
token, revocación con el token ya emitido, recorte de scopes sin reemitir, y una
petición de un sistema sobre una empresa que no tiene habilitada.

---

## Siguiente

Fase 3: envelope de eventos, Ed25519, DLQ, replay, **idempotencia e inbox** — y
con ellos los cuatro endpoints que escriben. Ver
`docs/PLATFORM_ARCHITECTURE_REPORT.md` §12, §29, §74.
