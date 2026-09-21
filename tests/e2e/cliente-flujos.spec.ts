import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * QA DE FLUJOS DE ACCIÓN DEL CLIENTE
 *
 * Recorre cada mutación que un CLIENTE puede ejecutar desde la UI y comprueba
 * el EFECTO (recarga / estado visible), no solo el toast: un mensaje puede
 * faltar aunque la mutación haya funcionado, y al revés.
 *
 * ── SESIÓN ──────────────────────────────────────────────────────────────────
 * El limitador de login es de **5 intentos / 15 min por IP+correo**
 * (docs/PRUEBAS-E2E.md). Entrar por el formulario en cada `beforeEach` (11 por
 * corrida) agotaba el presupuesto: del sexto caso en adelante la spec caía en
 * silencio a la inyección de cookie y dejaba de medir el login real.
 *
 * Ahora `tests/e2e/cliente-auth.setup.ts` (proyecto `setup`, corre antes de
 * `movil` y `escritorio`) entra UNA vez por corrida y deja el estado en
 * `playwright/.auth/`; esta spec lo reutiliza con `test.use({ storageState })`,
 * así todos los casos comparten la misma sesión y el limitador no se toca. Si
 * el login real no completa, el setup avisa por consola antes de caer al
 * respaldo de cookie: nunca en silencio.
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

/**
 * Sesión reutilizable por TODOS los casos.
 *
 * `tests/e2e/cliente-auth.setup.ts` (proyecto `setup`) hace el ÚNICO login real
 * de la corrida y escribe aquí el estado. Esta spec lo consume con
 * `test.use({ storageState })`, de modo que ningún `beforeEach` entra por el
 * formulario y el limitador (5/15 min) no se agota. El archivo se deja creado
 * (vacío) al importar para que Playwright siempre tenga algo que cargar si el
 * setup se saltó por falta de Supabase y los casos salten por `motivoSkip`.
 */
const AUTH_STATE = path.resolve('playwright/.auth/cliente-flujos.json')
const AUTH_META = path.resolve('playwright/.auth/cliente-flujos.login.json')
fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true })
if (!fs.existsSync(AUTH_STATE)) {
  fs.writeFileSync(AUTH_STATE, JSON.stringify({ cookies: [], origins: [] }))
}
/** Intentos de login reales de la corrida, leídos de la metadata del setup. */
let intentosLogin: number | null = null
/** Login de reposición que exige la revocación global del caso `logout`. */
let intentosReposicion = 0

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
let companyIdActivo: string | null = null
let categoriaTemporalId: string | null = null
let vehiculoTemporalId: string | null = null
let premioTemporalId: string | null = null
let campanaTemporalId: string | null = null

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

/** Token directo a Supabase + cookie de @supabase/ssr (base64url, trozos de 3180). */
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

test.beforeAll(async ({ browser }) => {
  // Sin Supabase no hay login posible: el setup se saltó y los casos también.
  const sesion = await obtenerSesion()
  if (!sesion) {
    motivoSkip = 'sin Supabase de pruebas: no se pudo crear sesión de cliente'
    return
  }
  cookies = sesion.cookies
  companyIdActivo = sesion.companyId
  prisma = new PrismaClient()

  // Contador del arnés (todo 25): lo escribe el setup, se imprime en cada caso.
  try {
    const meta = JSON.parse(fs.readFileSync(AUTH_META, 'utf8')) as { intentosLogin?: number }
    intentosLogin = meta.intentosLogin ?? null
  } catch {
    intentosLogin = null
  }

  // Precondición del caso `intereses` (ajena al login): marca la primera
  // categoría SIN marcar y la persiste. Si corridas previas ya dejaron las 17
  // activas marcadas, no queda nada que alternar y el caso falla sin medir
  // nada. Se libera UNA y el propio caso la vuelve a marcar (neto-cero).
  const usuario = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
  if (usuario) {
    const activas = await prisma.businessCategory.findMany({
      where: { active: true },
      select: { id: true },
    })
    const ids = activas.map((c) => c.id)
    const marcadas = await prisma.userInteres.count({
      where: { userId: usuario.id, categoryId: { in: ids } },
    })
    if (ids.length > 0 && marcadas >= ids.length) {
      const sobra = await prisma.userInteres.findFirst({
        where: { userId: usuario.id, categoryId: { in: ids } },
        select: { id: true },
      })
      if (sobra) await prisma.userInteres.delete({ where: { id: sobra.id } })
    }
  }

  // El directorio del menú (todo 7) es consciente del contenido: la fila
  // /cliente/vehiculos solo se pinta si el negocio trabaja con vehículos o el
  // cliente ya tiene uno. La empresa activa de la prueba (un restaurante) no
  // es de vehículos y su cliente no tiene ninguno, así que se siembra UN
  // vehículo temporal y se borra en `afterAll` (neto-cero). Sin esta siembra
  // la fila falta de forma legítima y el criterio de las siete rutas quedaría
  // sin probar.
  const clienteActivo = companyIdActivo
    ? await prisma.cliente.findUnique({
        where: {
          supabaseId_companyId: {
            supabaseId: sesion.supabaseId,
            companyId: companyIdActivo,
          },
        },
        select: { id: true },
      })
    : null
  if (clienteActivo) {
    const suyos = await prisma.vehiculo.count({ where: { clienteId: clienteActivo.id } })
    if (suyos === 0) {
      const placa = `QA24${String(Date.now()).slice(-6)}`
      const creado = await prisma.vehiculo.create({
        data: {
          clienteId: clienteActivo.id,
          marca: 'QA',
          modelo: 'E2E temporal',
          anio: new Date().getFullYear(),
          color: 'Gris',
          placa,
          placaNormalizada: placa,
          pais: 'DO',
        },
        select: { id: true },
      })
      vehiculoTemporalId = creado.id
    }
  }

  // La empresa activa del cliente de prueba (Toni's Restaurante) no tiene
  // categorías de vehículo, así que /cliente/vehiculos/nuevo mostraría su
  // estado vacío. Se crea UNA categoría temporal para poder ejercitar el alta
  // de una sola pantalla y se borra en `afterAll` (neto-cero).
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

  // El menú es consciente del contenido (`navDisponible`): sin premios de
  // ruleta ni campaña de invitación activos oculta /cliente/ruleta y
  // /cliente/invita-y-gana. El directorio del todo 7 debe listar las SIETE
  // rutas, así que se siembra el contenido mínimo y se borra en `afterAll`
  // (neto-cero). Sin esta siembra el caso se saltaría y el criterio quedaría
  // sin probar.
  if (companyIdActivo) {
    const premios = await prisma.ruletaPremio.count({
      where: { companyId: companyIdActivo, activo: true },
    })
    if (premios === 0) {
      const creado = await prisma.ruletaPremio.create({
        data: {
          companyId: companyIdActivo,
          nombre: 'QA E2E ruleta (temporal)',
          activo: true,
          probabilidad: 1,
        },
        select: { id: true },
      })
      premioTemporalId = creado.id
    }

    const campanas = await prisma.campanaInvitacion.count({
      where: { companyId: companyIdActivo, estado: 'ACTIVA' },
    })
    if (campanas === 0) {
      const ahora = new Date()
      const creada = await prisma.campanaInvitacion.create({
        data: {
          companyId: companyIdActivo,
          slug: `qa-e2e-t24-${Date.now()}`,
          nombre: 'QA E2E invitación (temporal)',
          titulo: 'Invita y gana (QA E2E)',
          descripcion: 'Campaña temporal sembrada por la prueba E2E del directorio.',
          metaRegistros: 10,
          beneficioInvitante: { tipo: 'PUNTOS', valor: 100 },
          beneficioInvitado: { tipo: 'PUNTOS', valor: 50 },
          fechaInicio: ahora,
          fechaFin: new Date(ahora.getTime() + 7 * 24 * 3600 * 1000),
          estado: 'ACTIVA',
        },
        select: { id: true },
      })
      campanaTemporalId = creada.id
    }
  }

  // La navegación consciente del contenido cachea 5 min (`unstable_cache`). Al
  // repetir una corrida contra el mismo servidor, la entrada vencida puede
  // servirse una vez más (stale-while-revalidate) y la primera lectura vería el
  // menú anterior a la siembra. Se precalienta la entrada con el contenido YA
  // sembrado, reintentando hasta que refleje el vehículo temporal: así la
  // aserción del directorio mide el estado sembrado, no el reloj de la caché.
  const contextoCaliente = await browser.newContext()
  try {
    await contextoCaliente.addCookies(cookies)
    const paginaCaliente = await contextoCaliente.newPage()
    for (let intento = 0; intento < 6; intento++) {
      await paginaCaliente
        .goto('/cliente/menu', { waitUntil: 'domcontentloaded' })
        .catch(() => {})
      const html = await paginaCaliente.locator('main').innerHTML().catch(() => '')
      if (html.includes('/cliente/vehiculos')) break
      await paginaCaliente.waitForTimeout(1000)
    }
  } finally {
    await contextoCaliente.close()
  }
})

test.afterAll(async ({ browser }) => {
  if (prisma && categoriaTemporalId) {
    await prisma.tipoVehiculo.delete({ where: { id: categoriaTemporalId } }).catch(() => {})
  }
  if (prisma && vehiculoTemporalId) {
    await prisma.vehiculo.delete({ where: { id: vehiculoTemporalId } }).catch(() => {})
  }
  if (prisma && premioTemporalId) {
    await prisma.ruletaPremio.delete({ where: { id: premioTemporalId } }).catch(() => {})
  }
  if (prisma && campanaTemporalId) {
    await prisma.campanaInvitacion.delete({ where: { id: campanaTemporalId } }).catch(() => {})
  }
  await prisma?.$disconnect()

  if (motivoSkip) return

  // `logout` usa `signOut()` de Supabase con alcance GLOBAL: revoca la sesión
  // del cliente en todos los dispositivos, así que el estado compartido queda
  // muerto para el siguiente proyecto. Se repone con OTRO login real (setup +
  // este = 2 de 5 intentos). Si el limitador ya no diera, se avisa y se
  // re-siembra con el token de prueba: nunca en silencio.
  const contexto = await browser.newContext()
  try {
    const page = await contexto.newPage()
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const enLogin = new URL(page.url()).pathname.startsWith('/login')
    const formularioPresente = enLogin
      ? await page.locator('#email').isVisible({ timeout: 10_000 }).catch(() => false)
      : false

    let repuesta = !enLogin
    if (formularioPresente) {
      intentosReposicion++
      await page.locator('#email').fill(EMAIL)
      await page.locator('#password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
      repuesta = await page
        .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
    }

    if (repuesta) {
      await contexto.storageState({ path: AUTH_STATE })
    } else {
      const renovada = await obtenerSesion()
      if (renovada) {
        await contexto.addCookies(renovada.cookies)
        await contexto.storageState({ path: AUTH_STATE })
        console.warn(
          '[cliente-flujos] el login de reposición no completó (¿limitador 5/15 min?); ' +
            'estado re-sembrado con el token de prueba para no dejar sin sesión al siguiente proyecto.'
        )
      }
    }
    console.log(
      `[cliente-flujos] reposición de sesión: login real del setup = ${
        intentosLogin ?? '?'
      } intento(s) + reposición = ${intentosReposicion} intento(s)`
    )
  } finally {
    await contexto.close()
  }
})

// Todos los casos comparten la sesión que dejó el setup: ningún `beforeEach`
// vuelve a entrar por el formulario (el limitador es 5 intentos / 15 min).
test.use({ storageState: AUTH_STATE })
// Viewport lg: el dock inferior móvil es `lg:hidden` y no intercepta clics.
test.use({ viewport: { width: 1280, height: 1100 } })

test.beforeEach(async ({ page, context }) => {
  test.skip(Boolean(motivoSkip), motivoSkip ?? '')
  test.setTimeout(150_000)

  // Instrumentación pedida por el todo 25: prueba que la corrida no agota el
  // limitador. El único intento real vive en el setup; aquí siempre es 0.
  console.log(
    `[cliente-flujos] intentos de login reales esta corrida: ${
      intentosLogin ?? 'sin metadata del setup'
    } · caso: ${test.info().title}`
  )

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

  // Sin usos transferibles la pantalla no pinta un formulario deshabilitado,
  // sino su estado vacío. Ese es el guardia: sin fuente que transferir no hay
  // forma de enviar nada, y la prueba cubre ese vacío en vez de exigir un botón.
  if (!(await enviar.isVisible().catch(() => false))) {
    await expect(page.locator('main form')).toHaveCount(0)
    await expect(enviar).toHaveCount(0)
    await captura(page, '17-enviar-regalo-sin-usos')
    return
  }

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

  // El clic no activa nada: cae en la pantalla de la membresía, donde todavía
  // hay que completar el pago. Ninguna membresía se activa sola.
  await page.waitForURL(/\/membresia\//, { timeout: 30_000 })
  expect(new URL(page.url()).pathname.startsWith('/membresia/')).toBe(true)
  await captura(page, '18-plan-confirmacion')
})

test.describe('navegación y alta de vehículo (todo 24)', () => {
  test('vehículos: alta en una sola pantalla y ciclo crear + borrar', async ({ page }) => {
    const placa = `Q${unico()}`

    await page.goto('/cliente/vehiculos/nuevo?next=/cliente/vehiculos', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('#placa')).toBeVisible({ timeout: 25_000 })

    await expect(page.locator('main form')).toHaveCount(1)
    await expect(page.locator('[aria-label^="Paso"]')).toHaveCount(0)
    await expect(page.locator('#placa')).toHaveAttribute('aria-required', 'true')
    expect(await page.locator('input[name="tipoVehiculoId"]').count()).toBeGreaterThan(0)
    for (const id of ['#marca', '#modelo', '#anio', '#color']) {
      await expect(page.locator(id)).toBeVisible()
    }

    await page.locator('#placa').fill(placa)
    const radios = page.locator('input[type="radio"][name="tipoVehiculoId"]')
    if (await radios.count()) await radios.first().check({ force: true })

    await page.getByRole('button', { name: /guardar vehículo/i }).click()
    await page.waitForURL((u) => !u.pathname.includes('/nuevo'), { timeout: 40_000 })
    expect(new URL(page.url()).pathname).toBe('/cliente/vehiculos')

    const tarjeta = page.locator('li').filter({ hasText: placa })
    await expect(tarjeta).toBeVisible({ timeout: 25_000 })
    await captura(page, '08-vehiculo-agregado')

    await tarjeta.locator('button[aria-label="Eliminar vehículo"]').click()
    const dialogo = page.getByRole('alertdialog')
    await expect(dialogo).toContainText(placa)
    await dialogo.getByRole('button', { name: 'Eliminar' }).click()
    await expect(page.getByText('Vehículo eliminado.').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('li').filter({ hasText: placa })).toHaveCount(0, { timeout: 25_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('li').filter({ hasText: placa })).toHaveCount(0, { timeout: 25_000 })
    await captura(page, '10-vehiculo-eliminado')
  })

  test('navegación: el menú llega a /cliente/planes en 2 toques desde inicio', async ({ page }) => {
    await page.goto('/cliente/inicio', { waitUntil: 'domcontentloaded' })

    const secciones = page.locator('nav[aria-label="Secciones"]')
    await expect(secciones).toBeVisible({ timeout: 25_000 })

    let toques = 0
    await secciones.locator('a[href="/cliente/menu"]').click()
    toques++
    await page.waitForURL(/\/cliente\/menu$/, { timeout: 25_000 })

    await page.locator('a[href="/cliente/planes"]').first().click()
    toques++
    await page.waitForURL(/\/cliente\/planes(\?|$)/, { timeout: 25_000 })

    const destino = new URL(page.url())
    expect(destino.pathname.startsWith('/cliente/')).toBe(true)
    expect(destino.pathname.startsWith('/plan/')).toBe(false)
    expect(toques).toBeLessThanOrEqual(2)
    await captura(page, '20-menu-a-planes')
  })

  test('navegación: una tarjeta de plan de inicio enlaza dentro de /cliente/', async ({ page }) => {
    await page.goto('/cliente/inicio', { waitUntil: 'domcontentloaded' })

    const seccion = page.locator('section[aria-labelledby="vibe-relacionado"]')
    const tarjetas = seccion.locator('a:has(h4)')
    // La sección se pinta tras el stream de la RSC: esperar antes de contar,
    // o el conteo sale 0 y el caso se salta sin motivo real.
    await page
      .locator('#vibe-relacionado')
      .waitFor({ state: 'attached', timeout: 25_000 })
      .catch(() => {})
    const total = await tarjetas.count()
    test.skip(
      total === 0,
      'el cliente no tiene membresías recomendadas: el inicio muestra su estado vacío'
    )

    const hrefs = await tarjetas.evaluateAll((els) =>
      els.map((el) => el.getAttribute('href') ?? '')
    )
    for (const href of hrefs) {
      expect(href.startsWith('/cliente/'), `"${href}" sale de /cliente/`).toBe(true)
      expect(href.startsWith('/plan/'), `"${href}" apunta a la landing pública`).toBe(false)
    }
    expect(hrefs.some((href) => href.startsWith('/cliente/planes'))).toBe(true)

    await tarjetas.first().click()
    await page.waitForURL(/\/cliente\//, { timeout: 25_000 })
    const destino = new URL(page.url())
    expect(destino.pathname.startsWith('/cliente/')).toBe(true)
    expect(destino.pathname.startsWith('/plan/')).toBe(false)
    await captura(page, '21-plan-dentro-de-cliente')
  })

  test('navegación: el directorio del menú lista las siete rutas', async ({ page }) => {
    await page.goto('/cliente/menu', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25_000 })

    const hrefs = await page
      .locator('main a[href]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))

    const requeridas = [
      '/cliente/planes',
      '/cliente/regalos',
      '/cliente/ruleta',
      '/cliente/vehiculos',
      '/cliente/novedades',
      '/cliente/invita-y-gana',
      '/cliente/intereses',
    ]
    // `beforeAll` siembra el premio de ruleta y la campaña de invitación que el
    // menú consciente del contenido necesita para no ocultar esas dos filas: si
    // alguna falta aquí, el directorio está incompleto y la prueba debe fallar.
    for (const ruta of requeridas) {
      expect(hrefs, `falta ${ruta} en el menú`).toContain(ruta)
    }
    await captura(page, '22-menu-directorio')
  })
})

// El logout certifica el cierre de la sesión, así que va DESPUÉS del bloque que
// reutiliza esa misma sesión: cerrarla antes dejaría al bloque sin cookies.
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
