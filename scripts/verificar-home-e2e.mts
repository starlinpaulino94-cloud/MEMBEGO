import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test'

const ref = 'ybzhvfmybyyomwpjpaud'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const direct = process.env.DIRECT_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
assert.equal(new URL(supabaseUrl).hostname, `${ref}.supabase.co`)
assert.ok(new URL(direct).username.endsWith(`.${ref}`))
assert.ok(serviceKey && anonKey)
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'
/** Dónde caen las capturas de fidelidad (390/768/1280). Fuera del repo. */
const CAPTURAS = process.env.E2E_CAPTURAS ?? join(process.cwd(), '.next-qa', 'capturas')
mkdirSync(CAPTURAS, { recursive: true })
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname))
const db = new PrismaClient({ datasourceUrl: direct, log: [] })
const auth = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const suffix = randomUUID().replaceAll('-', '')
const password = randomUUID() + 'Qa!9'
const accounts: { id: string; email: string; localId: string }[] = []
const companies: string[] = []
let categoryId: string | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let paginaDiagnostico: Page | undefined

async function session(context: BrowserContext, email: string) {
  const jar: { name: string; value: string }[] = []
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: { getAll: () => jar, setAll: (cookies) => { jar.splice(0, jar.length, ...cookies.map((c) => ({ name: c.name, value: c.value }))) } },
  })
  const result = await client.auth.signInWithPassword({ email, password })
  if (result.error) throw new Error(`No se pudo crear sesión QA: ${result.error.code}`)
  await context.addCookies(jar.filter((c) => c.value).map((c) => ({ ...c, url: baseURL, sameSite: 'Lax' as const })))
}

try {
  for (const label of ['a', 'b']) {
    const c = await db.company.create({ data: {
      name: `QA Home ${label} ${suffix}`, slug: `qa-home-${label}-${suffix}`, type: 'carwash',
      isPublished: label === 'a', isActive: true, isFeatured: true, featuredOrder: -999,
      latitud: 18.6, longitud: -68.7, ciudad: 'Higüey', bannerUrl: '/icon-512.png', logoUrl: '/icon-512.png',
    } })
    companies.push(c.id)
  }
  const companyId = companies[0]
  const hiddenCompanyId = companies[1]
  assert.ok(companyId && hiddenCompanyId)
  const category = await db.businessCategory.create({ data: { name: 'Servicios QA', slug: `qa-${suffix}`, active: true } })
  categoryId = category.id
  await db.companyToCategory.create({ data: { companyId, categoryId } })
  await db.plan.create({ data: { companyId, nombre: `Plan QA ${suffix}`, precio: 1200, activo: true, descripcion: 'Plan de pruebas sin cobro' } })
  const query = `alias${suffix}`
  const equivalent = `catalogo${suffix}`
  await db.busquedaSinonimo.create({ data: { companyId, termino: query, equivalencia: equivalent } })
  let promoVisibleId = ''
  for (const id of companies) {
    const promoCreada = await db.promocion.create({ data: {
      companyId: id, titulo: `${equivalent} ${id === companyId ? 'visible' : 'privada'}`, descripcion: 'QA de publicación',
      // La visible se publica HOY: así entra en la ventana de 14 días de las
      // novedades del Inicio y el paso de abajo puede aseverar su fila.
      activo: true, isFeatured: true, visibilidad: 'publica',
      publicadaEn: id === companyId ? new Date() : new Date('2020-01-01'),
      vigenciaDesde: new Date('2020-01-01'), vigenciaHasta: new Date('2099-01-01'),
      esComprable: true, precio: 0, imagenUrl: '/icon-512.png',
      imagenes: ['/og-image.png', '/icon-192.png'],
    } })
    if (id === companyId) promoVisibleId = promoCreada.id
  }
  for (const role of ['ADMIN_EMPRESA', 'CLIENTE'] as const) {
    const email = `qa-home-${role.toLowerCase()}-${suffix}@example.com`
    const result = await auth.auth.admin.createUser({ email, password, email_confirm: true })
    if (result.error || !result.data.user) throw new Error(`No se pudo crear usuario QA: ${result.error?.code}`)
    const identity = result.data.user.id
    accounts.push({ id: identity, email, localId: '' })
    const local = await db.user.create({ data: { supabaseId: identity, email, name: 'QA Home', role, companyId } })
    const account = accounts.find((a) => a.id === identity)
    assert.ok(account)
    account.localId = local.id
    const cliente = role === 'CLIENTE' ? await db.cliente.create({ data: { companyId, supabaseId: identity, nombre: 'QA Home', email } }) : null
    if (cliente) {
      await db.companyRating.create({ data: { companyId, clienteId: cliente.id, rating: 5,
        comment: 'Excelente servicio, el equipo es muy profesional.' } })
    }
    const metadata = { role, dbUserId: local.id, companyId, clienteId: cliente?.id ?? null }
    const synced = await auth.auth.admin.updateUserById(identity, { app_metadata: metadata })
    if (synced.error) throw new Error('No se pudo asignar contexto QA')
    if (cliente) {
      await db.customerLocation.create({ data: { userId: local.id, isPrimary: true, source: 'MAP_SELECTION',
        latitud: 18.6, longitud: -68.7, consentForPersonalization: true } })
      await db.geoConsent.create({ data: { userId: local.id, tipo: 'MARKETING_GEO', estado: 'ACTIVE', version: 'QA', canal: 'qa-home' } })
      // Sigue a la empresa QA: las novedades del Inicio salen de las empresas
      // seguidas, y sin esto la sección no existe y no se puede aseverar.
      await db.companyFollow.create({ data: { userId: local.id, companyId } })
    }
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const adminAccount = accounts[0]
  const clientAccount = accounts[1]
  assert.ok(adminAccount && clientAccount)
  await session(adminContext, adminAccount.email)
  await session(clientContext, clientAccount.email)
  const adminPage = await adminContext.newPage()
  paginaDiagnostico = adminPage
  const clientPage = await clientContext.newPage()
  await adminPage.goto(`${baseURL}/admin/personalizacion`, { timeout: 180000 })
  await adminPage.locator('#ed-territorio').fill('Higüey QA')
  const title = `Oferta publicada QA ${suffix}`
  await adminPage.locator('#ed-tit-0').fill(title)
  await adminPage.locator('#ed-sub-0').fill('Publicada desde el editor real')
  await adminPage.locator('#ed-seg-hasta').fill('2099-03-01T12:30')
  await adminPage.getByRole('button', { name: 'Publicar en App', exact: true }).click()
  await expect(adminPage.getByText('Producción en Vivo', { exact: true })).toBeVisible({ timeout: 120000 })
  await clientPage.goto(`${baseURL}/cliente/inicio`, { timeout: 180000 })
  await expect(clientPage.getByRole('heading', { name: title })).toBeVisible({ timeout: 120000 })
  console.log('E2E: publicación desde editor visible para el cliente autorizado.')

  // Novedades en filas densas (contrato Stitch): el cliente sigue a la
  // empresa QA y su promoción se publicó hoy, así que la sección existe con
  // la fila de la promo y su píldora de acción.
  await expect(
    clientPage.getByRole('heading', { name: 'Novedades de tus empresas' })
  ).toBeVisible({ timeout: 60000 })
  await expect(clientPage.getByText('Ver oferta').first()).toBeVisible({ timeout: 60000 })
  console.log('E2E: las novedades del Inicio enseñan la fila densa de la promoción.')

  // El hub administrativo: una columna con los ocho grupos del diseño. Se
  // comprueba que los rótulos estén, no solo que la página cargue — un menú
  // que pierde un grupo no da error, simplemente deja de ofrecerlo.
  for (const grupo of ['Principal', 'Catálogo', 'Operaciones', 'Ajustes']) {
    await expect(adminPage.getByText(grupo, { exact: true }).first()).toBeVisible({ timeout: 60000 })
  }
  await adminPage.screenshot({ path: join(CAPTURAS, 'admin-hub-1280.png'), fullPage: false, animations: 'disabled' })
  console.log('E2E: el hub administrativo rotula sus grupos.')

  // El Resumen Operativo tiene que reflejar la publicación que acaba de
  // ocurrir: la tarjeta «Estado en App Móvil» dice «Público Ahora» y enseña el
  // titular real del hero. Es el circuito completo editor → dashboard.
  await adminPage.goto(`${baseURL}/admin/dashboard`, { timeout: 180000 })
  await expect(adminPage.getByText('Resumen Operativo', { exact: true })).toBeVisible({ timeout: 120000 })
  await expect(adminPage.getByText('Público Ahora', { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 60000 })
  await adminPage.screenshot({ path: join(CAPTURAS, 'admin-resumen-1280.png'), fullPage: true, animations: 'disabled' })
  console.log('E2E: el resumen refleja la publicación (Público Ahora + titular del hero).')
  await adminPage.goto(`${baseURL}/admin/personalizacion`, { timeout: 180000 })
  // Fidelidad por captura: las tres pantallas del cliente que ya existen, en
  // los tres anchos del criterio (§6 de 04-fidelidad-stitch.md). La aserción
  // de desbordamiento corre en cada combinación, no solo en el Inicio: una
  // tarjeta que se sale solo en tableta es exactamente lo que se escapa al
  // mirar una sola captura.
  for (const [pantalla, ruta] of [
    ['inicio', '/cliente/inicio'],
    ['cuenta', '/cliente/perfil'],
    ['mi-qr', '/cliente/qr'],
    ['promociones', '/cliente/promociones'],
    ['explorar', '/cliente/explorar'],
    ['ajustes', '/cliente/ajustes'],
    // Con el término del sinónimo QA: captura el buscador CON resultados
    // (rejilla + panel de filtros), no solo su estado vacío.
    ['buscar', `/cliente/buscar?q=${query}`],
    ['empresa-perfil', `/cliente/empresas/qa-home-a-${suffix}`],
  ] as const) {
    if (ruta !== '/cliente/inicio') await clientPage.goto(`${baseURL}${ruta}`, { timeout: 180000 })
    for (const width of [390, 768, 1280]) {
      await clientPage.setViewportSize({ width, height: 900 })
      await clientPage.screenshot({ path: join(CAPTURAS, `${pantalla}-${width}.png`), fullPage: true, animations: 'disabled' })
      const desborde = await clientPage.evaluate(() => {
        if (document.documentElement.scrollWidth <= window.innerWidth) return null
        // Nombrar al culpable DE VERDAD: un hijo de carrusel también tiene un
        // rect fuera del viewport, pero su contenedor lo recorta y no ensancha
        // el documento. Solo cuenta quien no tiene ningún ancestro que recorte
        // en X entre él y el body.
        // Sin funciones internas: tsx las decora con un helper (`__name`) que
        // no existe dentro de la página y `evaluate` revienta al serializar.
        const anchos: string[] = []
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = el.getBoundingClientRect()
          if (r.right <= window.innerWidth + 1 && r.left >= -1) continue
          let p = el.parentElement
          let recortado = false
          while (p && p !== document.body) {
            const o = getComputedStyle(p).overflowX
            if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') {
              recortado = true
              break
            }
            p = p.parentElement
          }
          if (recortado) continue
          const clases = (el.className && typeof el.className === 'string')
            ? '.' + el.className.split(/\s+/).slice(0, 4).join('.')
            : ''
          anchos.push(`${el.tagName.toLowerCase()}${clases} [${Math.round(r.left)}..${Math.round(r.right)}]`)
          if (anchos.length >= 10) break
        }
        // Segunda pasada: si ningún rect sobresale, el ancho se propaga por
        // una cadena de contenedores SIN recorte cuyo contenido desborda.
        // Se listan esos eslabones (scrollWidth > clientWidth y overflow
        // visible): el más profundo es el origen.
        const cadena: string[] = []
        for (const el of Array.from(document.querySelectorAll('html, body, body *'))) {
          const o = getComputedStyle(el).overflowX
          const clip = o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip'
          if (!clip && el.scrollWidth > el.clientWidth + 1) {
            const clases = (el.className && typeof el.className === 'string')
              ? '.' + el.className.split(/\s+/).slice(0, 4).join('.')
              : ''
            cadena.push(`${el.tagName.toLowerCase()}${clases} {client:${el.clientWidth} scroll:${el.scrollWidth}}`)
          }
          if (cadena.length >= 14) break
        }
        // Tercera pasada: los `position:absolute/fixed` ESCAPAN del recorte de
        // un ancestro overflow-hidden no posicionado — el clásico que las dos
        // pasadas anteriores no ven. Se listan los que sobresalen, con su
        // offsetParent para saber contra qué se están posicionando.
        const flotantes: string[] = []
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const pos = getComputedStyle(el).position
          if (pos !== 'absolute' && pos !== 'fixed') continue
          const r = el.getBoundingClientRect()
          if (r.right <= window.innerWidth + 1 && r.left >= -1) continue
          const clases = (el.className && typeof el.className === 'string')
            ? '.' + el.className.split(/\s+/).slice(0, 4).join('.')
            : ''
          const padre = (el as HTMLElement).offsetParent
          const clasesPadre = padre && typeof (padre as HTMLElement).className === 'string'
            ? '.' + (padre as HTMLElement).className.split(/\s+/).slice(0, 3).join('.')
            : String(padre?.tagName ?? 'null')
          flotantes.push(`${el.tagName.toLowerCase()}${clases} [${Math.round(r.left)}..${Math.round(r.right)}] sobre ${clasesPadre}`)
          if (flotantes.length >= 8) break
        }
        return { scrollWidth: document.documentElement.scrollWidth, culpables: anchos, cadena, flotantes }
      })
      assert.equal(
        desborde,
        null,
        `${pantalla} desborda horizontalmente a ${width}px:\n${JSON.stringify(desborde, null, 2)}`
      )
    }
  }
  // El perfil de empresa retail: no basta con que cargue sin desbordar —
  // cabecera, planes y la reseña real tienen que estar.
  paginaDiagnostico = clientPage
  await clientPage.setViewportSize({ width: 390, height: 900 })
  await clientPage.goto(`${baseURL}/cliente/empresas/qa-home-a-${suffix}`, { timeout: 180000 })
  await expect(
    clientPage.getByRole('heading', { name: `QA Home a ${suffix}`, exact: true })
  ).toBeVisible({ timeout: 120000 })
  await expect(
    clientPage.getByRole('heading', { name: 'Planes de membresía' })
  ).toBeVisible({ timeout: 60000 })
  // `.first()`: el comentario vive dos veces en el perfil — el formulario
  // «Actualiza tu reseña» lo precarga y la lista de opiniones lo enseña.
  await expect(
    clientPage.getByText('Excelente servicio, el equipo es muy profesional.').first()
  ).toBeVisible({ timeout: 60000 })
  console.log('E2E: el perfil de empresa enseña cabecera, planes y reseñas reales.')

  // Cuenta y Configuración son pantallas SEPARADAS (decisión del usuario):
  // el engranaje de Cuenta lleva a /cliente/ajustes, y en Cuenta no queda
  // ninguna sección de configuración.
  await clientPage.goto(`${baseURL}/cliente/perfil`, { timeout: 180000 })
  await expect(clientPage.getByRole('link', { name: 'Configuración de la cuenta' })).toBeVisible({ timeout: 60000 })
  await expect(clientPage.getByText('Configuración y soporte')).toHaveCount(0)
  await expect(clientPage.getByText('Cerrar sesión')).toHaveCount(0)
  await clientPage.goto(`${baseURL}/cliente/ajustes`, { timeout: 180000 })
  await expect(clientPage.getByRole('heading', { name: 'Configuración' })).toBeVisible({ timeout: 60000 })
  await expect(clientPage.getByText('Cerrar sesión')).toBeVisible({ timeout: 60000 })
  console.log('E2E: Cuenta y Configuración viven separadas; el engranaje conecta las dos.')
  await clientPage.goto(`${baseURL}/cliente/inicio`, { timeout: 180000 })
  await clientPage.setViewportSize({ width: 390, height: 900 })
  await clientPage.goto(`${baseURL}/cliente/buscar?q=${query}`, { timeout: 180000 })
  await expect(clientPage.getByText(`${equivalent} visible`, { exact: true })).toBeVisible({ timeout: 120000 })
  await expect(clientPage.getByText(`${equivalent} privada`, { exact: true })).toHaveCount(0)
  console.log('E2E: sinónimo encuentra promoción pública y no expone empresa sin publicar.')
  // La pantalla de administración de sinónimos enseña la fila sembrada
  // (término → equivalencia) — es la misma tabla que acaba de responder la
  // búsqueda de arriba.
  await adminPage.goto(`${baseURL}/admin/sinonimos`, { timeout: 180000 })
  await expect(adminPage.getByText(query, { exact: true })).toBeVisible({ timeout: 120000 })
  await expect(adminPage.getByText(equivalent, { exact: true })).toBeVisible({ timeout: 60000 })
  await adminPage.screenshot({ path: join(CAPTURAS, 'admin-sinonimos-1280.png'), fullPage: true, animations: 'disabled' })
  console.log('E2E: la pantalla de sinónimos de la empresa enseña sus equivalencias.')
  // De vuelta al editor: el paso siguiente pulsa su botón «Pausar».
  await adminPage.goto(`${baseURL}/admin/personalizacion`, { timeout: 180000 })
  await adminPage.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(adminPage.getByText('Sin publicación', { exact: true })).toBeVisible({ timeout: 120000 })
  await clientPage.goto(`${baseURL}/cliente/inicio`, { timeout: 180000 })
  await expect(clientPage.getByRole('heading', { name: title })).toHaveCount(0)
  // Sin composición, el cliente NO cae a un respaldo: ve el diseño por defecto
  // con los bloques del marketplace. Este es exactamente el fallo que el
  // usuario vio en su base real —donde nadie ha publicado— y no puede volver.
  await expect(
    clientPage.getByRole('heading', { name: 'Membresías recomendadas' })
  ).toBeVisible({ timeout: 60000 })
  await expect(
    clientPage.getByRole('heading', { name: 'Empresas destacadas' })
  ).toBeVisible({ timeout: 60000 })
  await clientPage.setViewportSize({ width: 390, height: 900 })
  await clientPage.screenshot({ path: join(CAPTURAS, 'inicio-defecto-390.png'), fullPage: true, animations: 'disabled' })
  console.log('E2E: pausada la composición, el Inicio sigue siendo el del diseño (por defecto).')

  // El perfil de la promoción: galería con miniaturas, estrellas junto a la
  // empresa y la sección de reseñas con el comentario real del cliente.
  await clientPage.getByRole('heading', { name: 'Beneficios y membresías' }).waitFor({ timeout: 60000 }).catch(() => null)
  await clientPage.setViewportSize({ width: 390, height: 900 })
  await clientPage.goto(`${baseURL}/cliente/inicio`, { timeout: 180000 })
  // :visible — el popup del motor renderiza un enlace a promoción que vive
  // oculto en el DOM; sin el filtro, .first() lo elige y espera para siempre.
  paginaDiagnostico = clientPage
  // Directo al perfil de la promo QA por su id: el hero por defecto ordena por
  // destacadas de TODO el marketplace, así que con datos demo sembrados la
  // primera tarjeta puede ser de otra empresa — y eso está bien.
  await clientPage.goto(`${baseURL}/cliente/promociones/${promoVisibleId}`, { timeout: 180000 })
  await expect(clientPage.getByText(`Reseñas de clientes de QA Home a ${suffix}`)).toBeVisible({ timeout: 120000 })
  await expect(clientPage.getByText('Excelente servicio, el equipo es muy profesional.')).toBeVisible({ timeout: 60000 })
  await expect(clientPage.getByRole('tab', { name: 'Imagen 2 de 3' })).toBeVisible({ timeout: 60000 })
  assert.equal(
    await clientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'el perfil de la promoción desborda horizontalmente a 390px'
  )
  await clientPage.screenshot({ path: join(CAPTURAS, 'promo-perfil-390.png'), fullPage: true, animations: 'disabled' })
  console.log('E2E: el perfil de la promoción enseña galería, estrellas y reseñas reales.')
} catch (error) {
  if (paginaDiagnostico) {
    console.error('URL observada:', paginaDiagnostico.url())
    console.error('Pantalla observada:', await paginaDiagnostico.locator('body').innerText())
    await paginaDiagnostico.screenshot({ path: join(CAPTURAS, 'error.png'), fullPage: true })
  }
  throw error
} finally {
  await browser?.close()
  if (companies.length) {
    await db.homeRevision.deleteMany({ where: { companyId: { in: companies } } })
    await db.busquedaSinonimo.deleteMany({ where: { companyId: { in: companies } } })
    await db.auditLog.deleteMany({ where: { companyId: { in: companies } } })
    await db.promocion.deleteMany({ where: { companyId: { in: companies } } })
    await db.plan.deleteMany({ where: { companyId: { in: companies } } })
    // Visitar Configuración (/cliente/ajustes) le asigna su código corto de
    // referido a la persona, y eso
    // deja eventos colgando de `Cliente`. Sin borrarlos antes, la limpieza
    // muere con una clave foránea y deja TODAS las fixtures puestas: el fallo
    // no es el evento, es quedarse a medias.
    const fichas = await db.cliente.findMany({
      where: { companyId: { in: companies } },
      select: { id: true },
    })
    if (fichas.length > 0) {
      const ids = fichas.map((c) => c.id)
      await db.referralEvent.deleteMany({ where: { clienteId: { in: ids } } })
    }
    await db.cliente.deleteMany({ where: { companyId: { in: companies } } })
    await db.companyFollow.deleteMany({ where: { companyId: { in: companies } } })
    await db.companyToCategory.deleteMany({ where: { companyId: { in: companies } } })
  }
  for (const account of accounts) {
    if (account.localId) await db.user.deleteMany({ where: { id: account.localId } })
    const removed = await auth.auth.admin.deleteUser(account.id)
    if (removed.error) console.error('No se pudo retirar una identidad QA:', account.id)
  }
  if (companies.length) await db.company.deleteMany({ where: { id: { in: companies } } })
  if (categoryId) await db.businessCategory.delete({ where: { id: categoryId } })
  await db.$disconnect()
  console.log('Limpieza limitada a las fixtures creadas por esta ejecución.')
}
