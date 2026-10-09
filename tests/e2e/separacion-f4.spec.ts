import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asegurarUsuario, cerrarPrisma, cookieDeSesion, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE, type RolE2E } from './supply-v2-sesion'
import { empresaCatalogo, type EmpresaCatalogo } from './catalogo-arnes'
import { ofertasDeSupply, type OfertaSembrada } from './puente-arnes'

/**
 * SEPARACIÓN LANDING · APP — F4: ofertas Membego, membresías, campañas y regalos de empresa.
 *
 * La landing informa y traspasa; la app opera. Aquí se comprueba, por la interfaz y con lo que llega al navegador:
 *
 *   · la landing no tiene botones de compra, contratación ni reclamo, ni formularios, ni el CÓDIGO de esas operaciones;
 *   · el traspaso es el que corresponde a cada quien (visitante, cliente, equipo) y conserva beneficio y cupón;
 *   · el enlace compartido de un regalo no filtra su contenido;
 *   · y en la app todo eso funciona: comprar, contratar, ver campañas, abrir y reclamar el regalo.
 *
 * Las reglas de compra (importes, beneficios, cupones, idempotencia) las prueban las suites de Supply (slices 2 a 8).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const OFERTA = `Oferta f4 ${sufijo}`
const PLAN = `Plan f4 ${sufijo}`
const CODIGO_REGALO = `F4${sufijo.toUpperCase()}`
const TITULO_REGALO = `Regalo secreto f4 ${sufijo}`

/** Textos que SOLO existen en el código de las operaciones: si aparecen en lo que llegó a una página pública, la landing lo descargó. */
const MARCAS_DE_OPERACION = ['btn-comprar', 'btn-contratar-membresia', 'Reclamar mi regalo', 'btn-comprobar-cupon']

async function ir(page: Page, url: string) {
  const r = await page.goto(url)
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 3000 }).catch(() => undefined)
  return r
}

async function conSesion(browser: Browser, rol: RolE2E, companyId: string | null = null, clienteId: string | null = null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  if (clienteId) {
    const u = await asegurarUsuario(rol, companyId)
    const c = await cookieDeSesion({ ...u, clienteId })
    await ctx.addCookies([{ ...c, url: BASE, httpOnly: false, sameSite: 'Lax' }])
  } else {
    await entrarComo(ctx, rol, BASE, companyId)
  }
  return { ctx, page: await ctx.newPage() }
}

test.describe('Separación F4 · Supply y regalos: la landing informa, la app opera', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async () => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere sesiones firmadas localmente y la base')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let casa: EmpresaCatalogo
  let oferta: OfertaSembrada
  let clienteInvitado = ''
  let clienteAjeno = ''
  const publicaOferta = () => `/promociones/membego/${oferta.slug}`
  const appOferta = () => `/cliente/ofertas-membego/${oferta.slug}`
  const publicaRegalo = () => `/oferta/${CODIGO_REGALO}`
  const appRegalo = () => `/cliente/oferta/${CODIGO_REGALO}`

  test('siembra: una oferta Membego, un plan de membresía publicado y un regalo de empresa con un cliente invitado', async () => {
    casa = await empresaCatalogo(sufijo, 'f4', { capacidad: true })
    ;[oferta] = await ofertasDeSupply(sufijo, [OFERTA])
    const db = prismaDeArnes()
    const compras = await asegurarUsuario('compras')
    const programa = await db.supplyV2LoyaltyProgram.create({
      data: {
        code: `MBG-FD-E2E${sufijo.toUpperCase()}`, name: `Programa f4 ${sufijo}`, modalities: ['MEMBERSHIPS'], startsAt: new Date(Date.now() - 3_600_000),
        status: 'ACTIVE', createdById: compras.id,
      },
      select: { id: true },
    })
    const plan = await db.supplyV2MembershipPlan.create({
      data: {
        code: `MBG-MP-E2E${sufijo.toUpperCase()}`, programId: programa.id, name: PLAN, kind: 'PAID', price: 500, durationDays: 30,
        status: 'PUBLISHED', publishedAt: new Date(), createdById: compras.id,
      },
      select: { id: true },
    })
    await db.supplyV2MembershipPlanVersion.create({ data: { planId: plan.id, version: 1, price: 500, durationDays: 30, snapshot: {}, createdById: compras.id } })

    const u1 = await asegurarUsuario('separacionCliente2')
    const u2 = await asegurarUsuario('separacionCliente')
    clienteInvitado = (await db.cliente.create({ data: { companyId: casa.id, supabaseId: u1.supabaseId, nombre: 'Mario Invitado F4', email: `invitado-f4-${sufijo}@prueba.test` }, select: { id: true } })).id
    clienteAjeno = (await db.cliente.create({ data: { companyId: casa.id, supabaseId: u2.supabaseId, nombre: 'Lucía Ajena F4', email: `ajena-f4-${sufijo}@prueba.test` }, select: { id: true } })).id
    const regalo = await db.ofertaPrivada.create({
      data: { companyId: casa.id, codigo: CODIGO_REGALO, titulo: TITULO_REGALO, descripcion: 'Contenido solo para invitados.', usosPorPeriodo: 3, periodo: 'MENSUAL', estado: 'ACTIVA' },
      select: { id: true },
    })
    await db.ofertaInvitado.create({ data: { ofertaId: regalo.id, clienteId: clienteInvitado } })
    await asegurarUsuario('separacionAdmin', casa.id)
    await asegurarUsuario('separacionEmpleado', casa.id)
  })

  // ── La landing no opera ────────────────────────────────────────────────────

  test('las páginas públicas de Supply y del regalo responden 200 y no tienen botones de operación, formularios ni campos de cupón', async ({ page }) => {
    for (const ruta of [publicaOferta(), '/promociones/membresias', '/promociones/campanas', publicaRegalo(), '/promociones']) {
      const r = await ir(page, ruta)
      expect(r?.status(), ruta).toBe(200)
      await expect(page.getByTestId('btn-comprar'), `${ruta}: comprar`).toHaveCount(0)
      await expect(page.getByTestId('btn-comprar-login'), `${ruta}: comprar (login)`).toHaveCount(0)
      await expect(page.getByTestId('btn-contratar-membresia'), `${ruta}: contratar`).toHaveCount(0)
      await expect(page.getByTestId('input-cupon'), `${ruta}: cupón`).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Reclamar mi regalo|Comprar$|Contratar$/ }), `${ruta}: botones`).toHaveCount(0)
      expect(await page.locator('form input[name^="$ACTION"]').count(), `${ruta}: formularios con acción de servidor`).toBe(0)
      await expect(page.getByTestId('carrito-icono'), `${ruta}: carrito`).toHaveCount(0)
    }
    // Y siguen informando: la ficha trae su precio, y el escaparate su plan.
    await ir(page, publicaOferta())
    await expect(page.getByTestId('oferta-titulo')).toHaveText(OFERTA)
    await expect(page.getByTestId('oferta-precio-membego')).toContainText('650')
    await ir(page, '/promociones/membresias')
    await expect(page.getByTestId('plan-publico').filter({ hasText: PLAN })).toBeVisible()
  })

  test('al navegador de la landing no llega el código de las operaciones', async ({ browser }) => {
    for (const ruta of [publicaOferta(), '/promociones/membresias', '/promociones/campanas', publicaRegalo()]) {
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

  test('el enlace compartido de un regalo no filtra su contenido: ni a la landing ni a la vista previa', async ({ page }) => {
    await ir(page, publicaRegalo())
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tienes un regalo esperándote')
    const html = await page.content()
    expect(html).not.toContain(TITULO_REGALO)
    expect(html).not.toContain('Contenido solo para invitados')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Tienes un regalo/)
  })

  test('las URL públicas conservan sus metadatos para compartir', async ({ page }) => {
    await ir(page, publicaOferta())
    await expect(page).toHaveTitle(new RegExp(`${OFERTA}.*Oferta Membego`))
    await ir(page, '/promociones/membresias')
    await expect(page).toHaveTitle(/Membresías/)
  })

  // ── El traspaso, según quién mire ──────────────────────────────────────────

  test('visitante: cada pantalla ofrece iniciar sesión y volver a la misma operación en la app, con su beneficio y cupón', async ({ page }) => {
    await ir(page, `${publicaOferta()}?beneficio=abc123&cupon=VERANO`)
    const traspaso = page.getByRole('region', { name: 'Comprar esta oferta' })
    const destino = `${appOferta()}?beneficio=abc123&cupon=VERANO`
    await expect(traspaso.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent(destino)}`)
    await expect(traspaso.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', `/registro/cuenta?next=${encodeURIComponent(destino)}`)

    await ir(page, '/promociones/membresias')
    await expect(page.getByTestId('plan-publico').filter({ hasText: PLAN }).getByRole('link', { name: 'Contratar en la app' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/cliente/membresias-membego')}`)

    await ir(page, publicaRegalo())
    await expect(page.getByRole('region', { name: 'Abrir mi regalo' }).getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent(appRegalo())}`)
  })

  test('visitante: un destino malicioso en el enlace no abre redirecciones', async ({ page }) => {
    for (const malo of ['//evil.example', 'https://evil.example', '/login']) {
      const r = await page.goto(`/login?redirect=${encodeURIComponent(malo)}`)
      expect(r?.status(), malo).toBe(200)
      await expect(page, malo).toHaveURL(/\/login/)
    }
  })

  test('cliente con sesión: el mismo enlace lo manda directo a la operación dentro de la app', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    await ir(page, publicaOferta())
    await page.getByRole('region', { name: 'Comprar esta oferta' }).getByRole('link', { name: 'Comprar en la app' }).click()
    await expect(page).toHaveURL(new RegExp(`${appOferta()}$`))
    await expect(page.getByTestId('btn-comprar')).toBeVisible()

    await ir(page, '/promociones/membresias')
    await page.getByTestId('plan-publico').filter({ hasText: PLAN }).getByRole('link', { name: 'Contratar en la app' }).click()
    await expect(page).toHaveURL(/\/cliente\/membresias-membego$/)

    await ir(page, publicaRegalo())
    await page.getByRole('region', { name: 'Abrir mi regalo' }).getByRole('link', { name: 'Abrir mi regalo' }).click()
    await expect(page).toHaveURL(new RegExp(`${appRegalo()}$`))
    await ctx.close()
  })

  test('administrador y empleado: reciben su panel, ningún enlace de compra; las pantallas de la app los devuelven a su espacio', async ({ browser }) => {
    for (const [rol, casaDelRol] of [['separacionAdmin', /\/admin\/dashboard$/], ['separacionEmpleado', /\/empleado\/scanner$/]] as const) {
      const { ctx, page } = await conSesion(browser, rol, casa.id)
      await ir(page, publicaOferta())
      const traspaso = page.getByRole('region', { name: 'Comprar esta oferta' })
      await expect(traspaso.getByRole('link', { name: 'Ir a mi panel' }), rol).toBeVisible()
      await expect(traspaso.getByRole('link', { name: /Comprar en la app|Iniciar sesión|Crear cuenta/ }), rol).toHaveCount(0)
      await ir(page, publicaRegalo())
      await expect(page.getByRole('region', { name: 'Abrir mi regalo' }).getByRole('link', { name: 'Ir a mi panel' }), rol).toBeVisible()
      for (const ruta of [appOferta(), '/cliente/membresias-membego', '/cliente/campanas', appRegalo()]) {
        await page.goto(ruta)
        await expect(page, `${rol}: ${ruta}`).toHaveURL(casaDelRol)
      }
      await ctx.close()
    }
  })

  // ── Dentro de la app ───────────────────────────────────────────────────────

  test('en la app: la ficha de la oferta tiene su compra y trae el cupón del enlace ya preseleccionado', async ({ browser }) => {
    // El recorrido de compra completo (cuenta de cobro, pago, derecho) lo prueban los slices 2 a 8 de Supply; aquí, que la
    // operación está en la app y que beneficio y cupón del enlace llegan hasta ella.
    const { ctx, page } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    await page.goto(`${appOferta()}?cupon=VERANO`)
    await expect(page.getByTestId('oferta-titulo')).toHaveText(OFERTA)
    await expect(page.getByTestId('oferta-precio-membego')).toContainText('650')
    await expect(page.getByTestId('input-cupon')).toHaveValue('VERANO')
    await expect(page.getByTestId('btn-comprar')).toBeEnabled()
    await expect(page.getByRole('link', { name: 'Ver mis cupones' })).toHaveAttribute('href', '/cliente/cupones')
    await ctx.close()
  })

  test('en la app: los planes tienen su botón de contratar; el contratar de verdad lo prueba el slice 8', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    await page.goto('/cliente/membresias-membego')
    const tarjeta = page.getByTestId('plan-publico').filter({ hasText: PLAN })
    await expect(tarjeta.getByTestId('plan-publico-precio')).toContainText('500')
    await expect(tarjeta.getByTestId('btn-contratar-membresia')).toBeEnabled()
    await expect(page.getByRole('link', { name: 'tu cuenta' })).toHaveAttribute('href', '/cliente/fidelizacion')
    await ctx.close()
  })

  test('en la app: las campañas conocen al cliente («Mis cupones»); la landing no tiene esa puerta', async ({ browser, page }) => {
    await ir(page, '/promociones/campanas')
    await expect(page.getByTestId('link-mis-cupones')).toHaveCount(0)
    const { ctx, page: pc } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    await pc.goto('/cliente/campanas')
    await expect(pc.getByRole('heading', { level: 1, name: 'Campañas y promociones' })).toBeVisible()
    await expect(pc.getByTestId('link-mis-cupones')).toHaveAttribute('href', '/cliente/cupones')
    await ctx.close()
  })

  test('en la app: el regalo muestra su contenido solo al invitado y se reclama; el ajeno no ve nada', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    await page.goto(appRegalo())
    await expect(page.getByRole('heading', { level: 1, name: TITULO_REGALO })).toBeVisible()
    await page.getByRole('button', { name: 'Reclamar mi regalo' }).click()
    await expect(page.getByText('Regalo reclamado').first()).toBeVisible()
    await ctx.close()

    const ajeno = await conSesion(browser, 'separacionCliente', null, clienteAjeno)
    await ajeno.page.goto(appRegalo())
    await expect(ajeno.page.getByText('Tu cuenta no aplica para esta promoción')).toBeVisible()
    expect(await ajeno.page.content()).not.toContain(TITULO_REGALO)
    await ajeno.page.goto(`/cliente/oferta/NO-EXISTE-${sufijo}`)
    await expect(ajeno.page.getByText('Esta oferta ya no existe')).toBeVisible()
    await ajeno.ctx.close()
  })

  test('/login con sesión respeta los destinos nuevos y rechaza los externos', async ({ browser }) => {
    const { ctx, page } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    for (const bueno of [`${appOferta()}?cupon=X`, '/cliente/membresias-membego', '/cliente/campanas', appRegalo()]) {
      await page.goto(`/login?redirect=${encodeURIComponent(bueno)}`)
      await expect(page, bueno).toHaveURL(new RegExp(`${bueno.replace(/[?]/g, '\\?')}$`))
    }
    await page.goto(`/login?redirect=${encodeURIComponent('//evil.example/robo')}`)
    await expect(page).toHaveURL(/\/cliente\/inicio$/)
    await ctx.close()
  })

  test('el catálogo: la tarjeta de una oferta Membego lleva a la ficha pública en la landing y a la de la app dentro de /cliente', async ({ browser, page }) => {
    // En la landing el puente de Supply no está designado en esta base: se comprueba el destino que arma la tarjeta en cada espacio por la oferta directa.
    await ir(page, '/promociones')
    const tarjeta = page.getByTestId('ofertas-membego').getByTestId('oferta-membego-card').filter({ hasText: OFERTA })
    await expect(tarjeta).toHaveAttribute('href', publicaOferta())
    const { ctx, page: pc } = await conSesion(browser, 'separacionCliente2', null, clienteInvitado)
    await pc.goto('/cliente/bonos')
    await expect(pc.locator('a[href^="/promociones"]')).toHaveCount(0)
    await expect(pc.locator('a[href*="/promociones/membego"]')).toHaveCount(0)
    await ctx.close()
  })
})
