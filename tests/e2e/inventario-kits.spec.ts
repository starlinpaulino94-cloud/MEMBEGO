import { test, expect } from '@playwright/test'
import { cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * INVENTARIO · KITS (INV-5d), de punta a punta en el panel.
 *
 *   la pestaña «Kits» (vacía al principio) → armar un kit: se elige el producto (solo ofrece los que NO controlan inventario por su cuenta),
 *   se agregan componentes con su cantidad por kit (una cantidad mala se frena) → el kit sale con su receta y cuántos alcanzan por sucursal
 *   (el mínimo de los componentes, y qué componente falta) → editar la receta cambia lo que alcanza → la ficha de un componente avisa que
 *   entra en un kit → un producto que controla inventario no se ofrece como kit y un componente no se ofrece como kit → quitar la receta
 *   (en dos pasos) deja el producto como uno cualquiera.
 *
 * Lo que pasa al VENDER un kit (apartar, vender, liberar y devolver componentes, con lotes) lo prueba `postgres/inventory-kits.db.test.ts` con
 * pedidos reales: aquí solo se comprueba lo que se ve y se hace en el panel.
 *
 * La base de E2E se crea con `db push` y `scripts/e2e/base-limpia.mjs` le aplica la migración de kits. Si no la trae, esta prueba se OMITE
 * con un aviso claro en vez de fallar por otra cosa.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const SHAMPOO = `Shampoo kit E2E ${sufijo}`
const GEL = `Gel kit E2E ${sufijo}`
const SET = `Set de baño E2E ${sufijo}`

test.describe('Inventario · kits', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let vShampoo = ''

  test('prepara: empresa con la capacidad, dos sucursales, dos componentes con existencias y un paquete sin inventario', async () => {
    const hay = await prismaDeArnes().$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'inventory_kit_components_sin_anidar'`
    test.skip(Number(hay[0]?.n ?? 0) === 0, 'la base de E2E no trae la migración de kits (20261072): aplícala con `npm run e2e:base`')
    con = await empresaCatalogo(sufijo, 'kit', { capacidad: true })
    const principal = await sucursalSembrada(con.id, 'Principal')
    await sucursalSembrada(con.id, 'Norte')
    const a = await itemSembrado(con.id, { name: SHAMPOO, slug: `shampoo-kit-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `SHA-${sufijo}`, price: 120, porDefecto: true }] })
    const b = await itemSembrado(con.id, { name: GEL, slug: `gel-kit-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `GEL-${sufijo}`, price: 90, porDefecto: true }] })
    await itemSembrado(con.id, { name: SET, slug: `set-kit-${sufijo}`, variantes: [{ name: 'Default', sku: `SET-${sufijo}`, price: 300, porDefecto: true }] })
    vShampoo = await varianteDe(a.id)
    await existenciasSembradas(con.id, vShampoo, principal.id, 10)
    await existenciasSembradas(con.id, await varianteDe(b.id), principal.id, 4)
  })

  test('armar un kit, ver cuántos alcanzan, editar la receta, y quitarla', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // ── La pestaña, vacía ──
    await p.goto('/admin/inventario')
    await p.getByRole('navigation', { name: 'Vistas del inventario' }).getByRole('link', { name: 'Kits' }).click()
    await p.waitForURL('**/admin/inventario/kits')
    await expect(p.getByRole('heading', { name: 'Kits', level: 1 })).toBeVisible()
    await expect(p.getByText('Todavía no hay kits.')).toBeVisible()

    // ── Armar el kit: solo se ofrece lo que no controla inventario por su cuenta ──
    const armar = p.getByRole('form', { name: 'Armar un kit nuevo' })
    await armar.getByLabel('Producto que será el kit *').fill(SHAMPOO)
    await expect(armar.getByRole('list', { name: 'Productos que pueden ser kit' })).toHaveCount(0)
    await armar.getByLabel('Producto que será el kit *').fill(SET)
    await armar.getByRole('list', { name: 'Productos que pueden ser kit' }).getByRole('button', { name: new RegExp(SET) }).click()
    await expect(armar.getByText(SET).first()).toBeVisible()

    // ── Los componentes, con su cantidad por kit ──
    await armar.getByLabel('Agregar un componente').fill(SHAMPOO)
    await armar.getByRole('list', { name: 'Componentes encontrados' }).getByRole('button', { name: new RegExp(SHAMPOO) }).click()
    await armar.getByLabel('Agregar un componente').fill(GEL)
    await armar.getByRole('list', { name: 'Componentes encontrados' }).getByRole('button', { name: new RegExp(GEL) }).click()
    const lista = armar.getByRole('list', { name: 'Componentes del kit' })
    await expect(lista.getByRole('listitem')).toHaveCount(2)
    await lista.getByRole('listitem').filter({ hasText: SHAMPOO }).getByLabel('Unidades por kit').fill('2')
    // Una cantidad mala se frena antes de enviar nada.
    await lista.getByRole('listitem').filter({ hasText: GEL }).getByLabel('Unidades por kit').fill('0')
    await armar.getByRole('button', { name: 'Crear el kit' }).click()
    await expect(p.getByText(/Revisa la cantidad de/).first()).toBeVisible({ timeout: 15_000 })
    expect(await prismaDeArnes().inventoryKitComponent.count({ where: { companyId: con.id } }), 'lo rechazado no guardó nada').toBe(0)
    await lista.getByRole('listitem').filter({ hasText: GEL }).getByLabel('Unidades por kit').fill('1')
    await armar.getByRole('button', { name: 'Crear el kit' }).click()
    await expect(p.getByText(new RegExp(`Kit «${SET}» creado con 2 componentes`)).first()).toBeVisible({ timeout: 15_000 })

    // ── El kit con su receta y cuántos alcanzan: 10/2 = 5 y 4/1 = 4 → 4 en Principal; en Norte no hay nada ──
    const tarjeta = p.locator(`[data-kit="${SET}"]`)
    await expect(tarjeta).toBeVisible({ timeout: 15_000 })
    const componentes = tarjeta.getByRole('list', { name: `Componentes de ${SET}` })
    await expect(componentes).toContainText('2 ×')
    await expect(componentes).toContainText(SHAMPOO)
    await expect(componentes).toContainText(GEL)
    await expect(tarjeta.locator('[data-sucursal="Principal"]')).toContainText('Principal: 4')
    await expect(tarjeta.locator('[data-sucursal="Norte"]')).toContainText('Norte: 0')
    await expect(tarjeta.locator('[data-sucursal="Norte"]')).toContainText('falta ')
    // El kit no tiene existencias propias.
    expect(await prismaDeArnes().inventoryLevel.count({ where: { companyId: con.id, variant: { sku: `SET-${sufijo}` } } })).toBe(0)

    // ── Editar la receta: el Gel pasa a 2 por kit → 4/2 = 2 kits ──
    await tarjeta.getByRole('button', { name: `Editar la receta de ${SET}` }).click()
    const editar = p.getByRole('form', { name: `Receta de ${SET}` })
    await editar.getByRole('listitem').filter({ hasText: GEL }).getByLabel('Unidades por kit').fill('2')
    await editar.getByRole('button', { name: 'Guardar la receta' }).click()
    await expect(p.getByText(`Receta de «${SET}» actualizada.`).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.locator(`[data-kit="${SET}"] [data-sucursal="Principal"]`)).toContainText('Principal: 2', { timeout: 15_000 })
    // Guardar lo mismo no cambia nada.
    await p.locator(`[data-kit="${SET}"]`).getByRole('button', { name: `Editar la receta de ${SET}` }).click()
    await p.getByRole('form', { name: `Receta de ${SET}` }).getByRole('button', { name: 'Guardar la receta' }).click()
    await expect(p.getByText('La receta ya era esa: no cambió nada.').first()).toBeVisible({ timeout: 15_000 })

    // ── La ficha de un componente avisa que entra en un kit ──
    await p.goto(`/admin/inventario/${vShampoo}`)
    await expect(p.getByText(/Este producto es componente de un kit/)).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText(`2 × en ${SET}`)).toBeVisible()
    await p.getByRole('link', { name: 'Ver los kits' }).click()
    await p.waitForURL('**/admin/inventario/kits')

    // ── Un componente no se ofrece como kit ──
    await p.getByRole('form', { name: 'Armar un kit nuevo' }).getByLabel('Producto que será el kit *').fill(GEL)
    await expect(p.getByRole('list', { name: 'Productos que pueden ser kit' })).toHaveCount(0)

    // ── Quitar la receta, en dos pasos ──
    const t2 = p.locator(`[data-kit="${SET}"]`)
    await t2.getByRole('button', { name: `Quitar la receta de ${SET}` }).click()
    await t2.getByRole('group', { name: `Confirmar quitar la receta de ${SET}` }).getByRole('button', { name: 'Cancelar' }).click()
    expect(await prismaDeArnes().inventoryKitComponent.count({ where: { companyId: con.id } }), 'cancelar no quita nada').toBe(2)
    await t2.getByRole('button', { name: `Quitar la receta de ${SET}` }).click()
    await t2.getByRole('group', { name: `Confirmar quitar la receta de ${SET}` }).getByRole('button', { name: 'Sí, quitarla' }).click()
    await expect(p.getByText(`«${SET}» ya no es un kit.`).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText('Todavía no hay kits.')).toBeVisible({ timeout: 15_000 })
    expect(await prismaDeArnes().inventoryKitComponent.count({ where: { companyId: con.id } })).toBe(0)
    await p.goto(`/admin/inventario/${vShampoo}`)
    await expect(p.getByText(/Este producto es componente de un kit/)).toHaveCount(0)

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })
})
