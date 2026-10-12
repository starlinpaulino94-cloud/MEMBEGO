import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * EXPERIENCIA COMERCIAL · de punta a punta, por la INTERFAZ (2026-10-08).
 *
 *   La empresa entra y encuentra «Comercio» (Catálogo, Inventario, Pedidos,
 *   Ofertas) → crea un producto físico → desde su ficha va a Inventario y entra
 *   100 unidades → publica → desde la misma ficha crea la promoción del 20 %
 *   (preseleccionada) y la publica → el cliente la ve en la vitrina y en
 *   Explorar con «Antes / Ahora / 20% OFF» y «Disponible», sin la cantidad →
 *   compra 2 → la empresa ve el pedido, acepta y marca listo → el cliente
 *   recibe sus avisos y su QR → el empleado lo escanea → COMPLETED → 98.
 *
 * La base de E2E se crea con `db push` (sin disparadores); las reglas de la
 * base están en `tests/postgres/comercio-experiencia.db.test.ts`. Aquí se
 * prueba que la experiencia EXISTE, se ENCUENTRA y funciona de principio a fin.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `AirPods Pro ${sufijo}`
const PROMO = `AirPods 20 % ${sufijo}`

test.describe('Experiencia comercial · recorrido completo', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo
  let sucursalId = ''
  let itemId = ''
  let variante = ''
  let slugItem = ''
  let dealId = ''
  let pedidoId = ''
  let codigo = ''

  // El nivel nace con el primer movimiento: antes de la entrada no existe (0/0).
  const existencias = async () => {
    const n = await prismaDeArnes().inventoryLevel.findUnique({ where: { catalogVariantId_locationId: { catalogVariantId: variante, locationId: sucursalId } } })
    return { onHand: n?.onHand ?? 0, reserved: n?.reserved ?? 0 }
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

  test('prepara: una empresa publicada con una sucursal; las capacidades de comercio vienen de serie', async () => {
    // El arnés escribe los overrides explícitos; aquí se pide TODO encendido, que es lo que
    // una empresa recién registrada recibe de serie (CAPACIDADES_COMERCIO).
    empresa = await empresaCatalogo(sufijo, 'exp', { capacidad: true, pedidos: true, deals: true })
    await asegurarUsuario('pedidosAdmin', empresa.id)
    sucursalId = (await sucursalSembrada(empresa.id, 'Bávaro')).id
    expect(sucursalId).toBeTruthy()
  })

  test('la empresa encuentra Comercio en el menú: Catálogo, Inventario, Pedidos y Ofertas', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    await p.goto('/admin/dashboard')
    const menu = p.getByRole('navigation', { name: /Módulos de/ })
    await expect(menu.getByText('Comercio', { exact: true })).toBeVisible()
    for (const nombre of ['Catálogo', 'Inventario', 'Pedidos Membego', 'Ofertas y Promociones']) {
      await expect(menu.getByRole('link', { name: new RegExp(`^${nombre}`) }).first()).toBeVisible()
    }
    // El dashboard enseña la fila de comercio y el CTA de crear producto.
    await expect(p.getByRole('heading', { name: 'Comercio Membego' })).toBeVisible()
    await expect(p.getByRole('link', { name: 'Nuevo producto o servicio' })).toBeVisible()
    await ctx.close()
  })

  test('crea el producto: la ficha enseña Información, Variantes, Inventario, Promociones, Pedidos, Marketplace e Historial', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    await p.goto('/admin/catalogo')
    await expect(p.getByText('Todavía no tienes productos o servicios.')).toBeVisible()
    await p.getByRole('link', { name: 'Crear primer producto' }).click()
    await p.waitForURL('**/admin/catalogo/nuevo')
    await p.getByLabel('Nombre *').fill(PRODUCTO)
    // Tipo: producto físico (controla inventario de serie).
    await p.locator('#tipo').click()
    await p.getByRole('option', { name: 'Producto físico' }).click()
    await p.getByLabel('Descripción').fill('Cancelación activa de ruido.')
    await p.getByLabel('Precio *', { exact: true }).fill('12000')
    await p.getByRole('button', { name: 'Crear' }).click()
    await p.waitForURL(/\/admin\/catalogo\/(?!nuevo)[^/]+$/, { timeout: 15_000 })
    itemId = p.url().split('/').pop() as string
    variante = (await prismaDeArnes().catalogVariant.findFirstOrThrow({ where: { catalogItemId: itemId }, select: { id: true } })).id
    slugItem = (await prismaDeArnes().catalogItem.findUniqueOrThrow({ where: { id: itemId }, select: { slug: true } })).slug

    // Las secciones de la ficha: un solo lugar para entender el producto.
    const secciones = p.getByRole('navigation', { name: 'Secciones del producto' })
    for (const s of ['Información', 'Variantes y precio', 'Inventario', 'Promociones', 'Pedidos', 'Marketplace', 'Historial']) {
      await expect(secciones.getByRole('link', { name: s })).toBeVisible()
    }
    await expect(p.locator('#inventario').getByRole('link', { name: 'Administrar inventario' })).toBeVisible()
    await expect(p.locator('#promociones').getByText(/Publícalo primero/)).toBeVisible()
    await expect(p.locator('#historial').getByText('Creado')).toBeVisible()
    await expect(p.locator('#marketplace').getByText(/Está en borrador/)).toBeVisible()
    await ctx.close()
  })

  test('desde la ficha entra 100 unidades en Inventario (Bávaro) y publica el producto', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    await p.goto(`/admin/catalogo/${itemId}`)
    await p.locator('#inventario').getByRole('link', { name: 'Administrar inventario' }).click()
    await p.waitForURL(`**/admin/inventario/${variante}`)
    const f = p.getByRole('form', { name: 'Registrar movimiento en Bávaro' })
    await f.getByLabel('Movimiento').selectOption({ label: 'Entrada de mercancía' })
    await f.getByRole('textbox').first().fill('100')
    await f.getByLabel(/^Motivo/).fill('Compra inicial')
    await f.getByRole('button', { name: 'Registrar' }).click()
    await expect.poll(async () => (await existencias()).onHand, { timeout: 20_000 }).toBe(100)
    // Umbral de aviso: con 10 o menos, «Pocas unidades» para el cliente y aviso para la empresa.
    const u = p.getByRole('form', { name: 'Umbral de stock bajo en Bávaro' })
    await u.getByLabel('Avisar cuando queden').fill('10')
    await u.getByRole('button', { name: 'Guardar umbral' }).click()
    await expect.poll(async () => (await prismaDeArnes().inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: variante } })).lowStockThreshold, { timeout: 20_000 }).toBe(10)

    // De vuelta en la ficha: el stock por sucursal se ve sin salir del catálogo.
    await p.getByRole('link', { name: 'Ver en el catálogo' }).click()
    await p.waitForURL(`**/admin/catalogo/${itemId}`)
    await expect(p.locator('#inventario').getByText('Bávaro')).toBeVisible()
    await expect(p.locator('#inventario').getByText('100').first()).toBeVisible()
    await p.getByRole('button', { name: 'Publicar' }).click()
    await expect(p.getByRole('button', { name: 'Pausar' })).toBeVisible({ timeout: 15_000 })
    await p.reload()
    await expect(p.locator('#marketplace').getByText('Marketplace ✓')).toBeVisible()
    await expect(p.locator('#marketplace').getByRole('link', { name: 'Ver como cliente' })).toBeVisible()
    await ctx.close()
  })

  test('crea la promoción del 20 % DESDE la ficha del producto (preseleccionado) y la publica: el stock no cambia', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    await p.goto(`/admin/catalogo/${itemId}`)
    await p.locator('#promociones').getByRole('link', { name: 'Crear promoción' }).click()
    await p.waitForURL(/\/admin\/deals\/nueva\?variante=/)
    // Preseleccionado: el producto ya está elegido y el título propuesto lo nombra.
    await expect(p.getByLabel('Qué ofreces')).toHaveValue(variante)
    await expect(p.getByLabel('Título')).toHaveValue(`Oferta en ${PRODUCTO}`)
    await p.getByLabel('Título').fill(PROMO)
    await p.getByLabel('Descuento', { exact: true }).fill('20')
    // Vista previa: así lo verá el cliente.
    await expect(p.getByText('Así lo verá el cliente')).toBeVisible()
    await expect(p.getByText('9600.00 DOP')).toBeVisible()
    await p.getByLabel('Cuántos clientes pueden obtenerla').fill('10')
    await p.getByLabel(/^Presupuesto máximo/).fill('1000')
    await p.getByRole('button', { name: 'Crear borrador' }).click()
    await expect(p).toHaveURL(/\/admin\/deals\/(?!nueva$)[a-z0-9]+$/, { timeout: 30_000 })
    dealId = p.url().split('/').pop() as string
    // La oferta referencia al producto: el enlace de vuelta a su ficha está ahí.
    await expect(p.getByRole('link', { name: PRODUCTO })).toBeVisible()
    await p.getByRole('button', { name: 'Publicar' }).click()
    await expect(p.getByText('Activa').first()).toBeVisible({ timeout: 20_000 })
    const n = await existencias()
    expect(n.onHand).toBe(100)
    expect(n.reserved).toBe(0)
    // En la ficha del producto, la promoción aparece con antes/ahora.
    await p.goto(`/admin/catalogo/${itemId}`)
    await expect(p.locator('#promociones').getByRole('link', { name: PROMO })).toBeVisible()
    await expect(p.locator('#promociones').getByText(/RD\$9,600\.00/)).toBeVisible()
    await ctx.close()
  })

  test('el cliente lo descubre en la vitrina y en Explorar con antes/ahora y «Disponible», y nunca ve la cantidad', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    // Vitrina pública de la empresa: sección Productos con la tarjeta y su oferta.
    await p.goto(`/empresas/${empresa.slug}`)
    const tarjeta = p.locator('#catalogo').getByRole('link', { name: PRODUCTO })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta.getByText('20% OFF')).toBeVisible()
    await expect(tarjeta.getByText(/RD\$12,000\.00/)).toBeVisible()
    await expect(tarjeta.getByText(/RD\$9,600\.00/)).toBeVisible()
    await expect(tarjeta.getByText('Disponible')).toBeVisible()
    await expect(tarjeta.getByText('Para recoger')).toBeVisible()
    await expect(p.locator('#ofertas').getByRole('article', { name: PROMO })).toBeVisible()
    const texto = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(texto).not.toMatch(/\b100 unidades|Quedan 100|onHand|reserved/)

    // Detalle (de CONSULTA, en la landing): precio normal, promocional, ahorro, disponibilidad, condiciones, y
    // los dos caminos como TRASPASO a la app — la landing no tiene botones que operen.
    await tarjeta.click()
    await p.waitForURL(`**/empresas/${empresa.slug}/catalogo/${slugItem}`)
    await expect(p.getByRole('heading', { level: 1, name: PRODUCTO })).toBeVisible()
    await expect(p.getByText(/Ahorras RD\$2,400\.00/)).toBeVisible()
    await expect(p.getByText('Disponible').first()).toBeVisible()
    await expect(p.getByRole('link', { name: 'Obtener oferta en la app' })).toBeVisible()
    await expect(p.getByRole('region', { name: 'Hacer un pedido' })).toBeVisible()
    await expect(p.getByRole('button', { name: 'Obtener oferta' })).toHaveCount(0)
    await expect(p.getByRole('form', { name: 'Hacer un pedido' })).toHaveCount(0)
    expect((await p.content()).includes('"onHand"')).toBe(false)

    // Dentro de la app: Explorar → Productos y Ofertas; y el inicio con «Ofertas destacadas».
    await entrarComo(ctx, 'pedidosCliente', BASE)
    await p.goto(`/cliente/explorar?ver=productos&q=${encodeURIComponent(sufijo)}`)
    await expect(p.getByRole('link', { name: new RegExp(PRODUCTO) })).toBeVisible()
    await p.goto(`/cliente/explorar?ver=ofertas&q=${encodeURIComponent(sufijo)}`)
    await expect(p.getByRole('article', { name: PROMO })).toBeVisible()
    await p.goto('/cliente/inicio')
    await expect(p.getByRole('heading', { name: 'Ofertas destacadas' })).toBeVisible()
    await ctx.close()
  })

  test('el cliente compra 2 unidades: se apartan 2, la empresa recibe el pedido y el cliente su aviso', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosCliente', BASE)
    // La compra se hace en la ficha de la APP.
    await p.goto(`/cliente/empresas/${empresa.slug}/catalogo/${slugItem}`)
    const form = p.getByRole('form', { name: 'Hacer un pedido' })
    await form.getByLabel('Cantidad').fill('2')
    await form.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(p).toHaveURL(/\/cliente\/pedidos\/[a-z0-9]+$/, { timeout: 30_000 })
    pedidoId = p.url().split('/').pop() as string
    codigo = (await p.getByRole('heading', { name: /^MBG-PED-/ }).innerText()).trim()
    await expect(p.getByText('RD$24,000.00').first()).toBeVisible()
    const n = await existencias()
    expect(n.onHand).toBe(100)
    expect(n.reserved).toBe(2)
    await expect
      .poll(async () => (await prismaDeArnes().notificacion.findMany({ where: { dedupeKey: `pedido:${pedidoId}:RECIBIDO` }, select: { titulo: true } })).map((x) => x.titulo).sort(), { timeout: 20_000 })
      .toEqual(['Nuevo pedido Membego', 'Pedido recibido'])
    await ctx.close()
  })

  test('la empresa acepta y marca listo; el cliente recibe «confirmado» y «listo» y ve su QR', async ({ browser }) => {
    test.setTimeout(180_000)
    const admin = await browser.newContext()
    const pa = await admin.newPage()
    await entrarComo(admin, 'pedidosAdmin', BASE, empresa.id)
    await pa.goto('/admin/dashboard')
    await expect(pa.getByText('Pedidos nuevos')).toBeVisible()
    await pa.goto('/admin/pedidos-membego')
    await pa.getByRole('link', { name: new RegExp(codigo) }).click()
    await pa.getByRole('button', { name: 'Aceptar pedido' }).click()
    await expect(pa.getByText('En preparación').first()).toBeVisible({ timeout: 20_000 })
    await pa.getByRole('button', { name: 'Marcar listo' }).click()
    await expect(pa.getByText('Listo para recoger').first()).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => (await prismaDeArnes().notificacion.findMany({ where: { href: `/cliente/pedidos/${pedidoId}` }, orderBy: { createdAt: 'asc' }, select: { titulo: true } })).map((x) => x.titulo), { timeout: 20_000 })
      .toEqual(['Pedido recibido', 'Pedido confirmado', 'Tu pedido está listo'])
    await admin.close()

    const cliente = await browser.newContext()
    const pc = await cliente.newPage()
    await entrarComo(cliente, 'pedidosCliente', BASE)
    await pc.goto(`/cliente/pedidos/${pedidoId}`)
    await expect(pc.getByRole('img', { name: `QR del pedido ${codigo}` })).toBeVisible()
    await cliente.close()
  })

  test('el empleado escanea el QR: COMPLETED, onHand 98, reserva consumida y la venta en la analítica', async ({ browser }) => {
    test.setTimeout(180_000)
    const pedido = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { qrToken: true } })
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    await prepararLector(p)
    await p.keyboard.type(pedido.qrToken as string, { delay: 0 })
    await p.keyboard.press('Enter')
    await expect(p.getByTestId('pedido-lookup')).toBeVisible({ timeout: 30_000 })
    await p.getByRole('button', { name: 'Entregar y cerrar pedido' }).click()
    await expect(p.getByTestId('pedido-cerrado')).toBeVisible({ timeout: 30_000 })

    const cerrado = await prismaDeArnes().membegoOrder.findUniqueOrThrow({ where: { id: pedidoId }, select: { status: true } })
    expect(cerrado.status).toBe('COMPLETED')
    const n = await existencias()
    expect(n.onHand).toBe(98)
    expect(n.reserved).toBe(0)
    expect(await prismaDeArnes().inventoryReservation.count({ where: { referenceId: pedidoId, status: 'CONSUMED' } })).toBe(1)
    expect(await prismaDeArnes().inventoryMovement.count({ where: { referenceId: pedidoId, type: 'SALE' } })).toBe(1)
    await expect
      .poll(async () => (await prismaDeArnes().notificacion.count({ where: { href: `/cliente/pedidos/${pedidoId}`, titulo: 'Pedido completado' } })), { timeout: 20_000 })
      .toBe(1)

    // La ficha del producto y los resultados reflejan la venta.
    await p.goto(`/admin/catalogo/${itemId}`)
    await expect(p.locator('#inventario').getByText('98').first()).toBeVisible()
    await expect(p.locator('#pedidos').getByText('Unidades vendidas')).toBeVisible()
    await p.goto('/admin/resultados-membego')
    await expect(p.getByRole('link', { name: PRODUCTO })).toBeVisible()
    await ctx.close()
  })
})
