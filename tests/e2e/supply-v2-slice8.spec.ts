import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 de punta a punta en navegador.
 *
 * EL RECORRIDO OBLIGATORIO, completo y en este orden:
 *   1  compras crea el programa de fidelización (membresías + puntos +
 *      recompensas + referidos) con su presupuesto y su regla de puntos
 *   2  crea un plan DE PAGO y le añade un beneficio del catálogo
 *   3  publica el plan
 *   4  OTRA persona autorizada lo aprueba (quien lo creó no puede)
 *   5  la clienta encuentra la membresía en el marketplace
 *   6  la contrata: se abre el pedido de membresía por el checkout de siempre
 *   7  paga y finanzas confirma → la membresía queda ACTIVA con su beneficio
 *   8  compra una oferta de 1 000 y gana 10 puntos (1 por cada 100)
 *   9  compras crea una recompensa de 100 puntos; finanzas la aprueba
 *  10  la clienta canjea sus puntos y la recompensa queda en su cuenta
 *  11  pide su código de invitación
 *  12  el negocio ve su programa en el portal, con lo que asume
 *  13  el tablero de Membego enseña las cifras REALES y la estimación marcada
 *  14  todo lo anterior, comprobado en PostgreSQL
 *
 * MÓVIL: escaparate, contratación de un plan gratuito, «Mi fidelización» y el
 * portal del negocio en un teléfono, sin desbordamiento lateral.
 *
 * El arnés toca la base SOLO para sesiones, cuenta de cobro, la empresa
 * proveedora y las comprobaciones SQL. Todo lo demás pasa por la interfaz.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const RD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Datos = {
  sufijo: string
  empresa: string
  producto: string
  oferta: string
  programa: string
  planPago: string
  planGratis: string
  beneficio: string
  recompensa: string
}

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return {
    sufijo,
    empresa: `Club Pizza S8 ${sufijo}`,
    producto: `Pizza Club S8 ${sufijo}`,
    oferta: `Pizza Membego S8 ${sufijo}`,
    programa: `Club Membego S8 ${sufijo}`,
    planPago: `Oro S8 ${sufijo}`,
    planGratis: `Básica S8 ${sufijo}`,
    beneficio: `Bono socio S8 ${sufijo}`,
    recompensa: `Pizza gratis S8 ${sufijo}`,
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

// ── Montaje por interfaz (lo de los slices anteriores) ──────────────────────

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

async function productoYOferta(compras: Page, supplierId: string, d: Datos): Promise<string> {
  await compras.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await compras.getByTestId('btn-agregar-producto').click()
  await compras.locator('#productoNombre').fill(d.producto)
  await compras.locator('#productoCategoria').fill('Pizzas')
  await compras.locator('#productoPrecio').fill('1200')
  await compras.getByRole('button', { name: 'Agregar producto' }).click()
  await expect(compras.getByTestId('tabla-catalogo')).toContainText(d.producto)

  await compras.goto(`/superadmin/supply-v2/proveedores/${supplierId}`)
  await compras.getByTestId('btn-crear-acuerdo').click()
  await compras.getByTestId('acuerdo-tipo-COMMISSION').click()
  await compras.getByTestId('acuerdo-alcance').getByRole('radio', { name: 'Todo el catálogo' }).check()
  await compras.getByTestId('acuerdo-comision').fill('8')
  await compras.getByTestId('acuerdo-base-comision').selectOption('CONTRACTUAL_SALE_VALUE')
  await compras.getByRole('button', { name: 'Crear acuerdo' }).click()
  await expect(compras.getByTestId('lista-acuerdos')).toContainText('comisión 8')

  await compras.goto('/superadmin/supply-v2/ofertas/nueva')
  await compras.getByTestId('fuente-comision').click()
  await compras.waitForURL(/fuente=COMMISSION/)
  const select = compras.getByTestId('comision-producto')
  const opciones = await select.locator('option').allTextContents()
  await select.selectOption({ index: opciones.findIndex((t) => t.includes(d.producto)) })
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-modo-UNLIMITED').click()
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-precio').fill('1000')
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('comision-titulo').fill(d.oferta)
  await compras.locator('#ofertaLimiteC').fill('3')
  await compras.getByTestId('comision-continuar').click()
  await compras.getByTestId('btn-publicar-oferta-comision').click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/ofertas\/(?!nueva)[a-z0-9]+$/)
  await expect(compras.getByTestId('estado-oferta')).toHaveText('Activa')
  // La dirección pública de la oferta sale de la propia pantalla, no de la base.
  return (await compras.getByTestId('link-ver-marketplace').getAttribute('href'))!
}

/** Un beneficio del catálogo, de los que se ASIGNAN: es lo que un plan incluye. */
async function beneficioAsignable(compras: Page, finanzas: Page, d: Datos): Promise<void> {
  await compras.goto('/superadmin/supply-v2/beneficios')
  await compras.getByTestId('btn-crear-beneficio-nav').click()
  await compras.getByTestId('beneficio-nombre').fill(d.beneficio)
  await compras.getByTestId('beneficio-continuar').click()
  await compras.getByTestId('beneficio-funding-MEMBEGO').click()
  await compras.getByTestId('beneficio-continuar').click()
  await compras.getByTestId('beneficio-tipo-FIXED_AMOUNT').click()
  await compras.getByTestId('beneficio-valor-membego').fill('200')
  await compras.getByTestId('beneficio-continuar').click()
  await compras.getByTestId('beneficio-alcance-SPECIFIC_OFFER').click()
  const ofertas = compras.getByTestId('beneficio-oferta')
  const textos = await ofertas.locator('option').allTextContents()
  await ofertas.selectOption({ index: textos.findIndex((t) => t.includes(d.oferta)) })
  await compras.getByTestId('beneficio-continuar').click()
  await compras.getByTestId('beneficio-presupuesto').fill('5000')
  await compras.getByTestId('beneficio-continuar').click()
  await compras.getByTestId('beneficio-asignacion').selectOption('si')
  await compras.getByTestId('beneficio-continuar').click()
  await compras.getByTestId('btn-crear-beneficio').click()
  await compras.waitForURL(/\/superadmin\/supply-v2\/beneficios\/(?!nuevo)[a-z0-9]+$/)
  const url = compras.url()
  // Lo aprueba otra persona: quien lo creó no puede.
  await finanzas.goto(url)
  await finanzas.getByTestId('btn-aprobar-beneficio').click()
  await expect(finanzas.getByTestId('estado-beneficio')).toHaveText('Activo')
}

// ── El programa de fidelización, por interfaz ───────────────────────────────

/** Pasos 1–2 del recorrido: el programa con sus cuatro modalidades. */
async function programaCreado(compras: Page, d: Datos, supplierNombre: string): Promise<string> {
  await compras.goto('/superadmin/supply-v2/fidelizacion')
  await compras.getByTestId('btn-crear-programa-nav').click()
  await expect(compras.getByTestId('form-programa')).toBeVisible()

  await compras.getByTestId('programa-nombre').fill(d.programa)
  // Las cuatro modalidades: membresías ya viene marcada.
  await compras.getByTestId('modalidad-REFERRALS').check()
  await compras.getByTestId('modalidad-POINTS').check()
  await compras.getByTestId('modalidad-REWARDS').check()
  // Con membresías hay que decir de qué negocio es: una membresía es siempre
  // la de un negocio concreto, aunque la administre y la pague Membego.
  await compras.getByTestId('programa-proveedor').selectOption({ label: supplierNombre })
  // Lo administra Membego y lo financia Membego: hace falta techo.
  await compras.getByTestId('programa-presupuesto').fill('50000')
  // La regla de puntos aparece porque el programa tiene puntos.
  await expect(compras.getByTestId('programa-regla-puntos')).toBeVisible()
  await compras.getByTestId('programa-puntos-por-unidad').fill('1')
  await compras.getByTestId('programa-importe-por-punto').fill('100')
  await compras.getByTestId('programa-base').selectOption('CUSTOMER_PAID')
  await compras.screenshot({ path: 'test-results/shots/supply-v2-s8-programa-nuevo.png', fullPage: true })
  await compras.getByTestId('btn-crear-programa').click()

  await compras.waitForURL(/\/superadmin\/supply-v2\/fidelizacion\/(?!nuevo)[a-z0-9]+/)
  await expect(compras.getByTestId('estado-programa')).toHaveText('Borrador')
  await expect(compras.getByTestId('programa-ficha')).toContainText('Membresías')
  return compras.url().split('?')[0]!
}

/**
 * Paso 3: un plan con su beneficio. Queda en BORRADOR a propósito: un plan no
 * se puede publicar hasta que su programa esté activo, porque si no nadie
 * podría usar lo que incluye.
 */
async function planCreado(compras: Page, urlPrograma: string, nombre: string, precio: string | null, beneficio: string): Promise<void> {
  await compras.goto(urlPrograma)
  const form = compras.getByTestId('form-plan')
  await form.getByTestId('plan-nombre').fill(nombre)
  await form.getByTestId('plan-tipo').selectOption(precio ? 'PAID' : 'FREE')
  if (precio) await form.getByTestId('plan-precio').fill(precio)
  await form.getByTestId('plan-dias').fill('30')
  await form.getByTestId('btn-crear-plan').click()

  const fila = compras.getByTestId('plan-programa').filter({ hasText: nombre })
  await expect(fila).toBeVisible()
  // Lo que incluye: un beneficio del catálogo, no un descuento nuevo.
  await fila.getByTestId('btn-abrir-beneficio-plan').click()
  const fb = fila.getByTestId('form-beneficio-plan')
  await fb.getByTestId('beneficio-plan-tipo').selectOption('BENEFIT')
  const opciones = await fb.getByTestId('beneficio-plan-beneficio').locator('option').allTextContents()
  await fb.getByTestId('beneficio-plan-beneficio').selectOption({ index: opciones.findIndex((t) => t.includes(beneficio)) })
  await fb.getByTestId('btn-guardar-beneficio-plan').click()
  await expect(compras.getByTestId('historial-programa')).toContainText('Plan creado')
  await expect(compras.getByTestId('plan-programa').filter({ hasText: nombre }).getByTestId('estado-plan')).toHaveText('Borrador')
}

/** Publicar el plan: solo se puede con el programa ya ACTIVO. */
async function publicarPlan(page: Page, urlPrograma: string, nombre: string): Promise<void> {
  await page.goto(urlPrograma)
  await page.getByTestId('plan-programa').filter({ hasText: nombre }).getByTestId('btn-publicar-plan').click()
  await expect(page.getByTestId('plan-programa').filter({ hasText: nombre }).getByTestId('estado-plan')).toHaveText('Publicado')
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

  const supplierId = await proveedorVinculado(compras, d)
  const urlOferta = await productoYOferta(compras, supplierId, d)
  await beneficioAsignable(compras, finanzas, d)

  // ── 1–2 · el programa con su presupuesto y su regla de puntos ───────────
  const urlPrograma = await programaCreado(compras, d, d.empresa)

  // ── 3 · un plan de pago con su beneficio (nace borrador) ────────────────
  await planCreado(compras, urlPrograma, d.planPago, '500', d.beneficio)

  // ── 4 · lo aprueba OTRA persona autorizada ──────────────────────────────
  await compras.goto(urlPrograma)
  await compras.getByTestId('btn-enviar-revision-programa').click()
  await expect(compras.getByTestId('estado-programa')).toHaveText('En revisión')
  await compras.getByTestId('btn-aprobar-programa').click()
  await expect(compras.getByTestId('acciones-programa').getByRole('alert')).toContainText(/no lo aprueba la misma persona|otra persona/)
  await finanzas.goto(urlPrograma)
  await finanzas.getByTestId('btn-aprobar-programa').click()
  await expect(finanzas.getByTestId('estado-programa')).toHaveText('Activo')
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s8-programa-activo.png', fullPage: true })

  // Y SOLO ahora se puede publicar el plan: con el programa activo.
  await publicarPlan(compras, urlPrograma, d.planPago)

  // ── 5 · la clienta la encuentra en el marketplace ───────────────────────
  await cliente.goto('/promociones')
  await expect(cliente.getByTestId('membresias-marketplace')).toBeVisible()
  await cliente.getByTestId('link-todas-membresias').click()
  await cliente.waitForURL(/\/promociones\/membresias$/)
  const tarjeta = cliente.getByTestId('plan-publico').filter({ hasText: d.planPago })
  await expect(tarjeta.getByTestId('plan-publico-precio')).toHaveText(RD(500))
  await expect(tarjeta.getByTestId('plan-publico-duracion')).toHaveText('30 días')
  await expect(tarjeta.getByTestId('plan-publico-incluye')).toContainText(d.beneficio)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s8-escaparate.png', fullPage: true })

  // ── 6 · la contrata: pedido de membresía por el checkout de siempre ─────
  await tarjeta.getByTestId('btn-contratar-membresia').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const urlMembresia = cliente.url()
  const orderMembresia = urlMembresia.split('/').pop()!
  // Lo que se compra es el plan: no hay carrito, ni lote, ni derecho.
  await expect(cliente.getByTestId('checkout-membresia')).toBeVisible()
  await expect(cliente.getByTestId('checkout-producto')).toHaveText(d.planPago)
  await expect(cliente.getByTestId('checkout-total')).toHaveText(RD(500))

  // ── 7 · paga y finanzas confirma ────────────────────────────────────────
  await cliente.locator('#referenciaPago').fill(`MEM-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')

  await finanzas.goto('/superadmin/supply-v2/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `MEM-${d.sufijo}` })
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `MEM-${d.sufijo}` })).toHaveCount(0)

  // La membresía está activa y su beneficio quedó en la cuenta de la clienta.
  await cliente.goto('/cliente/fidelizacion')
  const mem = cliente.getByTestId('tarjeta-membresia').filter({ hasText: d.planPago })
  await expect(mem.getByTestId('estado-membresia')).toHaveText('Activa')
  await expect(mem.getByTestId('membresia-beneficios')).toContainText(d.beneficio)
  await expect(mem.getByTestId('membresia-dias')).toContainText('30 día')
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s8-mi-fidelizacion.png', fullPage: true })

  // ── 8 · una compra de 1 000 da 10 puntos (1 por cada 100) ───────────────
  await cliente.goto(urlOferta)
  await expect(cliente.getByTestId('btn-comprar')).toBeVisible()
  // Sin elegir el bono del plan: se compra a precio completo, y los puntos
  // salen de lo que la clienta paga de verdad.
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  const orderCompra = cliente.url().split('/').pop()!
  await cliente.locator('#referenciaPago').fill(`PTS-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  await finanzas.goto('/superadmin/supply-v2/ofertas/ventas')
  const venta2 = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: `PTS-${d.sufijo}` })
  await venta2.getByTestId('btn-confirmar-pago').click()
  await venta2.getByTestId('btn-confirmar-pago-confirmar').click()

  await cliente.goto('/cliente/fidelizacion')
  await expect(cliente.getByTestId('fidelizacion-puntos-total')).toHaveText('10')
  const puntos = cliente.getByTestId('tarjeta-puntos').filter({ hasText: d.programa })
  await expect(puntos.getByTestId('puntos-disponibles')).toHaveText('10')

  // ── 9 · una recompensa de 10 puntos, aprobada por otra persona ──────────
  await compras.goto(urlPrograma)
  const fr = compras.getByTestId('form-recompensa')
  await fr.getByTestId('recompensa-nombre').fill(d.recompensa)
  await fr.getByTestId('recompensa-tipo').selectOption('BENEFIT')
  await fr.getByTestId('recompensa-puntos').fill('10')
  const opcionesBen = await fr.getByTestId('recompensa-beneficio').locator('option').allTextContents()
  await fr.getByTestId('recompensa-beneficio').selectOption({ index: opcionesBen.findIndex((t) => t.includes(d.beneficio)) })
  await fr.getByTestId('recompensa-costo').fill('200')
  await fr.getByTestId('recompensa-presupuesto').fill('2000')
  await fr.getByTestId('btn-crear-recompensa').click()
  const filaRec = compras.getByTestId('recompensa-programa').filter({ hasText: d.recompensa })
  await expect(filaRec.getByTestId('estado-recompensa')).toHaveText('Borrador')

  await finanzas.goto(urlPrograma)
  await finanzas.getByTestId('recompensa-programa').filter({ hasText: d.recompensa }).getByTestId('btn-aprobar-recompensa').click()
  await expect(finanzas.getByTestId('recompensa-programa').filter({ hasText: d.recompensa }).getByTestId('estado-recompensa')).toHaveText('Activa')

  // ── 10 · la clienta canjea sus puntos ───────────────────────────────────
  await cliente.goto('/cliente/fidelizacion')
  const rec = cliente.getByTestId('tarjeta-recompensa').filter({ hasText: d.recompensa })
  await expect(rec.getByTestId('recompensa-puntos')).toHaveText('10 puntos')
  await rec.getByTestId('btn-reclamar-recompensa').click()
  await expect(cliente.getByTestId('fidelizacion-puntos-total')).toHaveText('0')
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s8-canje.png', fullPage: true })

  // ── 11 · su código de invitación ────────────────────────────────────────
  await compras.goto(urlPrograma)
  const fref = compras.getByTestId('form-referidos')
  await fref.getByTestId('referidos-tipo').selectOption('POINTS')
  await fref.getByTestId('referidos-puntos').fill('50')
  await fref.getByTestId('btn-guardar-referidos').click()
  await expect(compras.getByTestId('referidos-config')).toContainText('50 puntos')

  await cliente.goto('/cliente/fidelizacion')
  await cliente.getByTestId('btn-pedir-codigo').click()
  const codigo = (await cliente.getByTestId('mi-codigo-referido').innerText()).trim()
  expect(codigo.length).toBeGreaterThanOrEqual(6)
  // Pedirlo otra vez devuelve el MISMO código: es estable.
  await cliente.reload()
  await expect(cliente.getByTestId('mi-codigo-referido')).toHaveText(codigo)

  // ── 12 · el negocio ve lo suyo ──────────────────────────────────────────
  await empleado.goto('/admin/supply-v2/fidelizacion')
  const prov = empleado.getByTestId('programa-proveedor').filter({ hasText: d.programa })
  await expect(prov.getByTestId('programa-prov-miembros')).toHaveText('1')
  await expect(prov.getByTestId('programa-prov-puntos')).toHaveText('10')
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s8-portal-proveedor.png', fullPage: true })

  // ── 13 · el tablero de Membego: cifras reales y estimación marcada ──────
  await finanzas.goto('/superadmin/supply-v2/fidelizacion')
  await expect(finanzas.getByTestId('tablero-fidelizacion')).toBeVisible()
  await expect(finanzas.getByTestId('tablero-advertencia')).toContainText(/estimaci|no es/i)
  const fila = finanzas.getByTestId('fila-programa').filter({ hasText: d.programa })
  await expect(fila.getByTestId('programa-miembros')).toHaveText('1')
  await expect(fila.getByTestId('programa-puntos')).toHaveText('10')
  await expect(fila.getByTestId('programa-canjes')).toHaveText('1')
  await expect(fila.getByTestId('programa-presupuesto')).toHaveText(RD(50000))
  await finanzas.screenshot({ path: 'test-results/shots/supply-v2-s8-tablero.png', fullPage: true })

  await finanzas.goto(urlPrograma)
  await expect(finanzas.getByTestId('programa-puntos-emitidos')).toHaveText('10')
  await expect(finanzas.getByTestId('programa-estimacion-aviso')).toContainText('ESTIMACIÓN')
  await expect(finanzas.getByTestId('historial-programa')).toContainText('Recompensa reclamada')

  // ── 14 · SQL: lo que la interfaz dijo está en PostgreSQL ────────────────
  const db = prismaDeArnes()
  const programa = await db.supplyV2LoyaltyProgram.findFirstOrThrow({
    where: { name: d.programa },
    include: { plans: true, rewards: true, pointsAccounts: { include: { movements: true } }, memberships: true },
  })
  expect(programa.status).toBe('ACTIVE')
  expect(programa.budgetTotal?.toFixed(2)).toBe('50000.00')
  // Quien lo aprobó NO es quien lo creó.
  expect(programa.approvedById).not.toBe(programa.createdById)

  // El pedido de membresía: sin líneas, sin derechos, con su plan.
  const orden = await db.supplyV2CustomerOrder.findUniqueOrThrow({
    where: { id: orderMembresia },
    include: { lines: true, entitlements: true, membershipPlan: true, membership: true },
  })
  expect(orden.kind).toBe('MEMBERSHIP')
  expect(orden.status).toBe('PAID')
  expect(orden.total.toFixed(2)).toBe('500.00')
  expect(orden.lines.length).toBe(0)
  expect(orden.entitlements.length).toBe(0)
  expect(orden.membershipPlan?.name).toBe(d.planPago)
  expect(orden.membership?.status).toBe('ACTIVE')

  // El ingreso de la membresía SÍ está en la economía, y una sola vez.
  const eventos = await db.supplyV2EconomicEvent.findMany({ where: { referenceType: 'CUSTOMER_ORDER', referenceId: orderMembresia } })
  expect(eventos.length).toBe(1)
  expect(eventos[0]!.type).toBe('SALE_REVENUE')

  // Los puntos: 10 por una compra de 1 000, con la regla CONGELADA.
  const cuenta = programa.pointsAccounts[0]!
  const ganados = cuenta.movements.filter((m) => m.orderId === orderCompra && m.type === 'EARNED')
  expect(ganados.length).toBe(1)
  expect(ganados[0]!.points).toBe(10)
  expect(ganados[0]!.ruleSnapshot).not.toBeNull()
  // El canje consumió exactamente esos 10 y el saldo cuadra con el ledger.
  expect(cuenta.redeemed).toBe(10)
  expect(cuenta.available).toBe(0)
  const suma = (campo: 'availableDelta' | 'redeemedDelta') => cuenta.movements.reduce((t, m) => t + m[campo], 0)
  expect(cuenta.available).toBe(suma('availableDelta'))
  expect(cuenta.redeemed).toBe(suma('redeemedDelta'))

  // La reclamación cuelga de su beneficio: lo que se entrega lo paga el catálogo.
  const claim = await db.supplyV2RewardClaim.findFirstOrThrow({ where: { programId: programa.id }, include: { reward: true } })
  expect(claim.pointsConsumed).toBe(10)
  expect(claim.customerBenefitId).not.toBeNull()
  expect(claim.reward.benefitId).not.toBeNull()

  // El código de invitación es el que la pantalla enseñó.
  const refCode = await db.supplyV2ReferralCode.findFirstOrThrow({ where: { programId: programa.id } })
  expect(refCode.code).toBe(codigo)
}

// ── Móvil ───────────────────────────────────────────────────────────────────

async function movil(browser: Browser) {
  const d = datos()
  await cuentaDeCobro()
  const empresa = await asegurarEmpresaProveedora(d.empresa, 'Naco')
  const { page: compras } = await contexto(browser, 'compras')
  const { page: finanzas } = await contexto(browser, 'finanzas')
  const { page: cliente } = await contexto(browser, 'cliente2')
  const { page: empleado } = await contexto(browser, 'empleado2', empresa.id)

  const supplierId = await proveedorVinculado(compras, d)
  await productoYOferta(compras, supplierId, d)
  await beneficioAsignable(compras, finanzas, d)

  // Un plan GRATUITO: se activa en el acto, sin pasar por el pago.
  const urlPrograma = await programaCreado(compras, d, d.empresa)
  await planCreado(compras, urlPrograma, d.planGratis, null, d.beneficio)
  await compras.goto(urlPrograma)
  await compras.getByTestId('btn-enviar-revision-programa').click()
  await finanzas.goto(urlPrograma)
  await finanzas.getByTestId('btn-aprobar-programa').click()
  await expect(finanzas.getByTestId('estado-programa')).toHaveText('Activo')
  await publicarPlan(compras, urlPrograma, d.planGratis)

  // ── El escaparate y la contratación en el teléfono ──────────────────────
  await cliente.goto('/promociones/membresias')
  const tarjeta = cliente.getByTestId('plan-publico').filter({ hasText: d.planGratis })
  await expect(tarjeta.getByTestId('plan-publico-precio')).toHaveText('Gratis')
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s8-movil-escaparate.png', fullPage: true })

  await tarjeta.getByTestId('btn-contratar-membresia').click()
  await cliente.waitForURL(/\/cliente\/fidelizacion/)
  const mem = cliente.getByTestId('tarjeta-membresia').filter({ hasText: d.planGratis })
  await expect(mem.getByTestId('estado-membresia')).toHaveText('Activa')
  await expect(mem.getByTestId('membresia-beneficios')).toContainText(d.beneficio)
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-s8-movil-fidelizacion.png', fullPage: true })

  // Un plan gratuito no abre pedido: nada que pagar.
  const db = prismaDeArnes()
  const membresia = await db.supplyV2CustomerMembership.findFirstOrThrow({
    where: { plan: { name: d.planGratis } },
    include: { plan: true, customerBenefits: true },
  })
  expect(membresia.status).toBe('ACTIVE')
  expect(membresia.orderId).toBeNull()
  expect(membresia.pricePaid.toFixed(2)).toBe('0.00')
  expect(membresia.customerBenefits.length).toBeGreaterThanOrEqual(1)

  // El portal del negocio, también en el teléfono.
  await empleado.goto('/admin/supply-v2/fidelizacion')
  await expect(empleado.getByTestId('programa-proveedor').filter({ hasText: d.programa })).toBeVisible()
  expect(await empleado.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-s8-movil-portal.png', fullPage: true })
}

test.describe('Supply 2.0 · Slice 8', () => {
  test.beforeAll(() => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · FIDELIZACIÓN: programa → plan de pago → aprobación de otra persona → marketplace → contratación → pago → membresía activa → 10 puntos por 1 000 → recompensa aprobada → canje → código de invitación → portal → tablero', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(600_000)
    await recorridoCompleto(browser)
  })

  test('móvil · contrata un plan gratuito y ve su fidelización en un teléfono', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(420_000)
    await movil(browser)
  })
})
