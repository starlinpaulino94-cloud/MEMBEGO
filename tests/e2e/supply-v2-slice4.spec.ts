import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 de punta a punta en navegador (§72–§75, §79).
 *
 *   PREPAID     Little Pizza → PO 1.000 × 300 → factura RD$300.000 → pago
 *               (compras registra, finanzas confirma) → factura PAGADA, PO pagada
 *               → recepción → oferta 399 → cliente compra y redime → Finanzas:
 *               proveedor pendiente 0 · ingreso 399 · costo 300 · margen 99
 *   DEPÓSITO    Proveedor B → anticipo 100.000 → factura 20.000 → depósito
 *               15.000 → transferencia 5.000 → factura PAGADA, depósito 85.000
 *   VENCIMIENTO cliente 2 compra, no usa; el arnés adelanta el reloj y dispara
 *               el cron → Vencido · emitidas −1 · breakage +1 · ingreso se conserva
 *   MÓVIL       resumen, facturas y perfil financiero usables en un teléfono
 *
 * El arnés toca la base SOLO para: usuarios de sesión, cuenta de cobro, la
 * empresa proveedora con su sucursal, adelantar el reloj de un derecho y leer
 * el ledger del lote. Todo lo demás pasa por la interfaz.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const CRON_SECRET = process.env.CRON_SECRET

type Datos = { sufijo: string; empresa: string; producto: string; oferta: string; proveedorB: string }

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return { sufijo, empresa: `Little Pizza S4 ${sufijo}`, producto: `Pizza Grande S4 ${sufijo}`, oferta: `Pizza Membego S4 ${sufijo}`, proveedorB: `Proveedor B S4 ${sufijo}` }
}

const RD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function contexto(browser: Browser, rol: 'compras' | 'finanzas' | 'cliente' | 'cliente2' | 'empleado' | 'empleado2', companyId: string | null = null): Promise<{ ctx: BrowserContext; page: Page; nombre: string }> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const u = await entrarComo(ctx, rol, BASE, companyId)
  return { ctx, page, nombre: u.nombre }
}

/** Slice 1 por la interfaz hasta la orden APROBADA (sin recibir). Devuelve la url de la orden. */
async function ordenAprobada(compras: Page, finanzas: Page, d: Datos): Promise<string> {
  await compras.goto('/superadmin/supply-v2/compras/nueva')
  await compras.getByRole('button', { name: '+ Crear proveedor' }).click()
  await compras.getByRole('button', { name: 'Sí, es una empresa de Membego' }).click()
  await compras.locator('#buscarEmpresa').fill(d.empresa)
  await compras.getByRole('option').filter({ hasText: d.empresa }).getByRole('button').click()
  await compras.getByRole('button', { name: /Vincular como proveedor|Usar este proveedor/ }).click()
  await compras.getByRole('button', { name: '+ Crear producto' }).click()
  await compras.locator('#productoNombre').fill(d.producto)
  await compras.locator('#productoPrecio').fill('600')
  await compras.getByRole('button', { name: 'Guardar y continuar' }).click()
  await compras.getByRole('button', { name: '+ Crear acuerdo' }).click()
  await compras.locator('#negotiatedUnitCost').fill('300')
  await expect(compras.getByTestId('acuerdo-politica')).toHaveValue('ON_INVOICE')
  await compras.getByRole('button', { name: 'Crear acuerdo y continuar' }).click()
  await compras.locator('#wizardCantidad').fill('1000')
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.getByRole('button', { name: 'Crear orden de compra' }).click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/compras\/(?!nueva)[a-z0-9]+$/)
  const urlOrden = compras.url()
  await compras.getByTestId('btn-enviar-aprobacion').click()
  await expect(compras.getByTestId('estado-orden')).toHaveText('Pendiente de aprobación')
  await finanzas.goto(urlOrden)
  await finanzas.getByTestId('btn-aprobar').click()
  await expect(finanzas.getByTestId('estado-orden')).toHaveText('Aprobada')
  return urlOrden
}

async function recibir(finanzas: Page, urlOrden: string): Promise<void> {
  await finanzas.goto(urlOrden)
  await finanzas.getByTestId('form-recepcion').locator('input[name="lineQuantity"]').fill('1000')
  await finanzas.getByTestId('btn-confirmar-recepcion').click()
  await expect(finanzas.getByTestId('recepcion-exito')).toContainText('la orden quedó completa')
}

async function ofertaPublicada(compras: Page, d: Datos): Promise<void> {
  await compras.goto('/superadmin/supply-v2/supply')
  const tarjeta = compras.getByTestId('pool-producto').filter({ hasText: d.producto })
  await tarjeta.getByTestId('btn-crear-oferta-producto').click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/ofertas\/nueva/)
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.locator('#ofertaCantidad').fill('100')
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.locator('#ofertaPrecioMembego').fill('399')
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.locator('#ofertaTitulo').fill(d.oferta)
  await compras.locator('#ofertaLimite').fill('2')
  await compras.getByRole('button', { name: 'Continuar' }).click()
  await compras.getByTestId('btn-publicar-oferta').click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/ofertas\/(?!nueva)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
}

/** El cliente compra 1 y avisa; finanzas confirma. Devuelve la url de la compra del cliente. */
async function compraPagada(cliente: Page, finanzas: Page, d: Datos, ref: string): Promise<string> {
  await cliente.goto('/promociones')
  await cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.oferta }).click()
  await cliente.waitForURL(/\/promociones\/membego\//)
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const urlCompra = cliente.url()
  await cliente.locator('#referenciaPago').fill(ref)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply-v2/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: d.oferta }).filter({ hasText: ref })
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: ref })).toHaveCount(0)
  return urlCompra
}

function beneficio(cliente: Page, d: Datos) {
  return cliente.getByTestId('beneficio').filter({ hasText: d.producto }).filter({ visible: true })
}

async function redimir(cliente: Page, empleado: Page, d: Datos): Promise<void> {
  await cliente.goto('/cliente/compras')
  const b = beneficio(cliente, d)
  await expect(b.getByTestId('derecho-estado')).toHaveText('Disponible')
  await b.getByTestId('btn-usar-beneficio').click()
  const qr = b.getByTestId('qr-beneficio')
  await expect(qr).toBeVisible()
  const nonce = (await qr.getByTestId('qr-codigo').innerText()).trim()
  await empleado.goto('/admin/supply-v2/escaner')
  await empleado.getByTestId('btn-codigo-manual').click()
  await empleado.getByTestId('input-codigo').fill(nonce)
  await empleado.getByTestId('btn-buscar-codigo').click()
  await expect(empleado.getByTestId('preview-valido')).toBeVisible()
  await empleado.getByTestId('btn-confirmar-entrega').click()
  await expect(empleado.getByTestId('entrega-confirmada')).toContainText('Entrega confirmada')
  await cliente.goto('/cliente/compras')
  await expect(beneficio(cliente, d).getByTestId('derecho-estado')).toHaveText('Utilizado')
}

async function pool(page: Page, d: Datos) {
  await page.goto('/superadmin/supply-v2/supply')
  const tarjeta = page.getByTestId('pool-producto').filter({ hasText: d.producto })
  const n = async (id: string) => Number((await tarjeta.getByTestId(id).innerText()).replace(/[^\d]/g, ''))
  return { disponibles: await n('pool-disponibles'), asignadas: await n('pool-asignadas'), emitidas: await n('pool-emitidas'), redimidas: await n('pool-redimidas') }
}

/** FINANZAS confirma el primer pago pendiente que coincide con el texto. */
async function confirmarPagoPendiente(finanzas: Page, texto: string): Promise<void> {
  await finanzas.goto('/superadmin/supply-v2/finanzas/pagos?estado=PENDING')
  const fila = finanzas.getByTestId('pago').filter({ hasText: texto }).first()
  await fila.getByTestId('btn-confirmar-pago-proveedor').click()
  await expect(finanzas.getByTestId('pago').filter({ hasText: texto })).toHaveCount(0)
}

async function disparaCron(): Promise<void> {
  const r = await fetch(`${BASE}/api/cron/supply-v2`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })
  expect(r.status).toBe(200)
}

// ── Recorridos ────────────────────────────────────────────────────────────────

async function prepaidYVencimiento(browser: Browser) {
  const d = datos()
  const db = prismaDeArnes()
  await db.supplyCuentaCobro.upsert({
    where: { id: 'e2e-cuenta-membego' },
    update: { activa: true },
    create: { id: 'e2e-cuenta-membego', tipo: 'TRANSFERENCIA', nombre: 'Banco E2E · Membego', titular: 'Membego SRL', numeroCuenta: '000-111-222', tipoCuenta: 'Corriente', instrucciones: 'Transfiere el monto exacto y avisa aquí.', activa: true },
  })
  const empresa = await asegurarEmpresaProveedora(d.empresa)
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente')
  const { page: cliente2 } = await contexto(browser, 'cliente2')
  const { page: empleado } = await contexto(browser, 'empleado', empresa.id)

  // ── PO aprobada; el proveedor sale del enlace de la orden ──────────────
  const urlOrden = await ordenAprobada(compras, finanzas, d)
  const hrefProveedor = await compras.locator('a[href*="/superadmin/supply-v2/proveedores/"]').first().getAttribute('href')
  const supplierId = hrefProveedor!.split('/').pop()!

  // ── COMPRAS registra la factura contra la orden (§35) ──────────────────
  await compras.goto(urlOrden)
  await expect(compras.getByTestId('timeline-dinero')).toContainText('PO creada')
  await compras.getByTestId('btn-factura-orden').click()
  await compras.waitForURL(/\/finanzas\/facturas\/nueva/)
  await expect(compras.getByTestId('factura-orden')).not.toHaveValue('')
  await expect(compras.getByTestId('factura-cantidad')).toHaveValue('1000')
  await expect(compras.getByTestId('factura-subtotal')).toHaveText(RD(300000))
  await compras.getByTestId('factura-numero').fill(`LP-${d.sufijo}-001`)
  await compras.getByTestId('btn-registrar-factura').click()
  await compras.waitForURL(/\/finanzas\/facturas\/(?!nueva)[a-z0-9]+$/)
  const urlFactura = compras.url()
  await expect(compras.getByTestId('estado-factura')).toHaveText('Pendiente de aprobación')
  await expect(compras.getByTestId('factura-total')).toHaveText(RD(300000))
  await expect(compras.getByTestId('factura-pendiente')).toHaveText(RD(300000))
  await expect(compras.getByTestId('btn-aprobar-factura')).toHaveCount(1)

  // La misma factura no se registra dos veces (§10).
  await compras.goto(`/superadmin/supply-v2/finanzas/facturas/nueva?proveedor=${supplierId}`)
  await compras.getByTestId('factura-concepto').fill('Duplicada a propósito')
  await compras.getByTestId('factura-costo').fill('1')
  await compras.getByTestId('factura-numero').fill(`LP-${d.sufijo}-001`)
  await compras.getByTestId('btn-registrar-factura').click()
  await expect(compras.getByRole('alert')).toContainText('ya está registrada')

  // ── FINANZAS aprueba: nace la obligación ───────────────────────────────
  await finanzas.goto(urlFactura)
  await finanzas.getByTestId('btn-aprobar-factura').click()
  await expect(finanzas.getByTestId('estado-factura')).toHaveText('Aprobada')
  await expect(finanzas.getByTestId('factura-obligaciones')).toContainText('Factura')
  await finanzas.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await expect(finanzas.getByTestId('fin-saldo')).toHaveText(RD(300000))
  await expect(finanzas.getByTestId('fin-facturas')).toHaveText('1')

  // ── COMPRAS registra el pago; FINANZAS lo confirma (§41) ───────────────
  await compras.goto(urlFactura)
  await compras.getByTestId('btn-registrar-pago-factura').click()
  await expect(compras.getByTestId('pago-monto')).toHaveValue('300000.00')
  await compras.getByTestId('pago-referencia').fill(`TRX-${d.sufijo}-PO`)
  await compras.getByTestId('btn-registrar-pago').click()
  await expect(compras.getByTestId('factura-pagos-pendientes')).toContainText(RD(300000))
  await expect(compras.getByTestId('factura-pendiente')).toHaveText(RD(300000))
  await confirmarPagoPendiente(finanzas, `TRX-${d.sufijo}-PO`)
  await finanzas.goto(urlFactura)
  await expect(finanzas.getByTestId('estado-factura')).toHaveText('Pagada')
  await expect(finanzas.getByTestId('factura-pagado')).toHaveText(RD(300000))
  await expect(finanzas.getByTestId('factura-pendiente')).toHaveText(RD(0))
  await expect(finanzas.getByTestId('factura-aplicaciones').getByTestId('aplicacion')).toHaveCount(1)
  await finanzas.goto(urlOrden)
  await expect(finanzas.getByTestId('estado-orden')).toHaveText('Pagada')
  await expect(finanzas.getByTestId('timeline-dinero')).toContainText('pagada')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s4-orden-pagada.png', fullPage: true })

  // ── Recepción, oferta, compra y redención (Slices 1–3 por la interfaz) ─
  await recibir(finanzas, urlOrden)
  await ofertaPublicada(compras, d)
  const urlCompra1 = await compraPagada(cliente, finanzas, d, `TRX-${d.sufijo}-C1`)
  await redimir(cliente, empleado, d)
  expect(await pool(compras, d)).toMatchObject({ disponibles: 900, asignadas: 99, emitidas: 0, redimidas: 1 })

  // ── FINANZAS: proveedor sin pendiente; economía 399 / 300 / 99 (§72, §79) ─
  await finanzas.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await expect(finanzas.getByTestId('fin-saldo')).toHaveText(RD(0))
  await expect(finanzas.getByTestId('fin-facturas')).toHaveText('0')
  await expect(finanzas.getByTestId('fin-pagado')).toHaveText(RD(300000))
  await expect(finanzas.getByTestId('timeline-proveedor')).toContainText('pagada')
  await finanzas.goto(`/superadmin/supply-v2/economia?ventana=HOY&proveedor=${supplierId}`)
  await expect(finanzas.getByTestId('eco-revenue')).toHaveText(RD(399))
  await expect(finanzas.getByTestId('eco-cost')).toHaveText(RD(300))
  await expect(finanzas.getByTestId('eco-margen')).toHaveText(RD(99))
  await expect(finanzas.getByTestId('eco-vendidas')).toHaveText('1')
  await expect(finanzas.getByTestId('eco-redimidas')).toHaveText('1')
  await expect(finanzas.getByTestId('eco-vencidas')).toHaveText('0')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s4-economia.png', fullPage: true })
  await finanzas.goto('/superadmin/supply-v2/finanzas')
  await expect(finanzas.getByTestId('kpi-cxp')).toBeVisible()
  await expect(finanzas.getByTestId('economia-sin-datos')).toHaveCount(0)
  // Timeline económico de la venta (§62), sin precios actuales.
  const idCompra1 = urlCompra1.split('/').pop()!
  await finanzas.goto(`/superadmin/supply-v2/ofertas/ventas/${idCompra1}`)
  await expect(finanzas.getByTestId('eco-cliente-pago')).toHaveText(RD(399))
  await expect(finanzas.getByTestId('eco-costo')).toHaveText(RD(300))
  await expect(finanzas.getByTestId('eco-margen')).toHaveText(RD(99))
  await expect(finanzas.getByTestId('timeline-economico')).toContainText('Redención')
  // Las obligaciones del proveedor: una sola, pagada; la redención no creó CxP.
  await finanzas.goto(`/superadmin/supply-v2/finanzas/obligaciones?proveedor=${supplierId}&estado=`)
  await expect(finanzas.getByTestId('obligacion')).toHaveCount(1)
  await expect(finanzas.getByTestId('obligacion').first().getByTestId('estado-obligacion')).toHaveText('Pagada')

  // ── VENCIMIENTO (§74): cliente 2 compra, no usa; el arnés adelanta el reloj ─
  const urlCompra2 = await compraPagada(cliente2, finanzas, d, `TRX-${d.sufijo}-C2`)
  expect(await pool(compras, d)).toMatchObject({ emitidas: 1, redimidas: 1 })
  const idCompra2 = urlCompra2.split('/').pop()!
  const derecho = await db.supplyV2Entitlement.findFirstOrThrow({ where: { orderId: idCompra2 }, select: { id: true, lotId: true } })
  const loteAntes = await db.supplyV2Lot.findUniqueOrThrow({ where: { id: derecho.lotId }, select: { quantityIssued: true, quantityClosed: true } })
  await db.supplyV2Entitlement.update({ where: { id: derecho.id }, data: { expiresAt: new Date(Date.now() - 60_000) } })
  await disparaCron()
  await cliente2.goto('/cliente/compras')
  await expect(beneficio(cliente2, d).getByTestId('derecho-estado')).toHaveText('Vencido')
  await expect(beneficio(cliente2, d).getByTestId('btn-usar-beneficio')).toHaveCount(0)
  expect(await pool(compras, d)).toMatchObject({ emitidas: 0, redimidas: 1 })
  const loteDespues = await db.supplyV2Lot.findUniqueOrThrow({ where: { id: derecho.lotId }, select: { quantityIssued: true, quantityClosed: true } })
  expect(loteDespues.quantityIssued).toBe(loteAntes.quantityIssued - 1)
  expect(loteDespues.quantityClosed).toBe(loteAntes.quantityClosed + 1)
  await finanzas.goto(`/superadmin/supply-v2/economia?ventana=HOY&proveedor=${supplierId}`)
  await expect(finanzas.getByTestId('eco-vendidas')).toHaveText('2')
  await expect(finanzas.getByTestId('eco-vencidas')).toHaveText('1')
  await expect(finanzas.getByTestId('eco-revenue')).toHaveText(RD(798), { timeout: 15_000 })
  await expect(finanzas.getByTestId('eco-cost')).toHaveText(RD(600))
  await finanzas.goto(`/superadmin/supply-v2/ofertas/ventas/${idCompra2}`)
  await expect(finanzas.getByTestId('estado-compra')).toHaveText('Pagada')
  await expect(finanzas.getByTestId('timeline-economico')).toContainText('breakage')
  await expect(finanzas.getByTestId('eco-costo')).toHaveText(RD(300))
  await finanzas.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await expect(finanzas.getByTestId('fin-saldo')).toHaveText(RD(0))
}

async function deposito(browser: Browser) {
  const d = datos()
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')

  // ── Proveedor B externo, por la interfaz ────────────────────────────────
  await compras.goto('/superadmin/supply-v2/proveedores')
  await compras.getByTestId('btn-nuevo-proveedor').click()
  await compras.getByRole('button', { name: 'No, es un proveedor externo' }).click()
  await compras.locator('#commercialName').fill(d.proveedorB)
  await compras.getByRole('button', { name: 'Guardar proveedor' }).click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/proveedores\/[a-z0-9]+$/)
  const supplierB = compras.url().split('/').pop()!
  await expect(compras.getByTestId('perfil-financiero')).toBeVisible()

  // ── Anticipo 100.000 → confirmado → depósito ───────────────────────────
  await compras.goto(`/superadmin/supply-v2/finanzas/pagos/nuevo?proveedor=${supplierB}&destino=DEPOSITO`)
  await expect(compras.getByTestId('pago-destino')).toHaveValue('DEPOSITO')
  await compras.getByTestId('pago-monto').fill('100000')
  await compras.getByTestId('pago-referencia').fill(`ANT-${d.sufijo}`)
  await compras.getByTestId('btn-registrar-pago').click()
  await expect(compras.getByText(/Otra persona autorizada debe confirmarlo/)).toBeVisible()
  await confirmarPagoPendiente(finanzas, `ANT-${d.sufijo}`)
  await finanzas.goto(`/superadmin/supply-v2/finanzas/depositos?proveedor=${supplierB}`)
  const filaDep = finanzas.getByTestId('deposito').filter({ hasText: d.proveedorB })
  await expect(filaDep.getByTestId('deposito-disponible')).toHaveText(RD(100000))
  await expect(filaDep.getByTestId('estado-deposito')).toHaveText('Activo')

  // ── Factura 20.000 sin orden (proveedor externo) → aprobada ────────────
  await compras.goto(`/superadmin/supply-v2/finanzas/facturas/nueva?proveedor=${supplierB}`)
  await compras.getByTestId('factura-numero').fill(`B-${d.sufijo}-1`)
  await compras.getByTestId('factura-concepto').fill('Cajas de jugo')
  await compras.locator('#facturaCantidad').fill('40')
  await compras.getByTestId('factura-costo').fill('500')
  await compras.getByTestId('btn-registrar-factura').click()
  await compras.waitForURL(/\/finanzas\/facturas\/(?!nueva)[a-z0-9]+$/)
  const urlFactura = compras.url()
  await expect(compras.getByTestId('factura-total')).toHaveText(RD(20000))
  await finanzas.goto(urlFactura)
  await finanzas.getByTestId('btn-aprobar-factura').click()
  await expect(finanzas.getByTestId('estado-factura')).toHaveText('Aprobada')

  // ── Aplicar depósito 15.000 ─────────────────────────────────────────────
  await finanzas.getByTestId('btn-aplicar-deposito').click()
  await finanzas.getByTestId('monto-deposito').fill('15000')
  await finanzas.getByTestId('btn-aplicar-deposito-confirmar').click()
  await expect(finanzas.getByTestId('estado-factura')).toHaveText('Parcialmente pagada')
  await expect(finanzas.getByTestId('factura-aplicado')).toHaveText(RD(15000))
  await expect(finanzas.getByTestId('factura-pendiente')).toHaveText(RD(5000))

  // ── Transferencia 5.000: compras registra, finanzas confirma ───────────
  await compras.goto(urlFactura)
  await compras.getByTestId('btn-registrar-pago-factura').click()
  await expect(compras.getByTestId('pago-monto')).toHaveValue('5000.00')
  await compras.getByTestId('pago-referencia').fill(`TRX-${d.sufijo}-5K`)
  await compras.getByTestId('btn-registrar-pago').click()
  await expect(compras.getByTestId('factura-pagos-pendientes')).toContainText(RD(5000))
  await confirmarPagoPendiente(finanzas, `TRX-${d.sufijo}-5K`)

  // ── Resultado (§73, §79): factura PAID · depósito 85.000 · pendiente 0 ─
  await finanzas.goto(urlFactura)
  await expect(finanzas.getByTestId('estado-factura')).toHaveText('Pagada')
  await expect(finanzas.getByTestId('factura-aplicado')).toHaveText(RD(15000))
  await expect(finanzas.getByTestId('factura-pagado')).toHaveText(RD(5000))
  await expect(finanzas.getByTestId('factura-pendiente')).toHaveText(RD(0))
  await expect(finanzas.getByTestId('factura-aplicaciones').getByTestId('aplicacion')).toHaveCount(2)
  await expect(finanzas.getByTestId('factura-timeline')).toContainText('Factura pagada')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s4-factura-deposito.png', fullPage: true })
  await finanzas.goto(`/superadmin/supply-v2/finanzas/depositos?proveedor=${supplierB}`)
  await expect(finanzas.getByTestId('deposito').filter({ hasText: d.proveedorB }).getByTestId('deposito-disponible')).toHaveText(RD(85000))
  await finanzas.getByTestId('deposito').filter({ hasText: d.proveedorB }).getByRole('link').first().click()
  await finanzas.waitForURL(/\/finanzas\/depositos\/[a-z0-9]+$/)
  await expect(finanzas.getByTestId('deposito-disponible')).toHaveText(RD(85000))
  await expect(finanzas.getByTestId('deposito-suma')).toHaveText(RD(85000))
  await expect(finanzas.getByTestId('deposito-movimientos').locator('tbody tr')).toHaveCount(2)
  await finanzas.goto(`/superadmin/supply-v2/proveedores/${supplierB}`)
  await expect(finanzas.getByTestId('fin-saldo')).toHaveText(RD(0))
  await expect(finanzas.getByTestId('fin-deposito')).toHaveText(RD(85000))
  await expect(finanzas.getByTestId('fin-pagado')).toHaveText(RD(105000))
  await expect(finanzas.getByTestId('timeline-proveedor')).toContainText('Depósito')
  await expect(finanzas.getByTestId('timeline-proveedor')).toContainText('Factura')
  await expect(finanzas.getByTestId('timeline-proveedor')).toContainText('Transferencia')
}

async function movil(browser: Browser) {
  const d = datos()
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: compras } = await contexto(browser, 'compras')
  // Un proveedor con un anticipo, para que el resumen y el perfil tengan cifras.
  await compras.goto('/superadmin/supply-v2/proveedores')
  await compras.getByTestId('btn-nuevo-proveedor').click()
  await compras.getByRole('button', { name: 'No, es un proveedor externo' }).click()
  await compras.locator('#commercialName').fill(d.proveedorB)
  await compras.getByRole('button', { name: 'Guardar proveedor' }).click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/proveedores\/[a-z0-9]+$/)
  const supplierB = compras.url().split('/').pop()!
  await compras.goto(`/superadmin/supply-v2/finanzas/pagos/nuevo?proveedor=${supplierB}&destino=DEPOSITO`)
  await compras.getByTestId('pago-monto').fill('1000')
  await compras.getByTestId('pago-referencia').fill(`MOV-${d.sufijo}`)
  await compras.getByTestId('btn-registrar-pago').click()
  await confirmarPagoPendiente(finanzas, `MOV-${d.sufijo}`)

  // Resumen, facturas y perfil financiero: visibles y sin scroll horizontal de página.
  await finanzas.goto('/superadmin/supply-v2/finanzas')
  await expect(finanzas.getByTestId('kpi-cxp')).toBeVisible()
  await expect(finanzas.getByTestId('kpi-depositos')).toBeVisible()
  const ancho = await finanzas.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  expect(ancho).toBe(true)
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s4-movil-finanzas.png', fullPage: true })
  await finanzas.goto('/superadmin/supply-v2/finanzas/facturas')
  await expect(finanzas.getByRole('heading', { name: 'Facturas de proveedor' })).toBeVisible()
  await expect(finanzas.getByTestId('btn-nueva-factura')).toBeVisible()
  await finanzas.goto(`/superadmin/supply-v2/proveedores/${supplierB}`)
  await expect(finanzas.getByTestId('perfil-financiero')).toBeVisible()
  await expect(finanzas.getByTestId('fin-deposito')).toHaveText(RD(1000))
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s4-movil-proveedor.png', fullPage: true })
}

test.describe('Supply 2.0 · Slice 4', () => {
  test.beforeAll(() => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(!CRON_SECRET, 'requiere CRON_SECRET para disparar el cron de vencimientos')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · PREPAID: PO → factura → pago → recepción → venta → redención → finanzas 0 / 399 / 300 / 99; y VENCIMIENTO con breakage', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(420_000)
    await prepaidYVencimiento(browser)
  })

  test('escritorio · DEPÓSITO: anticipo 100.000 → factura 20.000 → depósito 15.000 → transferencia 5.000 → PAGADA y 85.000', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(240_000)
    await deposito(browser)
  })

  test('móvil · resumen, facturas y perfil financiero del proveedor en un teléfono', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(180_000)
    await movil(browser)
  })
})
