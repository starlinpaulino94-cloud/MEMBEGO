import { expect, test } from '@playwright/test'

/**
 * FASE 4 · CONVERSIÓN DESDE EL MAPA — retorno del contexto de ubicación.
 *
 * Lo que se cubre aquí, y qué significa cada prueba (regla del proyecto: una
 * prueba sin aserción de negocio no vale):
 *
 * 1) La pieza PÚBLICA que comparte la URL sucursal-consciente no rompe: el
 *    detalle de empresa tolera `?sucursal=&origen=cerca` y degrada al 404
 *    diseñado cuando no hay datos (CI nace sin base). Guard de regresión para
 *    CompanyProfile, no una prueba de contenido.
 *
 * 2) La entrada al mapa "Cerca de mí" sin sesión redirige a `/login` (307/200),
 *    jamás a un 500. Si alguien rompe el guard de auth del módulo geo, esto
 *    salta aunque Supabase no esté.
 *
 * 3) EL RECORRIDO AUTENTICADO COMPLETO — mapa → detalle → onboarding de
 *    vehículo → regreso → adquisición → vuelta al mapa. Es el criterio de
 *    aceptación §15 de docs/GEOLOCALIZACION.md ("Car wash respeta requisitos
 *    de vehículo — e2e registro vehículo desde oferta"). NO CORRE EN CI: exige
 *    Supabase de pruebas + datos sembrados (docs/PRUEBAS-E2E.md §4). Cuando el
 *    harness exista (`E2E_SUPABASE_URL`), se activa solo; mientras tanto queda
 *    documentado aquí, listo para ejecutarse, y no se sienta en una esquina
 *    pretendiendo ser verde.
 */

const AUTENTICADO = Boolean(process.env.E2E_SUPABASE_URL)

test.describe('Fase 4 · conversión desde el mapa', () => {
  test('el detalle de empresa tolera la URL sucursal-consciente sin romper', async ({ page }) => {
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))

    // CI nace sin datos: cualquier slug real no existe y el diseño es la página
    // de no-encontrado, NUNCA un 500 ni una pantalla rota (en `next dev` esa
    // página responde 200; lo que no puede pasar es un error de servidor).
    const respuesta = await page.goto(
      '/empresas/empresa-inexistente?sucursal=no-existe&origen=cerca'
    )
    expect(respuesta?.status() ?? 0, 'slug desconocido → nunca un 500').toBeLessThan(500)
    expect(errores, 'no debe haber errores de JavaScript').toHaveLength(0)
    await expect(page.locator('body')).not.toBeEmpty()
  })

  test('el mapa "Cerca de mí" sin sesión redirige a login, nunca a un 500', async ({ page }) => {
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))

    await page.goto('/cliente/cerca')
    await expect(page).toHaveURL(/\/login/)
    expect(errores, 'la redirección de auth no debe romper la página').toHaveLength(0)
  })

  test('car wash sin vehículo: mapa → detalle → onboarding → regreso → adquisición → mapa', async ({
    page,
  }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // Harness: empresa car wash con sucursal geolocalizada, promo gratuita y
    // plan activos; cliente de ESA empresa sin vehículo; sesión iniciada.
    // La sesión se inyecta con storageState del harness.

    const detalleUrl = /\/cliente\/empresas\/[a-z0-9-]+\?sucursal=[a-z0-9-]+&origen=cerca/

    // 1 · Mapa "Cerca de mí" → tarjeta de la empresa.
    await page.goto('/cliente/cerca')
    await expect(page).toHaveURL(/\/cliente\/cerca/)
    await page.locator('a[href^="/cliente/empresas/"][href*="origen=cerca"]').first().click()
    await expect(page).toHaveURL(detalleUrl)

    // 2 · Detalle sucursal-consciente: volver lleva al mapa, la sucursal está
    //    destacada y las ofertas/planes se dicen canjeables ahí.
    const backCerca = page.locator('a[href="/cliente/cerca"]')
    await expect(backCerca).toBeVisible()
    await expect(page.locator('section#sucursales')).toBeVisible()
    await expect(page.getByText(/Canjeable en .+/)).toBeVisible()

    // 3 · Car wash sin vehículo → CTA de onboarding, con `next` que regresa.
    const ctaVehiculo = page.getByRole('link', { name: /registrar mi vehículo/i })
    await expect(ctaVehiculo).toBeVisible()
    const hrefVehiculo = await ctaVehiculo.getAttribute('href')
    expect(hrefVehiculo).toMatch(/^\/cliente\/vehiculos\/nuevo\?next=/)
    await ctaVehiculo.click()
    await expect(page).toHaveURL(/\/cliente\/vehiculos\/nuevo/)

    // 4 · Registrar el vehículo → vuelve al detalle (router.push(next)).
    await page.getByLabel(/marca/i).fill('Toyota')
    await page.getByLabel(/modelo/i).fill('Corolla')
    await page.getByLabel(/placa/i).fill('A123456')
    await page.getByRole('button', { name: /guardar|registrar|siguiente/i }).click()
    await expect(page).toHaveURL(detalleUrl)

    // 5 · Requisito resuelto: el CTA ahora es "Ver planes" con retorno.
    const ctaPlanes = page.getByRole('link', { name: /ver planes/i }).first()
    await expect(ctaPlanes).toBeVisible()
    const hrefPlanes = await ctaPlanes.getAttribute('href')
    expect(hrefPlanes).toMatch(/^\/cliente\/planes\?retorno=/)
    await ctaPlanes.click()
    await expect(page).toHaveURL(/\/cliente\/planes\?retorno=/)

    // 6 · Elegir un plan → detalle de membresía que vuelve al detalle del mapa.
    await page.getByRole('button', { name: /seleccionar este plan/i }).first().click()
    await expect(page).toHaveURL(/\/membresia\/[a-z0-9-]+\?retorno=/)
    await expect(page.locator('a[href^="/cliente/empresas/"][href*="origen=cerca"]')).toBeVisible()

    // 7 · Desde el detalle, adquirir la promo gratuita y volver al mapa.
    await page.goto(new URL(page.url()).origin + '/cliente/cerca')
    await page.locator('a[href^="/cliente/empresas/"][href*="origen=cerca"]').first().click()
    await expect(page).toHaveURL(detalleUrl)
    await page.locator('a[href^="/cliente/promociones/"]').first().click()
    await expect(page).toHaveURL(/\/cliente\/promociones\/[a-z0-9-]+\?retorno=/)
    await page.getByRole('button', { name: /adquirir promoción/i }).click()
    await page.getByRole('button', { name: /activar ahora|continuar al pago/i }).click()
    await expect(page).toHaveURL(/\/cliente\/mis-promociones\/[a-z0-9-]+\?retorno=/)

    // 8 · Cadena de retorno completa: detalle de la compra → detalle de la
    //    empresa → mapa. El contexto de ubicación nunca se pierde.
    await page.getByRole('link', { name: /omitir por ahora/i }).click()
    await expect(page).toHaveURL(/\/cliente\/mis-promociones\/[a-z0-9-]+\?retorno=/)
    await page.locator('a[href^="/cliente/empresas/"][href*="origen=cerca"]').click()
    await expect(page).toHaveURL(detalleUrl)
    await backCerca.click()
    await expect(page).toHaveURL(/\/cliente\/cerca/)
  })
})
