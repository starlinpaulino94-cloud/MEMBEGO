import { test, expect } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * MERCHANT BILLING · el panel del superadmin (F4.2).
 *
 *   el superadmin ve la cuenta de una empresa, asienta un pago con su referencia,
 *   baja el límite de crédito (la cuenta entra en gracia), la suspende a mano y la
 *   libera — y la empresa ve cada cambio en «Mi cuenta Membego», de solo lectura
 *
 * Y lo que NO debe pasar: que una empresa o un empleado entren al panel del
 * superadmin, o que la empresa pueda mover su propia cuenta.
 *
 * El recorrido orden → comisión → libro → corte (con el QR) está en
 * `pedidos-membego.spec.ts`; las reglas del libro y de los cortes, contra
 * PostgreSQL, en `tests/postgres/billing.db.test.ts`. La base de E2E se crea con
 * `db push` (sin disparadores): aquí se prueba la INTERFAZ.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)

test.describe('Merchant Billing · panel del superadmin', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo
  let url = ''

  test('prepara: una empresa con la cuenta abierta, un límite de 1,000 y 350 por pagar', async () => {
    empresa = await empresaCatalogo(sufijo, 'fac', { capacidad: true, pedidos: true })
    await asegurarUsuario('pedidosAdmin', empresa.id)
    await asegurarUsuario('facturacionSuperadmin')
    const prisma = prismaDeArnes()
    await prisma.merchantBillingConfig.create({ data: { companyId: empresa.id, creditLimit: 1000 } })
    await prisma.merchantLedgerEntry.create({
      data: { companyId: empresa.id, seq: 1, type: 'ADJUSTMENT', amount: 350, balance: 350, referenceType: 'MANUAL', referenceId: `seed-${sufijo}`, reason: 'Saldo inicial de la prueba', idempotencyKey: `seed-${sufijo}` },
    })
    url = `/superadmin/facturacion/${empresa.id}`
  })

  test('la lista de cobros muestra la empresa con su saldo, y «Solo con deuda» la encuentra', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto(`/superadmin/facturacion?q=${encodeURIComponent(empresa.slug)}&deuda=1`)
    await expect(p.getByRole('heading', { name: 'Cobros a empresas' })).toBeVisible()
    const fila = p.getByRole('link', { name: new RegExp(`${empresa.name}.*RD\\$ 350\\.00`) })
    await expect(fila).toBeVisible()
    await expect(fila.getByText('Al día')).toBeVisible()
    await fila.click()
    await expect(p).toHaveURL(new RegExp(`${url}$`))
    await expect(p.getByRole('heading', { name: empresa.name })).toBeVisible()
    await ctx.close()
  })

  test('asentar un pago exige referencia, baja el saldo y queda en el libro; reenviarlo no lo duplica', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto(url)
    const form = p.getByRole('form', { name: 'Asentar un movimiento en la cuenta' })
    await form.getByLabel('Tipo').selectOption({ label: 'Pago recibido de la empresa' })
    await form.getByLabel(/^Monto/).fill('100')
    // La referencia es obligatoria para un pago: el navegador no deja enviar sin ella.
    await expect(form.getByLabel('Referencia del pago')).toHaveAttribute('required', '')
    await form.getByLabel('Referencia del pago').fill('DEP-E2E-1')
    await form.getByRole('button', { name: 'Asentar' }).click()
    await expect(p.getByText('Movimiento asentado.')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByRole('row', { name: /Pago de la empresa · ref\. DEP-E2E-1.*−RD\$ 100\.00.*RD\$ 250\.00/ })).toBeVisible()
    await expect(p.getByText('RD$ 250.00').first()).toBeVisible()
    const asientos = await prismaDeArnes().merchantLedgerEntry.findMany({ where: { companyId: empresa.id }, orderBy: { seq: 'asc' } })
    expect(asientos.map((a) => [a.seq, a.type, a.amount.toFixed(2), a.balance.toFixed(2)])).toEqual([
      [1, 'ADJUSTMENT', '350.00', '350.00'],
      [2, 'PAYMENT', '-100.00', '250.00'],
    ])
    expect((await prismaDeArnes().auditLog.count({ where: { companyId: empresa.id, accion: 'BILLING_ENTRY_RECORDED' } }))).toBe(1)
    await ctx.close()
  })

  test('un ajuste exige motivo; bajar el límite por debajo del saldo pone la cuenta «En gracia»', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto(url)
    const mov = p.getByRole('form', { name: 'Asentar un movimiento en la cuenta' })
    await mov.getByLabel('Tipo').selectOption({ label: 'Ajuste (+ debe más, − debe menos)' })
    await expect(mov.getByLabel('Motivo')).toHaveAttribute('required', '')

    const cfg = p.getByRole('form', { name: 'Configuración de cobro' })
    await cfg.getByLabel(/^Límite de crédito/).fill('200')
    await cfg.getByRole('button', { name: 'Guardar configuración' }).click()
    await expect(p.getByText(/Configuración guardada/)).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('En gracia').first()).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText(/Gracia hasta el/)).toBeVisible()
    const c = await prismaDeArnes().merchantBillingConfig.findUniqueOrThrow({ where: { companyId: empresa.id } })
    expect(c.status).toBe('GRACE_PERIOD')
    expect(c.creditLimit.toFixed(2)).toBe('200.00')
    await ctx.close()

    // La empresa ve el plazo, y su pantalla no le deja mover nada.
    const emp = await browser.newContext()
    const pe = await emp.newPage()
    await entrarComo(emp, 'pedidosAdmin', BASE, empresa.id)
    await pe.goto('/admin/facturacion-membego')
    await expect(pe.getByText('En gracia').first()).toBeVisible()
    await expect(pe.getByText(/Superaste tu límite de crédito/)).toBeVisible()
    await expect(pe.getByText('RD$ 250.00').first()).toBeVisible()
    await expect(pe.getByRole('form')).toHaveCount(0)
    await emp.close()
  })

  test('suspender a mano exige motivo y la cuenta queda «Retenida a mano»; liberarla la devuelve al sistema', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'facturacionSuperadmin', BASE)
    await p.goto(url)
    const susp = p.getByRole('form', { name: 'Suspender la cuenta' })
    await susp.getByLabel('Motivo').fill('Disputa abierta')
    await susp.getByRole('button', { name: 'Suspender' }).click()
    await expect(p.getByText('Cuenta suspendida.')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('Suspendida').first()).toBeVisible()
    await expect(p.getByText('Retenida a mano').first()).toBeVisible()
    expect((await prismaDeArnes().merchantBillingConfig.findUniqueOrThrow({ where: { companyId: empresa.id } })).holdManual).toBe(true)

    const lib = p.getByRole('form', { name: 'Liberar la cuenta' })
    await lib.getByLabel('Motivo').fill('Disputa resuelta')
    await lib.getByRole('button', { name: 'Liberar' }).click()
    await expect(p.getByText('Cuenta liberada.')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('Retenida a mano')).toHaveCount(0)
    expect((await prismaDeArnes().merchantBillingConfig.findUniqueOrThrow({ where: { companyId: empresa.id } })).holdManual).toBe(false)
    await ctx.close()

    // La empresa ve el estado resultante, con la explicación para ella.
    const emp = await browser.newContext()
    const pe = await emp.newPage()
    await entrarComo(emp, 'pedidosAdmin', BASE, empresa.id)
    await pe.goto('/admin/facturacion-membego')
    await expect(pe.getByText(/Suspendida|En gracia/).first()).toBeVisible()
    await emp.close()
  })

  test('quien no es superadmin no entra al panel de cobros: ni la lista ni la cuenta de una empresa', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'pedidosAdmin', BASE, empresa.id)
    for (const ruta of ['/superadmin/facturacion', url]) {
      await p.goto(ruta)
      await expect(p).not.toHaveURL(new RegExp(`${ruta}$`))
      // Lo que ve ahora es SU panel (con el nombre de su empresa en el encabezado): nada de lo del panel de cobros.
      await expect(p.getByRole('heading', { name: 'Cobros a empresas' })).toHaveCount(0)
      await expect(p.getByText('Debe a Membego')).toHaveCount(0)
      await expect(p.getByRole('form', { name: 'Asentar un movimiento en la cuenta' })).toHaveCount(0)
    }
    await ctx.close()

    const sin = await browser.newContext()
    const ps = await sin.newPage()
    await ps.goto('/superadmin/facturacion')
    await expect(ps).toHaveURL(/\/login/)
    await sin.close()
  })
})
