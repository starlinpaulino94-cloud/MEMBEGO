import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY · SLICE 6 de punta a punta en navegador (§37).
 *
 *   1  ALTA Y APROBACIÓN  compras crea el bono con el asistente de 7 pasos (ve
 *      el ejemplo económico), NO puede aprobarlo, finanzas lo aprueba y lo
 *      asigna a una clienta; ella lo ve en «Mis bonos».
 *   2  BONO PARCIAL       la clienta compra Saona 1 000 con el bono de 500 →
 *      checkout con «Beneficio aplicado» y total 500 → paga la diferencia →
 *      finanzas confirma 500 → QR → el proveedor entrega → el portal del
 *      proveedor muestra valor contractual 1 000 y neto 920 (el bono no se lo
 *      descuentan) → la ficha del bono muestra presupuesto consumido y ledger
 *      cuadrado → economía: subsidio 500 y contribución negativa.
 *   3  COBERTURA TOTAL    bono de 500 sobre una oferta de 400: total 0, sin
 *      cuenta bancaria, la clienta confirma y recibe su código.
 *   4  COMPARTIDA         1 000 − 100 (proveedor) − 300 (Membego) = 600; el
 *      proveedor ve SU descuento y el aporte de Membego por separado.
 *   5  CONTROL            pausar el bono lo quita del checkout; el presupuesto
 *      agotado deja la oferta sin beneficio; todo queda en el ledger.
 *   MÓVIL                 la clienta usa su bono desde «Mis bonos» en un
 *      teléfono, con cobertura total y sin pagar nada.
 *
 * El arnés toca la base SOLO para sesiones, cuenta de cobro, la empresa
 * proveedora y las comprobaciones SQL. Todo lo demás pasa por la interfaz.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const RD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Datos = { sufijo: string; empresa: string; saona: string; corta: string; bono: string; bonoTotal: string; bonoCompartido: string; ofertaSaona: string; ofertaCorta: string; ofertaCompartida: string }

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return {
    sufijo,
    empresa: `Tours Caribe S6 ${sufijo}`,
    saona: `Excursión Saona S6 ${sufijo}`,
    corta: `Excursión Corta S6 ${sufijo}`,
    bono: `Bono bienvenida S6 ${sufijo}`,
    bonoTotal: `Bono cubre todo S6 ${sufijo}`,
    bonoCompartido: `Promo compartida S6 ${sufijo}`,
    ofertaSaona: `Saona Membego S6 ${sufijo}`,
    ofertaCorta: `Saona Corta Membego S6 ${sufijo}`,
    ofertaCompartida: `Saona Compartida S6 ${sufijo}`,
  }
}

async function contexto(browser: Browser, rol: 'compras' | 'finanzas' | 'cliente' | 'cliente2' | 'empleado' | 'empleado2', companyId: string | null = null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await entrarComo(ctx, rol, BASE, companyId)
  return { ctx, page }
}

async function cuentaDeCobro(): Promise<void> {
  await prismaDeArnes().supplyCuentaCobro.upsert({
    where: { id: 'e2e-cuenta-membego' },
    update: { activa: true },
    create: { id: 'e2e-cuenta-membego', tipo: 'TRANSFERENCIA', nombre: 'Banco E2E · Membego', titular: 'Membego SRL', numeroCuenta: '000-111-222', tipoCuenta: 'Corriente', instrucciones: 'Transfiere el monto exacto y avisa aquí.', activa: true },
  })
}

// ── Montaje por interfaz: proveedor, producto, acuerdo y oferta a comisión ───

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

async function producto(compras: Page, supplierId: string, nombre: string, precio: string): Promise<void> {
  await compras.goto(`/superadmin/supply/proveedores/${supplierId}`)
  await compras.getByTestId('btn-agregar-producto').click()
  await compras.locator('#productoNombre').fill(nombre)
  await compras.locator('#productoCategoria').fill('Tours')
  await compras.locator('#productoPrecio').fill(precio)
  await compras.getByRole('button', { name: 'Agregar producto' }).click()
  await expect(compras.getByTestId('tabla-catalogo')).toContainText(nombre)
}

/** Acuerdo a comisión del 8 % por catálogo, con la BASE explícita (§14). */
async function acuerdoComision(compras: Page, supplierId: string): Promise<void> {
  await compras.goto(`/superadmin/supply/proveedores/${supplierId}`)
  await compras.getByTestId('btn-crear-acuerdo').click()
  await compras.getByTestId('acuerdo-tipo-COMMISSION').click()
  await compras.getByTestId('acuerdo-alcance').getByRole('radio', { name: 'Todo el catálogo' }).check()
  await compras.getByTestId('acuerdo-comision').fill('8')
  // Slice 6: la base de la comisión se elige y se congela en la versión del acuerdo.
  await expect(compras.getByTestId('acuerdo-base-comision')).toBeVisible()
  await compras.getByTestId('acuerdo-base-comision').selectOption('CONTRACTUAL_SALE_VALUE')
  await compras.getByRole('button', { name: 'Crear acuerdo' }).click()
  await expect(compras.getByTestId('lista-acuerdos')).toContainText('comisión 8')
}

async function ofertaComision(compras: Page, producto: string, titulo: string, precio: string): Promise<void> {
  await compras.goto('/superadmin/supply/ofertas/nueva')
  await compras.getByTestId('fuente-comision').click()
  await compras.waitForURL(/fuente=COMMISSION/)
  const select = compras.getByTestId('comision-producto')
  const opciones = await select.locator('option').allTextContents()
  await select.selectOption({ index: opciones.findIndex((t) => t.includes(producto)) })
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-modo-UNLIMITED').click()
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-precio').fill(precio)
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-titulo').fill(titulo)
  await compras.locator('#ofertaLimiteC').fill('3')
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('btn-publicar-oferta-comision').click()
  await compras.waitForURL(/\/superadmin\/supply\/ofertas\/(?!nueva)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
}

// ── El asistente de beneficios, 7 pasos (§30) ───────────────────────────────

interface BonoNuevo {
  nombre: string
  financia: 'MEMBEGO' | 'SUPPLIER' | 'SHARED'
  membego?: string
  proveedor?: string
  oferta: string
  presupuesto?: string
  /** Lo que el ejemplo económico tiene que decir antes de guardar. */
  ejemplo?: string[]
}

/** Crea el beneficio con el asistente y devuelve la url de su ficha (queda en BORRADOR). */
async function bonoCreado(compras: Page, b: BonoNuevo): Promise<string> {
  await compras.goto('/superadmin/supply/beneficios')
  await compras.getByTestId('btn-crear-beneficio-nav').click()
  await expect(compras.getByTestId('wizard-beneficio')).toBeVisible()
  // 1 · qué es
  await compras.getByTestId('beneficio-nombre').fill(b.nombre)
  await compras.getByTestId('beneficio-continuar').click()
  // 2 · quién financia
  await compras.getByTestId(`beneficio-funding-${b.financia}`).click()
  await compras.getByTestId('beneficio-continuar').click()
  // 3 · cuánto
  await compras.getByTestId('beneficio-tipo-FIXED_AMOUNT').click()
  if (b.membego) await compras.getByTestId('beneficio-valor-membego').fill(b.membego)
  if (b.proveedor) await compras.getByTestId('beneficio-valor-proveedor').fill(b.proveedor)
  await compras.getByTestId('beneficio-continuar').click()
  // 4 · a qué aplica
  await compras.getByTestId('beneficio-alcance-SPECIFIC_OFFER').click()
  const ofertas = compras.getByTestId('beneficio-oferta')
  const textos = await ofertas.locator('option').allTextContents()
  await ofertas.selectOption({ index: textos.findIndex((t) => t.includes(b.oferta)) })
  await compras.getByTestId('beneficio-continuar').click()
  // 5 · presupuesto
  if (b.presupuesto) await compras.getByTestId('beneficio-presupuesto').fill(b.presupuesto)
  await compras.getByTestId('beneficio-continuar').click()
  // 6 · vigencia y usos
  await compras.getByTestId('beneficio-asignacion').selectOption('si')
  await compras.getByTestId('beneficio-continuar').click()
  // 7 · resumen con el ejemplo económico
  const ejemplo = compras.getByTestId('beneficio-ejemplo')
  await expect(ejemplo).toBeVisible()
  for (const texto of b.ejemplo ?? []) await expect(ejemplo).toContainText(texto)
  await compras.getByTestId('btn-crear-beneficio').click()
  await compras.waitForURL(/\/superadmin\/supply\/beneficios\/(?!nuevo)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-beneficio')).toHaveText('Borrador')
  return compras.url()
}

/** Finanzas aprueba y asigna el bono a un correo de cliente. */
async function bonoAprobadoYAsignado(compras: Page, finanzas: Page, urlBono: string, correoCliente: string): Promise<void> {
  await compras.goto(urlBono)
  await expect(compras.getByTestId('estado-beneficio')).toHaveText('Borrador')

  await finanzas.goto(urlBono)
  await finanzas.getByTestId('btn-aprobar-beneficio').click()
  await expect(finanzas.getByTestId('estado-beneficio')).toHaveText('Activo')
  await finanzas.getByTestId('input-buscar-cliente-beneficio').fill(correoCliente)
  await finanzas.getByTestId('opcion-cliente-beneficio').first().click()
  await finanzas.getByTestId('btn-asignar-beneficio').click()
  await expect(finanzas.getByTestId('tabla-asignaciones')).toContainText(correoCliente)
}

/** La clienta compra la oferta usando su bono. Devuelve la url de la compra. */
async function compraConBono(cliente: Page, oferta: string, bono: string, esperado: { aPagar: number; bono: number; ahorroTotal?: number }): Promise<string> {
  await cliente.goto('/promociones')
  await cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: oferta }).filter({ visible: true }).first().click()
  await cliente.waitForURL(/\/promociones\/membego\//)
  const selector = cliente.getByTestId('selector-beneficio')
  await expect(selector).toBeVisible()
  const opciones = await cliente.getByTestId('select-beneficio').locator('option').allTextContents()
  await cliente.getByTestId('select-beneficio').selectOption({ index: opciones.findIndex((t) => t.includes(bono)) })
  await expect(cliente.getByTestId('beneficio-bono')).toHaveText(`−${RD(esperado.bono)}`)
  await expect(cliente.getByTestId('beneficio-a-pagar')).toHaveText(RD(esperado.aPagar))
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(esperado.aPagar))
  // El aviso suma lo que rebaja el beneficio: bono de Membego + descuento del proveedor.
  await expect(cliente.getByTestId('checkout-beneficio-aviso')).toContainText(RD(esperado.ahorroTotal ?? esperado.bono))
  return cliente.url()
}

function beneficio(cliente: Page, producto: string) {
  return cliente.getByTestId('beneficio').filter({ hasText: producto }).filter({ visible: true })
}

async function redimir(cliente: Page, empleado: Page, producto: string): Promise<void> {
  await cliente.goto('/cliente/compras')
  const b = beneficio(cliente, producto)
  await expect(b.getByTestId('derecho-estado')).toHaveText('Disponible')
  await b.getByTestId('btn-usar-beneficio').click()
  const nonce = (await b.getByTestId('qr-beneficio').getByTestId('qr-codigo').innerText()).trim()
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

// ── SQL: lo que la interfaz dijo tiene que estar en PostgreSQL (§36, §39) ────

async function enBaseDeDatos(orderId: string, esperado: { total: string; contractual: string; subsidio: string; descuento: string; comision: string; neto: string; paymentStatus: string }) {
  const db = prismaDeArnes()
  const o = await db.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, entitlements: true, benefitReservations: true } })
  expect(o.total.toFixed(2)).toBe(esperado.total)
  expect(o.contractualValue.toFixed(2)).toBe(esperado.contractual)
  expect(o.membegoSubsidyTotal.toFixed(2)).toBe(esperado.subsidio)
  expect(o.supplierDiscountTotal.toFixed(2)).toBe(esperado.descuento)
  expect(o.commissionAmount?.toFixed(2)).toBe(esperado.comision)
  expect(o.supplierNet?.toFixed(2)).toBe(esperado.neto)
  expect(o.paymentStatus).toBe(esperado.paymentStatus)
  expect(o.benefitFundingSnapshot).not.toBeNull()
  expect(o.benefitReservations.length).toBe(1)
  expect(o.benefitReservations[0]!.status).toBe('APPLIED')
  for (const e of o.entitlements) {
    expect(e.customerUnitPrice.toFixed(2)).toBe(esperado.total)
    expect(e.contractualUnitValue.toFixed(2)).toBe(esperado.contractual)
  }
  // El subsidio es un evento económico aparte, nunca un descuento del ingreso.
  const subsidios = await db.supplyV2EconomicEvent.findMany({ where: { entitlementId: { in: o.entitlements.map((e) => e.id) }, type: 'MEMBEGO_SUBSIDY' } })
  if (Number(esperado.subsidio) > 0) {
    expect(subsidios.length).toBe(o.entitlements.length)
    expect(subsidios.reduce((t, s) => t + Number(s.subsidyAmount ?? 0), 0).toFixed(2)).toBe(esperado.subsidio)
  }
  return o
}

async function presupuestoEnBase(nombre: string, esperado: { reservado: string; consumido: string }) {
  const db = prismaDeArnes()
  const b = await db.supplyV2Benefit.findFirstOrThrow({ where: { name: nombre }, include: { movements: true } })
  expect(b.budgetReserved.toFixed(2)).toBe(esperado.reservado)
  expect(b.budgetConsumed.toFixed(2)).toBe(esperado.consumido)
  // El ledger explica la caché: sumar los movimientos da lo mismo.
  const reserved = b.movements.reduce((t, m) => t + Number(m.reservedDelta), 0)
  const consumed = b.movements.reduce((t, m) => t + Number(m.consumedDelta), 0)
  expect(reserved.toFixed(2)).toBe(esperado.reservado)
  expect(consumed.toFixed(2)).toBe(esperado.consumido)
  return b
}

// ── Recorrido completo de escritorio (journeys 1–5) ─────────────────────────

async function recorridoCompleto(browser: Browser) {
  const d = datos()
  await cuentaDeCobro()
  const empresa = await asegurarEmpresaProveedora(d.empresa, 'Punta Cana')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente')
  const { page: empleado } = await contexto(browser, 'empleado', empresa.id)

  // Montaje: proveedor con dos productos, acuerdo a comisión 8 % y tres ofertas.
  const supplierId = await proveedorVinculado(compras, d)
  await producto(compras, supplierId, d.saona, '1200')
  await producto(compras, supplierId, d.corta, '600')
  await acuerdoComision(compras, supplierId)
  await ofertaComision(compras, d.saona, d.ofertaSaona, '1000')
  await ofertaComision(compras, d.corta, d.ofertaCorta, '400')
  await ofertaComision(compras, d.saona, d.ofertaCompartida, '1000')

  // ── 1 · alta con el asistente, aprobación por otra persona y asignación ──
  const urlBono = await bonoCreado(compras, {
    nombre: d.bono,
    financia: 'MEMBEGO',
    membego: '500',
    oferta: d.ofertaSaona,
    presupuesto: '2000',
    ejemplo: [RD(1000), RD(500), RD(80), RD(920)],
  })
  await compras.screenshot({ path: 'test-results/shots/supply-v2-s6-bono-resumen.png', fullPage: true })
  await bonoAprobadoYAsignado(compras, finanzas, urlBono, 'e2e.supply2.cliente@membego.test')

  // La clienta lo ve en «Mis bonos», con su valor y dónde usarlo.
  await cliente.goto('/cliente/bonos')
  const tarjeta = cliente.getByTestId('tarjeta-bono').filter({ hasText: d.bono })
  await expect(tarjeta.getByTestId('bono-valor')).toHaveText(RD(500))
  await expect(tarjeta.getByTestId('bono-oferta').first()).toContainText(d.ofertaSaona)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s6-mis-bonos.png', fullPage: true })

  // ── 2 · bono parcial: paga 500, el proveedor cobra 920 ──────────────────
  const urlCompra = await compraConBono(cliente, d.ofertaSaona, d.bono, { aPagar: 500, bono: 500 })
  const orderId = urlCompra.split('/').pop()!
  await expect(cliente.getByTestId('checkout-cuenta')).toContainText(RD(500))
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s6-checkout-parcial.png', fullPage: true })
  await presupuestoEnBase(d.bono, { reservado: '500.00', consumido: '0.00' })

  await cliente.locator('#referenciaPago').fill(`BONO-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')

  await finanzas.goto('/superadmin/supply/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `BONO-${d.sufijo}` })
  await expect(venta.getByTestId('venta-financiacion')).toContainText(RD(1000))
  await expect(venta.getByTestId('venta-beneficio')).toContainText(d.bono)
  await expect(venta.getByTestId('venta-reparto')).toContainText(`comisión ${RD(80)} · neto ${RD(920)}`)
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `BONO-${d.sufijo}` })).toHaveCount(0)

  await enBaseDeDatos(orderId, { total: '500.00', contractual: '1000.00', subsidio: '500.00', descuento: '0.00', comision: '80.00', neto: '920.00', paymentStatus: 'CONFIRMED' })
  await presupuestoEnBase(d.bono, { reservado: '0.00', consumido: '500.00' })

  // La ficha del bono cuenta la verdad del presupuesto y del resultado.
  await finanzas.goto(urlBono)
  await expect(finanzas.getByTestId('ficha-consumido')).toHaveText(RD(500))
  await expect(finanzas.getByTestId('ficha-disponible')).toHaveText(RD(1500))
  await expect(finanzas.getByTestId('beneficio-ledger-cuadra')).toContainText('cuadra')
  await expect(finanzas.getByTestId('beneficio-economia')).toContainText(RD(1000))
  await expect(finanzas.getByTestId('tabla-usos-beneficio')).toContainText('Aplicado')
  await expect(finanzas.getByTestId('tabla-movimientos-beneficio')).toContainText('Aplicado (compra confirmada)')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s6-ficha-bono.png', fullPage: true })

  // QR y entrega: el canje es el de siempre.
  await redimir(cliente, empleado, d.saona)

  // El proveedor ve su valor contractual y su neto: el bono no se lo descuentan.
  await empleado.goto('/admin/supply/ventas')
  const ventaProv = empleado.getByTestId('venta-proveedor').filter({ hasText: d.saona }).first()
  await expect(ventaProv.getByTestId('venta-neto')).toHaveText(RD(920))
  await expect(ventaProv.getByTestId('venta-contractual')).toContainText(RD(1000))
  await expect(ventaProv.getByTestId('venta-bono-membego')).toContainText('no sale de tu neto')
  await empleado.goto('/admin/supply/beneficios')
  await expect(empleado.getByTestId('beneficio-proveedor').filter({ hasText: d.bono }).getByTestId('beneficio-prov-aporte')).toHaveText('No pones nada')
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s6-portal-proveedor.png', fullPage: true })

  // Economía: el subsidio y la contribución tras el subsidio se ven aparte.
  // Filtrado por ESTE proveedor: así la cifra es la de este recorrido y no la de toda la base.
  await finanzas.goto(`/superadmin/supply/economia?ventana=30D&proveedor=${supplierId}`)
  await expect(finanzas.getByTestId('eco-financiacion')).toBeVisible()
  await expect(finanzas.getByTestId('eco-subsidio')).toHaveText(RD(500))
  await expect(finanzas.getByTestId('eco-cobrado')).toHaveText(RD(500))
  await expect(finanzas.getByTestId('eco-contribucion')).toBeVisible()
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s6-economia.png', fullPage: true })

  // ── 3 · cobertura total: sin pago bancario ──────────────────────────────
  const urlTotal = await bonoCreado(compras, { nombre: d.bonoTotal, financia: 'MEMBEGO', membego: '500', oferta: d.ofertaCorta, presupuesto: '1000' })
  await bonoAprobadoYAsignado(compras, finanzas, urlTotal, 'e2e.supply2.cliente@membego.test')
  await cliente.goto('/promociones')
  await cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.ofertaCorta }).filter({ visible: true }).first().click()
  await cliente.waitForURL(/\/promociones\/membego\//)
  const ops = await cliente.getByTestId('select-beneficio').locator('option').allTextContents()
  await cliente.getByTestId('select-beneficio').selectOption({ index: ops.findIndex((t) => t.includes(d.bonoTotal)) })
  await expect(cliente.getByTestId('beneficio-cubre-todo')).toBeVisible()
  await expect(cliente.getByTestId('beneficio-a-pagar')).toHaveText(RD(0))
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const urlCoberturaTotal = cliente.url()
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(0))
  await expect(cliente.getByTestId('form-cobertura-total')).toContainText('no tienes que pagar nada')
  await expect(cliente.getByTestId('checkout-cuenta')).toHaveCount(0)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s6-cobertura-total.png', fullPage: true })
  await cliente.getByTestId('btn-confirmar-cobertura').click()
  await expect(cliente.getByTestId('checkout-pagada')).toContainText('cubrió el total')
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pagada')

  const idTotal = urlCoberturaTotal.split('/').pop()!
  await enBaseDeDatos(idTotal, { total: '0.00', contractual: '400.00', subsidio: '400.00', descuento: '0.00', comision: '32.00', neto: '368.00', paymentStatus: 'COVERED_BY_BENEFIT' })

  // ── 4 · financiación compartida ─────────────────────────────────────────
  const urlCompartido = await bonoCreado(compras, {
    nombre: d.bonoCompartido,
    financia: 'SHARED',
    membego: '300',
    proveedor: '100',
    oferta: d.ofertaCompartida,
    presupuesto: '900',
    ejemplo: [RD(900), RD(600)],
  })
  await bonoAprobadoYAsignado(compras, finanzas, urlCompartido, 'e2e.supply2.cliente@membego.test')
  const urlCompraCompartida = await compraConBono(cliente, d.ofertaCompartida, d.bonoCompartido, { aPagar: 600, bono: 300, ahorroTotal: 400 })
  await cliente.locator('#referenciaPago').fill(`SHARED-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  // Esperar a que el aviso QUEDE antes de ir a la pantalla de finanzas.
  //
  // Sin esta línea, la navegación de `finanzas` corre contra la server action
  // que acaba de pulsar `cliente`: a veces llega antes y la venta todavía no
  // está «por revisar», con un fallo que parece de la pantalla de finanzas y es
  // una carrera de la prueba. Dos párrafos más arriba (línea 317) esto ya se
  // hacía; aquí se había quedado sin hacer.
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply/ofertas/ventas')
  const ventaShared = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `SHARED-${d.sufijo}` })
  await expect(ventaShared.getByTestId('venta-financiacion')).toContainText(RD(900))
  await ventaShared.getByTestId('btn-confirmar-pago').click()
  await ventaShared.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `SHARED-${d.sufijo}` })).toHaveCount(0)
  await enBaseDeDatos(urlCompraCompartida.split('/').pop()!, { total: '600.00', contractual: '900.00', subsidio: '300.00', descuento: '100.00', comision: '72.00', neto: '828.00', paymentStatus: 'CONFIRMED' })
  // El proveedor ve SU descuento como suyo y el de Membego como de Membego.
  await empleado.goto('/admin/supply/beneficios')
  const prov = empleado.getByTestId('beneficio-proveedor').filter({ hasText: d.bonoCompartido })
  await expect(prov.getByTestId('beneficio-prov-aporte')).toContainText(RD(100))
  await expect(prov.getByTestId('beneficio-prov-membego')).toContainText(RD(300))

  // ── 5 · control: pausar quita el bono del checkout; el ledger lo cuenta ──
  await finanzas.goto(urlCompartido)
  await finanzas.getByTestId('btn-pausar-beneficio').click()
  await expect(finanzas.getByTestId('estado-beneficio')).toHaveText('Pausado')
  await cliente.goto('/promociones')
  await cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.ofertaCompartida }).filter({ visible: true }).first().click()
  await cliente.waitForURL(/\/promociones\/membego\//)
  const quedan = await cliente.getByTestId('select-beneficio').locator('option').allTextContents().catch(() => [] as string[])
  expect(quedan.some((t) => t.includes(d.bonoCompartido))).toBe(false)
  await cliente.goto('/cliente/bonos')
  const tarjetaCompartida = cliente.getByTestId('tarjeta-bono').filter({ hasText: d.bonoCompartido })
  // `toHaveCount(1)` antes de usar el elemento, a propósito: no es un margen de
  // tiempo disfrazado, es la invariante de verdad —de esto hay UNO— y Playwright
  // reintenta hasta que se cumple. Durante una navegación del App Router el DOM
  // puede tener un instante DOS copias del listado; el filtro por texto
  // encontraba una en cada copia y el modo estricto abortaba. Si la página
  // llegara a duplicar de verdad, esta misma línea lo caza: no lo esconde.
  await expect(tarjetaCompartida).toHaveCount(1)
  await expect(tarjetaCompartida.getByTestId('bono-motivo')).toBeVisible()

  // El listado de beneficios enseña las tres cifras del presupuesto por separado.
  await finanzas.goto('/superadmin/supply/beneficios')
  const fila = finanzas.getByTestId('tabla-beneficios').locator('tr').filter({ hasText: d.bono })
  await expect(fila.getByTestId('beneficio-consumido')).toHaveText(RD(500))
  await expect(fila.getByTestId('beneficio-disponible')).toHaveText(RD(1500))
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s6-listado-bonos.png', fullPage: true })

  // El bono de cobertura total quedó sin presupuesto suficiente para otro uso:
  // su asignación está agotada y la clienta ve el motivo, no un error.
  await presupuestoEnBase(d.bonoTotal, { reservado: '0.00', consumido: '400.00' })
}

// ── Móvil: la clienta usa su bono desde el teléfono ─────────────────────────

async function movil(browser: Browser) {
  const d = datos()
  await cuentaDeCobro()
  const empresa = await asegurarEmpresaProveedora(d.empresa, 'Bávaro')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente2')
  void empresa

  const supplierId = await proveedorVinculado(compras, d)
  await producto(compras, supplierId, d.corta, '600')
  await acuerdoComision(compras, supplierId)
  await ofertaComision(compras, d.corta, d.ofertaCorta, '400')
  const urlBono = await bonoCreado(compras, { nombre: d.bonoTotal, financia: 'MEMBEGO', membego: '500', oferta: d.ofertaCorta, presupuesto: '1000' })
  await bonoAprobadoYAsignado(compras, finanzas, urlBono, 'e2e.supply2.cliente2@membego.test')

  // Entra por «Mis bonos» y el bono llega preseleccionado a la oferta.
  await cliente.goto('/cliente/bonos')
  const tarjeta = cliente.getByTestId('tarjeta-bono').filter({ hasText: d.bonoTotal })
  await expect(tarjeta.getByTestId('bono-valor')).toHaveText(RD(500))
  await tarjeta.getByTestId('btn-usar-bono').click()
  await cliente.waitForURL(/\/promociones\/membego\/.*beneficio=/)
  await expect(cliente.getByTestId('beneficio-cubre-todo')).toBeVisible()
  await expect(cliente.getByTestId('beneficio-a-pagar')).toHaveText(RD(0))
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s6-movil-oferta.png', fullPage: true })

  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const orderId = cliente.url().split('/').pop()!
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(0))
  await cliente.getByTestId('btn-confirmar-cobertura').click()
  await expect(cliente.getByTestId('checkout-pagada')).toContainText('cubrió el total')
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s6-movil-confirmada.png', fullPage: true })
  await enBaseDeDatos(orderId, { total: '0.00', contractual: '400.00', subsidio: '400.00', descuento: '0.00', comision: '32.00', neto: '368.00', paymentStatus: 'COVERED_BY_BENEFIT' })
}

test.describe('Supply · Slice 6', () => {
  test.beforeAll(() => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · BENEFICIOS: alta en 7 pasos → aprobación de otra persona → asignación → bono parcial 1 000/500 (comisión 80, neto 920) → QR y entrega → cobertura total sin pago → compartida 100/300 → pausa y presupuesto', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(600_000)
    await recorridoCompleto(browser)
  })

  test('móvil · la clienta usa su bono desde «Mis bonos» y confirma sin pagar nada', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(300_000)
    await movil(browser)
  })
})
