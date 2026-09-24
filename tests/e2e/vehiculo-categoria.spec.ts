import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'

/**
 * E2E — Todo 16: categoría única preseleccionada, cero categorías = EmptyState,
 * dos o más = selector operativo.
 *
 * Tres estados, tres pruebas. Cada una manipula la BD solo cuando necesita
 * forzar un estado distinto al seed (0 y >=2 categorías) y RESTAURA al final.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'

type Cookie = {
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'Lax'
}

let cookies: Cookie[] | null = null
let motivoSkip: string | null = null

function deEnv(clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave]
  try {
    const txt = fs.readFileSync('.env', 'utf8')
    const m = txt.match(new RegExp(`^${clave}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'))
    return m?.[1]
  } catch {
    return undefined
  }
}

async function obtenerCookiesSesion(): Promise<Cookie[] | null> {
  const supa = deEnv('E2E_SUPABASE_URL') ?? deEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anon = deEnv('E2E_SUPABASE_ANON_KEY') ?? deEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!supa || !anon) return null

  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch(() => null)
  if (!r?.ok) return null

  const s = (await r.json()) as Record<string, unknown>
  s.expires_at = Math.floor(Date.now() / 1000) + Number(s.expires_in ?? 3600)
  const valor = 'base64-' + Buffer.from(JSON.stringify(s), 'utf8').toString('base64url')

  const ref = new URL(supa).hostname.split('.')[0]
  const nombre = `sb-${ref}-auth-token`
  const MAX = 3180
  const partes: { name: string; value: string }[] = []
  if (valor.length <= MAX) partes.push({ name: nombre, value: valor })
  else
    for (let i = 0; i * MAX < valor.length; i++)
      partes.push({ name: `${nombre}.${i}`, value: valor.slice(i * MAX, (i + 1) * MAX) })

  const dominio = new URL(BASE).hostname
  return partes.map((p) => ({
    ...p,
    domain: dominio,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }))
}

async function asegurarSesion(page: Page, context: BrowserContext): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  if (!new URL(page.url()).pathname.startsWith('/login')) return

  const formularioPresente = await page.locator('#email').isVisible({ timeout: 10_000 }).catch(() => false)
  if (formularioPresente) {
    await page.locator('#email').fill(EMAIL)
    await page.locator('#password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Entrar' }).click()
    const entro = await page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (entro) return
  }

  if (cookies) await context.addCookies(cookies)
}

test.beforeAll(async () => {
  cookies = await obtenerCookiesSesion()
  if (!cookies) motivoSkip = 'sin Supabase de pruebas: no se pudo crear sesión de cliente'
})

test.use({ viewport: { width: 1280, height: 1100 } })

test.beforeEach(async ({ page, context }) => {
  test.skip(Boolean(motivoSkip), motivoSkip ?? '')
  test.setTimeout(60_000)
  await asegurarSesion(page, context)
})

// ─── Helpers de BD ────────────────────────────────────────────────────────────

const prisma = new PrismaClient()

const COMPANY_ID = 'cmt90uf3100auuikw1hai4cul'

async function getActiveCategories() {
  return prisma.tipoVehiculo.findMany({
    where: { companyId: COMPANY_ID, activo: true },
    select: { id: true, nombre: true, activo: true },
    orderBy: { orden: 'asc' },
  })
}

async function setAllCategoriesActive(active: boolean) {
  await prisma.tipoVehiculo.updateMany({
    where: { companyId: COMPANY_ID },
    data: { activo: active },
  })
}

async function createExtraCategory(nombre: string) {
  return prisma.tipoVehiculo.create({
    data: {
      companyId: COMPANY_ID,
      nombre,
      activo: true,
      orden: 99,
      nivelTarifario: 2,
    },
  })
}

async function deleteCategory(id: string) {
  await prisma.tipoVehiculo.delete({ where: { id } }).catch(() => {})
}

// ─── ESTADO 1: exactamente 1 categoría activa ────────────────────────────────

test('1 categoría: preseleccionada y reducida a texto (sin radio)', async ({ page }) => {
  const cats = await getActiveCategories()
  test.skip(cats.length !== 1, `seed tiene ${cats.length} categorías, se espera 1`)

  await page.goto('/cliente/vehiculos/nuevo', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#placa')).toBeVisible({ timeout: 15_000 })

  // No hay radiogroup ni radios cuando hay 1 categoría
  await expect(page.locator('[role="radiogroup"]')).toHaveCount(0)
  await expect(page.locator('input[type="radio"][name="tipoVehiculoId"]')).toHaveCount(0)

  // Hay un hidden input con el valor de la categoría
  const hidden = page.locator('input[type="hidden"][name="tipoVehiculoId"]')
  await expect(hidden).toHaveCount(1)
  await expect(hidden).toHaveValue(cats[0].id)

  // El nombre de la categoría se muestra como texto
  await expect(page.getByText(cats[0].nombre)).toBeVisible()

  // El formulario sigue siendo submittable (botón presente y enabled)
  const submit = page.locator('main form button[type="submit"]')
  await expect(submit).toBeVisible()
  await expect(submit).toBeEnabled()
})

// ─── ESTADO 2: cero categorías activas → EmptyState ──────────────────────────

test('0 categorías: EmptyState sin formulario', async ({ page }) => {
  const original = await getActiveCategories()

  try {
    await setAllCategoriesActive(false)

    await page.goto('/cliente/vehiculos/nuevo', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('domcontentloaded')

    // EmptyState visible (el título del EmptyState)
    await expect(page.getByText('Sin categorías de vehículo')).toBeVisible({ timeout: 15_000 })

    // No hay formulario submittable
    await expect(page.locator('main form')).toHaveCount(0)
    await expect(page.locator('button[type="submit"]')).toHaveCount(0)

    // No hay placa ni radiogroup
    await expect(page.locator('#placa')).toHaveCount(0)
    await expect(page.locator('[role="radiogroup"]')).toHaveCount(0)
  } finally {
    // Restaurar: todas las categorías originales vuelven a activo=true
    await setAllCategoriesActive(true)
    // Verificar que el estado se restauró
    const restored = await getActiveCategories()
    test.info().annotations.push({
      type: 'db-restore',
      description: `Restored ${restored.length} active categories (was ${original.length})`,
    })
  }
})

// ─── ESTADO 3: ≥2 categorías → selector operativo con dientes ────────────────

test('≥2 categorías: selector operativo, se puede cambiar la selección', async ({ page }) => {
  const original = await getActiveCategories()
  let extraId: string | null = null

  try {
    // Asegurar que hay al menos 1 activa y añadir una segunda
    if (original.length < 1) {
      await setAllCategoriesActive(true)
    }
    const extra = await createExtraCategory(`SUV (QA-T16-${Date.now()})`)
    extraId = extra.id

    const cats = await getActiveCategories()
    test.skip(cats.length < 2, `se necesitan ≥2 categorías activas, hay ${cats.length}`)

    await page.goto('/cliente/vehiculos/nuevo', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#placa')).toBeVisible({ timeout: 15_000 })

    // Radiogroup presente y visible
    await expect(page.locator('[role="radiogroup"]')).toBeVisible()

    // Al menos 2 radios
    const radios = page.locator('input[type="radio"][name="tipoVehiculoId"]')
    await expect(radios).toHaveCount(cats.length)

    // Ningún radio está preseleccionado por defecto (≥2 categorías)
    const checked = page.locator('input[type="radio"][name="tipoVehiculoId"]:checked')
    await expect(checked).toHaveCount(0)

    // El submit está presente
    const submit = page.locator('main form button[type="submit"]')
    await expect(submit).toBeVisible()
    await expect(submit).toBeEnabled()

    // DIENTES: seleccionar la segunda categoría y verificar que queda checked
    // Los radios son sr-only (hidden), así que usamos force: true
    const secondRadio = radios.nth(1)
    await secondRadio.check({ force: true })
    await expect(secondRadio).toBeChecked()

    // La primera NO está checked
    const firstRadio = radios.nth(0)
    await expect(firstRadio).not.toBeChecked()

    // Se puede volver a la primera
    await firstRadio.check({ force: true })
    await expect(firstRadio).toBeChecked()
    await expect(secondRadio).not.toBeChecked()
  } finally {
    if (extraId) await deleteCategory(extraId)
    // Restaurar el estado original de activo
    for (const c of original) {
      await prisma.tipoVehiculo.update({ where: { id: c.id }, data: { activo: c.activo } }).catch(() => {})
    }
    const restored = await getActiveCategories()
    test.info().annotations.push({
      type: 'db-restore',
      description: `Restored ${restored.length} active categories (was ${original.length}), extra deleted`,
    })
  }
})
