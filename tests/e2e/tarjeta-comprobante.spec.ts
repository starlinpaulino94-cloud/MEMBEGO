import { test, expect } from '@playwright/test'
import { Prisma } from '@prisma/client'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * PAGO CON TARJETA → COMPROBANTE · de punta a punta (fase 3).
 *
 * Una persona pagó RD$500 con su tarjeta DENTRO DE LA APP. Lo que tiene que pasar, viéndolo en pantalla:
 *   · el personal ve el cobro en la caja, aparte de la gaveta (el efectivo esperado NO cambia), y lo imprime;
 *   · el administrador lo encuentra en Comprobantes («Pagos con tarjeta») y en Registros (subtotal «Tarjeta»);
 *   · la persona ve su recibo en «Mis pagos», con el mismo número de ticket y la opción de imprimirlo.
 *
 * La venta se SIEMBRA por Prisma con la misma forma que la deja el servidor (la regla de que la deja una sola vez, con
 * los servicios reales, la prueba `tests/postgres/pagos-venta-tarjeta.db.test.ts`). Aquí se prueba la INTERFAZ.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const TICKET = `TCK-E2E-${sufijo.toUpperCase()}`
const AUTORIZACION = `AUTHE2E${sufijo.toUpperCase()}`.slice(0, 20)

test.describe('Pago con tarjeta · comprobante visible e imprimible', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let e: EmpresaCatalogo

  test('prepara: una empresa con su cajera, una persona que pagó RD$500 con tarjeta en la app y su venta con ticket', async () => {
    const prisma = prismaDeArnes()
    e = await empresaCatalogo(sufijo, 'tarjeta', { capacidad: false })
    await asegurarUsuario('tarjetaAdmin', e.id)
    const persona = await asegurarUsuario('tarjetaCliente')
    await sucursalSembrada(e.id, 'Principal')

    const plan = await prisma.plan.create({ data: { companyId: e.id, nombre: `Plan Tarjeta ${sufijo}`, precio: 500, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
    const cliente = await prisma.cliente.create({ data: { companyId: e.id, supabaseId: persona.supabaseId, nombre: 'Ana Tarjeta', email: persona.email }, select: { id: true } })
    const ahora = new Date()
    const membresia = await prisma.membership.create({
      data: { companyId: e.id, clienteId: cliente.id, planId: plan.id, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500, fechaPago: ahora, fechaInicio: ahora, fechaVencimiento: new Date(ahora.getTime() + 30 * 86_400_000) },
      select: { id: true },
    })
    const intento = await prisma.pagoIntento.create({
      data: { companyId: e.id, clienteId: cliente.id, proveedor: 'CARDNET', monto: 500, estado: 'APROBADO', activadoAt: ahora, autorizacion: AUTORIZACION, canal: 'APP', fulfillmentEstado: 'COMPLETADA', fulfillmentAt: ahora, membershipId: membresia.id },
      select: { id: true },
    })
    await prisma.transaction.create({
      data: {
        codigo: `TX-E2E-${sufijo.toUpperCase()}`,
        ticketNumero: TICKET,
        tipo: 'SALE',
        estado: 'APPLIED',
        companyId: e.id,
        clienteId: cliente.id,
        membershipId: membresia.id,
        monto: 500,
        metodoCobro: 'TARJETA',
        pagoIntentoId: intento.id,
        appliedAt: ahora,
        snapshot: {
          detalle: `Membresía Plan Tarjeta ${sufijo}`,
          cliente: 'Ana Tarjeta',
          servicio: `Membresía Plan Tarjeta ${sufijo}`,
          lineas: [{ descripcion: `Membresía Plan Tarjeta ${sufijo}`, cantidad: 1, precioUnitario: 500, descuento: 0, total: 500 }],
          subtotal: '500.00',
          total: '500.00',
          metodoCobroLabel: 'Tarjeta VISA ••••4242 (en la app)',
          referenciaPago: `Aut. ${AUTORIZACION}`,
          canalDeCobro: 'APP',
          autorizacion: AUTORIZACION,
          tarjeta: { marca: 'VISA', ultimos4: '4242' },
          pagoIntentoId: intento.id,
        },
      },
    })
    await prisma.auditLog.create({
      data: {
        companyId: e.id,
        accion: 'PAGO_APROBADO',
        entidadTipo: 'Membership',
        entidadId: membresia.id,
        payload: { planId: plan.id, clienteId: cliente.id, monto: 500, metodo: 'TARJETA', canal: 'APP', intentoId: intento.id },
      },
    })
  })

  test('la cajera ve el cobro en línea en su caja, aparte de la gaveta, y abre su comprobante para imprimir', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaAdmin', BASE, e.id)
    await p.goto('/empleado/caja')
    await p.getByRole('button', { name: 'Abrir caja' }).click()
    await expect(p.getByText('Caja abierta')).toBeVisible({ timeout: 20_000 })

    const seccion = p.getByTestId('cobros-en-linea')
    await expect(seccion).toBeVisible()
    await expect(seccion).toContainText('Cobros con tarjeta en línea de hoy')
    await expect(seccion).toContainText('No pasan por la gaveta')
    await expect(seccion).toContainText('Ana Tarjeta')
    await expect(seccion).toContainText(TICKET)
    await expect(seccion).toContainText('Tarjeta VISA ••••4242 (en la app)')
    await expect(p.getByTestId('cobros-en-linea-total')).toContainText('RD$500.00')

    // La gaveta no cambia: el efectivo esperado sigue siendo el fondo con el que se abrió.
    await expect(p.getByText('Efectivo en caja (esperado)').locator('..')).toContainText('RD$0.00')

    // El comprobante se abre para imprimir y dice que se pagó con tarjeta dentro de la app.
    await seccion.getByRole('button', { name: /Imprimir/ }).click()
    const dialogo = p.getByRole('dialog')
    await expect(dialogo).toBeVisible({ timeout: 20_000 })
    await expect(dialogo).toContainText('Tarjeta VISA ••••4242 (en la app)', { timeout: 20_000 })
    await expect(dialogo).toContainText(TICKET)
    await expect(dialogo).not.toContainText(/\d{13,}/)
    await ctx.close()
  })

  test('personal de mostrador sin acceso a Comprobantes ve cuánto entró, no quién pagó; con el permiso, ve el detalle', async ({ browser }) => {
    test.setTimeout(180_000)
    const prisma = prismaDeArnes()
    const empleado = await asegurarUsuario('tarjetaEmpleado', e.id)
    await prisma.user.update({ where: { id: empleado.id }, data: { permisos: Prisma.DbNull } })

    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaEmpleado', BASE, e.id)
    await p.goto('/empleado/caja')
    const seccion = p.getByTestId('cobros-en-linea')
    await expect(seccion).toBeVisible({ timeout: 30_000 })
    // El resumen, para el cuadre: cuánto entró y por qué canal.
    await expect(p.getByTestId('cobros-en-linea-total')).toContainText('RD$500.00')
    await expect(p.getByTestId('cobros-en-linea-oculto')).toContainText('lo ve quien tiene acceso a Comprobantes')
    // Pero no el detalle: ni quién, ni qué plan, ni el ticket, ni la autorización, ni el botón de imprimir.
    await expect(seccion).not.toContainText('Ana Tarjeta')
    await expect(seccion).not.toContainText(TICKET)
    await expect(seccion).not.toContainText('VISA')
    await expect(seccion).not.toContainText(AUTORIZACION)
    await expect(seccion.getByRole('button', { name: /Imprimir/ })).toHaveCount(0)

    // El cuadre impreso del día trae el mismo resumen y tampoco el detalle.
    await p.getByRole('button', { name: 'Mi cuadre del día' }).first().click()
    const cuadre = p.getByRole('dialog')
    await expect(cuadre).toContainText('TOTAL EN LÍNEA (1)', { timeout: 30_000 })
    await expect(cuadre).toContainText('RD$500.00')
    await expect(cuadre).not.toContainText('Ana Tarjeta')
    await expect(cuadre).not.toContainText(TICKET)
    await p.keyboard.press('Escape')

    // Se le concede Comprobantes desde Permisos: en su siguiente clic ya ve el detalle (permisos vivos).
    await prisma.user.update({ where: { id: empleado.id }, data: { permisos: { v: 1, secciones: { facturas: true } } } })
    await p.goto('/empleado/caja')
    await expect(p.getByTestId('cobros-en-linea')).toContainText('Ana Tarjeta', { timeout: 30_000 })
    await expect(p.getByTestId('cobros-en-linea')).toContainText(TICKET)
    await expect(p.getByTestId('cobros-en-linea-oculto')).toHaveCount(0)
    await prisma.user.update({ where: { id: empleado.id }, data: { permisos: Prisma.DbNull } })
    await ctx.close()
  })

  test('el administrador lo encuentra en Comprobantes («Pagos con tarjeta») y en Registros (subtotal «Tarjeta»)', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaAdmin', BASE, e.id)

    await p.goto('/admin/facturas?ver=tarjeta')
    await expect(p.getByRole('link', { name: 'Pagos con tarjeta' })).toBeVisible()
    const fila = p.getByRole('row').filter({ hasText: TICKET })
    await expect(fila).toBeVisible()
    await expect(fila).toContainText('Tarjeta VISA ••••4242 (en la app)')
    await expect(fila).toContainText('RD$500.00')

    // El filtro de entregas sin cobro NO lo trae.
    await p.goto('/admin/facturas?ver=entregas')
    await expect(p.getByRole('row').filter({ hasText: TICKET })).toHaveCount(0)

    await p.goto('/admin/registros?metodo=TARJETA')
    await expect(p.getByRole('row').filter({ hasText: TICKET })).toBeVisible()
    // El subtotal «Tarjeta» del resumen (no la opción del filtro, que está oculta).
    const kpiTarjeta = p.locator('dl > div').filter({ has: p.locator('dt', { hasText: /^Tarjeta$/ }) })
    await expect(kpiTarjeta).toContainText('RD$500.00')
    await ctx.close()
  })

  test('la ficha del cliente lista sus pagos con tarjeta para reimprimir', async ({ browser }) => {
    test.setTimeout(120_000)
    const cliente = await prismaDeArnes().cliente.findFirstOrThrow({ where: { companyId: e.id }, select: { id: true } })
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaAdmin', BASE, e.id)
    await p.goto(`/admin/clientes/${cliente.id}?vista=historial`)
    const bloque = p.getByTestId('recibos-tarjeta')
    await expect(bloque).toBeVisible()
    await expect(bloque).toContainText(TICKET)
    await expect(bloque).toContainText('Tarjeta VISA ••••4242 (en la app)')
    await expect(bloque.getByRole('button', { name: /Imprimir/ })).toBeVisible()
    await ctx.close()
  })

  test('la persona que pagó ve su recibo en «Mis pagos», con el mismo ticket, y puede imprimirlo', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaCliente', BASE)
    await p.goto('/cliente/pagos')
    await expect(p.getByText('Pago aprobado').first()).toBeVisible({ timeout: 30_000 })
    await expect(p.getByText('Tarjeta VISA ••••4242 (en la app)').first()).toBeVisible()

    // La fila de ESTE pago (la base de la corrida puede traer pagos de corridas anteriores de la misma persona). El
    // clic se reintenta hasta que la hoja abre: si cae antes de que la página termine de hidratarse, no hace nada.
    const fila = p.getByRole('listitem').filter({ hasText: `Plan Tarjeta ${sufijo}` })
    const hoja = p.getByRole('dialog')
    await expect(async () => {
      await fila.getByRole('button', { name: 'Ver' }).click()
      await expect(hoja).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await expect(hoja).toContainText(`Recibo Nº`)
    await expect(hoja).toContainText(TICKET)
    await expect(hoja).toContainText(AUTORIZACION)
    await expect(hoja.getByRole('button', { name: 'Imprimir recibo' })).toBeVisible()
    await ctx.close()
  })
})
