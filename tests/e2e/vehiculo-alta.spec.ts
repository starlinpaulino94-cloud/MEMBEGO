import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'

/**
 * E2E — Alta de vehículo en UNA sola pantalla (todo 15).
 *
 * Verifica:
 *  - Estructura DOM: 1 <form>, #placa required, categoría visible, 4 opcionales, 0 [aria-label^="Paso"]
 *  - Happy path: solo placa + categoría → redirect a ?next
 *  - Dientes: placa vacía → error del servidor visible; placa duplicada → mensaje
 *  - Net-zero DB: borra el vehículo creado
 *
 * Archivo independiente de cliente-flujos.spec.ts (otra lane puede editarlo).
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
let prisma: PrismaClient | null = null
let supabaseId: string | null = null
let companyIdActivo: string | null = null
let categoriaTemporalId: string | null = null

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

// Prisma lee `DATABASE_URL` del entorno; Playwright no carga `.env`.
if (!process.env.DATABASE_URL) {
  const url = deEnv('DATABASE_URL')
  if (url) process.env.DATABASE_URL = url
}

async function obtenerSesion(): Promise<{
  cookies: Cookie[]
  supabaseId: string
  companyId: string | null
} | null> {
  const supa = deEnv('E2E_SUPABASE_URL') ?? deEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anon = deEnv('E2E_SUPABASE_ANON_KEY') ?? deEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!supa || !anon) return null

  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch(() => null)
  if (!r?.ok) return null

  const s = (await r.json()) as Record<string, unknown> & {
    user?: { id?: string; app_metadata?: { companyId?: string } }
  }
  if (!s.user?.id) return null
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
  return {
    supabaseId: s.user.id,
    companyId: s.user.app_metadata?.companyId ?? null,
    cookies: partes.map((p) => ({
      ...p,
      domain: dominio,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  }
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
  const sesion = await obtenerSesion()
  if (!sesion) {
    motivoSkip = 'sin Supabase de pruebas: no se pudo crear sesión de cliente'
    return
  }
  cookies = sesion.cookies
  supabaseId = sesion.supabaseId
  companyIdActivo = sesion.companyId
  prisma = new PrismaClient()

  // La empresa activa del cliente de prueba no tiene categorías de vehículo:
  // /cliente/vehiculos/nuevo mostraría el EmptyState y no habría formulario que
  // probar. Se crea UNA categoría temporal y se borra en `afterAll` (neto-cero).
  const activas = await prisma.tipoVehiculo.count({
    where: { companyId: companyIdActivo ?? undefined, activo: true },
  })
  if (companyIdActivo && activas === 0) {
    const creada = await prisma.tipoVehiculo.create({
      data: {
        companyId: companyIdActivo,
        nombre: 'QA E2E (temporal)',
        activo: true,
        orden: 999,
        nivelTarifario: 1,
      },
      select: { id: true },
    })
    categoriaTemporalId = creada.id
  }
})

test.afterAll(async () => {
  if (prisma && categoriaTemporalId) {
    await prisma.tipoVehiculo.delete({ where: { id: categoriaTemporalId } }).catch(() => {})
  }
  await prisma?.$disconnect()
})

test.use({ viewport: { width: 1280, height: 1100 } })

test.beforeEach(async ({ page, context }) => {
  test.skip(Boolean(motivoSkip), motivoSkip ?? '')
  test.setTimeout(60_000)
  await asegurarSesion(page, context)
})

const unico = () => String(Date.now()).slice(-6)

/** Marca una categoría si hay radios; con una sola ya viaja en el hidden. */
async function elegirCategoria(page: Page) {
  const radios = page.locator('input[type="radio"][name="tipoVehiculoId"]')
  if (await radios.count()) await radios.first().check({ force: true })
  else await expect(page.locator('input[type="hidden"][name="tipoVehiculoId"]')).toHaveCount(1)
}

/** Una placa sembrada que pertenece a OTRA cuenta (todo 17 dejó A123456 propia). */
async function placaDeOtraCuenta(): Promise<string | null> {
  if (!prisma || !supabaseId) return null
  const vehiculos = await prisma.vehiculo.findMany({
    where: { cliente: { supabaseId: { not: supabaseId } } },
    select: { placaNormalizada: true },
  })
  return (
    vehiculos
      .map((v) => v.placaNormalizada)
      .find((p) => p && p.length >= 4 && /\d/.test(p)) ?? null
  )
}

// ─── ESTRUCTURA DOM ──────────────────────────────────────────────────────────

test('alta de vehículo: estructura de una sola pantalla', async ({ page }) => {
  await page.goto('/cliente/vehiculos/nuevo?next=/cliente/vehiculos', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#placa')).toBeVisible({ timeout: 15_000 })

  // Un solo <form> dentro de main (el header tiene un <form> de búsqueda)
  const forms = page.locator('main form')
  await expect(forms).toHaveCount(1)

  // #placa visible y required
  const placa = page.locator('#placa')
  await expect(placa).toBeVisible()
  await expect(placa).toHaveAttribute('aria-required', 'true')

  // Categoría: radios si hay ≥2, o el hidden preseleccionado si hay una sola.
  const radios = page.locator('input[type="radio"][name="tipoVehiculoId"]')
  if (await radios.count()) {
    await expect(page.locator('[role="radiogroup"]')).toBeVisible()
  } else {
    await expect(page.locator('input[type="hidden"][name="tipoVehiculoId"]')).toHaveCount(1)
  }

  // 4 campos opcionales visibles
  for (const id of ['#marca', '#modelo', '#anio', '#color']) {
    await expect(page.locator(id)).toBeVisible()
  }

  // CERO elementos con [aria-label^="Paso"]
  await expect(page.locator('[aria-label^="Paso"]')).toHaveCount(0)

  // Sugerencias de marcas y colores presentes
  await expect(page.locator('[aria-label="Marcas sugeridas"]')).toBeVisible()
  await expect(page.locator('[aria-label="Colores frecuentes"]')).toBeVisible()
})

// ─── HAPPY PATH: solo placa + categoría ──────────────────────────────────────

test('alta de vehículo: crear con solo placa + categoría y borrar', async ({ page }) => {
  const placa = `T15${unico()}`

  await page.goto('/cliente/vehiculos/nuevo?next=/cliente/vehiculos', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#placa')).toBeVisible({ timeout: 15_000 })

  // Llenar solo lo obligatorio
  await page.locator('#placa').fill(placa)
  await elegirCategoria(page)

  // Submit
  await page.getByRole('button', { name: /guardar vehículo/i }).click()

  // Redirect a ?next (URL must NOT contain /nuevo anymore)
  await page.waitForURL((u) => !u.pathname.includes('/nuevo'), { timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe('/cliente/vehiculos')

  // El vehículo aparece en la lista
  const tarjeta = page.locator('li').filter({ hasText: placa })
  await expect(tarjeta).toBeVisible({ timeout: 15_000 })

  // ─── NET-ZERO: borrar el vehículo creado ───
  const eliminar = tarjeta.locator('button[aria-label="Eliminar vehículo"]')
  await eliminar.click()
  const dialogo = page.locator('[role="alertdialog"]')
  await expect(dialogo).toBeVisible({ timeout: 5_000 })
  await dialogo.getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByText('Vehículo eliminado.')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('li').filter({ hasText: placa })).toHaveCount(0, { timeout: 15_000 })

  // Confirmar persistencia del borrado
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('li').filter({ hasText: placa })).toHaveCount(0, { timeout: 10_000 })
})

// ─── DIENTES: error con placa vacía ──────────────────────────────────────────

test('alta de vehículo: placa vacía muestra error del servidor', async ({ page }) => {
  await page.goto('/cliente/vehiculos/nuevo?next=/cliente/vehiculos', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#placa')).toBeVisible({ timeout: 15_000 })

  // Seleccionar categoría pero NO llenar placa
  await elegirCategoria(page)

  // Submit
  await page.getByRole('button', { name: /guardar vehículo/i }).click()

  // Error del servidor visible (Alert con role="alert" y texto)
  const alert = page.locator('form [role="alert"]')
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert).toContainText(/placa/i, { timeout: 5_000 })

  // El form sigue visible (no quedó en blanco)
  await expect(page.locator('#placa')).toBeVisible()
})

// ─── DIENTES: placa duplicada de otra cuenta ─────────────────────────────────

test('alta de vehículo: placa duplicada de otra cuenta muestra error', async ({ page }) => {
  // A123456 dejó de servir: el todo 17 normalizó esa placa como del propio
  // cliente demo, así que registrarla es idempotencia, no duplicado ajeno. Se
  // busca en la BD una placa sembrada de OTRA cuenta.
  const placaAjena = await placaDeOtraCuenta()
  test.skip(!placaAjena, 'no hay ninguna placa de otra cuenta sembrada en esta base')

  await page.goto('/cliente/vehiculos/nuevo?next=/cliente/vehiculos', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#placa')).toBeVisible({ timeout: 15_000 })

  await page.locator('#placa').fill(placaAjena!)
  await elegirCategoria(page)

  await page.getByRole('button', { name: /guardar vehículo/i }).click()

  const alert = page.locator('form [role="alert"]')
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert).toContainText('otra cuenta', { timeout: 5_000 })
})
