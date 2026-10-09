import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * CAPTURAS DE LA EXPERIENCIA COMERCIAL (auditoría visual).
 *
 * No es una prueba de comportamiento: siembra una empresa con catálogo, stock y
 * una oferta, y fotografía las pantallas principales de la empresa y del
 * cliente en móvil y escritorio, para revisarlas a ojo. Se salta salvo con
 * `E2E_CAPTURAS=1`, así que no entra en CI.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const DESTINO = process.env.E2E_CAPTURAS_DIR ?? 'docs/capturas/comercio'
const sufijo = Date.now().toString(36)

test.describe('Capturas · experiencia comercial', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(process.env.E2E_CAPTURAS !== '1', 'solo para la auditoría visual (E2E_CAPTURAS=1)')
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo
  let itemId = ''
  let variante = ''
  let slugItem = ''
  let sucursalId = ''

  const foto = async (p: Page, nombre: string, proyecto: string) => {
    mkdirSync(DESTINO, { recursive: true })
    await p.waitForLoadState('domcontentloaded')
    await p.waitForTimeout(600)
    await p.screenshot({ path: `${DESTINO}/${nombre}.${proyecto}.png`, fullPage: true })
  }

  test('siembra', async () => {
    empresa = await empresaCatalogo(sufijo, 'cap', { capacidad: true, pedidos: true, deals: true })
    await prismaDeArnes().company.update({ where: { id: empresa.id }, data: { name: 'Tech Store Bávaro', description: 'Tecnología, audio y accesorios. Recoge en tienda con tu QR.', ciudad: 'Punta Cana' } })
    await asegurarUsuario('pedidosAdmin', empresa.id)
    sucursalId = (await sucursalSembrada(empresa.id, 'Bávaro')).id
    await sucursalSembrada(empresa.id, 'Verón')
    const airpods = await itemSembrado(empresa.id, { name: 'AirPods Pro', slug: `airpods-pro-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `CAP-AP-${sufijo}`, price: 12000, porDefecto: true }] })
    itemId = airpods.id
    slugItem = `airpods-pro-${sufijo}`
    variante = await varianteDe(airpods.id)
    await existenciasSembradas(empresa.id, variante, sucursalId, 100)
    await prismaDeArnes().inventoryLevel.updateMany({ where: { catalogVariantId: variante }, data: { lowStockThreshold: 10 } })
    const cable = await itemSembrado(empresa.id, { name: 'Cable USB-C 2 m', slug: `cable-usbc-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `CAP-CB-${sufijo}`, price: 450, porDefecto: true }] })
    await existenciasSembradas(empresa.id, await varianteDe(cable.id), sucursalId, 3)
    await prismaDeArnes().inventoryLevel.updateMany({ where: { catalogVariantId: await varianteDe(cable.id) }, data: { lowStockThreshold: 5 } })
    await itemSembrado(empresa.id, { name: 'Instalación y configuración', slug: `instalacion-${sufijo}`, variantes: [{ name: 'Default', sku: `CAP-SV-${sufijo}`, price: 1500, porDefecto: true }] })
    const ahora = new Date()
    await prismaDeArnes().deal.create({
      data: {
        companyId: empresa.id, catalogVariantId: variante, title: 'AirPods Pro con 20 % de descuento', description: 'Solo esta semana, al recoger en Bávaro.',
        discountType: 'PERCENT', discountValue: 20, currency: 'DOP', status: 'ACTIVE', publishedAt: ahora, startsAt: new Date(ahora.getTime() - 3_600_000), endsAt: null,
        voucherDays: 7, maxClaims: 25, feePerRedemption: 100, budgetTotal: 2500,
      },
    })
    expect(itemId).toBeTruthy()
  })

  test('empresa', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    const pr = testInfo.project.name
    for (const [ruta, nombre] of [
      ['/admin/dashboard', 'empresa-dashboard'],
      ['/admin/catalogo', 'empresa-catalogo'],
      [`/admin/catalogo/${itemId}`, 'empresa-catalogo-detalle'],
      ['/admin/inventario', 'empresa-inventario'],
      [`/admin/inventario/${variante}`, 'empresa-inventario-detalle'],
      ['/admin/deals', 'empresa-ofertas'],
      [`/admin/deals/nueva?variante=${variante}`, 'empresa-oferta-nueva-preseleccionada'],
      ['/admin/pedidos-membego', 'empresa-pedidos'],
      ['/admin/ofertas', 'empresa-beneficios-hub'],
    ] as const) {
      await p.goto(ruta)
      await foto(p, nombre, pr)
    }
    await ctx.close()
  })

  test('público y cliente', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const pr = testInfo.project.name
    for (const [ruta, nombre] of [
      ['/catalogo', 'publico-catalogo'],
      ['/ofertas', 'publico-ofertas'],
      [`/empresas/${empresa.slug}`, 'publico-vitrina-empresa'],
      [`/empresas/${empresa.slug}/catalogo/${slugItem}`, 'publico-producto-detalle'],
    ] as const) {
      await p.goto(ruta)
      await foto(p, nombre, pr)
    }
    await entrarComo(ctx, 'pedidosCliente', BASE)
    for (const [ruta, nombre] of [
      ['/cliente/inicio', 'cliente-inicio'],
      ['/cliente/explorar', 'cliente-explorar-negocios'],
      ['/cliente/explorar?ver=productos', 'cliente-explorar-productos'],
      ['/cliente/explorar?ver=ofertas', 'cliente-explorar-ofertas'],
      ['/cliente/buscar?q=airpods', 'cliente-buscar'],
      [`/cliente/empresas/${empresa.slug}`, 'cliente-vitrina-empresa'],
      ['/cliente/pedidos', 'cliente-pedidos'],
    ] as const) {
      await p.goto(ruta)
      await foto(p, nombre, pr)
    }
    await ctx.close()
  })
})
