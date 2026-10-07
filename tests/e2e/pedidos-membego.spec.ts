import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * PEDIDOS MEMBEGO · de punta a punta (F3.2).
 *
 *   el cliente pide desde la vitrina → la empresa lo ve, lo acepta, ajusta el
 *   monto y lo marca listo → el cliente confirma el monto nuevo y ve su QR → el
 *   empleado lo escanea y lo cierra → el stock baja y el nivel queda registrado
 *
 * Y lo que NO debe pasar: pedir sin sesión, pedir a una empresa sin pedidos
 * encendidos, que otra empresa vea el pedido, o cancelar uno que ya se atiende.
 *
 * La base de E2E se crea con `db push`: no lleva los disparadores ni los CHECK
 * de las migraciones (las reglas de la base las prueban `tests/postgres/orders.
 * db.test.ts`). Aquí se prueba la INTERFAZ y el recorrido.
 *
 * Entra con sesiones firmadas localmente (ver `supply-v2-sesion.ts`).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `Camiseta Pedido ${sufijo}`
const SERVICIO = `Lavado Pedido ${sufijo}`

test.describe('Pedidos Membego · recorrido', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let sinPedidos: EmpresaCatalogo
  let sucursalId = ''
  let variante = ''
  let urlProducto = ''
  let urlServicio = ''
  let urlSinPedidos = ''
  let pedidoId = ''
  let codigo = ''

  const existencias = async () => {
    const n = await prismaDeArnes().inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: variante, locationId: sucursalId } } })
    return { onHand: n.onHand, reserved: n.reserved }
  }

  /**
   * Espera a que el escáner esté HIDRATADO. Tanto «Lector listo» como el selector de modo salen en el HTML del
   * servidor, ANTES de que React monte la captura global de teclas: teclear entonces pierde las primeras teclas de la
   * ráfaga y el código llega incompleto («Código QR no encontrado»). React marca cada nodo hidratado con una clave
   * `__reactProps$…`, que es la señal fiable (el foco o el texto no lo son).
   */
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
    // Los efectos que registran la captura corren justo después de hidratar.
    await p.waitForTimeout(500)
  }

  async function pedir(p: Page, url: string, cantidad: string, nota?: string) {
    await p.goto(url)
    const form = p.getByRole('form', { name: 'Hacer un pedido' })
    await expect(form).toBeVisible()
    await form.getByLabel('Cantidad').fill(cantidad)
    if (nota) await form.getByLabel(/Nota para la empresa/).fill(nota)
    await form.getByRole('button', { name: 'Enviar pedido' }).click()
  }

  test('prepara: una empresa que recibe pedidos (producto con stock y un servicio), otra con catálogo pero sin pedidos', async () => {
    con = await empresaCatalogo(sufijo, 'ped', { capacidad: true, pedidos: true })
    sinPedidos = await empresaCatalogo(sufijo, 'pedsin', { capacidad: true })
    // El administrador existe ANTES del primer pedido: es a quien se le avisa.
    await asegurarUsuario('pedidosAdmin', con.id)
    const sucursal = await sucursalSembrada(con.id, 'Principal')
    sucursalId = sucursal.id
    await sucursalSembrada(sinPedidos.id, 'De otra')
    const producto = await itemSembrado(con.id, { name: PRODUCTO, slug: `camiseta-ped-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `PED-${sufijo}`, price: 250, porDefecto: true }] })
    variante = await varianteDe(producto.id)
    await existenciasSembradas(con.id, variante, sucursalId, 10)
    const servicio = await itemSembrado(con.id, { name: SERVICIO, slug: `lavado-ped-${sufijo}`, variantes: [{ name: 'Default', sku: `LAV-PED-${sufijo}`, price: 300, porDefecto: true }] })
    const ajeno = await itemSembrado(sinPedidos.id, { name: `Sin pedidos ${sufijo}`, slug: `sinpedidos-${sufijo}`, variantes: [{ name: 'Default', sku: `SP-${sufijo}`, price: 100, porDefecto: true }] })
    urlProducto = `/empresas/${con.slug}/catalogo/camiseta-ped-${sufijo}`
    urlServicio = `/empresas/${con.slug}/catalogo/lavado-ped-${sufijo}`
    urlSinPedidos = `/empresas/${sinPedidos.slug}/catalogo/sinpedidos-${sufijo}`
    expect([producto.id, servicio.id, ajeno.id].every(Boolean)).toBe(true)
  })

  test('la ficha ofrece «Hacer un pedido» solo si la empresa recibe pedidos; una ficha ajena o sin la capacidad no lo ofrece', async ({ page }) => {
    await page.goto(urlProducto)
    await expect(page.getByRole('form', { name: 'Hacer un pedido' })).toBeVisible()
    await page.goto(urlSinPedidos)
    await expect(page.getByRole('heading', { name: new RegExp(`Sin pedidos ${sufijo}`) }).first()).toBeVisible()
    await expect(page.getByRole('form', { name: 'Hacer un pedido' })).toHaveCount(0)
  })

  test('sin sesión, pedir manda a iniciar sesión (y vuelve a la ficha)', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await pedir(p, urlServicio, '1')
    await expect(p).toHaveURL(/\/login\?redirect=/)
    expect(decodeURIComponent(p.url())).toContain(`/empresas/${con.slug}/catalogo/lavado-ped-${sufijo}`)
    await ctx.close()
  })

  test('el cliente pide dos camisetas: nace «Esperando a la empresa», aparta el stock y la empresa recibe el aviso', async ({ browser }) => {
    test.setTimeout(120_000)
    const antes = await existencias()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosCliente', BASE)
    await pedir(p, urlProducto, '2', 'sin prisa')
    await expect(p).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    pedidoId = p.url().split('/').pop() as string
    await expect(p.getByRole('heading', { name: /^MBG-PED-\d{4}-\d{6}$/ })).toBeVisible()
    codigo = (await p.getByRole('heading', { name: /^MBG-PED-/ }).innerText()).trim()
    await expect(p.getByText('Esperando a la empresa').first()).toBeVisible()
    await expect(p.getByText('RD$500.00').first()).toBeVisible()
    await expect(p.getByText('sin prisa').first()).toBeVisible()
    // Aparta, no vende: la existencia es la misma y 2 quedan apartadas.
    const despues = await existencias()
    expect(despues.onHand).toBe(antes.onHand)
    expect(despues.reserved).toBe(antes.reserved + 2)
    // Un cliente ve «Mis pedidos» con el pedido.
    await p.goto('/cliente/pedidos')
    await expect(p.getByRole('link', { name: new RegExp(codigo) })).toBeVisible()
    // El aviso sale después de responder: se espera a que llegue.
    await expect
      .poll(async () => (await prismaDeArnes().notificacion.findFirst({ where: { dedupeKey: `pedido-nuevo:${pedidoId}` } }))?.titulo ?? null, { timeout: 15_000 })
      .toBe('Nuevo pedido Membego')
    await ctx.close()
  })

  test('otra persona (otra cliente) no ve el pedido: se ve igual que uno inexistente, y no aparece en su lista', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'cliente2', BASE)
    const vista = async (id: string) => {
      await p.goto(`/cliente/pedidos/${id}`)
      return { fuga: (await p.locator('body').innerText()).includes(codigo), noindex: (await p.locator('meta[name=robots][content*=noindex]').count()) > 0, formularios: await p.getByRole('form').count() }
    }
    const ajeno = await vista(pedidoId)
    const inexistente = await vista('cinexistente000000000000')
    expect(ajeno.fuga).toBe(false)
    expect(ajeno.formularios).toBe(0)
    expect(ajeno).toEqual(inexistente)
    await p.goto('/cliente/pedidos')
    await expect(p.getByText(new RegExp(codigo))).toHaveCount(0)
    await ctx.close()
  })

  test('la empresa lo ve, lo acepta, ajusta el monto y lo marca listo', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, con.id)

    await p.goto('/admin/pedidos-membego')
    await expect(p.getByText(/espera tu respuesta/)).toBeVisible()
    await p.getByRole('link', { name: new RegExp(codigo) }).click()
    await expect(p.getByRole('heading', { name: codigo })).toBeVisible()
    await expect(p.getByText('sin prisa').first()).toBeVisible()

    await p.getByRole('button', { name: 'Aceptar pedido' }).click()
    await expect(p.getByText('En preparación').first()).toBeVisible({ timeout: 20_000 })

    // Ajustar sin motivo no envía; con motivo, sí.
    const ajuste = p.getByRole('form', { name: 'Ajustar el monto del pedido' })
    await ajuste.getByLabel(/^Ajuste/).fill('-50')
    await ajuste.getByRole('button', { name: 'Guardar ajuste' }).click()
    await expect(p.getByText('RD$450.00')).toHaveCount(0)
    await ajuste.getByLabel('Motivo').fill('Cliente frecuente')
    await ajuste.getByRole('button', { name: 'Guardar ajuste' }).click()
    await expect(p.getByText('RD$450.00').first()).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText(/Ajuste \(Cliente frecuente\)/).first()).toBeVisible()
    await expect(p.getByText('Pendiente').first()).toBeVisible() // la confirmación del cliente
    await ctx.close()
  })

  test('el cliente ve el monto ajustado, lo confirma, y cuando está listo ve su QR; ya no puede cancelar', async ({ browser }) => {
    test.setTimeout(180_000)
    const cliente = await browser.newContext()
    const pc = await cliente.newPage()
    await entrarComo(cliente, 'pedidosCliente', BASE)
    await pc.goto(`/cliente/pedidos/${pedidoId}`)
    await expect(pc.getByText(/La empresa ajustó el monto/).first()).toBeVisible()
    await expect(pc.getByText('Ajuste de la empresa (Cliente frecuente)').first()).toBeVisible()
    // Ya la empresa lo atiende: no se puede cancelar.
    await expect(pc.getByRole('form', { name: 'Cancelar mi pedido' })).toHaveCount(0)
    await pc.getByRole('button', { name: /^Confirmar RD\$450\.00/ }).click()
    await expect(pc.getByText('Confirmaste este monto.').first()).toBeVisible({ timeout: 20_000 })

    const admin = await browser.newContext()
    const pa = await admin.newPage()
    await entrarComo(admin, 'pedidosAdmin', BASE, con.id)
    await pa.goto(`/admin/pedidos-membego/${pedidoId}`)
    await expect(pa.getByText(/Confirmó RD\$450\.00/)).toBeVisible()
    await pa.getByRole('button', { name: 'Marcar listo' }).click()
    await expect(pa.getByText('Listo para recoger').first()).toBeVisible({ timeout: 20_000 })

    await pc.reload()
    await expect(pc.getByRole('img', { name: `QR del pedido ${codigo}` })).toBeVisible()
    await expect(pc.getByText('Listo para recoger').first()).toBeVisible()
    await cliente.close()
    await admin.close()
  })

  test('el empleado escanea el QR y entrega: el pedido se cierra, el stock baja y el nivel queda en «Confirmado por el cliente»', async ({ browser }) => {
    test.setTimeout(180_000)
    const antes = await existencias()
    const pedido = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { qrToken: true } })
    expect(pedido.qrToken).toBeTruthy()

    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, con.id)
    // Lector físico: una ráfaga de teclas y Enter, sin tocar la pantalla.
    await prepararLector(p)
    await p.keyboard.type(pedido.qrToken as string, { delay: 0 })
    await p.keyboard.press('Enter')

    await expect(p.getByTestId('pedido-lookup')).toBeVisible({ timeout: 30_000 })
    await expect(p.getByText(codigo)).toBeVisible()
    await expect(p.getByText('Pedido listo para entregar')).toBeVisible()
    await expect(p.getByText('El cliente confirmó este monto.')).toBeVisible()
    await p.getByRole('button', { name: 'Entregar y cerrar pedido' }).click()
    await expect(p.getByTestId('pedido-cerrado')).toBeVisible({ timeout: 30_000 })
    await expect(p.getByText(/Confirmado por el cliente/)).toBeVisible()

    const cerrado = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { status: true, verificationLevel: true, completedAt: true } })
    expect(cerrado.status).toBe('COMPLETED')
    expect(cerrado.verificationLevel).toBe('CUSTOMER_VERIFIED')
    expect(cerrado.completedAt).toBeTruthy()
    const despues = await existencias()
    expect(despues.onHand).toBe(antes.onHand - 2)
    expect(despues.reserved).toBe(antes.reserved - 2)

    // Escanear otra vez el mismo QR: ya se canjeó.
    await prepararLector(p)
    await p.keyboard.type(pedido.qrToken as string, { delay: 0 })
    await p.keyboard.press('Enter')
    await expect(p.getByTestId('pedido-lookup')).toBeVisible({ timeout: 30_000 })
    await expect(p.getByText(/ya se canjeó/)).toBeVisible()
    await expect(p.getByRole('button', { name: 'Entregar y cerrar pedido' })).toHaveCount(0)
    await ctx.close()
  })

  test('Mi cuenta Membego: el pedido cerrado cobró su comisión (CPA, aún sin pago verificado) y la empresa la ve con su pedido', async ({ browser }) => {
    test.setTimeout(120_000)
    // En la base: UNA comisión por el pedido, con su asiento y el saldo corrido (la prueba contra PostgreSQL de las reglas está en billing.db.test.ts).
    const c = await prismaDeArnes().commission.findUniqueOrThrow({ where: { orderId: pedidoId }, include: { ledgerEntry: true } })
    expect(c.type).toBe('CPA_FIXED')
    expect(c.amount.toFixed(2)).toBe('100.00')
    expect(c.baseAmount.toFixed(2)).toBe('450.00')
    expect(c.ledgerEntry.balance.toFixed(2)).toBe('100.00')

    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, con.id)
    await p.goto('/admin/facturacion-membego')
    await expect(p.getByRole('heading', { name: 'Mi cuenta Membego' })).toBeVisible()
    await expect(p.getByText('Debes a Membego').first()).toBeVisible()
    await expect(p.getByText('RD$ 100.00').first()).toBeVisible()
    await expect(p.getByText('Al día').first()).toBeVisible()
    const fila = p.getByRole('row', { name: new RegExp(`Comisión por canje \\(CPA\\).*${codigo}`) })
    await expect(fila).toBeVisible()
    await fila.getByRole('link', { name: codigo }).click()
    await expect(p).toHaveURL(new RegExp(`/admin/pedidos-membego/${pedidoId}$`))
    // Solo lectura: la empresa no tiene formularios para mover su cuenta.
    await p.goto('/admin/facturacion-membego')
    await expect(p.getByRole('form')).toHaveCount(0)
    await ctx.close()
  })

  test('la empresa registra el pago con referencia y el pedido sube a «Pago verificado»', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, con.id)
    await p.goto(`/admin/pedidos-membego/${pedidoId}`)
    await expect(p.getByText('Confirmado por el cliente').first()).toBeVisible()
    const pago = p.getByRole('form', { name: 'Registrar el pago del pedido' })
    await pago.getByLabel('Método').selectOption({ label: 'Transferencia' })
    await pago.getByLabel(/^Monto cobrado/).fill('450')
    await pago.getByLabel('Referencia').fill('TRF-E2E-1')
    await pago.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(p.getByText('Pago verificado').first()).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('TRF-E2E-1')).toBeVisible()
    await expect(p.getByText('Pago registrado').first()).toBeVisible() // en la historia
    await ctx.close()
  })

  test('el cliente cancela un pedido a tiempo y se libera lo apartado; la empresa cancela otro con su motivo', async ({ browser }) => {
    test.setTimeout(180_000)
    const antes = await existencias()
    const cliente = await browser.newContext()
    const pc = await cliente.newPage()
    await entrarComo(cliente, 'pedidosCliente', BASE)
    await pedir(pc, urlProducto, '3')
    await expect(pc).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    expect((await existencias()).reserved).toBe(antes.reserved + 3)
    const cancelar = pc.getByRole('form', { name: 'Cancelar mi pedido' })
    await cancelar.getByLabel('¿Por qué lo cancelas?').fill('Ya no lo necesito')
    await cancelar.getByRole('button', { name: 'Cancelar pedido' }).click()
    await expect(pc.getByText('Este pedido fue cancelado').first()).toBeVisible({ timeout: 20_000 })
    await expect(pc.getByText('Motivo: Ya no lo necesito').first()).toBeVisible()
    expect((await existencias()).reserved).toBe(antes.reserved)

    // La empresa cancela uno que ya aceptó.
    await pedir(pc, urlServicio, '1')
    await expect(pc).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    const otro = pc.url().split('/').pop() as string
    const admin = await browser.newContext()
    const pa = await admin.newPage()
    await entrarComo(admin, 'pedidosAdmin', BASE, con.id)
    await pa.goto(`/admin/pedidos-membego/${otro}`)
    await pa.getByRole('button', { name: 'Aceptar pedido' }).click()
    await expect(pa.getByText('En preparación').first()).toBeVisible({ timeout: 20_000 })
    const cancelarEmpresa = pa.getByRole('form', { name: 'Cancelar el pedido' })
    await cancelarEmpresa.getByLabel(/^Motivo/).fill('Hoy no podemos atenderlo')
    await cancelarEmpresa.getByRole('button', { name: 'Cancelar pedido' }).click()
    await expect(pa.getByText(/Pedido cancelado/).first()).toBeVisible({ timeout: 20_000 })
    await pc.goto(`/cliente/pedidos/${otro}`)
    await expect(pc.getByText('Motivo: Hoy no podemos atenderlo').first()).toBeVisible()
    await cliente.close()
    await admin.close()
  })

  test('reembolsar el pedido completado, devolviendo lo vendido al inventario', async ({ browser }) => {
    test.setTimeout(120_000)
    const antes = await existencias()
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, con.id)
    await p.goto(`/admin/pedidos-membego/${pedidoId}`)
    const reembolso = p.getByRole('form', { name: 'Reembolsar el pedido' })
    await reembolso.getByLabel('Motivo').fill('Salió defectuoso')
    await reembolso.getByLabel('Devolver lo vendido al inventario').check()
    await reembolso.getByRole('button', { name: 'Reembolsar' }).click()
    await expect(p.getByText(/Pedido reembolsado/).first()).toBeVisible({ timeout: 20_000 })
    expect((await existencias()).onHand).toBe(antes.onHand + 2)
    await ctx.close()
  })

  test('el reembolso revierte la comisión: aparece el reverso y la cuenta vuelve a cero', async ({ browser }) => {
    test.setTimeout(120_000)
    const c = await prismaDeArnes().commission.findUniqueOrThrow({ where: { orderId: pedidoId } })
    expect(c.status).toBe('REVERSED')
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, con.id)
    await p.goto('/admin/facturacion-membego')
    await expect(p.getByRole('row', { name: new RegExp(`Reverso de comisión.*${codigo}`) })).toBeVisible()
    await expect(p.getByText('RD$ 0.00').first()).toBeVisible()
    await ctx.close()
  })

  test('aislamiento: el pedido de una empresa no se abre ni se lista desde otra, y una empresa SIN pedidos no entra al panel ni ve la entrada de menú', async ({ browser }) => {
    test.setTimeout(120_000)
    const otraEmpresa = await empresaCatalogo(sufijo, 'pedaj', { capacidad: true, pedidos: true })
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, otraEmpresa.id)
    const vista = async (id: string) => {
      await p.goto(`/admin/pedidos-membego/${id}`)
      const texto = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
      return { fuga: texto.includes(codigo) || /Marta Pedidos/.test(texto), formularios: await p.getByRole('form').count() }
    }
    const ajeno = await vista(pedidoId)
    const inexistente = await vista('cinexistente000000000000')
    expect(ajeno.fuga).toBe(false)
    expect(ajeno.formularios).toBe(0)
    expect(ajeno).toEqual(inexistente)
    await p.goto('/admin/pedidos-membego')
    await expect(p.getByText(new RegExp(codigo))).toHaveCount(0)
    await ctx.close()

    const sin = await browser.newContext()
    const ps = await sin.newPage()
    await entrarComo(sin, 'pedidosSinCapacidad', BASE, sinPedidos.id)
    await ps.goto('/admin/pedidos-membego')
    await expect(ps).not.toHaveURL(/\/admin\/pedidos-membego$/)
    await expect(ps.getByRole('link', { name: /^Pedidos Membego$/ })).toHaveCount(0)
    // «Mi cuenta Membego» cuelga de la misma capacidad: sin ella no se entra ni se ve la entrada de menú.
    await ps.goto('/admin/facturacion-membego')
    await expect(ps).not.toHaveURL(/\/admin\/facturacion-membego$/)
    await expect(ps.getByRole('link', { name: /^Mi cuenta Membego$/ })).toHaveCount(0)
    await sin.close()

    // Otra empresa con la capacidad ve SU cuenta (vacía), no la de la primera.
    const ajena = await browser.newContext()
    const pj = await ajena.newPage()
    await entrarComo(ajena, 'catalogoConCapacidad', BASE, otraEmpresa.id)
    await pj.goto('/admin/facturacion-membego')
    await expect(pj.getByRole('heading', { name: 'Mi cuenta Membego' })).toBeVisible()
    await expect(pj.getByText(codigo)).toHaveCount(0)
    await expect(pj.getByText('Todavía no hay movimientos en la cuenta.')).toBeVisible()
    await ajena.close()
  })
})
