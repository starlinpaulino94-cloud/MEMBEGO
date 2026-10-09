import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE, type RolE2E } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * SEPARACIÓN LANDING · APP — F2: producto, servicio, oferta, carrito y pago viven en la app.
 *
 * La landing es un portal de información y descubrimiento. Aquí se comprueba, por la
 * interfaz y con lo que llega al navegador, que de verdad no opera:
 *
 *   · sin formularios, sin botones de compra, reserva, oferta ni pago, y sin carrito;
 *   · sin que llegue al navegador el CÓDIGO de esas operaciones (no basta con esconder un botón);
 *   · con el traspaso que corresponde a cada quien: visitante, cliente, equipo;
 *   · y sigue siendo consulta: 200, metadatos de enlace compartido y caché (ISR) intactos.
 *
 * Y que en la app esas mismas operaciones funcionan: ficha, agregar al carrito, contador
 * en el encabezado, carrito. El pago completo lo prueba `carrito-checkout.spec.ts`.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `Producto f2 ${sufijo}`
const SERVICIO = `Servicio f2 ${sufijo}`
const OFERTA = `Oferta f2 ${sufijo}`
const BORRADOR = `Borrador f2 ${sufijo}`

/** Textos que SOLO existen en el código de las operaciones: si aparecen en algo que llegó a una página pública, la landing lo descargó. */
const MARCAS_DE_OPERACION = ['Enviar pedido', 'Agregar al carrito', 'Elige la sucursal donde la vas a canjear', 'Continuar al pago', 'Ya tenías esta oferta']

/** Navega y espera a que termine el streaming de Next. */
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

test.describe('Separación F2 · la landing informa, la app opera', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let empresa: EmpresaCatalogo
  let slugProducto = ''
  let slugServicio = ''
  let slugBorrador = ''
  const app = (slug: string) => `/cliente/empresas/${empresa.slug}/catalogo/${slug}`
  const publica = (slug: string) => `/empresas/${empresa.slug}/catalogo/${slug}`

  test('siembra: una empresa con un producto con stock, un servicio y una oferta activa', async () => {
    empresa = await empresaCatalogo(sufijo, 'f2', { capacidad: true, pedidos: true, deals: true })
    const sucursal = await sucursalSembrada(empresa.id, 'Sucursal F2')
    slugProducto = `producto-f2-${sufijo}`
    slugServicio = `servicio-f2-${sufijo}`
    slugBorrador = `borrador-f2-${sufijo}`
    const producto = await itemSembrado(empresa.id, { name: PRODUCTO, slug: slugProducto, controlaInventario: true, variantes: [{ name: 'Default', sku: `F2-P-${sufijo}`, price: 1000, porDefecto: true }] })
    await itemSembrado(empresa.id, { name: SERVICIO, slug: slugServicio, variantes: [{ name: 'Default', sku: `F2-S-${sufijo}`, price: 600, porDefecto: true }] })
    await itemSembrado(empresa.id, { name: BORRADOR, slug: slugBorrador, status: 'DRAFT', variantes: [{ name: 'Default', sku: `F2-B-${sufijo}`, price: 50, porDefecto: true }] })
    const variante = await varianteDe(producto.id)
    await existenciasSembradas(empresa.id, variante, sucursal.id, 20)
    const ahora = new Date()
    await prismaDeArnes().deal.create({
      data: {
        companyId: empresa.id, catalogVariantId: variante, title: OFERTA, description: 'Oferta de prueba de la separación.',
        discountType: 'PERCENT', discountValue: 20, currency: 'DOP', status: 'ACTIVE', publishedAt: ahora,
        startsAt: new Date(ahora.getTime() - 3_600_000), endsAt: null, voucherDays: 7, maxClaims: 25, feePerRedemption: 100, budgetTotal: 2500,
      },
    })
    await asegurarUsuario('separacionCliente2')
    await asegurarUsuario('separacionAdmin', empresa.id)
    await asegurarUsuario('separacionEmpleado', empresa.id)
  })

  // ── La landing no opera ────────────────────────────────────────────────────

  test('las fichas de la landing no tienen formularios ni botones de operación, ni carrito', async ({ page }) => {
    for (const ruta of [publica(slugProducto), publica(slugServicio), `/empresas/${empresa.slug}`, '/catalogo', '/ofertas', '/']) {
      await ir(page, ruta)
      for (const nombre of ['Hacer un pedido', 'Reservar este servicio', 'Agregar al carrito']) {
        await expect(page.getByRole('form', { name: nombre }), `${ruta}: formulario «${nombre}»`).toHaveCount(0)
      }
      await expect(page.getByRole('button', { name: /Enviar pedido|Agregar al carrito|Obtener oferta|Reservar$|Pagar|Continuar al pago/ }), `${ruta}: botones de operación`).toHaveCount(0)
      await expect(page.getByTestId('carrito-icono'), `${ruta}: icono de carrito`).toHaveCount(0)
      await expect(page.getByTestId('carrito-contador'), `${ruta}: contador de carrito`).toHaveCount(0)
      // Formularios de servidor (acciones): ninguno que no sea una búsqueda.
      expect(await page.locator('form input[name^="$ACTION"]').count(), `${ruta}: formularios con acción de servidor`).toBe(0)
    }
  })

  test('al navegador de la landing no llega el código de las operaciones (no basta con esconder el botón)', async ({ browser }) => {
    for (const ruta of [publica(slugProducto), publica(slugServicio), `/empresas/${empresa.slug}`, '/catalogo', '/ofertas']) {
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
        expect(todo.includes(marca), `${ruta}: la landing descargó código de operación («${marca}»)`).toBe(false)
      }
      await ctx.close()
    }
  })

  // ── El traspaso, según quién mire ──────────────────────────────────────────

  test('visitante: la ficha ofrece iniciar sesión o crear cuenta y volver a la ficha de la app', async ({ page }) => {
    await ir(page, publica(slugProducto))
    const traspaso = page.getByRole('region', { name: 'Hacer un pedido' })
    await expect(traspaso).toBeVisible()
    await expect(traspaso.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent(app(slugProducto))}`)
    await expect(traspaso.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', `/registro/cuenta?next=${encodeURIComponent(app(slugProducto))}`)
    await expect(page.getByRole('link', { name: 'Obtener oferta en la app' })).toBeVisible()
    // «Crear cuenta» abre el registro con el destino guardado.
    await traspaso.getByRole('link', { name: 'Crear cuenta' }).click()
    await expect(page).toHaveURL(/\/registro\/cuenta\?next=/)
    expect(new URL(page.url()).searchParams.get('next')).toBe(app(slugProducto))
  })

  test('el servicio habla de reservar; el producto, de pedir', async ({ page }) => {
    await ir(page, publica(slugServicio))
    await expect(page.getByRole('region', { name: 'Reservar este servicio' })).toBeVisible()
    await ir(page, publica(slugProducto))
    await expect(page.getByRole('region', { name: 'Hacer un pedido' })).toBeVisible()
  })

  test('cliente con sesión: la misma ficha lo manda directo a la ficha dentro de /cliente', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await ir(page, publica(slugProducto))
    const traspaso = page.getByRole('region', { name: 'Hacer un pedido' })
    const entrar = traspaso.getByRole('link', { name: 'Pedir en la app' })
    await expect(entrar).toHaveAttribute('href', app(slugProducto))
    await expect(traspaso.getByRole('link', { name: 'Iniciar sesión' })).toHaveCount(0)
    await entrar.click()
    await expect(page).toHaveURL(new RegExp(`${app(slugProducto)}$`))
    await expect(page.getByRole('form', { name: 'Hacer un pedido' })).toBeVisible()
    await ctx.close()
  })

  test('administrador y empleado: reciben su panel, ningún enlace de compra', async ({ browser }) => {
    for (const [rol, casa] of [['separacionAdmin', /\/admin\/dashboard$/], ['separacionEmpleado', /\/empleado\/scanner$/]] as const) {
      const { ctx, page } = await conSesion(browser, rol, empresa.id)
      await ir(page, publica(slugProducto))
      const traspaso = page.getByRole('region', { name: 'Hacer un pedido' })
      await expect(traspaso.getByRole('link', { name: 'Ir a mi panel' }), rol).toBeVisible()
      await expect(traspaso.getByRole('link', { name: /Pedir en la app|Iniciar sesión|Crear cuenta/ }), rol).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Obtener oferta en la app' }), rol).toHaveCount(0)
      await traspaso.getByRole('link', { name: 'Ir a mi panel' }).click()
      await expect(page, rol).toHaveURL(casa)
      await ctx.close()
    }
  })

  test('la ficha de la app es solo de clientes: el equipo que la abre por URL vuelve a su espacio, sin bucle', async ({ browser }) => {
    for (const [rol, casa] of [['separacionAdmin', /\/admin\/dashboard$/], ['separacionEmpleado', /\/empleado\/scanner$/]] as const) {
      const { ctx, page } = await conSesion(browser, rol, empresa.id)
      await page.goto(app(slugProducto))
      await expect(page, rol).toHaveURL(casa)
      await page.goto(`/login?redirect=${encodeURIComponent(app(slugProducto))}`)
      await expect(page, `${rol}: /login con un destino de cliente`).toHaveURL(casa)
      await ctx.close()
    }
  })

  // ── Redirecciones: sin redirecciones abiertas ni bucles ─────────────────────

  test('/login con sesión rechaza destinos externos, del propio acceso y de otros espacios', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    const casa = /\/cliente\/inicio$/
    for (const malo of ['//evil.example/robo', 'https://evil.example/robo', '/\\evil.example', '/login', '/registro/cuenta', '/api/v1/auth/sesion', '/admin/dashboard', '/superadmin/dashboard']) {
      await page.goto(`/login?redirect=${encodeURIComponent(malo)}`)
      await expect(page, malo).toHaveURL(casa)
      expect(new URL(page.url()).origin).toBe(new URL(BASE).origin)
    }
    // Y un destino bueno se respeta, con su consulta.
    await page.goto(`/login?redirect=${encodeURIComponent(`${app(slugProducto)}?x=1`)}`)
    await expect(page).toHaveURL(new RegExp(`${app(slugProducto)}\\?x=1$`))
    await ctx.close()
  })

  test('el registro con ?next= malicioso no abre redirecciones: la página carga normal y el destino se ignora', async ({ page }) => {
    for (const malo of ['//evil.example', 'https://evil.example', '/login']) {
      const r = await page.goto(`/registro/cuenta?next=${encodeURIComponent(malo)}`)
      expect(r?.status(), malo).toBe(200)
      await expect(page, malo).toHaveURL(/\/registro\/cuenta/)
    }
  })

  // ── Dentro de la app ───────────────────────────────────────────────────────

  test('en la app: la ficha tiene sus botones, el carrito está en el encabezado y el contador cuenta', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.goto(app(slugProducto))
    await expect(page.getByRole('heading', { level: 1, name: PRODUCTO })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Obtener oferta' })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Hacer un pedido' })).toBeVisible()
    await expect(page.getByTestId('carrito-icono')).toBeVisible()
    await expect(page.getByTestId('carrito-contador')).toHaveCount(0)

    const form = page.getByRole('form', { name: 'Agregar al carrito' })
    await form.getByLabel('Cantidad').fill('3')
    await form.getByRole('button', { name: 'Agregar al carrito' }).click()
    await expect(page.getByText('Agregado al carrito.').first()).toBeVisible()
    await expect(page.getByTestId('carrito-contador')).toHaveText('3')

    await page.getByTestId('carrito-icono').click()
    await expect(page).toHaveURL(/\/cliente\/carrito$/)
    await expect(page.getByTestId(`carrito-${empresa.slug}`).getByText(PRODUCTO)).toBeVisible()
    await expect(page.getByTestId(`carrito-${empresa.slug}`).getByText('RD$3,000.00').first()).toBeVisible()
    // El carrito no se pierde al recargar.
    await page.reload()
    await expect(page.getByTestId('carrito-contador')).toHaveText('3')
    await ctx.close()
  })

  test('en la app: el servicio muestra «Reservar» y la ficha ajena o inexistente da «no encontrado»', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2')
    await page.goto(app(slugServicio))
    // El formulario se llama siempre «Hacer un pedido»; lo que cambia con el servicio es su título y su botón.
    await expect(page.getByRole('heading', { name: 'Reservar este servicio' })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Hacer un pedido' }).getByRole('button', { name: 'Reservar' })).toBeVisible()
    await page.goto(`/cliente/empresas/${empresa.slug}/catalogo/no-existe-${sufijo}`)
    await expect(page.getByText(/no encontr/i).first()).toBeVisible()
    await ctx.close()
  })

  // ── La consulta pública sigue intacta ──────────────────────────────────────

  test('las fichas públicas siguen siendo de consulta: 200, metadatos de enlace compartido y caché', async ({ request, page }) => {
    const url = publica(slugProducto)
    const r1 = await request.get(url)
    expect(r1.status()).toBe(200)
    expect(r1.headers()['set-cookie'], 'una ficha de consulta no puede fijar cookies de sesión').toBeUndefined()
    const r2 = await request.get(url)
    expect(r2.status()).toBe(200)
    // La portada y las ofertas, que F2 también tocó (tarjetas y traspaso), siguen siendo ESTÁTICAS: se sirven desde la
    // caché de la plataforma (ISR) y no por visita. La ficha, en cambio, ya se renderizaba por visita ANTES de F2
    // (`ƒ` en la tabla de rutas del build de F1); su caché es la de datos (`getItemCatalogoPublico`, con etiqueta).
    for (const ruta of ['/', '/ofertas']) {
      const cc = (await request.get(ruta)).headers()['cache-control'] ?? ''
      expect(cc, `${ruta} debe seguir siendo estática`).toMatch(/s-maxage=\d+/)
      expect(cc, `${ruta} no puede ser privada`).not.toMatch(/private|no-store/)
    }
    await ir(page, url)
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(1)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
    await expect(page).toHaveTitle(new RegExp(PRODUCTO))
    await expect(page.getByText(/Ahorras RD\$200\.00/)).toBeVisible()
    await expect(page.getByText('Disponible').first()).toBeVisible()
    // Nunca la cantidad exacta.
    expect((await page.content()).includes('"onHand"')).toBe(false)
  })

  test('una ficha que no se publicó se ve exactamente igual que una que no existe, en los dos espacios', async ({ browser, page }) => {
    // Sembrada como borrador desde el principio (así la lectura en caché nunca la vio publicada).
    // `ir` espera a que termine el streaming de Next: sin eso se lee el cuerpo a medias y las dos pantallas parecen distintas.
    const publicaOculta = await ir(page, publica(slugBorrador))
    await expect(page.getByText(/no encontr|no existe/i).first()).toBeVisible()
    const textoOculta = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const publicaInexistente = await ir(page, publica(`no-existe-${sufijo}`))
    await expect(page.getByText(/no encontr|no existe/i).first()).toBeVisible()
    const textoInexistente = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(publicaOculta?.status()).toBe(publicaInexistente?.status())
    expect(textoOculta.includes(BORRADOR), 'la landing no puede nombrar un borrador').toBe(false)
    expect(textoOculta.replace(slugBorrador, 'X')).toBe(textoInexistente.replace(`no-existe-${sufijo}`, 'X'))

    const { ctx, page: pc } = await conSesion(browser, 'separacionCliente2')
    await pc.goto(app(slugBorrador))
    await expect(pc.getByText(/no encontr/i).first()).toBeVisible()
    await expect(pc.getByRole('heading', { level: 1, name: BORRADOR })).toHaveCount(0)
    await ctx.close()
  })

  test('el endpoint de sesión ligera: visitante, cliente y equipo; sin identidad y sin caché', async ({ browser, request }) => {
    const anonimo = await request.get('/api/v1/auth/sesion')
    expect(anonimo.status()).toBe(200)
    expect(await anonimo.json()).toEqual({ autenticado: false })
    expect(anonimo.headers()['cache-control']).toMatch(/no-store/)

    for (const [rol, esperado, casa] of [['separacionCliente2', 'CLIENTE', '/cliente/inicio'], ['separacionAdmin', 'ADMINISTRADOR', '/admin/dashboard'], ['separacionEmpleado', 'EMPLEADO', '/empleado/scanner']] as const) {
      const { ctx } = await conSesion(browser, rol, rol === 'separacionCliente2' ? null : empresa.id)
      const r = await ctx.request.get('/api/v1/auth/sesion')
      const cuerpo = await r.json()
      expect(cuerpo, rol).toEqual({ autenticado: true, rol: esperado, casa })
      expect(JSON.stringify(cuerpo), `${rol}: sin identidad`).not.toMatch(/@|e2e\.separacion|dbUserId|supabase/i)
      await ctx.close()
    }
  })
})
