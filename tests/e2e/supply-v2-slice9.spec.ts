import { createHmac } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { sinEmpresa } from '../../src/lib/tenant'
import { vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { crearOfertaComisionEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { aprobarBeneficioEnTx, asignarBeneficioEnTx, crearBeneficioEnTx } from '../../src/modules/supply-v2/benefits/service'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 4 de punta a punta en navegador.
 *
 * LOS RECORRIDOS, en este orden:
 *   A  sistema sano: el Centro de Operaciones dice SANO, sin difuntos y con la
 *      configuración puesta
 *   B  discrepancia: un webhook firmado con el importe equivocado abre un
 *      incidente de severidad alta, y se puede abrir y leer con su compra, su
 *      transacción y su hilo
 *   C  resolver: una persona autorizada lo pasa a investigación y lo cierra con
 *      ACCEPT_EXTERNAL, que confirma el pago por el servicio oficial
 *   D  sin salida: un efecto muerto se ve en el panel y se reintenta
 *   E  interruptor: apagar los pagos externos hace que el webhook responda sin
 *      procesar, el panel lo dice, y reactivar lo devuelve a la normalidad
 *   F  móvil: el panel se lee en un teléfono, sin desbordamiento lateral
 *
 * EL WEBHOOK SE LLAMA DE VERDAD, firmado con HMAC como lo firmaría la pasarela:
 * es la frontera que el bloque 2 abrió y la única forma honesta de provocar una
 * discrepancia. El arnés toca la base solo para sesiones, la empresa proveedora
 * y las comprobaciones SQL.
 *
 * El servidor tiene que arrancar con `SUPPLY_V2_TEST_GATEWAY_SECRET` y
 * `SUPPLY_V2_WEBHOOK_ACTOR_ID`; sin ellas el camino falla CERRADO (401 / 500) y
 * estas pruebas se saltan diciéndolo, en vez de pasar por casualidad.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const SECRETO = process.env.SUPPLY_V2_TEST_GATEWAY_SECRET ?? ''
const LISTO = SESION_LOCAL_DISPONIBLE && Boolean(SECRETO) && Boolean(process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID)
const RUTA = '/superadmin/supply/operaciones'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

interface Compra {
  id: string
  numero: string
  total: string
}

/**
 * Una compra pendiente de pago, montada por los SERVICIOS de verdad.
 *
 * El checkout completo ya lo prueban los slices 2 y 5 de punta a punta; aquí lo
 * que se prueba es la OPERACIÓN, así que la compra es decorado. Pero decorado
 * montado con `vincularEmpresaComoProveedorEnTx`, `crearAcuerdoEnTx`,
 * `crearOfertaComisionEnTx` y `abrirOrdenClienteEnTx`, no con filas a mano: una
 * orden insertada directa puede quedar con una economía que ningún servicio
 * habría escrito —líneas sin reparto por unidad, totales que no cuadran—, y
 * entonces lo que falle después no se sabe si es el panel o el decorado.
 *
 * El proveedor, el item y el acuerdo son idempotentes por empresa para que la
 * suite pueda correr muchas veces sobre la misma base compartida; la oferta y
 * la orden son nuevas en cada recorrido, porque cada uno necesita su compra sin
 * pagar.
 */
async function compraPendiente(etiqueta: string): Promise<Compra> {
  const db = prismaDeArnes()
  const empresa = await asegurarEmpresaProveedora(`Operaciones S9 ${sufijo}`)
  const compras = await asegurarUsuario('compras')
  const finanzas = await asegurarUsuario('finanzas')
  const cliente = await asegurarUsuario('cliente')
  const como = (actorId: string) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'e2e-slice9' })
  const ahora = Date.now()

  const base = await sinEmpresa('e2e slice 9', async (tx) => {
    // El arnés deja la `Company` con la capacidad de proveedor; la relación
    // comercial de Supply la crea el servicio del slice 1.
    const proveedorId =
      (await tx.supplyV2Supplier.findFirst({ where: { companyId: empresa.id }, select: { id: true } }))?.id ??
      (await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(compras.id))).id

    const itemId =
      (await tx.supplyV2CatalogItem.findFirst({ where: { supplierId: proveedorId, name: `Cena S9 ${sufijo}` }, select: { id: true } }))?.id ??
      (await crearItemCatalogoEnTx(tx, { supplierId: proveedorId, type: 'SERVICE', name: `Cena S9 ${sufijo}`, category: 'Restaurante', publicPrice: 1200 }, como(compras.id))).id

    const yaHay = await tx.supplyV2Agreement.findFirst({
      where: { supplierId: proveedorId, type: 'COMMISSION', status: 'ACTIVE', scope: 'CATEGORY', category: 'Restaurante' },
      select: { id: true },
    })
    if (!yaHay) {
      const a = await crearAcuerdoEnTx(
        tx,
        { supplierId: proveedorId, type: 'COMMISSION', scope: 'CATEGORY', category: 'Restaurante', commissionPercentage: 10, startsAt: new Date(ahora - 86_400_000) },
        como(compras.id)
      )
      // Activar es de finanzas, no de compras: quien pacta no aprueba.
      await activarAcuerdoEnTx(tx, a.id, como(finanzas.id))
    }
    return { itemId }
  })

  const ofertaId = await sinEmpresa('e2e slice 9', async (tx) => {
    const o = await crearOfertaComisionEnTx(
      tx,
      {
        catalogItemId: base.itemId,
        title: `Cena S9 ${etiqueta} ${sufijo}`,
        publicPrice: 1200,
        salePrice: 1000,
        availabilityMode: 'UNLIMITED',
        perCustomerLimit: 50,
        startsAt: new Date(ahora - 60_000),
        endsAt: new Date(ahora + 30 * 86_400_000),
      },
      como(compras.id)
    )
    await publicarOfertaEnTx(tx, o.id, como(compras.id))
    return o.id
  })

  const orden = await sinEmpresa('e2e slice 9', (tx) =>
    abrirOrdenClienteEnTx(tx, { customerId: cliente.id, offerId: ofertaId, quantity: 1, idempotencyKey: `e2e-s9-${etiqueta}-${sufijo}` }, como(cliente.id))
  )

  // La orden queda UNPAID: eso es exactamente el punto de partida de
  // todos estos recorridos —llega un aviso de la pasarela sobre una compra que
  // Membego todavía no ha dado por pagada—.
  const guardada = await db.supplyV2CustomerOrder.findUniqueOrThrow({
    where: { id: orden.id },
    select: { id: true, number: true, total: true, paymentStatus: true },
  })
  if (guardada.paymentStatus !== 'UNPAID') {
    throw new Error(`el arnés esperaba una compra sin pagar y el checkout la dejó en ${guardada.paymentStatus}`)
  }
  return { id: guardada.id, numero: guardada.number, total: guardada.total.toFixed(2) }
}

/**
 * El cron de Supply, llamado por HTTP como lo llamaría el programador.
 *
 * Y NO importando `evaluarAutomatizaciones`: ese servicio vive detrás de
 * `server-only` y un spec de Playwright es código de cliente, así que
 * importarlo rompe el arranque entero de la suite —lo hizo—. Pero además la
 * ruta prueba MÁS: es la que corre en producción, con su autorización, su orden
 * de pasos y su despacho final, así que el aviso que esta prueba busca sale por
 * el mismo camino por el que saldrá de verdad.
 */
async function correrCron(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${BASE}/api/cron/supply-v2`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    timeout: 120_000,
  })
  if (res.status() !== 200) {
    throw new Error(`el cron contestó ${res.status()}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as Record<string, unknown>
}

/** Un webhook firmado como lo firmaría la pasarela. */
async function mandarWebhook(
  page: Page,
  d: { eventId: string; orderNumber: string; amount: string; txId?: string; hilo?: string }
): Promise<{ status: number; codigo: string; correlationId?: string }> {
  const cuerpo = JSON.stringify({
    event: { id: d.eventId, kind: 'payment.updated' },
    transaction: {
      id: d.txId ?? `TX-${d.eventId}`,
      status: 'APPROVED',
      amount: d.amount,
      currency: 'DOP',
      order_reference: d.orderNumber,
    },
  })
  const ts = String(Math.floor(Date.now() / 1000))
  const firma = createHmac('sha256', SECRETO).update(`${ts}.${cuerpo}`).digest('hex')
  const res = await page.request.post(`${BASE}/api/webhooks/supply-v2/TEST_GATEWAY`, {
    headers: {
      'content-type': 'application/json',
      'x-sv2-timestamp': ts,
      'x-sv2-signature': `v1=${firma}`,
      ...(d.hilo ? { 'x-correlation-id': d.hilo } : {}),
    },
    data: cuerpo,
  })
  const json = (await res.json()) as { codigo: string; correlationId?: string }
  return { status: res.status(), ...json }
}

/**
 * Lo que esta suite no puede dejar atrás.
 *
 * 1. LOS INTERRUPTORES. Uno apagado haría fallar a otra suite con un 503 que
 *    nadie entendería.
 *
 * 2. LAS OFERTAS DE SUS COMPRAS. Son ofertas ACTIVAS de un restaurante
 *    inventado, y mientras existan salen en el marketplace y en las pantallas
 *    del cliente de TODAS las demás suites. No se borran —hay líneas de compra
 *    apuntando a ellas y borrarlas rompería la economía—: se cierran, que es lo
 *    que haría un proveedor de verdad al retirar una oferta.
 *
 * Lo demás se queda a propósito: el proveedor, el item y el acuerdo son
 * idempotentes por empresa (la suite los reutiliza en cada corrida) y las
 * compras son historia del cliente, no basura.
 */
async function limpiarTrasLaSuite(): Promise<void> {
  const db = prismaDeArnes()
  await db.supplyV2OperationalSwitch.deleteMany({})
  await db.supplyV2Offer.updateMany({
    where: { title: { contains: sufijo }, status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] } },
    data: { status: 'ENDED', endsAt: new Date(Date.now() - 1_000) },
  })
}

test.describe('Slice 9 · bloque 4 · Centro de Operaciones', () => {
  test.skip(!LISTO, 'Falta SUPABASE_JWT_SECRET, SUPPLY_V2_TEST_GATEWAY_SECRET o SUPPLY_V2_WEBHOOK_ACTOR_ID.')
  test.describe.configure({ mode: 'serial', timeout: 300_000 })

  test.afterAll(async () => {
    await limpiarTrasLaSuite()
    await cerrarPrisma()
  })

  test('A · el panel dice si el sistema está sano, y de qué', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'compras', BASE)
    const page = await ctx.newPage()
    await page.goto(`${BASE}${RUTA}`)

    await expect(page.getByRole('heading', { name: /Centro de Operaciones/i })).toBeVisible()

    // El estado del sistema sale de datos: existe y es uno de los cuatro.
    const estado = page.getByTestId('estado-sistema')
    await expect(estado).toBeVisible()
    const valor = await estado.getAttribute('data-estado')
    expect(['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'NOT_CONFIGURED']).toContain(valor)

    // Los seis componentes, cada uno con su veredicto.
    for (const clave of ['base', 'pagos', 'outbox', 'conciliacion', 'trabajos', 'config']) {
      await expect(page.getByTestId(`componente-${clave}`)).toBeVisible()
    }
    // La base responde y el esquema cuadra: eso sí tiene que estar sano.
    await expect(page.getByTestId('estado-base')).toHaveAttribute('data-estado', 'HEALTHY')
    // Lo que el bloque 9 necesita para operar SÍ está puesto, y el panel lo dice
    // pieza por pieza.
    await expect(page.getByTestId('config-estado-SUPPLY_V2_WEBHOOK_ACTOR_ID')).toContainText('CONFIGURED')
    await expect(page.getByTestId('config-estado-SUPPLY_V2_TEST_GATEWAY_SECRET')).toContainText('CONFIGURED')
    // Y por eso la configuración NO puede estar en `UNAVAILABLE`: ese estado se
    // reserva para cuando falta algo crítico de una capacidad ENCENDIDA, que es
    // justo lo que esta comprobación vigila —si alguien rompiera la lectura de
    // la cuenta de integración, aquí se vería—.
    //
    // No se exige `HEALTHY` a secas porque en un entorno local QStash no está
    // configurado de verdad, y eso es degradación honesta, no una avería: la
    // cola ejecuta en línea y no pierde ningún efecto. Exigir verde aquí
    // obligaría a inventar credenciales de un servicio remoto para que una
    // prueba pasara, que es exactamente la clase de maquillaje que este panel
    // existe para no hacer.
    const estadoConfig = await page.getByTestId('estado-config').getAttribute('data-estado')
    expect(['HEALTHY', 'NOT_CONFIGURED']).toContain(estadoConfig)

    // Y de los secretos solo sale que están: el valor NO aparece en la página.
    const html = await page.content()
    expect(html).not.toContain(SECRETO)
    expect(html).not.toContain(process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID!)

    // Las cuatro capacidades, con su interruptor.
    for (const clave of [
      'SUPPLY_V2_EXTERNAL_PAYMENTS',
      'SUPPLY_V2_OUTBOX_DELIVERY',
      'SUPPLY_V2_RECONCILIATION_SWEEP',
      'SUPPLY_V2_OPERATIONS_CENTER',
    ]) {
      await expect(page.getByTestId(`capacidad-${clave}`)).toBeVisible()
    }

    await ctx.close()
  })

  test('B · un cobro con el importe equivocado abre un incidente de severidad alta', async ({ browser }) => {
    const compra = await compraPendiente('b')
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'compras', BASE)
    const page = await ctx.newPage()

    const hilo = `sv2-e2e-b-${sufijo}`
    const tx = `TX-E2E-B-${sufijo}`
    // La pasarela dice que cobró 900 de una compra de 1 000.
    const r = await mandarWebhook(page, { eventId: `evt-e2e-b-${sufijo}`, orderNumber: compra.numero, amount: '900.00', txId: tx, hilo })
    expect(r.status).toBe(200)
    expect(r.codigo).toBe('EVENT_REJECTED')

    // El panel lo cuenta.
    await page.goto(`${BASE}${RUTA}`)
    await expect(page.getByTestId('cifra-incidentes-altos')).not.toHaveText('0')
    await expect(page.getByTestId('estado-conciliacion')).toHaveAttribute('data-estado', 'DEGRADED')

    // Y se encuentra buscando por el hilo.
    await page.getByTestId('buscar-operacion').fill(hilo)
    await page.getByTestId('btn-buscar').click()
    await expect(page.getByTestId('resultado-orden-numero')).toHaveText(compra.numero)
    await expect(page.getByTestId('resultado-orden-estado')).toHaveText('PENDING')
    await expect(page.getByTestId('linea-de-tiempo')).toBeVisible()
    // La historia dice lo que NO está persistido, en vez de inventarlo.
    await expect(page.getByTestId('aviso-de-linea').first()).toContainText(/firma/i)

    // Se abre el incidente desde la lista, acotado a LA COMPRA de este
    // recorrido y no con `.first()`: la lista acumula los incidentes de los
    // demás recorridos de la suite, y coger «el primero» ataría esta prueba al
    // orden en que corran las otras. La fila trae el número de compra, así que
    // se filtra por él y se afirma que hay una.
    await page.goto(`${BASE}${RUTA}/incidentes?severity=HIGH`)
    const fila = page.locator('tr').filter({ hasText: compra.numero })
    await expect(fila).toHaveCount(1)
    await fila.getByTestId(/^abrir-incidente-/).click()

    // La ficha trae todo lo que hace falta para decidir.
    await expect(page.getByTestId('detalle-severidad')).toContainText('HIGH')
    await expect(page.getByTestId('detalle-estado')).toHaveText('OPEN')
    await expect(page.getByTestId('detalle-motivo')).toHaveText('AMOUNT_MISMATCH')
    await expect(page.getByTestId('detalle-transaccion')).toContainText(tx)
    await expect(page.getByTestId('detalle-orden')).toContainText(compra.numero)
    await expect(page.getByTestId('detalle-hilo')).toContainText(hilo)
    await expect(page.getByTestId('linea-de-tiempo')).toBeVisible()

    // La compra sigue intacta: detectar no es corregir.
    const db = prismaDeArnes()
    const enBase = await db.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id }, select: { status: true } })
    expect(enBase.status).toBe('PENDING')

    await ctx.close()
  })

  test('C · una persona autorizada investiga y resuelve, y el pago pasa por el servicio oficial', async ({ browser }) => {
    const compra = await compraPendiente('c')
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'finanzas', BASE)
    const page = await ctx.newPage()

    // Un cobro por el importe correcto que no llegó a confirmarse: el caso en
    // el que aceptar la evidencia externa tiene sentido.
    const hilo = `sv2-e2e-c-${sufijo}`
    await mandarWebhook(page, { eventId: `evt-e2e-c-${sufijo}`, orderNumber: compra.numero, amount: '900.00', hilo })

    await page.goto(`${BASE}${RUTA}/incidentes?status=OPEN`)
    const filaC = page.locator('tr').filter({ hasText: compra.numero })
    await expect(filaC).toHaveCount(1)
    await filaC.getByTestId(/^abrir-incidente-/).click()
    await expect(page.getByTestId('detalle-estado')).toHaveText('OPEN')

    // OPEN → INVESTIGATING.
    await page.getByTestId('investigar-incidente').click()
    await expect(page.getByTestId('detalle-estado')).toHaveText('INVESTIGATING', { timeout: 20_000 })

    // Y se resuelve aceptando la evidencia externa, con el importe autorizado.
    await page.getByTestId('select-resolucion').selectOption('ACCEPT_EXTERNAL')
    await page.getByTestId('monto-autorizado').fill(compra.total)
    await page.getByTestId('nota-resolucion').fill('Comprobado en el portal de la pasarela: el cobro existe y es de esta compra.')
    await page.getByTestId('resolver-incidente').click()
    await expect(page.getByTestId('detalle-estado')).toHaveText('RESOLVED', { timeout: 25_000 })

    // En PostgreSQL: pagada por el camino bueno, con derechos y economía.
    const db = prismaDeArnes()
    const orden = await db.supplyV2CustomerOrder.findUniqueOrThrow({
      where: { id: compra.id },
      select: { status: true, paidAt: true, entitlements: { select: { id: true } } },
    })
    expect(orden.status).toBe('PAID')
    expect(orden.paidAt).not.toBeNull()
    expect(orden.entitlements).toHaveLength(1)
    const incidente = await db.supplyV2FinanceIncident.findFirstOrThrow({
      where: { orderId: compra.id, type: 'EXTERNAL_PAYMENT_MISMATCH' },
      select: { status: true, resolution: true, resolvedById: true, resolutionNotes: true },
    })
    expect(incidente.status).toBe('RESOLVED')
    expect(incidente.resolution).toBe('ACCEPT_EXTERNAL')
    expect(incidente.resolvedById).not.toBeNull()
    expect(incidente.resolutionNotes).toMatch(/portal de la pasarela/)
    const efectos = await db.supplyV2OutboxEvent.count({ where: { aggregateId: compra.id } })
    expect(efectos).toBe(1)

    await ctx.close()
  })

  test('D · un efecto sin salida se ve en el panel y se puede reintentar', async ({ browser }) => {
    const compra = await compraPendiente('d')
    const db = prismaDeArnes()
    // El efecto muerto es DECORADO del recorrido: lo que se prueba es que el
    // panel lo muestra y que el reintento del bloque 1 funciona desde ahí.
    const efecto = await db.supplyV2OutboxEvent.create({
      data: {
        eventType: 'supply.order.paid',
        aggregateType: 'SupplyV2CustomerOrder',
        aggregateId: compra.id,
        payload: { orderNumber: compra.numero },
        correlationId: `sv2-e2e-d-${sufijo}`,
        dedupeKey: `supply.order.paid:SupplyV2CustomerOrder:${compra.id}`,
        status: 'DEAD_LETTER',
        attempts: 8,
        lastError: 'el destino no respondió',
      },
      select: { id: true },
    })

    const ctx = await browser.newContext()
    await entrarComo(ctx, 'compras', BASE)
    const page = await ctx.newPage()

    await page.goto(`${BASE}${RUTA}`)
    await expect(page.getByTestId('cifra-outbox-muertos')).not.toHaveText('0')
    await expect(page.getByTestId('estado-outbox')).toHaveAttribute('data-estado', 'DEGRADED')

    await page.goto(`${BASE}${RUTA}/difuntos`)
    await expect(page.getByTestId(`muerto-${efecto.id}`)).toBeVisible()
    await expect(page.getByTestId(`muerto-intentos-${efecto.id}`)).toHaveText('8')

    await page.getByTestId(`reintentar-${efecto.id}`).click()
    await expect(page.getByText(/Reintentado/i)).toBeVisible({ timeout: 20_000 })

    // En base: vuelve a estar disponible y con la escalera devuelta.
    const tras = await db.supplyV2OutboxEvent.findUniqueOrThrow({ where: { id: efecto.id }, select: { status: true, attempts: true, retriedById: true } })
    expect(['PENDING', 'PROCESSING', 'DELIVERED']).toContain(tras.status)
    expect(tras.attempts).toBe(0)
    expect(tras.retriedById).not.toBeNull()

    await ctx.close()
  })

  test('E · el interruptor apaga el procesamiento y el panel sigue funcionando', async ({ browser }) => {
    const compra = await compraPendiente('e')
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'finanzas', BASE)
    const page = await ctx.newPage()

    await page.goto(`${BASE}${RUTA}`)
    await page.getByTestId('apagar-SUPPLY_V2_EXTERNAL_PAYMENTS').click()
    await page.getByTestId('motivo-SUPPLY_V2_EXTERNAL_PAYMENTS').fill('Prueba de punta a punta del interruptor.')
    await page.getByTestId('confirmar-apagar-SUPPLY_V2_EXTERNAL_PAYMENTS').click()
    await expect(page.getByTestId('capacidad-estado-SUPPLY_V2_EXTERNAL_PAYMENTS')).toHaveAttribute('data-estado', 'NOT_CONFIGURED', { timeout: 20_000 })

    // El webhook: respuesta controlada y NADA procesado.
    const eventId = `evt-e2e-e-${sufijo}`
    const r = await mandarWebhook(page, { eventId, orderNumber: compra.numero, amount: '1000.00' })
    expect(r.status).toBe(503)
    expect(r.codigo).toBe('FEATURE_DISABLED')

    const db = prismaDeArnes()
    expect(await db.supplyV2ExternalEvent.count({ where: { externalEventId: eventId } })).toBe(0)
    expect((await db.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id }, select: { status: true } })).status).toBe('PENDING')

    // Y el panel sigue en pie: apagar la integración no apaga la vista.
    await page.goto(`${BASE}${RUTA}`)
    await expect(page.getByTestId('estado-pagos')).toHaveAttribute('data-estado', 'NOT_CONFIGURED')
    await expect(page.getByTestId('estado-sistema')).not.toHaveAttribute('data-estado', 'UNAVAILABLE')
    await page.goto(`${BASE}${RUTA}/incidentes`)
    await expect(page.getByRole('heading', { name: /Incidentes de pago externo/i })).toBeVisible()

    // Reactivar, y el mismo evento entra.
    await page.goto(`${BASE}${RUTA}`)
    await page.getByTestId('encender-SUPPLY_V2_EXTERNAL_PAYMENTS').click()
    await expect(page.getByTestId('capacidad-estado-SUPPLY_V2_EXTERNAL_PAYMENTS')).toHaveAttribute('data-estado', 'HEALTHY', { timeout: 20_000 })

    const r2 = await mandarWebhook(page, { eventId, orderNumber: compra.numero, amount: '1000.00' })
    expect(r2.status).toBe(200)
    expect(r2.codigo).toBe('EVENT_ACCEPTED')
    expect((await db.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id }, select: { status: true } })).status).toBe('PAID')

    await ctx.close()
  })

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * BLOQUE 5 · §27 · LOS RECORRIDOS FINALES DEL SLICE 9
   *
   * G recorre la cadena COMPLETA en un solo caso, que es lo que ninguno de los
   * anteriores hacía: aviso de la pasarela → pago → efecto en el outbox →
   * aviso que el cliente VE en su campana → la misma operación encontrada por
   * su hilo en el Centro de Operaciones. Las piezas estaban probadas por
   * separado; esto prueba que están unidas.
   *
   * H recorre la automatización: un beneficio que vence pronto → el aviso
   * apuntado → entregado → visible para el cliente, y la segunda pasada NO
   * manda un segundo aviso. La deduplicación se demuestra con el aviso en
   * pantalla, no contando filas.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * LO QUE G ENCONTRÓ AL BUSCAR EL AVISO EN PANTALLA
   *
   * No estaba. El aviso se escribía, se entregaba y quedaba DELIVERED en la
   * base… y el área de cliente no lo mostraba en ninguna parte: el
   * desplegable que lee `notificaciones` vive en la cabecera de admin, y la
   * campana del cliente llevaba al muro social de las empresas que sigue.
   *
   * Un aviso invisible es exactamente «marcar una funcionalidad como
   * completada porque existe el código», que es lo que el enunciado del Slice
   * prohíbe. Por eso estas dos pruebas afirman sobre la PANTALLA y no sobre un
   * `count()`: una aserción en base habría pasado desde el primer día sin que
   * ningún cliente viera nunca nada.
   */

  test('G · de la pasarela al aviso del cliente, y de vuelta por el hilo', async ({ browser }) => {
    const compra = await compraPendiente('g')
    const db = prismaDeArnes()
    const hilo = `sv2-e2e-g-${sufijo}`

    const ops = await browser.newContext()
    await entrarComo(ops, 'compras', BASE)
    const panel = await ops.newPage()

    // 1 · LA PASARELA AVISA, por el importe correcto y firmado.
    const r = await mandarWebhook(panel, { eventId: `evt-e2e-g-${sufijo}`, orderNumber: compra.numero, amount: compra.total, txId: `TX-E2E-G-${sufijo}`, hilo })
    expect(r.status).toBe(200)
    expect(r.codigo).toBe('EVENT_ACCEPTED')

    // 2 · EL PAGO quedó hecho por el camino oficial, con su derecho emitido.
    const orden = await db.supplyV2CustomerOrder.findUniqueOrThrow({
      where: { id: compra.id },
      select: { status: true, paymentStatus: true, paidAt: true, entitlements: { select: { id: true } } },
    })
    expect(orden.status).toBe('PAID')
    expect(orden.paymentStatus).toBe('CONFIRMED')
    expect(orden.paidAt).not.toBeNull()
    expect(orden.entitlements).toHaveLength(1)

    // 3 · EL EFECTO se apuntó en el outbox y salió. El webhook despacha en su
    // propia petición, así que a estas alturas ya debería estar entregado; se
    // espera por si la cola lo hizo asíncrono, sin subir el tiempo de nada más.
    await expect
      .poll(
        async () =>
          (await db.supplyV2OutboxEvent.findFirstOrThrow({
            where: { aggregateId: compra.id, eventType: 'supply.order.paid' },
            select: { status: true },
          })).status,
        { timeout: 30_000, message: 'el efecto del aviso tenía que salir' }
      )
      .toBe('DELIVERED')

    // 4 · EL CLIENTE LO VE. Esto es lo que el Slice 9 vino a arreglar: antes,
    // confirmar un pago no avisaba a nadie. Se entra como el cliente y se abre
    // su campana por el nombre accesible, que es la promesa del producto.
    const suyo = await browser.newContext()
    await entrarComo(suyo, 'cliente', BASE)
    const cliente = await suyo.newPage()
    // `/cliente` NO existe: el área de cliente no tiene índice y su portada es
    // `/cliente/inicio`. Navegar a `/cliente` daba un 404 limpio en el que,
    // por supuesto, no hay ninguna campana —y el fallo decía «no encuentro el
    // badge» en vez de «te equivocaste de ruta»—.
    await cliente.goto(`${BASE}/cliente/inicio`)
    // La campana lleva la cuenta: sin número, el aviso es alcanzable y no
    // descubrible. Se comprueba el badge Y el aviso, porque lo primero es lo
    // que hace que alguien pulse.
    await expect(cliente.getByTestId('campana-sin-leer')).toBeVisible({ timeout: 20_000 })
    await cliente.getByTestId('campana-avisos').click()
    await expect(cliente.getByTestId('mis-avisos')).toBeVisible({ timeout: 20_000 })

    // El aviso DE ESTA COMPRA, localizado por el hilo que lo une al efecto, y
    // no `getByText(...).first()`: con varios recorridos dejando compras
    // pagadas a la misma clienta, «el primero con este texto» puede ser el de
    // otro caso, y entonces esta prueba pasaría sin demostrar su propia
    // cadena. Misma razón que en H.
    const efecto = await db.supplyV2OutboxEvent.findFirstOrThrow({
      where: { aggregateId: compra.id, eventType: 'supply.order.paid' },
      select: { dedupeKey: true },
    })
    const avisoDeLaCompra = await db.notificacion.findFirstOrThrow({
      where: { dedupeKey: efecto.dedupeKey },
      select: { id: true },
    })
    await expect(cliente.getByTestId(`aviso-${avisoDeLaCompra.id}`)).toContainText('Tu compra está confirmada')
    await expect(cliente.getByTestId(`aviso-${avisoDeLaCompra.id}`)).toContainText(compra.numero)
    await suyo.close()

    // 5 · Y DESDE OPERACIONES se encuentra todo por el hilo: la compra, su
    // estado y su historia.
    await panel.goto(`${BASE}${RUTA}`)
    await panel.getByTestId('buscar-operacion').fill(hilo)
    await panel.getByTestId('btn-buscar').click()
    await expect(panel.getByTestId('resultado-orden-numero')).toHaveText(compra.numero)
    await expect(panel.getByTestId('resultado-orden-estado')).toHaveText('PAID')
    await expect(panel.getByTestId('linea-de-tiempo')).toBeVisible()

    await ops.close()
  })

  test('H · un beneficio por vencer avisa UNA vez, aunque el cron corra dos', async ({ browser }) => {
    const db = prismaDeArnes()
    const empresa = await asegurarEmpresaProveedora(`Operaciones S9 ${sufijo}`)
    const compras = await asegurarUsuario('compras')
    const finanzas = await asegurarUsuario('finanzas')
    const clienteU = await asegurarUsuario('cliente')
    const como = (actorId: string) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'e2e-slice9' })

    // Un beneficio asignado que vence en DOS días: dentro de los tres con los
    // que avisa la automatización. Montado con los servicios del slice 4, no
    // con filas a mano.
    const proveedorId =
      (await db.supplyV2Supplier.findFirst({ where: { companyId: empresa.id }, select: { id: true } }))?.id ??
      (await sinEmpresa('e2e slice 9', (tx) => vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(compras.id)))).id

    const asignacionId = await sinEmpresa('e2e slice 9', async (tx) => {
      const b = await crearBeneficioEnTx(
        tx,
        {
          name: `Bono por vencer S9 ${sufijo}`,
          funding: 'SUPPLIER',
          valueType: 'FIXED_AMOUNT',
          supplierValue: 100,
          scope: 'SUPPLIER',
          supplierId: proveedorId,
          perCustomerLimit: 1,
          startsAt: new Date(Date.now() - 86_400_000),
          endsAt: new Date(Date.now() + 30 * 86_400_000),
        },
        como(compras.id)
      )
      await aprobarBeneficioEnTx(tx, b.id, como(finanzas.id))
      const g = await asignarBeneficioEnTx(
        tx,
        { benefitId: b.id, customerId: clienteU.id, expiresAt: new Date(Date.now() + 2 * 86_400_000) },
        como(compras.id)
      )
      return g.id
    })

    const ops = await browser.newContext()
    await entrarComo(ops, 'compras', BASE)
    const panel = await ops.newPage()

    // PRIMERA PASADA del cron de verdad, por su ruta y con su secreto.
    const primera = await correrCron(panel)
    expect((primera as { ok: boolean }).ok).toBe(true)
    const auto = (primera as { automatizaciones: { activo: boolean } }).automatizaciones
    expect(auto.activo).toBe(true)

    const apuntados = await db.supplyV2OutboxEvent.count({
      where: { eventType: 'supply.notify.benefit_expiring', aggregateId: asignacionId },
    })
    expect(apuntados).toBeGreaterThanOrEqual(1)

    // SEGUNDA PASADA: no apunta ni un aviso nuevo para este beneficio. Lo
    // impide la clave única de deduplicación, que lleva el día dentro.
    await correrCron(panel)
    const trasSegunda = await db.supplyV2OutboxEvent.count({
      where: { eventType: 'supply.notify.benefit_expiring', aggregateId: asignacionId },
    })
    expect(trasSegunda).toBe(apuntados)

    // El propio cron despacha al final de su pasada, así que el aviso ya tiene
    // que haber salido.
    await expect
      .poll(
        async () =>
          db.supplyV2OutboxEvent.count({
            where: { eventType: 'supply.notify.benefit_expiring', aggregateId: asignacionId, status: 'DELIVERED' },
          }),
        { timeout: 30_000, message: 'el aviso del vencimiento tenía que salir en la pasada del cron' }
      )
      .toBeGreaterThanOrEqual(1)

    // Y EL CLIENTE LO VE.
    //
    // ─────────────────────────────────────────────────────────────────────
    // POR QUÉ SE BUSCA ESTE AVISO Y NO «UN AVISO CON ESTE TEXTO»
    //
    // Esto afirmaba `getByText('Un beneficio tuyo está por vencer')` con
    // `toHaveCount(1)`, y en la suite completa salieron DOS. No era un fallo
    // del producto: era la aserción. Los recorridos anteriores dejan a esta
    // misma clienta con otros beneficios por vencer, y cada uno tiene su
    // aviso —con el mismo título, porque el título no lleva el nombre del
    // beneficio—. Dos beneficios distintos son dos avisos, y eso es correcto.
    //
    // Lo que la prueba quiere decir es «el MÍO sale, y una sola vez», no «en
    // toda la base hay un solo beneficio por vencer». Es exactamente la regla
    // que `docs/PRUEBAS-E2E.md` pide y que esta prueba estaba incumpliendo:
    // afirmar sobre lo propio, nunca sobre un contador global. La
    // deduplicación de verdad ya quedó demostrada arriba contra la base, para
    // ESTE beneficio.
    const fila = await db.supplyV2OutboxEvent.findFirstOrThrow({
      where: { eventType: 'supply.notify.benefit_expiring', aggregateId: asignacionId },
      select: { dedupeKey: true },
    })
    // La `idempotencyKey` del efecto es el `dedupeKey` de su fila, y viaja al
    // `dedupeKey` de la notificación: ese es el hilo entre el aviso apuntado y
    // el aviso que se ve.
    const aviso = await db.notificacion.findFirstOrThrow({
      where: { userId: clienteU.id, dedupeKey: fila.dedupeKey },
      select: { id: true },
    })

    const suyo = await browser.newContext()
    await entrarComo(suyo, 'cliente', BASE)
    const cliente = await suyo.newPage()
    await cliente.goto(`${BASE}/cliente/novedades`)
    await expect(cliente.getByTestId('mis-avisos')).toBeVisible({ timeout: 20_000 })
    await expect(cliente.getByTestId(`aviso-${aviso.id}`)).toHaveCount(1)
    await expect(cliente.getByTestId(`aviso-${aviso.id}`)).toContainText('Un beneficio tuyo está por vencer')
    await suyo.close()
    await ops.close()
  })
})
