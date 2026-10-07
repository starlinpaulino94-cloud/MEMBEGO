import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * CHECKOUT DEL MARKETPLACE · de punta a punta (F8).
 *
 *   sin cuenta: agregar productos de dos negocios al carrito → ver el carrito (un bloque por negocio, precios de hoy)
 *   → cambiar cantidades y quitar → pagar pide iniciar sesión (y el carrito sigue ahí)
 *   con cuenta: pagar el carrito de un negocio por transferencia → pedido con sus renglones, existencias apartadas,
 *   instrucciones de transferencia con el código como referencia → el negocio lo acepta, lo marca listo y el empleado lo
 *   cierra con el QR (es un pedido de siempre)
 *
 * Y lo que NO debe pasar: pagar más de lo que hay, ofrecer transferencia a quien no tiene cuentas, pagar en un negocio
 * que no recibe pedidos.
 *
 * La base de E2E se crea con `db push`: sin los disparadores de las migraciones (las reglas de la base las prueban
 * `tests/postgres/checkout.db.test.ts` y compañía). Aquí se prueba la INTERFAZ y el recorrido.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `Gorra Carrito ${sufijo}`
const SERVICIO = `Pulido Carrito ${sufijo}`
const SERVICIO_B = `Cera Carrito ${sufijo}`

test.describe('Checkout del marketplace · recorrido', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let a: EmpresaCatalogo
  let b: EmpresaCatalogo
  let sucursalA = ''
  let varianteProducto = ''
  let urlProducto = ''
  let urlServicio = ''
  let urlServicioB = ''
  let pedidoId = ''
  let codigo = ''

  const existencias = async () => {
    const n = await prismaDeArnes().inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: varianteProducto, locationId: sucursalA } } })
    return { onHand: n.onHand, reserved: n.reserved }
  }
  const contador = (p: Page) => p.locator('[data-testid=carrito-contador]:visible')
  const bloque = (p: Page, slug: string) => p.getByTestId(`carrito-${slug}`)

  async function agregar(p: Page, url: string, cantidad: string) {
    await p.goto(url)
    const form = p.getByRole('form', { name: 'Agregar al carrito' })
    await expect(form).toBeVisible()
    await form.getByLabel('Cantidad').fill(cantidad)
    await form.getByRole('button', { name: 'Agregar al carrito' }).click()
    await expect(p.getByText('Agregado al carrito.').first()).toBeVisible()
  }

  async function prepararLector(p: Page) {
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
  }

  test('prepara: un negocio con cuentas de transferencia, otro sin ellas, productos con stock y servicios', async () => {
    a = await empresaCatalogo(sufijo, 'carr', { capacidad: true, pedidos: true })
    b = await empresaCatalogo(sufijo, 'carrb', { capacidad: true, pedidos: true })
    const db = prismaDeArnes()
    // La transferencia se enciende por override ANTES de la primera petición (el resolutor la cachea por empresa).
    for (const e of [a, b]) {
      const c = await db.company.findUniqueOrThrow({ where: { id: e.id }, select: { capacidades: true } })
      const previos = ((c.capacidades as { overrides?: Record<string, boolean> } | null)?.overrides ?? {}) as Record<string, boolean>
      await db.company.update({ where: { id: e.id }, data: { capacidades: { overrides: { ...previos, PAGO_TRANSFERENCIA: true } } } })
    }
    await db.metodoPago.create({ data: { companyId: a.id, tipo: 'TRANSFERENCIA', nombre: 'Banco Prueba', titular: 'Taller Prueba SRL', numeroCuenta: '000111222', tipoCuenta: 'Corriente', instrucciones: 'Avisa por WhatsApp al transferir', activo: true } })
    await asegurarUsuario('carritoAdmin', a.id)
    sucursalA = (await sucursalSembrada(a.id, 'Principal')).id
    await sucursalSembrada(b.id, 'De B')
    const producto = await itemSembrado(a.id, { name: PRODUCTO, slug: `gorra-carr-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `CARR-${sufijo}`, price: 250, porDefecto: true }] })
    varianteProducto = await varianteDe(producto.id)
    await existenciasSembradas(a.id, varianteProducto, sucursalA, 10)
    await itemSembrado(a.id, { name: SERVICIO, slug: `pulido-carr-${sufijo}`, variantes: [{ name: 'Default', sku: `PUL-CARR-${sufijo}`, price: 300, porDefecto: true }] })
    await itemSembrado(b.id, { name: SERVICIO_B, slug: `cera-carr-${sufijo}`, variantes: [{ name: 'Default', sku: `CERA-CARR-${sufijo}`, price: 120, porDefecto: true }] })
    urlProducto = `/empresas/${a.slug}/catalogo/gorra-carr-${sufijo}`
    urlServicio = `/empresas/${a.slug}/catalogo/pulido-carr-${sufijo}`
    urlServicioB = `/empresas/${b.slug}/catalogo/cera-carr-${sufijo}`
  })

  let ctxAnonimo: Awaited<ReturnType<import('@playwright/test').Browser['newContext']>>
  let pAnonimo: Page

  test('sin cuenta: agregar de dos negocios llena el carrito y el contador del encabezado lo cuenta', async ({ browser }) => {
    ctxAnonimo = await browser.newContext()
    pAnonimo = await ctxAnonimo.newPage()
    await expect(async () => {
      await pAnonimo.goto('/carrito')
      await expect(pAnonimo.getByText('Tu carrito está vacío')).toBeVisible()
    }).toPass()
    await agregar(pAnonimo, urlProducto, '2')
    await expect(contador(pAnonimo)).toHaveText('2')
    await agregar(pAnonimo, urlServicio, '1')
    await expect(contador(pAnonimo)).toHaveText('3')
    await agregar(pAnonimo, urlServicioB, '1')
    await expect(contador(pAnonimo)).toHaveText('4')
  })

  test('el carrito tiene un bloque por negocio con los precios de hoy, y sobrevive a recargar', async () => {
    const p = pAnonimo
    await p.goto('/carrito')
    await expect(p.getByText(/Cada negocio atiende su propio pedido/)).toBeVisible()
    const bA = bloque(p, a.slug)
    const bB = bloque(p, b.slug)
    await expect(bA.getByTestId('carrito-renglon')).toHaveCount(2)
    await expect(bA.getByText(PRODUCTO)).toBeVisible()
    await expect(bA.getByText('RD$800.00')).toBeVisible() // 2 × 250 + 300
    await expect(bB.getByText('RD$120.00').first()).toBeVisible()
    await p.reload()
    await expect(bloque(p, a.slug).getByTestId('carrito-renglon')).toHaveCount(2)
  })

  test('cambiar cantidades recalcula con el servidor; quitar un negocio lo saca del carrito', async () => {
    const p = pAnonimo
    const bA = bloque(p, a.slug)
    await bA.getByRole('button', { name: `Una más de ${SERVICIO}` }).click()
    await expect(bA.getByText('RD$1,100.00')).toBeVisible()
    await bA.getByRole('button', { name: `Una menos de ${SERVICIO}` }).click()
    await expect(bA.getByText('RD$800.00')).toBeVisible()
    await bloque(p, b.slug).getByRole('button', { name: 'Vaciar' }).click()
    await expect(bloque(p, b.slug)).toHaveCount(0)
    await expect(contador(p)).toHaveText('3')
  })

  test('sin cuenta, pagar manda a iniciar sesión y el carrito sigue intacto', async () => {
    const p = pAnonimo
    await p.getByRole('link', { name: 'Continuar al pago' }).click()
    await expect(p).toHaveURL(new RegExp(`/carrito/pagar/${a.slug}$`))
    await expect(p.getByTestId('pago-total')).toHaveText('RD$800.00')
    await p.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(p).toHaveURL(/\/login\?redirect=/)
    expect(decodeURIComponent(p.url())).toContain(`/carrito/pagar/${a.slug}`)
    await p.goto('/carrito')
    await expect(bloque(p, a.slug).getByTestId('carrito-renglon')).toHaveCount(2)
    await ctxAnonimo.close()
  })

  test('pedir más de lo que hay se ve ANTES de pagar: aviso por renglón y el botón no deja enviar', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'carritoCliente', BASE)
    await agregar(p, urlProducto, '50')
    await p.goto(`/carrito/pagar/${a.slug}`)
    await expect(p.getByText(/^Solo quedan \d+ en esta sucursal\.$/)).toBeVisible()
    await expect(p.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled()
    // Con el carrito corregido sí se puede.
    await p.goto('/carrito')
    await bloque(p, a.slug).getByRole('button', { name: 'Vaciar' }).click()
    await ctx.close()
  })

  test('un negocio sin cuentas no ofrece transferencia, y uno que no existe no recibe pedidos', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await agregar(p, urlServicioB, '1')
    await p.goto(`/carrito/pagar/${b.slug}`)
    await expect(p.getByLabel('Cómo vas a pagar')).toBeVisible()
    await expect(p.getByLabel('Cómo vas a pagar').locator('option')).toHaveText(['Pago al recoger en el negocio'])
    await p.goto('/carrito/pagar/negocio-que-no-existe')
    await expect(p.getByText(/no recibe pedidos por ahora/)).toBeVisible()
    await ctx.close()
  })

  test('con cuenta: paga el carrito del negocio por transferencia y llega a su pedido con las instrucciones', async ({ browser }) => {
    test.setTimeout(120_000)
    const antes = await existencias()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'carritoCliente', BASE)
    await agregar(p, urlProducto, '2')
    await agregar(p, urlServicio, '1')
    await p.goto(`/carrito/pagar/${a.slug}`)
    await expect(p.getByTestId('pago-renglon')).toHaveCount(2)
    await expect(p.getByTestId('pago-total')).toHaveText('RD$800.00')
    await p.getByLabel('Cómo vas a pagar').selectOption({ label: 'Pago por transferencia bancaria' })
    await p.getByLabel(/Nota para el negocio/).fill('paso a las 5')
    await p.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(p).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    pedidoId = p.url().split('/').pop() as string
    codigo = (await p.getByRole('heading', { name: /^MBG-PED-/ }).innerText()).trim()

    await expect(p.getByText('Esperando a la empresa').first()).toBeVisible()
    await expect(p.getByText(PRODUCTO).first()).toBeVisible()
    await expect(p.getByText(SERVICIO).first()).toBeVisible()
    await expect(p.getByText('RD$800.00').first()).toBeVisible()
    await expect(p.getByText('Pagará por transferencia. paso a las 5')).toBeVisible()
    const instrucciones = p.getByTestId('instrucciones-transferencia')
    await expect(instrucciones).toBeVisible()
    await expect(instrucciones.getByText(codigo)).toBeVisible()
    await expect(instrucciones.getByText('000111222')).toBeVisible()
    await expect(instrucciones.getByText('Taller Prueba SRL')).toBeVisible()
    await expect(instrucciones.getByText('Avisa por WhatsApp al transferir')).toBeVisible()

    // Aparta, no vende; y el carrito de ese negocio quedó vacío.
    const despues = await existencias()
    expect(despues.onHand).toBe(antes.onHand)
    expect(despues.reserved).toBe(antes.reserved + 2)
    const pedido = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, include: { lines: true, attribution: true, payment: true } })
    expect(pedido.origin).toBe('MARKETPLACE')
    expect(pedido.lines).toHaveLength(2)
    expect(pedido.paymentMethod).toBe('TRANSFER')
    expect(pedido.payment).toBeNull()
    expect(pedido.attribution?.channel).toBe('MARKETPLACE_BROWSE')
    await p.goto('/carrito')
    await expect(bloque(p, a.slug)).toHaveCount(0)
    await ctx.close()
  })

  test('el negocio lo acepta y lo marca listo; el cliente ve su QR y deja de ver las instrucciones una vez pagado', async ({ browser }) => {
    test.setTimeout(180_000)
    const admin = await browser.newContext()
    const pa = await admin.newPage()
    await entrarComo(admin, 'carritoAdmin', BASE, a.id)
    await pa.goto(`/admin/pedidos-membego/${pedidoId}`)
    await expect(pa.getByRole('heading', { name: codigo })).toBeVisible()
    await expect(pa.getByText(PRODUCTO).first()).toBeVisible()
    await expect(pa.getByText('Pagará por transferencia. paso a las 5').first()).toBeVisible()
    await pa.getByRole('button', { name: 'Aceptar pedido' }).click()
    await expect(pa.getByText('En preparación').first()).toBeVisible({ timeout: 20_000 })
    await pa.getByRole('button', { name: 'Marcar listo' }).click()
    await expect(pa.getByText('Listo para recoger').first()).toBeVisible({ timeout: 20_000 })

    const cliente = await browser.newContext()
    const pc = await cliente.newPage()
    await entrarComo(cliente, 'carritoCliente', BASE)
    await pc.goto(`/cliente/pedidos/${pedidoId}`)
    await expect(pc.getByRole('img', { name: `QR del pedido ${codigo}` })).toBeVisible()
    await expect(pc.getByTestId('instrucciones-transferencia')).toBeVisible() // aún sin pago registrado

    // El negocio ve la transferencia en su banco y la registra con su referencia.
    const pago = pa.getByRole('form', { name: 'Registrar el pago del pedido' })
    await pago.getByLabel('Método').selectOption({ label: 'Transferencia' })
    await pago.getByLabel(/^Monto cobrado/).fill('800')
    await pago.getByLabel('Referencia').fill('TRF-CARRITO-1')
    await pago.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(pa.getByText('TRF-CARRITO-1')).toBeVisible({ timeout: 20_000 })
    await pc.reload()
    await expect(pc.getByTestId('instrucciones-transferencia')).toHaveCount(0)
    await admin.close()
    await cliente.close()
  })

  test('el empleado escanea el QR y entrega: el pedido del carrito se cierra y las existencias apartadas se venden', async ({ browser }) => {
    test.setTimeout(180_000)
    const antes = await existencias()
    const pedido = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { qrToken: true } })
    expect(pedido.qrToken).toBeTruthy()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'carritoAdmin', BASE, a.id)
    await prepararLector(p)
    await p.keyboard.type(pedido.qrToken as string, { delay: 0 })
    await p.keyboard.press('Enter')
    await expect(p.getByTestId('pedido-lookup')).toBeVisible({ timeout: 30_000 })
    await expect(p.getByText(codigo)).toBeVisible()
    await p.getByRole('button', { name: 'Entregar y cerrar pedido' }).click()
    await expect(p.getByTestId('pedido-cerrado')).toBeVisible({ timeout: 30_000 })

    const cerrado = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { status: true } })
    expect(cerrado.status).toBe('COMPLETED')
    const despues = await existencias()
    expect(despues.onHand).toBe(antes.onHand - 2)
    expect(despues.reserved).toBe(antes.reserved - 2)
    await ctx.close()
  })
})
