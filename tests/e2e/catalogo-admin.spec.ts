import { test, expect } from '@playwright/test'
import { cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * CATÁLOGO UNIFICADO · el panel de administración, de punta a punta (F1.2).
 *
 *   lista vacía → alta de un servicio simple → editar su precio → publicar →
 *   agregar una variante (aparece el selector) → quitar una (vuelve a precio
 *   único) → categoría → subir foto → filtros → se VE en la vitrina pública
 *
 * Y lo que NO debe pasar: abrir por URL un ítem de otra empresa, y entrar una
 * empresa que no tiene encendida la capacidad.
 *
 * Entra con una sesión firmada localmente (ver `supply-v2-sesion.ts`): no
 * necesita un proyecto de Supabase. Sin `SUPABASE_JWT_SECRET` se salta.
 *
 * NO prueba la subida real de fotos a Storage (no hay Storage en CI): prueba
 * que, sin él, la pantalla avisa y sigue viva.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const NOMBRE = `Lavado completo E2E ${sufijo}`

test.describe('Catálogo unificado · panel', () => {
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
  let itemAjeno: { id: string }

  test('prepara dos empresas: una con la capacidad y otra sin ella', async () => {
    con = await empresaCatalogo(sufijo, 'admin', { capacidad: true })
    sin = await empresaCatalogo(sufijo, 'sin', { capacidad: false })
    itemAjeno = await itemSembrado(sin.id, { name: `SECRETO ajeno ${sufijo}`, slug: `secreto-${sufijo}`, variantes: [{ name: 'Default', sku: `SEC-${sufijo}`, price: 999, porDefecto: true }] })
    expect(con.id).not.toBe(sin.id)
  })

  test('alta → precio → publicar → variantes → categoría → foto → filtros → vitrina pública', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // ── Lista vacía y entrada de menú ─────────────────────────────────────
    await p.goto('/admin/catalogo')
    await expect(p).toHaveURL(/\/admin\/catalogo$/)
    await expect(p.getByRole('heading', { name: 'Catálogo' }).first()).toBeVisible()
    await expect(p.getByText('Tu catálogo está vacío')).toBeVisible()
    await expect(p.getByRole('link', { name: /^Catálogo/ }).first()).toBeVisible()

    // ── Alta de un servicio simple ────────────────────────────────────────
    await p.getByRole('link', { name: 'Nuevo' }).first().click()
    await p.waitForURL('**/admin/catalogo/nuevo')
    await p.getByLabel('Nombre *').fill(NOMBRE)
    await p.getByLabel('Descripción').fill('Exterior e interior')
    await p.getByLabel('Precio *', { exact: true }).fill('500')
    await p.getByLabel('Costo').fill('200')
    await p.getByRole('button', { name: 'Crear' }).click()
    await p.waitForURL(/\/admin\/catalogo\/(?!nuevo)[^/]+$/, { timeout: 15_000 })
    const urlItem = p.url()
    await expect(p.getByText('Borrador').first()).toBeVisible()

    // Un ítem simple no habla de variantes: «Precio», sin nombre de variante.
    await expect(p.getByText('Variantes y precios')).toHaveCount(0)
    await expect(p.getByLabel('Nombre de la variante *')).toHaveCount(0)
    await expect(p.getByLabel('Precio *').first()).toHaveValue('500.00')

    // ── Editar el precio de la variante única ─────────────────────────────
    await p.getByLabel('Precio *').first().fill('650.50')
    await p.getByRole('button', { name: 'Guardar', exact: true }).first().click()
    await expect.poll(async () => {
      await p.reload()
      return p.getByLabel('Precio *').first().inputValue()
    }, { timeout: 15_000 }).toBe('650.50')

    // ── Publicar ──────────────────────────────────────────────────────────
    await p.getByRole('button', { name: 'Publicar' }).click()
    await expect(p.getByRole('button', { name: 'Pausar' })).toBeVisible({ timeout: 15_000 })
    await p.reload()
    await expect(p.getByText('Publicado').first()).toBeVisible()
    await expect(p.getByRole('button', { name: 'Publicar' })).toHaveCount(0)

    // ── Agregar una variante: aparece el selector ─────────────────────────
    await p.getByRole('button', { name: /Tiene tallas, tamaños/ }).click()
    await p.getByLabel('Nombre de la variante *').fill('Premium')
    await p.getByLabel('Precio *').last().fill('900')
    await p.getByRole('button', { name: 'Agregar variante' }).click()
    await expect.poll(async () => {
      await p.reload()
      return p.getByText('Variantes y precios').count()
    }, { timeout: 15_000 }).toBe(1)
    await expect(p.getByText('Premium').first()).toBeVisible()
    await expect(p.getByText(/RD\$900\.00/)).toBeVisible()
    await expect(p.getByText(/RD\$650\.50/)).toBeVisible()
    // La variante original dejó de llamarse «Default» (nombre de sistema) y pasó a «Estándar».
    await expect(p.getByText('Estándar').first()).toBeVisible()

    // ── Quitar una: vuelve a precio único ─────────────────────────────────
    await p.getByRole('button', { name: 'Quitar la variante Premium' }).click()
    await p.getByRole('button', { name: 'Eliminar' }).click()
    await expect.poll(async () => {
      await p.reload()
      return p.getByText('Variantes y precios').count()
    }, { timeout: 15_000 }).toBe(0)

    // ── Categoría ─────────────────────────────────────────────────────────
    await p.getByPlaceholder('Nueva categoría').fill('Lavados')
    await p.getByRole('button', { name: 'Crear', exact: true }).click()
    await expect(p.getByText('Lavados').first()).toBeVisible({ timeout: 15_000 })
    await p.getByRole('button', { name: 'Guardar categorías' }).click()
    await expect.poll(async () => {
      await p.reload()
      return p.getByRole('checkbox').first().isChecked()
    }, { timeout: 15_000 }).toBe(true)

    // ── Foto: sin Storage debe avisar y la pantalla sigue viva ────────────
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await p.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png })
    await expect(p.getByText(/No se pudo subir la imagen/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText('Fotos', { exact: true })).toBeVisible()

    // ── Filtros de la lista ───────────────────────────────────────────────
    await p.goto('/admin/catalogo?q=lavado&estado=ACTIVE')
    await expect(p.getByText(NOMBRE)).toBeVisible()
    await p.goto('/admin/catalogo?estado=ARCHIVED')
    await expect(p.getByText(NOMBRE)).toHaveCount(0)
    await p.goto('/admin/catalogo?estado=<script>&tipo=xx')
    await expect(p.getByRole('heading', { name: 'Catálogo' }).first()).toBeVisible()

    // ── Lo publicado desde el panel SE VE en la vitrina pública ───────────
    // Es la prueba de que el panel invalida la caché del marketplace: se mira
    // con un visitante anónimo, otro contexto, sin sesión.
    const anonimo = await browser.newContext()
    const pub = await anonimo.newPage()
    await expect.poll(async () => {
      await pub.goto(`/empresas/${con.slug}`)
      return pub.getByText(NOMBRE).count()
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0)
    await expect(pub.locator('#catalogo')).toBeVisible()
    // …y en el descubrimiento entre empresas (lista sin filtros) y en el inicio.
    await expect.poll(async () => {
      await pub.goto('/catalogo')
      return pub.getByText(NOMBRE).count()
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0)
    await expect.poll(async () => {
      await pub.goto('/')
      return pub.getByText(NOMBRE).count()
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0)
    await pub.goto(`/empresas/${con.slug}`)
    await pub.getByRole('link', { name: new RegExp(NOMBRE) }).first().click()
    await expect(pub.getByRole('heading', { level: 1, name: NOMBRE })).toBeVisible()
    await expect(pub.getByText(/RD\$650\.50/)).toBeVisible()
    // El costo del panel NUNCA llega al público.
    expect(await pub.content()).not.toContain('200.00')
    await anonimo.close()

    // ── Pausarlo desde el panel lo saca de la vitrina ─────────────────────
    await p.goto(urlItem)
    await p.getByRole('button', { name: 'Pausar' }).click()
    await expect(p.getByRole('button', { name: 'Publicar' })).toBeVisible({ timeout: 15_000 })
    const anonimo2 = await browser.newContext()
    const pub2 = await anonimo2.newPage()
    await expect.poll(async () => {
      await pub2.goto(`/empresas/${con.slug}`)
      return pub2.getByText(NOMBRE).count()
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(0)
    await expect.poll(async () => {
      await pub2.goto('/catalogo')
      return pub2.getByText(NOMBRE).count()
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(0)
    await anonimo2.close()

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('aislamiento: un ítem de otra empresa no se abre ni se lista', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    const vista = async (id: string) => {
      await p.goto(`/admin/catalogo/${id}`)
      const texto = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
      return {
        // Booleano y no el número: durante el streaming hay 1 o 2 metas según el instante.
        noindex: (await p.locator('meta[name=robots][content*=noindex]').count()) > 0,
        fuga: /SECRETO|999/.test(texto),
        formulario: await p.getByLabel('Nombre', { exact: true }).count(),
      }
    }
    const ajeno = await vista(itemAjeno.id)
    const inexistente = await vista('cinexistente000000000000')
    expect(ajeno.noindex).toBe(true)
    expect(ajeno.fuga).toBe(false)
    expect(ajeno.formulario).toBe(0)
    // Indistinguible de un id inventado: no revela que existe.
    expect(ajeno).toEqual(inexistente)

    await p.goto('/admin/catalogo')
    await expect(p.getByText(/SECRETO/)).toHaveCount(0)
    await ctx.close()
  })

  test('una empresa SIN la capacidad no entra a /admin/catalogo ni ve la entrada de menú', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoSinCapacidad', BASE, sin.id)
    await p.goto('/admin/catalogo')
    await expect(p).not.toHaveURL(/\/admin\/catalogo$/)
    await expect(p.getByRole('link', { name: /^Catálogo$/ })).toHaveCount(0)
    await ctx.close()
  })
})
