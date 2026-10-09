import { test, expect, type Browser, type Page } from '@playwright/test'
import { asegurarEmpresaProveedora, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE, pasarALaFichaDeLaApp } from './supply-v2-sesion'

/**
 * MEMBEGO SUPPLY · SLICE 3 de punta a punta en navegador (§73–§76).
 *
 *   ADMIN     Little Pizza (empresa registrada) vinculada como proveedor →
 *             producto → acuerdo → PO 1.000 → aprobación → recepción →
 *             oferta 100 @ RD$399 → publicar
 *   CLIENTE   compra 1 → avisa el pago
 *   ADMIN     confirma el pago → derecho ACTIVE
 *   CLIENTE   Mis compras → «Usar beneficio» → QR con cuenta atrás
 *   EMPLEADO  Entregas Membego → Escanear → código a mano → BENEFICIO VÁLIDO
 *             → Confirmar entrega → ENTREGA CONFIRMADA
 *   CLIENTE   beneficio «Utilizado» con fecha y sucursal
 *   ADMIN     Redenciones → la entrega, con costo congelado; Supply: emitidas 0, redimidas 1
 *   EMPLEADO  el mismo código otra vez → «ya fue utilizado» (§74)
 *   ADMIN     reversar con motivo → beneficio disponible de nuevo (§75)
 *   CLIENTE   nuevo QR → el arnés lo hace expirar → «expiró» en el escáner →
 *             otro QR → el viejo consumido no revive → entrega otra vez
 *
 * El arnés toca la base SOLO para: usuarios de sesión, cuenta de cobro de
 * Membego, la empresa proveedora con su sucursal (en producción se registra
 * desde el panel) y adelantar el reloj de una sesión QR. Todo lo demás pasa
 * por la interfaz. En móvil corre el mismo recorrido sin la parte de reversa.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'

type Datos = { sufijo: string; empresa: string; producto: string; oferta: string }

function datos(): Datos {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return { sufijo, empresa: `Little Pizza S3 ${sufijo}`, producto: `Pizza Grande Pepperoni S3 ${sufijo}`, oferta: `Pizza Pepperoni Membego S3 ${sufijo}` }
}

/** Slice 1 por la interfaz, con proveedor = EMPRESA REGISTRADA. */
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

async function ofertaPublicada(compras: Page, d: Datos): Promise<string> {
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
  return compras.url()
}

async function compraPagada(cliente: Page, finanzas: Page, d: Datos): Promise<void> {
  await cliente.goto('/promociones')
  const tarjetaOferta = cliente.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: d.oferta })
  // `toHaveCount(1)` antes de usar el elemento, a propósito: no es un margen de
  // tiempo disfrazado, es la invariante de verdad —de esto hay UNO— y Playwright
  // reintenta hasta que se cumple. Durante una navegación del App Router el DOM
  // puede tener un instante DOS copias del listado; el filtro por texto
  // encontraba una en cada copia y el modo estricto abortaba. Si la página
  // llegara a duplicar de verdad, esta misma línea lo caza: no lo esconde.
  await expect(tarjetaOferta).toHaveCount(1)
  await tarjetaOferta.click()
  await pasarALaFichaDeLaApp(cliente)
  await cliente.getByTestId('btn-comprar').click()
  await cliente.waitForURL(/\/cliente\/compras\/[a-z0-9]+$/)
  await cliente.locator('#referenciaPago').fill(`TRX-S3-${d.sufijo}`)
  await cliente.getByTestId('btn-avisar-pago').click()
  await expect(cliente.getByTestId('estado-compra')).toHaveText('Pago en revisión')
  await finanzas.goto('/superadmin/supply/ofertas/ventas')
  const venta = finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: d.oferta })
  await venta.getByTestId('btn-confirmar-pago').click()
  await venta.getByTestId('btn-confirmar-pago-confirmar').click()
  await expect(finanzas.getByTestId('pagos-por-revisar').getByTestId('venta').filter({ hasText: d.oferta })).toHaveCount(0)
}

/** Solo lo visible: el shell del cliente puede montar la página más de una vez (una copia oculta por tamaño de pantalla). */
function beneficio(cliente: Page, d: Datos) {
  return cliente.getByTestId('beneficio').filter({ hasText: d.producto }).filter({ visible: true })
}

/** CLIENTE: «Usar beneficio» → QR en pantalla → devuelve el código temporal. */
async function generarQr(cliente: Page, d: Datos): Promise<string> {
  await cliente.goto('/cliente/compras')
  const b = beneficio(cliente, d)
  await expect(b.getByTestId('derecho-estado')).toHaveText('Disponible')
  await expect(b.getByTestId('qr-beneficio')).toHaveCount(0)
  await b.getByTestId('btn-usar-beneficio').click()
  const qr = b.getByTestId('qr-beneficio')
  await expect(qr).toBeVisible()
  await expect(qr).toContainText(`Presenta este código en ${d.empresa}`)
  await expect(qr.getByTestId('qr-imagen')).toBeVisible()
  await expect(qr.getByTestId('qr-cuenta-atras')).toHaveText(/^[0-4]:[0-5]\d$/)
  await expect(qr).toContainText('No compartas este código.')
  const nonce = (await qr.getByTestId('qr-codigo').innerText()).trim()
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{32}$/)
  return nonce
}

/** EMPLEADO: escribe el código a mano y devuelve la tarjeta del resultado. */
async function escanear(empleado: Page, codigo: string): Promise<void> {
  await empleado.goto('/admin/supply/escaner')
  await empleado.getByTestId('btn-codigo-manual').click()
  await empleado.getByTestId('input-codigo').fill(codigo)
  await empleado.getByTestId('btn-buscar-codigo').click()
}

async function pool(page: Page, d: Datos) {
  await page.goto('/superadmin/supply/supply')
  const tarjeta = page.getByTestId('pool-producto').filter({ hasText: d.producto })
  const n = async (id: string) => Number((await tarjeta.getByTestId(id).innerText()).replace(/[^\d]/g, ''))
  return { disponibles: await n('pool-disponibles'), asignadas: await n('pool-asignadas'), emitidas: await n('pool-emitidas'), redimidas: await n('pool-redimidas') }
}

async function recorrido(browser: Browser, opciones: { conReversa: boolean; cliente: 'cliente' | 'cliente2'; empleado: 'empleado' | 'empleado2' }) {
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
  const ana = await entrarComo(ctxCliente, opciones.cliente, BASE)
  const ctxEmpleado = await browser.newContext()
  const empleado = await ctxEmpleado.newPage()
  await entrarComo(ctxEmpleado, opciones.empleado, BASE, empresa.id)

  // ── Slices 1 y 2 por la interfaz ──────────────────────────────────────
  await supplyRecibido(compras, finanzas, d)
  await ofertaPublicada(compras, d)
  await compraPagada(cliente, finanzas, d)
  expect(await pool(compras, d)).toMatchObject({ disponibles: 900, asignadas: 99, emitidas: 1, redimidas: 0 })

  // ── CLIENTE · Usar beneficio → QR ─────────────────────────────────────
  const nonce1 = await generarQr(cliente, d)
  await cliente.screenshot({ path: 'test-results/shots/supply-v2-qr-cliente.png', fullPage: true })

  // ── EMPLEADO · portal, escáner, preview, confirmar ────────────────────
  await empleado.goto('/admin/supply')
  await expect(empleado.getByTestId('entregas-hoy')).toHaveText('0')
  await expect(empleado.getByTestId('pendientes')).toHaveText(/\d+/)
  await empleado.getByTestId('btn-escanear').click()
  await empleado.waitForURL(/\/admin\/supply\/escaner/)
  await escanear(empleado, nonce1)
  const preview = empleado.getByTestId('preview-valido')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Beneficio válido')
  await expect(preview.getByTestId('preview-cliente')).toHaveText(ana.nombre)
  await expect(preview.getByTestId('preview-producto')).toHaveText(d.producto)
  await expect(preview.getByTestId('preview-paga')).toHaveText('RD$0.00')
  await expect(preview).toContainText('Bávaro')
  // Nada interno llega al navegador del empleado.
  const html = await empleado.content()
  expect(html).not.toMatch(/unitCost|actualUnitCost|LOT-\d{4}|margen/i)
  await empleado.screenshot({ path: 'test-results/shots/supply-v2-preview-empleado.png', fullPage: true })
  await empleado.getByTestId('btn-confirmar-entrega').click()
  await expect(empleado.getByTestId('entrega-confirmada')).toContainText('Entrega confirmada')
  await expect(empleado.getByTestId('entrega-confirmada')).toContainText(ana.nombre)

  // ── CLIENTE · Utilizado ───────────────────────────────────────────────
  await cliente.goto('/cliente/compras')
  await expect(beneficio(cliente, d).getByTestId('derecho-estado')).toHaveText('Utilizado')
  await expect(beneficio(cliente, d).getByTestId('beneficio-utilizado')).toContainText('Bávaro')
  await expect(beneficio(cliente, d).getByTestId('btn-usar-beneficio')).toHaveCount(0)

  // ── ADMIN · redención visible y supply ISSUED −1 / REDEEMED +1 ────────
  await compras.goto('/superadmin/supply/redenciones')
  const fila = compras.getByTestId('redencion').filter({ hasText: d.producto })
  await expect(fila).toContainText('Entregada')
  await expect(fila).toContainText('Bávaro')
  await fila.getByTestId('link-redencion').click()
  await compras.waitForURL(/\/superadmin\/supply\/redenciones\/[a-z0-9]+$/)
  const urlRedencion = compras.url()
  await expect(compras.getByTestId('redencion-costo')).toContainText('300')
  await expect(compras.getByTestId('redencion-timeline')).toContainText('Entregado')
  expect(await pool(compras, d)).toMatchObject({ disponibles: 900, asignadas: 99, emitidas: 0, redimidas: 1 })

  // ── EMPLEADO · doble escaneo (§74) ────────────────────────────────────
  await escanear(empleado, nonce1)
  await expect(empleado.getByTestId('preview-rechazado')).toHaveText(/ya fue utilizado/)
  await expect(empleado.getByTestId('preview-valido')).toHaveCount(0)
  await empleado.goto('/admin/supply')
  await expect(empleado.getByTestId('entregas-hoy')).toHaveText('1')
  await expect(empleado.getByTestId('entrega').filter({ hasText: d.producto })).toContainText(ana.nombre)

  if (!opciones.conReversa) return

  // ── ADMIN · reversa con motivo (§75) ──────────────────────────────────
  await compras.goto(urlRedencion)
  await compras.getByTestId('btn-reversar').click()
  await compras.getByTestId('motivo-reversa').fill('Entrega marcada por error en el mostrador.')
  await compras.getByTestId('btn-reversar-confirmar').click()
  await expect(compras.getByTestId('redencion-reversada')).toContainText('Entrega marcada por error')
  expect(await pool(compras, d)).toMatchObject({ emitidas: 1, redimidas: 0 })

  // ── CLIENTE · disponible de nuevo; el QR viejo no revive ──────────────
  const nonce2 = await generarQr(cliente, d)
  expect(nonce2).not.toBe(nonce1)
  await escanear(empleado, nonce1)
  await expect(empleado.getByTestId('preview-rechazado')).toHaveText(/ya se usó|no válido/)

  // ── QR expirado (§26): el arnés adelanta el reloj de la sesión nueva ──
  await db.supplyV2QrSession.update({ where: { nonce: nonce2 }, data: { createdAt: new Date(Date.now() - 6 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })
  await escanear(empleado, nonce2)
  await expect(empleado.getByTestId('preview-rechazado')).toHaveText(/expiró/)
  await cliente.reload()
  await expect(beneficio(cliente, d).getByTestId('derecho-estado')).toHaveText('Disponible')

  // ── Nuevo QR → entrega otra vez ───────────────────────────────────────
  const nonce3 = await generarQr(cliente, d)
  await escanear(empleado, nonce3)
  await expect(empleado.getByTestId('preview-valido')).toBeVisible()
  await empleado.getByTestId('btn-confirmar-entrega').click()
  await expect(empleado.getByTestId('entrega-confirmada')).toBeVisible()
  await cliente.goto('/cliente/compras')
  await expect(beneficio(cliente, d).getByTestId('derecho-estado')).toHaveText('Utilizado')
  expect(await pool(compras, d)).toMatchObject({ disponibles: 900, asignadas: 99, emitidas: 0, redimidas: 1 })
  await compras.goto('/superadmin/supply/redenciones')
  await expect(compras.getByTestId('redencion').filter({ hasText: d.producto })).toHaveCount(2)
  await expect(compras.getByTestId('redencion').filter({ hasText: d.producto }).filter({ hasText: 'Reversada' })).toHaveCount(1)
}

test.describe('Supply · Slice 3', () => {
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('escritorio · compra → QR → escáner → entrega → utilizado → doble escaneo → reversa → QR expirado → entrega otra vez', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre en escritorio')
    test.setTimeout(360_000)
    await recorrido(browser, { conReversa: true, cliente: 'cliente', empleado: 'empleado' })
  })

  test('móvil · el QR del cliente y el escáner del empleado funcionan en un teléfono', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'movil', 'solo en el proyecto móvil')
    test.setTimeout(300_000)
    await recorrido(browser, { conReversa: false, cliente: 'cliente2', empleado: 'empleado2' })
  })
})
