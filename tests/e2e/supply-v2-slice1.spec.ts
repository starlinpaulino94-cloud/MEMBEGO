import { test, expect, type Page } from '@playwright/test'
import { cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY · SLICE 1 de punta a punta, en un navegador de verdad (§50).
 *
 *   login (Compras) → Supply → Nueva compra → crear proveedor → crear
 *   producto → crear acuerdo → PO 1.000 → enviar aprobación → aprobar con
 *   OTRA persona (Finanzas) → recepción 500 → Supply 500 → recepción 300 →
 *   Supply 800 → recepción 200 → Supply 1.000 → PO RECEIVED
 *
 * Dos contextos de navegador, dos sesiones: la segregación creador/aprobador
 * se prueba de verdad, no con un solo usuario que hace todo.
 *
 * Sin `SUPABASE_JWT_SECRET` y `DATABASE_URL` no se pueden firmar sesiones
 * (ver `supply-v2-sesion.ts`) y la prueba se salta con ese motivo.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = `${Date.now().toString(36)}`
const PROVEEDOR = `Little Pizza E2E ${sufijo}`
const PRODUCTO = `Pizza Grande Pepperoni E2E ${sufijo}`

async function registrarRecepcion(page: Page, cantidad: number) {
  // Si la recepción anterior dejó su pantalla de éxito, se pide otra.
  const otra = page.getByRole('button', { name: 'Registrar otra recepción' })
  if (await otra.isVisible().catch(() => false)) await otra.click()
  const form = page.getByTestId('form-recepcion')
  await expect(form).toBeVisible()
  await form.locator('input[name="lineQuantity"]').fill(String(cantidad))
  await form.locator('input[name="reference"]').fill(`Guía ${cantidad}`)
  await page.getByTestId('btn-confirmar-recepcion').click()
  await expect(page.getByTestId('recepcion-exito')).toBeVisible()
}

async function disponiblesEnSupply(page: Page): Promise<number> {
  await page.goto('/superadmin/supply/supply')
  const tarjeta = page.getByTestId('pool-producto').filter({ hasText: PRODUCTO })
  await expect(tarjeta).toBeVisible()
  const texto = await tarjeta.getByTestId('pool-disponibles').innerText()
  return Number(texto.replace(/[^\d]/g, ''))
}

test.describe('Supply · Slice 1', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('proveedor → producto → acuerdo → PO 1.000 → aprobación por otra persona → 500 / 800 / 1.000 → RECEIVED', async ({ browser }) => {
    test.setTimeout(240_000)

    // ── Compras entra y abre el wizard ────────────────────────────────────
    const ctxCompras = await browser.newContext()
    const compras = await ctxCompras.newPage()
    await entrarComo(ctxCompras, 'compras', BASE)
    await compras.goto('/superadmin/supply')
    await expect(compras.getByRole('heading', { level: 1, name: 'Membego Supply' })).toBeVisible()
    await compras.getByTestId('btn-nueva-compra').first().click()
    await compras.waitForURL('**/superadmin/supply/compras/nueva')
    await expect(compras.getByTestId('wizard-compra')).toBeVisible()

    // ── Paso 1 · crear proveedor externo sin salir del wizard ─────────────
    await compras.getByRole('button', { name: '+ Crear proveedor' }).click()
    await compras.getByRole('button', { name: 'No, es un proveedor externo' }).click()
    await compras.locator('#commercialName').fill(PROVEEDOR)
    await compras.locator('#whatsapp').fill('809-555-0101')
    await compras.locator('#contactName').fill('Laura Peña')
    await compras.getByRole('button', { name: 'Guardar y continuar' }).click()

    // ── Paso 2 · crear producto ───────────────────────────────────────────
    await expect(compras.getByRole('heading', { name: new RegExp(`¿Qué vamos a comprar a ${PROVEEDOR}`) })).toBeVisible()
    await compras.getByRole('button', { name: '+ Crear producto' }).click()
    await compras.locator('#productoNombre').fill(PRODUCTO)
    await compras.locator('#productoSku').fill(`PIZ-${sufijo}`)
    await compras.locator('#productoPrecio').fill('600')
    await compras.getByRole('button', { name: 'Guardar y continuar' }).click()

    // ── Paso 3 · crear acuerdo ────────────────────────────────────────────
    await expect(compras.getByRole('heading', { name: '¿Bajo qué condiciones?' })).toBeVisible()
    await compras.getByRole('button', { name: '+ Crear acuerdo' }).click()
    await compras.locator('#negotiatedUnitCost').fill('300')
    await compras.getByRole('button', { name: 'Crear acuerdo y continuar' }).click()

    // ── Paso 4 · cantidad y costo ─────────────────────────────────────────
    await expect(compras.getByRole('heading', { name: '¿Cuánto?' })).toBeVisible()
    await compras.locator('#wizardCantidad').fill('1000')
    await expect(compras.locator('#wizardCosto')).toHaveValue('300.00')
    await expect(compras.getByTestId('wizard-total')).toContainText('300,000.00')
    await compras.getByRole('button', { name: 'Continuar' }).click()

    // ── Paso 5 · forma de pago ────────────────────────────────────────────
    await expect(compras.getByRole('heading', { name: '¿Cómo se pagará?' })).toBeVisible()
    await compras.getByLabel('Pago anticipado').check()
    await compras.getByRole('button', { name: 'Continuar' }).click()

    // ── Paso 6 · resumen y creación ───────────────────────────────────────
    const resumen = compras.getByTestId('form-crear-orden')
    await expect(resumen).toContainText(PROVEEDOR)
    await expect(resumen).toContainText(PRODUCTO)
    await expect(resumen).toContainText('1,000')
    await expect(resumen).toContainText('300,000.00')
    await compras.screenshot({ path: 'test-results/shots/supply-v2-wizard-resumen.png', fullPage: true })
    await compras.getByRole('button', { name: 'Crear orden de compra' }).click()
    await compras.waitForURL(/\/superadmin\/supply\/compras\/(?!nueva)[a-z0-9]+$/)
    const urlOrden = compras.url()
    await expect(compras.getByRole('heading', { level: 1, name: /^MBG-PO-\d{4}-\d{6}$/ })).toBeVisible()
    await expect(compras.getByTestId('estado-orden')).toHaveText('Borrador')

    // ── Enviar a aprobación: quien la creó TAMBIÉN puede aprobar ──────────
    await compras.getByTestId('btn-enviar-aprobacion').click()
    await expect(compras.getByTestId('estado-orden')).toHaveText('Pendiente de aprobación')
    // El botón ya no se esconde: lo que la interfaz hace es AVISAR de que la
    // aprobación irá firmada con su nombre.
    await expect(compras.getByTestId('aviso-autoaprobacion')).toContainText('queda registrado a tu nombre')
    await expect(compras.getByTestId('btn-aprobar')).toBeVisible()

    // ── Finanzas aprueba desde OTRA sesión ────────────────────────────────
    const ctxFinanzas = await browser.newContext()
    const finanzas = await ctxFinanzas.newPage()
    await entrarComo(ctxFinanzas, 'finanzas', BASE)
    await finanzas.goto(urlOrden)
    await expect(finanzas.getByTestId('estado-orden')).toHaveText('Pendiente de aprobación')
    await finanzas.getByTestId('btn-aprobar').click()
    await expect(finanzas.getByTestId('estado-orden')).toHaveText('Aprobada')
    await expect(finanzas.getByTestId('timeline-orden')).toContainText('Aprobada por Finanzas E2E')
    await finanzas.screenshot({ path: 'test-results/shots/supply-v2-orden-aprobada.png', fullPage: true })

    // ── Recepción 500 → Supply muestra 500 ────────────────────────────────
    await compras.reload()
    await expect(compras.getByTestId('estado-orden')).toHaveText('Aprobada')
    await registrarRecepcion(compras, 500)
    await expect(compras.getByTestId('recepcion-exito')).toContainText('500 unidades disponibles')
    expect(await disponiblesEnSupply(compras)).toBe(500)

    // ── Recepción 300 → 800 ───────────────────────────────────────────────
    await compras.goto(urlOrden)
    await expect(compras.getByTestId('estado-orden')).toHaveText('Parcialmente recibida')
    await expect(compras.getByTestId('recibidas-linea')).toContainText('500 / 1,000')
    await registrarRecepcion(compras, 300)
    expect(await disponiblesEnSupply(compras)).toBe(800)

    // ── Recepción 200 → 1.000 y RECEIVED ──────────────────────────────────
    await compras.goto(urlOrden)
    await expect(compras.getByTestId('recibidas-linea')).toContainText('800 / 1,000')
    await registrarRecepcion(compras, 200)
    await expect(compras.getByTestId('recepcion-exito')).toContainText('la orden quedó completa')
    expect(await disponiblesEnSupply(compras)).toBe(1000)
    await compras.screenshot({ path: 'test-results/shots/supply-v2-pool.png', fullPage: true })

    await compras.goto(urlOrden)
    await expect(compras.getByTestId('estado-orden')).toHaveText('Recibida')
    await expect(compras.getByTestId('recibidas-linea')).toContainText('1,000 / 1,000')
    await expect(compras.getByTestId('lista-recepciones').locator('li')).toHaveCount(3)
    await expect(compras.getByTestId('form-recepcion')).toHaveCount(0)

    // ── El tablero refleja el valor real y el ledger del lote existe ──────
    await compras.goto('/superadmin/supply')
    await expect(compras.getByTestId('actividad-reciente')).toContainText('Orden recibida por completo')
    await compras.screenshot({ path: 'test-results/shots/supply-v2-tablero.png', fullPage: true })
    await compras.goto(urlOrden)
    await compras.getByTestId('lista-recepciones').getByRole('link', { name: /^LOT-/ }).first().click()
    await compras.waitForURL(/\/supply\/supply\/lotes\//)
    await expect(compras.getByTestId('tabla-ledger')).toContainText('RECEIPT')
    await expect(compras.getByTestId('lote-recibido')).toHaveText('500')

    await compras.screenshot({ path: 'test-results/shots/supply-v2-lote.png', fullPage: true })
    await ctxFinanzas.close()
    await ctxCompras.close()
  })

  test('sin sesión, Supply redirige al login', async ({ page }) => {
    await page.goto('/superadmin/supply')
    await page.waitForURL(/\/login/)
  })
})

test.describe('Supply · móvil', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'movil', 'solo viewport móvil')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('el tablero y el wizard se ven en un teléfono sin desbordar', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await entrarComo(ctx, 'compras', BASE)
    await page.goto('/superadmin/supply')
    await expect(page.getByRole('heading', { level: 1, name: 'Membego Supply' })).toBeVisible()
    await expect(page.getByTestId('kpi-unidades')).toBeVisible()
    await page.goto('/superadmin/supply/compras/nueva')
    await expect(page.getByTestId('wizard-compra')).toBeVisible()
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    expect(desborda).toBe(false)
    await page.screenshot({ path: 'test-results/shots/supply-v2-movil.png', fullPage: true })
    await ctx.close()
  })
})
