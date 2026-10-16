import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, cookieDeSesion, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'
import { firmarEnlaceComprobante } from '../../src/modules/transacciones/enlaceComprobante'

/**
 * EL COMPROBANTE DE PAGO DEL CLIENTE (16-10-2026).
 *
 * Hasta hoy el cliente no tenía cómo imprimir su recibo. Dos caminos:
 *   · Web: «Mis pagos → Comprobantes de pago → Imprimir» abre la factura y la
 *     manda al papel por `AreaDeImpresion` (una página Carta, nada más).
 *   · App: pide un enlace firmado con su sesión y lo abre en el navegador del
 *     teléfono; el enlace solo abre ESA venta y muere solo. Manipulado → 404.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PX_CARTA = { ancho: 816, alto: 1056 } // 8,5 × 11 in a 96 dpi

async function interceptarPrint(p: Page) {
  await p.addInitScript(() => {
    const w = window as unknown as { __prints: number }
    w.__prints = 0
    window.print = () => {
      w.__prints += 1
    }
  })
}

/** Lo que el navegador imprimiría en Carta: una sola área, en el origen, una página. */
async function medirCarta(p: Page) {
  const vista = p.viewportSize()!
  await p.setViewportSize({ width: PX_CARTA.ancho, height: PX_CARTA.alto })
  await p.emulateMedia({ media: 'print' })
  await p.evaluate(() => window.scrollTo(0, 0))
  await p.waitForTimeout(250)
  const m = await p.evaluate(() => {
    const areas = document.querySelectorAll('[data-impresion][data-activa]')
    const el = areas[0]?.querySelector('.impresion-ticket') as HTMLElement | null
    const r = el?.getBoundingClientRect()
    const recortan: string[] = []
    let a = el?.parentElement ?? null
    while (a && a !== document.documentElement) {
      const cs = getComputedStyle(a)
      if ((cs.overflowY !== 'visible' || cs.overflowX !== 'visible') && a !== document.body) recortan.push(a.tagName)
      a = a.parentElement
    }
    return {
      activas: areas.length,
      region: r ? { x: Math.round(r.x), y: Math.round(r.y), ancho: Math.round(r.width), alto: Math.round(r.height) } : null,
      recortan,
      documentoAltoPx: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      bodyOverflow: getComputedStyle(document.body).overflow,
      texto: el?.innerText ?? '',
    }
  })
  await p.emulateMedia({ media: null })
  await p.setViewportSize(vista)
  return m
}

test.describe('Comprobante de pago del cliente · web con sesión, app con enlace firmado', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente')
    test.skip(testInfo.project.name !== 'escritorio', 'se mide una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let transactionId = ''
  let codigo = ''
  let cookie: { name: string; value: string }

  test('prepara: una clienta con una venta pagada con tarjeta a su nombre', async () => {
    test.setTimeout(120_000)
    con = await empresaCatalogo(sufijo, 'rec', { capacidad: true, pedidos: true, pos: true })
    const u = await asegurarUsuario('cliente', con.id)
    const prisma = prismaDeArnes()
    const ficha =
      (await prisma.cliente.findFirst({ where: { companyId: con.id, supabaseId: u.supabaseId }, select: { id: true } })) ??
      (await prisma.cliente.create({
        data: { companyId: con.id, supabaseId: u.supabaseId, nombre: u.nombre, email: u.email },
        select: { id: true },
      }))
    cookie = await cookieDeSesion({ ...u, clienteId: ficha.id })
    // La venta que deja la pasarela (ver reciboPasarela.ts), tal como queda en la base.
    const n = String(Date.now() % 1_000_000).padStart(6, '0')
    codigo = `TX-20261016-${n}`
    const tx = await prisma.transaction.create({
      data: {
        codigo,
        ticketNumero: `TCK-${n}`,
        tipo: 'SALE',
        estado: 'APPLIED',
        companyId: con.id,
        clienteId: ficha.id,
        monto: 1500,
        metodoCobro: 'OTRO',
        appliedAt: new Date(),
        snapshot: {
          detalle: 'Plan Oro',
          servicio: 'Plan Oro',
          cliente: u.nombre,
          lineas: [{ descripcion: 'Plan Oro', cantidad: 1, precioUnitario: 1500, descuento: 0, total: 1500 }],
          subtotal: '1500.00',
          total: '1500.00',
          metodoCobroLabel: 'Tarjeta (CardNET)',
          referenciaPago: 'Aut. 654321',
          intentoId: `e2e-intento-${sufijo}`,
        },
      },
      select: { id: true },
    })
    transactionId = tx.id
  })

  test('web: «Mis pagos» lista el comprobante y lo imprime en una página Carta', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    await ctx.addCookies([{ ...cookie, url: BASE, httpOnly: false, sameSite: 'Lax' }])
    const p = await ctx.newPage()
    await interceptarPrint(p)
    await p.goto('/cliente/pagos')
    await expect(p.getByRole('heading', { name: 'Comprobantes de pago' })).toBeVisible({ timeout: 20_000 })
    const fila = p.locator('li', { hasText: codigo })
    await expect(fila).toContainText('Tarjeta (CardNET)')
    await fila.getByRole('link', { name: 'Imprimir' }).click()

    await expect(p.getByRole('heading', { name: 'Comprobante de pago' })).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText(codigo).first()).toBeVisible()
    await expect(p.locator('[data-impresion]')).toHaveCount(1)
    await p.getByRole('button', { name: 'Imprimir / Guardar PDF' }).click()
    await p.waitForFunction(() => (window as unknown as { __prints: number }).__prints >= 1, undefined, { timeout: 20_000 })
    const m = await medirCarta(p)
    expect(m.activas, 'una sola área activa').toBe(1)
    expect(m.region, 'hay región').not.toBeNull()
    expect(m.region!.y, 'arranca arriba de la hoja').toBeLessThanOrEqual(2)
    expect(m.region!.ancho, 'ocupa el ancho de la hoja').toBeLessThanOrEqual(PX_CARTA.ancho)
    expect(m.recortan, 'nada la recorta').toEqual([])
    expect(m.bodyOverflow).toBe('visible')
    expect(m.documentoAltoPx, 'UNA página Carta').toBeLessThanOrEqual(PX_CARTA.alto)
    expect(m.texto).toContain(codigo)
    expect(m.texto).toContain('Aut. 654321')
    await ctx.close()
  })

  test('app: el enlace firmado abre el comprobante sin sesión web; manipulado, 404', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const token = firmarEnlaceComprobante(transactionId)
    await p.goto(`/comprobante/${token}`)
    await expect(p.getByRole('heading', { name: 'Comprobante de pago' })).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText(codigo).first()).toBeVisible()
    await expect(p.getByRole('button', { name: 'Imprimir / Guardar PDF' })).toBeVisible()

    const [id, exp, firma] = token.split('.')
    const roto = await p.goto(`/comprobante/${id}.${Number(exp) + 86_400}.${firma}`)
    expect(roto?.status(), 'alargar la caducidad rompe la firma').toBe(404)
    const ajeno = await p.goto(`/comprobante/${transactionId}`)
    expect(ajeno?.status(), 'el id a secas no abre nada').toBe(404)
    await ctx.close()
  })
})
