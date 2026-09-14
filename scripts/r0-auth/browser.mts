import { chromium, errors, type BrowserContext } from '@playwright/test'
import { createServerClient } from '@supabase/ssr'
import { join } from 'node:path'
import { RunFixtures, VerificationFailure } from './fixtures.mjs'

export async function verifyBrowser(fixtures: RunFixtures, env: Readonly<Record<string, string>>, folder: string) {
  const checks: { readonly name: string; readonly status: 'PASS' | 'FAIL'; readonly http: number }[] = []
  const baseURL = env.E2E_BASE_URL
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!baseURL || !url || !anon) throw new VerificationFailure('BROWSER_CONFIGURATION_REQUIRED')
  const browser = await chromium.launch({ headless: true, timeout: 30_000 })
  const viewport = { width: 1280, height: 900 }
  const runtime = { viewport, deviceScaleFactor: 1, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' }
  const captures: string[] = []
  let denialObservation: { readonly globalNotFound: boolean; readonly panelNotFound: boolean;
    readonly foreignContent: boolean; readonly degraded: boolean } | null = null
  try {
    const anonymous = await browser.newContext({ ...runtime, baseURL })
    // Given no cookies / When requesting a protected route / Then login redirect.
    const response = await anonymous.request.get('/admin/clientes', { maxRedirects: 0, timeout: 180_000 })
    checks.push({ name: 'anonymous-login-redirect', http: response.status(),
      status: response.status() === 307 && response.headers().location?.includes('/login') ? 'PASS' : 'FAIL' })
    for (const account of fixtures.accounts) {
      const context: BrowserContext = await browser.newContext({ ...runtime, baseURL })
      const jar: { name: string; value: string }[] = []
      const client = createServerClient(url, anon, {
        auth: { autoRefreshToken: false },
        global: { fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
        cookies: { getAll: () => jar, setAll: (cookies: readonly { readonly name: string; readonly value: string }[]) => { jar.splice(0, jar.length,
          ...cookies.map(({ name, value }) => ({ name, value }))) } },
      })
      const session = await client.auth.signInWithPassword({ email: account.email, password: fixtures.password })
      if (session.error) throw new VerificationFailure('AUTH_SIGNIN_FAILED')
      await context.addCookies(jar.filter(({ value }) => value).map((cookie) => ({ ...cookie, url: baseURL, sameSite: 'Lax' })))
      switch (account.role) {
        case 'ADMIN_EMPRESA': {
          const page = await context.newPage()
          await page.route('**/*', (route) => new URL(route.request().url()).origin === baseURL
            ? route.continue() : route.abort())
          // Given admin A / When opening own client / Then fixture content is visible.
          const own = await page.goto(`/admin/clientes/${fixtures.clientA}`, { timeout: 180_000 })
          const visible = await page.getByText(`R0 cliente A ${fixtures.suffix}`, { exact: true }).first()
            .isVisible()
          checks.push({ name: 'admin-own-client-allowed', http: own?.status() ?? 0,
            status: own?.status() === 200 && visible ? 'PASS' : 'FAIL' })
          if (visible) {
            await page.evaluate(() => document.fonts.ready.then(() => undefined))
            await page.screenshot({ path: join(folder, 'admin-own-client-1280.png'), animations: 'disabled' })
            captures.push('admin-own-client-1280.png')
          }
          // Given admin A / When opening client B / Then real not-found and no B content.
          const other = await page.goto(`/admin/clientes/${fixtures.clientB}`, { timeout: 180_000 })
          try {
            await page.getByRole('heading', { name: 'No encontramos esta página' }).waitFor({ timeout: 15_000 })
          } catch (error) {
            if (!(error instanceof errors.TimeoutError)) throw error
          }
          const denied = await page.getByRole('heading', { name: 'No encontramos esta página' }).isVisible()
          const exposed = await page.getByText(`R0 cliente B ${fixtures.suffix}`, { exact: true }).count()
          denialObservation = {
            globalNotFound: await page.getByRole('heading', { name: 'Página no encontrada' }).isVisible(),
            panelNotFound: denied, foreignContent: exposed > 0,
            degraded: await page.getByText(/No pudimos cargar este cliente/).isVisible(),
          }
          checks.push({ name: 'company-b-client-denied', http: other?.status() ?? 0,
            status: denied && exposed === 0 ? 'PASS' : 'FAIL' })
          if (denied) {
            await page.screenshot({ path: join(folder, 'company-b-denied-1280.png'), animations: 'disabled' })
            captures.push('company-b-denied-1280.png')
          } else {
            const text = await page.locator('body').innerText()
            const secrets = [fixtures.password, ...Object.values(env), ...jar.map(({ value }) => value),
              new URL(env.DIRECT_URL ?? '').password].filter((value) => value.length > 8)
            if (!secrets.some((value) => text.includes(value))) {
              await page.screenshot({ path: join(folder, 'company-b-observed-1280.png'), animations: 'disabled',
                mask: [page.locator('nextjs-portal'), page.locator('input[type=password]'), page.locator('pre')] })
              captures.push('company-b-observed-1280.png')
            }
          }
          break
        }
        case 'CLIENTE': {
          // Given client role / When requesting admin / Then role home, without following it.
          const denied = await context.request.get('/admin/clientes', { maxRedirects: 0, timeout: 60_000 })
          checks.push({ name: 'client-admin-role-denied', http: denied.status(),
            status: denied.status() === 307 && denied.headers().location?.endsWith('/cliente/inicio') ? 'PASS' : 'FAIL' })
          break
        }
        case 'MARKETING': {
          // Given restricted staff / When requesting employees / Then dashboard redirect.
          const denied = await context.request.get('/admin/empleados', { maxRedirects: 0, timeout: 60_000 })
          checks.push({ name: 'marketing-employees-section-denied', http: denied.status(),
            status: denied.status() === 307 && denied.headers().location?.endsWith('/admin/dashboard') ? 'PASS' : 'FAIL' })
          break
        }
        default: { const unreachable: never = account.role; throw new VerificationFailure(unreachable) }
      }
      await context.close()
    }
    return { status: checks.every(({ status }) => status === 'PASS') && checks.length === 5 ? 'PASS' : 'FAIL',
      checks, captures, runtime, denialObservation, browserVersion: browser.version() }
  } catch (error) {
    return { status: 'BLOCKED', code: error instanceof VerificationFailure ? error.code : 'BROWSER_CHECK_UNAVAILABLE',
      checks, captures, runtime, denialObservation, browserVersion: browser.version() }
  } finally {
    await browser.close()
  }
}
