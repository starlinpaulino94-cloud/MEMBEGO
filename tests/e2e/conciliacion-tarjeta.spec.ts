import { test, expect } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * PAGO CON TARJETA → CONCILIACIÓN ACCIONABLE · de punta a punta (fase 4).
 *
 * `/admin/conciliacion` deja de ser una cifra con un «Revisar» que no lleva a ninguna parte: cada hallazgo trae su lista de
 * casos y cada caso su acción.
 *   · un cobro con tarjeta sin comprobante → «Generar comprobante» y se puede imprimir ahí mismo;
 *   · un cliente que pagó y no recibió → «Reintentar entrega» y recibe su producto;
 *   · un cobro entregado pero sin cerrar → «Marcar entregada», que exige una nota;
 *   · una caja abierta de ayer → «Abrir caja» lleva a ESA caja.
 * Los datos se siembran por Prisma; que cada acción haga lo correcto en la base lo prueba `pagos-conciliacion.db.test.ts`.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const DIA = 86_400_000

test.describe('Pago con tarjeta · conciliación accionable', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let e: EmpresaCatalogo
  let usuarioId = ''
  const ids = { sinComprobante: '', esperando: '', sinCerrar: '', membEsperando: '', caja: '' }

  async function cliente(n: string) {
    return prismaDeArnes().cliente.create({ data: { companyId: e.id, supabaseId: `e2e-cc-${n}-${sufijo}`, nombre: `Cliente ${n}`, email: `cc-${n}-${sufijo}@prueba.test` }, select: { id: true } })
  }

  test('prepara: cuatro situaciones que no cuadran', async () => {
    const prisma = prismaDeArnes()
    e = await empresaCatalogo(sufijo, 'concil', { capacidad: false })
    const u = await asegurarUsuario('tarjetaConciliador', e.id)
    usuarioId = u.id
    const sucursal = await sucursalSembrada(e.id, 'Principal')
    const plan = await prisma.plan.create({ data: { companyId: e.id, nombre: `Plan Conciliación ${sufijo}`, precio: 500, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
    const ayer = new Date(Date.now() - DIA)
    const viejo = new Date(Date.now() - 20 * DIA)

    // 1 · Cobro con tarjeta entregado, sin comprobante.
    const c1 = await cliente('sincomprobante')
    const m1 = await prisma.membership.create({ data: { companyId: e.id, clienteId: c1.id, planId: plan.id, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500, fechaPago: ayer, fechaInicio: ayer }, select: { id: true } })
    ids.sinComprobante = (await prisma.pagoIntento.create({ data: { companyId: e.id, clienteId: c1.id, proveedor: 'CARDNET', membershipId: m1.id, monto: 500, estado: 'APROBADO', activadoAt: ayer, autorizacion: 'AUTH-E2E-1', canal: 'APP', fulfillmentEstado: 'COMPLETADA', fulfillmentAt: ayer }, select: { id: true } })).id

    // 2 · El cliente pagó y su entrega falló: la membresía sigue sin activar (se puede reintentar).
    const c2 = await cliente('esperando')
    const m2 = await prisma.membership.create({ data: { companyId: e.id, clienteId: c2.id, planId: plan.id }, select: { id: true } })
    ids.membEsperando = m2.id
    ids.esperando = (await prisma.pagoIntento.create({ data: { companyId: e.id, clienteId: c2.id, proveedor: 'CARDNET', membershipId: m2.id, monto: 500, estado: 'APROBADO', activadoAt: ayer, autorizacion: 'AUTH-E2E-2', canal: 'WEB', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 }, select: { id: true } })).id

    // 3 · Cobro anterior a la columna de cumplimiento, con la membresía ya activa: solo falta cerrar el registro.
    const c3 = await cliente('sincerrar')
    const m3 = await prisma.membership.create({ data: { companyId: e.id, clienteId: c3.id, planId: plan.id, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500, fechaPago: viejo, fechaInicio: viejo }, select: { id: true } })
    ids.sinCerrar = (await prisma.pagoIntento.create({ data: { companyId: e.id, clienteId: c3.id, proveedor: 'CARDNET', membershipId: m3.id, monto: 500, estado: 'APROBADO', activadoAt: viejo, autorizacion: 'AUTH-E2E-3', createdAt: viejo, updatedAt: viejo }, select: { id: true } })).id

    // 4 · Una caja que nadie cerró desde anteayer.
    ids.caja = (await prisma.cajaSesion.create({ data: { companyId: e.id, sucursalId: sucursal.id, abiertaPorId: u.id, estado: 'ABIERTA', balanceInicial: 100, abiertaAt: new Date(Date.now() - 2 * DIA) }, select: { id: true } })).id
  })

  test('la pantalla enseña cada hallazgo con su lista de casos y sus acciones (nada de «Revisar» que no lleva a ninguna parte)', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaConciliador', BASE, e.id)
    await p.goto('/admin/conciliacion')

    const sin = p.getByTestId('hallazgo-cobro-sin-transaccion')
    await expect(sin).toContainText('Cobros sin transacción registrada')
    await expect(sin).toContainText('Cliente sincomprobante')
    await expect(sin).toContainText('Tarjeta · en la app · Aut. AUTH-E2E-1')
    await expect(sin.getByRole('button', { name: 'Generar comprobante' })).toBeVisible()

    const espera = p.getByTestId('hallazgo-cobrado-sin-entregar')
    await expect(espera).toContainText('Cliente esperando')
    await expect(espera).toContainText('Entrega fallida: La activación falló.')
    await expect(espera.getByRole('button', { name: 'Reintentar entrega' })).toBeVisible()

    const cerrar = p.getByTestId('hallazgo-entrega-sin-registrar')
    await expect(cerrar).toContainText('Cliente sincerrar')
    await expect(cerrar.getByRole('button', { name: 'Marcar entregada' })).toBeVisible()

    const caja = p.getByTestId('hallazgo-caja-abierta')
    await expect(caja).toContainText('Principal')
    await expect(caja.getByRole('link', { name: 'Abrir caja' })).toHaveAttribute('href', `/empleado/caja?caja=${ids.caja}`)

    // Ningún enlace «Revisar» genérico: cada hallazgo con casos se resuelve en su lugar.
    await expect(p.getByRole('link', { name: /Revisar/ })).toHaveCount(0)
    await ctx.close()
  })

  test('«Generar comprobante» escribe la venta y se imprime ahí mismo', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaConciliador', BASE, e.id)
    await p.goto('/admin/conciliacion')
    const sin = p.getByTestId('hallazgo-cobro-sin-transaccion')
    await expect(async () => {
      await sin.getByRole('button', { name: 'Generar comprobante' }).click()
      await expect(sin.getByTestId('comprobante-generado')).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 30_000 })
    await expect(sin.getByTestId('comprobante-generado')).toContainText(/TCK-\d+/)

    const venta = await prismaDeArnes().transaction.findUniqueOrThrow({ where: { pagoIntentoId: ids.sinComprobante } })
    expect([venta.tipo, venta.metodoCobro, Number(venta.monto)]).toEqual(['SALE', 'TARJETA', 500])
    const bitacora = await prismaDeArnes().auditLog.findMany({ where: { companyId: e.id, accion: 'CONCILIACION_COMPROBANTE_GENERADO' } })
    expect(bitacora).toHaveLength(1)
    expect(bitacora[0]!.userId).toBe(usuarioId)

    // Se imprime sin salir de la pantalla y dice que se pagó con tarjeta en la app.
    await sin.getByRole('button', { name: 'Imprimir' }).click()
    const dialogo = p.getByRole('dialog')
    await expect(dialogo).toContainText('Tarjeta (en la app)', { timeout: 20_000 })
    await expect(dialogo).toContainText(venta.ticketNumero)
    await p.keyboard.press('Escape')

    // Al actualizar, el caso ya no está.
    await sin.getByRole('button', { name: 'Actualizar lista' }).click()
    await expect(p.getByTestId('hallazgo-cobro-sin-transaccion')).toHaveCount(0, { timeout: 20_000 })
    await ctx.close()
  })

  test('«Reintentar entrega» le da su producto al cliente que esperaba', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaConciliador', BASE, e.id)
    await p.goto('/admin/conciliacion')
    const espera = p.getByTestId('hallazgo-cobrado-sin-entregar')
    await expect(async () => {
      await espera.getByRole('button', { name: 'Reintentar entrega' }).click()
      await expect(p.getByTestId('hallazgo-cobrado-sin-entregar')).toHaveCount(0, { timeout: 5_000 })
    }).toPass({ timeout: 60_000 })

    const i = await prismaDeArnes().pagoIntento.findUniqueOrThrow({ where: { id: ids.esperando } })
    expect(i.fulfillmentEstado).toBe('COMPLETADA')
    expect((await prismaDeArnes().membership.findUniqueOrThrow({ where: { id: ids.membEsperando } })).estado).toBe('ACTIVA')
    expect(await prismaDeArnes().transaction.count({ where: { pagoIntentoId: ids.esperando } })).toBe(1)
    await ctx.close()
  })

  test('«Marcar entregada» exige una nota y deja el registro cerrado', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaConciliador', BASE, e.id)
    await p.goto('/admin/conciliacion')
    const cerrar = p.getByTestId('hallazgo-entrega-sin-registrar')
    let dialogo = p.getByRole('dialog')
    await expect(async () => {
      await cerrar.getByRole('button', { name: 'Marcar entregada' }).click()
      await expect(dialogo).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 30_000 })

    const confirmar = dialogo.getByRole('button', { name: 'Marcar entregada' })
    await expect(confirmar).toBeDisabled() // sin nota no se puede
    await dialogo.getByLabel('Nota (obligatoria)').fill('ok')
    await expect(confirmar).toBeDisabled() // una nota de dos letras tampoco
    await dialogo.getByLabel('Nota (obligatoria)').fill('Se activó a mano el mismo día; lo confirmé con el cliente.')
    await expect(confirmar).toBeEnabled()
    await confirmar.click()
    await expect(p.getByTestId('hallazgo-entrega-sin-registrar')).toHaveCount(0, { timeout: 30_000 })

    const i = await prismaDeArnes().pagoIntento.findUniqueOrThrow({ where: { id: ids.sinCerrar } })
    expect(i.fulfillmentEstado).toBe('COMPLETADA')
    const log = await prismaDeArnes().auditLog.findMany({ where: { companyId: e.id, accion: 'CONCILIACION_ENTREGA_MARCADA' } })
    expect(log).toHaveLength(1)
    expect((log[0]!.payload as Record<string, unknown>).nota).toBe('Se activó a mano el mismo día; lo confirmé con el cliente.')
    dialogo = p.getByRole('dialog')
    await ctx.close()
  })

  test('«Abrir caja» lleva a la caja abierta de ayer, y solo queda ese hallazgo', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaConciliador', BASE, e.id)
    await p.goto('/admin/conciliacion')
    // Resueltos los tres cobros, solo queda la caja (que se cierra contando efectivo, no desde aquí).
    await expect(p.getByTestId('hallazgo-cobro-sin-transaccion')).toHaveCount(0)
    await expect(p.getByTestId('hallazgo-cobrado-sin-entregar')).toHaveCount(0)
    await expect(p.getByTestId('hallazgo-entrega-sin-registrar')).toHaveCount(0)
    const caja = p.getByTestId('hallazgo-caja-abierta')
    await caja.getByRole('link', { name: 'Abrir caja' }).click()
    await expect(p).toHaveURL(new RegExp(`/empleado/caja\\?caja=${ids.caja}`))
    await expect(p.getByText('Caja abierta')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('Principal').first()).toBeVisible()
    await ctx.close()
  })
})
