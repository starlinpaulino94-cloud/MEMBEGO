import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * FEEDBACK DE LAS MUTACIONES DE VEHÍCULO (todo 3)
 *
 * `marcarVehiculoPrincipal` y `eliminarVehiculo` mutaban bien pero no mostraban
 * su toast: el `useEffect` de éxito moría con el componente que la revalidación
 * retira (la tarjeta pasa a "Principal" o desaparece). Esta prueba fija la
 * OBSERVABLE que faltaba —el toast— y exige que salga EXACTAMENTE una vez.
 *
 * ── SESIÓN ──────────────────────────────────────────────────────────────────
 * Cero logins por formulario: se pide un token a Supabase local y se inyectan
 * las cookies `sb-<ref>-auth-token` (base64url, trozos de 3180). El limitador
 * de login (5 intentos / 15 min) no se toca.
 *
 * ── DATOS ───────────────────────────────────────────────────────────────────
 * Neto-cero: cada prueba siembra sus vehículos con placa `Q…` por Prisma y los
 * borra al terminar (incluidas filas `Q…` dejadas por corridas anteriores). El
 * `esPrincipal` original se restaura al final para no reordenar el garaje real.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'

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

type Cookie = {
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'Lax'
}

/** Token directo a Supabase + cookie de @supabase/ssr (base64url, trozos de 3180). */
async function obtenerSesion(): Promise<{ cookies: Cookie[]; supabaseId: string } | null> {
  const supa = deEnv('E2E_SUPABASE_URL') ?? deEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anon = deEnv('E2E_SUPABASE_ANON_KEY') ?? deEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!supa || !anon) return null

  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch(() => null)
  if (!r?.ok) return null

  const s = (await r.json()) as Record<string, unknown> & { user?: { id?: string } }
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

// Viewport lg: el dock inferior móvil es `lg:hidden` y no intercepta clics.
test.use({ viewport: { width: 1280, height: 1100 } })

let prisma: PrismaClient
let cookies: Cookie[] | null = null
let motivoSkip: string | null = null
let clienteId = ''
let principalOriginal: string | null = null

const unico = () => String(Date.now()).slice(-7)

async function contarQ(): Promise<number> {
  return prisma.vehiculo.count({ where: { placa: { startsWith: 'Q' } } })
}

async function limpiarQ(): Promise<number> {
  const { count } = await prisma.vehiculo.deleteMany({ where: { placa: { startsWith: 'Q' } } })
  return count
}

async function sembrar(placa: string, esPrincipal: boolean): Promise<string> {
  const v = await prisma.vehiculo.create({
    data: {
      clienteId,
      marca: 'MarcaQA',
      modelo: 'Modelo QA',
      anio: 2021,
      color: 'Azul',
      placa,
      placaNormalizada: placa,
      pais: 'DO',
      esPrincipal,
    },
    select: { id: true },
  })
  return v.id
}

function tarjeta(page: Page, placa: string) {
  return page.locator('li').filter({ hasText: placa })
}

const EVID = process.env.E2E_EVIDENCE_DIR

async function captura(page: Page, nombre: string) {
  if (!EVID) return
  fs.mkdirSync(EVID, { recursive: true })
  await page.screenshot({ path: path.join(EVID, `${nombre}.png`), fullPage: true })
}

// `domcontentloaded` dispara antes de que el bundle cliente hidrate: el primer
// clic se perdería. `networkidle` + un respiro deja la página interactiva.
async function abrirVehiculos(page: Page) {
  await page.goto('/cliente/vehiculos', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

test.beforeAll(async () => {
  const sesion = await obtenerSesion()
  if (!sesion) {
    motivoSkip = 'sin Supabase local: no se pudo crear sesión de cliente'
    return
  }
  cookies = sesion.cookies
  prisma = new PrismaClient()

  const ficha = await prisma.cliente.findFirst({
    where: { supabaseId: sesion.supabaseId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!ficha) {
    motivoSkip = 'el usuario de prueba no tiene ficha de cliente'
    return
  }
  clienteId = ficha.id

  const principal = await prisma.vehiculo.findFirst({
    where: { clienteId, esPrincipal: true },
    select: { id: true },
  })
  principalOriginal = principal?.id ?? null

  // Higiene: fuera cualquier vehículo de corridas anteriores.
  console.warn('[db] vehículos Q antes de esta corrida:', await contarQ())
  await limpiarQ()
  console.warn('[db] vehículos Q tras la limpieza inicial:', await contarQ())
})

test.afterAll(async () => {
  if (!prisma) return
  // Borra lo sembrado y restaura el principal que había antes de esta corrida.
  console.warn('[db] vehículos Q borrados en el cierre:', await limpiarQ())
  console.warn('[db] vehículos Q restantes:', await contarQ())
  if (principalOriginal) {
    await prisma.vehiculo
      .updateMany({ where: { id: principalOriginal }, data: { esPrincipal: true } })
      .catch(() => {})
  }
  await prisma.$disconnect()
})

test.beforeEach(async ({ context }) => {
  test.skip(Boolean(motivoSkip), motivoSkip ?? '')
  test.setTimeout(150_000)
  await context.addCookies(cookies!)
  await context.addInitScript(() => {
    const aplicar = () => {
      if (document.getElementById('qa-oculta-overlay')) return
      const estilo = document.createElement('style')
      estilo.id = 'qa-oculta-overlay'
      estilo.textContent = 'nextjs-portal{display:none!important}'
      ;(document.head ?? document.documentElement)?.appendChild(estilo)
    }
    aplicar()
    document.addEventListener('DOMContentLoaded', aplicar)
  })
})

test('marcar principal muestra el toast exactamente una vez', async ({ page }) => {
  const placa = `Q${unico()}`
  await sembrar(placa, false)

  await abrirVehiculos(page)
  const card = tarjeta(page, placa)
  await expect(card).toBeVisible({ timeout: 25_000 })

  await card.locator('button[aria-label^="Hacer principal"]').click()

  const toast = page.getByText('Vehículo principal actualizado.')
  await expect(toast).toBeVisible({ timeout: 5_000 })
  await expect(toast).toHaveCount(1)
  await expect(card.getByText('Principal', { exact: true })).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('No autorizado.')).toHaveCount(0)
  await captura(page, 'task-3-toast-marcar-principal')

  // Un solo principal por ficha: el `updateMany` que quita el anterior no dejó
  // ni dos ni ninguno.
  expect(await prisma.vehiculo.count({ where: { clienteId, esPrincipal: true } })).toBe(1)
})

test('eliminar muestra el toast exactamente una vez', async ({ page }) => {
  const placa = `Q${unico()}`
  await sembrar(placa, false)

  await abrirVehiculos(page)
  const card = tarjeta(page, placa)
  await expect(card).toBeVisible({ timeout: 25_000 })

  await card.locator('button[aria-label="Eliminar vehículo"]').click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('¿Eliminar "MarcaQA Modelo QA')
  await dialogo.getByRole('button', { name: 'Eliminar' }).click()

  const toast = page.getByText('Vehículo eliminado.')
  await expect(toast).toBeVisible({ timeout: 5_000 })
  await expect(toast).toHaveCount(1)
  await expect(card).toHaveCount(0, { timeout: 25_000 })
  await expect(page.getByText('No autorizado.')).toHaveCount(0)
  await captura(page, 'task-3-toast-eliminar')
})

test('un vehículo ya principal no ofrece la acción ni deja feedback incoherente', async ({
  page,
}) => {
  // Sembrado como principal: es el estado que la rama «ya es principal» de la
  // acción devuelve con éxito sin mutar. El botón no debe ofrecerse sobre él y
  // el cambio a otro vehículo debe seguir siendo coherente.
  const placaPrincipal = `Q${unico()}A`
  const placaOtra = `Q${unico()}B`
  await sembrar(placaPrincipal, true)
  await sembrar(placaOtra, false)

  await abrirVehiculos(page)
  const cardPrincipal = tarjeta(page, placaPrincipal)
  const cardOtra = tarjeta(page, placaOtra)
  await expect(cardPrincipal).toBeVisible({ timeout: 25_000 })
  await expect(cardOtra).toBeVisible({ timeout: 25_000 })

  await expect(cardPrincipal.getByText('Principal', { exact: true })).toBeVisible({
    timeout: 25_000,
  })
  await expect(cardPrincipal.locator('button[aria-label^="Hacer principal"]')).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText('No autorizado.')).toHaveCount(0)

  // Cambio coherente: la otra tarjeta toma el relevo, el aviso sale una vez y
  // el principal anterior vuelve a ofrecer la acción.
  await cardOtra.locator('button[aria-label^="Hacer principal"]').click()
  const toast = page.getByText('Vehículo principal actualizado.')
  await expect(toast).toBeVisible({ timeout: 5_000 })
  await expect(toast).toHaveCount(1)
  await expect(cardOtra.getByText('Principal', { exact: true })).toBeVisible({ timeout: 25_000 })
  await expect(cardPrincipal.getByText('Principal', { exact: true })).toHaveCount(0)
  await expect(cardPrincipal.locator('button[aria-label^="Hacer principal"]')).toHaveCount(1)
  await captura(page, 'task-3-ya-principal-coherente')

  expect(await prisma.vehiculo.count({ where: { clienteId, esPrincipal: true } })).toBe(1)
})
