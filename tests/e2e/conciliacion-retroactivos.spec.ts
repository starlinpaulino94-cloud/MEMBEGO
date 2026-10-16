import { test, expect } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * PAGO CON TARJETA → COMPROBANTES RETROACTIVOS · de punta a punta (fase 6).
 *
 * Ponerse al día con los pagos con tarjeta anteriores al comprobante es una acción EXPLÍCITA, y se ve lo que va a pasar antes de
 * pulsar: cuántos son, cuánto suman y que no se cobra nada. Nada corre solo.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const DIA = 86_400_000

test.describe('Pago con tarjeta · comprobantes retroactivos', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let e: EmpresaCatalogo
  const intentos: string[] = []

  test('prepara: tres pagos con tarjeta de hace semanas, entregados y sin comprobante', async () => {
    const prisma = prismaDeArnes()
    e = await empresaCatalogo(sufijo, 'retro', { capacidad: false })
    await asegurarUsuario('tarjetaRetroactivos', e.id)
    const plan = await prisma.plan.create({ data: { companyId: e.id, nombre: `Plan Retro ${sufijo}`, precio: 500, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
    for (const dias of [20, 40, 100]) {
      const cuando = new Date(Date.now() - dias * DIA)
      const c = await prisma.cliente.create({ data: { companyId: e.id, supabaseId: `e2e-rv-${dias}-${sufijo}`, nombre: `Cliente hace ${dias}`, email: `rv-${dias}-${sufijo}@prueba.test` }, select: { id: true } })
      const m = await prisma.membership.create({ data: { companyId: e.id, clienteId: c.id, planId: plan.id, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500, fechaPago: cuando, fechaInicio: cuando }, select: { id: true } })
      const i = await prisma.pagoIntento.create({
        data: { companyId: e.id, clienteId: c.id, proveedor: 'CARDNET', membershipId: m.id, monto: 500, estado: 'APROBADO', activadoAt: cuando, createdAt: cuando, updatedAt: cuando, autorizacion: `AUTH-RV-${dias}`, fulfillmentEstado: 'COMPLETADA', fulfillmentAt: cuando },
        select: { id: true },
      })
      intentos.push(i.id)
    }
  })

  test('con 7 días no hay lote; con «1 año» se ve cuántos son y cuánto suman, y la confirmación dice que no se cobra nada', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaRetroactivos', BASE, e.id)

    await p.goto('/admin/conciliacion')
    await expect(p.getByTestId('lote-comprobantes')).toHaveCount(0)

    await p.goto('/admin/conciliacion?dias=365')
    const hallazgo = p.getByTestId('hallazgo-cobro-sin-transaccion')
    await expect(hallazgo).toContainText('3 pagos con tarjeta ya entregados no tienen comprobante')
    await expect(hallazgo).toContainText('RD$1,500.00')
    const boton = p.getByTestId('lote-comprobantes')
    await expect(boton).toContainText('Generar los 3 comprobantes')

    // Se abre la confirmación y NO se ha escrito nada todavía.
    const dialogo = p.getByRole('dialog')
    await expect(async () => {
      await boton.click()
      await expect(dialogo).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 30_000 })
    await expect(dialogo).toContainText('No se cobra nada')
    await expect(dialogo).toContainText('fecha en que el cliente pagó')
    expect(await prismaDeArnes().transaction.count({ where: { companyId: e.id } })).toBe(0)
    await p.keyboard.press('Escape')
    await ctx.close()
  })

  test('al confirmar se generan los tres, cada uno con la fecha de su cobro, y el hallazgo desaparece', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'tarjetaRetroactivos', BASE, e.id)
    await p.goto('/admin/conciliacion?dias=365')
    const dialogo = p.getByRole('dialog')
    await expect(async () => {
      await p.getByTestId('lote-comprobantes').click()
      await expect(dialogo).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 30_000 })
    await dialogo.getByTestId('lote-confirmar').click()
    await expect(p.getByTestId('hallazgo-cobro-sin-transaccion')).toHaveCount(0, { timeout: 30_000 })

    const prisma = prismaDeArnes()
    expect(await prisma.transaction.count({ where: { companyId: e.id } })).toBe(3)
    for (const id of intentos) {
      const v = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: id } })
      const i = await prisma.pagoIntento.findUniqueOrThrow({ where: { id } })
      expect(v.createdAt.getTime()).toBe(i.activadoAt!.getTime())
      expect([v.tipo, v.metodoCobro, (v.snapshot as Record<string, unknown>).metodoCobroLabel]).toEqual(['SALE', 'TARJETA', 'Tarjeta'])
    }
    const log = await prisma.auditLog.findMany({ where: { companyId: e.id, accion: 'CONCILIACION_COMPROBANTE_GENERADO' } })
    expect(log).toHaveLength(3)
    expect(log.every((l) => (l.payload as Record<string, unknown>).origen === 'LOTE')).toBe(true)
    await ctx.close()
  })
})
