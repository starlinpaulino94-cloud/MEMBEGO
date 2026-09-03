import { test as setup, expect, type Page } from '@playwright/test'

/**
 * SETUP de sesión para los e2e del shell.
 *
 * Inicia sesión UNA vez por rol y guarda el estado en disco: el limitador de
 * login (5 intentos / 15 min por IP y correo) no permite que cada prueba
 * entre por el formulario. Los specs consumen estos estados con
 * `test.use({ storageState })`.
 *
 * Solo proyecto de PRUEBAS (seed admin123). Nunca producción. Sin
 * `E2E_SUPABASE_URL` no hay Supabase que autentique (en CI la URL es un
 * relleno) y el login nunca redirige: se salta, igual que el resto de specs
 * autenticados (docs/PRUEBAS-E2E.md §4).
 *
 * Los estados viven en `playwright/.auth/` (ignorado por git) y NO en
 * `test-results/`: Playwright vacía su directorio de salida en cada corrida y
 * borraría las sesiones que el setup acaba de crear.
 */

const AUTENTICADO = Boolean(process.env.E2E_SUPABASE_URL)

const ADMIN = { email: 'admin.cartown@membego.com', password: 'admin123' }
const SUPER = { email: 'superadmin@membego.com', password: 'admin123' }

async function entrar(page: Page, creds: { email: string; password: string }, destino: string) {
  await page.goto('/acceso')
  await page.locator('#email').fill(creds.email)
  await page.locator('#password').fill(creds.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(`**${destino}`)
}

setup('sesión administradora', async ({ page }) => {
  setup.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')
  setup.setTimeout(120_000)
  await entrar(page, ADMIN, '/admin/dashboard')
  await expect(page.getByRole('navigation', { name: 'Espacios de trabajo' })).toBeVisible()
  await page.context().storageState({ path: 'playwright/.auth/state-admin.json' })
})

setup('sesión superadmin', async ({ page }) => {
  setup.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')
  setup.setTimeout(120_000)
  await entrar(page, SUPER, '/superadmin/dashboard')
  await page.context().storageState({ path: 'playwright/.auth/state-super.json' })
})
