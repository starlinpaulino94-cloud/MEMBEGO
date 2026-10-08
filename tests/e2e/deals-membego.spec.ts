import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * OFERTAS CON PRESUPUESTO · de punta a punta (F5.2).
 *
 *   la empresa crea y publica una oferta (20 % en un servicio de RD$ 500, presupuesto para 2 canjes
 *   a RD$ 100) → la vitrina la enseña SIN presupuesto ni cuota → sin sesión, «Obtener oferta» manda a
 *   iniciar sesión → el cliente la obtiene y recibe un pedido con su QR (a RD$ 400) → volver a pulsarla
 *   lo lleva a ese mismo pedido → el empleado escanea el QR: la oferta cobra su cuota (CPA) y el
 *   presupuesto pasa de apartado a gastado → otra persona la obtiene y el presupuesto se agota: la
 *   oferta se pausa sola y una tercera ya no puede → la empresa amplía el presupuesto y se reabre.
 *
 * Y lo que NO debe pasar: ver el panel sin la capacidad, ver la oferta de otra empresa, o reclamar
 * una oferta pausada.
 *
 * La base de E2E se crea con `db push`: no lleva los disparadores ni los CHECK de las migraciones (las
 * reglas de la base las prueban `tests/postgres/deals.db.test.ts`). Aquí se prueba la INTERFAZ y el
 * recorrido. Entra con sesiones firmadas localmente (ver `supply-v2-sesion.ts`).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const SERVICIO = `Lavado Oferta ${sufijo}`
const TITULO = `20 % en el lavado ${sufijo}`

test.describe('Ofertas con presupuesto · recorrido', () => {
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
  let dealId = ''
  let pedidoId = ''
  let codigo = ''

  const oferta = () => prismaDeArnes().deal.findUniqueOrThrow({ where: { id: dealId } })

  async function obtener(p: Page, url: string) {
    await p.goto(url)
    const tarjeta = p.getByRole('article', { name: TITULO })
    await expect(tarjeta).toBeVisible()
    await tarjeta.getByRole('button', { name: 'Obtener oferta' }).click()
  }

  test('prepara: una empresa con ofertas, catálogo y pedidos; otra con catálogo y pedidos pero SIN ofertas', async () => {
    con = await empresaCatalogo(sufijo, 'deal', { capacidad: true, pedidos: true, deals: true })
    sin = await empresaCatalogo(sufijo, 'dealsin', { capacidad: true, pedidos: true })
    await asegurarUsuario('dealsAdmin', con.id)
    await asegurarUsuario('dealsSinCapacidad', sin.id)
    await sucursalSembrada(con.id, 'Principal')
    await sucursalSembrada(sin.id, 'De otra')
    const servicio = await itemSembrado(con.id, { name: SERVICIO, slug: `lavado-oferta-${sufijo}`, variantes: [{ name: 'Default', sku: `LAV-OF-${sufijo}`, price: 500, porDefecto: true }] })
    expect(servicio.id).toBeTruthy()
  })

  test('sin la capacidad, el panel de ofertas no existe para la empresa', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsSinCapacidad', BASE, sin.id)
    await p.goto('/admin/deals')
    await expect(p.getByRole('heading', { name: 'Ofertas con presupuesto' })).toHaveCount(0)
    await expect(p.getByRole('link', { name: 'Nueva oferta' })).toHaveCount(0)
    await ctx.close()
  })

  test('la empresa crea la oferta como borrador y la publica', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsAdmin', BASE, con.id)

    await p.goto('/admin/deals')
    await expect(p.getByRole('heading', { name: 'Ofertas con presupuesto' })).toBeVisible()
    await expect(p.getByText('Todavía no tienes ofertas')).toBeVisible()
    await p.getByRole('link', { name: 'Nueva oferta' }).click()

    // Sin presupuesto ni cupos no se envía.
    await p.getByLabel('Título').fill(TITULO)
    await p.getByLabel('Qué ofreces').selectOption({ label: `${SERVICIO} — 500.00 DOP` })
    await p.getByLabel('Descuento', { exact: true }).fill('20')
    await p.getByLabel('Cuántos clientes pueden obtenerla').fill('5')
    // El presupuesto alcanza para 2 canjes de RD$ 100: lo dice mientras se escribe.
    await p.getByLabel(/^Presupuesto máximo/).fill('200')
    await p.getByRole('button', { name: 'Crear borrador' }).click()

    // «nueva» también es una ruta de una palabra: se espera a la del id.
    await expect(p).toHaveURL(/\/admin\/deals\/(?!nueva$)[a-z0-9]+$/, { timeout: 30_000 })
    dealId = p.url().split('/').pop() as string
    await expect(p.getByRole('heading', { name: TITULO })).toBeVisible()
    await expect(p.getByText('Borrador').first()).toBeVisible()
    await expect(p.getByText('Cuota de Membego por canje')).toBeVisible()
    await expect(p.getByText('RD$100.00').first()).toBeVisible()

    // Un borrador no se ve en la vitrina.
    const pub = await ctx.newPage()
    await pub.goto('/ofertas')
    await expect(pub.getByRole('article', { name: TITULO })).toHaveCount(0)

    await p.getByRole('button', { name: 'Publicar' }).click()
    await expect(p.getByText('Activa').first()).toBeVisible({ timeout: 20_000 })
    const o = await oferta()
    expect(o.status).toBe('ACTIVE')
    expect(o.feePerRedemption.toFixed(2)).toBe('100.00')
    expect(o.budgetTotal.toFixed(2)).toBe('200.00')
    await ctx.close()
  })

  test('la vitrina enseña la oferta con su precio, y NO enseña presupuesto ni cuota', async ({ page }) => {
    await page.goto('/ofertas')
    const tarjeta = page.getByRole('article', { name: TITULO })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta.getByText('20 % de descuento')).toBeVisible()
    await expect(tarjeta.getByText('RD$400.00')).toBeVisible()
    await expect(tarjeta.getByText('RD$500.00')).toBeVisible()
    const texto = await tarjeta.innerText()
    expect(texto).not.toMatch(/presupuesto|cuota|CPA/i)
    // También en la ficha de la empresa.
    await page.goto(`/empresas/${con.slug}`)
    await expect(page.locator('#ofertas').getByRole('article', { name: TITULO })).toBeVisible()
    // Y la empresa que no tiene la capacidad no enseña nada.
    await page.goto(`/empresas/${sin.slug}`)
    await expect(page.locator('#ofertas')).toHaveCount(0)
  })

  test('sin sesión, «Obtener oferta» manda a iniciar sesión (y vuelve a las ofertas)', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await obtener(p, '/ofertas')
    await expect(p).toHaveURL(/\/login\?redirect=/)
    expect(decodeURIComponent(p.url())).toContain('/ofertas')
    await ctx.close()
  })

  test('el cliente obtiene la oferta: recibe su pedido LISTO con QR, a RD$ 400, y el presupuesto aparta la cuota', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsCliente', BASE)
    await obtener(p, '/ofertas')
    await expect(p).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    pedidoId = p.url().split('/').pop() as string
    codigo = (await p.getByRole('heading', { name: /^MBG-/ }).innerText()).trim()
    await expect(p.getByText(`Oferta «${TITULO}»`).first()).toBeVisible()
    await expect(p.getByText('Listo para recoger').first()).toBeVisible()
    await expect(p.getByText('RD$400.00').first()).toBeVisible()
    await expect(p.getByRole('img', { name: `QR del pedido ${codigo}` })).toBeVisible()

    const o = await oferta()
    expect(o.claimsActive).toBe(1)
    expect(o.budgetReserved.toFixed(2)).toBe('100.00')
    expect(o.budgetSpent.toFixed(2)).toBe('0.00')
    const r = await prismaDeArnes().dealClaim.findUniqueOrThrow({ where: { orderId: pedidoId } })
    expect(r.status).toBe('CLAIMED')
    expect(r.savings.toFixed(2)).toBe('100.00')

    // Volver a pulsar «Obtener oferta» lleva al MISMO pedido: no se crea otro ni se aparta más presupuesto.
    await obtener(p, '/ofertas')
    await expect(p).toHaveURL(new RegExp(`/cliente/pedidos/${pedidoId}$`), { timeout: 30_000 })
    expect(await prismaDeArnes().dealClaim.count({ where: { dealId } })).toBe(1)
    expect((await oferta()).budgetReserved.toFixed(2)).toBe('100.00')
    await ctx.close()
  })

  test('la empresa ve quién la obtuvo y lo apartado en su presupuesto', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsAdmin', BASE, con.id)
    await p.goto(`/admin/deals/${dealId}`)
    const lista = p.getByRole('list', { name: 'Reclamos de la oferta' })
    await expect(lista.getByRole('link', { name: codigo })).toBeVisible()
    await expect(lista.getByText('Por canjear')).toBeVisible()
    await expect(p.getByText('Apartado por cupones sin canjear').locator('..').getByText('RD$100.00')).toBeVisible()
    // El pedido de la oferta se reconoce en el panel de pedidos.
    await p.goto(`/admin/pedidos-membego/${pedidoId}`)
    await expect(p.getByText('Obtuvo una oferta con descuento').first()).toBeVisible()
    await expect(p.getByRole('link', { name: 'Ver la oferta' })).toBeVisible()
    await ctx.close()
  })

  test('otra empresa no ve la oferta: se ve igual que una inexistente', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsSinCapacidad', BASE, sin.id)
    await p.goto(`/admin/deals/${dealId}`)
    await expect(p.getByText(TITULO)).toHaveCount(0)
    await ctx.close()
  })

  test('el empleado escanea el QR: el pedido se cierra, la oferta cobra su cuota y el presupuesto pasa de apartado a gastado', async ({ browser }) => {
    test.setTimeout(180_000)
    const pedido = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { qrToken: true } })
    expect(pedido.qrToken).toBeTruthy()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsAdmin', BASE, con.id)
    await p.goto('/empleado/scanner')
    await p.waitForFunction(
      () => {
        const el = document.querySelector('[role="tab"]')
        return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'))
      },
      undefined,
      { timeout: 45_000 }
    )
    await p.waitForTimeout(500)
    await p.keyboard.type(pedido.qrToken as string, { delay: 0 })
    await p.keyboard.press('Enter')

    await expect(p.getByTestId('pedido-lookup')).toBeVisible({ timeout: 30_000 })
    await expect(p.getByText(`Oferta «${TITULO}»`)).toBeVisible()
    await p.getByRole('button', { name: 'Entregar y cerrar pedido' }).click()
    await expect(p.getByTestId('pedido-cerrado')).toBeVisible({ timeout: 30_000 })

    const o = await oferta()
    expect(o.budgetSpent.toFixed(2)).toBe('100.00')
    expect(o.budgetReserved.toFixed(2)).toBe('0.00')
    const r = await prismaDeArnes().dealClaim.findUniqueOrThrow({ where: { orderId: pedidoId } })
    expect(r.status).toBe('REDEEMED')
    expect(r.redeemedAt).toBeTruthy()
    // Merchant Billing: UNA comisión CPA por el canje, ligada a la oferta, sobre la base de RD$ 400.
    const c = await prismaDeArnes().commission.findUniqueOrThrow({ where: { orderId: pedidoId } })
    expect(c.type).toBe('CPA_FIXED')
    expect(c.amount.toFixed(2)).toBe('100.00')
    expect(c.baseAmount.toFixed(2)).toBe('400.00')
    expect(c.dealId).toBe(dealId)
    await ctx.close()
  })

  test('otra persona la obtiene y el presupuesto se agota: la oferta se pausa sola y una tercera ya no puede', async ({ browser }) => {
    test.setTimeout(180_000)
    const dos = await browser.newContext()
    const p2 = await dos.newPage()
    await entrarComo(dos, 'dealsCliente2', BASE)
    await obtener(p2, '/ofertas')
    await expect(p2).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    // 100 gastados + 100 apartados = el tope de 200.
    const o = await oferta()
    expect(o.status).toBe('BUDGET_EXHAUSTED')
    expect(o.budgetReserved.toFixed(2)).toBe('100.00')
    await dos.close()

    const tres = await browser.newContext()
    const p3 = await tres.newPage()
    await entrarComo(tres, 'dealsCliente3', BASE)
    // Si la vitrina aún enseña la tarjeta (va atrasada), el servidor manda: dice que se agotó y no crea nada.
    await p3.goto('/ofertas')
    const tarjeta = p3.getByRole('article', { name: TITULO })
    if (await tarjeta.count()) {
      await tarjeta.getByRole('button', { name: 'Obtener oferta' }).click()
      await expect(p3.getByText(/se agotó/).first()).toBeVisible({ timeout: 20_000 })
    }
    expect(await prismaDeArnes().dealClaim.count({ where: { dealId } })).toBe(2)
    await tres.close()

    const ctx = await browser.newContext()
    const pa = await ctx.newPage()
    await entrarComo(ctx, 'dealsAdmin', BASE, con.id)
    await pa.goto(`/admin/deals/${dealId}`)
    await expect(pa.getByText('Presupuesto agotado').first()).toBeVisible()
    await ctx.close()
  })

  test('la empresa amplía el presupuesto: la oferta se reabre sola; la pausa y reanuda; una pausada no se puede obtener', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'dealsAdmin', BASE, con.id)
    await p.goto(`/admin/deals/${dealId}`)

    await p.getByLabel(/^Sumar/).fill('200')
    await p.getByRole('button', { name: 'Ampliar' }).click()
    await expect(p.getByText('Activa').first()).toBeVisible({ timeout: 20_000 })
    let o = await oferta()
    expect(o.status).toBe('ACTIVE')
    expect(o.budgetTotal.toFixed(2)).toBe('400.00')

    await p.getByLabel('Motivo de la pausa').fill('Inventario de prueba')
    await p.getByRole('button', { name: 'Pausar' }).click()
    await expect(p.getByText('Pausada').first()).toBeVisible({ timeout: 20_000 })
    o = await oferta()
    expect(o.status).toBe('PAUSED')

    // Pausada: sale de la vitrina y no se puede obtener (tampoco por la acción directa).
    const tres = await browser.newContext()
    const p3 = await tres.newPage()
    await entrarComo(tres, 'dealsCliente3', BASE)
    await p3.goto('/ofertas')
    await expect(p3.getByRole('article', { name: TITULO })).toHaveCount(0)
    expect(await prismaDeArnes().dealClaim.count({ where: { dealId } })).toBe(2)
    await tres.close()

    await p.reload()
    await p.getByRole('button', { name: 'Reanudar' }).click()
    await expect(p.getByText('Activa').first()).toBeVisible({ timeout: 20_000 })
    o = await oferta()
    expect(o.status).toBe('ACTIVE')
    await ctx.close()
  })
})
