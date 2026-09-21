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
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'
const SHOT_DIR = path.resolve('.omo/evidence/qa')

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const ROUTES = [
  { family: 'marketplace', path: '/cliente/inicio', auth: true },
  { family: 'marketplace', path: '/cliente/empresas', auth: true },
  { family: 'wallet', path: '/mis-membresias', auth: true },
  { family: 'qr', path: '/cliente/qr', auth: true },
  { family: 'account', path: '/cliente/perfil', auth: true },
  { family: 'growth', path: '/cliente/invita-y-gana', auth: true },
  { family: 'excursions', path: '/cliente/excursiones', auth: true },
  { family: 'help', path: '/cliente/ayuda', auth: true },
  { family: 'maps', path: '/cliente/cerca', auth: true },
  { family: 'auth-gate', path: '/cliente/inicio', auth: false },
  { family: 'auth-gate', path: '/mis-membresias', auth: false },
]

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
