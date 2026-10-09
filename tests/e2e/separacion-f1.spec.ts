import { test, expect } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * SEPARACIÓN LANDING · APP — F1: los enlaces de la app se quedan en la app.
 *
 * Antes de F1, un cliente dentro de `/cliente` salía a la landing al pulsar el
 * nombre de la empresa en una oferta o «Ver el catálogo» en sus pedidos vacíos.
 * Aquí se comprueba, por la interfaz y en móvil y escritorio, que:
 *
 *   · en la app esos enlaces llevan a rutas de `/cliente` y la carcasa del
 *     cliente sigue ahí (no aparece la barra de la landing);
 *   · la landing NO cambió: la misma tarjeta, pintada en `/ofertas`, sigue
 *     llevando a `/empresas/...`;
 *   · las pantallas de «establecer contraseña» ya no enlazan a la portada.
 *
 * Se siembra con Prisma (empresa, producto, stock y una oferta activa) y se
 * entra con una sesión firmada localmente.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const TITULO_OFERTA = `Oferta separación ${sufijo}`

test.describe('Separación F1 · los enlaces de la app se quedan en la app', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo

  test('siembra: una empresa con un producto, stock y una oferta activa', async () => {
    empresa = await empresaCatalogo(sufijo, 'f1', { capacidad: true, pedidos: true, deals: true })
    const sucursal = await sucursalSembrada(empresa.id, 'Sucursal F1')
    const item = await itemSembrado(empresa.id, {
      name: `Producto separación ${sufijo}`, slug: `producto-sep-${sufijo}`, controlaInventario: true,
      variantes: [{ name: 'Default', sku: `SEP-F1-${sufijo}`, price: 1000, porDefecto: true }],
    })
    const variante = await varianteDe(item.id)
    await existenciasSembradas(empresa.id, variante, sucursal.id, 20)
    const ahora = new Date()
    await prismaDeArnes().deal.create({
      data: {
        companyId: empresa.id, catalogVariantId: variante, title: TITULO_OFERTA, description: 'Oferta de prueba de la separación.',
        discountType: 'PERCENT', discountValue: 20, currency: 'DOP', status: 'ACTIVE', publishedAt: ahora,
        startsAt: new Date(ahora.getTime() - 3_600_000), endsAt: null, voucherDays: 7, maxClaims: 25, feePerRedemption: 100, budgetTotal: 2500,
      },
    })
    await asegurarUsuario('separacionCliente')
  })

  test('pedidos vacíos: «Ver el catálogo» lleva a Explorar productos, dentro de la app', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'separacionCliente', BASE)
    const page = await ctx.newPage()
    await page.goto('/cliente/pedidos')
    await page.getByRole('link', { name: 'Ver el catálogo' }).click()
    await expect(page).toHaveURL(/\/cliente\/explorar\?ver=productos$/)
    // La barra de la landing («Registrarse») no puede aparecer dentro de la app.
    await expect(page.getByRole('link', { name: 'Registrarse' })).toHaveCount(0)
    await ctx.close()
  })

  test('Explorar ofertas: el nombre de la empresa lleva a su vitrina en la app', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'separacionCliente', BASE)
    const page = await ctx.newPage()
    await page.goto('/cliente/explorar?ver=ofertas')
    const tarjeta = page.getByRole('article', { name: TITULO_OFERTA })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta.getByRole('link', { name: empresa.name })).toHaveAttribute('href', `/cliente/empresas/${empresa.slug}`)
    await tarjeta.getByRole('link', { name: empresa.name }).click()
    await expect(page).toHaveURL(new RegExp(`/cliente/empresas/${empresa.slug}$`))
    await expect(page.getByText(empresa.name).first()).toBeVisible()
    await ctx.close()
  })

  test('Buscar: la oferta encontrada lleva a la vitrina de la empresa en la app', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, 'separacionCliente', BASE)
    const page = await ctx.newPage()
    await page.goto(`/cliente/buscar?q=${encodeURIComponent(TITULO_OFERTA)}`)
    const tarjeta = page.getByRole('article', { name: TITULO_OFERTA })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta.getByRole('link', { name: empresa.name })).toHaveAttribute('href', `/cliente/empresas/${empresa.slug}`)
    await ctx.close()
  })

  test('la landing no cambió: la misma tarjeta en /catalogo sigue llevando a /empresas', async ({ page }) => {
    // `/catalogo` y no `/ofertas`: esa se sirve con caché de 60 s y no mostraría
    // la oferta recién sembrada. Pinta la misma tarjeta con `espacio="publico"`.
    await page.goto('/catalogo')
    const tarjeta = page.getByRole('article', { name: TITULO_OFERTA })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta.getByRole('link', { name: empresa.name })).toHaveAttribute('href', `/empresas/${empresa.slug}`)
    await tarjeta.getByRole('link', { name: empresa.name }).click()
    await expect(page).toHaveURL(new RegExp(`/empresas/${empresa.slug}$`))
  })

  test('las pantallas de establecer contraseña ya no enlazan a la portada', async ({ page }) => {
    for (const ruta of ['/cliente/establecer-contrasena', '/vendedor/establecer-contrasena']) {
      await page.goto(ruta)
      const logo = page.locator('main a').first()
      await expect(logo, ruta).toHaveAttribute('href', '/login')
      await expect(page.locator('a[href="/"]'), ruta).toHaveCount(0)
    }
  })
})
