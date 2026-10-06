import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 de punta a punta en navegador (§32–§33).
 *
 * EL RECORRIDO OBLIGATORIO, completo y en este orden:
 *   1  compras crea la campaña con el asistente de 8 pasos (ve la vista previa
 *      económica: 1 000 → 600, comisión 72, neto 828)
 *   2  elige el producto y el proveedor participantes
 *   3  configura la financiación compartida (100 del proveedor + 300 de Membego)
 *   4  asigna el presupuesto, y el techo de la campaña manda sobre sus promociones
 *   5  genera un cupón público con su código
 *   6  OTRA persona autorizada la aprueba (quien la creó no puede)
 *   7  finanzas la publica
 *   8  la clienta la encuentra en el marketplace
 *   9  entra en el producto
 *  10  aplica el cupón
 *  11  comprueba el desglose: 1 000 − 100 − 300 = 600
 *  12  paga y finanzas confirma
 *  13  recibe su derecho
 *  14  abre su QR
 *  15  el proveedor confirma la entrega
 *  16  finanzas verifica el reparto en la liquidación (neto 828)
 *  17  el tablero de campañas enseña los resultados REALES
 *
 * MÓVIL (§33): descubrimiento de campañas, ficha, cupón desde «Mis cupones»,
 * checkout y portal del proveedor en un teléfono, sin desbordamiento lateral.
 *
 * El arnés toca la base SOLO para sesiones, cuenta de cobro, la empresa
 * proveedora y las comprobaciones SQL. Todo lo demás pasa por la interfaz.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const RD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Datos = { sufijo: string; empresa: string; pizza: string; burger: string; ofertaPizza: string; ofertaBurger: string; campana: string; cupon: string }

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return {
    sufijo,
    empresa: `Little Pizza S7 ${sufijo}`,
    pizza: `Pizza Pepperoni S7 ${sufijo}`,
    burger: `Hamburguesa especial S7 ${sufijo}`,
    ofertaPizza: `Pizza Membego S7 ${sufijo}`,
    ofertaBurger: `Burger Membego S7 ${sufijo}`,
    campana: `Semana Gastronómica S7 ${sufijo}`,
    cupon: `GASTRO${sufijo.toUpperCase()}`,
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

// ── Montaje por interfaz ────────────────────────────────────────────────────

async function proveedorVinculado(compras: Page, d: Datos): Promise<string> {
  await compras.goto('/superadmin/supply-v2/proveedores')
  await compras.getByTestId('btn-nuevo-proveedor').click()
  await compras.getByRole('button', { name: 'Sí, es una empresa de Membego' }).click()
  await compras.locator('#buscarEmpresa').fill(d.empresa)
  await compras.getByRole('option').filter({ hasText: d.empresa }).getByRole('button').click()
  await compras.getByRole('button', { name: /Vincular como proveedor|Usar este proveedor/ }).click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/proveedores\/[a-z0-9]+$/)
  return compras.url().split('/').pop()!
}

async function producto(compras: Page, supplierId: string, nombre: string, precio: string): Promise<void> {
  await compras.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await compras.getByTestId('btn-agregar-producto').click()
  await compras.locator('#productoNombre').fill(nombre)
  await compras.locator('#productoCategoria').fill('Pizzas')
  await compras.locator('#productoPrecio').fill(precio)
  await compras.getByRole('button', { name: 'Agregar producto' }).click()
  await expect(compras.getByTestId('tabla-catalogo')).toContainText(nombre)
}

async function acuerdoComision(compras: Page, supplierId: string): Promise<void> {
  await compras.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await compras.getByTestId('btn-crear-acuerdo').click()
  await compras.getByTestId('acuerdo-tipo-COMMISSION').click()
  await compras.getByTestId('acuerdo-alcance').getByRole('radio', { name: 'Todo el catálogo' }).check()
  await compras.getByTestId('acuerdo-comision').fill('8')
  await compras.getByTestId('acuerdo-base-comision').selectOption('CONTRACTUAL_SALE_VALUE')
  await compras.getByRole('button', { name: 'Crear acuerdo' }).click()
  await expect(compras.getByTestId('lista-acuerdos')).toContainText('comisión 8')
}

async function ofertaComision(compras: Page, producto: string, titulo: string, precio: string): Promise<void> {
  await compras.goto('/superadmin/supply-v2/ofertas/nueva')
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
  await compras.waitForURL(/\/superadmin\/supply-v2\/ofertas\/(?!nueva)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
}

/**
 * El asistente de 8 pasos (§5, pasos 1–8 del recorrido). Devuelve la url de la
 * ficha de la campaña, que nace en BORRADOR.
 */
async function campanaCreada(compras: Page, d: Datos): Promise<string> {
  await compras.goto('/superadmin/supply-v2/campanas')
  await compras.getByTestId('btn-crear-campana-nav').click()
  await expect(compras.getByTestId('wizard-campana')).toBeVisible()

  // 1 · objetivo
  await compras.getByTestId('campana-nombre').fill(d.campana)
  await compras.getByTestId('campana-continuar').click()
  // 2 · empresas participantes
  await compras.getByTestId('campana-organizador-MEMBEGO').click()
  await compras.getByTestId('campana-proveedor').selectOption({ label: d.empresa })
  await compras.getByTestId('campana-continuar').click()
  // 3 · productos y servicios
  const checks = compras.getByTestId('campana-oferta-check')
  const etiquetas = await compras.getByTestId('campana-ofertas').locator('label').allTextContents()
  const iPizza = etiquetas.findIndex((t) => t.includes(d.ofertaPizza))
  const iBurger = etiquetas.findIndex((t) => t.includes(d.ofertaBurger))
  await checks.nth(iPizza).check()
  await checks.nth(iBurger).check()
  await compras.getByTestId('campana-continuar').click()
  // 4 · tipo de promoción: financiación compartida
  await compras.getByTestId('campana-tipo-COMPARTIDA').click()
  await compras.getByTestId('campana-valor-membego').fill('300')
  await compras.getByTestId('campana-valor-proveedor').fill('100')
  await compras.getByTestId('campana-continuar').click()
  // 5 · financiación y presupuesto
  await compras.getByTestId('campana-presupuesto').fill('3000')
  await compras.getByTestId('campana-continuar').click()
  // 6 · público
  await compras.getByTestId('campana-publico-ALL').click()
  await compras.getByTestId('campana-continuar').click()
  // 7 · vigencia y límites
  await compras.locator('#campanaMaxCliente').fill('1')
  await compras.getByTestId('campana-continuar').click()
  // 8 · resumen con la vista previa económica (paso 11 del recorrido, antes de guardar)
  const ejemplo = compras.getByTestId('campana-ejemplo')
  await expect(ejemplo).toContainText(RD(1000))
  await expect(ejemplo).toContainText(RD(900))
  await expect(ejemplo).toContainText(RD(600))
  await expect(ejemplo).toContainText(RD(72))
  await expect(ejemplo).toContainText(RD(828))
  await compras.screenshot({ path: 'test-results/shots/supply-v2-s7-wizard-resumen.png', fullPage: true })
  await compras.getByTestId('btn-crear-campana').click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/campanas\/(?!nueva)[a-z0-9]+/)
  await expect(compras.getByTestId('estado-campana')).toHaveText('Borrador')
  return compras.url().split('?')[0]!
}

/**
 * Ajusta la promoción que el asistente dejó puesta en una oferta (§16): el
 * techo de la campaña se reparte a partes iguales al crearla y desde la ficha
 * se rebalancea y se decide si se abre con cupón.
 */
async function promocionAjustada(compras: Page, urlCampana: string, tituloOferta: string, presupuesto: string, exigeCupon: boolean): Promise<void> {
  await compras.goto(urlCampana)
  const fila = compras.getByTestId('oferta-campana').filter({ hasText: tituloOferta })
  await fila.getByTestId('btn-abrir-promocion').click()
  const form = fila.getByTestId('form-promocion-campana')
  await form.getByTestId('promocion-tipo-valor').selectOption('FIXED_AMOUNT')
  await form.getByTestId('promocion-valor-membego').fill('300')
  await form.getByTestId('promocion-valor-proveedor').fill('100')
  await form.getByTestId('promocion-presupuesto').fill(presupuesto)
  await form.getByTestId('promocion-exige-cupon').selectOption(exigeCupon ? 'si' : 'no')
  await form.getByTestId('btn-guardar-promocion').click()
  const linea = compras.getByTestId('oferta-campana').filter({ hasText: tituloOferta }).getByTestId('oferta-promocion')
  await expect(linea).toContainText(`presupuesto ${RD(Number(presupuesto))}`)
  if (exigeCupon) await expect(linea).toContainText('se abre con cupón')
}

// ── El recorrido completo de escritorio ─────────────────────────────────────

async function recorridoCompleto(browser: Browser) {
  const d = datos()
  await cuentaDeCobro()
  const empresa = await asegurarEmpresaProveedora(d.empresa, 'Naco')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente')
  const { page: empleado } = await contexto(browser, 'empleado', empresa.id)

  // Montaje: proveedor con dos productos, acuerdo al 8 % y dos ofertas.
  const supplierId = await proveedorVinculado(compras, d)
  await producto(compras, supplierId, d.pizza, '1200')
  await producto(compras, supplierId, d.burger, '900')
  await acuerdoComision(compras, supplierId)
  await ofertaComision(compras, d.pizza, d.ofertaPizza, '1000')
  await ofertaComision(compras, d.burger, d.ofertaBurger, '800')

  // ── 1–4 · la campaña con su financiación y su presupuesto ───────────────
  // El asistente la guarda COMPLETA: campaña, sus dos ofertas y una promoción
  // por oferta repartiendo el techo (1 500 + 1 500 de los 3 000 aprobados).
  const urlCampana = await campanaCreada(compras, d)
  await expect(compras.getByTestId('oferta-campana')).toHaveCount(2)
  await expect(compras.getByTestId('presupuesto-comprometido')).toHaveText(RD(3000))
  // Rebalanceo: la burger baja a 1 000 y la pizza sube a 2 000, con cupón.
  await promocionAjustada(compras, urlCampana, d.ofertaBurger, '1000', false)
  // El techo de la campaña manda: 2 500 + 1 000 no cabe en 3 000.
  const fila = compras.getByTestId('oferta-campana').filter({ hasText: d.ofertaPizza })
  await fila.getByTestId('btn-abrir-promocion').click()
  const form = fila.getByTestId('form-promocion-campana')
  await form.getByTestId('promocion-presupuesto').fill('2500')
  await form.getByTestId('btn-guardar-promocion').click()
  await expect(form.getByRole('alert')).toContainText('presupuesto aprobado')
  await promocionAjustada(compras, urlCampana, d.ofertaPizza, '2000', true)
  await expect(compras.getByTestId('presupuesto-comprometido')).toHaveText(RD(3000))

  // ── 5 · un cupón público con su código ─────────────────────────────────
  await compras.goto(urlCampana)
  const cupones = compras.getByTestId('form-cupones')
  const promos = await cupones.getByTestId('cupon-promocion').locator('option').allTextContents()
  await cupones.getByTestId('cupon-promocion').selectOption({ index: promos.findIndex((t) => t.includes(d.ofertaPizza)) })
  await cupones.getByTestId('cupon-tipo').selectOption('PUBLIC')
  await cupones.getByTestId('cupon-codigo').fill(d.cupon)
  await cupones.getByTestId('cupon-max-total').fill('50')
  await cupones.getByTestId('btn-generar-cupones').click()
  await expect(compras.getByTestId('cupones-generados')).toContainText(d.cupon)
  await expect(compras.getByTestId('tabla-cupones')).toContainText(d.cupon)

  // ── 6 · la aprueba OTRA persona autorizada ─────────────────────────────
  await compras.goto(urlCampana)
  await compras.getByTestId('btn-enviar-revision').click()
  await expect(compras.getByTestId('estado-campana')).toHaveText('En revisión')
  await finanzas.goto(urlCampana)
  await finanzas.getByTestId('btn-aprobar-campana').click()
  // Queda registrado QUIÉN la aprobó.
  await expect(finanzas.getByTestId('campana-ficha')).toContainText('Finanzas E2E')

  // ── 7 · finanzas la publica ────────────────────────────────────────────
  await finanzas.getByTestId('btn-publicar-campana').click()
  await expect(finanzas.getByTestId('estado-campana')).toHaveText('Activa')
  await expect(finanzas.getByTestId('campana-vigente')).toBeVisible()
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s7-campana-publicada.png', fullPage: true })

  // ── 8 · la clienta la encuentra en el marketplace ──────────────────────
  await cliente.goto('/promociones')
  await expect(cliente.getByTestId('campanas-marketplace')).toBeVisible()
  await cliente.getByTestId('link-todas-campanas').click()
  await cliente.waitForURL(/\/promociones\/campanas$/)
  const tarjeta = cliente.getByTestId('campana-publica').filter({ hasText: d.campana })
  await expect(tarjeta).toBeVisible()
  await expect(tarjeta).toContainText(d.empresa)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s7-marketplace.png', fullPage: true })

  // ── 9 · entra en la ficha de la campaña y de ahí al producto ───────────
  await tarjeta.getByTestId('campana-publica-nombre').click()
  await cliente.waitForURL(/\/promociones\/campanas\/MBG-CP-/)
  await expect(cliente.getByTestId('campana-ficha-nombre')).toHaveText(d.campana)
  await expect(cliente.getByTestId('campana-ficha-condiciones')).toContainText('Un uso por persona')
  await cliente.getByTestId('campana-ficha-oferta').filter({ hasText: d.ofertaPizza }).first().click()
  await cliente.waitForURL(/\/promociones\/membego\//)

  // ── 10–11 · aplica el cupón y comprueba el desglose ───────────────────
  await cliente.getByTestId('input-cupon').fill(d.cupon)
  await cliente.getByTestId('btn-comprobar-cupon').click()
  await expect(cliente.getByTestId('cupon-aplicado')).toContainText(d.cupon)
  const desglose = cliente.getByTestId('desglose-cupon')
  await expect(desglose).toContainText(RD(1000))
  await expect(desglose).toContainText(RD(100))
  await expect(cliente.getByTestId('cupon-bono')).toHaveText(`−${RD(300)}`)
  await expect(cliente.getByTestId('cupon-a-pagar')).toHaveText(RD(600))
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s7-cupon-aplicado.png', fullPage: true })

  // ── 12 · compra, paga y finanzas confirma ──────────────────────────────
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const urlCompra = cliente.url()
  const orderId = urlCompra.split('/').pop()!
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(600))
  await expect(cliente.getByTestId('checkout-beneficio-aviso')).toContainText(RD(400))
  await expect(cliente.getByTestId('checkout-campana')).toContainText(d.campana)
  await cliente.locator('#referenciaPago').fill(`CP-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')

  await finanzas.goto('/superadmin/supply-v2/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `CP-${d.sufijo}` })
  await expect(venta.getByTestId('venta-financiacion')).toContainText(RD(900))
  await expect(venta.getByTestId('venta-reparto')).toContainText(`comisión ${RD(72)} · neto ${RD(828)}`)
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `CP-${d.sufijo}` })).toHaveCount(0)

  // ── 13–15 · derecho, QR y entrega del proveedor ───────────────────────
  await cliente.goto('/cliente/compras')
  const beneficio = cliente.getByTestId('beneficio').filter({ hasText: d.pizza }).filter({ visible: true })
  await expect(beneficio.getByTestId('derecho-estado')).toHaveText('Disponible')
  await beneficio.getByTestId('btn-usar-beneficio').click()
  const nonce = (await beneficio.getByTestId('qr-beneficio').getByTestId('qr-codigo').innerText()).trim()
  await empleado.goto('/admin/supply-v2/escaner')
  await empleado.getByTestId('btn-codigo-manual').click()
  await empleado.getByTestId('input-codigo').fill(nonce)
  await empleado.getByTestId('btn-buscar-codigo').click()
  await expect(empleado.getByTestId('preview-valido')).toBeVisible()
  await empleado.getByTestId('btn-confirmar-entrega').click()
  await expect(empleado.getByTestId('entrega-confirmada')).toContainText('Entrega confirmada')
  await cliente.goto('/cliente/compras')
  await expect(cliente.getByTestId('beneficio').filter({ hasText: d.pizza }).filter({ visible: true }).getByTestId('derecho-estado')).toHaveText('Utilizado')

  // El proveedor ve su campaña, su aporte y el de Membego por separado.
  await empleado.goto('/admin/supply-v2/campanas')
  const campanaProv = empleado.getByTestId('campana-proveedor').filter({ hasText: d.campana })
  await expect(campanaProv.getByTestId('campana-prov-aporte')).toContainText(RD(100))
  await expect(campanaProv.getByTestId('campana-prov-membego')).toContainText(RD(300))
  await expect(campanaProv.getByTestId('campana-prov-neto')).toContainText(RD(828))
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s7-portal-proveedor.png', fullPage: true })

  // ── 16 · finanzas verifica el reparto en la liquidación ───────────────
  await finanzas.goto('/superadmin/supply-v2/finanzas/liquidaciones/nueva')
  const proveedores = await finanzas.getByTestId('liquidacion-proveedor').locator('option').allTextContents()
  await finanzas.getByTestId('liquidacion-proveedor').selectOption({ index: proveedores.findIndex((t) => t.includes(d.empresa)) })
  await finanzas.getByTestId('btn-generar-liquidacion').click()
  await finanzas.waitForURL(/\/superadmin\/supply-v2\/finanzas\/liquidaciones\/(?!nueva)[a-z0-9]+/)
  await expect(finanzas.getByTestId('liq-contractual')).toHaveText(RD(900))
  await expect(finanzas.getByTestId('liq-subsidio')).toHaveText(RD(300))
  await expect(finanzas.getByTestId('liq-cobrado')).toHaveText(RD(600))
  await expect(finanzas.getByTestId('liq-neto')).toHaveText(RD(828))
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s7-liquidacion.png', fullPage: true })

  // ── 17 · el tablero enseña los resultados REALES ──────────────────────
  await finanzas.goto(urlCampana)
  await expect(finanzas.getByTestId('metrica-ventas')).toHaveText('1')
  await expect(finanzas.getByTestId('metrica-gmv')).toHaveText(RD(1000))
  await expect(finanzas.getByTestId('metrica-subsidio')).toHaveText(RD(300))
  await expect(finanzas.getByTestId('metrica-contribucion')).toHaveText(`-${RD(228)}`)
  await expect(finanzas.getByTestId('presupuesto-consumido')).toHaveText(RD(300))
  await expect(finanzas.getByTestId('campana-economia')).toContainText(RD(828))
  await expect(finanzas.getByTestId('tabla-cupones')).toContainText(d.cupon)
  await expect(finanzas.getByTestId('historial-campana')).toContainText('Cupones generados')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s7-ficha-campana.png', fullPage: true })

  await finanzas.goto('/superadmin/supply-v2/campanas')
  await expect(finanzas.getByTestId('tablero-campanas')).toBeVisible()
  const filaTablero = finanzas.getByTestId('tabla-campanas').locator('tr').filter({ hasText: d.campana })
  await expect(filaTablero.getByTestId('campana-ventas')).toHaveText('1')
  await expect(filaTablero.getByTestId('campana-consumido')).toContainText(RD(300))
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s7-tablero.png', fullPage: true })

  // ── SQL: lo que la interfaz dijo está en PostgreSQL ──────────────────
  const db = prismaDeArnes()
  const orden = await db.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { campaign: true, couponRedemptions: { include: { reservation: true } } } })
  expect(orden.total.toFixed(2)).toBe('600.00')
  expect(orden.contractualValue.toFixed(2)).toBe('900.00')
  expect(orden.supplierDiscountTotal.toFixed(2)).toBe('100.00')
  expect(orden.membegoSubsidyTotal.toFixed(2)).toBe('300.00')
  expect(orden.commissionAmount?.toFixed(2)).toBe('72.00')
  expect(orden.supplierNet?.toFixed(2)).toBe('828.00')
  // La atribución está congelada y es UNA sola campaña.
  expect(orden.campaign?.name).toBe(d.campana)
  expect(orden.couponCodeSnapshot).toBe(d.cupon)
  // El cupón cuelga de la reserva del beneficio: el dinero se cuenta una vez.
  expect(orden.couponRedemptions.length).toBe(1)
  expect(orden.couponRedemptions[0]!.status).toBe('APPLIED')
  expect(orden.couponRedemptions[0]!.membegoAmount.toFixed(2)).toBe(orden.couponRedemptions[0]!.reservation.membegoAmount.toFixed(2))
  // Y el presupuesto de la campaña se lee de su promoción, sin segundo contador.
  const promos2 = await db.supplyV2Benefit.findMany({ where: { campaign: { name: d.campana } }, select: { budgetReserved: true, budgetConsumed: true } })
  expect(promos2.reduce((t, b) => t + Number(b.budgetConsumed), 0).toFixed(2)).toBe('300.00')
  expect(promos2.reduce((t, b) => t + Number(b.budgetReserved), 0).toFixed(2)).toBe('0.00')
}

// ── Móvil (§33) ─────────────────────────────────────────────────────────────

async function movil(browser: Browser) {
  const d = datos()
  await cuentaDeCobro()
  const empresa = await asegurarEmpresaProveedora(d.empresa, 'Naco')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente2')
  const { page: empleado } = await contexto(browser, 'empleado2', empresa.id)

  const supplierId = await proveedorVinculado(compras, d)
  await producto(compras, supplierId, d.pizza, '1200')
  await acuerdoComision(compras, supplierId)
  await ofertaComision(compras, d.pizza, d.ofertaPizza, '1000')

  // La campaña se monta por interfaz, con un cupón PRIVADO para esta clienta.
  await compras.goto('/superadmin/supply-v2/campanas/nueva')
  await compras.getByTestId('campana-nombre').fill(d.campana)
  await compras.getByTestId('campana-continuar').click()
  await compras.getByTestId('campana-continuar').click()
  const etiquetas = await compras.getByTestId('campana-ofertas').locator('label').allTextContents()
  await compras.getByTestId('campana-oferta-check').nth(etiquetas.findIndex((t) => t.includes(d.ofertaPizza))).check()
  await compras.getByTestId('campana-continuar').click()
  await compras.getByTestId('campana-tipo-CUPON_FIJO').click()
  await compras.getByTestId('campana-valor-membego').fill('300')
  await compras.getByTestId('campana-continuar').click()
  await compras.getByTestId('campana-presupuesto').fill('3000')
  await compras.getByTestId('campana-continuar').click()
  await compras.getByTestId('campana-continuar').click()
  await compras.getByTestId('campana-continuar').click()
  await compras.getByTestId('btn-crear-campana').click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/campanas\/(?!nueva)[a-z0-9]+/)
  const urlCampana = compras.url().split('?')[0]!

  // El asistente la dejó completa: su oferta y su promoción con cupón.
  await expect(compras.getByTestId('oferta-campana')).toHaveCount(1)
  const promocion = compras.getByTestId('oferta-campana').getByTestId('oferta-promocion').first()
  await expect(promocion).toContainText('se abre con cupón')
  await expect(promocion).toContainText(`presupuesto ${RD(3000)}`)

  // Cupón PRIVADO para la clienta del móvil.
  const cupones = compras.getByTestId('form-cupones')
  await cupones.getByTestId('cupon-promocion').selectOption({ index: 1 })
  await cupones.getByTestId('cupon-tipo').selectOption('PRIVATE')
  await cupones.getByTestId('cupon-buscar-cliente').fill('e2e.supply2.cliente2@membego.test')
  await cupones.getByTestId('cupon-opcion-cliente').first().click()
  await cupones.getByTestId('btn-generar-cupones').click()
  await expect(compras.getByTestId('cupones-generados')).toBeVisible()
  const codigo = (await compras.getByTestId('cupones-generados').locator('p').last().innerText()).trim()

  await compras.getByTestId('btn-enviar-revision').click()
  // Se espera a que el estado CAMBIE antes de cambiar de persona: sin esto,
  // finanzas puede cargar la ficha todavía en borrador y quedarse esperando un
  // botón de aprobar que no existe hasta que la acción de compras termine.
  await expect(compras.getByTestId('estado-campana')).toHaveText('En revisión')
  await finanzas.goto(urlCampana)
  await finanzas.getByTestId('btn-aprobar-campana').click()
  await finanzas.getByTestId('btn-publicar-campana').click()
  await expect(finanzas.getByTestId('estado-campana')).toHaveText('Activa')

  // ── Descubrimiento, ficha, «Mis cupones» y checkout en el teléfono ────
  await cliente.goto('/promociones/campanas')
  const tarjetaCampana = cliente.getByTestId('campana-publica').filter({ hasText: d.campana })
  // `toHaveCount(1)` antes de usar el elemento, a propósito: no es un margen de
  // tiempo disfrazado, es la invariante de verdad —de esto hay UNO— y Playwright
  // reintenta hasta que se cumple. Durante una navegación del App Router el DOM
  // puede tener un instante DOS copias del listado; el filtro por texto
  // encontraba una en cada copia y el modo estricto abortaba. Si la página
  // llegara a duplicar de verdad, esta misma línea lo caza: no lo esconde.
  await expect(tarjetaCampana).toHaveCount(1)
  await expect(tarjetaCampana).toBeVisible()
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s7-movil-campanas.png', fullPage: true })

  await cliente.goto('/cliente/cupones')
  const tarjeta = cliente.getByTestId('tarjeta-cupon').filter({ hasText: codigo })
  await expect(tarjeta.getByTestId('cupon-valor')).toHaveText(RD(300))
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s7-movil-cupones.png', fullPage: true })
  await tarjeta.getByTestId('btn-usar-cupon').click()
  await cliente.waitForURL(/\/promociones\/membego\/.*cupon=/)

  // El código llega preseleccionado: solo hay que aplicarlo.
  await expect(cliente.getByTestId('input-cupon')).toHaveValue(codigo)
  await cliente.getByTestId('btn-comprobar-cupon').click()
  await expect(cliente.getByTestId('cupon-a-pagar')).toHaveText(RD(700))
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(700))
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s7-movil-checkout.png', fullPage: true })

  await cliente.locator('#referenciaPago').fill(`MOV-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  // Esperar a que el aviso QUEDE antes de ir a la pantalla de finanzas: sin
  // esto, la navegación de `finanzas` corre contra la server action que acaba
  // de pulsar `cliente` y a veces llega antes de que la venta esté «por
  // revisar». El fallo parece de la pantalla de finanzas y es una carrera de la
  // prueba. (La misma familia de carrera estaba en los slices 6, 7 y 8.)
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply-v2/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `MOV-${d.sufijo}` })
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `MOV-${d.sufijo}` })).toHaveCount(0)

  // Sus beneficios y el portal del proveedor, también en el teléfono.
  await cliente.goto('/cliente/compras')
  await expect(cliente.getByTestId('beneficio').filter({ visible: true }).first().getByTestId('derecho-estado')).toHaveText('Disponible')
  await empleado.goto('/admin/supply-v2/campanas')
  await expect(empleado.getByTestId('campana-proveedor').filter({ hasText: d.campana })).toBeVisible()
  expect(await empleado.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s7-movil-portal.png', fullPage: true })
}

test.describe('Supply 2.0 · Slice 7', () => {
  test.beforeAll(() => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · CAMPAÑA: asistente de 8 pasos → cupón → aprobación de otra persona → publicación → marketplace → cupón aplicado (1 000 − 100 − 300 = 600) → pago → QR → entrega → liquidación (neto 828) → tablero', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(600_000)
    await recorridoCompleto(browser)
  })

  test('móvil · descubre la campaña, usa su cupón privado desde «Mis cupones» y compra en un teléfono', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(420_000)
    await movil(browser)
  })
})
