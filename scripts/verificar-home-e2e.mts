import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
  for (const id of companies) {
    await db.promocion.create({ data: {
      companyId: id, titulo: `${equivalent} ${id === companyId ? 'visible' : 'privada'}`, descripcion: 'QA de publicación',
      activo: true, isFeatured: true, visibilidad: 'publica', publicadaEn: new Date('2020-01-01'),
      vigenciaDesde: new Date('2020-01-01'), vigenciaHasta: new Date('2099-01-01'),
      esComprable: true, precio: 0, imagenUrl: '/icon-512.png',
    } })
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
    const metadata = { role, dbUserId: local.id, companyId, clienteId: cliente?.id ?? null }
    const synced = await auth.auth.admin.updateUserById(identity, { app_metadata: metadata })
    if (synced.error) throw new Error('No se pudo asignar contexto QA')
    if (cliente) {
      await db.customerLocation.create({ data: { userId: local.id, isPrimary: true, source: 'MAP_SELECTION',
        latitud: 18.6, longitud: -68.7, consentForPersonalization: true } })
      await db.geoConsent.create({ data: { userId: local.id, tipo: 'MARKETING_GEO', estado: 'ACTIVE', version: 'QA', canal: 'qa-home' } })
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
  for (const width of [390, 768, 1280]) {
    await clientPage.setViewportSize({ width, height: 900 })
    await clientPage.screenshot({ path: `C:/Users/starl/AppData/Local/Temp/opencode/home-f2c-${width}.png`, fullPage: true })
    assert.equal(await clientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  }
  await clientPage.goto(`${baseURL}/cliente/buscar?q=${query}`, { timeout: 180000 })
  await expect(clientPage.getByText(`${equivalent} visible`, { exact: true })).toBeVisible({ timeout: 120000 })
  await expect(clientPage.getByText(`${equivalent} privada`, { exact: true })).toHaveCount(0)
  console.log('E2E: sinónimo encuentra promoción pública y no expone empresa sin publicar.')
  await adminPage.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(adminPage.getByText('Sin publicación', { exact: true })).toBeVisible({ timeout: 120000 })
  await clientPage.goto(`${baseURL}/cliente/inicio`, { timeout: 180000 })
  await expect(clientPage.getByRole('heading', { name: title })).toHaveCount(0)
  console.log('E2E: pausa retira la composición; capturas 390/768/1280 guardadas sin overflow.')
} catch (error) {
  if (paginaDiagnostico) {
    console.error('URL observada:', paginaDiagnostico.url())
    console.error('Pantalla observada:', await paginaDiagnostico.locator('body').innerText())
    await paginaDiagnostico.screenshot({ path: 'C:/Users/starl/AppData/Local/Temp/opencode/home-f2c-error.png', fullPage: true })
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
    await db.cliente.deleteMany({ where: { companyId: { in: companies } } })
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
