import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, SESION_LOCAL_DISPONIBLE, type RolE2E } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, type EmpresaCatalogo, type ItemSembrado } from './catalogo-arnes'

/**
 * SEPARACIÓN LANDING · APP · PANELES — LOS INVARIANTES (fase F0).
 *
 * No prueba una función nueva: fija lo que NO puede romperse mientras las
 * fases F1 a F6 mueven las operaciones de la landing a `/cliente`.
 *
 *   · la autenticación: quién entra adónde, el destino de retorno, el rechazo
 *     de destinos externos y que `/login` devuelve a su casa a quien ya entró;
 *   · la autorización: cada rol solo ve su espacio y rebota a su casa;
 *   · el aislamiento multiempresa: un administrador no ve el catálogo de otra;
 *   · la consulta pública: las páginas con valor de SEO y de enlace compartido
 *     responden 200 y no piden sesión.
 *
 * Deben pasar HOY y tras CADA fase. Si una fase los rompe, la fase está mal.
 * Lo que sí cambiará (dónde se compra) lo prueba cada fase en su propio spec.
 *
 * Se siembra con Prisma y se entra con sesiones firmadas localmente; ver
 * docs/PRUEBAS-E2E.md.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)

/** Navega y espera a que termine el streaming de Next (ver catalogo-publico.spec). */
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

const CASA = {
  cliente: /\/cliente\/inicio$/,
  admin: /\/admin\/dashboard$/,
  superadmin: /\/superadmin\/dashboard$/,
} as const

test.describe('Separación · invariantes de acceso y consulta pública', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let a: EmpresaCatalogo
  let b: EmpresaCatalogo
  const it: Record<string, ItemSembrado> = {}

  test('siembra: dos empresas con catálogo publicado y sus administradores', async () => {
    a = await empresaCatalogo(sufijo, 'sep-a', { capacidad: true })
    b = await empresaCatalogo(sufijo, 'sep-b', { capacidad: true })
    it.a = await itemSembrado(a.id, { name: `Servicio de A ${sufijo}`, slug: `servicio-a-${sufijo}`, variantes: [{ name: 'Default', sku: `SEP-A-${sufijo}`, price: 700, porDefecto: true }] })
    it.b = await itemSembrado(b.id, { name: `Secreto de B ${sufijo}`, slug: `secreto-b-${sufijo}`, variantes: [{ name: 'Default', sku: `SEP-B-${sufijo}`, price: 900, porDefecto: true }] })
    await asegurarUsuario('pedidosAdmin', a.id)
    await asegurarUsuario('pedidosCliente')
    await asegurarUsuario('facturacionSuperadmin')
    expect(it.a.id).toBeTruthy()
  })

  // ── Sin sesión ─────────────────────────────────────────────────────────────

  test('sin sesión, cada espacio privado manda a /login y recuerda a dónde iba', async ({ page }) => {
    for (const ruta of ['/cliente/inicio', '/cliente/pedidos', '/admin/dashboard', '/superadmin/dashboard', '/empleado/scanner', '/vendedor', '/mis-membresias']) {
      await page.goto(ruta)
      await expect(page, ruta).toHaveURL(new RegExp(`/login\\?redirect=${encodeURIComponent(ruta).replace(/%/g, '%')}$`))
    }
  })

  test('las puertas de acceso y de registro son públicas', async ({ page }) => {
    for (const ruta of ['/login', '/acceso', '/recuperar', '/registro/cuenta']) {
      const r = await page.goto(ruta)
      expect(r?.status(), ruta).toBe(200)
      await expect(page, ruta).toHaveURL(new RegExp(`${ruta}$`))
    }
  })

  // ── Cliente ────────────────────────────────────────────────────────────────

  test('el cliente entra a su casa, /login lo devuelve y navega su app sin pasar por la landing', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'pedidosCliente')
    for (const puerta of ['/login', '/acceso']) {
      await page.goto(puerta)
      await expect(page, puerta).toHaveURL(CASA.cliente)
    }
    for (const ruta of ['/cliente/inicio', '/cliente/explorar', '/cliente/pedidos', '/cliente/perfil', '/cliente/ajustes', '/cliente/menu']) {
      const r = await page.goto(ruta)
      expect(r?.status(), ruta).toBe(200)
      await expect(page, `${ruta} no puede acabar fuera de /cliente`).toHaveURL(new RegExp(`${ruta}$`))
    }
    await ctx.close()
  })

  test('/login con sesión rechaza un destino externo y respeta uno interno', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'pedidosCliente')
    for (const malo of ['//evil.example/robo', 'https://evil.example/robo', 'javascript:alert(1)']) {
      await page.goto(`/login?redirect=${encodeURIComponent(malo)}`)
      await expect(page, malo).toHaveURL(CASA.cliente)
      expect(new URL(page.url()).origin).toBe(new URL(BASE).origin)
    }
    await page.goto(`/login?redirect=${encodeURIComponent('/cliente/pedidos')}`)
    await expect(page).toHaveURL(/\/cliente\/pedidos$/)
    await ctx.close()
  })

  test('el cliente no abre los paneles: rebota a su casa sin bucle', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'pedidosCliente')
    for (const ruta of ['/admin/dashboard', '/admin/catalogo', '/superadmin/dashboard', '/empleado/scanner', '/vendedor']) {
      await page.goto(ruta)
      await expect(page, ruta).toHaveURL(CASA.cliente)
    }
    await ctx.close()
  })

  // ── Administrador de empresa ───────────────────────────────────────────────

  test('el administrador entra a su panel, /login lo devuelve y no abre la app del cliente ni la del superadmin', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'pedidosAdmin', a.id)
    await page.goto('/login')
    await expect(page).toHaveURL(CASA.admin)
    for (const ruta of ['/admin/dashboard', '/admin/catalogo', '/admin/inventario']) {
      const r = await page.goto(ruta)
      expect(r?.status(), ruta).toBe(200)
      await expect(page, ruta).toHaveURL(new RegExp(`${ruta}$`))
    }
    for (const ajena of ['/cliente/inicio', '/mis-membresias', '/superadmin/dashboard', '/vendedor']) {
      await page.goto(ajena)
      await expect(page, ajena).toHaveURL(CASA.admin)
    }
    await ctx.close()
  })

  test('aislamiento multiempresa: el administrador de A no ve el catálogo de B', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'pedidosAdmin', a.id)
    const propio = await page.goto(`/admin/catalogo/${it.a.id}`)
    expect(propio?.status()).toBe(200)
    await expect(page.getByText(`Servicio de A ${sufijo}`).first()).toBeVisible()

    // El estado HTTP no sirve de señal: el panel transmite por streaming y Next
    // deja 200 aunque la página sea «no encontrada». Lo que importa es el
    // contenido: la página dice que no existe y el nombre ajeno no aparece.
    await page.goto(`/admin/catalogo/${it.b.id}`)
    await expect(page.getByRole('heading', { name: /No encontramos esta página/i })).toBeVisible()
    await expect(page.getByText(`Secreto de B ${sufijo}`)).toHaveCount(0)

    await page.goto('/admin/catalogo')
    await expect(page.getByText(`Secreto de B ${sufijo}`)).toHaveCount(0)
    await ctx.close()
  })

  // ── Superadmin ─────────────────────────────────────────────────────────────

  test('el superadmin entra a su espacio y /login lo devuelve', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'facturacionSuperadmin')
    await page.goto('/login')
    await expect(page).toHaveURL(CASA.superadmin)
    const r = await page.goto('/superadmin/dashboard')
    expect(r?.status()).toBe(200)
    await ctx.close()
  })

  // ── Consulta pública ───────────────────────────────────────────────────────

  test('la consulta pública responde 200, sin sesión, con título y sin pedir acceso', async ({ page }) => {
    const rutas = [
      '/',
      '/empresas',
      `/empresas/${a.slug}`,
      `/empresas/${a.slug}/catalogo/servicio-a-${sufijo}`,
      '/catalogo',
      '/ofertas',
      '/promociones',
      '/excursiones',
      '/caracteristicas',
      '/faq',
      '/privacy',
      '/terms',
    ]
    for (const ruta of rutas) {
      const r = await ir(page, ruta)
      expect(r?.status(), ruta).toBe(200)
      await expect(page, `${ruta} no puede mandar a login`).toHaveURL(new RegExp(`${ruta === '/' ? '/$' : ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'}`))
      await expect(page).toHaveTitle(/.+/)
    }
  })

  test('el detalle público de un ítem declara sus metadatos de enlace compartido', async ({ page }) => {
    await ir(page, `/empresas/${a.slug}/catalogo/servicio-a-${sufijo}`)
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
    await expect(page.getByText(`Servicio de A ${sufijo}`).first()).toBeVisible()
  })

  test('la landing ofrece entrar y registrarse, y lleva a las puertas de autenticación', async ({ page }) => {
    await ir(page, '/')
    const entrar = page.getByRole('link', { name: /Ingresar/i }).first()
    await expect(entrar).toHaveAttribute('href', '/login')
    const registro = page.getByRole('link', { name: /Registrarse|Crear mi cuenta/i }).first()
    await expect(registro).toHaveAttribute('href', /\/registro/)
  })

  test('una empresa que no existe muestra su página de «no encontrado» y no se confunde con una protegida', async ({ page }) => {
    // Igual que arriba: el contenido, no el código HTTP (la landing también transmite).
    await ir(page, `/empresas/no-existe-${sufijo}`)
    await expect(page.getByText(/no encontr/i).first()).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  // ── Cierre de sesión ───────────────────────────────────────────────────────

  test('cerrar sesión lleva a /login, sin bucle, y lo privado vuelve a pedir acceso', async ({ browser }) => {
    // `logout` revoca la sesión en Supabase Auth. Con sesiones firmadas
    // localmente (sin Supabase detrás) esa revocación no puede completarse y la
    // cookie sobrevive: el proxy devolvería a /cliente/inicio y la prueba
    // mediría el arnés, no el producto. El caso corre solo con Supabase real.
    test.skip(process.env.E2E_SUPABASE_REAL !== '1', 'requiere Supabase Auth real (E2E_SUPABASE_REAL=1); la guardia estática fija el destino del logout')
    const { ctx, page } = await conSesion(browser, 'pedidosCliente')
    await page.goto('/cliente/menu')
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/cliente/inicio')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await ctx.close()
  })
})
