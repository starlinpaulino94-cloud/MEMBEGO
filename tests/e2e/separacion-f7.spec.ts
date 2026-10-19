import { execFileSync } from 'node:child_process'
import { request as http } from 'node:http'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, cookieDeSesion, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'

/**
 * SEPARACIÓN LANDING · APP — F7: el corte físico `membego.com` / `app.membego.com`.
 *
 * Se corre con `bun run e2e:dos-anfitriones`: un build de producción con las variables del corte puestas y un Chromium
 * que resuelve los dos dominios de prueba a este equipo. Con el build normal (un solo dominio) estas pruebas se saltan.
 *
 *   · cada ruta responde en SU host y la del otro redirige (307) con ruta y consulta intactas;
 *   · `/api` responde en los dos (la app móvil y la sesión ligera de la landing);
 *   · la app no se indexa (X-Robots-Tag + robots.txt) y la landing sí, con sus canónicos y su sitemap en la landing;
 *   · los CTA de la landing llevan al host de la app, y el visitante no provoca ninguna petición a la sesión;
 *   · la cookie de sesión y la de canal se comparten entre los dos hosts (`.membego.test`);
 *   · quien trae sesión ve en la landing la puerta a la app, y funciona entre dominios.
 */

const LANDING = process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://membego.test:3210'
const APP = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://app.membego.test:3210'
const ACTIVO = process.env.E2E_DOS_ANFITRIONES === '1'


interface Respuesta {
  status: () => number
  headers: () => Record<string, string>
  text: () => Promise<string>
}

/**
 * Petición HTTP cruda al servidor local con el `Host` del anfitrión pedido. El `request` de Playwright resuelve con el DNS
 * de Node (los dominios de prueba solo los conoce el Chromium, por `--host-resolver-rules`), así que aquí se conecta a
 * 127.0.0.1 y se fija el `Host` a mano: es justo lo que el proxy lee. Nunca sigue redirecciones.
 */
function pedir(url: string, opciones: { method?: string; headers?: Record<string, string>; data?: unknown } = {}): Promise<Respuesta> {
  const destino = new URL(url)
  return new Promise((resolver, rechazar) => {
    const cuerpo = opciones.data === undefined ? undefined : JSON.stringify(opciones.data)
    const req = http(
      {
        host: '127.0.0.1',
        port: Number(destino.port || 80),
        path: destino.pathname + destino.search,
        method: opciones.method ?? 'GET',
        headers: { host: destino.host, 'user-agent': 'e2e-f7', ...(cuerpo ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(cuerpo)) } : {}), ...opciones.headers },
      },
      (res) => {
        const partes: Buffer[] = []
        res.on('data', (d: Buffer) => partes.push(d))
        res.on('end', () => {
          const cabeceras: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) cabeceras[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
          resolver({ status: () => res.statusCode ?? 0, headers: () => cabeceras, text: async () => Buffer.concat(partes).toString('utf8') })
        })
      }
    )
    req.on('error', rechazar)
    if (cuerpo) req.write(cuerpo)
    req.end()
  })
}

const visibles = (page: Page, nombre: string | RegExp) => page.getByRole('link', { name: nombre }).filter({ visible: true })

async function abrirMenuMovil(page: Page) {
  const boton = page.getByRole('button', { name: 'Menú' })
  if (await boton.isVisible()) await boton.click()
}

async function conSesion(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  const u = await asegurarUsuario('separacionCliente2')
  const c = await cookieDeSesion(u)
  // Una sola cookie, en el dominio compartido, legible por el navegador como en producción.
  await ctx.addCookies([{ ...c, domain: '.membego.test', path: '/', httpOnly: false, sameSite: 'Lax' }])
  return { ctx, page: await ctx.newPage() }
}

test.describe('Separación F7 · dos anfitriones', () => {
  test.beforeEach(() => {
    test.skip(!ACTIVO, 'requiere el build de dos anfitriones: bun run e2e:dos-anfitriones')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  test('la landing sirve lo suyo y manda lo de la app a la app, con ruta y consulta intactas (307)', async () => {
    expect((await pedir(`${LANDING}/`)).status()).toBe(200)
    for (const ruta of ['/promociones', '/empresas', '/faq', '/catalogo']) {
      expect((await pedir(`${LANDING}${ruta}`)).status(), ruta).toBe(200)
    }
    for (const [ruta, esperado] of [
      ['/login', '/login'],
      ['/login?redirect=%2Fcliente%2Finicio', '/login?redirect=%2Fcliente%2Finicio'],
      ['/registro/cuenta?ref=ABC', '/registro/cuenta?ref=ABC'],
      ['/cliente/explorar?ver=ofertas&q=aire', '/cliente/explorar?ver=ofertas&q=aire'],
      ['/admin/dashboard', '/admin/dashboard'],
    ]) {
      const r = await pedir(`${LANDING}${ruta}`)
      expect(r.status(), ruta).toBe(307)
      expect(r.headers().location, ruta).toBe(`${APP}${esperado}`)
    }
  })

  test('la app sirve lo suyo, manda lo público a la landing y su portada va al acceso', async () => {
    expect((await pedir(`${APP}/login`)).status()).toBe(200)
    const portada = await pedir(`${APP}/`)
    expect(portada.status()).toBe(307)
    expect(portada.headers().location).toBe(`${APP}/login`)
    for (const ruta of ['/promociones', '/empresas?q=spa', '/e/algo', '/r/ABC123', '/i/XYZ', '/faq']) {
      const r = await pedir(`${APP}${ruta}`)
      expect(r.status(), ruta).toBe(307)
      expect(r.headers().location, ruta).toBe(`${LANDING}${ruta}`)
    }
  })

  test('/api responde en los dos anfitriones sin redirigir y un POST no se desvía', async () => {
    for (const origen of [LANDING, APP]) {
      const r = await pedir(`${origen}/api/health/live`)
      expect(r.status(), origen).toBe(200)
      const sesion = await pedir(`${origen}/api/v1/auth/sesion`)
      expect(sesion.status(), origen).toBe(200)
    }
    // Un POST al host equivocado no se redirige a ciegas (una acción de servidor no se desvía).
    const post = await pedir(`${LANDING}/login`, { method: 'POST', data: {} })
    expect(post.status()).not.toBe(307)
  })

  test('no hay redirección abierta: el Host de la petición nunca decide el destino', async () => {
    const r = await pedir(`${LANDING}/login`, { headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } })
    expect(r.status()).toBe(307)
    expect(r.headers().location).toBe(`${APP}/login`)
    const doble = await pedir(`${LANDING}//evil.example/login`)
    // Next normaliza `//x` a `/x` (relativo al mismo host): lo que importa es que, resuelto, nunca salga de los dos hosts.
    const destino = new URL(doble.headers().location ?? '/', LANDING)
    expect([new URL(LANDING).host, new URL(APP).host]).toContain(destino.host)
  })

  test('SEO: la app no se indexa, la landing sí, y el canónico y el sitemap son los de la landing', async () => {
    const app = await pedir(`${APP}/login`)
    expect(app.headers()['x-robots-tag']).toMatch(/noindex/)
    const landing = await pedir(`${LANDING}/`)
    expect(landing.headers()['x-robots-tag'] ?? '').not.toMatch(/noindex/)

    const robotsApp = await (await pedir(`${APP}/robots.txt`)).text()
    expect(robotsApp).toMatch(/Disallow:\s*\//)
    const robotsLanding = await (await pedir(`${LANDING}/robots.txt`)).text()
    expect(robotsLanding).not.toMatch(/Disallow:\s*\/\s*$/m)
    expect(robotsLanding).toContain(`${LANDING}/sitemap.xml`)

    const html = await (await pedir(`${LANDING}/`)).text()
    expect(html).toContain(`rel="canonical" href="${LANDING}`)
    const sitemap = await (await pedir(`${LANDING}/sitemap.xml`)).text()
    expect(sitemap).toContain(`<loc>${LANDING}`)
    expect(sitemap).not.toContain(APP)
  })

  test('visitante: los CTA de la landing apuntan al host de la app, no preguntan por la sesión y llevan al acceso', async ({ page }) => {
    const peticiones: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/sesion')) peticiones.push(r.url())
    })
    await page.goto(`${LANDING}/`)
    await page.waitForTimeout(600)
    await abrirMenuMovil(page)
    await expect(visibles(page, 'Ingresar').first()).toHaveAttribute('href', `${APP}/login`)
    await expect(visibles(page, 'Registrarse').first()).toHaveAttribute('href', `${APP}/registro/cuenta`)
    expect(peticiones, 'el visitante no provoca ninguna consulta de sesión').toEqual([])

    await visibles(page, 'Ingresar').first().click()
    await page.waitForURL(`${APP}/login`)
    expect(new URL(page.url()).host).toBe(new URL(APP).host)
  })

  test('el pie y el héroe de la landing tampoco dejan enlaces relativos hacia la app', async ({ page }) => {
    await page.goto(`${LANDING}/`)
    const relativos = await page.$$eval('a[href]', (as) =>
      as
        .map((a) => a.getAttribute('href') ?? '')
        .filter((h) => /^\/(login|registro|cliente|admin|superadmin|empleado|vendedor|acceso|mis-membresias|membresia)(\/|\?|$)/.test(h))
    )
    expect(relativos).toEqual([])
  })

  test('la cookie de canal se siembra en el dominio compartido y la app la ve', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${LANDING}/?src=facebook`)
    const enApp = await ctx.cookies(`${APP}/registro`)
    const canal = enApp.find((c) => c.name === 'mg_canal')
    expect(canal?.value).toBe('facebook')
    expect(canal?.domain).toBe('.membego.test')
    await ctx.close()
  })

  test('cliente con sesión: la landing le ofrece «Ir a mi app» y lo lleva a la app sin volver a iniciar sesión', async ({ browser }) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
    const { ctx, page } = await conSesion(browser)
    await page.goto(`${LANDING}/`)
    await abrirMenuMovil(page)
    const puerta = visibles(page, 'Ir a mi app').first()
    await expect(puerta).toBeVisible({ timeout: 8000 })
    await expect(puerta).toHaveAttribute('href', new RegExp(`^${APP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cliente`))
    await puerta.click()
    await page.waitForURL(new RegExp(`^${APP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cliente`))
    expect(new URL(page.url()).pathname).not.toMatch(/^\/login/)
    await ctx.close()
  })

  test('con sesión, /login en la app lleva a su espacio; en la landing, /login pasa por la app', async ({ browser }) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
    const { ctx, page } = await conSesion(browser)
    await page.goto(`${LANDING}/login`)
    await page.waitForURL(new RegExp(`^${APP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cliente`))
    await ctx.close()
  })

  // ── F8 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

  test('F8 · la sesión host-only de antes del corte se borra una vez, y la compartida y la sesión sobreviven', async ({ browser }) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
    const ctx = await browser.newContext()
    const u = await asegurarUsuario('separacionCliente2')
    const c = await cookieDeSesion(u)
    // La compartida (la de después del corte) y, con el MISMO nombre, la vieja host-only de membego.test, más un trozo suelto.
    await ctx.addCookies([
      { ...c, domain: '.membego.test', path: '/', httpOnly: false, sameSite: 'Lax' },
      { name: c.name, value: 'sesion-heredada', url: LANDING, httpOnly: false, sameSite: 'Lax' },
      { name: `${c.name}.1`, value: 'trozo-heredado', url: LANDING, httpOnly: false, sameSite: 'Lax' },
    ])
    const delSitio = async () => (await ctx.cookies(LANDING)).filter((k) => k.name.startsWith('sb-'))
    expect((await delSitio()).filter((k) => !k.domain.startsWith('.')).map((k) => k.name).sort(), 'parten con las dos viejas host-only').toEqual([c.name, `${c.name}.1`].sort())

    const page = await ctx.newPage()
    await page.goto(`${LANDING}/`)
    await page.waitForTimeout(800)
    const despues = await delSitio()
    expect(despues.filter((k) => !k.domain.startsWith('.')), 'las host-only se borraron').toEqual([])
    expect(despues.filter((k) => k.domain === '.membego.test').map((k) => k.name), 'la compartida sigue').toEqual([c.name])
    expect((await ctx.cookies(LANDING)).find((k) => k.name === 'mg_cd'), 'marcador host-only').toBeTruthy()
    await abrirMenuMovil(page)
    await expect(visibles(page, 'Ir a mi app').first()).toBeVisible({ timeout: 8000 })

    // Una segunda visita no vuelve a tocar nada.
    const respuesta = await page.goto(`${LANDING}/promociones`)
    expect(await respuesta!.headerValues('set-cookie')).toEqual([])
    await ctx.close()
  })

  test('F8 · solo con la sesión vieja host-only: se borra y la landing vuelve a ser la del visitante', async ({ browser }) => {
    const ctx = await browser.newContext()
    await ctx.addCookies([{ name: 'sb-viejo-auth-token', value: 'x', url: LANDING, httpOnly: false, sameSite: 'Lax' }])
    const page = await ctx.newPage()
    await page.goto(`${LANDING}/`)
    await page.waitForTimeout(800)
    expect((await ctx.cookies(LANDING)).filter((k) => k.name.startsWith('sb-'))).toEqual([])
    await ctx.close()
  })

  test('F8 · el verificador del corte da por bueno el despliegue de dos anfitriones y falla si se le dan los hosts al revés', () => {
    const correr = (...args: string[]) => {
      try {
        const salida = execFileSync('npx', ['tsx', 'scripts/corte/verificar.ts', ...args, '--via', '127.0.0.1:3210'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        return { codigo: 0, salida }
      } catch (e) {
        const err = e as { status?: number; stdout?: string }
        return { codigo: err.status ?? 1, salida: err.stdout ?? '' }
      }
    }
    const bien = correr(LANDING, APP, '--cookie-domain', '.membego.test')
    expect(bien.codigo, bien.salida).toBe(0)
    expect(bien.salida).toMatch(/0 mal/)
    const mal = correr(APP, LANDING, '--cookie-domain', '.membego.test')
    expect(mal.codigo).toBe(1)
  })
})
