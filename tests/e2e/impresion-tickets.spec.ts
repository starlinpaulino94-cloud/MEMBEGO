import { test, expect, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * LO QUE LE LLEGA A LA IMPRESORA (16-10-2026).
 *
 * Los comprobantes salían en 3 páginas o en 3 copias idénticas y recortados por
 * la derecha, aunque la vista previa se viera bien. Esta prueba mide lo que el
 * navegador va a imprimir —con el viewport del tamaño del papel y el medio
 * `print`— en las tres superficies del mostrador: factura de caja, cuadre del día
 * y ticket del escáner. Exige UNA página, el ticket en el origen de la hoja con el
 * ancho útil del papel, ninguna caja que lo recorte, UNA llamada a `window.print`
 * por toque y el QR ya cargado en ese instante.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const SERVICIO = `Lavado Impresion ${sufijo}`

// 80 mm × 210 mm a 96 dpi: el papel de una térmica con la página habitual de su driver.
const PX_80MM = Math.round((80 / 25.4) * 96)
const PX_210MM = Math.round((210 / 25.4) * 96)
const PX_72MM = Math.round((72 / 25.4) * 96)

type Captura = { qrs: boolean[]; activas: number; cuerpoMarcado: boolean }

/** `window.print` no abre nada en la prueba: anota qué había en ese instante. */
async function interceptarPrint(p: Page) {
  await p.addInitScript(() => {
    const w = window as unknown as { __prints: Captura[] }
    w.__prints = []
    window.print = () => {
      w.__prints.push({
        qrs: [...document.querySelectorAll('[data-impresion][data-activa] img[alt^="QR "]')].map((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
        activas: document.querySelectorAll('[data-impresion][data-activa]').length,
        cuerpoMarcado: document.body.hasAttribute('data-imprimiendo'),
      })
    }
  })
}

const prints = (p: Page) => p.evaluate(() => (window as unknown as { __prints: Captura[] }).__prints)
const esperarPrint = (p: Page, n: number) =>
  p.waitForFunction((n) => (window as unknown as { __prints: unknown[] }).__prints.length >= n, n, { timeout: 20_000 })

/** Geometría de lo imprimible tal como la ve el navegador al imprimir en 80 mm (el cuerpo sigue marcado tras el print interceptado). */
async function medir(p: Page) {
  const vista = p.viewportSize()!
  await p.setViewportSize({ width: PX_80MM, height: PX_210MM })
  await p.emulateMedia({ media: 'print' })
  await p.evaluate(() => window.scrollTo(0, 0))
  await p.waitForTimeout(250)
  const m = await p.evaluate(() => {
    const areas = document.querySelectorAll('[data-impresion][data-activa]')
    const el = areas[0]?.querySelector('.impresion-ticket') as HTMLElement | null
    const r = el?.getBoundingClientRect()
    const recortan: string[] = []
    const transforman: string[] = []
    let a = el?.parentElement ?? null
    while (a && a !== document.documentElement) {
      const cs = getComputedStyle(a)
      if ((cs.overflowY !== 'visible' || cs.overflowX !== 'visible') && a !== document.body) recortan.push(a.tagName)
      if (cs.transform !== 'none' || cs.filter !== 'none') transforman.push(a.tagName)
      a = a.parentElement
    }
    return {
      activas: areas.length,
      region: r ? { x: Math.round(r.x), y: Math.round(r.y), ancho: Math.round(r.width), derecha: Math.round(r.right), alto: Math.round(r.height) } : null,
      recortan,
      transforman,
      documentoAltoPx: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      bodyOverflow: getComputedStyle(document.body).overflow,
    }
  })
  await p.emulateMedia({ media: null })
  await p.setViewportSize(vista)
  return m
}

function exigirUnaPaginaLimpia(m: Awaited<ReturnType<typeof medir>>, nombre: string) {
  expect(m.activas, `${nombre}: una sola área activa`).toBe(1)
  expect(m.region, `${nombre}: hay región`).not.toBeNull()
  expect(m.region!.y, `${nombre}: el ticket arranca arriba de la hoja`).toBeLessThanOrEqual(2)
  expect(Math.abs(m.region!.ancho - PX_72MM), `${nombre}: ancho útil de 72 mm`).toBeLessThanOrEqual(2)
  expect(m.region!.derecha, `${nombre}: nada se sale por la derecha`).toBeLessThanOrEqual(PX_80MM)
  expect(m.region!.x, `${nombre}: centrado en el rollo`).toBeGreaterThanOrEqual(10)
  expect(m.recortan, `${nombre}: ningún ancestro con overflow lo recorta`).toEqual([])
  expect(m.transforman, `${nombre}: ningún ancestro transformado lo desplaza`).toEqual([])
  expect(m.bodyOverflow, `${nombre}: el bloqueo de scroll del diálogo no manda al imprimir`).toBe('visible')
  expect(m.documentoAltoPx, `${nombre}: UNA página (el resto del panel no ocupa altura)`).toBeLessThanOrEqual(PX_210MM)
}

test.describe('Impresión de tickets · una página, en el origen, con el ancho útil', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente')
    test.skip(testInfo.project.name !== 'escritorio', 'se mide una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let codigoTx = ''

  test('prepara: una venta de mostrador deja un cobro con ticket', async ({ browser }) => {
    test.setTimeout(180_000)
    con = await empresaCatalogo(sufijo, 'imp', { capacidad: true, pedidos: true, pos: true })
    await asegurarUsuario('posAdmin', con.id)
    await sucursalSembrada(con.id, 'Principal')
    await itemSembrado(con.id, { name: SERVICIO, slug: `lavado-imp-${sufijo}`, variantes: [{ name: 'Default', sku: `IMP-S-${sufijo}`, price: 250, porDefecto: true }] })

    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await p.goto('/empleado/caja')
    await p.getByRole('button', { name: 'Abrir caja' }).click()
    await expect(p.getByText('Caja abierta')).toBeVisible({ timeout: 20_000 })
    const venta = p.getByRole('region', { name: 'Venta de mostrador' })
    await venta.getByLabel('Buscar producto o servicio').fill(SERVICIO)
    await venta.getByRole('button', { name: 'Buscar', exact: true }).click()
    await venta.getByRole('button', { name: `Agregar ${SERVICIO}` }).click()
    await venta.getByLabel('Cómo paga').selectOption('EFECTIVO')
    await venta.getByLabel(/Efectivo recibido/).fill('300')
    await venta.getByRole('button', { name: /^Cobrar RD\$250\.00/ }).click()
    await expect(p.getByTestId('pos-venta-hecha')).toBeVisible({ timeout: 30_000 })
    codigoTx = (await prismaDeArnes().transaction.findFirstOrThrow({ where: { companyId: con.id, tipo: 'SALE' } })).codigo
    expect(codigoTx).toMatch(/^TX-/)
    await ctx.close()
  })

  test('caja: la factura térmica y el cuadre del día salen en una página, fuera del diálogo', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await interceptarPrint(p)
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
    await p.goto('/empleado/caja')
    await expect(p.getByText('Últimos cobros del turno')).toBeVisible({ timeout: 20_000 })

    // Factura 80 mm desde «Últimos cobros del turno».
    await p.getByRole('button', { name: 'Imprimir', exact: true }).first().click()
    await expect(p.getByRole('heading', { name: 'Vista previa de la factura' })).toBeVisible()
    await p.getByRole('button', { name: 'Térmica 80 mm' }).click()
    await expect(p.locator('[data-impresion]')).toHaveCount(1, { timeout: 20_000 })
    await p.getByRole('button', { name: /^Imprimir/ }).last().click()
    await esperarPrint(p, 1)
    let capturas = await prints(p)
    expect(capturas, 'un toque = una llamada a print').toHaveLength(1)
    expect(capturas[0].activas).toBe(1)
    expect(capturas[0].cuerpoMarcado).toBe(true)
    expect(capturas[0].qrs.length, 'el QR del ticket va en el papel').toBeGreaterThan(0)
    expect(capturas[0].qrs.every(Boolean), 'el QR ya estaba cargado al abrir el diálogo').toBe(true)
    exigirUnaPaginaLimpia(await medir(p), 'factura 80 mm')
    // La venta es la primera impresión: ORIGINAL, sin banner de copia.
    expect(await p.locator('[data-impresion] .impresion-ticket').innerText()).not.toMatch(/COPIA/)
    await p.keyboard.press('Escape')

    // Cuadre del día.
    await p.getByRole('button', { name: 'Mi cuadre del día' }).first().click()
    await expect(p.locator('[data-impresion]')).toHaveCount(1, { timeout: 20_000 })
    await p.getByRole('button', { name: 'Imprimir', exact: true }).last().click()
    await esperarPrint(p, 2)
    capturas = await prints(p)
    expect(capturas).toHaveLength(2)
    exigirUnaPaginaLimpia(await medir(p), 'cuadre del día')
    await expect(p.locator('[data-impresion] .impresion-ticket')).toContainText('CUADRE DEL DÍA')
    await p.keyboard.press('Escape')
    await expect(p.locator('[data-impresion]'), 'al cerrar el diálogo no queda ninguna área montada').toHaveCount(0)
    await ctx.close()
  })

  test('escáner: la reimpresión del comprobante sale en una página, con «COPIA #N» y el QR cargado', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await interceptarPrint(p)
    await entrarComo(ctx, 'posAdmin', BASE, con.id)
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
    await p.keyboard.type(codigoTx, { delay: 0 })
    await p.keyboard.press('Enter')
    await expect(p.getByRole('button', { name: 'Reimprimir' })).toBeVisible({ timeout: 30_000 })
    await p.getByRole('button', { name: 'Reimprimir' }).click()
    await p.getByLabel('Motivo de la reimpresión').fill('prueba de impresión')
    await p.getByRole('button', { name: 'Imprimir copia' }).click()
    await esperarPrint(p, 1)
    const capturas = await prints(p)
    expect(capturas).toHaveLength(1)
    expect(capturas[0].activas).toBe(1)
    expect(capturas[0].qrs.length).toBeGreaterThan(0)
    expect(capturas[0].qrs.every(Boolean), 'el QR ya estaba cargado al abrir el diálogo').toBe(true)
    exigirUnaPaginaLimpia(await medir(p), 'ticket del escáner')
    // Es la segunda impresión de esta transacción (la factura de caja fue la primera): el papel lo dice.
    await expect(p.locator('[data-impresion] .impresion-ticket')).toContainText('COPIA #2')
    await ctx.close()
  })
})
