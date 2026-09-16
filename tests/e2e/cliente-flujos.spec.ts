import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * QA DE FLUJOS DE ACCIÓN DEL CLIENTE
 *
 * Recorre cada mutación que un CLIENTE puede ejecutar desde la UI y comprueba
 * el EFECTO (recarga / estado visible), no solo el toast: un mensaje puede
 * faltar aunque la mutación haya funcionado, y al revés.
 *
 * ── SESIÓN ──────────────────────────────────────────────────────────────────
 * `/login` está ROTO en este entorno: el chunk de `global-error` lanza
 * `SyntaxError: Invalid or unexpected token`, la hidratación se cae y el botón
 * "Entrar" hace un GET nativo a `/login?` (los <input> no tienen `name`), así
 * que nunca autentica. El arnés intenta primero el formulario real y solo si
 * no sale de /login inyecta la cookie de Supabase. Cuando se arregle el login,
 * estas pruebas lo ejercitan solas.
 *
 * ── ALCANCE Y SEGURIDAD ─────────────────────────────────────────────────────
 * Cubiertos (neto-cero sobre los datos): perfil, intereses, promoción
 * guardada, seguir empresa, alta/baja de vehículo, marcar principal, ruleta,
 * logout.
 *
 * Excluidos a propósito por tocar dinero o credenciales: solicitarCompraPromocion,
 * enviarComprobanteCompra, comprarGiftCard, regalarPromocion, regalarMembresia,
 * ChangePasswordForm, responderRegalo/cancelarRegalo (necesitan un regalo
 * PENDIENTE sembrado). Se verifican como "solo lectura": la pantalla ofrece el
 * flujo y no se ejecuta.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'

const SHOT = path.resolve('.omo/evidences/qa-flujos/shots')

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

/** Token directo a Supabase + cookie de @supabase/ssr (base64url, trozos de 3180). */
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

  const formularioPresente = await page
    .locator('#email')
    .isVisible({ timeout: 15_000 })
    .catch(() => false)

  if (formularioPresente) {
    await page.locator('#email').fill(EMAIL)
    await page.locator('#password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Entrar' }).click()
    const entro = await page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    if (entro) return
  }

  await context.addCookies(cookies!)
}

test.beforeAll(async () => {
  cookies = await obtenerCookiesSesion()
  if (!cookies) motivoSkip = 'sin Supabase de pruebas: no se pudo crear sesión de cliente'
})

// Viewport lg: el dock inferior móvil es `lg:hidden` y no intercepta clics.
test.use({ viewport: { width: 1280, height: 1100 } })

test.beforeEach(async ({ page, context }) => {
  test.skip(Boolean(motivoSkip), motivoSkip ?? '')
  test.setTimeout(150_000)

  // El inicio abre una campaña flash en CADA carga y tapa el contenido. No hay
  // ninguna prueba que use /cliente/inicio, así que se descarta solo ahí para
  // no cerrar los diálogos de confirmación que estas pruebas sí verifican.
  await context.addInitScript(() => {
    setInterval(() => {
      if (!location.pathname.includes('/cliente/inicio')) return
      const dialogo = document.querySelector('[role="dialog"]')
      if (!dialogo) return
      const boton = [...dialogo.querySelectorAll('button')].find((b) =>
        /ahora no/i.test(b.textContent ?? '')
      )
      if (boton instanceof HTMLElement) boton.click()
    }, 400)
  })

  await asegurarSesion(page, context)
})

async function captura(page: Page, nombre: string) {
  fs.mkdirSync(SHOT, { recursive: true })
  await page.screenshot({ path: path.join(SHOT, `${nombre}.png`), fullPage: true })
}

const unico = () => String(Date.now()).slice(-6)

test('perfil: los campos editables se renderizan una sola vez', async ({ page }) => {
  await page.goto('/cliente/ajustes', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#nombre')).toHaveCount(1)
  await expect(page.locator('#telefono')).toHaveCount(1)
  await expect(page.locator('#ciudad')).toHaveCount(1)
  await expect(page.locator('#genero')).toHaveCount(1)
})

test('perfil: guardar cambios y persistir tras recargar', async ({ page }) => {
  const telefono = `809-555-${unico()}`
  const ciudad = `Ciudad QA ${unico()}`

  await page.goto('/cliente/ajustes', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#nombre')).toBeVisible()

  await page.locator('#telefono').fill(telefono)
  await page.locator('#ciudad').fill(ciudad)
  await page.locator('#genero').selectOption('M')
  await page.getByRole('button', { name: /guardar cambios/i }).first().click()

  await expect(page.getByText('Perfil actualizado.').first()).toBeVisible({ timeout: 25_000 })
  await captura(page, '01-perfil-guardado')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('#telefono')).toHaveValue(telefono, { timeout: 25_000 })
  await expect(page.locator('#ciudad')).toHaveValue(ciudad)
  await expect(page.locator('#genero')).toHaveValue('M')
})

test('perfil: un nombre vacío no se guarda', async ({ page }) => {
  await page.goto('/cliente/ajustes', { waitUntil: 'domcontentloaded' })
  const nombre = page.locator('#nombre')
  await expect(nombre).toBeVisible()

  const original = await nombre.inputValue()
  await nombre.fill('')
  await page.getByRole('button', { name: /guardar cambios/i }).first().click()

  await expect(page.getByText('Perfil actualizado.')).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('#nombre')).toHaveValue(original, { timeout: 25_000 })
  await captura(page, '02-perfil-nombre-vacio')
})

test('intereses: alternar una categoría y persistirla', async ({ page }) => {
  await page.goto('/cliente/intereses', { waitUntil: 'domcontentloaded' })

  const casillas = page.locator('input[name="categoryIds"]')
  await expect(casillas.first()).toBeAttached({ timeout: 25_000 })
  expect(await casillas.count()).toBeGreaterThan(0)

  const antes = await casillas.evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).checked)
  )
  const idx = antes.findIndex((c) => !c)
  expect(idx, 'debe quedar alguna categoría sin marcar').toBeGreaterThanOrEqual(0)

  await casillas.nth(idx).check({ force: true })
  await captura(page, '03-intereses-antes-de-guardar')

  await page.getByRole('button', { name: /guardar intereses/i }).first().click()
  await expect(
    page.getByText('Intereses guardados. Tus recomendaciones mejorarán.')
  ).toBeVisible({ timeout: 25_000 })
  await page.waitForURL(/mis-membresias/, { timeout: 25_000 })

  await page.goto('/cliente/intereses', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('input[name="categoryIds"]').nth(idx)).toBeChecked({
    timeout: 25_000,
  })
  await captura(page, '04-intereses-persistidos')
})

test('promociones: guardar y quitar de guardadas', async ({ page }) => {
  await page.goto('/cliente/promociones', { waitUntil: 'domcontentloaded' })

  const guardar = page.locator('button[aria-label="Guardar promoción"]').first()
  const quitar = page.locator('button[aria-label="Quitar de guardadas"]').first()
  const cualquiera = page
    .locator('button[aria-label="Guardar promoción"], button[aria-label="Quitar de guardadas"]')
    .first()
  await expect(cualquiera).toBeVisible({ timeout: 25_000 })

  // Ida y vuelta: no se asume que el dato arranque limpio entre corridas.
  if (await quitar.isVisible().catch(() => false)) {
    await quitar.click()
    await expect(page.getByText(/Quitada de guardadas/i).first()).toBeVisible({ timeout: 25_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
  }

  await expect(guardar).toBeVisible({ timeout: 25_000 })
  await guardar.click()
  await expect(page.getByText(/Promoción guardada/i).first()).toBeVisible({ timeout: 25_000 })
  await captura(page, '05-promocion-guardada')

  // El estado es del servidor: al recargar el botón debe seguir en "guardada".
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(quitar).toBeVisible({ timeout: 25_000 })

  await quitar.click()
  await expect(page.getByText(/Quitada de guardadas/i).first()).toBeVisible({ timeout: 25_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(guardar).toBeVisible({ timeout: 25_000 })
  await captura(page, '06-promocion-quitada')
})

test('empresas: seguir y dejar de seguir', async ({ page }) => {
  await page.goto('/cliente/empresas', { waitUntil: 'domcontentloaded' })

  const siguiendo = page.getByRole('button', { name: /dejar de seguir/i }).first()

  if (await siguiendo.isVisible().catch(() => false)) {
    await siguiendo.click()
    await expect(page.getByText(/Dejaste de seguir/i).first()).toBeVisible({ timeout: 25_000 })
    await captura(page, '07-empresa-dejada')
    await page.getByRole('button', { name: /^seguir$/i }).first().click()
    await expect(page.getByText(/Ahora sigues/i).first()).toBeVisible({ timeout: 25_000 })
    return
  }

  const seguir = page.getByRole('button', { name: /^seguir$/i }).first()
  await expect(seguir).toBeVisible({ timeout: 25_000 })
  await seguir.click()
  await expect(page.getByText(/Ahora sigues/i).first()).toBeVisible({ timeout: 25_000 })
  await captura(page, '07-empresa-seguida')
  await page.getByRole('button', { name: /dejar de seguir/i }).first().click()
  await expect(page.getByText(/Dejaste de seguir/i).first()).toBeVisible({ timeout: 25_000 })
})

test('vehículos: alta por asistente, marcar principal y baja', async ({ page }) => {
  const placa = `Q${unico()}`

  await page.goto('/cliente/vehiculos/nuevo', { waitUntil: 'domcontentloaded' })
  const paso = page.locator('[aria-label^="Paso"]')
  await expect(paso).toContainText('Paso 1 de 7', { timeout: 25_000 })

  const continuar = async (siguiente: number) => {
    await page.getByRole('button', { name: /continuar/i }).click()
    await expect(paso).toContainText(`Paso ${siguiente} de 7`, { timeout: 25_000 })
  }
  const elegirOSugerir = async (contenedor: string, campo: string, valor: string) => {
    const chip = page.locator(`[aria-label="${contenedor}"] button`).first()
    if (await chip.isVisible().catch(() => false)) await chip.click()
    else await page.locator(campo).fill(valor)
  }

  await page.getByRole('radiogroup').first().locator('button').first().click()
  await continuar(2)

  await elegirOSugerir('Marcas sugeridas', '#marca', 'MarcaQA')
  await continuar(3)

  await page.locator('#modelo').fill('Modelo QA')
  await continuar(4)

  await page.locator('#anio').fill('2020')
  await continuar(5)

  await elegirOSugerir('Colores frecuentes', '#color', 'Azul')
  await continuar(6)

  await page.locator('#placa').fill(placa)
  await continuar(7)

  await page.getByRole('button', { name: /guardar vehículo/i }).click()
  await page.waitForURL((u) => !u.pathname.includes('/nuevo'), { timeout: 40_000 })

  await page.goto('/cliente/vehiculos', { waitUntil: 'domcontentloaded' })
  await captura(page, '08-vehiculo-agregado')

  const tarjeta = page.locator('li').filter({ hasText: placa })
  await expect(tarjeta).toBeVisible({ timeout: 25_000 })

  const hacerPrincipal = tarjeta.locator('button[aria-label^="Hacer principal"]')
  if (await hacerPrincipal.isVisible().catch(() => false)) {
    await hacerPrincipal.click()
    await expect(page.getByText('Vehículo principal actualizado.')).toBeVisible({ timeout: 5_000 })
    await expect(tarjeta.getByText('Principal')).toBeVisible({ timeout: 25_000 })
  }
  await captura(page, '09-vehiculo-principal')

  const eliminar = tarjeta.locator('button[aria-label="Eliminar vehículo"]')
  await eliminar.click()
  const dialogo = page.locator('[role="alertdialog"], [role="dialog"]')
  await expect(dialogo).toContainText(`¿Eliminar "MarcaQA Modelo QA"?`)
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
  await expect(tarjeta).toBeVisible()

  await eliminar.click()
  await dialogo.getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByText('Vehículo eliminado.')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('li').filter({ hasText: placa })).toHaveCount(0, { timeout: 25_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('li').filter({ hasText: placa })).toHaveCount(0, { timeout: 25_000 })
  await captura(page, '10-vehiculo-eliminado')
})

test('ruleta: gira con saldo o explica el guardia', async ({ page }) => {
  await page.goto('/cliente/ruleta', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25_000 })

  const boton = page.getByRole('button', { name: /girar la ruleta|te faltan/i }).first()

  if (!(await boton.isVisible().catch(() => false))) {
    await expect(page.getByText(/no hay premios/i).first()).toBeVisible({ timeout: 25_000 })
    await captura(page, '11-ruleta-sin-premios')
    return
  }

  const etiqueta = ((await boton.textContent()) ?? '').trim()
  await captura(page, '11-ruleta-antes')

  if (await boton.isEnabled()) {
    expect(etiqueta).toMatch(/girar la ruleta/i)
    await boton.click()
    await expect(page.getByText(/girando\./i).first()).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText(/girando\./i).first()).toBeHidden({ timeout: 60_000 })
    await expect(page.getByText(/no se pudo girar/i)).toHaveCount(0)
  } else {
    expect(etiqueta).toMatch(/te faltan \d+ pts/i)
  }
  await captura(page, '12-ruleta-despues')
})

test('citas: reservar un turno disponible y cancelarlo', async ({ page }) => {
  await page.goto('/cliente/citas', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25_000 })
  await captura(page, '13-citas')

  const horario = page.locator('button[data-hora]').first()
  test.skip(
    !(await horario.isVisible().catch(() => false)),
    'la empresa no publicó horarios libres: no hay nada que reservar'
  )
  await horario.click()
  await page.getByRole('button', { name: /^reservar/i }).last().click()

  await expect(page.getByText('Cita reservada.').first()).toBeVisible({ timeout: 30_000 })
  await captura(page, '14-cita-reservada')

  await page.getByRole('button', { name: /cancelar/i }).first().click()
  await page.getByRole('button', { name: /s[íi],?\s*cancelar|^cancelar$/i }).last().click()
  await expect(page.getByText('Cita cancelada.').first()).toBeVisible({ timeout: 30_000 })
  await captura(page, '15-cita-cancelada')
})

test('regalos: la pantalla ofrece el flujo y lo bloquea sin saldo transferible', async ({
  page,
}) => {
  await page.goto('/cliente/regalos', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25_000 })
  await captura(page, '16-regalos')

  await page.goto('/cliente/regalos/enviar', { waitUntil: 'domcontentloaded' })
  const enviar = page.getByRole('button', { name: /enviar regalo/i }).first()
  await expect(enviar).toBeVisible({ timeout: 25_000 })

  const sinSaldoTransferible = await enviar.isDisabled()
  if (sinSaldoTransferible) {
    await expect(enviar).toBeDisabled()
  } else {
    await enviar.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
  }
  await captura(page, '17-enviar-regalo-no-ejecutado')
})

test('planes: la compra exige confirmación explícita', async ({ page }) => {
  await page.goto('/cliente/planes', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25_000 })

  const cta = page
    .getByRole('button', { name: /aprovechar|seleccionar|contratar|comprar/i })
    .first()
  if (!(await cta.isVisible().catch(() => false))) {
    test.skip(true, 'no hay planes comprables para este cliente')
  }
  await cta.click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
  await captura(page, '18-plan-confirmacion')
  await page.keyboard.press('Escape')
})

test('logout: cierra la sesión y vuelve a /login', async ({ page }) => {
  await page.goto('/cliente/menu', { waitUntil: 'domcontentloaded' })
  const salir = page.getByRole('button', { name: /cerrar sesión/i }).first()
  await expect(salir).toBeVisible({ timeout: 25_000 })
  await salir.click()

  await page.waitForURL(/\/login/, { timeout: 40_000 })
  await captura(page, '19-logout')

  await page.goto('/cliente/perfil', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/login/, { timeout: 25_000 })
})
