# @membego/platform-sdk

Cliente de la plataforma MembeGo para un sistema vertical.

```ts
const membego = new MembegoClient({ baseUrl, clientId, clientSecret })

const cliente = await membego.resolveCustomer(companyId, { phone })
const { benefits } = await membego.evaluateBenefits({ companyId, customerId: cliente.id })
await membego.redeem({ companyId, membershipId, servicio }, `comanda-${id}`)
```

Resuelve cuatro cosas que un cliente escrito a mano olvida, y que fallan de
formas que no se notan:

1. Renovar el token **antes** de que caduque.
2. No pedir veinte tokens a la vez al arrancar.
3. Reintentar solo lo reintentable, con espera creciente y jitter.
4. Reintentar una escritura con la **misma** clave de idempotencia.

Y del otro lado: `verificarWebhook` (firma sobre el cuerpo crudo) y
`procesarUnaVez` (inbox: el mismo `eventId` no se procesa dos veces).

Documentación: `docs/platform/sdk.md`.
