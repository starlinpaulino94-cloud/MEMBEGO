import { expect, test } from '@playwright/test'

/**
 * RECORRIDO PÚBLICO — lo que ve alguien que todavía no tiene cuenta.
 *
 * Cada prueba de este archivo comprueba algo que, si se rompe, NO produce
 * ningún error en Sentry: la página responde 200 y sale mal. Ese es el hueco
 * exacto que las pruebas unitarias no ven y que la observabilidad de la Fase 6
 * tampoco: el sistema "funciona" y el negocio no.
 */

test.describe('Landing', () => {
  test('carga y ofrece un camino para entrar', async ({ page }) => {
    const respuesta = await page.goto('/')
    expect(respuesta?.status(), 'la portada tiene que responder 200').toBe(200)

    // El nombre de la marca en algún sitio visible: si esto falla, el layout
    // raíz se rompió y da igual lo demás.
    await expect(page.locator('body')).toContainText(/membego/i)

    // Un camino visible para entrar o registrarse. Sin él, la landing es un
    // folleto: se puede leer y no se puede usar.
    //
    // Se busca por DESTINO y no por texto. La primera versión de esta prueba
    // buscaba "iniciar sesión|entrar|acceder" y falló en móvil porque el botón
    // dice "Ingresar" — un fallo de la prueba, no de la aplicación. El destino
    // (`/login`, `/registro`) es lo que de verdad no puede cambiar sin romper
    // el producto; el texto es cosa de marketing y cambia cuando quiere.
    const acceso = page.locator('a[href="/login"]:visible, a[href="/registro"]:visible')
    expect(await acceso.count(), 'debe haber un camino visible para entrar').toBeGreaterThan(0)
  })

  test('no deja errores de JavaScript en la consola', async ({ page }) => {
    // Un error de hidratación no cambia el código de respuesta y sí rompe la
    // interactividad: los botones dejan de responder y nadie se entera.
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errores.push(m.text())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Se ignoran los fallos de red hacia servicios externos: en el entorno de
    // pruebas Supabase y Sentry no existen, y sus 404 no son un defecto del
    // código que se está probando.
    const relevantes = errores.filter(
      (e) => !/supabase|sentry|favicon|net::ERR|Failed to load resource/i.test(e)
    )
    expect(relevantes, `errores en consola:\n${relevantes.join('\n')}`).toHaveLength(0)
  })

  test('responde en un tiempo razonable', async ({ page }) => {
    // No es una prueba de rendimiento —para eso están los scripts de k6— sino
    // una red que detecta el caso catastrófico: alguien quita el `unstable_cache`
    // de /api/stats y la portada vuelve a hacer cuatro conteos completos.
    const t0 = Date.now()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(Date.now() - t0, 'la portada tardó demasiado').toBeLessThan(8000)
  })
})

test.describe('Marketplace', () => {
  test('el listado de empresas carga aunque esté vacío', async ({ page }) => {
    // El caso que más veces se rompe: una base sin datos produce una pantalla
    // en blanco o un error, en vez de un vacío bien dicho.
    const respuesta = await page.goto('/empresas')
    expect(respuesta?.status()).toBe(200)
    await expect(page.locator('body')).not.toBeEmpty()
  })

  test('el listado de promociones carga aunque esté vacío', async ({ page }) => {
    const respuesta = await page.goto('/promociones')
    expect(respuesta?.status()).toBe(200)
    await expect(page.locator('body')).not.toBeEmpty()
  })
})

test.describe('Acceso', () => {
  test('el formulario de login tiene sus dos campos y su botón', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible()
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /entrar|iniciar|acceder/i }).first()).toBeVisible()
  })

  test('una ruta protegida manda al login y recuerda a dónde iba', async ({ page }) => {
    // El `?redirect=` es lo que hace que, tras entrar, la persona vuelva a
    // donde quería ir. Si se pierde, cada acceso desde un enlace compartido
    // termina en el inicio y parece que el enlace no funcionó.
    await page.goto('/cliente/inicio')
    await expect(page).toHaveURL(/\/login/)
    expect(page.url(), 'debe conservar el destino').toContain('redirect')
  })

  test('no acepta un destino externo en el redirect', async ({ page }) => {
    // Arreglado en la Fase 1 (C-05, redirección abierta). Esta prueba existe
    // para que no vuelva: es el tipo de detalle que se pierde en un refactor.
    await page.goto('/login?redirect=//evil.example.com')
    await expect(page).toHaveURL(/localhost|127\.0\.0\.1/)
  })
})

test.describe('Páginas de sistema', () => {
  test('una ruta que no existe da 404 con página propia', async ({ page }) => {
    const respuesta = await page.goto('/esto-no-existe-de-verdad-12345')
    expect(respuesta?.status()).toBe(404)
    await expect(page.locator('body')).toContainText(/no encontrada|no existe|404/i)
  })

  test('la pantalla sin conexión se renderiza sin depender de nada', async ({ page }) => {
    // La sirve el service worker cuando no hay red (Fase 7 · punto 28). Si
    // dependiera de la base o de la sesión, no podría pintarse justo el día que
    // hace falta.
    const respuesta = await page.goto('/offline')
    expect(respuesta?.status()).toBe(200)
    await expect(page.locator('body')).toContainText(/sin conexión/i)
  })

  test('/api/health responde para el monitor de uptime', async ({ request }) => {
    // Es el endpoint del que cuelga el SLO de disponibilidad (Fase 6). Si
    // alguien lo renombra, las alertas dejan de sonar en silencio.
    const r = await request.get('/api/health')
    expect(r.status()).toBe(200)
    const cuerpo = await r.json()
    expect(['ok', 'degraded']).toContain(cuerpo.status)
  })

  test('/api/metricas no es público', async ({ request }) => {
    // Devuelve datos de negocio. Sin el secreto tiene que ser indistinguible
    // de una ruta inexistente (Fase 6).
    const r = await request.get('/api/metricas')
    expect([404, 503]).toContain(r.status())
  })

  test('el manifiesto de la PWA es válido y apunta al escáner', async ({ request }) => {
    const r = await request.get('/manifest.json')
    expect(r.status()).toBe(200)
    const m = await r.json()
    expect(m.start_url).toBeTruthy()
    expect(m.display).toBe('standalone')
    expect(JSON.stringify(m.shortcuts ?? [])).toContain('/empleado/scanner')
  })
})

test.describe('Cabeceras de seguridad', () => {
  test('la portada llega con las cabeceras de la Fase 3', async ({ request }) => {
    const r = await request.get('/')
    const h = r.headers()
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['content-security-policy'] ?? h['content-security-policy-report-only']).toBeTruthy()
    expect(h['referrer-policy']).toBeTruthy()
  })
})
