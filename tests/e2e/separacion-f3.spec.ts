import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE, type RolE2E } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * SEPARACIÓN LANDING · APP — F3: las excursiones se reservan en la app.
 *
 * La landing conserva la consulta (lista y ficha de excursiones, con sus metadatos de enlace compartido), pero no
 * reserva ni paga: ofrece el traspaso. La app tiene el formulario de reserva, UN carrito (productos y excursiones
 * juntos), el pago y el enlace de los vendedores (`/e/[slug]`) termina en la lista de excursiones de la empresa
 * DENTRO de la app.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const EXCURSION = `Excursión f3 ${sufijo}`
const PAUSADA = `Pausada f3 ${sufijo}`

/** Textos que SOLO existen en el código de la reserva: si llegan a una página pública, la landing lo descargó. */
const MARCAS_DE_OPERACION = ['Excursión agregada al carrito.', 'Añadir un adulto', 'Confirmar Reservas', 'Pagar y Confirmar']

async function ir(page: Page, url: string) {
  const r = await page.goto(url)
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 3000 }).catch(() => undefined)
  return r
}

async function conSesion(browser: Browser, rol: RolE2E, companyId: string | null = null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  await entrarComo(ctx, rol, BASE, companyId)
  return { ctx, page: await ctx.newPage() }
}

test.describe('Separación F3 · las excursiones se reservan en la app', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo
  let slugExcursion = ''
  let slugPausada = ''
  let slugEnlace = ''
  const app = () => `/cliente/empresas/${empresa.slug}/excursiones/${slugExcursion}`
  const publica = () => `/empresas/${empresa.slug}/excursiones/${slugExcursion}`
  const listaApp = () => `/cliente/empresas/${empresa.slug}/excursiones`
  const listaPublica = () => `/empresas/${empresa.slug}/excursiones`

  test('siembra: una empresa con una excursión activa (con salida diaria), una pausada y un vendedor con enlace', async () => {
    empresa = await empresaCatalogo(sufijo, 'f3', { capacidad: true, pedidos: true })
    slugExcursion = `excursion-f3-${sufijo}`
    slugPausada = `pausada-f3-${sufijo}`
    slugEnlace = `f3-${sufijo}`
    const db = prismaDeArnes()
    const activa = await db.excursion.create({
      data: {
        companyId: empresa.id, nombre: EXCURSION, slug: slugExcursion, descripcion: 'Una excursión de prueba de la separación.',
        capacidad: 30, estado: 'ACTIVA', horaSalida: '09:00', puntoSalida: 'Muelle',
        variantes: { create: { companyId: empresa.id, nombre: 'Estándar', precioAdulto: 1500, precioNino: 800 } },
        horarios: { create: { companyId: empresa.id, diasSemana: [1, 2, 3, 4, 5, 6, 7], horaSalida: '09:00' } },
      },
      select: { id: true },
    })
    expect(activa.id).toBeTruthy()
    await db.excursion.create({
      data: {
        companyId: empresa.id, nombre: PAUSADA, slug: slugPausada, capacidad: 10, estado: 'PAUSADA',
        variantes: { create: { companyId: empresa.id, nombre: 'Estándar', precioAdulto: 900 } },
      },
    })
    await db.vendedor.create({
      data: {
        companyId: empresa.id, nombre: 'Luis', apellido: 'Tours', codigo: `V-F3-${sufijo}`, estado: 'ACTIVO',
        enlaces: { create: { companyId: empresa.id, slug: slugEnlace, activo: true } },
      },
    })
    await asegurarUsuario('separacionCliente')
    await asegurarUsuario('separacionCliente2')
    await asegurarUsuario('separacionAdmin', empresa.id)
    await asegurarUsuario('separacionEmpleado', empresa.id)
  })

  // ── La landing consulta y no reserva ───────────────────────────────────────

  test('la lista y la ficha de la landing responden 200, informan y no tienen formulario de reserva, carrito ni botones de operación', async ({ page }) => {
    const rLista = await ir(page, listaPublica())
    expect(rLista?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(EXCURSION).first()).toBeVisible()
    await expect(page.getByText(PAUSADA)).toHaveCount(0)

    const rFicha = await ir(page, publica())
    expect(rFicha?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: EXCURSION })).toBeVisible()
    for (const ruta of [listaPublica(), publica(), `/empresas/${empresa.slug}`]) {
      await ir(page, ruta)
      await expect(page.getByRole('button', { name: /Agregar al carrito|Reservar ahora|Confirmar|Pagar/ }), `${ruta}: botones de operación`).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Añadir un adulto|Añadir un niño/ }), `${ruta}: selector de pasajeros`).toHaveCount(0)
      await expect(page.locator('input[name="fecha"], input[name="adultos"]'), `${ruta}: campos de reserva`).toHaveCount(0)
      await expect(page.getByTestId('carrito-icono'), `${ruta}: icono de carrito`).toHaveCount(0)
      expect(await page.locator('form input[name^="$ACTION"]').count(), `${ruta}: formularios con acción de servidor`).toBe(0)
    }
  })

  test('la ficha de la landing conserva sus metadatos de enlace compartido y no se indexa lo que no existe', async ({ page }) => {
    await ir(page, publica())
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/)
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0)
    await ir(page, `/empresas/${empresa.slug}/excursiones/${slugPausada}`)
    await expect(page.getByRole('heading', { level: 1, name: PAUSADA })).toHaveCount(0)
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()
    await ir(page, `/empresas/${empresa.slug}/excursiones/no-existe-${sufijo}`)
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()
  })

  test('al navegador de la landing no llega el código de la reserva', async ({ browser }) => {
    for (const ruta of [publica(), listaPublica()]) {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      const cuerpos: string[] = []
      page.on('response', async (r) => {
        const tipo = r.headers()['content-type'] ?? ''
        if (r.url().includes('/_next/static/') && /javascript/.test(tipo)) cuerpos.push(await r.text().catch(() => ''))
      })
      await ir(page, ruta)
      await page.waitForTimeout(800)
      cuerpos.push(await page.content())
      expect(cuerpos.length, `${ruta}: debe haber descargado scripts`).toBeGreaterThan(1)
      const todo = cuerpos.join('\n')
      for (const marca of MARCAS_DE_OPERACION) {
        expect(todo.includes(marca), `${ruta}: la landing descargó código de reserva («${marca}»)`).toBe(false)
      }
      await ctx.close()
    }
  })

  // ── El traspaso, según quién mire ──────────────────────────────────────────

  test('visitante: la ficha ofrece iniciar sesión o crear cuenta y volver a la ficha de la app', async ({ page }) => {
    await ir(page, publica())
    const traspaso = page.getByRole('region', { name: 'Reservar esta excursión' })
    await expect(traspaso).toBeVisible()
    await expect(traspaso.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent(app())}`)
    await expect(traspaso.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', `/registro/cuenta?next=${encodeURIComponent(app())}`)
  })

  test('cliente con sesión: la ficha pública lo manda a la ficha de la app, donde está el formulario', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await ir(page, publica())
    const traspaso = page.getByRole('region', { name: 'Reservar esta excursión' })
    const entrar = traspaso.getByRole('link', { name: 'Reservar en la app' })
    await expect(entrar).toHaveAttribute('href', app())
    await entrar.click()
    await expect(page).toHaveURL(new RegExp(`${app()}$`))
    await expect(page.getByRole('heading', { level: 1, name: EXCURSION })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Añadir un adulto' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Agregar al carrito/ })).toBeVisible()
    await expect(page.getByTestId('carrito-icono')).toBeVisible()
    await ctx.close()
  })

  test('administrador y empleado: reciben su panel, ningún enlace de reserva; la ficha de la app los devuelve a su espacio', async ({ browser }) => {
    for (const [rol, casa] of [['separacionAdmin', /\/admin\/dashboard$/], ['separacionEmpleado', /\/empleado\/scanner$/]] as const) {
      const { ctx, page } = await conSesion(browser, rol, empresa.id)
      await ir(page, publica())
      const traspaso = page.getByRole('region', { name: 'Reservar esta excursión' })
      await expect(traspaso.getByRole('link', { name: 'Ir a mi panel' }), rol).toBeVisible()
      await expect(traspaso.getByRole('link', { name: /Reservar en la app|Iniciar sesión|Crear cuenta/ }), rol).toHaveCount(0)
      await page.goto(app())
      await expect(page, rol).toHaveURL(casa)
      await ctx.close()
    }
  })

  // ── Dentro de la app: reservar, un solo carrito, pagar ─────────────────────

  test('en la app: la lista y la ficha tienen sus acciones; la pausada y la inexistente dan «no encontrado»', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.goto(listaApp())
    await expect(page.getByText(EXCURSION).first()).toBeVisible()
    await expect(page.getByText(PAUSADA)).toHaveCount(0)
    // La tarjeta lleva a la ficha DE LA APP, no a la pública.
    const href = await page.locator('a[href*="/excursiones/"]').first().getAttribute('href')
    expect(href).toMatch(/^\/cliente\/empresas\/[^/]+\/excursiones\/[^/?]+/)
    for (const slug of [slugPausada, `no-existe-${sufijo}`]) {
      await page.goto(`/cliente/empresas/${empresa.slug}/excursiones/${slug}`)
      await expect(page.getByText(/no encontr/i).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /Agregar al carrito/ })).toHaveCount(0)
    }
    await ctx.close()
  })

  test('en la app: reserva por el carrito único, cuenta en el encabezado, se paga y queda en «mis excursiones»', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.goto(app())
    await expect(page.getByTestId('carrito-contador')).toHaveCount(0)
    // La primera fecha con salida ya viene elegida; solo se elige la hora (si hay varias).
    await expect(page.getByText(/Seleccionada:/)).toBeVisible()
    const botonHora = page.getByRole('button', { name: /09:00/ })
    if (await botonHora.count()) await botonHora.first().click()
    await page.getByRole('button', { name: 'Añadir un adulto' }).click()
    await page.getByRole('button', { name: /Agregar al carrito/ }).click()
    await expect(page.getByText('Excursión agregada al carrito.').first()).toBeVisible()
    // No hay cajón lateral: UN carrito. El contador del encabezado suma las excursiones.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('carrito-contador')).toHaveText('1')

    await page.getByTestId('carrito-icono').click()
    await expect(page).toHaveURL(/\/cliente\/carrito$/)
    await expect(page.getByTestId('carrito-excursiones').getByText(EXCURSION)).toBeVisible()

    // El carrito sobrevive a recargar.
    await page.reload()
    await expect(page.getByTestId('carrito-contador')).toHaveText('1')

    await page.getByRole('link', { name: 'Revisar y reservar' }).click()
    await expect(page).toHaveURL(/\/cliente\/carrito\/excursiones$/)
    await page.getByRole('button', { name: /Continuar al Pago/ }).click()
    await page.getByRole('button', { name: /Pagar en Destino/ }).click()
    await page.getByRole('button', { name: /Revisar y Confirmar/ }).click()
    await page.getByRole('button', { name: 'Confirmar Reservas' }).click()
    await expect(page).toHaveURL(/\/cliente\/mis-excursiones/, { timeout: 20_000 })
    await expect(page.getByText(EXCURSION).first()).toBeVisible()
    // Y el carrito quedó vacío.
    await expect(page.getByTestId('carrito-contador')).toHaveCount(0)
    await ctx.close()
  })

  test('el carrito vacío ofrece ir a los negocios y a las excursiones', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente')
    await page.goto('/cliente/carrito')
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ver negocios' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ver excursiones' })).toBeVisible()
    await ctx.close()
  })

  // ── Rutas retiradas y enlaces de vendedores ────────────────────────────────

  test('las rutas operativas de antes redirigen sin bucles y sin perder el destino', async ({ browser, page }) => {
    // Visitante: /checkout → carrito de excursiones de la app → login con el destino guardado.
    await page.goto('/checkout')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/cliente/carrito/excursiones')
    // Cliente con sesión: llega al carrito de excursiones.
    const { ctx, page: pc } = await conSesion(browser, 'separacionCliente')
    await pc.goto('/checkout')
    await expect(pc).toHaveURL(/\/cliente\/carrito\/excursiones$/)
    await pc.goto('/carrito')
    await expect(pc).toHaveURL(/\/cliente\/carrito$/)
    await ctx.close()
  })

  test('/e/[slug]: cuenta la visita, recuerda al vendedor y termina en las excursiones de la empresa dentro de la app', async ({ browser, page }) => {
    // Visitante: al registro de la empresa, con el destino de la app guardado en next=.
    await page.goto(`/e/${slugEnlace}`)
    await expect(page).toHaveURL(new RegExp(`/registro/${empresa.slug}`))
    const next = new URL(page.url()).searchParams.get('next')
    expect(next).toMatch(new RegExp(`^${listaApp().replace(/\//g, '\\/')}\\?e=${slugEnlace}$`))
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === 'mg_ven' && c.value === slugEnlace), 'cookie de atribución del vendedor').toBe(true)

    // Cliente con sesión: directo a la lista de la app.
    const { ctx, page: pc } = await conSesion(browser, 'separacionCliente2')
    await pc.goto(`/e/${slugEnlace}`)
    await expect(pc).toHaveURL(new RegExp(`${listaApp()}\\?e=${slugEnlace}$`))
    await expect(pc.getByText(EXCURSION).first()).toBeVisible()
    await ctx.close()

    // Enlace inexistente: al inicio, sin romper.
    const r = await page.goto(`/e/no-existe-${sufijo}`)
    expect(r?.status()).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/e\//)
  })

  test('«seguir empresa» ya no está en la landing: la landing invita a seguirla en la app', async ({ browser, page }) => {
    await ir(page, `/empresas/${empresa.slug}`)
    await expect(page.getByRole('button', { name: /^Seguir$|Siguiendo/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Seguir en la app' })).toBeVisible()
    const { ctx, page: pc } = await conSesion(browser, 'separacionCliente2')
    await pc.goto(`/cliente/empresas/${empresa.slug}`)
    await expect(pc.getByRole('button', { name: /^Seguir$|Siguiendo/ })).toBeVisible()
    await ctx.close()
  })
})
