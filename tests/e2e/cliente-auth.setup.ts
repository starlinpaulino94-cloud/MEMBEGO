import { test as setup } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * LOGIN ÚNICO DE CLIENTE PARA LOS E2E DE FLUJOS (todo 25).
 *
 * El limitador de login es de **5 intentos / 15 min por IP+correo**
 * (docs/PRUEBAS-E2E.md). `cliente-flujos.spec.ts` entraba por el formulario en
 * cada `beforeEach` (11 intentos por corrida): a partir del sexto cayó en
 * silencio a la inyección de cookie y las corridas dejaron de medir el login.
 *
 * Aquí se entra UNA sola vez por corrida desde el proyecto `setup` —que corre
 * antes de `movil` y `escritorio`— y el estado queda en `playwright/.auth/`.
 * El spec lo consume con `test.use({ storageState })`, así que todos los casos
 * comparten la misma sesión y el limitador no se toca.
 *
 * RESPALDO VISIBLE: si el formulario no completa (login caído o limitador ya
 * agotado), NO se cae en silencio a la cookie de Supabase. Se avisa por consola
 * y se deja constancia en `cliente-flujos.login.json` (intentos + método), que
 * el spec imprime en cada caso.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'

const AUTH_STATE = path.resolve('playwright/.auth/cliente-flujos.json')
const AUTH_META = path.resolve('playwright/.auth/cliente-flujos.login.json')

type Cookie = {
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'Lax'
}

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

/**
 * Sesión por token directo a Supabase + cookie de @supabase/ssr. NO pasa por el
 * limitador de la app: sirve solo como RESPALDO y para conocer el cliente.
 */
async function obtenerSesion(): Promise<Cookie[] | null> {
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
  return partes.map((p) => ({
    ...p,
    domain: dominio,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }))
}

setup('sesión de cliente (un solo login por corrida)', async ({ page }) => {
  setup.setTimeout(120_000)
  fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true })

  const respaldo = await obtenerSesion()
  if (!respaldo) {
    setup.skip(true, 'sin Supabase de pruebas: no hay con qué autenticar (docs/PRUEBAS-E2E.md §4)')
    return
  }

  let intentosLogin = 0
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  const enLogin = new URL(page.url()).pathname.startsWith('/login')
  let logueado = !enLogin

  const formularioPresente = enLogin
    ? await page.locator('#email').isVisible({ timeout: 15_000 }).catch(() => false)
    : false

  if (formularioPresente) {
    // ÚNICO intento real de toda la corrida: cada envío consume el limitador.
    intentosLogin++
    await page.locator('#email').fill(EMAIL)
    await page.locator('#password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Entrar' }).click()
    logueado = await page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
  }

  let metodo = 'formulario'
  let motivo: string | null = null
  if (!logueado) {
    metodo = 'cookie (respaldo)'
    motivo =
      (await page
        .locator('[role="alert"]')
        .first()
        .textContent({ timeout: 3_000 })
        .catch(() => null))?.trim() || 'el formulario no salió de /login (sin mensaje visible)'
    console.warn(
      `[cliente-auth] RESPALDO VISIBLE: el login real no completó tras ${intentosLogin} intento(s): ${motivo}. ` +
        'Se inyecta la cookie de Supabase; la corrida NO está midiendo el login real.'
    )
    await page.context().addCookies(respaldo)
  }

  await page.context().storageState({ path: AUTH_STATE })
  fs.writeFileSync(
    AUTH_META,
    JSON.stringify({ intentosLogin, metodo, motivo, cuando: new Date().toISOString() }, null, 2)
  )
  console.log(
    `[cliente-auth] intentos de login real esta corrida: ${intentosLogin} · método de sesión: ${metodo}`
  )
})
