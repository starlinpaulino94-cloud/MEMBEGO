import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE, pasarALaFichaDeLaApp } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY · SLICE 5 de punta a punta en navegador (§84–§88).
 *
 *   COMISIÓN     Tours Caribe → acuerdo CATÁLOGO 5 % → acuerdo PRODUCTO 10 %
 *                (override) → oferta a comisión «Saona» 1 000 (10 unidades) →
 *                el wizard muestra la regla resuelta → cliente compra y paga
 *                (finanzas ve comisión 100 / neto 900) → SQL: sin lote, sin
 *                asiento, sin PO → portal del proveedor: pendiente de entregar
 *                → entrega → obligación 900 → liquidación (compras genera, NO
 *                puede aprobar; finanzas aprueba) → pago 900 (finanzas registra,
 *                compras confirma) → liquidación PAGADA → portal: pagado 900 →
 *                conciliación de comisión con discrepancia resuelta → economía:
 *                ingreso 100, costo 0, neto 900.
 *   CATÁLOGO     «Gorra» (otra categoría) cae al 5 % de catálogo, sin tope.
 *   MÓVIL        cliente compra la oferta a comisión en un teléfono; el
 *                proveedor ve Ventas Membego en un teléfono.
 *
 * El arnés toca la base SOLO para: usuarios de sesión, cuenta de cobro, la
 * empresa proveedora con su sucursal y las comprobaciones SQL de que NO existe
 * inventario de Membego. Todo lo demás pasa por la interfaz.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'

type Datos = { sufijo: string; empresa: string; saona: string; gorra: string; ofertaSaona: string; ofertaGorra: string }

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return { sufijo, empresa: `Tours Caribe S5 ${sufijo}`, saona: `Excursión Saona S5 ${sufijo}`, gorra: `Gorra S5 ${sufijo}`, ofertaSaona: `Saona Membego S5 ${sufijo}`, ofertaGorra: `Gorra Membego S5 ${sufijo}` }
}

const RD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function contexto(browser: Browser, rol: 'compras' | 'finanzas' | 'cliente' | 'cliente2' | 'empleado' | 'empleado2', companyId: string | null = null): Promise<{ ctx: BrowserContext; page: Page; nombre: string }> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const u = await entrarComo(ctx, rol, BASE, companyId)
  return { ctx, page, nombre: u.nombre }
}

/** Vincula la empresa como proveedor desde la lista de proveedores. Devuelve el id del proveedor. */
async function proveedorVinculado(compras: Page, d: Datos): Promise<string> {
  await compras.goto('/superadmin/supply/proveedores')
  await compras.getByTestId('btn-nuevo-proveedor').click()
  await compras.getByRole('button', { name: 'Sí, es una empresa de Membego' }).click()
  await compras.locator('#buscarEmpresa').fill(d.empresa)
  await compras.getByRole('option').filter({ hasText: d.empresa }).getByRole('button').click()
  await compras.getByRole('button', { name: /Vincular como proveedor|Usar este proveedor/ }).click()
  await compras.waitForURL(/\/superadmin\/supply\/proveedores\/[a-z0-9]+$/)
  return compras.url().split('/').pop()!
}

async function producto(compras: Page, supplierId: string, nombre: string, categoria: string, precio: string): Promise<void> {
  await compras.goto(`/superadmin/supply/proveedores/${supplierId}`)
  await compras.getByTestId('btn-agregar-producto').click()
  await compras.locator('#productoNombre').fill(nombre)
  await compras.locator('#productoCategoria').fill(categoria)
  await compras.locator('#productoPrecio').fill(precio)
  await compras.getByRole('button', { name: 'Agregar producto' }).click()
  await expect(compras.getByTestId('tabla-catalogo')).toContainText(nombre)
}

/** Un acuerdo a COMISIÓN desde la ficha del proveedor: por catálogo o por producto. */
async function acuerdoComision(compras: Page, supplierId: string, pct: string, alcance: 'CATALOG' | 'ITEM', productoNombre?: string): Promise<void> {
  await compras.goto(`/superadmin/supply/proveedores/${supplierId}`)
  await compras.getByTestId('btn-crear-acuerdo').click()
  await compras.getByTestId('acuerdo-tipo-COMMISSION').click()
  await compras.getByTestId('acuerdo-alcance').getByRole('radio', { name: alcance === 'ITEM' ? 'Por producto' : 'Todo el catálogo' }).check()
  if (alcance === 'ITEM' && productoNombre) await compras.locator('#acuerdoProducto').selectOption({ label: productoNombre })
  await compras.getByTestId('acuerdo-comision').fill(pct)
  await expect(compras.getByTestId('acuerdo-politica-fija')).toHaveText('Al entregar al cliente')
  await compras.getByRole('button', { name: 'Crear acuerdo' }).click()
  await expect(compras.getByTestId('lista-acuerdos')).toContainText(`comisión ${pct}`)
}

/** El wizard de comisión: comprueba la regla resuelta y publica. Devuelve la url de la oferta. */
async function ofertaComisionPublicada(compras: Page, d: Datos, o: { producto: string; titulo: string; pctEsperado: string; reglaEsperada: string; precio: string; modo: 'FIXED_QUANTITY' | 'UNLIMITED'; cantidad?: string; limite: string; comisionEsperada: number; netoEsperado: number }): Promise<string> {
  await compras.goto('/superadmin/supply/ofertas/nueva')
  await expect(compras.getByTestId('elegir-fuente')).toBeVisible()
  await compras.getByTestId('fuente-comision').click()
  await compras.waitForURL(/fuente=COMMISSION/)
  await compras.getByTestId('comision-producto').selectOption({ label: new RegExp(o.producto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) as never }).catch(async () => {
    const opciones = await compras.getByTestId('comision-producto').locator('option').allTextContents()
    const i = opciones.findIndex((t) => t.includes(o.producto))
    await compras.getByTestId('comision-producto').selectOption({ index: i })
  })
  const regla = compras.getByTestId('comision-regla')
  await expect(regla).toContainText(`${o.pctEsperado} %`)
  await expect(regla).toContainText(o.reglaEsperada)
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId(`comision-modo-${o.modo}`).click()
  if (o.modo !== 'UNLIMITED') await compras.getByTestId('comision-cantidad').fill(o.cantidad ?? '10')
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-precio').fill(o.precio)
  await expect(compras.getByTestId('comision-reparto')).toContainText(RD(o.comisionEsperada))
  await expect(compras.getByTestId('comision-reparto')).toContainText(RD(o.netoEsperado))
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-titulo').fill(o.titulo)
  await compras.locator('#ofertaLimiteC').fill(o.limite)
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('btn-publicar-oferta-comision').click()
  await compras.waitForURL(/\/superadmin\/supply\/ofertas\/(?!nueva)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
  await expect(compras.getByTestId('chip-modelo')).toHaveText('Comisión')
  await expect(compras.getByTestId('oferta-comision')).toBeVisible()
  await expect(compras.getByTestId('comision-pct')).toHaveText(`${o.pctEsperado} %`)
  await expect(compras.getByTestId('oferta-sin-lotes')).toBeVisible()
  void d
  return compras.url()
}

/** El cliente compra 1 y avisa; finanzas confirma viendo el reparto. Devuelve la url de la compra. */
async function compraPagada(cliente: Page, finanzas: Page, titulo: string, ref: string, reparto?: { comision: number; neto: number }): Promise<string> {
  await cliente.goto('/promociones')
  await cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: titulo }).filter({ visible: true }).first().click()
  await pasarALaFichaDeLaApp(cliente)
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const urlCompra = cliente.url()
  await cliente.locator('#referenciaPago').fill(ref)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: titulo }).filter({ hasText: ref })
  await expect(venta.getByTestId('chip-modelo')).toHaveText('Comisión')
  if (reparto) await expect(venta.getByTestId('venta-reparto')).toContainText(`comisión ${RD(reparto.comision)} · neto ${RD(reparto.neto)}`)
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: ref })).toHaveCount(0)
  return urlCompra
}

function beneficio(cliente: Page, producto: string) {
  return cliente.getByTestId('beneficio').filter({ hasText: producto }).filter({ visible: true })
}

async function redimir(cliente: Page, empleado: Page, producto: string): Promise<void> {
  await cliente.goto('/cliente/compras')
  const b = beneficio(cliente, producto)
  await expect(b.getByTestId('derecho-estado')).toHaveText('Disponible')
  await b.getByTestId('btn-usar-beneficio').click()
  const qr = b.getByTestId('qr-beneficio')
  await expect(qr).toBeVisible()
  const nonce = (await qr.getByTestId('qr-codigo').innerText()).trim()
  await empleado.goto('/admin/supply/escaner')
  await empleado.getByTestId('btn-codigo-manual').click()
  await empleado.getByTestId('input-codigo').fill(nonce)
  await empleado.getByTestId('btn-buscar-codigo').click()
  await expect(empleado.getByTestId('preview-valido')).toBeVisible()
  await empleado.getByTestId('btn-confirmar-entrega').click()
  await expect(empleado.getByTestId('entrega-confirmada')).toContainText('Entrega confirmada')
  await cliente.goto('/cliente/compras')
  await expect(beneficio(cliente, producto).getByTestId('derecho-estado')).toHaveText('Utilizado')
}

async function confirmarPagoPendiente(quien: Page, texto: string): Promise<void> {
  await quien.goto('/superadmin/supply/finanzas/pagos?estado=PENDING')
  const fila = quien.getByTestId('pago').filter({ hasText: texto }).first()
  await fila.getByTestId('btn-confirmar-pago-proveedor').click()
  await expect(quien.getByTestId('pago').filter({ hasText: texto })).toHaveCount(0)
}

/** SQL (§87): una venta a comisión NO deja inventario de Membego. */
async function sinInventario(orderId: string, catalogItemName: string) {
  const db = prismaDeArnes()
  const derechos = await db.supplyV2Entitlement.findMany({ where: { orderId }, select: { id: true, lotId: true, allocationId: true, sourceType: true, commissionAmount: true, supplierNet: true } })
  expect(derechos.length).toBeGreaterThan(0)
  for (const e of derechos) {
    expect(e.sourceType).toBe('COMMISSION')
    expect(e.lotId).toBeNull()
    expect(e.allocationId).toBeNull()
  }
  const item = await db.supplyV2CatalogItem.findFirstOrThrow({ where: { name: catalogItemName }, select: { id: true } })
  expect(await db.supplyV2Lot.count({ where: { catalogItemId: item.id } })).toBe(0)
  expect(await db.supplyV2Allocation.count({ where: { catalogItemId: item.id } })).toBe(0)
  expect(await db.supplyV2PurchaseOrderLine.count({ where: { catalogItemId: item.id } })).toBe(0)
  const red = await db.supplyV2Redemption.findMany({ where: { entitlementId: { in: derechos.map((d) => d.id) } }, select: { id: true, lotId: true } })
  for (const r of red) expect(r.lotId).toBeNull()
  expect(await db.supplyV2LedgerEntry.count({ where: { OR: [{ referenceType: 'CUSTOMER_ORDER', referenceId: orderId }, { referenceType: 'ENTITLEMENT', referenceId: { in: derechos.map((d) => d.id) } }, { referenceType: 'REDEMPTION', referenceId: { in: red.map((r) => r.id) } }] } })).toBe(0)
  return derechos
}

// ── Recorridos ────────────────────────────────────────────────────────────────

async function comisionCompleta(browser: Browser) {
  const d = datos()
  const db = prismaDeArnes()
  await db.supplyCuentaCobro.upsert({
    where: { id: 'e2e-cuenta-membego' },
    update: { activa: true },
    create: { id: 'e2e-cuenta-membego', tipo: 'TRANSFERENCIA', nombre: 'Banco E2E · Membego', titular: 'Membego SRL', numeroCuenta: '000-111-222', tipoCuenta: 'Corriente', instrucciones: 'Transfiere el monto exacto y avisa aquí.', activa: true },
  })
  const empresa = await asegurarEmpresaProveedora(d.empresa, 'Punta Cana')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente')
  const { page: cliente2 } = await contexto(browser, 'cliente2')
  const { page: empleado } = await contexto(browser, 'empleado', empresa.id)

  // ── Proveedor, dos productos, acuerdo de CATÁLOGO 5 % y override por PRODUCTO 10 % ──
  const supplierId = await proveedorVinculado(compras, d)
  await producto(compras, supplierId, d.saona, 'Tours', '1200')
  await producto(compras, supplierId, d.gorra, 'Merch', '300')
  await acuerdoComision(compras, supplierId, '5', 'CATALOG')
  await acuerdoComision(compras, supplierId, '10', 'ITEM', d.saona)
  await compras.screenshot({ path: 'test-results/shots/supply-v2-s5-acuerdos.png', fullPage: true })

  // ── Oferta a comisión: el wizard enseña la regla resuelta (producto gana a catálogo) ──
  const urlOfertaSaona = await ofertaComisionPublicada(compras, d, { producto: d.saona, titulo: d.ofertaSaona, pctEsperado: '10.00', reglaEsperada: 'por producto', precio: '1000', modo: 'FIXED_QUANTITY', cantidad: '10', limite: '2', comisionEsperada: 100, netoEsperado: 900 })
  await expect(compras.getByTestId('comision-libres')).toHaveText('10')
  await compras.screenshot({ path: 'test-results/shots/supply-v2-s5-oferta-comision.png', fullPage: true })
  // Catálogo (§86): la gorra no tiene regla propia → 5 % de todo el catálogo, sin tope.
  await ofertaComisionPublicada(compras, d, { producto: d.gorra, titulo: d.ofertaGorra, pctEsperado: '5.00', reglaEsperada: 'de todo el catálogo', precio: '250', modo: 'UNLIMITED', limite: '3', comisionEsperada: 12.5, netoEsperado: 237.5 })
  await expect(compras.getByTestId('comision-libres')).toHaveText('Sin tope')
  await compras.goto('/superadmin/supply/ofertas')
  const filaSaona = compras.getByTestId('tabla-ofertas').locator('tr').filter({ hasText: d.ofertaSaona })
  await expect(filaSaona.getByTestId('chip-modelo')).toHaveText('Comisión')
  await expect(filaSaona.getByTestId('oferta-disponibles')).toHaveText('10')

  // ── El cliente compra Saona a 1 000; finanzas ve comisión 100 / neto 900 y confirma ──
  const urlCompra = await compraPagada(cliente, finanzas, d.ofertaSaona, `TRX-${d.sufijo}-C1`, { comision: 100, neto: 900 })
  const orderId = urlCompra.split('/').pop()!
  await sinInventario(orderId, d.saona)
  await compras.goto(urlOfertaSaona)
  await expect(compras.getByTestId('comision-vendidas')).toHaveText('1')
  await expect(compras.getByTestId('comision-libres')).toHaveText('9')
  await expect(compras.getByTestId('comision-gmv')).toHaveText(RD(1000))
  await expect(compras.getByTestId('comision-monto')).toHaveText(RD(100))
  await expect(compras.getByTestId('comision-neto')).toHaveText(RD(900))
  await expect(compras.getByTestId('comision-devengado')).toHaveText(RD(0))
  await expect(compras.getByTestId('oferta-sin-ledger')).toBeVisible()
  // Todavía no se le debe nada al proveedor: no entregó.
  await finanzas.goto(`/superadmin/supply/finanzas/obligaciones?proveedor=${supplierId}&estado=`)
  await expect(finanzas.getByTestId('obligacion')).toHaveCount(0)

  // ── Portal del proveedor: la venta aparece pendiente de entregar, con su neto ──
  await empleado.goto('/admin/supply')
  await expect(empleado.getByTestId('portal-ventas-pendientes')).toHaveText('1')
  await empleado.getByTestId('link-portal-ventas').click()
  await empleado.waitForURL(/\/admin\/supply\/ventas/)
  await expect(empleado.getByTestId('ventas-pendientes')).toHaveText('1')
  await expect(empleado.getByTestId('ventas-entregadas')).toHaveText('0')
  await expect(empleado.getByTestId('ventas-monto-pendiente')).toHaveText(RD(0))
  const venta = empleado.getByTestId('venta-proveedor').filter({ hasText: d.saona })
  await expect(venta.getByTestId('venta-neto')).toHaveText(RD(900))
  await expect(venta).toContainText(`cliente pagó ${RD(1000)}`)
  // El proveedor ve bruto y neto; nunca la comisión como cifra de Membego por venta.
  await expect(venta).not.toContainText(RD(100))
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s5-portal-ventas.png', fullPage: true })

  // ── Entrega = cumplimiento: nace la obligación por el neto (900) ──
  await redimir(cliente, empleado, d.saona)
  await empleado.goto('/admin/supply/ventas')
  await expect(empleado.getByTestId('ventas-entregadas')).toHaveText('1')
  await expect(empleado.getByTestId('ventas-monto-pendiente')).toHaveText(RD(900))
  await finanzas.goto(`/superadmin/supply/finanzas/obligaciones?proveedor=${supplierId}&estado=`)
  await expect(finanzas.getByTestId('obligacion')).toHaveCount(1)
  await expect(finanzas.getByTestId('obligacion').first().getByTestId('obligacion-pendiente')).toHaveText(RD(900))
  await expect(finanzas.getByTestId('obligacion').first().getByTestId('estado-obligacion')).toHaveText('Pendiente')
  await compras.goto(urlOfertaSaona)
  await expect(compras.getByTestId('comision-entregadas')).toHaveText('1')
  await expect(compras.getByTestId('comision-devengado')).toHaveText(RD(900))
  await expect(compras.getByTestId('comision-pendiente')).toHaveText(RD(900))
  await sinInventario(orderId, d.saona)
  // La ficha de la redención lo dice: sin lote, comisión 100, neto 900.
  await finanzas.goto('/superadmin/supply/redenciones')
  await finanzas.locator('a[href*="/superadmin/supply/redenciones/"]').first().click()
  await finanzas.waitForURL(/\/redenciones\/[a-z0-9]+$/)
  await expect(finanzas.getByTestId('redencion-sin-lote')).toBeVisible()
  await expect(finanzas.getByTestId('redencion-neto')).toContainText('RD$900')

  // ── Economía (§88): ingreso = comisión 100, costo 0; neto 900 separado; prepago 0 ──
  await finanzas.goto(`/superadmin/supply/economia?ventana=HOY&proveedor=${supplierId}`)
  await expect(finanzas.getByTestId('eco-gmv')).toHaveText(RD(1000))
  await expect(finanzas.getByTestId('eco-revenue')).toHaveText(RD(100))
  await expect(finanzas.getByTestId('eco-cost')).toHaveText(RD(0))
  await expect(finanzas.getByTestId('eco-margen')).toHaveText(RD(100))
  await expect(finanzas.getByTestId('eco-comision-gmv')).toHaveText(RD(1000))
  await expect(finanzas.getByTestId('eco-comision-revenue')).toHaveText(RD(100))
  await expect(finanzas.getByTestId('eco-comision-neto')).toHaveText(RD(900))
  await expect(finanzas.getByTestId('eco-prepago-gmv')).toHaveText(RD(0))
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s5-economia.png', fullPage: true })

  // ── Liquidación: compras la genera y NO puede aprobarla; finanzas sí ──
  await compras.goto(`/superadmin/supply/finanzas/liquidaciones/nueva?proveedor=${supplierId}`)
  await expect(compras.getByTestId('preview-neto')).toHaveText(RD(900))
  await compras.getByTestId('btn-generar-liquidacion').click()
  await compras.waitForURL(/\/finanzas\/liquidaciones\/(?!nueva)[a-z0-9]+$/)
  const urlLiquidacion = compras.url()
  await expect(compras.getByTestId('estado-liquidacion')).toHaveText('Pendiente de aprobación')
  await expect(compras.getByTestId('liq-bruto')).toHaveText(RD(1000))
  await expect(compras.getByTestId('liq-comision')).toHaveText(RD(100))
  await expect(compras.getByTestId('liq-neto')).toHaveText(RD(900))
  await expect(compras.getByTestId('liq-linea')).toHaveCount(1)
  await expect(compras.getByTestId('estado-liquidacion')).toHaveText('Pendiente de aprobación')
  // Otra liquidación del mismo periodo: no hay nada que liquidar (barrera contra duplicados).
  await compras.goto(`/superadmin/supply/finanzas/liquidaciones/nueva?proveedor=${supplierId}`)
  await expect(compras.getByTestId('preview-vacia')).toBeVisible()
  await finanzas.goto(urlLiquidacion)
  await finanzas.getByTestId('btn-aprobar-liquidacion').click()
  await expect(finanzas.getByTestId('estado-liquidacion')).toHaveText('Aprobada')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s5-liquidacion.png', fullPage: true })

  // ── Pago de la liquidación: finanzas registra, compras confirma (segregación) ──
  await expect(finanzas.getByTestId('pago-monto')).toHaveValue('900.00')
  await expect(finanzas.getByTestId('pago-destino')).toHaveValue('LIQUIDACION')
  await finanzas.getByTestId('pago-referencia').fill(`TRX-${d.sufijo}-LIQ`)
  await finanzas.getByTestId('btn-registrar-pago').click()
  await expect(finanzas.getByTestId('liq-pagos')).toContainText(`TRX-${d.sufijo}-LIQ`)
  await expect(finanzas.getByTestId('estado-liquidacion')).toHaveText('Aprobada')
  await confirmarPagoPendiente(compras, `TRX-${d.sufijo}-LIQ`)
  await compras.goto(urlLiquidacion)
  await expect(compras.getByTestId('estado-liquidacion')).toHaveText('Pagada')
  await expect(compras.getByTestId('liq-pagado')).toHaveText(RD(900))
  await compras.goto(`/superadmin/supply/finanzas/obligaciones?proveedor=${supplierId}&estado=`)
  await expect(compras.getByTestId('obligacion').first().getByTestId('estado-obligacion')).toHaveText('Pagada')
  await compras.goto(urlOfertaSaona)
  await expect(compras.getByTestId('comision-pagado')).toHaveText(RD(900))
  await expect(compras.getByTestId('comision-pendiente')).toHaveText(RD(0))
  await compras.goto('/superadmin/supply/finanzas')
  await expect(compras.getByTestId('finanzas-comision')).toBeVisible()
  await expect(compras.getByTestId('kpi-comision-ingreso')).toBeVisible()

  // ── Portal del proveedor: liquidación pagada y 900 cobrados ──
  await empleado.goto('/admin/supply/ventas')
  await expect(empleado.getByTestId('ventas-monto-pendiente')).toHaveText(RD(0))
  await expect(empleado.getByTestId('ventas-pagado')).toHaveText(RD(900))
  await empleado.getByTestId('link-liquidaciones').click()
  await empleado.waitForURL(/\/admin\/supply\/liquidaciones$/)
  const liq = empleado.getByTestId('liquidacion-proveedor').first()
  await expect(liq.getByTestId('estado-liquidacion')).toHaveText('Pagada')
  await liq.getByTestId('link-liquidacion-proveedor').click()
  await empleado.waitForURL(/\/admin\/supply\/liquidaciones\/[a-z0-9]+$/)
  await expect(empleado.getByTestId('liq-prov-neto')).toHaveText(RD(900))
  await expect(empleado.getByTestId('liq-prov-pagado')).toHaveText(RD(900))
  await expect(empleado.getByTestId('liq-prov-pagos')).toContainText(`TRX-${d.sufijo}-LIQ`)
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s5-portal-liquidacion.png', fullPage: true })

  // ── Conciliación de comisión (§52): el proveedor reclama 950 → discrepancia → resuelta ──
  await finanzas.goto('/superadmin/supply/finanzas/conciliaciones/nueva?tipo=COMMISSION')
  await finanzas.getByTestId('conciliacion-proveedor').selectOption(supplierId)
  await finanzas.getByTestId('conciliacion-neto-proveedor').fill('950')
  await finanzas.getByTestId('btn-abrir-conciliacion-comision').click()
  await finanzas.waitForURL(/\/finanzas\/conciliaciones\/(?!nueva)[a-z0-9]+$/)
  await expect(finanzas.getByTestId('estado-conciliacion')).toHaveText('Con diferencia')
  await expect(finanzas.getByTestId('conc-bruto')).toHaveText(RD(1000))
  await expect(finanzas.getByTestId('conc-comision')).toHaveText(RD(100))
  await expect(finanzas.getByTestId('conc-neto')).toHaveText(RD(900))
  await expect(finanzas.getByTestId('conc-pagos')).toHaveText(RD(900))
  // El signo va delante del símbolo: «-RD$50.00».
  await expect(finanzas.getByTestId('conciliacion-diferencia')).toHaveText(`-${RD(50)}`)
  await finanzas.getByTestId('btn-resolver-conciliacion').click()
  await finanzas.getByTestId('tipo-resolucion').selectOption('ACCEPT_INTERNAL')
  await finanzas.getByTestId('notas-resolucion').fill('El proveedor contó una venta no entregada.')
  await finanzas.getByTestId('btn-resolver-conciliacion-confirmar').click()
  await expect(finanzas.getByTestId('estado-conciliacion')).toHaveText('Resuelta')

  // ── Catálogo (§86): cliente 2 compra la gorra sin tope al 5 % ──
  const urlGorra = await compraPagada(cliente2, finanzas, d.ofertaGorra, `TRX-${d.sufijo}-G`, { comision: 12.5, neto: 237.5 })
  await sinInventario(urlGorra.split('/').pop()!, d.gorra)
}

async function movil(browser: Browser) {
  const d = datos()
  const db = prismaDeArnes()
  await db.supplyCuentaCobro.upsert({ where: { id: 'e2e-cuenta-membego' }, update: { activa: true }, create: { id: 'e2e-cuenta-membego', tipo: 'TRANSFERENCIA', nombre: 'Banco E2E · Membego', titular: 'Membego SRL', numeroCuenta: '000-111-222', tipoCuenta: 'Corriente', instrucciones: 'Transfiere el monto exacto y avisa aquí.', activa: true } })
  const empresa = await asegurarEmpresaProveedora(`${d.empresa} M`, 'Bávaro')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente2')
  const { page: empleado } = await contexto(browser, 'empleado2', empresa.id)
  const dm = { ...d, empresa: `${d.empresa} M` }
  const supplierId = await proveedorVinculado(compras, dm)
  await producto(compras, supplierId, d.saona, 'Tours', '1200')
  await acuerdoComision(compras, supplierId, '10', 'CATALOG')
  await ofertaComisionPublicada(compras, dm, { producto: d.saona, titulo: d.ofertaSaona, pctEsperado: '10.00', reglaEsperada: 'de todo el catálogo', precio: '1000', modo: 'FIXED_QUANTITY', cantidad: '5', limite: '1', comisionEsperada: 100, netoEsperado: 900 })

  // El cliente compra desde el teléfono; sin scroll horizontal en la ficha ni en el checkout.
  await cliente.goto('/promociones')
  await cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.ofertaSaona }).filter({ visible: true }).first().click()
  await pasarALaFichaDeLaApp(cliente)
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await expect(cliente.getByText(/comisi[óo]n/i)).toHaveCount(0)
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(1000))
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s5-movil-checkout.png', fullPage: true })
  await cliente.locator('#referenciaPago').fill(`MOV-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `MOV-${d.sufijo}` })
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `MOV-${d.sufijo}` })).toHaveCount(0)

  // El proveedor ve Ventas Membego en el teléfono.
  await empleado.goto('/admin/supply/ventas')
  await expect(empleado.getByTestId('ventas-pendientes')).toHaveText('1')
  await expect(empleado.getByTestId('venta-proveedor').filter({ hasText: d.saona }).getByTestId('venta-neto')).toHaveText(RD(900))
  expect(await empleado.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s5-movil-portal.png', fullPage: true })
  await empleado.goto('/admin/supply/liquidaciones')
  await expect(empleado.getByTestId('liquidaciones-vacias')).toBeVisible()
}

test.describe('Supply · Slice 5', () => {
  test.beforeAll(() => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · COMISIÓN: acuerdos (catálogo 5 % + producto 10 %) → oferta sin lote → venta 1 000 (100 / 900) → entrega → obligación → liquidación → pago → conciliación → economía', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(480_000)
    await comisionCompleta(browser)
  })

  test('móvil · el cliente compra una oferta a comisión y el proveedor ve sus Ventas Membego en un teléfono', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(240_000)
    await movil(browser)
  })
})
