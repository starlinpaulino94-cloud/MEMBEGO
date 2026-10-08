import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * POS CONECTADO A COMMERCE CORE · de punta a punta (F7).
 *
 *   el cajero abre la caja → vende en el mostrador un servicio y 2 camisetas, paga en efectivo con cambio
 *   (las existencias bajan y el cobro aparece en el turno) → una transferencia sin referencia no cobra → una
 *   persona llega con el QR de su pedido del marketplace: se ve el pedido, se cobra con una transferencia con
 *   su referencia y el pedido se cierra con su comisión del 8 % (el cliente ya había confirmado el monto)
 *
 * Y lo que NO debe pasar: ver los bloques del POS conectado en una empresa que no lo tiene, cobrar el QR de
 * otra empresa, o cobrar dos veces el mismo QR.
 *
 * El pedido del marketplace se SIEMBRA por Prisma (pedir → aceptar → listo ya lo prueba `pedidos-membego`); las
 * reglas de la base, contra PostgreSQL, las prueba `tests/postgres/pos.db.test.ts`. Aquí se prueba la INTERFAZ.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const SERVICIO = `Lavado Caja ${sufijo}`
const CAMISETA = `Camiseta Caja ${sufijo}`

async function abrirCaja(p: Page) {
  await p.goto('/empleado/caja')
  await p.getByRole('button', { name: 'Abrir caja' }).click()
  await expect(p.getByText('Caja abierta')).toBeVisible({ timeout: 20_000 })
}

test.describe('POS conectado · recorrido', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let sin: EmpresaCatalogo
  let otra: EmpresaCatalogo
  let sucursalId = ''
  let servicio = ''
  let camiseta = ''
  let tokenListo = ''
  let tokenAjeno = ''
  let pedidoListoId = ''

  const existencias = async () => (await prismaDeArnes().inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: camiseta, locationId: sucursalId } } })).onHand

  /** Un pedido del marketplace LISTO con su QR, el monto ya confirmado por el cliente. */
  async function pedidoDelMarketplace(e: EmpresaCatalogo, sucursal: string, variante: string, token: string, codigo: string, total: number) {
    const prisma = prismaDeArnes()
    const cliente = await prisma.cliente.create({ data: { companyId: e.id, supabaseId: `e2e-pos-${codigo}`, nombre: `Cliente ${codigo}`, email: `pos-${codigo}@prueba.test` }, select: { id: true } })
    const ahora = new Date()
    const o = await prisma.membegoOrder.create({
      data: {
        companyId: e.id,
        code: codigo,
        locationId: sucursal,
        customerId: cliente.id,
        status: 'READY',
        origin: 'MARKETPLACE',
        subtotal: total,
        commissionableBase: total,
        total,
        qrToken: token,
        qrExpiresAt: new Date(ahora.getTime() + 7 * 86_400_000),
        acceptedAt: ahora,
        readyAt: ahora,
        customerConfirmedAt: ahora,
      },
    })
    await prisma.membegoOrderLine.create({ data: { companyId: e.id, orderId: o.id, catalogVariantId: variante, description: SERVICIO, sku: `SKU-${codigo}`, quantity: 1, unitPrice: total, lineTotal: total } })
    await prisma.customerConfirmation.create({ data: { companyId: e.id, orderId: o.id, confirmedTotal: total } })
    await prisma.orderAttribution.create({ data: { companyId: e.id, orderId: o.id, channel: 'MARKETPLACE_BROWSE' } })
    return o.id
  }

  test('prepara: una empresa con el POS conectado (un servicio y camisetas con existencias), otra con catálogo y pedidos pero SIN él, y otra ajena', async () => {
    con = await empresaCatalogo(sufijo, 'pos', { capacidad: true, pedidos: true, pos: true })
    sin = await empresaCatalogo(sufijo, 'possin', { capacidad: true, pedidos: true })
    otra = await empresaCatalogo(sufijo, 'posotra', { capacidad: true, pedidos: true, pos: true })
    await asegurarUsuario('posAdmin', con.id)
    await asegurarUsuario('posSin', sin.id)
    sucursalId = (await sucursalSembrada(con.id, 'Principal')).id
    await sucursalSembrada(sin.id, 'Principal')
    const sucursalOtra = (await sucursalSembrada(otra.id, 'Principal')).id
    const s = await itemSembrado(con.id, { name: SERVICIO, slug: `lavado-pos-${sufijo}`, variantes: [{ name: 'Default', sku: `POS-S-${sufijo}`, price: 250, porDefecto: true }] })
    const c = await itemSembrado(con.id, { name: CAMISETA, slug: `camiseta-pos-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `POS-C-${sufijo}`, price: 100, porDefecto: true }] })
    servicio = await varianteDe(s.id)
    camiseta = await varianteDe(c.id)
    await existenciasSembradas(con.id, camiseta, sucursalId, 10)
    tokenListo = `e2e-pos-token-${sufijo}-a`
    tokenAjeno = `e2e-pos-token-${sufijo}-b`
    pedidoListoId = await pedidoDelMarketplace(con, sucursalId, servicio, tokenListo, `MBG-POS-${sufijo}-1`.toUpperCase(), 250)
    const sOtra = await itemSembrado(otra.id, { name: SERVICIO, slug: `lavado-pos-otra-${sufijo}`, variantes: [{ name: 'Default', sku: `POS-O-${sufijo}`, price: 90, porDefecto: true }] })
    await pedidoDelMarketplace(otra, sucursalOtra, await varianteDe(sOtra.id), tokenAjeno, `MBG-POS-${sufijo}-2`.toUpperCase(), 90)
  })

  test('una empresa SIN el POS conectado abre su caja y no ve ninguno de los dos bloques', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posSin', BASE, sin.id)
    await abrirCaja(p)
    await expect(p.getByRole('heading', { name: 'Cobrar una orden' })).toBeVisible()
    await expect(p.getByRole('region', { name: 'Cobrar un pedido Membego' })).toHaveCount(0)
    await expect(p.getByRole('region', { name: 'Venta de mostrador' })).toHaveCount(0)
    await ctx.close()
  })

  test('el cajero abre la caja y vende en el mostrador: servicio + 2 camisetas, efectivo con cambio', async ({ browser }) => {
    test.setTimeout(180_000)
    const antes = await existencias()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await abrirCaja(p)
    const venta = p.getByRole('region', { name: 'Venta de mostrador' })
    await expect(venta).toBeVisible()

    await venta.getByLabel('Buscar producto o servicio').fill(SERVICIO)
    await venta.getByRole('button', { name: 'Buscar', exact: true }).click()
    await venta.getByRole('button', { name: `Agregar ${SERVICIO}` }).click()
    await venta.getByLabel('Buscar producto o servicio').fill(CAMISETA)
    await venta.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect(venta.getByText('10 disponibles')).toBeVisible()
    await venta.getByRole('button', { name: `Agregar ${CAMISETA}` }).click()
    await venta.getByRole('button', { name: `Una más de ${CAMISETA}` }).click()
    await expect(venta.getByTestId('pos-total')).toHaveText('RD$450.00') // 250 + 2 × 100

    // Una transferencia sin referencia no cobra.
    await venta.getByLabel('Cómo paga').selectOption('TRANSFERENCIA')
    await venta.getByRole('button', { name: /^Cobrar RD\$450\.00/ }).click()
    await expect(p.getByText(/Escribe el número de referencia/).first()).toBeVisible({ timeout: 20_000 })
    expect(await prismaDeArnes().membegoOrder.count({ where: { companyId: con.id, origin: 'POS' } })).toBe(0)

    // En efectivo, con lo recibido: el cambio se calcula.
    await venta.getByLabel('Cómo paga').selectOption('EFECTIVO')
    await venta.getByLabel(/Efectivo recibido/).fill('500')
    await expect(venta.getByText('Cambio: RD$50.00')).toBeVisible()
    await venta.getByRole('button', { name: /^Cobrar RD\$450\.00/ }).click()
    const hecha = p.getByTestId('pos-venta-hecha')
    await expect(hecha).toBeVisible({ timeout: 30_000 })
    await expect(hecha).toContainText('RD$450.00')
    await expect(hecha).toContainText('cambio RD$50.00')

    const ventas = await prismaDeArnes().membegoOrder.findMany({ where: { companyId: con.id, origin: 'POS' }, include: { lines: true, payment: true, commission: true } })
    expect(ventas).toHaveLength(1)
    expect(ventas[0].status).toBe('COMPLETED')
    expect(ventas[0].lines).toHaveLength(2)
    expect(ventas[0].payment?.method).toBe('CASH')
    expect(ventas[0].commission).toBeNull()
    expect(await existencias()).toBe(antes - 2)
    const cobro = await prismaDeArnes().transaction.findFirstOrThrow({ where: { companyId: con.id, tipo: 'SALE' } })
    expect(Number(cobro.monto)).toBe(450)
    expect(cobro.metodoCobro).toBe('EFECTIVO')

    // El cobro aparece en el turno, con su ticket.
    await p.reload()
    await expect(p.getByText('Últimos cobros del turno')).toBeVisible()
    await expect(p.getByText(cobro.codigo)).toBeVisible()
    await ctx.close()
  })

  test('el cajero cobra el pedido del marketplace con el QR del cliente: transferencia con referencia, comisión del 8 %', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await p.goto('/empleado/caja')
    const bloque = p.getByRole('region', { name: 'Cobrar un pedido Membego' })
    await expect(bloque).toBeVisible()

    // Un código inventado no encuentra nada; el QR de otra empresa tampoco.
    await bloque.getByLabel('Código del QR').fill('codigo-que-no-existe')
    await bloque.getByRole('button', { name: 'Buscar pedido' }).click()
    await expect(p.getByText(/no corresponde a ningún pedido/).first()).toBeVisible({ timeout: 20_000 })
    await bloque.getByLabel('Código del QR').fill(tokenAjeno)
    await bloque.getByRole('button', { name: 'Buscar pedido' }).click()
    await expect(p.getByText(/no corresponde a ningún pedido/).first()).toBeVisible()
    await expect(bloque.getByTestId('pos-pedido')).toHaveCount(0)

    // El QR bueno: se ve el pedido y que el cliente confirmó el monto.
    await bloque.getByLabel('Código del QR').fill(tokenListo)
    await bloque.getByRole('button', { name: 'Buscar pedido' }).click()
    const pedido = bloque.getByTestId('pos-pedido')
    await expect(pedido).toBeVisible({ timeout: 20_000 })
    await expect(pedido).toContainText('El cliente confirmó este monto')
    await expect(pedido).toContainText('RD$250.00')

    // Tarjeta sin autorización: no cobra y el pedido sigue como estaba.
    await pedido.getByLabel('Cómo paga').selectOption('TARJETA')
    await pedido.getByRole('button', { name: /^Cobrar RD\$250\.00/ }).click()
    await expect(p.getByText(/número de autorización/).first()).toBeVisible({ timeout: 20_000 })
    expect((await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoListoId } })).status).toBe('READY')

    await pedido.getByLabel('Cómo paga').selectOption('TRANSFERENCIA')
    await pedido.getByLabel('Referencia de la transferencia').fill('TRF-E2E-778899')
    await pedido.getByRole('button', { name: /^Cobrar RD\$250\.00/ }).click()
    const hecho = bloque.getByTestId('pos-cobro-hecho')
    await expect(hecho).toBeVisible({ timeout: 30_000 })
    await expect(hecho).toContainText('cobrado y entregado')

    const o = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoListoId }, include: { payment: true, commission: true } })
    expect(o.status).toBe('COMPLETED')
    expect(o.verificationLevel).toBe('PAYMENT_VERIFIED')
    expect(o.payment?.method).toBe('TRANSFER')
    expect(o.payment?.reference).toBe('TRF-E2E-778899')
    expect(o.commission?.type).toBe('PERCENTAGE')
    expect(o.commission?.amount.toFixed(2)).toBe('20.00')

    // El mismo QR no se cobra otra vez.
    await bloque.getByRole('button', { name: 'Cobrar otro' }).click()
    await bloque.getByLabel('Código del QR').fill(tokenListo)
    await bloque.getByRole('button', { name: 'Buscar pedido' }).click()
    await expect(p.getByText(/no corresponde a ningún pedido/).first()).toBeVisible({ timeout: 20_000 })
    expect(await prismaDeArnes().transaction.count({ where: { companyId: con.id, tipo: 'SALE', snapshot: { path: ['ordenId'], equals: pedidoListoId } } })).toBe(1)
    await ctx.close()
  })

  test('un pedido que YA está pagado por transferencia no se cobra otra vez: la caja lo entrega sin cobrar y la evidencia queda intacta (auditoría F5–F9, A1)', async ({ browser }) => {
    test.setTimeout(180_000)
    const prisma = prismaDeArnes()
    const tokenPagado = `e2e-pos-token-${sufijo}-pagado`
    const pagadoId = await pedidoDelMarketplace(con, sucursalId, servicio, tokenPagado, `MBG-POS-${sufijo}-3`.toUpperCase(), 250)
    await prisma.paymentEvidence.create({ data: { companyId: con.id, orderId: pagadoId, method: 'TRANSFER', amount: 250, reference: 'TRF-PREVIA-E2E', recordedAt: new Date() } })
    const cobrosAntes = await prisma.transaction.count({ where: { companyId: con.id, tipo: 'SALE' } })

    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await p.goto('/empleado/caja')
    const bloque = p.getByRole('region', { name: 'Cobrar un pedido Membego' })
    await bloque.getByLabel('Código del QR').fill(tokenPagado)
    await bloque.getByRole('button', { name: 'Buscar pedido' }).click()
    const pedido = bloque.getByTestId('pos-pedido')
    await expect(pedido).toBeVisible({ timeout: 20_000 })
    // Dice que ya está pagado y NO ofrece cobrarlo (ni elegir cómo paga).
    await expect(bloque.getByTestId('pos-ya-pagado')).toContainText('ya está pagado')
    await expect(bloque.getByTestId('pos-ya-pagado')).toContainText('TRF-PREVIA-E2E')
    await expect(pedido.getByLabel('Cómo paga')).toHaveCount(0)
    await expect(pedido.getByRole('button', { name: /^Cobrar RD\$250\.00/ })).toHaveCount(0)

    await pedido.getByRole('button', { name: 'Entregar sin cobrar' }).click()
    const hecho = bloque.getByTestId('pos-cobro-hecho')
    await expect(hecho).toBeVisible({ timeout: 30_000 })
    await expect(hecho).toContainText('entregado (ya estaba pagado)')
    await expect(hecho).toContainText('no entró dinero a la caja')

    const o = await prisma.membegoOrder.findUniqueOrThrow({ where: { id: pagadoId }, include: { payment: true, commission: true } })
    expect(o.status).toBe('COMPLETED')
    expect(o.payment?.method, 'la evidencia sigue siendo la transferencia').toBe('TRANSFER')
    expect(o.payment?.reference).toBe('TRF-PREVIA-E2E')
    expect(o.verificationLevel).toBe('PAYMENT_VERIFIED')
    expect(o.commission?.type).toBe('PERCENTAGE')
    expect(await prisma.transaction.count({ where: { companyId: con.id, tipo: 'SALE' } }), 'ningún cobro nuevo en la caja').toBe(cobrosAntes)
    await ctx.close()
  })

  test('con dos cajas abiertas la pantalla deja elegir con cuál se trabaja; con una sola no hay selector (auditoría F5–F9, M5)', async ({ browser }) => {
    test.setTimeout(120_000)
    const prisma = prismaDeArnes()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await p.goto('/empleado/caja')
    await expect(p.getByText('Caja abierta')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('caja-selector')).toHaveCount(0)

    const norte = await sucursalSembrada(con.id, 'Norte')
    const abridor = await prisma.user.findFirstOrThrow({ where: { companyId: con.id }, select: { id: true } })
    await prisma.cajaSesion.create({ data: { companyId: con.id, sucursalId: norte.id, abiertaPorId: abridor.id, estado: 'ABIERTA', balanceInicial: 0 } })
    await p.goto('/empleado/caja')
    const selector = p.getByTestId('caja-selector')
    await expect(selector).toBeVisible({ timeout: 20_000 })
    await expect(selector).toContainText('2 cajas abiertas')
    // Elegir una caja la deja marcada y el encabezado cambia a esa sucursal.
    await selector.getByRole('link', { name: 'Principal' }).click()
    await expect(p.getByRole('heading', { name: 'Principal' })).toBeVisible()
    await expect(selector.getByRole('link', { name: 'Principal' })).toHaveAttribute('aria-current', 'true')
    await selector.getByRole('link', { name: 'Norte' }).click()
    await expect(p.getByRole('heading', { name: 'Norte' })).toBeVisible()
    await ctx.close()
  })

  test('la empresa lo ve en sus pedidos: la venta de mostrador como «Caja» y el pedido cobrado como completado', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await p.goto('/admin/pedidos-membego?estado=COMPLETED')
    await expect(p.getByRole('list', { name: 'Pedidos' }).getByRole('link')).toHaveCount(3)
    await expect(p.getByText('Caja').first()).toBeVisible()
    await ctx.close()
  })
})
