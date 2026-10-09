import { test, expect, type Page } from '@playwright/test'
import { cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY · SLICE 2 de punta a punta en navegador (§57–§59).
 *
 *   ADMIN    supply recibido (Slice 1 por la interfaz) → Crear oferta → 100 a
 *            RD$399 → publicar → oferta ACTIVA → Supply 900 / 100
 *   CLIENTE  /promociones → Oferta Membego → RD$600 → RD$399 → Comprar →
 *            checkout con cuenta de Membego → «Ya pagué»
 *   ADMIN    Ventas y cobros → confirmar pago → derecho emitido
 *   CLIENTE  compra PAID, beneficio Disponible
 *   ADMIN    oferta: 99 disponibles · 1 vendida; Supply: 900 / 99 / 0 / 1
 *   EXPIRA   segunda compra → el arnés adelanta el reloj → cron → EXPIRADA,
 *            reservadas 0, asignadas restauradas
 *
 * El arnés toca la base SOLO para: los usuarios de sesión, una cuenta de
 * cobro de Membego (V1 la crea por su propia pantalla; aquí se siembra) y
 * adelantar el reloj de una reserva. Todo lo demás pasa por la interfaz.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const CRON_SECRET = process.env.CRON_SECRET
const sufijo = `${Date.now().toString(36)}`
const PROVEEDOR = `Little Pizza S2 ${sufijo}`
const PRODUCTO = `Pizza Grande Pepperoni S2 ${sufijo}`
const OFERTA = `Pizza Grande Pepperoni Membego ${sufijo}`

/** Slice 1 por la interfaz: proveedor → producto → acuerdo → PO 1.000 → aprobación → recepción 1.000. */
async function supplyRecibido(compras: Page, finanzas: Page): Promise<string> {
  await compras.goto('/superadmin/supply/compras/nueva')
  await compras.getByRole('button', { name: '+ Crear proveedor' }).click()
  await compras.getByRole('button', { name: 'No, es un proveedor externo' }).click()
  await compras.locator('#commercialName').fill(PROVEEDOR)
  await compras.getByRole('button', { name: 'Guardar y continuar' }).click()
  await compras.getByRole('button', { name: '+ Crear producto' }).click()
  await compras.locator('#productoNombre').fill(PRODUCTO)
  await compras.locator('#productoPrecio').fill('600')
  await compras.getByRole('button', { name: 'Guardar y continuar' }).click()
  await compras.getByRole('button', { name: '+ Crear acuerdo' }).click()
  await compras.locator('#negotiatedUnitCost').fill('300')
  await compras.getByRole('button', { name: 'Crear acuerdo y continuar' }).click()
  await compras.locator('#wizardCantidad').fill('1000')
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.getByRole('button', { name: 'Crear orden de compra' }).click()
  await compras.waitForURL(/\/superadmin\/supply\/compras\/(?!nueva)[a-z0-9]+$/)
  const urlOrden = compras.url()
  await compras.getByTestId('btn-enviar-aprobacion').click()
  await expect(compras.getByTestId('estado-orden')).toHaveText('Pendiente de aprobación')
  await finanzas.goto(urlOrden)
  await finanzas.getByTestId('btn-aprobar').click()
  await expect(finanzas.getByTestId('estado-orden')).toHaveText('Aprobada')
  const form = finanzas.getByTestId('form-recepcion')
  await form.locator('input[name="lineQuantity"]').fill('1000')
  await finanzas.getByTestId('btn-confirmar-recepcion').click()
  await expect(finanzas.getByTestId('recepcion-exito')).toContainText('la orden quedó completa')
  return urlOrden
}

async function disponiblesDelProducto(page: Page) {
  await page.goto('/superadmin/supply/supply')
  const tarjeta = page.getByTestId('pool-producto').filter({ hasText: PRODUCTO })
  await expect(tarjeta).toBeVisible()
  const n = async (id: string) => Number((await tarjeta.getByTestId(id).innerText()).replace(/[^\d]/g, ''))
  return { disponibles: await n('pool-disponibles'), asignadas: await n('pool-asignadas'), reservadas: await n('pool-reservadas'), emitidas: await n('pool-emitidas'), tarjeta }
}

test.describe('Supply · Slice 2', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('supply → oferta publicada → cliente compra → pago confirmado → derecho; y la reserva expira por el cron', async ({ browser }) => {
    test.setTimeout(300_000)
    test.skip(!CRON_SECRET, 'requiere CRON_SECRET para disparar el cron de expiración')

    // Cuenta de cobro de Membego: la crea el arnés (en producción se registra desde Supply V1 → Cobros → Cuentas).
    const db = prismaDeArnes()
    await db.supplyCuentaCobro.upsert({
      where: { id: 'e2e-cuenta-membego' },
      update: { activa: true },
      create: { id: 'e2e-cuenta-membego', tipo: 'TRANSFERENCIA', nombre: 'Banco E2E · Membego', titular: 'Membego SRL', numeroCuenta: '000-111-222', tipoCuenta: 'Corriente', instrucciones: 'Transfiere el monto exacto y avisa aquí.', activa: true },
    })

    const ctxCompras = await browser.newContext()
    const compras = await ctxCompras.newPage()
    await entrarComo(ctxCompras, 'compras', BASE)
    const ctxFinanzas = await browser.newContext()
    const finanzas = await ctxFinanzas.newPage()
    await entrarComo(ctxFinanzas, 'finanzas', BASE)

    // ── Slice 1 por la interfaz: 1.000 unidades recibidas ────────────────
    await supplyRecibido(compras, finanzas)
    let pool = await disponiblesDelProducto(compras)
    expect(pool).toMatchObject({ disponibles: 1000, asignadas: 0, reservadas: 0, emitidas: 0 })

    // ── ADMIN · Crear oferta desde Supply ─────────────────────────────────
    await pool.tarjeta.getByTestId('btn-crear-oferta-producto').click()
    await compras.waitForURL(/\/superadmin\/supply\/ofertas\/nueva/)
    await expect(compras.getByTestId('oferta-producto-resumen')).toContainText('1,000')
    await compras.getByRole('button', { name: 'Continuar' }).click()
    await compras.locator('#ofertaCantidad').fill('100')
    await expect(compras.getByText('Quedarán sin asignar')).toBeVisible()
    await compras.getByRole('button', { name: 'Continuar' }).click()
    await expect(compras.locator('#ofertaPrecioPublico')).toHaveValue('600.00')
    await compras.locator('#ofertaPrecioMembego').fill('399')
    await expect(compras.getByTestId('oferta-precio-resumen')).toContainText('33.5 %')
    await expect(compras.getByTestId('oferta-precio-resumen')).toContainText('RD$201.00')
    await compras.getByRole('button', { name: 'Continuar' }).click()
    await compras.getByRole('button', { name: 'Continuar' }).click()
    await compras.locator('#ofertaTitulo').fill(OFERTA)
    await compras.locator('#ofertaLimite').fill('2')
    await compras.getByRole('button', { name: 'Continuar' }).click()
    await expect(compras.getByTestId('form-publicar-oferta')).toContainText('RD$399.00')
    await compras.getByTestId('btn-publicar-oferta').click()
    await compras.waitForURL(/\/superadmin\/supply\/ofertas\/(?!nueva)[a-z0-9]+$/)
    const urlOferta = compras.url()
    await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
    await expect(compras.getByTestId('oferta-asignadas')).toHaveText('100')
    await expect(compras.getByTestId('oferta-disponibles')).toHaveText('100')
    await compras.screenshot({ path: 'test-results/shots/supply-v2-oferta-publicada.png', fullPage: true })
    pool = await disponiblesDelProducto(compras)
    expect(pool).toMatchObject({ disponibles: 900, asignadas: 100, reservadas: 0, emitidas: 0 })

    // ── Sin sesión: la oferta se ve pero pide iniciar sesión ──────────────
    const anonimo = await browser.newPage()
    await anonimo.goto('/promociones')
    // La página sale en streaming: mientras llega, la sección existe dos veces (la copia oculta de la hidratación). Se mira la visible.
    const seccion = anonimo.getByTestId('ofertas-membego').filter({ visible: true }).first()
    await expect(seccion).toBeVisible()
    const tarjetaOferta = seccion.getByTestId('oferta-membego-card').filter({ hasText: OFERTA })
    await expect(tarjetaOferta).toBeVisible()
    await tarjetaOferta.click()
    await anonimo.waitForURL(/\/promociones\/membego\//)
    const urlPublica = anonimo.url()
    await expect(anonimo.getByTestId('btn-comprar-login')).toBeVisible()
    // Nada interno llega al HTML público.
    const html = await anonimo.content()
    expect(html).not.toMatch(/unitCost|actualUnitCost|LOT-\d{4}|allocation/i)
    await anonimo.close()

    // ── CLIENTE · ver, comprar, reservar, checkout, avisar pago ───────────
    // Next 16.3 deja unos instantes la página anterior OCULTA en el DOM al navegar:
    // se filtra por visible (igual que los arneses de los Slices 3 y 4).
    const ctxCliente = await browser.newContext()
    const cliente = await ctxCliente.newPage()
    await entrarComo(ctxCliente, 'cliente', BASE)
    await cliente.goto(urlPublica)
    await expect(cliente.getByTestId('oferta-titulo').filter({ visible: true })).toHaveText(OFERTA)
    await expect(cliente.getByTestId('oferta-precio-regular').filter({ visible: true })).toContainText('600')
    await expect(cliente.getByTestId('oferta-precio-membego').filter({ visible: true })).toContainText('399')
    await expect(cliente.getByTestId('oferta-ahorro').filter({ visible: true })).toContainText('201')
    await cliente.getByTestId('btn-comprar').filter({ visible: true }).click()
    await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
    const urlCompra = cliente.url()
    await expect(cliente.getByTestId('estado-compra').filter({ visible: true })).toHaveText('Pendiente de pago')
    await expect(cliente.getByTestId('checkout-producto').filter({ visible: true })).toHaveText(OFERTA)
    await expect(cliente.getByTestId('checkout-total').filter({ visible: true })).toContainText('399.00')
    await expect(cliente.getByTestId('checkout-cuenta').filter({ visible: true })).toContainText('000-111-222')
    await expect(cliente.getByTestId('cuenta-atras').filter({ visible: true })).toBeVisible()
    await cliente.screenshot({ path: 'test-results/shots/supply-v2-checkout.png', fullPage: true })

    // La reserva ya descuenta de la oferta.
    await compras.goto(urlOferta)
    await expect(compras.getByTestId('oferta-reservadas')).toHaveText('1')
    await expect(compras.getByTestId('oferta-disponibles')).toHaveText('99')

    await cliente.locator('#referenciaPago').filter({ visible: true }).fill('TRX-E2E-001')
    await cliente.getByTestId('btn-avisar-pago').filter({ visible: true }).click()
    await expect(cliente.getByTestId('checkout-en-revision').filter({ visible: true })).toBeVisible()
    await expect(cliente.getByTestId('estado-compra').filter({ visible: true })).toHaveText('Pago en revisión')

    // ── ADMIN · confirmar el pago ─────────────────────────────────────────
    await finanzas.goto('/superadmin/supply/ofertas/ventas')
    const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: OFERTA })
    await expect(venta).toContainText('TRX-E2E-001')
    await venta.getByTestId('btn-confirmar-pago').click()
    await venta.getByTestId('btn-confirmar-pago-confirmar').click()
    await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: OFERTA })).toHaveCount(0)

    // ── CLIENTE · compra PAID y beneficio disponible ──────────────────────
    await cliente.goto(urlCompra)
    await expect(cliente.getByTestId('estado-compra').filter({ visible: true })).toHaveText('Pagada')
    await expect(cliente.getByTestId('checkout-pagada').filter({ visible: true })).toContainText('Tu beneficio está disponible')
    await expect(cliente.getByTestId('derecho').filter({ visible: true })).toHaveCount(1)
    await expect(cliente.getByTestId('derecho-estado').filter({ visible: true })).toHaveText('Disponible')
    await cliente.goto('/cliente/compras')
    await expect(cliente.getByTestId('mis-derechos').filter({ visible: true })).toContainText(PRODUCTO)
    await cliente.screenshot({ path: 'test-results/shots/supply-v2-cliente-beneficio.png', fullPage: true })

    // ── ADMIN · la oferta y el pool reflejan la venta ─────────────────────
    await compras.goto(urlOferta)
    await expect(compras.getByTestId('oferta-vendidas')).toHaveText('1')
    await expect(compras.getByTestId('oferta-reservadas')).toHaveText('0')
    await expect(compras.getByTestId('oferta-disponibles')).toHaveText('99')
    await expect(compras.getByTestId('oferta-ledger')).toContainText('ISSUE')
    pool = await disponiblesDelProducto(compras)
    expect(pool).toMatchObject({ disponibles: 900, asignadas: 99, reservadas: 0, emitidas: 1 })

    // ── El cliente no puede ver compras ajenas ────────────────────────────
    const ctxOtro = await browser.newContext()
    const otro = await ctxOtro.newPage()
    await entrarComo(ctxOtro, 'cliente2', BASE)
    await otro.goto(urlCompra)
    // La compra de otra persona no existe para este cliente: ni total, ni
    // producto, ni cuenta de cobro. (Next puede responder 200 al transmitir la
    // página «no encontrada»; lo que importa es que no llega ningún dato.)
    await expect(otro.getByTestId('checkout-total')).toHaveCount(0)
    await expect(otro.getByTestId('checkout-producto')).toHaveCount(0)
    await expect(otro.getByTestId('estado-compra')).toHaveCount(0)
    expect(await otro.content()).not.toContain('000-111-222')
    await ctxOtro.close()

    // ── EXPIRACIÓN · segunda compra, reloj adelantado, cron ───────────────
    await cliente.goto(urlPublica)
    await cliente.getByTestId('btn-comprar').filter({ visible: true }).click()
    await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
    const urlSegunda = cliente.url()
    const idSegunda = urlSegunda.split('/').pop()!
    await compras.goto(urlOferta)
    await expect(compras.getByTestId('oferta-reservadas')).toHaveText('1')
    // El arnés adelanta el reloj de la reserva (equivalente determinista a esperar el TTL).
    await db.supplyV2CustomerOrder.update({ where: { id: idSegunda }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    const cron = await cliente.request.get(`${BASE}/api/cron/supply-v2`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })
    expect(cron.ok()).toBe(true)
    expect((await cron.json()).ordenesExpiradas).toBeGreaterThanOrEqual(1)
    await cliente.goto(urlSegunda)
    await expect(cliente.getByTestId('estado-compra').filter({ visible: true })).toHaveText('Expirada')
    await expect(cliente.getByTestId('checkout-cerrada').filter({ visible: true })).toContainText('La reserva venció')
    await compras.goto(urlOferta)
    await expect(compras.getByTestId('oferta-reservadas')).toHaveText('0')
    await expect(compras.getByTestId('oferta-disponibles')).toHaveText('99')
    await expect(compras.getByTestId('oferta-vendidas')).toHaveText('1')
    pool = await disponiblesDelProducto(compras)
    expect(pool).toMatchObject({ disponibles: 900, asignadas: 99, reservadas: 0, emitidas: 1 })

    // Sin sesión, el cron se niega.
    const sinSecreto = await cliente.request.get(`${BASE}/api/cron/supply-v2`)
    expect(sinSecreto.status()).toBe(401)

    await ctxCliente.close()
    await ctxFinanzas.close()
    await ctxCompras.close()
  })
})
