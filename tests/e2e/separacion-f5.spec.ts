import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE, type RolE2E } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * SEPARACIÓN LANDING · APP — F5: la landing sabe si hay sesión (sin volverse dinámica) y el orden en auth.
 *
 *   · el visitante ve lo de siempre y su navegador NO pregunta por la sesión (cero peticiones extra);
 *   · quien trae sesión ve la puerta a SU espacio (cliente → app; equipo → panel) en barra, héroe, cierre y pie;
 *   · mientras llega la respuesta no hay un «Registrarse» que parpadee delante de quien ya tiene cuenta;
 *   · el HTML y su caché son los mismos para todos: la landing sigue estática;
 *   · /registro vive en el acceso y conserva su consulta; el 404 lleva a la casa de cada quien.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PAGINAS = ['/', '/promociones', '/catalogo', '/faq']
const ENDPOINT = '/api/v1/auth/sesion'

async function conSesion(browser: Browser, rol: RolE2E, companyId: string | null = null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  await entrarComo(ctx, rol, BASE, companyId)
  return { ctx, page: await ctx.newPage() }
}

/** El enlace visible con ese nombre: en móvil la barra de escritorio está oculta y el resto de enlaces sigue ahí. */
const visibles = (page: Page, nombre: string | RegExp) => page.getByRole('link', { name: nombre }).filter({ visible: true })

async function abrirMenuMovil(page: Page) {
  const boton = page.getByRole('button', { name: 'Menú' })
  if (await boton.isVisible()) await boton.click()
}

test.describe('Separación F5 · la landing según quién la mire', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo

  test('siembra: una empresa para el equipo y las cuentas de la prueba', async () => {
    empresa = await empresaCatalogo(sufijo, 'f5', { capacidad: true })
    await asegurarUsuario('separacionCliente2')
    await asegurarUsuario('separacionAdmin', empresa.id)
    await asegurarUsuario('separacionEmpleado', empresa.id)
  })

  test('visitante: ve «Ingresar» y «Registrarse» y su navegador no pregunta por la sesión en ninguna página de la landing', async ({ page }) => {
    const peticiones: string[] = []
    page.on('request', (r) => {
      if (r.url().includes(ENDPOINT)) peticiones.push(r.url())
    })
    for (const ruta of PAGINAS) {
      await page.goto(ruta)
      await page.waitForTimeout(600)
      await abrirMenuMovil(page)
      await expect(visibles(page, 'Ingresar').first(), ruta).toBeVisible()
      await expect(visibles(page, 'Registrarse').first(), ruta).toBeVisible()
      await expect(visibles(page, /Ir a mi app|Ir a mi panel/), ruta).toHaveCount(0)
    }
    expect(peticiones, 'un visitante no debe pagar ninguna petición de sesión').toEqual([])
  })

  test('visitante: la portada trae sus CTA de siempre (crear cuenta, ya tengo cuenta) y el pie ofrece crear cuenta e ingresar', async ({ page }) => {
    await page.goto('/')
    await expect(visibles(page, 'Crear mi cuenta gratis').first()).toBeVisible()
    await expect(visibles(page, 'Ya tengo cuenta')).toBeVisible()
    const pie = page.locator('footer')
    await expect(pie.getByRole('link', { name: 'Crear cuenta' })).toBeVisible()
    await expect(pie.getByRole('link', { name: 'Ingresar' })).toBeVisible()
  })

  test('cliente: la barra, el héroe, el cierre y el pie ofrecen «Ir a mi app», y funciona', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.goto('/')
    await abrirMenuMovil(page)
    await expect(visibles(page, 'Ir a mi app').first()).toBeVisible()
    // Ya no ofrece lo del visitante.
    await expect(visibles(page, 'Registrarse')).toHaveCount(0)
    await expect(visibles(page, 'Ya tengo cuenta')).toHaveCount(0)
    await expect(visibles(page, 'Crear mi cuenta gratis')).toHaveCount(0)
    // Héroe, cierre de la portada y pie: todos son la puerta.
    expect(await page.getByRole('link', { name: 'Ir a mi app' }).count()).toBeGreaterThanOrEqual(3)
    const pie = page.locator('footer')
    await expect(pie.getByRole('link', { name: 'Ir a mi app' })).toHaveAttribute('href', '/cliente/inicio')
    await expect(pie.getByRole('link', { name: 'Crear cuenta' })).toHaveCount(0)
    for (const enlace of await page.getByRole('link', { name: 'Ir a mi app' }).all()) await expect(enlace).toHaveAttribute('href', '/cliente/inicio')
    await visibles(page, 'Ir a mi app').first().click()
    await expect(page).toHaveURL(/\/cliente\/inicio$/)
    await ctx.close()
  })

  test('cliente: en las demás páginas de la landing también tiene su puerta', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    for (const ruta of PAGINAS.slice(1)) {
      await page.goto(ruta)
      await abrirMenuMovil(page)
      await expect(visibles(page, 'Ir a mi app').first(), ruta).toBeVisible()
      await expect(visibles(page, 'Registrarse'), ruta).toHaveCount(0)
    }
    await ctx.close()
  })

  test('administrador y empleado: «Ir a mi panel» en lugar de crear cuenta, y lleva a su espacio', async ({ browser }) => {
    for (const [rol, casa] of [['separacionAdmin', /\/admin\/dashboard$/], ['separacionEmpleado', /\/empleado\/scanner$/]] as const) {
      const { ctx, page } = await conSesion(browser, rol, empresa.id)
      await page.goto('/')
      await abrirMenuMovil(page)
      await expect(visibles(page, 'Ir a mi panel').first(), rol).toBeVisible()
      await expect(visibles(page, /Ir a mi app|Registrarse|Crear mi cuenta gratis/), rol).toHaveCount(0)
      await visibles(page, 'Ir a mi panel').first().click()
      await expect(page, rol).toHaveURL(casa)
      await ctx.close()
    }
  })

  test('sin parpadeo: mientras llega la respuesta de sesión no se ve «Registrarse»; al llegar aparece la puerta', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.route(`**${ENDPOINT}`, async (ruta) => {
      await new Promise((r) => setTimeout(r, 1500))
      await ruta.continue()
    })
    await page.goto('/')
    await abrirMenuMovil(page)
    await page.waitForTimeout(400)
    await expect(visibles(page, 'Registrarse'), 'a quien trae cookie no se le enseña lo del visitante mientras tanto').toHaveCount(0)
    await expect(visibles(page, 'Ir a mi app').first()).toBeVisible({ timeout: 8000 })
    await ctx.close()
  })

  test('al quitar la sesión la landing vuelve a ser la del visitante de inmediato (sin esperar al caché)', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.goto('/')
    await abrirMenuMovil(page)
    await expect(visibles(page, 'Ir a mi app').first()).toBeVisible()
    await ctx.clearCookies()
    await page.goto('/')
    await abrirMenuMovil(page)
    await expect(visibles(page, 'Registrarse').first()).toBeVisible()
    await expect(visibles(page, 'Ir a mi app')).toHaveCount(0)
    await ctx.close()
  })

  test('la landing sigue estática: el servidor sirve lo mismo, y con la misma caché, con y sin sesión', async ({ browser, request }) => {
    const visitante = await request.get('/')
    const { ctx } = await conSesion(browser, 'separacionCliente2')
    const respuestaConSesion = await ctx.request.get(`${BASE}/`)
    expect(visitante.status()).toBe(200)
    expect(respuestaConSesion.status()).toBe(200)
    const cacheV = visitante.headers()['cache-control'] ?? ''
    const cacheC = respuestaConSesion.headers()['cache-control'] ?? ''
    expect(cacheV).toMatch(/s-maxage=/)
    expect(cacheC, 'la caché no depende de la sesión').toBe(cacheV)
    expect(respuestaConSesion.headers()['set-cookie'] ?? '', 'la portada no escribe cookies').toBe(visitante.headers()['set-cookie'] ?? '')
    // El cuerpo no lleva nada de la persona: ni su nombre, ni su correo, ni «Ir a mi app» pintado por el servidor.
    const cuerpo = await respuestaConSesion.text()
    expect(cuerpo).not.toContain('Mario Separación')
    expect(cuerpo).not.toContain('e2e.separacion.cliente2@membego.test')
    expect(cuerpo).toContain('Registrarse')
    await ctx.close()
  })

  test('/registro vive en el acceso: redirige a la empresa o a la cuenta general conservando la consulta', async ({ page }) => {
    // El redirect llega por streaming (200 + salto del cliente): se comprueba donde termina la persona, no el código HTTP.
    await page.goto('/registro?next=%2Fcliente%2Fexcursiones&utm=otono')
    await expect(page).toHaveURL(/\/registro\/[^/?]+\?/)
    const destino = new URL(page.url())
    expect(destino.pathname).not.toBe('/registro')
    expect(destino.searchParams.get('next')).toBe('/cliente/excursiones')
    expect(destino.searchParams.get('utm')).toBe('otono')
    // Sin consulta, igual que siempre: sin signos de más.
    await page.goto('/registro')
    await expect(page).toHaveURL(/\/registro\/[^/?]+$/)
  })

  test('/registro con un destino malicioso: la página carga y el destino se ignora', async ({ page }) => {
    for (const malo of ['//evil.example', 'https://evil.example']) {
      const r = await page.goto(`/registro?next=${encodeURIComponent(malo)}`)
      expect(r?.status(), malo).toBe(200)
      await expect(page, malo).toHaveURL(/\/registro\//)
      expect(new URL(page.url()).origin).toBe(new URL(BASE).origin)
    }
  })

  test('«página no encontrada»: cada quien vuelve a su casa; el visitante, a la portada', async ({ browser, page }) => {
    const ruta = `/esto-no-existe-${sufijo}`
    await page.goto(ruta)
    await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
    for (const [rol, esperado, companyId] of [['separacionCliente2', '/cliente/inicio', null], ['separacionAdmin', '/admin/dashboard', empresa.id], ['separacionEmpleado', '/empleado/scanner', empresa.id]] as const) {
      const { ctx, page: p } = await conSesion(browser, rol, companyId)
      await p.goto(ruta)
      await expect(p.getByRole('link', { name: 'Volver a mi espacio' }), rol).toHaveAttribute('href', esperado)
      await ctx.close()
    }
  })

  test('las excepciones permanentes siguen en pie: borrar la cuenta y la captación de negocios cargan en la landing', async ({ page }) => {
    for (const ruta of ['/eliminar-cuenta', '/registro-empresa', '/solicitud-empresa']) {
      const r = await page.goto(ruta)
      expect(r?.status(), ruta).toBe(200)
    }
  })
})
