# Contratos y SDK

Fase 4 del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/canje.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §11.

---

## Dos paquetes

```
@membego/contracts      el vocabulario. Cero dependencias.
@membego/platform-sdk   el cliente. Depende solo de contracts + node.
```

Sin ellos, cada satélite copiaría los tipos a mano y escribiría su propio
cliente. Copiar funciona el primer día y falla el tercer mes: MembeGo añade un
campo, el satélite no se entera, y el fallo aparece en producción con la forma de
un `undefined` que nadie relaciona con un despliegue de hace tres semanas.

---

## `@membego/contracts` es la FUENTE, no una copia

El Core **no tiene** su propia definición de scopes, códigos de error, sobre de
eventos ni DTOs: los reexporta desde el paquete.

```ts
// src/modules/plataforma/errores.ts
export { CODIGOS_ERROR, type CuerpoError } from '@membego/contracts'
```

Esa dirección importa. Si el paquete copiara del Core, la copia se quedaría atrás
en cuanto alguien tuviera prisa. Al revés no puede pasar: **no hay dos listas**.

Una prueba lo comprueba por identidad de referencia, no por contenido — si algún
día fueran dos objetos distintos con los mismos valores, pasaría hoy y mentiría
mañana.

Lo que **no** sale del Core: `FuncionEmpresa` y `ModuloVertical`. Son asuntos
internos de MembeGo y publicarlos invitaría a que un satélite razonara sobre
ellos.

---

## El SDK resuelve cuatro cosas que se olvidan

Y las cuatro fallan de formas que no se notan hasta que ya pasaron.

### 1 · Renovar antes de caducar

Se pide un token nuevo **60 segundos antes** del vencimiento. Sin margen, una
petición que sale con el token en su último segundo llega caducada y el satélite
ve un 401 que no entiende.

### 2 · Un solo token al arrancar

Veinte llamadas simultáneas comparten **una** petición de token. Además de ser
gratis, el límite del endpoint de token es estrecho a propósito: un arranque en
paralelo se auto-bloquearía.

### 3 · Reintentar solo lo reintentable

429, 5xx, fallos de red y `IDEMPOTENCY_IN_PROGRESS`. Un 4xx del negocio **no**:
reintentar algo que el servidor rechazó por su contenido solo gasta cuota y
retrasa el error real.

Espera exponencial **con jitter**. El jitter no es adorno: veinte satélites que
reintenten exactamente al segundo vuelven a caer todos a la vez sobre el servidor
que acababa de recuperarse.

### 4 · La misma clave en el reintento

> Un cliente que reintenta generando una clave nueva tiene idempotencia **en el
> papel** y consume el beneficio **dos veces** en la práctica.

Y desde fuera todo parece correcto: el servidor cumplió su contrato, el cliente
reintentó como debía, y el cliente final se llevó dos postres.

**La clave la pone quien llama, no el SDK.** Es deliberado: tiene que identificar
*la operación de tu negocio* —la comanda, el ticket—, no la llamada HTTP. Si la
generara el SDK, un reintento del satélite entero (tras un reinicio, tras un
error de su propia cola) traería una clave nueva.

```ts
await membego.redeem(
  { companyId, membershipId, servicio: 'Almuerzo' },
  `comanda-${comandaId}`      // ← tuya, estable, la misma en cada reintento
)
```

---

## Uso

```ts
import { MembegoClient } from '@membego/platform-sdk'

const membego = new MembegoClient({
  baseUrl: 'https://membego.com',
  clientId: process.env.MEMBEGO_CLIENT_ID!,
  clientSecret: process.env.MEMBEGO_CLIENT_SECRET!,
})

const yo = await membego.systemsMe()          // ¿estas credenciales sirven?
const { entitlements } = await membego.entitlements()

const cliente = await membego.resolveCustomer(companyId, { phone: '8095551234' })
const { benefits } = await membego.evaluateBenefits({ companyId, customerId: cliente.id })

await membego.redeem({ companyId, membershipId, servicio: 'Almuerzo' }, `comanda-${id}`)
await membego.recordTransaction({ companyId, amount: 1250.5, description: 'Mesa 4' }, `venta-${id}`)
```

Todos los errores llegan como `MembegoError` con `code`, `status`, `requestId` y
—cuando aplica— `reason` y `requiredScope`. Ese `requestId` es el que hay que
citar al pedir ayuda: sin él, «me da 403» es uno de los cientos de hoy.

---

## Webhooks

```ts
app.post('/webhooks/membego', express.raw({ type: 'application/json' }), async (req, res) => {
  const r = verificarWebhook(req.body.toString('utf8'), req.headers, {
    clavePublicaPem: process.env.MEMBEGO_PUBLIC_KEY!,
  })
  if (!r.ok) return res.status(400).json({ error: r.fallo })

  res.sendStatus(200)                                  // primero responder
  await procesarUnaVez(inbox, r.evento.eventId, () => manejar(r.evento))
})
```

### `express.raw` antes de `express.json`

Es el error de integración más común con webhooks firmados, y el que más tiempo
cuesta encontrar porque el código *parece* correcto: reparsear y volver a
serializar produce, tarde o temprano, otra cadena —otro orden de claves, otro
espaciado— y una firma que no valida nunca.

Por eso `verificarWebhook` recibe **texto**, no un objeto.

### Nunca lanza

Un webhook mal firmado es un resultado, no una excepción: quien llama tiene que
poder responder 400 sin envolverlo todo en un `try`.

Los fallos se distinguen — `FUERA_DE_VENTANA` es un reloj mal puesto y
`FIRMA_INVALIDA` es un impostor. Un único «no válido» manda a mirar donde no es.

**Sin verificador configurado no se acepta nada** (`SIN_VERIFICADOR`): un
satélite que olvide la clave no puede quedarse aceptando cualquier cosa.

**Con las dos firmas disponibles manda Ed25519.** Mientras se acepte el HMAC,
cualquiera que tenga ese secreto compartido puede fabricar eventos; una firma
simétrica válida no puede salvar una asimétrica mala.

---

## Inbox

MembeGo reintenta un webhook hasta ocho veces, y el panel puede reencolar la cola
de descarte. **Todos esos intentos son legítimos, llevan firma válida y traen el
mismo `eventId`.** Sin inbox, un satélite que sume puntos al recibir
`visit.completed` los suma ocho veces.

La ventana anti-replay no basta: **la ventana acota el tiempo, el inbox acota las
veces**. Hacen falta las dos.

```ts
class InboxSql implements AlmacenInbox {
  async marcarSiEsNuevo(eventId: string) {
    const { rowCount } = await db.query(
      'INSERT INTO membego_inbox (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [eventId]
    )
    return rowCount === 1
  }
  async desmarcar(eventId: string) {
    await db.query('DELETE FROM membego_inbox WHERE event_id = $1', [eventId])
  }
}
```

**Un `SELECT` seguido de un `INSERT` no vale**: deja la ventana en la que dos
entregas simultáneas leen «no visto» y las dos procesan.

`InboxEnMemoria` sirve para desarrollo y para un proceso único. Con varias
instancias, dos memorias procesan el mismo evento dos veces — que es lo que se
venía a evitar.

### Si el manejador falla, el evento se desmarca

Dejarlo marcado haría que el reintento de MembeGo se descartara como duplicado y
el evento se perdiera **para siempre**: MembeGo lo daría por entregado y el
satélite nunca lo procesó.

La consecuencia es que un fallo a mitad de un manejador no atómico puede dejar
trabajo hecho y repetirse. El inbox evita las repeticiones normales; **no
sustituye a una transacción**.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **El Core no tiene su propia copia del vocabulario** | Dos tablas de códigos que se separan |
| Los módulos de plataforma reexportan, no redefinen | Que la copia vuelva por la puerta de atrás |
| Los contratos no importan nada del Core | Que un satélite se lleve medio MembeGo detrás |
| El SDK no importa nada del Core | Lo mismo, un nivel más arriba |
| Un solo token para N llamadas simultáneas | Auto-bloquearse en el arranque |
| Renueva antes de caducar | 401 en vuelo |
| **El reintento usa la misma clave** | Consumir el beneficio dos veces |
| Un 4xx del negocio no se reintenta | Gastar cuota y retrasar el error real |
| El cliente no fabrica claves | Que un reinicio del satélite genere una nueva |
| Reserializar el cuerpo invalida la firma | La integración que «parece» correcta |
| Fuera de ventana ≠ firma inválida | Mandar a mirar donde no es |
| Sin verificador no se acepta nada | Un satélite aceptando cualquier cosa |
| Manda Ed25519 sobre HMAC | Que el secreto compartido siga bastando |
| Un evento que falla se puede reintentar | Perder el evento para siempre |
| El inbox en memoria no crece sin límite | Una fuga de memoria con forma de defensa |

---

## Publicación

Los dos paquetes van a GitHub Packages, igual que `@membego/ui`. Dentro de este
repositorio se resuelven por `tsconfig.json`, así que el Core usa el código
fuente y no una versión publicada: **no puede quedarse atrás respecto de sí
mismo**.

---

## Siguiente

Fase 5 —SSO de un solo uso, `UsuarioSistema` y App Launcher por habilitación—
está en `docs/platform/sso.md`.
