/**
 * @membego/platform-sdk — cliente de la plataforma MembeGo para un sistema
 * vertical.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ TE AHORRA
 *
 * Cuatro cosas que un cliente escrito a mano olvida, y que fallan de formas que
 * no se notan hasta que ya pasaron:
 *
 *  1. Renovar el token ANTES de que caduque, no cuando ya caducó.
 *  2. No pedir veinte tokens a la vez al arrancar.
 *  3. Reintentar solo lo reintentable, con espera creciente y jitter.
 *  4. Reintentar una escritura con la MISMA clave de idempotencia.
 *
 * Y del otro lado: verificar la firma sobre el cuerpo crudo, y no procesar dos
 * veces el mismo `eventId`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EJEMPLO COMPLETO
 *
 * ```ts
 * import { MembegoClient, verificarWebhook, InboxEnMemoria, procesarUnaVez }
 *   from '@membego/platform-sdk'
 *
 * const membego = new MembegoClient({
 *   baseUrl: 'https://membego.com',
 *   clientId: process.env.MEMBEGO_CLIENT_ID!,
 *   clientSecret: process.env.MEMBEGO_CLIENT_SECRET!,
 * })
 *
 * // El camarero teclea el teléfono.
 * const cliente = await membego.resolveCustomer(companyId, { phone: '8095551234' })
 * const { benefits } = await membego.evaluateBenefits({ companyId, customerId: cliente.id })
 *
 * // Se presta el servicio y se consume. La clave identifica LA COMANDA,
 * // no la llamada HTTP: si tu proceso se reinicia y reintenta, tiene que
 * // llegar la misma.
 * await membego.redeem(
 *   { companyId, membershipId, servicio: 'Almuerzo' },
 *   `comanda-${comandaId}`
 * )
 * ```
 *
 * Webhook (Express — ojo con `raw` antes de `json`):
 *
 * ```ts
 * app.post('/webhooks/membego', express.raw({ type: 'application/json' }),
 *   async (req, res) => {
 *     const r = verificarWebhook(req.body.toString('utf8'), req.headers, {
 *       clavePublicaPem: process.env.MEMBEGO_PUBLIC_KEY!,
 *     })
 *     if (!r.ok) return res.status(400).json({ error: r.fallo })
 *
 *     // 200 primero: MembeGo reintenta lo que no responde, y el inbox ya
 *     // garantiza que un reintento no vuelve a procesar.
 *     res.sendStatus(200)
 *     await procesarUnaVez(inbox, r.evento.eventId, () => manejar(r.evento))
 *   })
 * ```
 */

export { MembegoClient, MembegoError, type OpcionesCliente } from './cliente'
export {
  verificarWebhook,
  type Cabeceras,
  type FalloWebhook,
  type OpcionesVerificacion,
  type ResultadoWebhook,
} from './webhooks'
export {
  InboxEnMemoria,
  procesarUnaVez,
  type AlmacenInbox,
  type ResultadoInbox,
} from './inbox'

/** Todo el vocabulario, para no tener que instalar los contratos aparte. */
export * from '@membego/contracts'
