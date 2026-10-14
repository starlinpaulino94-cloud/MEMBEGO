import { test, expect, type Browser, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE, pasarALaFichaDeLaApp } from './supply-v2-sesion'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el recorrido del §86 en navegador.
 *
 *   PROVEEDOR  Configuración → acepta el contrato → genera el código de prueba
 *              → lo escanea (QR probado) → mini catálogo: Refresco 150, Postre 250
 *   ADMIN      producto → acuerdo → PO → recepción → oferta 100 @ RD$399
 *   CLIENTE    compra 1 → avisa el pago → ADMIN confirma → «Usar beneficio» → QR
 *   PROVEEDOR  escanea → confirma entrega → VISITA ABIERTA con lo incluido
 *              → Refresco + Postre = RD$400 → registrar → cerrar visita
 *              → Ventas adicionales: extras 400, comisión 32 (8 % solo sobre extras)
 *   CLIENTE    Mis visitas → «¿Es correcto?» → sí → confirmada (sin ver comisiones)
 *   CLIENTE    segunda compra → QR → PROVEEDOR entrega + extras 400 → cierra
 *   CLIENTE    reporta: solo compró 150 → disputa
 *   ADMIN      Visitas → con disputas → resuelve a favor del cliente, base 150
 *              → ajuste −20 (8 % de 250); el libro: 32 + 32 − 20 = 44, sin editar nada
 *
 * El arnés toca la base solo para sesiones, la cuenta de cobro, la empresa
 * proveedora con su sucursal y para LEER el libro al final. Todo lo demás
 * pasa por la interfaz. En móvil corre la primera mitad (escáner + confirmación).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'

type Datos = { sufijo: string; empresa: string; producto: string; oferta: string }

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return { sufijo, empresa: `Café Lite SFC ${sufijo}`, producto: `Cappuccino grande SFC ${sufijo}`, oferta: `Cappuccino Membego SFC ${sufijo}` }
}

const RD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Slices 1 y 2 de Supply por la interfaz (mismo camino que supply-v2-slice3) ──

async function supplyRecibido(compras: Page, finanzas: Page, d: Datos): Promise<void> {
  await compras.goto('/superadmin/supply/compras/nueva')
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
  await finanzas.getByTestId('form-recepcion').locator('input[name="lineQuantity"]').fill('1000')
  await finanzas.getByTestId('btn-confirmar-recepcion').click()
  await expect(finanzas.getByTestId('recepcion-exito')).toContainText('la orden quedó completa')
}

async function ofertaPublicada(compras: Page, d: Datos): Promise<void> {
  await compras.goto('/superadmin/supply/supply')
  const tarjeta = compras.getByTestId('pool-producto').filter({ hasText: d.producto })
  await tarjeta.getByTestId('btn-crear-oferta-producto').click()
  await compras.waitForURL(/\/superadmin\/supply\/ofertas\/nueva/)
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
  await compras.waitForURL(/\/superadmin\/supply\/ofertas\/(?!nueva)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
}

async function compraPagada(cliente: Page, finanzas: Page, d: Datos, ref: string): Promise<void> {
  await cliente.goto('/promociones')
  const tarjetaOferta = cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.oferta })
  await expect(tarjetaOferta).toHaveCount(1)
  await tarjetaOferta.click()
  await pasarALaFichaDeLaApp(cliente)
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  await cliente.locator('#referenciaPago').fill(ref)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: d.oferta })
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: d.oferta })).toHaveCount(0)
}

/** El beneficio DISPONIBLE del producto (puede haber otro ya utilizado). */
function beneficioDisponible(cliente: Page, d: Datos) {
  return cliente.getByTestId('beneficio').filter({ hasText: d.producto }).filter({ has: cliente.getByTestId('btn-usar-beneficio') }).filter({ visible: true })
}

async function generarQr(cliente: Page, d: Datos): Promise<string> {
  await cliente.goto('/cliente/compras')
  const b = beneficioDisponible(cliente, d).first()
  await expect(b.getByTestId('derecho-estado')).toHaveText('Disponible')
  await b.getByTestId('btn-usar-beneficio').click()
  const qr = b.getByTestId('qr-beneficio')
  await expect(qr).toBeVisible()
  const nonce = (await qr.getByTestId('qr-codigo').innerText()).trim()
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{32}$/)
  return nonce
}

async function escanear(empleado: Page, codigo: string): Promise<void> {
  await empleado.goto('/admin/supply/escaner')
  await empleado.getByTestId('btn-codigo-manual').click()
  await empleado.getByTestId('input-codigo').fill(codigo)
  await empleado.getByTestId('btn-buscar-codigo').click()
}

// ── Supplier Lite: la activación del portal (§8) ────────────────────────────

async function portalActivado(empleado: Page): Promise<void> {
  await empleado.goto('/admin/supply/configuracion')
  await expect(empleado.getByTestId('config-preparacion')).toBeVisible()
  await empleado.getByTestId('btn-aceptar-contrato').click()
  await expect(empleado.getByTestId('contrato-aceptado')).toBeVisible()
  await empleado.getByTestId('btn-generar-prueba').click()
  const codigo = (await empleado.getByTestId('codigo-prueba').innerText()).trim()
  expect(codigo).toMatch(/^TEST-/)
  await escanear(empleado, codigo)
  await expect(empleado.getByTestId('preview-rechazado')).toContainText(/prueba|escáner/i)
  await empleado.goto('/admin/supply/configuracion')
  await expect(empleado.getByTestId('qr-probado')).toBeVisible()
}

/** El mini catálogo de extras (§26): Refresco 150 y Postre 250. */
async function extrasConfigurados(empleado: Page): Promise<void> {
  await empleado.goto('/admin/supply/configuracion')
  for (const [nombre, precio] of [['Refresco', '150'], ['Postre', '250']] as const) {
    await empleado.getByTestId('btn-nuevo-extra').click()
    await empleado.getByTestId('form-extra').getByTestId('extra-nombre').fill(nombre)
    await empleado.getByTestId('form-extra').getByTestId('extra-precio').fill(precio)
    await empleado.getByTestId('btn-guardar-extra').click()
    await expect(empleado.getByTestId('extra-configurado').filter({ hasText: nombre })).toContainText(RD(Number(precio)))
  }
}

// ── La visita: entrega → extras → cierre (§23–§27) ─────────────────────────

async function entregaConExtras(empleado: Page, nonce: string, d: Datos, clienteNombre: string): Promise<void> {
  await escanear(empleado, nonce)
  await expect(empleado.getByTestId('preview-valido')).toContainText(d.producto)
  await empleado.getByTestId('btn-confirmar-entrega').click()
  const tarjeta = empleado.getByTestId('entrega-confirmada')
  await expect(tarjeta).toContainText('Entrega confirmada')
  await expect(tarjeta).toContainText(clienteNombre)
  const panel = empleado.getByTestId('panel-visita')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('visita-incluido')).toContainText(d.producto)
  await expect(panel.getByTestId('visita-incluido')).toContainText('Pagado')
  // Nada interno de Supply llega al escáner (§55): ni costos ni lotes.
  expect(await empleado.content()).not.toMatch(/unitCost|actualUnitCost|LOT-\d{4}|margen/i)
  await panel.getByTestId('extra').filter({ hasText: 'Refresco' }).getByTestId('btn-extra-mas').click()
  await panel.getByTestId('extra').filter({ hasText: 'Postre' }).getByTestId('btn-extra-mas').click()
  await expect(panel.getByTestId('seleccion-total')).toHaveText(RD(400))
  await panel.getByTestId('btn-registrar-extras').click()
  await expect(panel.getByTestId('venta-registrada')).toContainText(RD(400))
  await expect(panel.getByTestId('visita-total-extras')).toHaveText(RD(400))
  await panel.getByTestId('btn-cerrar-visita').click()
  await expect(empleado.getByTestId('visita-cerrada')).toBeVisible()
  await expect(empleado.getByTestId('visita-cerrada-extras')).toHaveText(RD(400))
}

async function recorrido(browser: Browser, o: { completo: boolean; cliente: 'cliente' | 'cliente2'; empleado: 'empleado' | 'empleado2' }) {
  const d = datos()
  const db = prismaDeArnes()
  await db.supplyCuentaCobro.upsert({
    where: { id: 'e2e-cuenta-membego' },
    update: { activa: true },
    create: { id: 'e2e-cuenta-membego', tipo: 'TRANSFERENCIA', nombre: 'Banco E2E · Membego', titular: 'Membego SRL', numeroCuenta: '000-111-222', tipoCuenta: 'Corriente', instrucciones: 'Transfiere el monto exacto y avisa aquí.', activa: true },
  })
  const empresa = await asegurarEmpresaProveedora(d.empresa)

  const ctxCompras = await browser.newContext()
  const compras = await ctxCompras.newPage()
  await entrarComo(ctxCompras, 'compras', BASE)
  const ctxFinanzas = await browser.newContext()
  const finanzas = await ctxFinanzas.newPage()
  await entrarComo(ctxFinanzas, 'finanzas', BASE)
  const ctxCliente = await browser.newContext()
  const cliente = await ctxCliente.newPage()
  const ana = await entrarComo(ctxCliente, o.cliente, BASE)
  const ctxEmpleado = await browser.newContext()
  const empleado = await ctxEmpleado.newPage()
  await entrarComo(ctxEmpleado, o.empleado, BASE, empresa.id)

  // ── ADMIN vincula la empresa como proveedor y compra supply ───────────
  await supplyRecibido(compras, finanzas, d)
  await ofertaPublicada(compras, d)

  // ── PROVEEDOR activa su portal y configura sus extras ─────────────────
  await portalActivado(empleado)
  await extrasConfigurados(empleado)
  await empleado.screenshot({ path: 'test-results/shots/sfc-portal-configuracion.png', fullPage: true })

  // ── CLIENTE compra → QR; PROVEEDOR entrega + extras; cierra ───────────
  await compraPagada(cliente, finanzas, d, `TRX-SFC-${d.sufijo}-1`)
  const nonce1 = await generarQr(cliente, d)
  await entregaConExtras(empleado, nonce1, d, ana.nombre)
  await empleado.screenshot({ path: 'test-results/shots/sfc-visita-cerrada.png', fullPage: true })

  // ── PROVEEDOR ve la venta y la comisión SOLO sobre extras (§28) ────────
  await empleado.goto('/admin/supply/ventas-adicionales')
  const fila = empleado.getByTestId('visita-fila').filter({ hasText: ana.nombre }).first()
  await expect(fila).toContainText(`extras ${RD(400)}`)
  await expect(fila).toContainText(`comisión ${RD(32)}`)
  await fila.click()
  await empleado.waitForURL(/\/admin\/supply\/ventas-adicionales\/[a-z0-9]+$/)
  await expect(empleado.getByTestId('visita-comision-total')).toHaveText(RD(32))
  await expect(empleado.getByTestId('venta-comision')).toContainText('8 %')
  await expect(empleado.getByTestId('venta-comision')).toContainText('asentada')

  // ── CLIENTE confirma su consumo (§33): nunca ve comisiones ────────────
  await cliente.goto('/cliente/visitas')
  const visitaCliente = cliente.getByTestId('visita-fila').filter({ hasText: d.empresa }).filter({ hasText: 'pendiente de tu confirmación' }).first()
  await expect(visitaCliente).toBeVisible()
  await visitaCliente.click()
  await cliente.waitForURL(/\/cliente\/visitas\/[a-z0-9]+$/)
  await expect(cliente.getByTestId('confirmar-visita')).toContainText(RD(400))
  await expect(cliente.getByTestId('visita-incluido')).toContainText(d.producto)
  expect(await cliente.content()).not.toMatch(/comisi[óo]n/i)
  await cliente.getByTestId('btn-confirmar-visita').click()
  await expect(cliente.getByTestId('visita-confirmada')).toBeVisible()
  await expect(cliente.getByTestId('chip-evidencia').first()).toHaveText('Confirmado por el cliente')
  expect(await cliente.content()).not.toMatch(/Pago verificado/)

  if (!o.completo) return

  // ── Segunda visita → el cliente reporta → ADMIN resuelve con ajuste ───
  await compraPagada(cliente, finanzas, d, `TRX-SFC-${d.sufijo}-2`)
  const nonce2 = await generarQr(cliente, d)
  await entregaConExtras(empleado, nonce2, d, ana.nombre)

  await cliente.goto('/cliente/visitas')
  const segunda = cliente.getByTestId('visita-fila').filter({ hasText: d.empresa }).filter({ hasText: 'pendiente de tu confirmación' }).first()
  await segunda.click()
  await cliente.waitForURL(/\/cliente\/visitas\/[a-z0-9]+$/)
  await cliente.getByTestId('btn-reportar-visita').click()
  await cliente.getByTestId('reporte-claim').fill('Solo compré el refresco; el postre no.')
  await cliente.getByTestId('reporte-monto').fill('150')
  await cliente.getByTestId('btn-reportar-enviar').click()
  await expect(cliente.getByTestId('visita-reportada')).toBeVisible()
  await expect(cliente.getByTestId('chip-disputa').first()).toHaveText('Abierta')

  await compras.goto('/superadmin/supply/visitas?disputas=1')
  const enDisputa = compras.getByTestId('visita-fila').filter({ hasText: d.empresa }).first()
  await expect(enDisputa).toContainText('1 disputa(s) abierta(s)')
  await enDisputa.click()
  await compras.waitForURL(/\/superadmin\/supply\/visitas\/[a-z0-9]+$/)
  await compras.getByTestId('btn-disputa-revision').click()
  await expect(compras.getByTestId('chip-disputa').first()).toHaveText('En revisión')
  await compras.getByTestId('select-resolucion').selectOption('RESOLVED_CUSTOMER')
  await compras.getByTestId('base-reconocida').fill('150')
  await compras.getByTestId('notas-resolucion').fill('El cliente aporta el recibo: solo el refresco.')
  await compras.getByTestId('btn-resolver-disputa').click()
  await expect(compras.getByTestId('disputa-resuelta')).toContainText('-20.00')
  await expect(compras.getByTestId('chip-disputa').first()).toHaveText('A favor del cliente')
  await expect(compras.getByTestId('visita-comision-total')).toHaveText(RD(12))

  // ── El libro de Merchant Billing: solo asientos nuevos, nunca ediciones ─
  const asientos = await db.merchantLedgerEntry.findMany({ where: { companyId: empresa.id, referenceType: 'ANCILLARY_SALE' }, orderBy: { seq: 'asc' }, select: { type: true, amount: true } })
  expect(asientos.map((a) => [a.type, Number(a.amount)])).toEqual([
    ['ANCILLARY_FEE', 32],
    ['ANCILLARY_FEE', 32],
    ['ADJUSTMENT', -20],
  ])
  // Lo que Membego incluyó (la unidad que compró) no genera comisión de pedido ni de canje: solo los extras.
  const comisiones = await db.merchantLedgerEntry.count({ where: { companyId: empresa.id, type: { in: ['REDEMPTION_FEE', 'ORDER_FEE'] } } })
  expect(comisiones).toBe(0)
  const ventas = await db.ancillarySale.findMany({ where: { companyId: empresa.id }, select: { evidenceLevel: true, status: true } })
  expect(ventas.every((v) => v.evidenceLevel !== 'PAYMENT_VERIFIED')).toBe(true)

  // ── Supplier → Merchant (§39–§41): la MISMA empresa, sin segunda organización ─
  const empresasAntes = await db.company.count()
  await empleado.goto('/admin/supply/solicitud-merchant')
  await expect(empleado.getByTestId('form-solicitud-merchant')).toBeVisible()
  await expect(empleado.getByTestId('sol-nombre')).toHaveValue(d.empresa)
  await empleado.getByTestId('sol-descripcion').fill('Cafetería de especialidad en Bávaro, frente a la playa.')
  await empleado.getByTestId('sol-que-vende').fill('Café, postres y desayunos.')
  await empleado.getByTestId('sol-telefono').fill('809-555-0100')
  await empleado.getByTestId('btn-enviar-solicitud').click()
  await expect(empleado.getByTestId('solicitud-enviada')).toBeVisible()
  await empleado.reload()
  await expect(empleado.getByTestId('chip-solicitud')).toHaveText('Enviada')

  await compras.goto('/superadmin/supply/proveedores/solicitudes')
  const solicitud = compras.getByTestId('solicitud').filter({ hasText: d.empresa }).first()
  await expect(solicitud).toBeVisible()
  await solicitud.getByTestId('select-decision').selectOption('APPROVED')
  await solicitud.getByTestId('motivo-decision').fill('Bienvenidos a Membego.')
  await solicitud.getByTestId('btn-decidir-solicitud').click()
  await expect(compras.getByTestId('solicitud-decidida')).toContainText('misma empresa')
  expect(await db.company.count()).toBe(empresasAntes)
  const convertida = await db.company.findUniqueOrThrow({ where: { id: empresa.id }, select: { isPublished: true, capacidades: true } })
  expect(convertida.isPublished).toBe(false)
  expect((convertida.capacidades as { overrides: Record<string, boolean> }).overrides).toMatchObject({ MEMBEGO_SUPPLIER: true, CATALOGO_UNIFICADO: true, PEDIDOS_MEMBEGO: true, DEALS_MARKETPLACE: true })

  // El proveedor convertido: su portal sigue ahí, y ahora también el panel de empresa; la oferta de Membego sigue en vivo.
  await empleado.goto('/admin/supply/solicitud-merchant')
  await expect(empleado.getByTestId('ya-merchant')).toBeVisible()
  await empleado.goto('/admin/catalogo')
  await expect(empleado).toHaveURL(/\/admin\/catalogo/)
  await empleado.goto('/admin/supply/ventas-adicionales')
  await expect(empleado.getByTestId('visita-fila').first()).toBeVisible()
  await cliente.goto('/promociones')
  await expect(cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.oferta })).toHaveCount(1)
}

test.describe('Supplier & Fulfillment Commerce', () => {
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · activación → supply → QR → visita → extras → comisión solo sobre extras → confirmación → disputa → ajuste → Supplier → Merchant', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(480_000)
    await recorrido(browser, { completo: true, cliente: 'cliente', empleado: 'empleado' })
  })

  test('móvil · el proveedor activa, escanea y registra extras desde el teléfono; el cliente confirma', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(300_000)
    await recorrido(browser, { completo: false, cliente: 'cliente2', empleado: 'empleado2' })
  })
})
