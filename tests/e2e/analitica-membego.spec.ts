import { test, expect } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, sucursalSembrada, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * ANALÍTICA DE MEMBEGO · de punta a punta (F6).
 *
 *   la empresa ve «Membego te produjo 2 clientes nuevos, 3 pedidos y RD$ 1,120 en ventas», lo que le
 *   costó (RD$ 300 de comisión), cómo llegaron (canal) y cómo rinde su oferta — y el superadmin ve el
 *   GMV de la plataforma con la empresa en el ranking, SIN la empresa de práctica, y con Supply
 *   Economics en un bloque aparte.
 *
 * Y lo que NO debe pasar: que una empresa sin los pedidos vea el panel, que vea los números de otra
 * empresa, o que un administrador entre a la analítica de la plataforma.
 *
 * Los pedidos y sus comisiones se SIEMBRAN por Prisma (el recorrido pedir → canjear → comisión ya lo
 * prueban `pedidos-membego` y `deals-membego`); las cuentas exactas contra PostgreSQL, con los bordes de
 * hora local, las prueba `tests/postgres/analytics.db.test.ts`. Aquí se prueba la INTERFAZ.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const DIA = 86_400_000

type Canal = 'MARKETPLACE_BROWSE' | 'MARKETPLACE_SEARCH' | 'PROMOTION_CLAIM'

let contador = 0

/** Un pedido de marketplace ya completado, con su atribución, su asiento y su comisión CPA de RD$ 100. */
async function pedidoCompletado(e: EmpresaCatalogo, sucursalId: string, clienteId: string, o: { total: number; canal: Canal; hace: number; seq: number; dealId?: string }) {
  const prisma = prismaDeArnes()
  contador += 1
  const completado = new Date(Date.now() - o.hace * DIA)
  const orden = await prisma.membegoOrder.create({
    data: {
      companyId: e.id,
      code: `MBG-AN-${sufijo}-${contador}`.toUpperCase(),
      locationId: sucursalId,
      customerId: clienteId,
      status: 'COMPLETED',
      origin: 'MARKETPLACE',
      subtotal: o.total,
      commissionableBase: o.total,
      total: o.total,
      createdAt: completado,
      acceptedAt: completado,
      readyAt: completado,
      completedAt: completado,
      customerConfirmedAt: completado,
    },
  })
  await prisma.orderAttribution.create({ data: { companyId: e.id, orderId: orden.id, channel: o.canal, promotionId: o.dealId ?? null } })
  const saldo = o.seq * 100
  const asiento = await prisma.merchantLedgerEntry.create({
    data: { companyId: e.id, seq: o.seq, type: 'ORDER_FEE', amount: 100, balance: saldo, referenceType: 'COMMISSION', referenceId: orden.id, idempotencyKey: `commission:${orden.id}`, createdAt: completado },
  })
  await prisma.commission.create({
    data: { companyId: e.id, orderId: orden.id, type: 'CPA_FIXED', feeModel: 'HYBRID', verificationLevel: 'ATTRIBUTED', baseAmount: o.total, amount: 100, ledgerEntryId: asiento.id, dealId: o.dealId ?? null, createdAt: completado },
  })
  return orden.id
}

async function cliente(e: EmpresaCatalogo, n: number) {
  const c = await prismaDeArnes().cliente.create({
    data: { companyId: e.id, supabaseId: `e2e-an-${e.slug}-${n}`, nombre: `Cliente Analítica ${n}`, email: `an-${e.slug}-${n}@prueba.test` },
    select: { id: true },
  })
  return c.id
}

test.describe('Analítica de Membego · recorrido', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let otra: EmpresaCatalogo
  let sin: EmpresaCatalogo
  let practica: EmpresaCatalogo

  test('prepara: una empresa con 3 pedidos completados (uno ya era cliente), otra con uno de RD$ 999, una sin pedidos Membego y una de práctica', async () => {
    con = await empresaCatalogo(sufijo, 'an', { capacidad: true, pedidos: true })
    otra = await empresaCatalogo(sufijo, 'anotra', { capacidad: true, pedidos: true })
    sin = await empresaCatalogo(sufijo, 'ansin', { capacidad: true })
    practica = await empresaCatalogo(sufijo, 'anpractica', { capacidad: true, pedidos: true })
    await prismaDeArnes().company.update({ where: { id: practica.id }, data: { esDemo: true } })
    await asegurarUsuario('analiticaAdmin', con.id)
    await asegurarUsuario('analiticaOtra', otra.id)
    await asegurarUsuario('analiticaSin', sin.id)
    await asegurarUsuario('facturacionSuperadmin')

    const sucursal = (await sucursalSembrada(con.id, 'Principal')).id
    const [c0, c1, c2] = [await cliente(con, 0), await cliente(con, 1), await cliente(con, 2)]
    // c0 ya había comprado hace 60 días (recurrente); c1 y c2 son nuevos.
    await pedidoCompletado(con, sucursal, c0, { total: 400, canal: 'MARKETPLACE_BROWSE', hace: 60, seq: 1 })
    await pedidoCompletado(con, sucursal, c0, { total: 400, canal: 'MARKETPLACE_BROWSE', hace: 2, seq: 2 })
    await pedidoCompletado(con, sucursal, c1, { total: 400, canal: 'MARKETPLACE_SEARCH', hace: 3, seq: 3 })
    await pedidoCompletado(con, sucursal, c2, { total: 320, canal: 'PROMOTION_CLAIM', hace: 1, seq: 4 })

    const sucursalOtra = (await sucursalSembrada(otra.id, 'Principal')).id
    await pedidoCompletado(otra, sucursalOtra, await cliente(otra, 0), { total: 999, canal: 'MARKETPLACE_BROWSE', hace: 1, seq: 1 })
    const sucursalPractica = (await sucursalSembrada(practica.id, 'Principal')).id
    await pedidoCompletado(practica, sucursalPractica, await cliente(practica, 0), { total: 777, canal: 'MARKETPLACE_BROWSE', hace: 1, seq: 1 })
  })

  test('la empresa lee lo que Membego le produjo y lo que le costó', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'analiticaAdmin', BASE, con.id)
    await p.goto('/admin/resultados-membego')
    await expect(p.getByRole('heading', { name: /Resultados Membego/ })).toBeVisible()

    const resumen = p.getByRole('region', { name: 'Resumen' })
    await expect(resumen).toContainText('2 clientes nuevos')
    await expect(resumen).toContainText('3 pedidos')
    await expect(resumen).toContainText('RD$1,120.00')
    await expect(resumen).toContainText('Te costó RD$300.00')
    await expect(resumen).toContainText('26.8 % de lo vendido')
    // 1 120 vendidos por 300 pagados: RD$ 3.70 de ventas por cada peso.
    await expect(p.getByText('RD$3.70').first()).toBeVisible()
    // Costo por cliente nuevo: 300 ÷ 2.
    await expect(p.getByText('RD$150.00').first()).toBeVisible()

    // Cómo llegaron: la tabla está en el panel plegable «Ver los datos de este gráfico».
    await p.getByRole('region', { name: 'Cómo llegaron' }).getByText('Ver los datos de este gráfico').click()
    const canales = p.getByRole('table', { name: 'Ventas por canal' })
    await expect(canales.getByRole('row', { name: /Navegando el marketplace.*1.*RD\$400\.00/ })).toBeVisible()
    await expect(canales.getByRole('row', { name: /Buscando en el marketplace/ })).toBeVisible()
    await expect(canales.getByRole('row', { name: /Ofertas con presupuesto.*RD\$320\.00/ })).toBeVisible()

    // Lo de la otra empresa y lo de la empresa de práctica no aparece ni por casualidad.
    const cuerpo = await p.locator('body').innerText()
    expect(cuerpo).not.toContain('999')
    expect(cuerpo).not.toContain('777')
    await ctx.close()
  })

  test('el periodo se puede cambiar: sin pedidos en ese tramo, la página lo dice en vez de mostrar ceros mudos', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'analiticaAdmin', BASE, con.id)
    await p.goto('/admin/resultados-membego?desde=2020-01-01&hasta=2020-01-31')
    await expect(p.getByText('En este periodo no llegó ningún pedido por Membego')).toBeVisible()
    await ctx.close()
  })

  test('otra empresa solo ve lo suyo', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'analiticaOtra', BASE, otra.id)
    await p.goto('/admin/resultados-membego')
    await expect(p.getByRole('region', { name: 'Resumen' })).toContainText('RD$999.00')
    const cuerpo = await p.locator('body').innerText()
    expect(cuerpo).not.toContain('1,120')
    await ctx.close()
  })

  test('una empresa con catálogo pero SIN pedidos Membego no tiene el panel', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'analiticaSin', BASE, sin.id)
    await p.goto('/admin/resultados-membego')
    await expect(p.getByRole('heading', { name: /Resultados Membego/ })).toHaveCount(0)
    await expect(p.getByRole('region', { name: 'Resumen' })).toHaveCount(0)
    await ctx.close()
  })

  test('el superadmin ve el GMV con la empresa en el ranking, sin la de práctica, y Supply Economics aparte', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto('/superadmin/analitica')
    await expect(p.getByRole('heading', { name: /Analítica de Membego/ })).toBeVisible()

    const ranking = p.getByRole('table', { name: 'Ventas por empresa' })
    const fila = ranking.getByRole('row', { name: new RegExp(`${con.name}.*RD\\$1,120\\.00.*RD\\$300\\.00`) })
    await expect(fila).toBeVisible()
    await expect(ranking.getByRole('row', { name: new RegExp(otra.name) })).toBeVisible()
    await expect(ranking.getByRole('row', { name: new RegExp(practica.name) })).toHaveCount(0)

    // Supply Economics va en su bloque, rotulado y aparte.
    const supply = p.getByText('Supply Economics (Membego → proveedores)')
    await expect(supply).toBeVisible()
    await expect(p.getByText(/no se suman a éstas/)).toBeVisible()
    await ctx.close()
  })

  test('un administrador de empresa no entra a la analítica de la plataforma', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'analiticaAdmin', BASE, con.id)
    await p.goto('/superadmin/analitica')
    await expect(p.getByRole('heading', { name: /Analítica de Membego/ })).toHaveCount(0)
    expect(await p.locator('body').innerText()).not.toContain('Supply Economics')
    await ctx.close()
  })
})
