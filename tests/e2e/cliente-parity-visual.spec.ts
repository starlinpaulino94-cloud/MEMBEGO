import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * VISUAL SMOKE — CLIENT PARITY (Todo 9)
 *
 * Single test: login once, then iterate viewports × routes in one context
 * so the session persists. Captures screenshots + console per route.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const RN_BASE_URL = process.env.E2E_RN_BASE_URL ?? 'http://localhost:8081'
const RUN_RN_E2E = process.env.E2E_RUN_RN === '1'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'
const SHOT_DIR = path.resolve('.omo/evidence/qa')

const PARITY_MANIFEST = JSON.parse(
  fs.readFileSync(path.resolve('docs/design/client-parity-manifest.json'), 'utf8'),
) as {
  webRoutes: Array<{ webPath: string; family: string; auth: string }>
}

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const RN_VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'tablet-wide', width: 820, height: 1024 },
  { name: 'tablet-max', width: 1023, height: 900 },
  { name: 'desktop-min', width: 1024, height: 900 },
  { name: 'desktop', width: 1440, height: 900 },
]

const DYNAMIC_ROUTE_VALUES: Record<string, string> = {
  companySlug: 'tonis-restaurante',
  id: 'demo',
  invitadoId: 'demo',
  membresiaId: 'demo',
  planId: 'cmt90uf5i00bbuikw56fq8sgi',
  reservaId: 'demo',
}

function materializeRoute(pathname: string): string {
  return pathname.replace(/\[([^\]]+)\]/g, (_, key: string) => DYNAMIC_ROUTE_VALUES[key] ?? 'demo')
}

const ROUTES = PARITY_MANIFEST.webRoutes.map((route) => ({
  family: route.family,
  path: materializeRoute(route.webPath),
  auth: route.auth === 'client-authenticated',
}))

test('client parity visual smoke', async ({ }) => {
  test.setTimeout(300_000)
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  // Launch Edge explicitly; fall back to bundled Chromium if Edge unavailable
  const { chromium } = await import('@playwright/test')
  let browser
  let engineUsed: string
  try {
    browser = await chromium.launch({ channel: 'msedge' })
    engineUsed = 'msedge'
  } catch {
    browser = await chromium.launch()
    engineUsed = 'chromium'
  }
  const results: Array<{
    route: string
    viewport: string
    auth: string
    file: string
    consoleCount: number
    redirected: boolean
    finalUrl: string
  }> = []

  const context = await browser.newContext()
  const page = await context.newPage()

  let loginSucceeded = false
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')

  const emailInput = page.locator('input[type="email"], input[name="email"]')
  if ((await emailInput.count()) > 0) {
    await emailInput.fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    try {
      await page.waitForURL('**/cliente/**', { timeout: 10_000 })
      loginSucceeded = true
    } catch {
      // Login failed — continue with unauthenticated states only
    }
  }

  // Authenticated routes
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const route of ROUTES.filter((r) => r.auth)) {
      if (!loginSucceeded) continue

      const consoleMessages: string[] = []
      const handler = (msg: { type: () => string; text: () => string }) => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
      }
      page.on('console', handler)

      const safePath = route.path.replace(/\//g, '_').replace(/^_/, '') || 'root'
      const filename = `${route.family}__${safePath}__${viewport.name}__auth.png`
      const shotPath = path.join(SHOT_DIR, filename)

      await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle' })
      const finalUrl = page.url()
      const redirected = finalUrl !== `${BASE_URL}${route.path}`

      await page.screenshot({ path: shotPath, fullPage: false })
      fs.writeFileSync(shotPath.replace('.png', '.console.txt'), consoleMessages.join('\n'))

      page.removeListener('console', handler)

      results.push({
        route: route.path,
        viewport: viewport.name,
        auth: 'auth',
        file: filename,
        consoleCount: consoleMessages.length,
        redirected,
        finalUrl,
      })
    }
  }

  await context.close()

  // Unauthenticated routes — fresh context, no cookies
  const unauthContext = await browser.newContext()
  const unauthPage = await unauthContext.newPage()

  for (const viewport of VIEWPORTS) {
    await unauthPage.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const route of ROUTES.filter((r) => !r.auth)) {
      const consoleMessages: string[] = []
      const handler = (msg: { type: () => string; text: () => string }) => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
      }
      unauthPage.on('console', handler)

      const safePath = route.path.replace(/\//g, '_').replace(/^_/, '') || 'root'
      const filename = `${route.family}__${safePath}__${viewport.name}__unauth.png`
      const shotPath = path.join(SHOT_DIR, filename)

      await unauthPage.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle' })
      const finalUrl = unauthPage.url()
      const redirected = finalUrl !== `${BASE_URL}${route.path}`

      await expect(unauthPage).toHaveURL(/\/login/)

      await unauthPage.screenshot({ path: shotPath, fullPage: false })
      fs.writeFileSync(shotPath.replace('.png', '.console.txt'), consoleMessages.join('\n'))

      unauthPage.removeListener('console', handler)

      results.push({
        route: route.path,
        viewport: viewport.name,
        auth: 'unauth',
        file: filename,
        consoleCount: consoleMessages.length,
        redirected,
        finalUrl,
      })
    }
  }

  await unauthContext.close()
  await browser.close()

  const summary = {
    engine: engineUsed,
    loginSucceeded,
    baseUrl: BASE_URL,
    captured: results.length,
    results,
    timestamp: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(SHOT_DIR, '_summary.json'), JSON.stringify(summary, null, 2))
})

test('client RN shell keeps collection chrome and direct detail navigation', async () => {
  test.skip(!RUN_RN_E2E, 'Set E2E_RUN_RN=1 with an authenticated RN web session to run this smoke.')
  test.setTimeout(240_000)

  const { chromium } = await import('@playwright/test')
  let browser
  let engine = 'msedge'
  try {
    browser = await chromium.launch({ channel: 'msedge' })
  } catch {
    browser = await chromium.launch()
    engine = 'chromium'
  }

  const context = await browser.newContext()
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  try {
    const envText = fs.readFileSync(path.resolve('apps/client/.env.local'), 'utf8')
    const readEnv = (name: string) => {
      const value = process.env[name] ?? envText.match(new RegExp(`^${name}=([^\\r\\n]+)`, 'm'))?.[1]
      return value?.trim().replace(/^['"]|['"]$/g, '')
    }
    const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL')
    const anonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY')
    expect(supabaseUrl).toBeTruthy()
    expect(anonKey).toBeTruthy()

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    expect(authResponse.ok).toBeTruthy()
    const session = await authResponse.json()

    await page.goto(`${RN_BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      (value) => window.localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)),
      session,
    )
    await page.goto(`${RN_BASE_URL}/inicio`, { waitUntil: 'domcontentloaded' })

    for (const viewport of RN_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`${RN_BASE_URL}/inicio`, { waitUntil: 'domcontentloaded' })

      await expect(page.getByText('Mi QR', { exact: true }).last()).toBeVisible()
      const dock = page.getByTestId('client-dock')
      const tabs = page.getByTestId('client-tabs')
      if (viewport.width < 1024) {
        await expect(dock).toBeVisible()
        await expect(tabs).not.toBeVisible()
      } else {
        await expect(dock).not.toBeVisible()
        await expect(tabs).toBeVisible()
      }
      const businessCard = page.locator('a[href*="/empresas/"]').first()
      await expect(businessCard).toBeVisible()
      await page.screenshot({
        path: path.join(SHOT_DIR, `rn-shell-${viewport.name}.png`),
        fullPage: false,
      })
      await businessCard.click()
      await expect(page).toHaveURL(/\/empresas\/[^/]+$/)
      await expect(page.getByText('Mi QR', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Volver' }).first().click()
      await expect(page).toHaveURL(/\/inicio$/)

      await page.goto(`${RN_BASE_URL}/inicio`, { waitUntil: 'domcontentloaded' })
      const homePlanCard = page.locator('a[href*="/planes/"]').first()
      await expect(homePlanCard).toHaveAttribute('href', /\/planes\/[^/]+$/)
      await page.goto(`${RN_BASE_URL}/planes`, { waitUntil: 'domcontentloaded' })
      const planCard = page.getByRole('button', { name: /Suscribirse|Aprovechar/ }).first()
      await expect(planCard).toBeVisible()
      await planCard.click()
      await expect(page).toHaveURL(/\/planes\/[^/]+$/)
      await expect(page.getByText('Mi QR', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Volver' }).first().click()
      await expect(page).toHaveURL(/\/planes$/)
    }

    expect(consoleErrors).toEqual([])
    fs.writeFileSync(
      path.join(SHOT_DIR, 'rn-shell-navigation-summary.json'),
      JSON.stringify({ engine, baseUrl: RN_BASE_URL, viewports: RN_VIEWPORTS, consoleErrors }, null, 2),
    )
  } finally {
    await context.close()
    await browser.close()
  }
})
