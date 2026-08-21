import { expect, test } from '@playwright/test'

/**
 * COMISIONES · ATRIBUCIÓN — flujo E2E completo.
 *
 * Cubre:
 * 1) Cliente nuevo escanea QR → registro → atribución REGISTRO
 * 2) Cliente existente escanea QR → afiliación → atribución REGISTRO
 * 3) Cliente (cualquiera) reserva online con cookie → atribución RESERVA
 * 4) Admin confirma venta → comisión GENERADA/APROBADA
 * 5) Admin crea liquidación → ve comisiones pendientes
 * 6) Admin paga liquidación → vendedor ve "Ya cobrado" actualizado
 * 7) Admin anula liquidación → comisiones vuelven a APROBADA
 *
 * REQUISITO: Supabase de pruebas + datos sembrados (E2E_SUPABASE_URL)
 * Ver docs/PRUEBAS-E2E.md §4
 */

const AUTENTICADO = Boolean(process.env.E2E_SUPABASE_URL)
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3210'

// Helpers para crear datos de prueba via API/DB (cuando el harness exista)
async function seedTestData() {
  // TODO: cuando exista el harness, sembrar:
  // - Empresa test-exc (slug: test-exc)
  // - Vendedor Juan Pérez (código: JUAN01, ACTIVO, userId real)
  // - Enlace vendedor: slug juan-perez, activo: true
  // - Regla comisión: VENDEDOR_EXCURSION, PORCENTAJE, 10%, activa: true
  // - Excursión: ACTIVA, capacidad 20, variante adulto 1000 DOP, horario diario 09:00 cupo 20
  // - Config excursiones: ventanaAtribucionDias: 30, reglaAprobacion: 'AUTOMATICA'
}

async function cleanTestData() {
  // TODO: limpiar datos de prueba
}

test.describe('Comisiones · Atribución E2E', () => {
  test.beforeAll(async () => {
    if (AUTENTICADO) await seedTestData()
  })

  test.afterAll(async () => {
    if (AUTENTICADO) await cleanTestData()
  })

  test('1) Cliente nuevo escanea QR → registro → atribución REGISTRO', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Visitar enlace de vendedor (QR) → debe redirigir a registro con cookie
    const qrUrl = `${BASE_URL}/e/juan-perez`
    await page.goto(qrUrl)

    // Debe redirigir a /registro/test-exc con parámetros v y e
    await expect(page).toHaveURL(/\/registro\/test-exc\?v=JUAN01&e=juan-perez/)

    // 2. Verificar que la cookie VENDEDOR_COOKIE se estableció
    const cookies = await page.context().cookies()
    const vendedorCookie = cookies.find(c => c.name === 'mg_ven')
    expect(vendedorCookie).toBeTruthy()
    expect(vendedorCookie?.value).toBe('juan-perez')

    // 3. Completar registro (nombre, email, password)
    await page.getByLabel(/nombre/i).fill('Cliente Nuevo')
    await page.getByLabel(/email/i).fill('cliente.nuevo@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /registrar|crear cuenta/i }).click()

    // 4. Debe redirigir a excursiones de la empresa
    await expect(page).toHaveURL(/\/empresas\/test-exc\/excursiones/)

    // 5. Verificar que la cookie se consumió (ya no existe)
    const cookiesAfter = await page.context().cookies()
    const vendedorCookieAfter = cookiesAfter.find(c => c.name === 'mg_ven')
    expect(vendedorCookieAfter).toBeFalsy()

    // TODO: Verificar en BD que existe vendedorAtribucion con etapa REGISTRO
    // Esto requiere acceso a BD o API de admin
  })

  test('2) Cliente existente escanea QR → afiliación → atribución REGISTRO', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login como cliente existente (ya tiene cuenta en otra empresa)
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('cliente.existente@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()
    await expect(page).toHaveURL(/\/cliente/)

    // 2. Visitar enlace de vendedor (QR)
    const qrUrl = `${BASE_URL}/e/juan-perez`
    await page.goto(qrUrl)

    // Debe redirigir a /registro/test-exc (no a login)
    await expect(page).toHaveURL(/\/registro\/test-exc\?v=JUAN01&e=juan-perez/)

    // 3. Debe mostrar tarjeta "Únete a Test Exc" (AfiliarEmpresaCard)
    await expect(page.getByText(/únete a test exc/i)).toBeVisible()

    // 4. Click en "Unirme a Test Exc"
    await page.getByRole('button', { name: /unirme a test exc/i }).click()

    // 5. Debe redirigir a excursiones de la empresa
    await expect(page).toHaveURL(/\/empresas\/test-exc\/excursiones/)

    // 6. Verificar cookie consumida
    const cookiesAfter = await page.context().cookies()
    const vendedorCookieAfter = cookiesAfter.find(c => c.name === 'mg_ven')
    expect(vendedorCookieAfter).toBeFalsy()

    // TODO: Verificar en BD que existe vendedorAtribucion con etapa REGISTRO
  })

  test('3) Cliente reserva online con cookie → atribución RESERVA', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login como cliente (puede ser el nuevo o el existente afiliado)
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('cliente.nuevo@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()
    await expect(page).toHaveURL(/\/cliente/)

    // 2. Visitar enlace de vendedor para establecer cookie
    await page.goto(`${BASE_URL}/e/juan-perez`)
    await expect(page).toHaveURL(/\/empresas\/test-exc\/excursiones/)

    // 3. Navegar a detalle de excursión
    await page.goto('/empresas/test-exc/excursiones/saona')

    // 4. Rellenar formulario de reserva
    await page.getByLabel(/fecha/i).fill('2026-09-15') // fecha futura
    await page.getByLabel(/hora/i).selectOption('09:00')
    await page.getByLabel(/adultos/i).fill('2')
    await page.getByLabel(/niños/i).fill('1')
    await page.getByRole('button', { name: /reservar/i }).click()

    // 5. Verificar reserva creada
    await expect(page).toHaveURL(/\/cliente\/excursiones\//)
    await expect(page.getByText(/reserva creada/i)).toBeVisible()

    // 6. Verificar cookie consumida
    const cookiesAfter = await page.context().cookies()
    const vendedorCookieAfter = cookiesAfter.find(c => c.name === 'mg_ven')
    expect(vendedorCookieAfter).toBeFalsy()

    // TODO: Verificar en BD que reserva tiene vendedorId y existe vendedorAtribucion etapa RESERVA
  })

  test('4) Admin confirma venta → comisión GENERADA/APROBADA', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login como admin de la empresa
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('admin@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()
    await expect(page).toHaveURL(/\/admin/)

    // 2. Ir a reservas de excursiones
    await page.goto('/admin/excursiones/reservas')

    // 3. Encontrar la reserva del cliente y confirmar venta
    // (asumiendo que la reserva está en estado PENDIENTE)
    const reservaRow = page.locator('tr', { hasText: 'Cliente Nuevo' }).first()
    await expect(reservaRow).toBeVisible()
    await reservaRow.getByRole('button', { name: /confirmar venta/i }).click()

    // 4. Confirmar modal
    await page.getByRole('button', { name: /confirmar/i }).click()

    // 5. Verificar que la venta se confirmó
    await expect(page.getByText(/venta confirmada/i)).toBeVisible()

    // 6. Ir a comisiones
    await page.goto('/admin/excursiones/comisiones')

    // 7. Verificar que aparece la comisión para el vendedor
    await expect(page.locator('text=Juan Pérez')).toBeVisible()
    await expect(page.locator('text=100')).toBeVisible() // 10% de 1000

    // TODO: Verificar estado GENERADA o APROBADA según config
  })

  test('5) Admin crea liquidación → ve comisiones pendientes', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login como admin
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('admin@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    // 2. Ir a liquidaciones
    await page.goto('/admin/excursiones/liquidaciones')

    // 3. Verificar que aparece el vendedor con comisiones pendientes
    await expect(page.locator('text=Juan Pérez')).toBeVisible()
    await expect(page.locator('text=100')).toBeVisible() // monto pendiente

    // 4. Crear liquidación para el período actual
    await page.getByRole('button', { name: /crear liquidación|nueva liquidación/i }).click()
    await page.getByLabel(/vendedor/i).selectOption('Juan Pérez (JUAN01)')
    await page.getByLabel(/desde/i).fill('2026-09-01')
    await page.getByLabel(/hasta/i).fill('2026-09-30')
    await page.getByRole('button', { name: /crear|preparar/i }).click()

    // 5. Verificar liquidación creada en estado BORRADOR
    await expect(page.getByText(/PAY-2026-/)).toBeVisible()
    await expect(page.getByText(/borrador/i)).toBeVisible()
  })

  test('6) Admin paga liquidación → vendedor ve "Ya cobrado" actualizado', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login como admin
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('admin@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    // 2. Ir a liquidaciones y encontrar la del vendedor
    await page.goto('/admin/excursiones/liquidaciones')
    const liquidacionRow = page.locator('tr', { hasText: 'PAY-2026-' }).first()
    await liquidacionRow.getByRole('button', { name: /pagar/i }).click()

    // 3. Rellenar datos de pago
    await page.getByLabel(/método/i).selectOption('TRANSFERENCIA')
    await page.getByLabel(/referencia/i).fill('TRX-123456')
    await page.getByRole('button', { name: /confirmar pago/i }).click()

    // 4. Verificar liquidación en estado PAGADA
    await expect(page.getByText(/pagada/i)).toBeVisible()

    // 5. Login como vendedor (o cambiar a panel vendedor)
    await page.goto('/logout')
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('juan.perez@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    // 6. Ir a comisiones del vendedor
    await page.goto('/vendedor/comisiones')

    // 7. Verificar que "Ya cobrado" se actualizó
    await expect(page.locator('text=Ya cobrado')).toBeVisible()
    await expect(page.locator('text=100')).toBeVisible() // el monto pagado

    // 8. Verificar que "Por cobrar" es 0
    await expect(page.locator('text=Por cobrar')).toBeVisible()
    await expect(page.locator('text=0')).toBeVisible()
  })

  test('7) Admin anula liquidación → comisiones vuelven a APROBADA', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login como admin
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('admin@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    // 2. Ir a liquidaciones
    await page.goto('/admin/excursiones/liquidaciones')

    // 3. Anular la liquidación pagada
    const liquidacionRow = page.locator('tr', { hasText: 'PAY-2026-' }).first()
    await liquidacionRow.getByRole('button', { name: /anular/i }).click()
    await page.getByLabel(/motivo/i).fill('Prueba de anulación')
    await page.getByRole('button', { name: /confirmar anulación/i }).click()

    // 4. Verificar liquidación en estado ANULADA
    await expect(page.getByText(/anulada/i)).toBeVisible()

    // 5. Ir a comisiones
    await page.goto('/admin/excursiones/comisiones')

    // 6. Verificar que la comisión volvió a APROBADA (sin liquidación)
    await expect(page.locator('text=Aprobada')).toBeVisible()
    await expect(page.locator('text=Juan Pérez')).toBeVisible()
  })
})

test.describe('Comisiones · Atribución - Casos edge', () => {
  test('cookie vencida no atribuye reserva', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas')

    // 1. Establecer cookie manualmente con fecha antigua (simular vencida)
    await page.context().addCookies([{
      name: 'mg_ven',
      value: 'juan-perez',
      domain: 'localhost',
      path: '/',
      expires: Math.floor(Date.now() / 1000) - 3600, // hace 1 hora
      httpOnly: true,
      sameSite: 'Lax',
    }])

    // 2. Login y reservar
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('cliente.otro@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    await page.goto('/empresas/test-exc/excursiones/saona')
    await page.getByLabel(/fecha/i).fill('2026-09-20')
    await page.getByLabel(/hora/i).selectOption('09:00')
    await page.getByLabel(/adultos/i).fill('1')
    await page.getByRole('button', { name: /reservar/i }).click()

    // 3. Verificar reserva SIN vendedor
    // TODO: Verificar en BD que reserva.vendedorId es null
  })

  test('vendedor inactivo no atribuye', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas')

    // 1. Establecer cookie de vendedor inactivo
    await page.context().addCookies([{
      name: 'mg_ven',
      value: 'vendedor-inactivo',
      domain: 'localhost',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 86400,
      httpOnly: true,
      sameSite: 'Lax',
    }])

    // 2. Login y reservar
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('cliente.otro2@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    await page.goto('/empresas/test-exc/excursiones/saona')
    await page.getByLabel(/fecha/i).fill('2026-09-25')
    await page.getByLabel(/hora/i).selectOption('09:00')
    await page.getByLabel(/adultos/i).fill('1')
    await page.getByRole('button', { name: /reservar/i }).click()

    // 3. Verificar reserva SIN vendedor
    // TODO: Verificar en BD
  })

  test('reserva sin cookie no tiene vendedor', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas')

    // 1. Login SIN cookie previa
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('cliente.sincookie@test.com')
    await page.getByLabel(/contraseña/i).fill('password123')
    await page.getByRole('button', { name: /entrar/i }).click()

    // 2. Reservar directamente
    await page.goto('/empresas/test-exc/excursiones/saona')
    await page.getByLabel(/fecha/i).fill('2026-10-01')
    await page.getByLabel(/hora/i).selectOption('09:00')
    await page.getByLabel(/adultos/i).fill('1')
    await page.getByRole('button', { name: /reservar/i }).click()

    // 3. Verificar reserva SIN vendedor
    // TODO: Verificar en BD
  })
})