import { test, expect, type BrowserContext } from '@playwright/test'
import fs from 'node:fs'

/**
 * CATÁLOGO DE EXCURSIONES · EL DETALLE EXISTE
 *
 * Los 7 enlaces de excursión que sirve `/cliente/excursiones` deben abrir el
 * detalle público (`/empresas/<empresa>/excursiones/<excursión>`).
 *
 * Antes del arreglo el módulo de esa ruta NO COMPILABA y Next degradaba la ruta
 * entera a `_not-found`: los 7 enlaces devolvían 404 aunque la fila existiera.
 * El servidor no registra nada, `notFound()` no llega a Sentry y la pantalla se
 * ve perfecta, así que un catálogo de 404 es un fallo silencioso. Esta prueba es
 * la red que lo caza.
 *
 * ── POR QUÉ RECORRE EL DOM Y NO UNA LISTA DE SLUGS ──────────────────────────
 * El catálogo lo gobiernan los datos. Una lista de slugs escrita a mano se
 * pudre al primer cambio de seed y deja de proteger. La prueba deriva los
 * destinos REALES de la pantalla y afirma cada uno.
 *
 * ── SESIÓN ──────────────────────────────────────────────────────────────────
 * `/cliente/excursiones` pide sesión; el detalle es público. Se inyecta UNA vez
 * la cookie de Supabase (sin pasar por el formulario: el limitador de login es
 * 5 intentos / 15 min por IP y correo). Misma receta que cliente-flujos.spec.ts.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'

const DETALLE = /^\/empresas\/[^/]+\/excursiones\/[^/]+$/

type CookieSesion = {
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'Lax'
}

let cookies: CookieSesion[] | null = null
let motivoSkip: string | null = null

function deEnv(clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave]
  try {
    const txt = fs.readFileSync('.env', 'utf8')
    const m = txt.match(new RegExp(`^${clave}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'))
    return m?.[1]
  } catch {
    return undefined
  }
}

/** Token directo a Supabase + cookie de @supabase/ssr (base64url, trozos de 3180). */
async function obtenerCookiesSesion(): Promise<CookieSesion[] | null> {
  const supa = deEnv('E2E_SUPABASE_URL') ?? deEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anon = deEnv('E2E_SUPABASE_ANON_KEY') ?? deEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!supa || !anon) return null

  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch(() => null)
  if (!r?.ok) return null

  const s = (await r.json()) as Record<string, unknown>
  s.expires_at = Math.floor(Date.now() / 1000) + Number(s.expires_in ?? 3600)
  const valor = 'base64-' + Buffer.from(JSON.stringify(s), 'utf8').toString('base64url')

  const ref = new URL(supa).hostname.split('.')[0]
  const nombre = `sb-${ref}-auth-token`
  const MAX = 3180
  const partes: { name: string; value: string }[] = []
  if (valor.length <= MAX) partes.push({ name: nombre, value: valor })
  else
    for (let i = 0; i * MAX < valor.length; i++)
      partes.push({ name: `${nombre}.${i}`, value: valor.slice(i * MAX, (i + 1) * MAX) })

  const dominio = new URL(BASE).hostname
  return partes.map((p) => ({
    ...p,
    domain: dominio,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }))
}

test.beforeAll(async () => {
  cookies = await obtenerCookiesSesion()
  if (!cookies) motivoSkip = 'sin Supabase de pruebas: no se pudo crear sesión de cliente'
})

// Viewport lg: el dock inferior móvil es `lg:hidden`. No hace falta aquí, pero
// mantiene el catálogo en su layout de escritorio, igual que el resto de specs.
test.use({ viewport: { width: 1280, height: 1100 } })

test.beforeEach(async ({ context }: { context: BrowserContext }) => {
  test.skip(Boolean(motivoSkip), motivoSkip ?? '')
  test.setTimeout(120_000)
  await context.addCookies(cookies!)
})

/** Los destinos de detalle que el catálogo sirve HOY, sin duplicados. */
async function enlacesDeDetalle(page: import('@playwright/test').Page): Promise<string[]> {
  await page.goto('/cliente/excursiones', { waitUntil: 'domcontentloaded' })
  const hrefs = await page
    .locator('a[href*="/excursiones/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
  return [...new Set(hrefs.filter((h) => DETALLE.test(h)))]
}

test('los enlaces de excursión del catálogo responden 200 (no 404)', async ({ page, context }) => {
  const hrefs = await enlacesDeDetalle(page)
  expect(hrefs.length, 'el catálogo debe ofrecer enlaces de detalle').toBeGreaterThan(0)

  for (const href of hrefs) {
    const r = await context.request.get(`${BASE}${href}`)
    const html = await r.text()

    expect(r.status(), `${href} debe responder 200`).toBe(200)
    // Un 200 a secas no basta: la página "no encontrada" de Next también llega
    // como 200 (soft-404). La excursión real trae su raíl de reserva y NO lleva
    // el `noindex` que Next inyecta cuando no encontró el recurso.
    expect(html, `${href} debe ser el detalle real, no la página "no encontrada"`).toContain(
      'seccion-reserva'
    )
    expect(html, `${href} no debe ser un soft-404`).not.toContain('content="noindex"')
  }
})

test('una excursión inexistente no se sirve como página real', async ({ page, context }) => {
  const hrefs = await enlacesDeDetalle(page)
  expect(hrefs.length).toBeGreaterThan(0)

  const empresa = hrefs[0].split('/')[2]
  const inexistente = `/empresas/${empresa}/excursiones/zzz-no-existe-${Date.now()}`

  const r = await context.request.get(`${BASE}${inexistente}`)
  const html = await r.text()

  // Next no puede cambiar el status una vez que el `loading.tsx` de `(public)`
  // abrió el streaming: el recurso ausente llega como 200 + `<meta noindex>`
  // (soft-404 documentado). Lo que NUNCA puede pasar es que una excursión
  // inexistente se sirva como el detalle real; ahí está la regresión.
  expect(html, 'la excursión inexistente debe llevar el noindex del soft-404').toContain(
    'content="noindex"'
  )
  expect(html, 'la excursión inexistente no debe renderizar el detalle').not.toContain(
    'seccion-reserva'
  )
  expect(r.status(), 'una excursión inexistente nunca puede ser un 500').toBeLessThan(500)
})
