import { expect, test } from '@playwright/test'

/**
 * ASISTENTE DE REGISTRO (Onboarding v2) — recorrido público.
 *
 * Cubre lo que se puede probar SIN Supabase (ver playwright.config.ts): los
 * pasos del asistente son 100% cliente hasta el envío final, así que aquí se
 * verifica el recorrido completo de pantallas en /registro/cuenta — avance,
 * validación en vivo, atrás, resumen y recuperación del borrador. El envío
 * final (crea la cuenta) pertenece a la mitad autenticada documentada en
 * docs/PRUEBAS-E2E.md.
 */

test.describe('Asistente de registro (general)', () => {
  test('recorre los pasos del perfil hasta el resumen, con validación y atrás', async ({ page }) => {
    const respuesta = await page.goto('/registro/cuenta')
    expect(respuesta?.status()).toBe(200)

    // Paso 1: una sola pregunta por pantalla, con progreso visible.
    await expect(page.getByRole('heading', { name: /cómo te llamas/i })).toBeVisible()
    await expect(page.getByText(/paso 1 de 5/i)).toBeVisible()

    // Avanzar sin datos → error comprensible, no un submit mudo. (Con filter:
    // el route-announcer de Next también tiene role=alert y rompería el modo
    // estricto.)
    await page.getByRole('button', { name: /continuar/i }).click()
    await expect(page.getByRole('alert').filter({ hasText: /nombre/i })).toBeVisible()

    await page.locator('#nombre').fill('María Prueba')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Paso 2: correo, con validación en vivo.
    await expect(page.getByRole('heading', { name: /correo/i })).toBeVisible()
    await page.locator('#email').fill('esto-no-es-un-correo')
    await page.getByRole('button', { name: /continuar/i }).click()
    await expect(page.getByRole('alert').filter({ hasText: /correo/i })).toBeVisible()
    await page.locator('#email').fill('maria@example.com')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Paso 3: contraseña.
    await expect(page.getByRole('heading', { name: /contraseña/i })).toBeVisible()
    await page.locator('#password').fill('secreta123')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Paso 4: teléfono.
    await expect(page.getByRole('heading', { name: /teléfono/i })).toBeVisible()
    await page.locator('#telefono').fill('809-555-0000')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Paso 5: resumen con los datos reales y consentimientos.
    await expect(page.getByRole('heading', { name: /revisa y confirma/i })).toBeVisible()
    await expect(page.locator('dl')).toContainText('María Prueba')
    await expect(page.locator('dl')).toContainText('maria@example.com')
    await expect(page.locator('input[name="terminos"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /crear mi cuenta/i })).toBeVisible()

    // Atrás vuelve al paso anterior sin perder el dato.
    await page.getByRole('button', { name: /atrás/i }).click()
    await expect(page.getByRole('heading', { name: /teléfono/i })).toBeVisible()
    await expect(page.locator('#telefono')).toHaveValue('809-555-0000')
  })

  test('el borrador sobrevive a una recarga (sin la contraseña)', async ({ page }) => {
    await page.goto('/registro/cuenta')
    await page.locator('#nombre').fill('Pedro Prueba')
    await page.getByRole('button', { name: /continuar/i }).click()
    await expect(page.getByRole('heading', { name: /correo/i })).toBeVisible()

    await page.reload()

    // El nombre se recuperó del borrador; la contraseña jamás se persiste.
    await expect(page.getByRole('heading', { name: /cómo te llamas/i })).toBeVisible()
    await expect(page.locator('#nombre')).toHaveValue('Pedro Prueba')
    const borrador = await page.evaluate(() =>
      window.sessionStorage.getItem('mg-reg-v2:general:general')
    )
    expect(borrador).not.toBeNull()
    expect(borrador).not.toContain('secreta')
    expect(borrador).not.toContain('password')
  })
})
