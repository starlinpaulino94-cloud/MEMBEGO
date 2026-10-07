import { test, expect } from '@playwright/test'
import { cerrarPrisma, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, type EmpresaCatalogo, type ItemSembrado } from './catalogo-arnes'

/**
 * CATÁLOGO UNIFICADO · lo que ve un VISITANTE (F1.3). Corre en móvil y en
 * escritorio: el 90 % del tráfico es un teléfono.
 *
 * Datos sembrados (no hay UI de por medio): una empresa con la capacidad y
 * ítems en todos los estados, y otra SIN capacidad con un ítem publicado.
 *
 *  · se ve: el servicio simple (precio y «antes» tachado) y el producto con
 *    variantes («Desde» el menor disponible; la agotada marcada; la
 *    descontinuada ausente);
 *  · NO se ve: borrador, pausado, «solo caja», la empresa sin capacidad, ni
 *    el costo ni el SKU en ninguna página.
 *
 * Solo necesita la base (siembra con Prisma); las páginas son públicas.
 */

const sufijo = Date.now().toString(36)

/**
 * Navega y espera a que la página termine de pintarse. Next sirve estas
 * páginas en streaming y, un instante, el contenido existe además en un bloque
 * oculto (`div[hidden][id^="S:"]`) que luego intercambia: ahí un selector ve
 * DOS coincidencias y Playwright falla de inmediato con «strict mode». Esperar
 * a que ese bloque desaparezca evita medir el instante equivocado. Sin
 * `networkidle` (ver docs/PRUEBAS-E2E.md).
 */
async function ir(page: import('@playwright/test').Page, url: string) {
  const r = await page.goto(url)
  // Tope corto y sin fallar: en las páginas «no encontrado» Next deja ese bloque
  // y esperarlo para siempre colgaría la prueba. Las aserciones reintentan solas.
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 3000 }).catch(() => undefined)
  return r
}

const SKU_SECRETO = `SECRETO-SKU-${sufijo}`
const COSTO_SECRETO = '314.15'

test.describe('Catálogo unificado · público', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere DATABASE_URL para sembrar la empresa (y las variables de sesión del E2E)')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let a: EmpresaCatalogo
  let b: EmpresaCatalogo
  let c: EmpresaCatalogo
  const it: Record<string, ItemSembrado> = {}

  test('siembra: empresa con capacidad, sin capacidad y sin publicar', async () => {
    a = await empresaCatalogo(sufijo, 'pub-a', { capacidad: true })
    b = await empresaCatalogo(sufijo, 'pub-b', { capacidad: false })
    c = await empresaCatalogo(sufijo, 'pub-c', { capacidad: true, publicada: false })
    it.lavado = await itemSembrado(a.id, {
      name: `Lavado completo ${sufijo}`, slug: `lavado-${sufijo}`,
      variantes: [{ name: 'Default', sku: SKU_SECRETO, price: 650.5, cost: Number(COSTO_SECRETO), compareAt: 800, porDefecto: true }],
    })
    it.camiseta = await itemSembrado(a.id, {
      name: `Camiseta oficial ${sufijo}`, slug: `camiseta-${sufijo}`,
      variantes: [
        { name: 'M', sku: `CAM-M-${sufijo}`, price: 800, atributos: { talla: 'M' } },
        { name: 'L', sku: `CAM-L-${sufijo}`, price: 850, status: 'OUT_OF_STOCK', atributos: { talla: 'L' } },
        { name: 'XXS vieja', sku: `CAM-X-${sufijo}`, price: 1, status: 'DISCONTINUED' },
      ],
    })
    it.borrador = await itemSembrado(a.id, { name: `Borrador interno ${sufijo}`, slug: `borrador-${sufijo}`, status: 'DRAFT', variantes: [{ name: 'Default', sku: `BOR-${sufijo}`, price: 1, porDefecto: true }] })
    it.pausado = await itemSembrado(a.id, { name: `Pausado ${sufijo}`, slug: `pausado-${sufijo}`, status: 'PAUSED', variantes: [{ name: 'Default', sku: `PAU-${sufijo}`, price: 1, porDefecto: true }] })
    it.soloCaja = await itemSembrado(a.id, { name: `Solo caja ${sufijo}`, slug: `solo-caja-${sufijo}`, marketplace: false, variantes: [{ name: 'Default', sku: `CAJ-${sufijo}`, price: 5, porDefecto: true }] })
    it.deB = await itemSembrado(b.id, { name: `Ítem de B sin capacidad ${sufijo}`, slug: `de-b-${sufijo}`, variantes: [{ name: 'Default', sku: `B-${sufijo}`, price: 9, porDefecto: true }] })
    it.deC = await itemSembrado(c.id, { name: `Ítem de C sin publicar ${sufijo}`, slug: `de-c-${sufijo}`, variantes: [{ name: 'Default', sku: `C-${sufijo}`, price: 9, porDefecto: true }] })
    expect(a.id).not.toBe(b.id)
  })

  test('la vitrina de la empresa muestra lo publicado y nada más', async ({ page }) => {
    const r = await ir(page, `/empresas/${a.slug}`)
    expect(r?.status()).toBe(200)
    const seccion = page.locator('#catalogo')
    await expect(seccion).toBeVisible()
    await expect(seccion.getByText(`Lavado completo ${sufijo}`)).toBeVisible()
    await expect(seccion.getByText(`Camiseta oficial ${sufijo}`)).toBeVisible()
    // «Desde» el menor precio DISPONIBLE (la agotada y la descontinuada no cuentan).
    await expect(seccion.getByText(/Desde\s*RD\$800\.00/)).toBeVisible()
    await expect(seccion.getByText(/RD\$650\.50/)).toBeVisible()
    for (const oculto of ['Borrador interno', 'Pausado', 'Solo caja']) await expect(seccion.getByText(oculto)).toHaveCount(0)
    const html = await page.content()
    for (const secreto of [COSTO_SECRETO, SKU_SECRETO]) expect(html).not.toContain(secreto)
  })

  test('el detalle: variantes con su precio, agotada marcada, descontinuada ausente, «antes» tachado', async ({ page }) => {
    await ir(page, `/empresas/${a.slug}/catalogo/${it.camiseta.slug}`)
    await expect(page.getByRole('heading', { level: 1, name: `Camiseta oficial ${sufijo}` })).toBeVisible()
    await expect(page.getByText('Opciones')).toBeVisible()
    await expect(page.getByText(/RD\$800\.00/)).toBeVisible()
    await expect(page.getByText(/RD\$850\.00/)).toBeVisible()
    await expect(page.getByText('Agotado')).toBeVisible()
    await expect(page.getByText('XXS vieja')).toHaveCount(0)
    expect(await page.content()).not.toContain(`CAM-M-${sufijo}`)

    await ir(page, `/empresas/${a.slug}/catalogo/${it.lavado.slug}`)
    await expect(page.getByText('Precio', { exact: true })).toBeVisible()
    await expect(page.getByText('Opciones')).toHaveCount(0)
    await expect(page.locator('.line-through')).toHaveCount(1)
    const html = await page.content()
    for (const secreto of [COSTO_SECRETO, SKU_SECRETO]) expect(html).not.toContain(secreto)
  })

  test('lo que NO es público se ve como «no encontrado»', async ({ page }) => {
    const casos: [string, string][] = [
      ['borrador', `/empresas/${a.slug}/catalogo/${it.borrador.slug}`],
      ['pausado', `/empresas/${a.slug}/catalogo/${it.pausado.slug}`],
      ['solo caja', `/empresas/${a.slug}/catalogo/${it.soloCaja.slug}`],
      ['empresa sin capacidad', `/empresas/${b.slug}/catalogo/${it.deB.slug}`],
      ['empresa sin publicar', `/empresas/${c.slug}/catalogo/${it.deC.slug}`],
      ['empresa equivocada', `/empresas/${b.slug}/catalogo/${it.lavado.slug}`],
      ['inexistente', `/empresas/${a.slug}/catalogo/no-existe`],
    ]
    const firmas = new Set<string>()
    for (const [nombre, url] of casos) {
      await ir(page, url)
      await expect(page.locator('meta[name=robots][content*=noindex]'), nombre).not.toHaveCount(0)
      const texto = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      expect(texto, nombre).not.toMatch(/Borrador interno|Pausado \w|Solo caja|Ítem de B|Ítem de C|Lavado completo|Camiseta/)
      firmas.add(texto)
    }
    // Todas se ven EXACTAMENTE igual: no se puede averiguar qué hay detrás.
    expect(firmas.size).toBe(1)
  })

  test('la vitrina de una empresa sin capacidad no tiene sección de catálogo', async ({ page }) => {
    await ir(page, `/empresas/${b.slug}`)
    await expect(page.locator('#catalogo')).toHaveCount(0)
    await expect(page.getByText(/Ítem de B/)).toHaveCount(0)
  })

  test('/catalogo: lista lo publicado de las empresas con capacidad, busca y pagina sin romperse', async ({ page }) => {
    // La lista del marketplace se cachea 120 s POR combinación de filtros y la
    // invalida el panel al mutar. Esta siembra entra por Prisma (sin pasar por
    // el panel), así que se busca por el sufijo único de la corrida: otra
    // combinación de filtros, otra entrada de caché, siempre fresca. Que el
    // panel SÍ invalida la lista sin filtros lo prueba `catalogo-admin.spec.ts`.
    const estructura = await ir(page, '/catalogo')
    expect(estructura?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Productos y servicios' })).toBeVisible()

    // Sin `networkidle`: con el build de CI el cliente de auth reintenta sin
    // parar contra un Supabase que no existe y la red nunca queda en reposo.
    const r = await ir(page, `/catalogo?q=${sufijo}`)
    expect(r?.status()).toBe(200)
    // El contenido existe UNA vez. `toHaveCount` reintenta: durante el
    // streaming hay un instante con una copia oculta que desaparece sola; si
    // esto no converge a 1, el duplicado es real y es un defecto del producto.
    await expect(page.locator('input[name=q]')).toHaveCount(1)
    // Por ROL y no por texto: esta página se sirve en streaming y, un instante,
    // el contenido existe también en un bloque oculto que `getByText` cuenta
    // (dos coincidencias) y `getByRole` no.
    await expect(page.getByRole('heading', { name: `Lavado completo ${sufijo}` })).toBeVisible()
    await expect(page.getByRole('heading', { name: `Camiseta oficial ${sufijo}` })).toBeVisible()
    for (const oculto of ['Borrador interno', 'Pausado', 'Solo caja', 'Ítem de B', 'Ítem de C']) await expect(page.getByText(oculto)).toHaveCount(0)

    await page.getByLabel('Buscar productos y servicios').fill(`camiseta oficial ${sufijo}`)
    await page.getByRole('button', { name: 'Buscar' }).click()
    await page.waitForURL(/q=/)
    await expect(page.getByRole('heading', { name: `Camiseta oficial ${sufijo}` })).toBeVisible()
    await expect(page.getByRole('heading', { name: `Lavado completo ${sufijo}` })).toHaveCount(0)

    await ir(page, '/catalogo?q=zzzz-nada-que-coincida')
    // Primero que la página termine de pintarse (un solo buscador), luego el texto.
    await expect(page.locator('input[name=q]')).toHaveCount(1)
    await expect(page.getByText('Nada coincide con tu búsqueda')).toBeVisible()
    await ir(page, `/catalogo?q=${encodeURIComponent('<script>alert(1)</script>')}&pagina=-9`)
    await expect(page.getByRole('heading', { name: 'Productos y servicios' })).toBeVisible()
  })

  test('sin desbordes horizontales (importa sobre todo en móvil) y sin errores de consola', async ({ page }) => {
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    for (const url of [`/empresas/${a.slug}`, `/empresas/${a.slug}/catalogo/${it.camiseta.slug}`, '/catalogo']) {
      await ir(page, url)
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(sw, `${url} desborda: ${sw} > ${cw}`).toBeLessThanOrEqual(cw)
    }
    expect(errores, errores.join('\n')).toEqual([])
  })
})
