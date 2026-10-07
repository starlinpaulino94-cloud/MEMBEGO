import { test, expect, type Locator, type Page } from '@playwright/test'
import { cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * INVENTARIO CON LEDGER · el panel, de punta a punta (F2.2).
 *
 *   lista (agotado) → entrada → faltante sin motivo (no envía) → faltante con
 *   motivo → faltante imposible (avisa y no mueve) → daño → dar de baja →
 *   umbral → la alerta aparece en la lista → transferir → conteo físico →
 *   historial con cada movimiento
 *
 * Y lo que NO debe pasar: abrir por URL la variante de otra empresa, y entrar
 * una empresa que no tiene encendida la capacidad.
 *
 * La base de E2E se crea con `db push`: no lleva los disparadores ni los CHECK
 * de las migraciones (la inmutabilidad del ledger y las 144 combinaciones las
 * prueba `tests/postgres/inventory.db.test.ts`). Aquí se prueba la INTERFAZ.
 *
 * Entra con una sesión firmada localmente (ver `supply-v2-sesion.ts`).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `Camiseta E2E ${sufijo}`
const SERVICIO = `Lavado E2E ${sufijo}`

/** La tarjeta de UNA sucursal en el detalle. */
const tarjeta = (p: Page, nombre: string): Locator => p.locator(`[data-sucursal="${nombre}"]`)

/** Lo que dice la tarjeta en una cifra concreta («Disponible», «Dañado»…). */
async function cifra(t: Locator, etiqueta: string): Promise<number> {
  const bloque = t.getByLabel(/^Existencias en/).locator('div', { has: t.page().getByText(etiqueta, { exact: true }) }).last()
  const texto = (await bloque.innerText()).replace(/\s+/g, ' ')
  const m = new RegExp(`${etiqueta}\\s+([\\d.,]+)`).exec(texto)
  if (!m) throw new Error(`no se encontró «${etiqueta}» en: ${texto}`)
  return Number(m[1].replace(/[.,]/g, ''))
}

async function registrar(p: Page, sucursal: string, o: { operacion: string; cantidad: number; motivo?: string }) {
  const f = p.getByRole('form', { name: `Registrar movimiento en ${sucursal}` })
  await f.getByLabel('Movimiento').selectOption({ label: o.operacion })
  await f.getByRole('textbox').first().fill(String(o.cantidad))
  if (o.motivo !== undefined) await f.getByLabel(/^Motivo/).fill(o.motivo)
  await f.getByRole('button', { name: 'Registrar' }).click()
}

test.describe('Inventario · panel', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let sin: EmpresaCatalogo
  let variante = ''
  let varianteAjena = ''

  test('prepara: empresa con la capacidad (2 sucursales, un producto y un servicio) y otra sin ella', async () => {
    con = await empresaCatalogo(sufijo, 'inv', { capacidad: true })
    sin = await empresaCatalogo(sufijo, 'invsin', { capacidad: false })
    await sucursalSembrada(con.id, 'Principal')
    await sucursalSembrada(con.id, 'Norte')
    const producto = await itemSembrado(con.id, { name: PRODUCTO, slug: `camiseta-inv-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `INV-${sufijo}`, price: 800, porDefecto: true }] })
    variante = await varianteDe(producto.id)
    await itemSembrado(con.id, { name: SERVICIO, slug: `lavado-inv-${sufijo}`, variantes: [{ name: 'Default', sku: `LAV-INV-${sufijo}`, price: 500, porDefecto: true }] })
    await sucursalSembrada(sin.id, 'De otra')
    const ajeno = await itemSembrado(sin.id, { name: `SECRETO inv ${sufijo}`, slug: `secreto-inv-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `SEC-INV-${sufijo}`, price: 999, porDefecto: true }] })
    varianteAjena = await varianteDe(ajeno.id)
    expect(con.id).not.toBe(sin.id)
  })

  test('lista → entrada → ajuste → daño → baja → umbral y alerta → transferencia → conteo → historial', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // ── La lista: el producto aparece agotado; el servicio no ─────────────
    await p.goto('/admin/inventario')
    await expect(p.getByRole('heading', { name: 'Inventario' }).first()).toBeVisible()
    await expect(p.getByRole('link', { name: /^Inventario/ }).first()).toBeVisible()
    const lista = p.getByRole('list', { name: 'Existencias por producto' })
    await expect(lista.getByText(PRODUCTO)).toBeVisible()
    await expect(lista.getByText('Agotado')).toBeVisible()
    await expect(lista.getByText(/Sin existencias registradas/)).toBeVisible()
    await expect(p.getByText(SERVICIO)).toHaveCount(0)

    // ── El detalle: dos sucursales, todo en cero ──────────────────────────
    await lista.getByRole('link', { name: new RegExp(PRODUCTO) }).click()
    await p.waitForURL(`**/admin/inventario/${variante}`)
    await expect(p.getByRole('heading', { name: PRODUCTO, level: 1 })).toBeVisible()
    const principal = tarjeta(p, 'Principal')
    const norte = tarjeta(p, 'Norte')
    await expect(principal).toBeVisible()
    await expect(norte).toBeVisible()
    expect(await cifra(principal, 'Disponible')).toBe(0)

    // ── Entrada de mercancía ──────────────────────────────────────────────
    await registrar(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 10, motivo: 'Compra E2E' })
    await expect.poll(() => cifra(principal, 'Disponible'), { timeout: 15_000 }).toBe(10)

    // ── Faltante SIN motivo: el navegador no deja enviar ──────────────────
    await registrar(p, 'Principal', { operacion: 'Ajuste: faltante', cantidad: 3 })
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Motivo *')).toBeVisible()
    expect(await cifra(principal, 'Disponible')).toBe(10)
    // …y con motivo, baja.
    await p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Motivo *').fill('Merma')
    await p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByRole('button', { name: 'Registrar' }).click()
    await expect.poll(() => cifra(principal, 'Disponible'), { timeout: 15_000 }).toBe(7)

    // ── Un faltante imposible avisa y no mueve nada ───────────────────────
    await registrar(p, 'Principal', { operacion: 'Ajuste: faltante', cantidad: 99, motivo: 'Imposible' })
    await expect(p.getByText(/No hay suficiente: pides 99 y hay 7 disponible/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cifra(principal, 'Disponible')).toBe(7)

    // ── Daño y baja de lo dañado ──────────────────────────────────────────
    await registrar(p, 'Principal', { operacion: 'Mercancía dañada', cantidad: 2, motivo: 'Se mojaron' })
    await expect.poll(() => cifra(principal, 'Dañado'), { timeout: 15_000 }).toBe(2)
    expect(await cifra(principal, 'Disponible')).toBe(5)
    await registrar(p, 'Principal', { operacion: 'Dar de baja lo dañado', cantidad: 2, motivo: 'Irrecuperable' })
    await expect.poll(() => cifra(principal, 'Dañado'), { timeout: 15_000 }).toBe(0)
    // Sin dañados, esa operación deja de ofrecerse.
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Movimiento').locator('option', { hasText: 'Dar de baja lo dañado' })).toHaveCount(0)

    // ── Umbral → alerta en la lista ───────────────────────────────────────
    await p.getByRole('form', { name: 'Umbral de stock bajo en Principal' }).getByLabel('Avisar cuando queden').fill('6')
    await p.getByRole('form', { name: 'Umbral de stock bajo en Principal' }).getByRole('button', { name: 'Guardar umbral' }).click()
    await expect(p.getByText(/Te avisaremos cuando queden 6 o menos/).first()).toBeVisible({ timeout: 15_000 })
    await p.goto('/admin/inventario')
    const alertas = p.getByRole('list', { name: 'Alertas de stock bajo' })
    await expect(alertas.getByText(PRODUCTO)).toBeVisible()
    await expect(alertas.getByText('Quedan 5')).toBeVisible()
    await expect(p.getByText(/Stock bajo \(1\)/)).toBeVisible()
    await expect(p.getByRole('list', { name: 'Existencias por producto' }).getByText('Stock bajo')).toBeVisible()
    // Filtro por estado.
    await p.goto('/admin/inventario?estado=AGOTADO')
    await expect(p.getByText(PRODUCTO).first()).toBeVisible() // la alerta sigue arriba; la lista, no
    await expect(p.getByRole('list', { name: 'Existencias por producto' })).toHaveCount(0)
    await p.goto('/admin/inventario?estado=BAJO')
    await expect(p.getByRole('list', { name: 'Existencias por producto' }).getByText(PRODUCTO)).toBeVisible()
    // Una URL manipulada no rompe nada.
    await p.goto('/admin/inventario?estado=<script>&sucursal=ajena&pagina=-4')
    await expect(p.getByRole('heading', { name: 'Inventario' }).first()).toBeVisible()

    // ── Transferencia entre sucursales ────────────────────────────────────
    await p.goto(`/admin/inventario/${variante}`)
    const tr = p.getByRole('form', { name: 'Transferir existencias' })
    await tr.getByLabel('Desde').selectOption({ label: 'Principal (5 disp.)' })
    await tr.getByLabel('Hacia').selectOption({ label: 'Norte' })
    await tr.getByLabel('Cantidad').fill('2')
    await tr.getByLabel('Motivo (opcional)').fill('Reabasto')
    await tr.getByRole('button', { name: 'Transferir' }).click()
    await expect.poll(() => cifra(norte, 'Disponible'), { timeout: 15_000 }).toBe(2)
    expect(await cifra(principal, 'Disponible')).toBe(3)
    // Más de lo que hay: avisa.
    await tr.getByLabel('Cantidad').fill('50')
    await tr.getByRole('button', { name: 'Transferir' }).click()
    await expect(p.getByText(/No hay suficiente: pides 50/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cifra(norte, 'Disponible')).toBe(2)

    // ── Conteo físico: se cuenta 4 donde el sistema decía 3 ───────────────
    await registrar(p, 'Principal', { operacion: 'Conteo físico', cantidad: 4 })
    await expect.poll(() => cifra(principal, 'En existencia'), { timeout: 15_000 }).toBe(4)
    // Contar lo mismo no cambia nada y lo dice.
    await registrar(p, 'Principal', { operacion: 'Conteo físico', cantidad: 4 })
    await expect(p.getByText(/coincide con el sistema/).first()).toBeVisible({ timeout: 15_000 })

    // ── El historial lo cuenta todo, de lo nuevo a lo viejo ───────────────
    await p.reload()
    const historial = p.getByRole('list', { name: 'Historial de movimientos' })
    for (const tipo of ['Entrada de mercancía', 'Ajuste', 'Daño', 'Transferencia enviada', 'Transferencia recibida']) {
      await expect(historial.getByText(tipo, { exact: false }).first()).toBeVisible()
    }
    await expect(historial.getByText('+10')).toBeVisible()
    await expect(historial.getByText('Merma')).toBeVisible()
    await expect(historial.getByText('Compra E2E')).toBeVisible()
    // Exactamente los 7 que hizo el recorrido: entrada, faltante, daño, baja,
    // las dos patas de la transferencia y el conteo (los rechazados no escriben).
    const filas = historial.getByRole('listitem')
    await expect(filas).toHaveCount(7)
    // La más reciente (el conteo, +1) va primero.
    await expect(filas.first()).toContainText('Conteo físico')
    await expect(filas.first()).toContainText('+1')

    // ── Persistencia: lo mismo después de recargar ────────────────────────
    expect(await cifra(tarjeta(p, 'Principal'), 'En existencia')).toBe(4)
    expect(await cifra(tarjeta(p, 'Norte'), 'Disponible')).toBe(2)

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('aislamiento: la variante de otra empresa no se abre ni se lista', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    const vista = async (id: string) => {
      await p.goto(`/admin/inventario/${id}`)
      const texto = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
      return {
        noindex: (await p.locator('meta[name=robots][content*=noindex]').count()) > 0,
        fuga: /SECRETO|999/.test(texto),
        formularios: await p.getByRole('form').count(),
      }
    }
    const ajeno = await vista(varianteAjena)
    const inexistente = await vista('cinexistente000000000000')
    expect(ajeno.noindex).toBe(true)
    expect(ajeno.fuga).toBe(false)
    expect(ajeno.formularios).toBe(0)
    expect(ajeno).toEqual(inexistente)

    await p.goto('/admin/inventario')
    await expect(p.getByText(/SECRETO/)).toHaveCount(0)
    await ctx.close()
  })

  test('una empresa SIN la capacidad no entra a /admin/inventario ni ve la entrada de menú', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoSinCapacidad', BASE, sin.id)
    await p.goto('/admin/inventario')
    await expect(p).not.toHaveURL(/\/admin\/inventario$/)
    await expect(p.getByRole('link', { name: /^Inventario$/ })).toHaveCount(0)
    await ctx.close()
  })
})
