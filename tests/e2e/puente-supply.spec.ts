import { test, expect } from '@playwright/test'
import { cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'
import { ofertasDeSupply, type OfertaSembrada } from './puente-arnes'

/**
 * PUENTE SUPPLY → CATÁLOGO · de punta a punta (F2.5).
 *
 *   sin casa no hay nada → el superadmin designa la empresa de la casa →
 *   sincroniza → las ofertas de Supply aparecen en /catalogo (destacadas), en la
 *   vitrina de la casa y con filtro de origen → la tarjeta lleva a la página de
 *   compra de Supply → pausar una oferta DESDE SUPPLY la saca del catálogo →
 *   retirar la casa saca todo.
 *
 * Y lo que NO debe pasar: que entre quien no es superadmin.
 *
 * La base de E2E se crea con `db push`: no lleva los CHECK ni el índice único
 * parcial de la migración (lo prueba `tests/postgres/supply-bridge.db.test.ts`).
 * Entra con una sesión firmada localmente (ver `supply-v2-sesion.ts`).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const A = `Lavado Premium ${sufijo}`
const B = `Detallado Express ${sufijo}`

test.describe('Puente Supply → Catálogo', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let casa: EmpresaCatalogo
  let ofertas: OfertaSembrada[] = []

  test('prepara: una empresa con la capacidad (la futura casa) y dos ofertas de Supply activas', async () => {
    casa = await empresaCatalogo(sufijo, 'casa', { capacidad: true })
    ofertas = await ofertasDeSupply(sufijo, [A, B])
    expect(ofertas).toHaveLength(2)
  })

  test('designar la casa → sincronizar → las ofertas se ven; pausar una desde Supply la saca; retirar la casa saca todo', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'compras', BASE)

    // ── Sin casa: el panel lo dice y ofrece buscar ────────────────────────
    await p.goto('/superadmin/puente-supply')
    await expect(p.getByRole('heading', { name: 'Puente Supply → Catálogo', level: 1 })).toBeVisible()
    await expect(p.getByText(/Todavía no hay empresa de la casa/)).toBeVisible()
    await p.getByLabel('Buscar empresa').fill(`Catálogo casa ${sufijo}`)
    await p.getByRole('button', { name: 'Buscar' }).click()
    const candidatas = p.getByRole('list', { name: 'Empresas candidatas' })
    await expect(candidatas.getByText(casa.name)).toBeVisible()

    // ── Designar la casa ──────────────────────────────────────────────────
    await candidatas.getByRole('button', { name: 'Designar como casa' }).click()
    await expect(p.getByText(/Empresa de la casa designada/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText(casa.name).first()).toBeVisible()
    const requisitos = p.getByRole('list', { name: 'Requisitos para que las ofertas se vean' })
    await expect(requisitos.getByText(/cumplido/)).toHaveCount(4)

    // ── Sincronizar a pedido ──────────────────────────────────────────────
    await p.getByRole('button', { name: 'Sincronizar ahora' }).click()
    await expect(p.getByText(/Sincronizado:/).first()).toBeVisible({ timeout: 30_000 })
    await p.reload()
    await expect(p.getByLabel('Ítems puente por estado').getByText(/publicados/)).toBeVisible()

    // ── El público las ve: destacadas, filtro de origen y vitrina de la casa ──
    const anonimo = await browser.newContext()
    const pub = await anonimo.newPage()
    await expect
      .poll(async () => {
        await pub.goto('/catalogo')
        return pub.getByRole('region', { name: 'Ofertas MembeGo' }).getByText(A).count()
      }, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0)
    const destacadas = pub.getByRole('region', { name: 'Ofertas MembeGo' })
    await expect(destacadas.getByRole('link', { name: new RegExp(B) })).toBeVisible()
    // La tarjeta lleva a la página de COMPRA de Supply, no a la ficha del catálogo.
    const tarjetaA = destacadas.getByRole('link', { name: new RegExp(A) })
    await expect(tarjetaA).toHaveAttribute('href', `/promociones/membego/${ofertas[0].slug}`)
    // Ni costo ni código interno en el HTML público.
    const html = await pub.content()
    expect(html).not.toContain(ofertas[0].code)

    // La lista se cachea (120 s por combinación de filtros) y la invalidación del
    // panel es «sirve lo viejo y refresca»: la PRIMERA visita a una combinación
    // nueva puede enseñar lo anterior. Se espera con reintento, como el catálogo.
    // Roles y no texto: durante el streaming hay un instante con el contenido duplicado oculto.
    await expect
      .poll(async () => {
        await pub.goto('/catalogo?origen=supply')
        return pub.getByRole('link', { name: new RegExp(A) }).count()
      }, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0)
    await expect(pub.getByRole('navigation', { name: 'Origen' }).getByRole('link', { name: 'Ofertas MembeGo' })).toHaveAttribute('aria-current', 'page')
    await pub.goto('/catalogo?origen=empresas')
    await expect(pub.getByText(A)).toHaveCount(0)
    // Valores hostiles en la URL no rompen nada.
    await pub.goto('/catalogo?origen=<script>&pagina=-3')
    await expect(pub.getByRole('heading', { name: 'Productos y servicios', level: 1 })).toBeVisible()

    // La ficha del ítem en la vitrina de la casa lleva a la compra.
    await pub.goto(`/empresas/${casa.slug}/catalogo/${ofertas[0].slug}`)
    await expect(pub.getByRole('heading', { level: 1, name: A })).toBeVisible()
    await expect(pub.getByText('Oferta MembeGo').first()).toBeVisible()
    await expect(pub.getByText(/RD\$650\.50/).first()).toBeVisible()
    await expect(pub.getByText(/RD\$1,000\.00|RD\$1000\.00/).first()).toBeVisible()
    await pub.getByRole('link', { name: 'Ver la oferta y comprar' }).click()
    await pub.waitForURL(`**/promociones/membego/${ofertas[0].slug}`)
    await expect(pub.getByRole('heading', { name: new RegExp(A) }).first()).toBeVisible()

    // ── Pausar la oferta DESDE SUPPLY la saca del catálogo ────────────────
    await p.goto(`/superadmin/supply/ofertas/${ofertas[0].id}`)
    await p.getByTestId('btn-pausar').click()
    await expect(p.getByTestId('btn-pausar')).toHaveCount(0, { timeout: 15_000 })
    await expect
      .poll(async () => {
        await pub.goto('/catalogo?origen=supply')
        return pub.getByText(A).count()
      }, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBe(0)
    await expect
      .poll(async () => {
        await pub.goto('/catalogo?origen=supply')
        return pub.getByRole('link', { name: new RegExp(B) }).count()
      }, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0)

    // ── Retirar la casa saca todo ─────────────────────────────────────────
    await p.goto('/superadmin/puente-supply')
    await p.getByRole('button', { name: 'Retirar la casa' }).click()
    await expect(p.getByText(/Empresa de la casa retirada/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText(/Todavía no hay empresa de la casa/)).toBeVisible()
    await expect
      .poll(async () => {
        await pub.goto('/catalogo?origen=supply')
        return pub.getByText(B).count()
      }, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBe(0)
    await anonimo.close()

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('quien no es superadmin no entra al panel del puente', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, casa.id)
    await p.goto('/superadmin/puente-supply')
    await expect(p).not.toHaveURL(/\/superadmin\/puente-supply/)
    await expect(p.getByText('Empresa de la casa')).toHaveCount(0)
    await ctx.close()
  })
})
