import { test, expect } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { REGLAS } from '../../src/modules/conciliacion/domain'
import { empresaCatalogo, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * CONCILIACIÓN Y SEÑALES DE RIESGO · de punta a punta (F9).
 *
 *   el superadmin ve en «Conciliación» el pedido completado sin comisión (con su código y su empresa) y en
 *   «Señales de riesgo» la empresa que canceló la mitad de sus pedidos y el cliente que canceló cinco — y NO ve
 *   la empresa de práctica. Un administrador de empresa no entra a ninguna de las dos pantallas.
 *
 * Las anomalías se SIEMBRAN por Prisma (la base de E2E no lleva los disparadores ni los CHECK que las impedirían);
 * que cada regla vea exactamente lo que debe, y solo eso, lo prueban `tests/postgres/conciliacion.db.test.ts` y
 * `riesgo.db.test.ts`. Aquí se prueba la INTERFAZ.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)

let n = 0
async function pedido(e: EmpresaCatalogo, sucursalId: string, clienteId: string, status: 'COMPLETED' | 'CANCELLED', total = 250) {
  n += 1
  const ahora = new Date()
  return prismaDeArnes().membegoOrder.create({
    data: {
      companyId: e.id,
      code: `MBG-CR-${sufijo}-${n}`.toUpperCase(),
      locationId: sucursalId,
      customerId: clienteId,
      status,
      origin: 'MARKETPLACE',
      subtotal: total,
      commissionableBase: total,
      total,
      createdAt: ahora,
      ...(status === 'COMPLETED' ? { acceptedAt: ahora, readyAt: ahora, completedAt: ahora } : { cancelledAt: ahora, cancelReason: 'Prueba' }),
    },
    select: { id: true, code: true },
  })
}

test.describe('Conciliación y riesgo · recorrido', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let a: EmpresaCatalogo
  let demo: EmpresaCatalogo
  let sinComision = ''

  test('prepara: una empresa con un pedido completado sin comisión y 5 de 10 pedidos cancelados por la misma persona; una empresa de práctica con lo mismo', async () => {
    const db = prismaDeArnes()
    a = await empresaCatalogo(sufijo, 'conc', { capacidad: true, pedidos: true })
    demo = await empresaCatalogo(sufijo, 'concdemo', { capacidad: true, pedidos: true })
    await db.company.update({ where: { id: demo.id }, data: { esDemo: true } })
    await asegurarUsuario('conciliacionAdmin', a.id)
    await asegurarUsuario('facturacionSuperadmin')
    for (const e of [a, demo]) {
      const suc = (await sucursalSembrada(e.id, 'Principal')).id
      const cli = (await db.cliente.create({ data: { companyId: e.id, supabaseId: `e2e-conc-cli-${e.id}`, nombre: `Cancelador ${e === a ? 'Real' : 'Demo'} ${sufijo}`, email: `cancelador-${e === a ? 'a' : 'd'}-${sufijo}@prueba.test` }, select: { id: true } })).id
      const completado = await pedido(e, suc, cli, 'COMPLETED')
      if (e === a) sinComision = completado.code
      for (let i = 0; i < 5; i++) await pedido(e, suc, cli, 'CANCELLED')
      for (let i = 0; i < 4; i++) await pedido(e, suc, cli, 'COMPLETED')
    }
  })

  test('un administrador de empresa no entra a «Conciliación» ni a «Señales de riesgo»', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'conciliacionAdmin', BASE, a.id)
    for (const ruta of ['/superadmin/conciliacion', '/superadmin/riesgo']) {
      await p.goto(ruta)
      await expect(p.getByRole('heading', { name: /Conciliación del comercio|Señales de riesgo/ })).toHaveCount(0)
      expect(new URL(p.url()).pathname).not.toBe(ruta)
    }
    await ctx.close()
  })

  test('el superadmin ve el pedido sin comisión en la regla C01, con su empresa y su código, y no ve la empresa de práctica', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto('/superadmin/conciliacion')
    await expect(p.getByRole('heading', { name: 'Conciliación del comercio' })).toBeVisible()
    await expect(p.getByTestId('grupo-PEDIDOS_Y_COMISIONES')).toBeVisible()
    const c01 = p.getByTestId('regla-C01')
    await expect(c01).toContainText('Pedido del marketplace completado sin comisión')
    await expect(c01).toContainText(/\d+ casos?/)
    // La regla está abierta (severidad alta con casos) y trae, entre sus casos, el nuestro.
    await expect(c01.getByRole('row', { name: new RegExp(`${sinComision}(?!\\d)`) })).toBeVisible()
    await expect(c01.getByRole('row', { name: new RegExp(`${sinComision}(?!\\d)`) })).toContainText(`E2E Catálogo conc ${sufijo}`)
    // La empresa de práctica no aparece en ninguna regla.
    await expect(p.getByText(`E2E Catálogo concdemo ${sufijo}`)).toHaveCount(0)
    // Todas las reglas se enseñan, con su severidad.
    await expect(p.locator('[data-testid^="regla-"]')).toHaveCount(REGLAS.length)
    await expect(p.getByText('Solo lectura').or(p.getByText('no corrige nada')).first()).toBeVisible()
    await ctx.close()
  })

  test('el superadmin ve la empresa que cancela la mitad de sus pedidos y al cliente que cancela cinco, sin la empresa de práctica', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto('/superadmin/riesgo')
    await expect(p.getByRole('heading', { name: 'Señales de riesgo' })).toBeVisible()
    const empresas = p.getByTestId('riesgo-empresas')
    const fila = empresas.getByTestId('senal').filter({ hasText: `E2E Catálogo conc ${sufijo}` })
    await expect(fila).toHaveCount(1)
    await expect(fila).toContainText('Muchos pedidos cancelados')
    await expect(fila).toContainText('Alta')
    await expect(fila).toContainText('5 de 10 pedidos')
    const clientes = p.getByTestId('riesgo-clientes')
    // La misma persona, dos indicios: cinco cancelaciones y (por sembrarse los 10 pedidos de golpe) una ráfaga.
    const cliente = clientes.getByTestId('senal').filter({ hasText: `Cancelador Real ${sufijo}` })
    await expect(cliente).toHaveCount(2)
    await expect(cliente.filter({ hasText: 'Cancela muchos pedidos' })).toHaveCount(1)
    await expect(cliente.filter({ hasText: 'Ráfaga de pedidos' })).toHaveCount(1)
    await expect(cliente.first()).toContainText(`cancelador-a-${sufijo}@prueba.test`)
    // Una señal es un indicio: ninguna acción en la pantalla.
    await expect(p.getByRole('form')).toHaveCount(0)
    await expect(p.getByText(`concdemo ${sufijo}`)).toHaveCount(0)
    await expect(p.getByText(`Cancelador Demo ${sufijo}`)).toHaveCount(0)
    await ctx.close()
  })
})
