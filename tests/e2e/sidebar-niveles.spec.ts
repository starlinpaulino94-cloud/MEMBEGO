import { test, expect } from '@playwright/test'

/**
 * SHELL DE DOS NIVELES (superadmin + admin).
 *
 * Pruebas de interfaz REALES con navegador: el riel reemplaza el segundo
 * nivel, el compacto persiste, el cajón móvil abre/navega/cierra y el ámbito
 * Plataforma/Empresa no se mezcla.
 *
 * La sesión viene del setup (`sidebar-auth.setup.ts`, un solo login por rol):
 * el limitador de login no permite entrar por formulario en cada prueba.
 * Solo proyecto de PRUEBAS. Nunca producción.
 * Uso local: E2E_BASE_URL=http://localhost:3000 npx playwright test sidebar
 */

test.describe('sidebar como administradora', () => {
  test.use({ storageState: 'playwright/.auth/state-admin.json' })

  // El riel de escritorio no existe en móvil (allí manda el cajón).
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'escritorio',
      'solo viewport escritorio'
    )
    await page.goto('/admin/dashboard')
  })

  test('cambiar de espacio reemplaza el segundo nivel', async ({ page }) => {
    const riel = page.getByRole('navigation', { name: 'Espacios de trabajo' })
    await expect(riel).toBeVisible()
    await expect(page.getByRole('link', { name: /Resumen/ }).first()).toBeVisible()
    await riel.getByRole('link', { name: 'Clientes' }).click()
    await page.waitForURL('**/admin/clientes')
    await expect(page.getByRole('link', { name: 'Directorio' })).toBeVisible()
    await page.screenshot({ path: 'test-results/shots/admin-clientes.png' })
  })

  test('plegar persiste tras recargar y expandir lo devuelve', async ({ page }) => {
    const panel = page.locator('[data-nav-panel]')
    await expect(panel).toBeVisible()
    // Clic por JS: el botón del overlay de desarrollo tapa el pie del riel y
    // se comería el puntero; en producción no existe y el clic es normal.
    const pulsar = (nombre: string) =>
      page.getByRole('button', { name: nombre }).evaluate((b) => (b as HTMLElement).click())
    await pulsar('Plegar menú')
    await expect(panel).toBeHidden()
    await page.reload()
    await expect(panel).toBeHidden()
    const clave = await page.evaluate(() => localStorage.getItem('membego.nav.compacto.v1'))
    expect(clave).toBe('1')
    await page.screenshot({ path: 'test-results/shots/admin-compacto.png' })
    await pulsar('Expandir menú')
    await expect(panel).toBeVisible()
  })
})

test.describe('cajón móvil', () => {
  test.use({ storageState: 'playwright/.auth/state-admin.json' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'movil',
      'solo viewport móvil'
    )
  })

  test('móvil: el cajón abre, navega y se cierra', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    const cajon = page.getByRole('dialog')
    await expect(cajon).toBeVisible()
    await page.screenshot({ path: 'test-results/shots/admin-movil-cajon.png' })
    // El riel del cajón navega al aterrizaje del espacio y el cajón se cierra
    // solo al cambiar de ruta.
    await cajon.getByRole('link', { name: 'Clientes' }).click()
    await page.waitForURL('**/admin/clientes')
    await expect(cajon).toBeHidden()
    // Reabierto en Clientes, el panel contextual enseña sus módulos.
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect(cajon).toBeVisible()
    await expect(cajon.getByRole('link', { name: 'Directorio' })).toBeVisible()
    await cajon.getByRole('link', { name: 'Membresías' }).click()
    await page.waitForURL('**/admin/membresias')
    await expect(cajon).toBeHidden()
  })
})

test.describe('sidebar como superadmin', () => {
  test.use({ storageState: 'playwright/.auth/state-super.json' })
  // Píldora y riel son de escritorio (en móvil se ocultan).
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'escritorio',
      'solo viewport escritorio'
    )
  })

  test('en plataforma no ve módulos de empresa', async ({ page }) => {
    await page.goto('/superadmin/dashboard')
    await expect(page.getByText('Plataforma', { exact: true }).first()).toBeVisible()
    const hrefs = await page.locator('aside a[href]').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href'))
    )
    expect(hrefs.filter((h) => h?.startsWith('/admin'))).toEqual([])
    await page.screenshot({ path: 'test-results/shots/superadmin-plataforma.png' })
  })

  test('en empresa ve la píldora y vuelve a plataforma', async ({ page }) => {
    await page.goto('/admin/dashboard')
    const pildora = page.getByTestId('ambito-pildora')
    await expect(pildora).toBeVisible()
    await expect(pildora).toContainText('Empresa')
    await page.getByRole('link', { name: '← Plataforma' }).click()
    await page.waitForURL('**/superadmin/dashboard')
  })
})
