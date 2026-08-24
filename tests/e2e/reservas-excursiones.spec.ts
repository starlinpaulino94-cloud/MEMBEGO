import { test, expect } from '@playwright/test'

test.describe('Flujos de Reserva de Excursiones', () => {

  test('Cliente logueado reserva por QR de vendedor (con carrito)', async ({ page }) => {
    // 1. Simular login de cliente
    // (Asume la existencia de comandos de test o auth en setup)
    await page.goto('/login')
    await page.fill('input[name="email"]', 'cliente@ejemplo.com')
    await page.fill('input[name="password"]', 'secreto123')
    await page.click('button[type="submit"]')
    await page.waitForURL('/cliente/dashboard')

    // 2. Entrar por el QR del vendedor
    await page.goto('/e/luis-tours')
    
    // Al estar logueado, redirige al catálogo
    await expect(page).toHaveURL(/\/empresas\/.*\/excursiones/)

    // 3. Entrar a una excursión
    await page.click('text=Ver excursión')
    
    // 4. Añadir al carrito
    await page.fill('input[name="adultos"]', '2')
    await page.click('button:has-text("Agregar al carrito")')

    // 5. Verificar que el carrito se abrió y muestra 1 ítem
    await expect(page.locator('text=Tu Carrito de Excursiones')).toBeVisible()
    await expect(page.locator('text=Confirmar Reservas')).toBeVisible()

    // 6. Confirmar compra
    await page.click('button:has-text("Confirmar Reservas")')
    
    // 7. Redirige a mis excursiones y muestra éxito
    await expect(page).toHaveURL(/\/cliente\/mis-excursiones/)
    await expect(page.locator('text=Has reservado exitosamente')).toBeVisible()
  })

  test('Vendedor crea reserva a cliente nuevo desde el dashboard', async ({ page }) => {
    // 1. Simular login de vendedor
    await page.goto('/login')
    await page.fill('input[name="email"]', 'luis.vendedor@ejemplo.com')
    await page.fill('input[name="password"]', 'secreto123')
    await page.click('button[type="submit"]')
    await page.waitForURL('/vendedor')

    // 2. Ir a crear reserva
    await page.goto('/vendedor/reservas/nueva')
    
    // 3. Llenar datos de cliente nuevo
    const testEmail = `nuevo-${Date.now()}@test.com`
    await page.fill('input[name="clienteNombre"]', 'Nuevo Cliente')
    await page.fill('input[name="clienteEmail"]', testEmail)
    
    // 4. Llenar excursión
    await page.fill('input[name="fecha"]', '2026-10-15')
    await page.fill('input[name="hora"]', '09:00')
    await page.fill('input[name="adultos"]', '3')
    
    // 5. Confirmar
    await page.click('button[type="submit"]')
    
    // 6. Redirige a lista de reservas y notifica éxito
    await expect(page).toHaveURL('/vendedor/reservas')
    await expect(page.locator('text=creada exitosamente')).toBeVisible()
  })

})
