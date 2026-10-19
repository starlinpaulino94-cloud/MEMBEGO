import { test, expect, type Locator, type Page } from '@playwright/test'
import { Prisma } from '@prisma/client'
import { cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * INVENTARIO CON LEDGER · el panel, de punta a punta (F2.2).
 *
 *   lista (agotado) → entrada → faltante sin motivo (no envía) → faltante con
 *   motivo → faltante imposible (avisa y no mueve) → daño → dar de baja →
 *   umbral → la alerta aparece en la lista → transferir → conteo físico →
 *   historial con cada movimiento
 *
 * Después (INV-1): las tres vistas de la empresa —existencias, movimientos y
 * reservas—, los filtros y la exportación a CSV de los movimientos, el salto a
 * la ficha con el código exacto de un lector, el aviso del estado «Agotada»
 * fijado a mano y el umbral aplicado a otras sucursales.
 *
 * Y lo que NO debe pasar: abrir por URL la variante de otra empresa, y entrar
 * una empresa que no tiene encendida la capacidad.
 *
 * La base de E2E se crea con `db push`: no lleva los disparadores ni los CHECK
 * de las migraciones (la inmutabilidad del ledger y las 144 combinaciones las
 * prueba `tests/postgres/inventory.db.test.ts`). Aquí se prueba la INTERFAZ.
 *
 * Entra con una sesión firmada localmente (ver `supply-v2-sesion.ts`).
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `Camiseta E2E ${sufijo}`
const SERVICIO = `Lavado E2E ${sufijo}`

/** La tarjeta de UNA sucursal en el detalle. */
const tarjeta = (p: Page, nombre: string): Locator => p.locator(`[data-sucursal="${nombre}"]`)

/** Lo que dice la tarjeta en una cifra concreta («Disponible», «Dañado»…). */
async function cifra(t: Locator, etiqueta: string): Promise<number> {
  // Sin esperar a que la tarjeta esté pintada, `innerText` cae a `textContent` y las cifras salen pegadas a su etiqueta.
  await t.getByLabel(/^Existencias en/).waitFor({ state: 'visible' })
  const bloque = t.getByLabel(/^Existencias en/).locator('div', { has: t.page().getByText(etiqueta, { exact: true }) }).last()
  const texto = (await bloque.innerText()).replace(/\s+/g, ' ')
  const m = new RegExp(`${etiqueta}\\s+([\\d.,]+)`).exec(texto)
  if (!m) throw new Error(`no se encontró «${etiqueta}» en: ${texto}`)
  return Number(m[1].replace(/[.,]/g, ''))
}

async function registrar(p: Page, sucursal: string, o: { operacion: string; cantidad: number; motivo?: string }) {
  const f = p.getByRole('form', { name: `Registrar movimiento en ${sucursal}` })
  await f.getByLabel('Movimiento').selectOption({ label: o.operacion })
  await f.getByRole('textbox').first().fill(String(o.cantidad))
  if (o.motivo !== undefined) await f.getByLabel(/^Motivo/).fill(o.motivo)
  await f.getByRole('button', { name: 'Registrar' }).click()
}

test.describe('Inventario · panel', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let sin: EmpresaCatalogo
  let variante = ''
  let varianteAjena = ''

  test('prepara: empresa con la capacidad (2 sucursales, un producto y un servicio) y otra sin ella', async () => {
    con = await empresaCatalogo(sufijo, 'inv', { capacidad: true })
    sin = await empresaCatalogo(sufijo, 'invsin', { capacidad: false })
    await sucursalSembrada(con.id, 'Principal')
    await sucursalSembrada(con.id, 'Norte')
    const producto = await itemSembrado(con.id, { name: PRODUCTO, slug: `camiseta-inv-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `INV-${sufijo}`, price: 800, porDefecto: true }] })
    variante = await varianteDe(producto.id)
    await itemSembrado(con.id, { name: SERVICIO, slug: `lavado-inv-${sufijo}`, variantes: [{ name: 'Default', sku: `LAV-INV-${sufijo}`, price: 500, porDefecto: true }] })
    await sucursalSembrada(sin.id, 'De otra')
    const ajeno = await itemSembrado(sin.id, { name: `SECRETO inv ${sufijo}`, slug: `secreto-inv-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `SEC-INV-${sufijo}`, price: 999, porDefecto: true }] })
    varianteAjena = await varianteDe(ajeno.id)
    expect(con.id).not.toBe(sin.id)
  })

  test('lista → entrada → ajuste → daño → baja → umbral y alerta → transferencia → conteo → historial', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // ── La lista: el producto aparece agotado; el servicio no ─────────────
    await p.goto('/admin/inventario')
    await expect(p.getByRole('heading', { name: 'Inventario' }).first()).toBeVisible()
    await expect(p.getByRole('link', { name: /^Inventario/ }).first()).toBeVisible()
    const lista = p.getByRole('list', { name: 'Existencias por producto' })
    await expect(lista.getByText(PRODUCTO)).toBeVisible()
    await expect(lista.getByText('Agotado')).toBeVisible()
    await expect(lista.getByText(/Sin existencias registradas/)).toBeVisible()
    await expect(p.getByText(SERVICIO)).toHaveCount(0)

    // ── El detalle: dos sucursales, todo en cero ──────────────────────────
    await lista.getByRole('link', { name: new RegExp(PRODUCTO) }).click()
    await p.waitForURL(`**/admin/inventario/${variante}`)
    await expect(p.getByRole('heading', { name: PRODUCTO, level: 1 })).toBeVisible()
    const principal = tarjeta(p, 'Principal')
    const norte = tarjeta(p, 'Norte')
    await expect(principal).toBeVisible()
    await expect(norte).toBeVisible()
    expect(await cifra(principal, 'Disponible')).toBe(0)

    // ── Entrada de mercancía ──────────────────────────────────────────────
    await registrar(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 10, motivo: 'Compra E2E' })
    await expect.poll(() => cifra(principal, 'Disponible'), { timeout: 15_000 }).toBe(10)

    // ── Faltante SIN motivo: el navegador no deja enviar ──────────────────
    await registrar(p, 'Principal', { operacion: 'Ajuste: faltante', cantidad: 3 })
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Motivo *')).toBeVisible()
    expect(await cifra(principal, 'Disponible')).toBe(10)
    // …y con motivo, baja.
    await p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Motivo *').fill('Merma')
    await p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByRole('button', { name: 'Registrar' }).click()
    await expect.poll(() => cifra(principal, 'Disponible'), { timeout: 15_000 }).toBe(7)

    // ── Un faltante imposible avisa y no mueve nada ───────────────────────
    await registrar(p, 'Principal', { operacion: 'Ajuste: faltante', cantidad: 99, motivo: 'Imposible' })
    await expect(p.getByText(/No hay suficiente: pides 99 y hay 7 disponible/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cifra(principal, 'Disponible')).toBe(7)

    // ── Daño y baja de lo dañado ──────────────────────────────────────────
    await registrar(p, 'Principal', { operacion: 'Mercancía dañada', cantidad: 2, motivo: 'Se mojaron' })
    await expect.poll(() => cifra(principal, 'Dañado'), { timeout: 15_000 }).toBe(2)
    expect(await cifra(principal, 'Disponible')).toBe(5)
    await registrar(p, 'Principal', { operacion: 'Dar de baja lo dañado', cantidad: 2, motivo: 'Irrecuperable' })
    await expect.poll(() => cifra(principal, 'Dañado'), { timeout: 15_000 }).toBe(0)
    // Sin dañados, esa operación deja de ofrecerse.
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Movimiento').locator('option', { hasText: 'Dar de baja lo dañado' })).toHaveCount(0)

    // ── Umbral → alerta en la lista ───────────────────────────────────────
    await p.getByRole('form', { name: 'Umbral de stock bajo en Principal' }).getByLabel('Avisar cuando queden').fill('6')
    await p.getByRole('form', { name: 'Umbral de stock bajo en Principal' }).getByRole('button', { name: 'Guardar umbral' }).click()
    await expect(p.getByText(/Te avisaremos cuando queden 6 o menos/).first()).toBeVisible({ timeout: 15_000 })
    await p.goto('/admin/inventario')
    const alertas = p.getByRole('list', { name: 'Alertas de stock bajo' })
    await expect(alertas.getByText(PRODUCTO)).toBeVisible()
    await expect(alertas.getByText('Quedan 5')).toBeVisible()
    await expect(p.getByText(/Stock bajo \(1\)/)).toBeVisible()
    await expect(p.getByRole('list', { name: 'Existencias por producto' }).getByText('Stock bajo')).toBeVisible()
    // Filtro por estado.
    await p.goto('/admin/inventario?estado=AGOTADO')
    await expect(p.getByText(PRODUCTO).first()).toBeVisible() // la alerta sigue arriba; la lista, no
    await expect(p.getByRole('list', { name: 'Existencias por producto' })).toHaveCount(0)
    await p.goto('/admin/inventario?estado=BAJO')
    await expect(p.getByRole('list', { name: 'Existencias por producto' }).getByText(PRODUCTO)).toBeVisible()
    // Una URL manipulada no rompe nada.
    await p.goto('/admin/inventario?estado=<script>&sucursal=ajena&pagina=-4')
    await expect(p.getByRole('heading', { name: 'Inventario' }).first()).toBeVisible()

    // ── Transferencia entre sucursales ────────────────────────────────────
    await p.goto(`/admin/inventario/${variante}`)
    const tr = p.getByRole('form', { name: 'Transferir existencias' })
    await tr.getByLabel('Desde').selectOption({ label: 'Principal (5 disp.)' })
    await tr.getByLabel('Hacia').selectOption({ label: 'Norte' })
    await tr.getByLabel('Cantidad').fill('2')
    await tr.getByLabel('Motivo (opcional)').fill('Reabasto')
    await tr.getByRole('button', { name: 'Transferir' }).click()
    await expect.poll(() => cifra(norte, 'Disponible'), { timeout: 15_000 }).toBe(2)
    expect(await cifra(principal, 'Disponible')).toBe(3)
    // Más de lo que hay: avisa.
    await tr.getByLabel('Cantidad').fill('50')
    await tr.getByRole('button', { name: 'Transferir' }).click()
    await expect(p.getByText(/No hay suficiente: pides 50/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cifra(norte, 'Disponible')).toBe(2)

    // ── Conteo físico: se cuenta 4 donde el sistema decía 3 ───────────────
    await registrar(p, 'Principal', { operacion: 'Conteo físico', cantidad: 4 })
    await expect.poll(() => cifra(principal, 'En existencia'), { timeout: 15_000 }).toBe(4)
    // Contar lo mismo no cambia nada y lo dice.
    await registrar(p, 'Principal', { operacion: 'Conteo físico', cantidad: 4 })
    await expect(p.getByText(/coincide con el sistema/).first()).toBeVisible({ timeout: 15_000 })

    // ── El historial lo cuenta todo, de lo nuevo a lo viejo ───────────────
    await p.reload()
    const historial = p.getByRole('list', { name: 'Historial de movimientos' })
    for (const tipo of ['Entrada de mercancía', 'Ajuste', 'Daño', 'Transferencia enviada', 'Transferencia recibida']) {
      await expect(historial.getByText(tipo, { exact: false }).first()).toBeVisible()
    }
    await expect(historial.getByText('+10')).toBeVisible()
    await expect(historial.getByText('Merma')).toBeVisible()
    await expect(historial.getByText('Compra E2E')).toBeVisible()
    // Exactamente los 7 que hizo el recorrido: entrada, faltante, daño, baja,
    // las dos patas de la transferencia y el conteo (los rechazados no escriben).
    const filas = historial.getByRole('listitem')
    await expect(filas).toHaveCount(7)
    // La más reciente (el conteo, +1) va primero.
    await expect(filas.first()).toContainText('Conteo físico')
    await expect(filas.first()).toContainText('+1')

    // ── Persistencia: lo mismo después de recargar ────────────────────────
    expect(await cifra(tarjeta(p, 'Principal'), 'En existencia')).toBe(4)
    expect(await cifra(tarjeta(p, 'Norte'), 'Disponible')).toBe(2)

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-1 · movimientos de la empresa, exportación CSV, reservas, salto por código, estado manual y umbral en varias sucursales', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const SKU = `INV-${sufijo}`

    // ── Tres vistas, un solo menú ─────────────────────────────────────────
    await p.goto('/admin/inventario')
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    await expect(vistas.getByRole('link', { name: 'Existencias' })).toHaveAttribute('aria-current', 'page')
    await vistas.getByRole('link', { name: 'Movimientos' }).click()
    await p.waitForURL('**/admin/inventario/movimientos')
    await expect(p.getByRole('heading', { name: 'Movimientos de inventario', level: 1 })).toBeVisible()
    await expect(vistas.getByRole('link', { name: 'Movimientos' })).toHaveAttribute('aria-current', 'page')

    // ── Todo el historial de la empresa: los 7 movimientos del recorrido anterior ──
    const lista = p.getByRole('list', { name: 'Movimientos de inventario' })
    await expect(lista.getByRole('listitem')).toHaveCount(7)
    await expect(lista.getByRole('listitem').first()).toContainText('Conteo físico')
    await expect(lista.getByRole('link', { name: PRODUCTO }).first()).toHaveAttribute('href', `/admin/inventario/${variante}`)

    // ── Filtros: por tipo, por sucursal y por texto ───────────────────────
    const filtros = p.getByRole('form', { name: 'Filtrar movimientos' })
    await filtros.getByLabel('Movimiento').selectOption({ label: 'Transferencia enviada' })
    await filtros.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/tipo=TRANSFER_OUT/)
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await expect(lista.getByRole('listitem').first()).toContainText('Reabasto')
    await expect(lista.getByRole('listitem').first()).toContainText('Principal')

    // Combina con sucursal: la transferencia ENVIADA salió de Principal, no de Norte.
    await p.goto('/admin/inventario/movimientos')
    const f2 = p.getByRole('form', { name: 'Filtrar movimientos' })
    await f2.getByLabel('Sucursal').selectOption({ label: 'Norte' })
    await f2.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/sucursal=/)
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await expect(lista.getByRole('listitem').first()).toContainText('Transferencia recibida')

    await p.goto(`/admin/inventario/movimientos?q=${encodeURIComponent(SKU)}`)
    await expect(lista.getByRole('listitem')).toHaveCount(7)
    await p.goto('/admin/inventario/movimientos?q=zzz-no-existe')
    await expect(p.getByText('Nada coincide con esos filtros')).toBeVisible()
    // Una URL manipulada no rompe nada.
    await p.goto('/admin/inventario/movimientos?tipo=<script>&desde=2030-02-31&cursor=basura&sucursal=ajena')
    await expect(p.getByRole('heading', { name: 'Movimientos de inventario', level: 1 })).toBeVisible()

    // ── Exportar CSV: los mismos filtros que la pantalla ──────────────────
    await p.goto('/admin/inventario/movimientos?tipo=TRANSFER_OUT')
    await expect(p.getByRole('link', { name: /Exportar CSV/ })).toHaveAttribute('href', /\/admin\/inventario\/movimientos\/exportar\?.*tipo=TRANSFER_OUT/)
    const filtrado = await p.request.get('/admin/inventario/movimientos/exportar?tipo=TRANSFER_OUT')
    expect(filtrado.status()).toBe(200)
    expect(filtrado.headers()['content-type']).toContain('text/csv')
    expect(filtrado.headers()['content-disposition']).toMatch(/^attachment; filename="movimientos-inventario-\d{4}-\d{2}-\d{2}\.csv"$/)
    const csvFiltrado = await filtrado.text()
    expect(csvFiltrado).toContain('Alcance de la exportación')
    expect(csvFiltrado).toContain('Movimiento;Transferencia enviada')
    expect(csvFiltrado).toContain('Datos completos;Si')
    expect(csvFiltrado.split('\n').filter((l) => l.includes(SKU))).toHaveLength(1)
    expect(csvFiltrado).not.toContain('Entrada de mercancía')
    const completo = await (await p.request.get('/admin/inventario/movimientos/exportar')).text()
    expect(completo).toContain('Ninguno (todos los movimientos)')
    expect(completo.split('\n').filter((l) => l.includes(SKU))).toHaveLength(7)

    // Sin sesión, o de una empresa sin la capacidad, NO sale ni una fila.
    const anonimo = await browser.newContext()
    const sinSesion = await anonimo.request.get('/admin/inventario/movimientos/exportar', { maxRedirects: 0 })
    expect(sinSesion.headers()['content-type'] ?? '').not.toContain('text/csv')
    expect(await sinSesion.text()).not.toContain('Alcance de la exportación')
    await anonimo.close()
    const ctxSin = await browser.newContext()
    await entrarComo(ctxSin, 'catalogoSinCapacidad', BASE, sin.id)
    const sinCapacidad = await ctxSin.request.get('/admin/inventario/movimientos/exportar', { maxRedirects: 0 })
    expect(sinCapacidad.headers()['content-type'] ?? '').not.toContain('text/csv')
    expect([302, 303, 307, 308, 403]).toContain(sinCapacidad.status())
    expect(await sinCapacidad.text()).not.toContain(SKU)
    await ctxSin.close()

    // ── Reservas: nada apartado todavía (las crean los pedidos; el detalle está en las pruebas contra la base) ──
    await p.goto('/admin/inventario/reservas')
    await expect(p.getByRole('heading', { name: 'Reservas de inventario', level: 1 })).toBeVisible()
    await expect(vistas.getByRole('link', { name: 'Reservas' })).toHaveAttribute('aria-current', 'page')
    await expect(p.getByText('No hay nada apartado ahora mismo')).toBeVisible()

    // ── Lector de código: el SKU exacto salta a la ficha; un fragmento, no ──
    await p.goto(`/admin/inventario?q=${encodeURIComponent(SKU)}`)
    await p.waitForURL(`**/admin/inventario/${variante}`)
    await expect(p.getByRole('heading', { name: PRODUCTO, level: 1 })).toBeVisible()
    await p.goto(`/admin/inventario?q=${encodeURIComponent(SKU.toLowerCase())}`)
    await p.waitForURL(`**/admin/inventario/${variante}`)
    await p.goto('/admin/inventario?q=INV-')
    await expect(p).toHaveURL(/\/admin\/inventario\?q=INV-$/)
    await expect(p.getByRole('list', { name: 'Existencias por producto' }).getByText(PRODUCTO)).toBeVisible()

    // ── Estado «Agotada» fijado a mano: se avisa en la lista y en la ficha ─
    const prisma = prismaDeArnes()
    await prisma.catalogVariant.update({ where: { id: variante }, data: { status: 'OUT_OF_STOCK' } })
    try {
      await p.goto('/admin/inventario?q=INV-')
      await expect(p.getByText(/marcada «Agotada» en el catálogo: no se vende aunque haya 6 unidades disponibles/)).toBeVisible()
      await p.goto(`/admin/inventario/${variante}`)
      await expect(p.getByText(/marcada «Agotada» en el catálogo: no se vende aunque haya 6 unidades disponibles/)).toBeVisible()
      await expect(p.getByRole('link', { name: 'Cambiar su estado en el catálogo' })).toHaveAttribute('href', /\/admin\/catalogo\//)
    } finally {
      await prisma.catalogVariant.update({ where: { id: variante }, data: { status: 'ACTIVE' } })
    }
    await p.goto(`/admin/inventario/${variante}`)
    await expect(p.getByText(/marcada «Agotada»/)).toHaveCount(0)

    // ── Umbral aplicado también a la otra sucursal con existencias ────────
    const umbralPrincipal = p.getByRole('form', { name: 'Umbral de stock bajo en Principal' })
    await umbralPrincipal.getByLabel('Avisar cuando queden').fill('3')
    await umbralPrincipal.getByLabel(/Aplicar también a las otras sucursales/).check()
    await umbralPrincipal.getByRole('button', { name: 'Guardar umbral' }).click()
    await expect(p.getByText(/También se aplicó en 1 sucursal más/).first()).toBeVisible({ timeout: 15_000 })
    await p.reload()
    await expect(p.getByRole('form', { name: 'Umbral de stock bajo en Principal' }).getByLabel('Avisar cuando queden')).toHaveValue('3')
    await expect(p.getByRole('form', { name: 'Umbral de stock bajo en Norte' }).getByLabel('Avisar cuando queden')).toHaveValue('3')

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-2a · entrada de mercancía con varias líneas (lector), documento con número, CSV, importación todo o nada y permisos', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // Dos productos nuevos con código de barras: el recorrido no depende de las existencias de los anteriores.
    const NOMBRE_A = `Gorra E2E ${sufijo}`
    const NOMBRE_B = `Medias E2E ${sufijo}`
    const SKU_A = `ENTA-${sufijo}`
    const SKU_B = `ENTB-${sufijo}`
    const base = parseInt(sufijo, 36) % 900_000
    const COD_A = String(7_501_000_000_000 + base)
    const COD_B = String(7_502_000_000_000 + base)
    const itemA = await itemSembrado(con.id, { name: NOMBRE_A, slug: `gorra-ent-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: SKU_A, barcode: COD_A, price: 300, porDefecto: true }] })
    const itemB = await itemSembrado(con.id, { name: NOMBRE_B, slug: `medias-ent-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: SKU_B, barcode: COD_B, price: 150, porDefecto: true }] })
    const varA = await varianteDe(itemA.id)
    const varB = await varianteDe(itemB.id)

    // ── La pestaña «Entradas»: vacía al principio, con sus dos caminos ────
    await p.goto('/admin/inventario')
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    await vistas.getByRole('link', { name: 'Entradas' }).click()
    await p.waitForURL('**/admin/inventario/entradas')
    await expect(p.getByRole('heading', { name: 'Entradas de mercancía', level: 1 })).toBeVisible()
    await expect(vistas.getByRole('link', { name: 'Entradas' })).toHaveAttribute('aria-current', 'page')
    await expect(p.getByText('Todavía no hay entradas registradas')).toBeVisible()
    await expect(p.getByRole('link', { name: 'Importar CSV' })).toBeVisible()

    // ── Nueva entrada con un lector: el código exacto se añade solo; repetirlo suma ──
    await p.getByRole('link', { name: 'Nueva entrada' }).click()
    await p.waitForURL('**/admin/inventario/entradas/nueva')
    const form = p.getByRole('form', { name: 'Nueva entrada de mercancía' })
    await form.getByLabel('Sucursal que recibe').selectOption({ label: 'Principal' })
    await form.getByLabel(/^Factura o referencia/).fill('F-1045 E2E')
    await form.getByLabel(/^Nota/).fill('Llegó un bulto roto')
    const buscar = form.getByLabel('Escanear o buscar un producto')
    const lineas = form.getByRole('list', { name: 'Productos de la entrada' })
    const filaA = lineas.getByRole('listitem').filter({ hasText: NOMBRE_A })
    const filaB = lineas.getByRole('listitem').filter({ hasText: NOMBRE_B })

    await buscar.fill(SKU_A)
    await buscar.press('Enter')
    await expect(filaA).toHaveCount(1)
    await expect(filaA.getByLabel(/^Cantidad de /)).toHaveValue('1')
    await expect(buscar).toHaveValue('')
    await buscar.fill(SKU_A.toLowerCase()) // el SKU no distingue mayúsculas
    await buscar.press('Enter')
    await expect(filaA).toHaveCount(1)
    await expect(filaA.getByLabel(/^Cantidad de /)).toHaveValue('2')
    await buscar.fill(COD_B) // el código de barras exacto, como lo escribe un lector
    await buscar.press('Enter')
    await expect(filaB).toHaveCount(1)
    await expect(filaB.getByLabel(/^Cantidad de /)).toHaveValue('1')

    // Lo que no se puede recibir: un código que no existe y un servicio (no controla inventario).
    await buscar.fill('NO-EXISTE-999')
    await buscar.press('Enter')
    await expect(p.getByText(/No encontré ningún producto que controle inventario con «NO-EXISTE-999»/)).toBeVisible()
    await buscar.fill(`LAV-INV-${sufijo}`)
    await buscar.press('Enter')
    await expect(p.getByText(new RegExp(`No encontré ningún producto que controle inventario con «LAV-INV-${sufijo}»`))).toBeVisible()
    await expect(lineas.getByRole('listitem')).toHaveCount(2)

    // Cantidades: una a cero no deja registrar; con valores válidos, el resumen cuenta bien.
    await filaA.getByLabel(/^Cantidad de /).fill('12')
    await filaB.getByLabel(/^Cantidad de /).fill('0')
    await form.getByRole('button', { name: 'Registrar entrada' }).click()
    await expect(p.getByText(new RegExp(`Revisa la cantidad de «${NOMBRE_B}»`))).toBeVisible()
    await expect(p).toHaveURL(/\/entradas\/nueva$/)
    await filaB.getByLabel(/^Cantidad de /).fill('5')
    await expect(form.getByText(/2 productos · 17 unidades/)).toBeVisible()

    await form.getByRole('button', { name: 'Registrar entrada' }).click()
    await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/, { timeout: 30_000 })
    const idEntrada1 = p.url().split('/').pop()!
    const numero1 = /^ENT-\d{4}-000001$/
    await expect(p.getByRole('heading', { name: numero1, level: 1 })).toBeVisible()
    const numeroTexto1 = (await p.getByRole('heading', { level: 1 }).innerText()).trim()
    await expect(p.getByText('Capturada a mano')).toBeVisible()
    await expect(p.getByText('F-1045 E2E')).toBeVisible()
    await expect(p.getByText('Llegó un bulto roto')).toBeVisible()
    const detalle = p.getByRole('list', { name: 'Líneas de la entrada' })
    await expect(detalle.getByRole('listitem')).toHaveCount(2)
    await expect(detalle.getByRole('listitem').filter({ hasText: NOMBRE_A })).toContainText('+12')
    await expect(detalle.getByRole('listitem').filter({ hasText: NOMBRE_A })).toContainText('0 → 12')
    await expect(detalle.getByRole('listitem').filter({ hasText: NOMBRE_B })).toContainText('+5')
    await expect(detalle.getByRole('listitem').filter({ hasText: NOMBRE_B })).toContainText(COD_B)

    // ── La entrada se descarga como CSV, y una entrada ajena o inventada da 404 ──
    const csv = await p.request.get(`/admin/inventario/entradas/${idEntrada1}/exportar`)
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    expect(csv.headers()['content-disposition']).toMatch(/^attachment; filename="/)
    const textoCsv = await csv.text()
    for (const esperado of [numeroTexto1, SKU_A, SKU_B, 'F-1045 E2E', 'Entrada de mercancía']) expect(textoCsv).toContain(esperado)
    const inventada = await p.request.get('/admin/inventario/entradas/cinexistente000000000000/exportar')
    expect(inventada.status()).toBe(404)
    expect(inventada.headers()['content-type'] ?? '').not.toContain('text/csv')

    // ── Las existencias cambiaron de verdad, y el historial lo cuenta ─────
    await p.goto(`/admin/inventario/${varA}`)
    expect(await cifra(tarjeta(p, 'Principal'), 'Disponible')).toBe(12)
    expect(await cifra(tarjeta(p, 'Norte'), 'Disponible')).toBe(0)
    await p.goto(`/admin/inventario/movimientos?q=${encodeURIComponent(SKU_A)}`)
    const movs = p.getByRole('list', { name: 'Movimientos de inventario' })
    await expect(movs.getByRole('listitem')).toHaveCount(1)
    await expect(movs.getByRole('listitem').first()).toContainText('Entrada de mercancía')
    await expect(movs.getByRole('listitem').first()).toContainText('+12')

    // ── La lista y sus filtros ────────────────────────────────────────────
    await p.goto('/admin/inventario/entradas')
    const listaEntradas = p.getByRole('list', { name: 'Entradas de mercancía' })
    await expect(listaEntradas.getByRole('listitem')).toHaveCount(1)
    await expect(listaEntradas.getByRole('listitem').first()).toContainText(numeroTexto1)
    await expect(listaEntradas.getByRole('listitem').first()).toContainText('F-1045 E2E')
    await expect(listaEntradas.getByRole('listitem').first()).toContainText('+17')
    await expect(listaEntradas.getByRole('link', { name: new RegExp(numeroTexto1) })).toHaveAttribute('href', `/admin/inventario/entradas/${idEntrada1}`)
    await p.goto('/admin/inventario/entradas?q=F-1045')
    await expect(listaEntradas.getByRole('listitem')).toHaveCount(1)
    await p.goto('/admin/inventario/entradas?q=zzz-no-existe')
    await expect(p.getByText('Nada coincide con esos filtros')).toBeVisible()
    const filtrar = p.getByRole('form', { name: 'Filtrar entradas' })
    await p.goto('/admin/inventario/entradas')
    await filtrar.getByLabel('Sucursal').selectOption({ label: 'Norte' })
    await filtrar.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/sucursal=/)
    await expect(p.getByText('Nada coincide con esos filtros')).toBeVisible()
    // Una URL manipulada no rompe nada.
    await p.goto('/admin/inventario/entradas?desde=2030-02-31&cursor=basura&sucursal=ajena&q=%27%3Cscript%3E')
    await expect(p.getByRole('heading', { name: 'Entradas de mercancía', level: 1 })).toBeVisible()

    // ── Importar CSV: un archivo con problemas NO registra nada ───────────
    await p.getByRole('link', { name: 'Importar CSV' }).click()
    await p.waitForURL('**/admin/inventario/importar')
    await expect(p.getByRole('heading', { name: 'Importar existencias desde un CSV', level: 1 })).toBeVisible()
    await p.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
    const subir = (nombre: string, contenido: string) => p.getByLabel('Archivo CSV').setInputFiles({ name: nombre, mimeType: 'text/csv', buffer: Buffer.from(contenido, 'utf8') })
    await subir('malo.csv', `sku;cantidad\n${SKU_A};5\nNO-EXISTE-${sufijo};3\n${SKU_B};0\n`)
    await p.getByRole('button', { name: 'Revisar archivo' }).click()
    await expect(p.getByText(/2 filas con problemas/)).toBeVisible({ timeout: 15_000 })
    const problemas = p.getByRole('list', { name: 'Filas con problemas' })
    await expect(problemas).toContainText('Fila 3')
    await expect(problemas).toContainText('Fila 4')
    await expect(p.getByRole('button', { name: /^Registrar entrada de/ })).toHaveCount(0)
    // La fila buena de ese archivo tampoco entró.
    await p.goto(`/admin/inventario/${varA}`)
    expect(await cifra(tarjeta(p, 'Norte'), 'Disponible')).toBe(0)

    // ── Un archivo limpio (una fila por SKU y otra por código de barras) ──
    await p.goto('/admin/inventario/importar')
    await p.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
    await subir('limpio.csv', `sku;codigo_de_barras;cantidad\n${SKU_A};;3\n;${COD_B};7\n`)
    await p.getByRole('button', { name: 'Revisar archivo' }).click()
    await expect(p.getByText(/El archivo está limpio/)).toBeVisible({ timeout: 15_000 })
    const previa = p.getByRole('list', { name: 'Vista previa de la entrada' })
    await expect(previa.getByRole('listitem')).toHaveCount(2)
    await expect(previa).toContainText('+3')
    await expect(previa).toContainText('+7')
    await p.getByRole('button', { name: 'Registrar entrada de 2 productos en Norte' }).click()
    await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/, { timeout: 30_000 })
    await expect(p.getByRole('heading', { name: /^ENT-\d{4}-000002$/, level: 1 })).toBeVisible()
    await expect(p.getByText('Archivo CSV').first()).toBeVisible()
    await expect(p.getByText('CSV', { exact: true })).toBeVisible()
    await expect(p.getByRole('list', { name: 'Líneas de la entrada' }).getByRole('listitem')).toHaveCount(2)
    await p.goto(`/admin/inventario/${varA}`)
    expect(await cifra(tarjeta(p, 'Norte'), 'Disponible')).toBe(3)
    expect(await cifra(tarjeta(p, 'Principal'), 'Disponible')).toBe(12)
    await p.goto(`/admin/inventario/${varB}`)
    expect(await cifra(tarjeta(p, 'Norte'), 'Disponible')).toBe(7)
    expect(await cifra(tarjeta(p, 'Principal'), 'Disponible')).toBe(5)
    await p.goto('/admin/inventario/entradas')
    await expect(listaEntradas.getByRole('listitem')).toHaveCount(2)
    await expect(listaEntradas.getByRole('listitem').first()).toContainText('CSV')

    // ── La plantilla se descarga, con filas de ejemplo que no son productos reales ──
    const plantilla = await p.request.get('/admin/inventario/importar/plantilla')
    expect(plantilla.status()).toBe(200)
    expect(plantilla.headers()['content-type']).toContain('text/csv')
    expect(await plantilla.text()).toContain('EJEMPLO-BORRAR-1')

    // ── Una entrada inventada no existe: misma página que cualquier id desconocido ──
    await p.goto('/admin/inventario/entradas/cinexistente000000000000')
    expect(await p.locator('meta[name=robots][content*=noindex]').count()).toBeGreaterThan(0)
    await expect(p.getByText(/^ENT-\d{4}-\d{6}$/)).toHaveCount(0)
    await expect(p.getByRole('list', { name: 'Líneas de la entrada' })).toHaveCount(0)

    // ── Sin sesión, o con otra empresa sin la capacidad, NO sale nada ─────
    const anonimo = await browser.newContext()
    for (const ruta of [`/admin/inventario/entradas/${idEntrada1}/exportar`, '/admin/inventario/importar/plantilla']) {
      const r = await anonimo.request.get(ruta, { maxRedirects: 0 })
      expect(r.headers()['content-type'] ?? '', ruta).not.toContain('text/csv')
      expect(await r.text(), ruta).not.toContain(SKU_A)
    }
    await anonimo.close()
    const ctxSin = await browser.newContext()
    await entrarComo(ctxSin, 'catalogoSinCapacidad', BASE, sin.id)
    for (const ruta of [`/admin/inventario/entradas/${idEntrada1}/exportar`, '/admin/inventario/importar/plantilla']) {
      const r = await ctxSin.request.get(ruta, { maxRedirects: 0 })
      expect(r.headers()['content-type'] ?? '', ruta).not.toContain('text/csv')
      expect([302, 303, 307, 308, 403, 404], ruta).toContain(r.status())
      expect(await r.text(), ruta).not.toContain(SKU_A)
    }
    const pSin = await ctxSin.newPage()
    await pSin.goto('/admin/inventario/entradas')
    await expect(pSin).not.toHaveURL(/\/admin\/inventario\/entradas$/)
    await ctxSin.close()

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-2b · conteo físico a ciegas: captura con lector, hoja en blanco, importar lo contado, revisar diferencias, rechazo por reservas, aplicar y cancelar', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const prisma = prismaDeArnes()

    // Tres productos con existencias en Principal: el sistema "sabe" 10, 20 y 7.
    const principalId = (await sucursalSembrada(con.id, 'Principal')).id
    const N1 = `Zapato E2E ${sufijo}`
    const N2 = `Cinturón E2E ${sufijo}`
    const N3 = `Billetera E2E ${sufijo}`
    const S1 = `CNT1-${sufijo}`
    const S2 = `CNT2-${sufijo}`
    const S3 = `CNT3-${sufijo}`
    const base = parseInt(sufijo, 36) % 900_000
    const C1 = String(7_503_000_000_000 + base)
    const mk = async (name: string, slug: string, sku: string, barcode: string | undefined, stock: number) => {
      const it = await itemSembrado(con.id, { name, slug, controlaInventario: true, variantes: [{ name: 'Default', sku, barcode, price: 100, porDefecto: true }] })
      const id = await varianteDe(it.id)
      await existenciasSembradas(con.id, id, principalId, stock)
      return id
    }
    const v1 = await mk(N1, `zapato-cnt-${sufijo}`, S1, C1, 10)
    const v2 = await mk(N2, `cinturon-cnt-${sufijo}`, S2, undefined, 20)
    const v3 = await mk(N3, `billetera-cnt-${sufijo}`, S3, undefined, 7)
    const nivel = (v: string) => prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: v, locationId: principalId } })

    // ── La pestaña «Conteos»: vacía, con su formulario ────────────────────
    await p.goto('/admin/inventario')
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    await vistas.getByRole('link', { name: 'Conteos' }).click()
    await p.waitForURL('**/admin/inventario/conteos')
    await expect(p.getByRole('heading', { name: 'Conteos físicos', level: 1 })).toBeVisible()
    await expect(vistas.getByRole('link', { name: 'Conteos' })).toHaveAttribute('aria-current', 'page')
    await expect(p.getByText('Todavía no hay conteos')).toBeVisible()

    // ── Abrir el conteo de Principal ──────────────────────────────────────
    const abrir = p.getByRole('form', { name: 'Iniciar conteo' })
    await abrir.getByLabel('Sucursal que vas a contar').selectOption({ label: 'Principal' })
    await abrir.getByLabel(/^Para qué es/).fill('Cierre E2E')
    await abrir.getByRole('button', { name: 'Abrir conteo' }).click()
    await p.waitForURL(/\/admin\/inventario\/conteos\/(?!nuevo)[^/]+$/, { timeout: 30_000 })
    const idConteo = p.url().split('/').pop()!
    await expect(p.getByRole('heading', { name: /^CNT-\d{4}-000001$/, level: 1 })).toBeVisible()
    const numero = (await p.getByRole('heading', { level: 1 }).innerText()).trim()
    await expect(p.getByText('Cierre E2E')).toBeVisible()
    await expect(p.getByText('Conteo a ciegas.')).toBeVisible()

    // A ciegas: ni una cifra del sistema en la pantalla de captura; los pendientes salen sin cantidades.
    await expect(p.getByText(/Esperado|Disponible|El sistema dice/)).toHaveCount(0)
    await p.getByText(/Con existencias y todavía sin contar \(/).click()
    const porContar = p.getByRole('list', { name: 'Productos por contar' })
    await expect(porContar.getByText(N1)).toBeVisible()
    await expect(porContar.getByText(N3)).toBeVisible()
    await expect(porContar.getByText(/\b(10|20)\b(?!-)/)).toHaveCount(0)

    // ── Captura con lector: el código exacto suma; «unidades por escaneo» cuenta por cajas ──
    const buscar = p.getByLabel('Escanear o buscar un producto para contar')
    const estado = p.getByRole('status')
    await buscar.fill(C1)
    await buscar.press('Enter')
    await expect(estado).toContainText(`${N1}: ahora 1 contados`)
    await buscar.fill(C1)
    await buscar.press('Enter')
    await expect(estado).toContainText(`${N1}: ahora 2 contados`)
    await p.getByLabel('Unidades por escaneo').fill('3')
    await buscar.fill(S1.toLowerCase())
    await buscar.press('Enter')
    await expect(estado).toContainText(`${N1}: ahora 5 contados`)
    await p.getByLabel('Unidades por escaneo').fill('1')
    // Lo que no existe se dice, y no cuenta nada.
    await buscar.fill('NO-EXISTE-999')
    await buscar.press('Enter')
    await expect(estado).toContainText('No encontré ningún producto que controle inventario con «NO-EXISTE-999»')
    // Una ráfaga de escaneos seguidos no pierde ninguno (cola en orden).
    await buscar.fill(S2)
    await buscar.press('Enter')
    await buscar.fill(S2)
    await buscar.press('Enter')
    await buscar.fill(S2)
    await buscar.press('Enter')
    await expect(estado).toContainText(`${N2}: ahora 3 contados`, { timeout: 20_000 })

    const lista = p.getByRole('list', { name: 'Productos contados' })
    await expect(p.getByRole('heading', { name: /^Productos contados \(2\)$/ })).toBeVisible({ timeout: 20_000 })
    // Corregir escribiendo el número (recuento): zapato 8 y cinturón 25.
    await lista.getByLabel(`Contado de ${N1}`).fill('8')
    await lista.getByLabel(`Contado de ${N1}`).press('Enter')
    await expect(lista.getByLabel(`Contado de ${N1}`)).toHaveValue('8', { timeout: 20_000 })
    await lista.getByLabel(`Contado de ${N2}`).fill('25')
    await lista.getByLabel(`Contado de ${N2}`).press('Enter')
    await expect.poll(async () => (await prisma.inventoryCountLine.findMany({ where: { sessionId: idConteo }, select: { catalogVariantId: true, counted: true, expected: true } })).sort((a, b) => a.counted - b.counted), { timeout: 20_000 }).toEqual(
      [
        { catalogVariantId: v1, counted: 8, expected: 10 },
        { catalogVariantId: v2, counted: 25, expected: 20 },
      ].sort((a, b) => a.counted - b.counted)
    )
    expect((await nivel(v1)).onHand, 'contar no mueve existencias').toBe(10)

    // ── Mientras se cuenta, se vende: 3 del cinturón (el sistema pasa de 20 a 17) ──
    await prisma.inventoryLevel.update({ where: { id: (await nivel(v2)).id }, data: { onHand: 17 } })

    // ── La hoja en blanco: qué productos hay, SIN cuántos ─────────────────
    const hoja = await p.request.get(`/admin/inventario/conteos/${idConteo}/hoja`)
    expect(hoja.status()).toBe(200)
    expect(hoja.headers()['content-type']).toContain('text/csv')
    const textoHoja = await hoja.text()
    expect(textoHoja).toContain('sku;codigo_de_barras;producto;contado')
    expect(textoHoja).toMatch(new RegExp(`^${S1};${C1};${N1};$`, 'm'))
    expect(textoHoja).toMatch(new RegExp(`^${S3};;${N3};$`, 'm'))

    // ── Importar lo contado: con un error no entra nada; limpio, sí ───────
    await p.getByRole('link', { name: 'Importar hoja contada' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}/importar`)
    const subir = (nombre: string, contenido: string) => p.getByLabel('Archivo CSV').setInputFiles({ name: nombre, mimeType: 'text/csv', buffer: Buffer.from(contenido, 'utf8') })
    await subir('malo.csv', `sku;contado\n${S3};abc\n${S1};\nNO-EXISTE-${sufijo};2\n`)
    await p.getByRole('button', { name: 'Revisar archivo' }).click()
    await expect(p.getByText(/2 filas con problemas/)).toBeVisible({ timeout: 15_000 })
    await expect(p.getByRole('list', { name: 'Filas con problemas' })).toContainText('entero de cero en adelante')
    await expect(p.getByRole('button', { name: /^Cargar/ })).toHaveCount(0)
    await p.goto(`/admin/inventario/conteos/${idConteo}/importar`)
    await subir('limpio.csv', `sku;contado\n${S3};7\n${S1};\n`)
    await p.getByRole('button', { name: 'Revisar archivo' }).click()
    await expect(p.getByText(/El archivo está limpio/)).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText('Sin contar (se ignoran)').locator('..')).toContainText('1')
    await p.getByRole('button', { name: 'Cargar 1 producto contado' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}`, { timeout: 30_000 })
    await expect(p.getByRole('heading', { name: /^Productos contados \(3\)$/ })).toBeVisible({ timeout: 20_000 })
    await expect(p.getByRole('list', { name: 'Productos contados' }).getByLabel(`Contado de ${N3}`)).toHaveValue('7')

    // ── Revisar: ahora SÍ se ve lo esperado y la diferencia ───────────────
    await p.getByRole('link', { name: 'Revisar y aplicar' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}/revisar`)
    await expect(p.getByRole('heading', { name: `Revisar ${numero}`, level: 1 })).toBeVisible()
    const dif = p.getByRole('list', { name: 'Diferencias por producto' })
    const f1 = dif.getByRole('listitem').filter({ hasText: N1 })
    const f2 = dif.getByRole('listitem').filter({ hasText: N2 })
    const f3 = dif.getByRole('listitem').filter({ hasText: N3 })
    await expect(f1).toContainText('Faltante')
    await expect(f1.getByText('Esperado').locator('..')).toContainText('10')
    await expect(f1.getByText('Contado').locator('..')).toContainText('8')
    await expect(f2).toContainText('Sobrante')
    await expect(f2.getByText('Esperado').locator('..')).toContainText('20')
    await expect(f3).toContainText('Coincide')
    const resumen = p.getByLabel('Resumen de diferencias')
    await expect(resumen).toContainText('Productos contados')
    await expect(resumen).toContainText('+5 u.')
    await expect(resumen).toContainText('−2 u.')
    const csvDif = await p.request.get(`/admin/inventario/conteos/${idConteo}/exportar`)
    expect(csvDif.status()).toBe(200)
    expect(csvDif.headers()['content-type']).toContain('text/csv')
    const textoDif = await csvDif.text()
    expect(textoDif).toContain(`Número;${numero}`)
    expect(textoDif).toMatch(new RegExp(`${S1};${C1};${N1};10;8;-2;Faltante`))
    expect(textoDif).toMatch(new RegExp(`${S2};;${N2};20;25;5;Sobrante`))

    // ── Aplicar: por la DIFERENCIA, así que la venta de mientras se contaba se conserva (17 + 5 = 22) ──
    await p.getByLabel('Revisé las diferencias y quiero ajustar las existencias.').check()
    await p.getByRole('button', { name: 'Aplicar conteo' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}`, { timeout: 30_000 })
    await expect(p.getByText(/^Aplicado \d/)).toBeVisible({ timeout: 20_000 })
    const informe = p.getByRole('list', { name: 'Diferencias por producto' })
    await expect(informe.getByRole('listitem').filter({ hasText: N1 })).toContainText('10 → 8')
    await expect(informe.getByRole('listitem').filter({ hasText: N2 })).toContainText('17 → 22')
    await expect(informe.getByRole('listitem').filter({ hasText: N3 })).toContainText('sin cambio')
    expect((await nivel(v1)).onHand).toBe(8)
    expect((await nivel(v2)).onHand).toBe(22)
    expect((await nivel(v3)).onHand).toBe(7)
    // Un conteo aplicado ya no se captura ni se revisa.
    await expect(p.getByLabel('Escanear o buscar un producto para contar')).toHaveCount(0)
    await p.goto(`/admin/inventario/conteos/${idConteo}/revisar`)
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}`)
    // Y los ajustes quedan en el historial con el número del conteo.
    await p.goto(`/admin/inventario/movimientos?q=${encodeURIComponent(S1)}`)
    await expect(p.getByRole('list', { name: 'Movimientos de inventario' }).getByRole('listitem').first()).toContainText('Conteo físico')

    // ── La lista: aplicado, con su resumen ────────────────────────────────
    await p.goto('/admin/inventario/conteos')
    const conteos = p.getByRole('list', { name: 'Conteos físicos' })
    await expect(conteos.getByRole('listitem').first()).toContainText(numero)
    await expect(conteos.getByRole('listitem').first()).toContainText('Aplicado')
    await expect(conteos.getByRole('listitem').first()).toContainText('+5')
    await expect(conteos.getByRole('listitem').first()).toContainText('−2')

    // ── Un faltante que dejaría menos de lo apartado: se avisa de antemano y NO se aplica NADA ──
    await prisma.inventoryLevel.update({ where: { id: (await nivel(v1)).id }, data: { reserved: 7 } }) // 8 en estante, 7 apartadas
    await p.goto('/admin/inventario/conteos')
    const abrir2 = p.getByRole('form', { name: 'Iniciar conteo' })
    await abrir2.getByLabel('Sucursal que vas a contar').selectOption({ label: 'Principal' })
    await abrir2.getByRole('button', { name: 'Abrir conteo' }).click()
    await p.waitForURL(/\/admin\/inventario\/conteos\/(?!nuevo)[^/]+$/, { timeout: 30_000 })
    const idConteo2 = p.url().split('/').pop()!
    expect(idConteo2).not.toBe(idConteo)
    await expect(p.getByRole('heading', { name: /^CNT-\d{4}-000002$/, level: 1 })).toBeVisible()
    const buscar2 = p.getByLabel('Escanear o buscar un producto para contar')
    await buscar2.fill(S1)
    await buscar2.press('Enter')
    await expect(p.getByRole('status')).toContainText(`${N1}: ahora 1 contados`)
    await buscar2.fill(S2)
    await buscar2.press('Enter')
    await expect(p.getByRole('status')).toContainText(`${N2}: ahora 1 contados`)
    await expect(p.getByRole('heading', { name: /^Productos contados \(2\)$/ })).toBeVisible({ timeout: 20_000 })
    await p.getByRole('link', { name: 'Revisar y aplicar' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo2}/revisar`)
    await expect(p.getByText(/Una línea no se podría aplicar hoy/)).toBeVisible()
    await expect(p.getByRole('list', { name: 'Diferencias por producto' }).getByRole('listitem').filter({ hasText: N1 })).toContainText('No se podría aplicar hoy')
    await p.getByLabel('Revisé las diferencias y quiero ajustar las existencias.').check()
    await p.getByRole('button', { name: 'Aplicar conteo' }).click()
    const rechazadas = p.getByRole('list', { name: 'Líneas que no se pueden aplicar' })
    await expect(rechazadas).toBeVisible({ timeout: 20_000 })
    await expect(rechazadas).toContainText(N1)
    await expect(rechazadas).toContainText('menos de lo apartado')
    await expect(p.getByText('No se aplicó nada.')).toBeVisible()
    expect((await nivel(v1)).onHand, 'no se aplicó NADA').toBe(8)
    expect((await nivel(v2)).onHand, 'ni siquiera la línea buena').toBe(22)
    // Se corrige el recuento (quedan 7 en el estante: cabe) y entonces sí.
    await p.getByRole('link', { name: new RegExp(`Seguir contando · ${numero.replace(/\d{6}$/, '000002')}`) }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo2}`)
    const lista2 = p.getByRole('list', { name: 'Productos contados' })
    await lista2.getByLabel(`Contado de ${N1}`).fill('7')
    await lista2.getByLabel(`Contado de ${N1}`).press('Enter')
    await expect.poll(async () => (await prisma.inventoryCountLine.findFirstOrThrow({ where: { sessionId: idConteo2, catalogVariantId: v1 } })).counted, { timeout: 20_000 }).toBe(7)
    await lista2.getByRole('button', { name: `Quitar ${N2} del conteo` }).click()
    await expect(p.getByRole('heading', { name: /^Productos contados \(1\)$/ })).toBeVisible({ timeout: 20_000 })
    await p.getByRole('link', { name: 'Revisar y aplicar' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo2}/revisar`)
    await expect(p.getByText(/no se podría aplicar hoy/i)).toHaveCount(0)
    await p.getByLabel('Revisé las diferencias y quiero ajustar las existencias.').check()
    await p.getByRole('button', { name: 'Aplicar conteo' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo2}`, { timeout: 30_000 })
    await expect(p.getByText(/^Aplicado \d/)).toBeVisible({ timeout: 20_000 })
    expect((await nivel(v1)).onHand).toBe(7)
    expect((await nivel(v1)).reserved, 'lo apartado no se toca').toBe(7)
    expect((await nivel(v2)).onHand, 'el que se quitó del conteo no se tocó').toBe(22)

    // ── Cancelar: no mueve nada, queda guardado con su motivo, y libera la sucursal ──
    await p.goto('/admin/inventario/conteos')
    const abrir3 = p.getByRole('form', { name: 'Iniciar conteo' })
    await abrir3.getByLabel('Sucursal que vas a contar').selectOption({ label: 'Principal' })
    await abrir3.getByRole('button', { name: 'Abrir conteo' }).click()
    await p.waitForURL(/\/admin\/inventario\/conteos\/(?!nuevo)[^/]+$/, { timeout: 30_000 })
    const idConteo3 = p.url().split('/').pop()!
    const buscar3 = p.getByLabel('Escanear o buscar un producto para contar')
    await buscar3.fill(S2)
    await buscar3.press('Enter')
    await expect(p.getByRole('heading', { name: /^Productos contados \(1\)$/ })).toBeVisible({ timeout: 20_000 })
    await p.goto(`/admin/inventario/conteos/${idConteo3}/revisar`)
    await p.getByRole('button', { name: 'Cancelar este conteo' }).click()
    await p.getByLabel(/^Motivo/).fill('Sucursal equivocada')
    await p.getByRole('button', { name: 'Sí, cancelar el conteo' }).click()
    await p.waitForURL('**/admin/inventario/conteos', { timeout: 30_000 })
    await p.goto(`/admin/inventario/conteos/${idConteo3}`)
    await expect(p.getByText(/Cancelado.*Sucursal equivocada.*No se movió ninguna existencia/)).toBeVisible()
    expect((await nivel(v2)).onHand).toBe(22)

    // ── Lo que NO debe pasar ──────────────────────────────────────────────
    // Un conteo inventado no existe: misma página que cualquier id desconocido, y sus descargas dan 404.
    await p.goto('/admin/inventario/conteos/cinexistente000000000000')
    expect(await p.locator('meta[name=robots][content*=noindex]').count()).toBeGreaterThan(0)
    await expect(p.getByRole('list', { name: 'Productos contados' })).toHaveCount(0)
    for (const ruta of ['hoja', 'exportar']) {
      const r = await p.request.get(`/admin/inventario/conteos/cinexistente000000000000/${ruta}`)
      expect(r.status(), ruta).toBe(404)
      expect(r.headers()['content-type'] ?? '', ruta).not.toContain('text/csv')
    }
    // Sin sesión, o de una empresa sin la capacidad, NO sale ni una fila.
    const anonimo = await browser.newContext()
    for (const ruta of [`/admin/inventario/conteos/${idConteo}/exportar`, `/admin/inventario/conteos/${idConteo}/hoja`]) {
      const r = await anonimo.request.get(ruta, { maxRedirects: 0 })
      expect(r.headers()['content-type'] ?? '', ruta).not.toContain('text/csv')
      expect(await r.text(), ruta).not.toContain(S1)
    }
    await anonimo.close()
    const ctxSin = await browser.newContext()
    await entrarComo(ctxSin, 'catalogoSinCapacidad', BASE, sin.id)
    for (const ruta of [`/admin/inventario/conteos/${idConteo}/exportar`, `/admin/inventario/conteos/${idConteo}/hoja`]) {
      const r = await ctxSin.request.get(ruta, { maxRedirects: 0 })
      expect(r.headers()['content-type'] ?? '', ruta).not.toContain('text/csv')
      expect([302, 303, 307, 308, 403, 404], ruta).toContain(r.status())
      expect(await r.text(), ruta).not.toContain(S1)
    }
    const pSin = await ctxSin.newPage()
    await pSin.goto('/admin/inventario/conteos')
    await expect(pSin).not.toHaveURL(/\/admin\/inventario\/conteos$/)
    await ctxSin.close()

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-2c · transferencia con envío: enviar, ver lo que va en camino, recibir en partes, cerrar con faltante, cancelar y recibir todo', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const prisma = prismaDeArnes()

    // Dos productos con existencias en Principal; Norte no tiene nada de ellos.
    const principalId = (await sucursalSembrada(con.id, 'Principal')).id
    const norteId = (await sucursalSembrada(con.id, 'Norte')).id
    const N1 = `Mochila E2E ${sufijo}`
    const N2 = `Botella E2E ${sufijo}`
    const S1 = `TRF1-${sufijo}`
    const S2 = `TRF2-${sufijo}`
    const base = parseInt(sufijo, 36) % 900_000
    const C1 = String(7_504_000_000_000 + base)
    const mk = async (name: string, slug: string, sku: string, barcode: string | undefined, stock: number) => {
      const it = await itemSembrado(con.id, { name, slug, controlaInventario: true, variantes: [{ name: 'Default', sku, barcode, price: 100, porDefecto: true }] })
      const id = await varianteDe(it.id)
      await existenciasSembradas(con.id, id, principalId, stock)
      return id
    }
    const v1 = await mk(N1, `mochila-trf-${sufijo}`, S1, C1, 12)
    const v2 = await mk(N2, `botella-trf-${sufijo}`, S2, undefined, 6)
    const enSuc = async (v: string, suc: string) => (await prisma.inventoryLevel.findFirst({ where: { catalogVariantId: v, locationId: suc } }))?.onHand ?? null

    // ── La pestaña «Transferencias»: vacía, con su botón ──────────────────
    await p.goto('/admin/inventario')
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    await vistas.getByRole('link', { name: 'Transferencias' }).click()
    await p.waitForURL('**/admin/inventario/transferencias')
    await expect(p.getByRole('heading', { name: 'Transferencias entre sucursales', level: 1 })).toBeVisible()
    await expect(vistas.getByRole('link', { name: 'Transferencias' })).toHaveAttribute('aria-current', 'page')
    await expect(p.getByText('Todavía no hay transferencias con envío')).toBeVisible()

    // ── Enviar: se escanea, se ve lo que hay en el origen y no se puede pasar de ahí ──
    await p.getByRole('link', { name: 'Nueva transferencia' }).click()
    await p.waitForURL('**/admin/inventario/transferencias/nueva')
    const form = p.getByRole('form', { name: 'Nueva transferencia con envío' })
    await form.getByLabel('Sucursal que envía').selectOption({ label: 'Principal' })
    await form.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
    await form.getByLabel(/^Nota/).fill('Reposición E2E')
    const buscar = form.getByLabel('Escanear o buscar un producto para enviar')
    const lineas = form.getByRole('list', { name: 'Productos del envío' })
    await buscar.fill(C1)
    await buscar.press('Enter')
    const f1 = lineas.getByRole('listitem').filter({ hasText: N1 })
    await expect(f1).toContainText('hay 12 disponibles en Principal')
    await f1.getByRole('textbox').fill('8')
    await buscar.fill(S2)
    await buscar.press('Enter')
    const f2 = lineas.getByRole('listitem').filter({ hasText: N2 })
    await expect(f2).toContainText('hay 6 disponibles en Principal')
    await f2.getByRole('textbox').fill('9') // más de lo que hay
    await form.getByRole('button', { name: 'Enviar transferencia' }).click()
    await expect(p.getByText(/No alcanza para enviar desde «Principal»/)).toBeVisible({ timeout: 15_000 })
    await expect(p).toHaveURL(/\/transferencias\/nueva$/)
    expect(await enSuc(v1, principalId), 'un envío que no alcanza no saca NADA').toBe(12)
    await f2.getByRole('textbox').fill('6')
    await expect(form.getByText(/2 productos · 14 unidades · de Principal a Norte/)).toBeVisible()
    await form.getByRole('button', { name: 'Enviar transferencia' }).click()
    await p.waitForURL(/\/admin\/inventario\/transferencias\/(?!nueva)[^/]+$/, { timeout: 30_000 })
    const id1 = p.url().split('/').pop()!
    await expect(p.getByRole('heading', { name: /^TRF-\d{4}-000001$/, level: 1 })).toBeVisible()
    const num1 = (await p.getByRole('heading', { level: 1 }).innerText()).trim()
    await expect(p.getByText('En camino', { exact: true }).first()).toBeVisible()
    await expect(p.getByText('Reposición E2E')).toBeVisible()
    const resumen = p.getByLabel('Resumen de la transferencia')
    await expect(resumen.getByText('Enviadas').locator('..')).toContainText('14')
    await expect(resumen.getByText('En camino').locator('..')).toContainText('14')
    expect(await enSuc(v1, principalId)).toBe(4)
    expect(await enSuc(v2, principalId)).toBe(0)
    expect(await enSuc(v1, norteId), 'enviar no toca el destino').toBeNull()
    // Se avisa a los administradores de que viene en camino (después de responder).
    await expect.poll(() => prisma.notificacion.count({ where: { dedupeKey: `traslado-enviado:${id1}` } }), { timeout: 15_000 }).toBeGreaterThan(0)

    // ── En camino: ni en el origen ni en el destino; la ficha lo dice aparte ──
    await p.goto(`/admin/inventario/${v1}`)
    const camino = p.getByLabel('Lo que va en camino')
    await expect(camino).toContainText('En camino entre sucursales (8)')
    await expect(camino).toContainText('8 de Principal a Norte')
    await expect(camino.getByRole('link', { name: num1 })).toHaveAttribute('href', `/admin/inventario/transferencias/${id1}`)
    await expect(p.getByLabel('Totales de todas las sucursales')).toContainText('Disponible (total)')
    expect(await p.getByLabel('Totales de todas las sucursales').innerText()).toMatch(/Disponible \(total\)\s*\n?\s*4\b/)

    // ── La lista: «en camino ahora» ───────────────────────────────────────
    await p.goto('/admin/inventario/transferencias')
    await expect(p.getByRole('list', { name: 'Transferencias en camino' })).toContainText(num1)
    await expect(p.getByRole('list', { name: 'Transferencias en camino' })).toContainText('14 unidades por llegar')

    // ── Recibir en partes: una parte, luego cerrar con faltante ───────────
    await p.goto(`/admin/inventario/transferencias/${id1}`)
    const llego = p.getByRole('list', { name: 'Lo que llegó' })
    await llego.getByLabel(`Llegó de ${N1}`).fill('9') // más de lo que falta (8)
    await expect(p.getByRole('button', { name: 'Recibir lo que llegó' })).toBeDisabled()
    await llego.getByLabel(`Llegó de ${N1}`).fill('5')
    await llego.getByLabel(`Llegó de ${N2}`).fill('0')
    await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
    await expect(p.getByText('Recibida en parte', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    expect(await enSuc(v1, norteId)).toBe(5)
    expect(await enSuc(v2, norteId)).toBeNull()
    await expect(p.getByLabel('Resumen de la transferencia').getByText('En camino').locator('..')).toContainText('9')
    await p.goto(`/admin/inventario/${v1}`)
    await expect(p.getByLabel('Lo que va en camino')).toContainText('En camino entre sucursales (3)')

    await p.goto(`/admin/inventario/transferencias/${id1}`)
    await p.getByRole('button', { name: 'Cerrar con faltante' }).click()
    await p.getByRole('list', { name: 'Lo que llegó' }).getByLabel(`Llegó de ${N1}`).fill('3')
    await p.getByRole('list', { name: 'Lo que llegó' }).getByLabel(`Llegó de ${N2}`).fill('4')
    await p.getByRole('button', { name: 'Confirmar cierre con faltante' }).click() // sin motivo: no cierra
    await expect(p.getByText(/Cerrar con faltante necesita un motivo/)).toBeVisible({ timeout: 15_000 })
    expect(await enSuc(v2, norteId), 'sin motivo no se movió nada').toBeNull()
    await p.getByLabel(/^Motivo del faltante/).fill('Se mojaron 2 botellas en el camino')
    await p.getByRole('button', { name: 'Confirmar cierre con faltante' }).click()
    await expect(p.getByText(/Cerrada .*Se mojaron 2 botellas en el camino/)).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('Recibida', { exact: true }).first()).toBeVisible()
    expect(await enSuc(v1, norteId)).toBe(8)
    expect(await enSuc(v2, norteId)).toBe(4)
    const res = p.getByLabel('Resumen de la transferencia')
    await expect(res.getByText('Recibidas').locator('..')).toContainText('12')
    await expect(res.getByText('Perdidas').locator('..')).toContainText('2')
    await expect(res.getByText('En camino').locator('..')).toContainText('0')
    await expect(p.getByRole('button', { name: 'Recibir lo que llegó' })).toHaveCount(0)
    const movs = p.getByRole('list', { name: 'Movimientos de la transferencia' })
    await expect(movs.getByRole('listitem')).toHaveCount(5) // 2 salidas + 3 entradas (5 de uno, 3 del mismo, 4 del otro)
    await expect(movs.getByRole('listitem').first()).toContainText('Salida')
    await p.goto(`/admin/inventario/${v1}`)
    await expect(p.getByLabel('Lo que va en camino')).toHaveCount(0)

    // ── El CSV de la transferencia ────────────────────────────────────────
    const csv = await p.request.get(`/admin/inventario/transferencias/${id1}/exportar`)
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    const textoCsv = await csv.text()
    for (const esperado of [`Número;${num1}`, 'Estado;Recibida', 'Origen;Principal', 'Destino;Norte', 'Unidades perdidas;2', `${S1};${C1};${N1};8;8;0;0;0`, `${S2};;${N2};6;4;0;2;0`, 'Se mojaron 2 botellas en el camino']) {
      expect(textoCsv).toContain(esperado)
    }

    // ── Cancelar: lo que sigue en camino VUELVE al origen ─────────────────
    await p.goto('/admin/inventario/transferencias/nueva')
    const form2 = p.getByRole('form', { name: 'Nueva transferencia con envío' })
    await form2.getByLabel('Sucursal que envía').selectOption({ label: 'Principal' })
    await form2.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
    await form2.getByLabel('Escanear o buscar un producto para enviar').fill(S1)
    await form2.getByLabel('Escanear o buscar un producto para enviar').press('Enter')
    await form2.getByRole('list', { name: 'Productos del envío' }).getByRole('textbox').fill('3')
    await form2.getByRole('button', { name: 'Enviar transferencia' }).click()
    await p.waitForURL(/\/admin\/inventario\/transferencias\/(?!nueva)[^/]+$/, { timeout: 30_000 })
    const id2 = p.url().split('/').pop()!
    await expect(p.getByRole('heading', { name: /^TRF-\d{4}-000002$/, level: 1 })).toBeVisible()
    expect(await enSuc(v1, principalId)).toBe(1)
    await p.getByRole('button', { name: 'Cancelar envío' }).click()
    await p.getByLabel(/^Motivo \(opcional\)/).fill('El destino ya no lo necesita')
    await p.getByRole('button', { name: /^Sí, cancelar la transferencia TRF-/ }).click()
    await expect(p.getByText('Cancelada', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText(/Cancelada .*El destino ya no lo necesita/)).toBeVisible()
    expect(await enSuc(v1, principalId), 'volvieron al origen').toBe(4)
    expect(await enSuc(v1, norteId), 'y lo que ya había llegado se quedó').toBe(8)
    await expect(p.getByLabel('Resumen de la transferencia').getByText('Devueltas al origen').locator('..')).toContainText('3')

    // ── Una tercera se recibe completa de una vez y otra queda en camino ──
    const enviarRapido = async (sku: string, cantidad: string) => {
      await p.goto('/admin/inventario/transferencias/nueva')
      const f = p.getByRole('form', { name: 'Nueva transferencia con envío' })
      await f.getByLabel('Sucursal que envía').selectOption({ label: 'Principal' })
      await f.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
      await f.getByLabel('Escanear o buscar un producto para enviar').fill(sku)
      await f.getByLabel('Escanear o buscar un producto para enviar').press('Enter')
      await f.getByRole('list', { name: 'Productos del envío' }).getByRole('textbox').fill(cantidad)
      await f.getByRole('button', { name: 'Enviar transferencia' }).click()
      await p.waitForURL(/\/admin\/inventario\/transferencias\/(?!nueva)[^/]+$/, { timeout: 30_000 })
      return p.url().split('/').pop()!
    }
    const id3 = await enviarRapido(S1, '2')
    await p.getByRole('button', { name: 'Recibir todo lo pendiente' }).click()
    await expect(p.getByText('Recibida', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    expect(await enSuc(v1, norteId)).toBe(10)
    const id4 = await enviarRapido(S1, '1')

    // ── La lista y sus filtros ────────────────────────────────────────────
    await p.goto('/admin/inventario/transferencias')
    await expect(p.getByRole('list', { name: 'Transferencias en camino' }).getByRole('listitem')).toHaveCount(1)
    await expect(p.getByRole('list', { name: 'Transferencias en camino' })).toContainText('TRF-')
    const todas = p.getByRole('list', { name: 'Transferencias', exact: true })
    await expect(todas.getByRole('listitem')).toHaveCount(4)
    await expect(todas.getByRole('listitem').first()).toContainText('En camino')
    const filtrar = p.getByRole('form', { name: 'Filtrar transferencias' })
    await filtrar.getByLabel('Estado').selectOption({ label: 'Cancelada' })
    await filtrar.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/estado=CANCELLED/)
    await expect(todas.getByRole('listitem')).toHaveCount(1)
    await expect(todas.getByRole('link', { name: new RegExp(num1.replace('000001', '000002')) })).toHaveAttribute('href', `/admin/inventario/transferencias/${id2}`)
    await p.goto('/admin/inventario/transferencias?estado=XXX&desde=2030-02-31&cursor=basura&sucursal=ajena&q=%27%3Cscript%3E')
    await expect(p.getByRole('heading', { name: 'Transferencias entre sucursales', level: 1 })).toBeVisible()
    // El detalle abierto de la que quedó en camino sigue con su formulario para recibirla.
    await p.goto(`/admin/inventario/transferencias/${id4}`)
    await expect(p.getByRole('button', { name: 'Recibir todo lo pendiente' })).toBeVisible()
    expect(id3).not.toBe(id4)

    // ── Lo que NO debe pasar ──────────────────────────────────────────────
    await p.goto('/admin/inventario/transferencias/cinexistente000000000000')
    expect(await p.locator('meta[name=robots][content*=noindex]').count()).toBeGreaterThan(0)
    await expect(p.getByRole('list', { name: 'Líneas de la transferencia' })).toHaveCount(0)
    const inventada = await p.request.get('/admin/inventario/transferencias/cinexistente000000000000/exportar')
    expect(inventada.status()).toBe(404)
    expect(inventada.headers()['content-type'] ?? '').not.toContain('text/csv')
    const anonimo = await browser.newContext()
    const sinSesion = await anonimo.request.get(`/admin/inventario/transferencias/${id1}/exportar`, { maxRedirects: 0 })
    expect(sinSesion.headers()['content-type'] ?? '').not.toContain('text/csv')
    expect(await sinSesion.text()).not.toContain(S1)
    await anonimo.close()
    const ctxSin = await browser.newContext()
    await entrarComo(ctxSin, 'catalogoSinCapacidad', BASE, sin.id)
    const sinCapacidad = await ctxSin.request.get(`/admin/inventario/transferencias/${id1}/exportar`, { maxRedirects: 0 })
    expect(sinCapacidad.headers()['content-type'] ?? '').not.toContain('text/csv')
    expect([302, 303, 307, 308, 403, 404]).toContain(sinCapacidad.status())
    expect(await sinCapacidad.text()).not.toContain(S1)
    const pSin = await ctxSin.newPage()
    await pSin.goto('/admin/inventario/transferencias')
    await expect(pSin).not.toHaveURL(/\/admin\/inventario\/transferencias$/)
    await ctxSin.close()

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-3a · costo y valor: entradas con costo, promedio ponderado, valor del inventario, costo de ventas, corregir, importar con costo — y quien no tiene «costos» no ve ni una cifra', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    // Una empresa propia: los totales del valor tienen que ser exactos y no depender de lo que dejaron las demás pruebas.
    const emp = await empresaCatalogo(sufijo, 'invcosto', { capacidad: true })
    const prisma = prismaDeArnes()
    const principal = (await sucursalSembrada(emp.id, 'Principal')).id
    const norte = (await sucursalSembrada(emp.id, 'Norte')).id
    const NA = `Taza E2E ${sufijo}`
    const NB = `Plato E2E ${sufijo}`
    const NC = `Vaso E2E ${sufijo}`
    const SA = `CST-A-${sufijo}`
    const SB = `CST-B-${sufijo}`
    const SC = `CST-C-${sufijo}`
    const mk = async (name: string, slug: string, sku: string, cost?: number) => {
      const it = await itemSembrado(emp.id, { name, slug, controlaInventario: true, variantes: [{ name: 'Default', sku, price: 100, cost, porDefecto: true }] })
      return varianteDe(it.id)
    }
    const vA = await mk(NA, `taza-cst-${sufijo}`, SA)
    const vB = await mk(NB, `plato-cst-${sufijo}`, SB)
    const vC = await mk(NC, `vaso-cst-${sufijo}`, SC, 3) // con costo de referencia en su ficha
    await existenciasSembradas(emp.id, vB, principal, 4) // existencias de antes de llevar costos: sin costo
    await existenciasSembradas(emp.id, vC, norte, 2)
    const email = 'e2e.catalogo.con@membego.test'
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, emp.id)
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    const fila = (lista: Locator, nombre: string) => lista.getByRole('listitem').filter({ hasText: nombre })

    try {
      // ── La pestaña «Valor»: lo que tiene referencia vale, lo que no tiene costo se dice ──
      await p.goto('/admin/inventario')
      await vistas.getByRole('link', { name: 'Valor' }).click()
      await p.waitForURL('**/admin/inventario/valor')
      await expect(p.getByRole('heading', { name: 'Valor del inventario', level: 1 })).toBeVisible()
      await expect(vistas.getByRole('link', { name: 'Valor' })).toHaveAttribute('aria-current', 'page')
      const resumen = p.getByLabel('Resumen del valor')
      await expect(resumen).toContainText('6.00') // 2 vasos × la referencia de 3.00
      const sinCosto = p.getByLabel('Lo que no tiene costo')
      await expect(sinCosto).toContainText('1 producto (4 unidades) no tiene costo')
      const productos = p.getByRole('list', { name: 'Valor por producto' })
      await expect(productos.getByRole('listitem')).toHaveCount(2)
      await expect(fila(productos, NC)).toContainText('referencia del catálogo')
      await expect(fila(productos, NB)).toContainText('Sin costo')

      // ── Una entrada CON costo: el promedio nace con el costo de la entrada ──
      await p.goto('/admin/inventario/entradas/nueva')
      let form = p.getByRole('form', { name: 'Nueva entrada de mercancía' })
      await form.getByLabel('Sucursal que recibe').selectOption({ label: 'Principal' })
      let buscar = form.getByLabel('Escanear o buscar un producto')
      let lineas = form.getByRole('list', { name: 'Productos de la entrada' })
      await buscar.fill(SA)
      await buscar.press('Enter')
      await expect(fila(lineas, NA)).toHaveCount(1)
      await fila(lineas, NA).getByLabel(/^Cantidad de /).fill('10')
      await fila(lineas, NA).getByLabel(/^Costo unitario de /).fill('1,5')
      await form.getByRole('button', { name: 'Registrar entrada' }).click()
      await expect(p.getByText(/Revisa el costo de/)).toBeVisible() // la coma se rechaza con un mensaje que dice qué hacer
      await expect(p).toHaveURL(/\/entradas\/nueva$/)
      await fila(lineas, NA).getByLabel(/^Costo unitario de /).fill('5')
      await form.getByRole('button', { name: 'Registrar entrada' }).click()
      await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/, { timeout: 30_000 })
      const idEntrada1 = p.url().split('/').pop()!
      await expect(p.getByLabel('Resumen de la entrada')).toContainText('50.00') // 10 × 5.00
      await expect(p.getByRole('list', { name: 'Líneas de la entrada' })).toContainText('a 5.00 c/u')

      // ── Otra, en Norte, a otro costo, y una línea SIN costo ──────────────
      await p.goto('/admin/inventario/entradas/nueva')
      form = p.getByRole('form', { name: 'Nueva entrada de mercancía' })
      await form.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
      buscar = form.getByLabel('Escanear o buscar un producto')
      lineas = form.getByRole('list', { name: 'Productos de la entrada' })
      await buscar.fill(SA)
      await buscar.press('Enter')
      await expect(fila(lineas, NA)).toHaveCount(1)
      await buscar.fill(SB)
      await buscar.press('Enter')
      await expect(fila(lineas, NB)).toHaveCount(1)
      await fila(lineas, NA).getByLabel(/^Cantidad de /).fill('10')
      await fila(lineas, NA).getByLabel(/^Costo unitario de /).fill('7')
      await form.getByRole('button', { name: 'Registrar entrada' }).click()
      await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/, { timeout: 30_000 })
      await expect(p.getByLabel('Resumen de la entrada')).toContainText('70.00') // solo cuenta la línea con costo
      await expect(p.getByRole('list', { name: 'Líneas de la entrada' })).toContainText('Sin costo')
      await expect(p.getByText(/1 línea sin costo: no movieron el costo promedio/)).toBeVisible()

      // ── La ficha: el promedio ponderado de 10 a 5 y 10 a 7 es 6 ──────────
      await p.goto(`/admin/inventario/${vA}`)
      const costoA = p.getByLabel('Costo y valor del producto')
      await expect(costoA).toContainText('6.00')
      await expect(costoA).toContainText('promedio de las entradas')
      await expect(costoA).toContainText('120.00') // 20 unidades × 6.00

      // ── La pantalla del valor, con todo junto ────────────────────────────
      await p.goto('/admin/inventario/valor')
      await expect(p.getByLabel('Resumen del valor')).toContainText('126.00') // 120.00 de las tazas + 6.00 de los vasos
      await expect(p.getByLabel('Lo que no tiene costo')).toContainText('1 producto (5 unidades) no tiene costo')
      const sucursales = p.getByRole('list', { name: 'Valor por sucursal' })
      await expect(fila(sucursales, 'Principal')).toContainText('60.00')
      await expect(fila(sucursales, 'Norte')).toContainText('66.00')
      await p.goto('/admin/inventario/valor?sinCosto=1')
      await expect(productos.getByRole('listitem')).toHaveCount(1)
      await expect(productos).toContainText(NB)
      await p.goto('/admin/inventario/valor?q=taza')
      await expect(productos.getByRole('listitem')).toHaveCount(1)
      await expect(productos).toContainText(NA)
      await p.goto('/admin/inventario/valor?pagina=999&mes=2026-13&sucursal=ajena&q=%27%3Cscript%3E') // una URL manipulada no rompe nada
      await expect(p.getByRole('heading', { name: 'Valor del inventario', level: 1 })).toBeVisible()

      // ── Fijar el costo de lo que ya había: exige un motivo ───────────────
      await p.goto(`/admin/inventario/${vB}`)
      const cardB = p.getByLabel('Costo y valor del producto')
      await expect(cardB).toContainText('Sin costo')
      const corregir = p.getByRole('form', { name: 'Corregir el costo' })
      await corregir.getByLabel('Costo del producto').fill('2.5')
      await corregir.getByRole('button', { name: 'Fijar costo' }).click()
      await expect(p.getByText(/Escribe el motivo de la corrección/)).toBeVisible()
      await corregir.getByLabel(/^Motivo/).fill('Costo de la última compra')
      await corregir.getByRole('button', { name: 'Fijar costo' }).click()
      await expect(p.getByText(/Costo corregido a 2\.50/)).toBeVisible({ timeout: 15_000 })
      await expect(cardB).toContainText('2.50')
      await expect(cardB).toContainText('12.50') // 5 unidades × 2.50
      await expect(p.getByRole('list', { name: 'Correcciones del costo' })).toContainText('sin costo → 2.50')
      await expect(p.getByRole('list', { name: 'Correcciones del costo' })).toContainText('Costo de la última compra')
      await p.goto('/admin/inventario/valor')
      await expect(p.getByLabel('Resumen del valor')).toContainText('138.50') // 126.00 + 12.50
      await expect(p.getByLabel('Lo que no tiene costo')).toHaveCount(0)

      // ── La entrada de un solo producto desde su ficha, con costo: pondera 20 a 6 con 5 a 10 = 6.80 ──
      await p.goto(`/admin/inventario/${vA}`)
      const tPrincipal = tarjeta(p, 'Principal')
      const f = p.getByRole('form', { name: 'Registrar movimiento en Principal' })
      await f.getByLabel('Movimiento').selectOption({ label: 'Entrada de mercancía' })
      await f.getByRole('textbox').first().fill('5')
      await f.getByLabel(/^Costo unitario/).fill('10')
      await f.getByRole('button', { name: 'Registrar' }).click()
      await expect(p.getByText(/Entrada registrada/)).toBeVisible({ timeout: 15_000 })
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('6.80')
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('170.00') // 25 unidades × 6.80
      expect(await cifra(tPrincipal, 'Disponible')).toBe(15)

      // ── Importar un CSV con columna de costo ─────────────────────────────
      await p.goto('/admin/inventario/importar')
      await expect(p.getByText(/y costo unitario opcional/)).toBeVisible()
      const plantilla = await p.request.get('/admin/inventario/importar/plantilla')
      expect(plantilla.status()).toBe(200)
      expect(await plantilla.text()).toContain(';costo;')
      await p.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
      const subir = (nombre: string, contenido: string) => p.getByLabel('Archivo CSV').setInputFiles({ name: nombre, mimeType: 'text/csv', buffer: Buffer.from(contenido, 'utf8') })
      await subir('malo.csv', `sku;cantidad;costo\n${SA};2;1,5\n${SC};1;\n`)
      await p.getByRole('button', { name: 'Revisar archivo' }).click()
      await expect(p.getByText(/1 fila con problemas/)).toBeVisible({ timeout: 15_000 })
      await expect(p.getByRole('list', { name: 'Filas con problemas' })).toContainText('coma')
      await subir('limpio.csv', `sku;cantidad;costo\n${SA};2;8\n${SC};1;\n`)
      await p.getByRole('button', { name: 'Revisar archivo' }).click()
      await expect(p.getByText(/El archivo está limpio/)).toBeVisible({ timeout: 15_000 })
      await expect(p.getByText(/1 de 2 líneas traen costo/)).toBeVisible()
      await expect(p.getByRole('list', { name: 'Vista previa de la entrada' })).toContainText('a 8.00 c/u')
      await p.getByRole('button', { name: 'Registrar entrada de 2 productos en Norte' }).click()
      await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/, { timeout: 30_000 })
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('6.8889') // (25 × 6.80 + 2 × 8.00) / 27
      await p.goto(`/admin/inventario/${vC}`)
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('referencia del catálogo') // sin costo en la línea: el vaso no cambió

      // ── El costo de ventas del mes, con el costo que cada venta congeló ───
      const nivelA = await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: vA, locationId: principal } })
      const venta = (cantidad: number, costo: string | null) =>
        prisma.inventoryMovement.create({
          data: { companyId: emp.id, inventoryLevelId: nivelA.id, type: 'SALE', sourceBucket: 'AVAILABLE', quantity: cantidad, previousOnHand: 15, newOnHand: 15 - cantidad, unitCost: costo },
        })
      await venta(2, '6.8889') // 13.7778
      await venta(1, null) // una venta de antes de llevar costos
      await p.goto('/admin/inventario/valor')
      const cogs = p.getByLabel('Costo de ventas del mes')
      await expect(cogs).toContainText(/Costo de ventas · \d{4}-\d{2}/)
      await expect(cogs).toContainText('13.78')
      await expect(cogs).toContainText('3 unidades vendidas')
      await expect(p.getByLabel('Lo que no tiene costo')).toContainText('1 unidad vendida')

      // ── Los archivos: el valor y la entrada, con números que se suman ────
      const csvValor = await p.request.get('/admin/inventario/valor/exportar')
      expect(csvValor.status()).toBe(200)
      expect(csvValor.headers()['content-type'] ?? '').toContain('text/csv')
      const textoValor = await csvValor.text()
      expect(textoValor).toContain('Valor del inventario')
      expect(textoValor).toContain(NA)
      expect(textoValor).not.toMatch(/\d,\d{3}\.\d{2}/) // sin separador de miles
      const csvEntrada = await p.request.get(`/admin/inventario/entradas/${idEntrada1}/exportar`)
      expect(await csvEntrada.text()).toContain('Costo unitario')

      // ── Quien NO tiene la función «costos» no ve una sola cifra ──────────
      await prisma.user.update({ where: { email }, data: { permisos: { v: 1, secciones: {}, funciones: { inventario: { costos: false } } } } })
      await p.goto('/admin/inventario')
      await expect(vistas.getByRole('link', { name: 'Existencias' })).toBeVisible()
      await expect(vistas.getByRole('link', { name: 'Valor' })).toHaveCount(0)
      await p.goto('/admin/inventario/valor')
      await expect(p.getByText(/No tienes permiso para ver costos ni el valor del inventario/)).toBeVisible()
      await expect(p.getByLabel('Resumen del valor')).toHaveCount(0)
      const sinValor = await p.request.get('/admin/inventario/valor/exportar')
      expect(sinValor.status()).toBe(403)
      expect(sinValor.headers()['content-type'] ?? '').not.toContain('text/csv')
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByLabel('Costo y valor del producto')).toHaveCount(0)
      await expect(p.getByLabel(/^Costo unitario/)).toHaveCount(0)
      expect(await p.locator('body').innerText()).not.toContain('6.8889')
      await p.goto(`/admin/inventario/entradas/${idEntrada1}`)
      await expect(p.getByRole('heading', { level: 1 })).toContainText('ENT-')
      await expect(p.getByText('Costo de la entrada')).toHaveCount(0)
      expect(await p.locator('body').innerText()).not.toContain('50.00')
      const sinCostoCsv = await p.request.get(`/admin/inventario/entradas/${idEntrada1}/exportar`)
      expect(sinCostoCsv.status()).toBe(200)
      expect(await sinCostoCsv.text()).not.toMatch(/[Cc]osto/)
      await p.goto('/admin/inventario/entradas/nueva')
      form = p.getByRole('form', { name: 'Nueva entrada de mercancía' })
      buscar = form.getByLabel('Escanear o buscar un producto')
      await buscar.fill(SA)
      await buscar.press('Enter')
      await expect(form.getByRole('list', { name: 'Productos de la entrada' }).getByRole('listitem')).toHaveCount(1)
      await expect(form.getByLabel(/^Costo unitario de /)).toHaveCount(0)
      const plantillaSin = await p.request.get('/admin/inventario/importar/plantilla')
      expect(await plantillaSin.text()).not.toContain('costo')
      await p.goto('/admin/inventario/importar')
      await p.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
      await subir('con-costo.csv', `sku;cantidad;costo\n${SA};1;5\n`)
      await p.getByRole('button', { name: 'Revisar archivo' }).click()
      await expect(p.getByText(/no tiene permiso para registrar costos/)).toBeVisible({ timeout: 15_000 })
    } finally {
      await prisma.user.update({ where: { email }, data: { permisos: Prisma.DbNull } })
    }

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-3b · proveedores y órdenes de compra: crear, pedir, recibir en tandas con costo, cerrar con faltante, cancelar — y quien no tiene «comprar» no ve ni una orden', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    // Una empresa propia: los totales y los números de orden tienen que ser exactos.
    const emp = await empresaCatalogo(sufijo, 'invcompra', { capacidad: true })
    const prisma = prismaDeArnes()
    await sucursalSembrada(emp.id, 'Principal')
    const NA = `Harina E2E ${sufijo}`
    const NB = `Azúcar E2E ${sufijo}`
    const SA = `CMP-A-${sufijo}`
    const SB = `CMP-B-${sufijo}`
    const mk = async (name: string, slug: string, sku: string) => {
      const it = await itemSembrado(emp.id, { name, slug, controlaInventario: true, variantes: [{ name: 'Default', sku, price: 100, porDefecto: true }] })
      return varianteDe(it.id)
    }
    const vA = await mk(NA, `harina-cmp-${sufijo}`, SA)
    const vB = await mk(NB, `azucar-cmp-${sufijo}`, SB)
    const PROVEEDOR = `Distribuidora Norte ${sufijo}`
    const email = 'e2e.catalogo.con@membego.test'
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, emp.id)
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    const fila = (lista: Locator, nombre: string) => lista.getByRole('listitem').filter({ hasText: nombre })

    try {
      // ── Las pestañas nuevas, y la de proveedores vacía ───────────────────
      await p.goto('/admin/inventario')
      await expect(vistas.getByRole('link', { name: 'Compras' })).toBeVisible()
      await vistas.getByRole('link', { name: 'Proveedores' }).click()
      await p.waitForURL('**/admin/inventario/proveedores')
      await expect(p.getByRole('heading', { name: 'Proveedores', level: 1 })).toBeVisible()
      await expect(vistas.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('aria-current', 'page')
      await expect(p.getByText('Todavía no hay proveedores')).toBeVisible()

      // ── Sin proveedor no hay orden que hacer ──────────────────────────────
      await p.goto('/admin/inventario/compras/nueva')
      await expect(p.getByText(/primero registra a tu proveedor/)).toBeVisible()

      // ── Crear un proveedor: el nombre no se repite (ni por mayúsculas) ───
      await p.goto('/admin/inventario/proveedores')
      const nuevoProveedor = p.getByRole('form', { name: 'Nuevo proveedor' })
      await nuevoProveedor.getByLabel('Nombre *').fill(PROVEEDOR)
      await nuevoProveedor.getByLabel(/^Días de crédito/).fill('30')
      await nuevoProveedor.getByLabel(/^Contacto/).fill('Ana Pérez')
      await nuevoProveedor.getByRole('button', { name: 'Crear proveedor' }).click()
      await expect(p.getByText(`Proveedor «${PROVEEDOR}» creado.`)).toBeVisible({ timeout: 15_000 })
      const listaProveedores = p.getByRole('list', { name: 'Proveedores' })
      await expect(fila(listaProveedores, PROVEEDOR)).toContainText('30 días de crédito')
      await nuevoProveedor.getByLabel('Nombre *').fill(PROVEEDOR.toUpperCase())
      await nuevoProveedor.getByRole('button', { name: 'Crear proveedor' }).click()
      await expect(p.getByText(/Ya tienes un proveedor con ese nombre/)).toBeVisible({ timeout: 15_000 })
      await expect(listaProveedores.getByRole('listitem')).toHaveCount(1)

      // ── Una orden nueva: el costo es obligatorio y se rechaza con coma ───
      await p.goto('/admin/inventario/compras/nueva')
      let form = p.getByRole('form', { name: 'Nueva orden de compra' })
      await expect(form.getByLabel('Proveedor')).toContainText(PROVEEDOR)
      const buscar = form.getByLabel('Escanear o buscar un producto')
      const lineas = form.getByRole('list', { name: 'Productos de la orden' })
      await buscar.fill(SA)
      await buscar.press('Enter')
      await expect(fila(lineas, NA)).toHaveCount(1)
      await buscar.fill(SB)
      await buscar.press('Enter')
      await expect(fila(lineas, NB)).toHaveCount(1)
      await fila(lineas, NA).getByLabel(/^Cantidad de /).fill('10')
      await form.getByRole('button', { name: 'Guardar borrador' }).click()
      await expect(p.getByText(/escribe el costo\. Una orden de compra dice cuánto cuesta/)).toBeVisible()
      await fila(lineas, NA).getByLabel(/^Costo de /).fill('1,5')
      await form.getByRole('button', { name: 'Guardar borrador' }).click()
      await expect(p.getByText(/lleva una coma/)).toBeVisible()
      await expect(p).toHaveURL(/\/compras\/nueva$/)
      await fila(lineas, NA).getByLabel(/^Costo de /).fill('5')
      await fila(lineas, NB).getByLabel(/^Cantidad de /).fill('6')
      await fila(lineas, NB).getByLabel(/^Costo de /).fill('2.5')
      await expect(form.getByText(/2 productos · 16 unidades · 65\.00/)).toBeVisible() // 10 × 5 + 6 × 2.50
      await form.getByLabel(/^Cotización o referencia/).fill('Cotización 2231')
      await form.getByRole('button', { name: 'Guardar borrador' }).click()
      await p.waitForURL(/\/admin\/inventario\/compras\/(?!nueva)[^/]+$/, { timeout: 30_000 })
      const idOrden = p.url().split('/').pop()!
      const numero = (await p.getByRole('heading', { level: 1 }).innerText()).trim()
      expect(numero).toMatch(/^OC-\d{4}-\d{6}$/)
      await expect(p.getByText('Borrador', { exact: true }).first()).toBeVisible()
      await expect(p.getByLabel('Resumen de la orden')).toContainText('16 · 65.00')
      // Un borrador no mueve el inventario ni los costos.
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('Sin costo')
      expect(await prisma.inventoryLevel.count({ where: { catalogVariantId: vA } })).toBe(0)

      // ── Editar el borrador: cambia la cantidad, conserva el número ───────
      await p.goto(`/admin/inventario/compras/${idOrden}`)
      await p.getByRole('link', { name: 'Editar' }).click()
      await p.waitForURL(`**/compras/${idOrden}/editar`)
      form = p.getByRole('form', { name: 'Editar orden de compra' })
      await expect(fila(form.getByRole('list', { name: 'Productos de la orden' }), NA).getByLabel(/^Costo de /)).toHaveValue('5')
      await fila(form.getByRole('list', { name: 'Productos de la orden' }), NA).getByLabel(/^Cantidad de /).fill('12')
      await form.getByRole('button', { name: 'Guardar borrador' }).click()
      await p.waitForURL(`**/compras/${idOrden}`)
      await expect(p.getByRole('heading', { level: 1 })).toHaveText(numero)
      await expect(p.getByLabel('Resumen de la orden')).toContainText('18 · 75.00') // 12 × 5 + 6 × 2.50

      // ── Pedirla: desde aquí las líneas no se editan ───────────────────────
      await p.getByRole('button', { name: 'Pedir al proveedor' }).click()
      await expect(p.getByText(new RegExp(`Orden ${numero} pedida a ${PROVEEDOR}`))).toBeVisible({ timeout: 15_000 })
      await expect(p.getByText('Pedida', { exact: true }).first()).toBeVisible()
      await expect(p.getByRole('link', { name: 'Editar' })).toHaveCount(0)
      await p.goto(`/admin/inventario/compras/${idOrden}/editar`)
      await expect(p.getByText(/Esta orden ya se pidió: no se edita/)).toBeVisible()
      // Todavía no llegó nada: la ficha lo enseña como pedido, no como existencia.
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByLabel('Lo que está pedido a proveedores')).toContainText('12 de')
      await expect(p.getByLabel('Lo que está pedido a proveedores')).toContainText(numero)

      // ── Recibir una parte: entra al inventario con el costo de la orden ──
      await p.goto(`/admin/inventario/compras/${idOrden}`)
      const recibir = p.getByRole('list', { name: 'Lo que llegó' })
      await expect(fila(recibir, NA).getByLabel(/^Llegó de /)).toHaveValue('12')
      await fila(recibir, NA).getByLabel(/^Llegó de /).fill('13')
      await expect(fila(recibir, NA).getByLabel(/^Llegó de /)).toHaveAttribute('aria-invalid', 'true') // no se recibe más de lo pedido
      await expect(p.getByRole('button', { name: 'Recibir lo que llegó' })).toBeDisabled()
      await fila(recibir, NA).getByLabel(/^Llegó de /).fill('7')
      await fila(recibir, NB).getByLabel(/^Llegó de /).fill('0')
      await p.getByLabel(/^Factura o remisión/).fill('FAC-00231')
      await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
      await expect(p.getByText(/Recibidas 7 en Principal \(entrada ENT-/)).toBeVisible({ timeout: 20_000 })
      await expect(p.getByText('Recibida en parte', { exact: true }).first()).toBeVisible()
      await expect(p.getByLabel('Resumen de la orden')).toContainText('7 · 35.00') // recibido
      await expect(p.getByLabel('Resumen de la orden')).toContainText('11 · 40.00') // por llegar: 5 × 5 + 6 × 2.50
      const entradas = p.getByRole('list', { name: 'Entradas de la orden' })
      await expect(entradas.getByRole('listitem')).toHaveCount(1)
      await expect(entradas).toContainText('FAC-00231')
      await expect(entradas).toContainText('+7')
      // La ficha del producto: el costo promedio nace con el de la orden, el proveedor queda vinculado con su último costo.
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('5.00')
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('35.00') // 7 × 5.00
      const proveedoresFicha = p.getByLabel('Proveedores de este producto')
      await expect(proveedoresFicha).toContainText(PROVEEDOR)
      await expect(proveedoresFicha).toContainText('último costo 5.00')
      await expect(p.getByLabel('Lo que está pedido a proveedores')).toContainText('5 de')
      // La entrada que produjo la tanda dice de qué orden viene.
      await p.goto(`/admin/inventario/compras/${idOrden}`)
      await entradas.getByRole('link').first().click()
      await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/)
      await expect(p.getByRole('link', { name: numero })).toBeVisible()
      await expect(p.getByLabel('Resumen de la entrada')).toContainText('35.00')

      // ── Cerrar con faltante: exige motivo; el resto de la orden queda como faltante ──
      await p.goto(`/admin/inventario/compras/${idOrden}`)
      await p.getByRole('button', { name: 'Cerrar con faltante' }).click()
      await fila(recibir, NA).getByLabel(/^Llegó de /).fill('5')
      await fila(recibir, NB).getByLabel(/^Llegó de /).fill('2')
      await p.getByRole('button', { name: 'Confirmar cierre con faltante' }).click()
      await expect(p.getByText(/necesita un motivo/)).toBeVisible()
      await p.getByLabel(/^Motivo del faltante/).fill('El proveedor se quedó sin azúcar')
      await p.getByRole('button', { name: 'Confirmar cierre con faltante' }).click()
      await expect(p.getByText(new RegExp(`Orden ${numero} cerrada: 7 recibidas, 4 de faltante`))).toBeVisible({ timeout: 20_000 })
      await expect(p.getByText('Recibida', { exact: true }).first()).toBeVisible()
      await expect(p.getByText(/El proveedor se quedó sin azúcar/)).toBeVisible()
      await expect(p.getByRole('list', { name: 'Entradas de la orden' }).getByRole('listitem')).toHaveCount(2)
      await expect(p.getByRole('button', { name: 'Recibir lo que llegó' })).toHaveCount(0)
      await expect(p.getByLabel('Resumen de la orden')).toContainText('14 · 65.00') // recibido: 12 × 5 + 2 × 2.50
      await expect(p.getByLabel('Resumen de la orden')).toContainText('Faltante')
      // El promedio de B nació con el costo de la orden; el de A, con lo que había.
      await p.goto(`/admin/inventario/${vB}`)
      await expect(p.getByLabel('Costo y valor del producto')).toContainText('2.50')
      await expect(p.getByLabel('Lo que está pedido a proveedores')).toHaveCount(0)

      // ── Otra orden: cancelar un borrador no pide motivo, una pedida sí ───
      const crear = async (cantidad: string, costo: string) => {
        await p.goto('/admin/inventario/compras/nueva')
        const f = p.getByRole('form', { name: 'Nueva orden de compra' })
        const b = f.getByLabel('Escanear o buscar un producto')
        await b.fill(SA)
        await b.press('Enter')
        const l = f.getByRole('list', { name: 'Productos de la orden' })
        await expect(fila(l, NA)).toHaveCount(1)
        await fila(l, NA).getByLabel(/^Cantidad de /).fill(cantidad)
        await expect(fila(l, NA).getByLabel(/^Costo de /)).toHaveValue('5') // sugiere el último costo de ESE proveedor
        await fila(l, NA).getByLabel(/^Costo de /).fill(costo)
        await f.getByRole('button', { name: 'Guardar y pedir' }).click()
        await p.waitForURL(/\/admin\/inventario\/compras\/(?!nueva)[^/]+$/, { timeout: 30_000 })
        return p.url().split('/').pop()!
      }
      const idCancelable = await crear('3', '6')
      await expect(p.getByText('Pedida', { exact: true }).first()).toBeVisible()
      await p.getByRole('button', { name: 'Cancelar orden' }).click()
      await p.getByRole('button', { name: /^Sí, cancelar la orden / }).click()
      await expect(p.getByText(/necesita un motivo/)).toBeVisible()
      await p.getByLabel(/^Motivo/).fill('Ya no lo necesitamos')
      await p.getByRole('button', { name: /^Sí, cancelar la orden / }).click()
      await expect(p.getByText(/Orden OC-\d{4}-\d{6} cancelada/)).toBeVisible({ timeout: 15_000 })
      await expect(p.getByText('Cancelada', { exact: true }).first()).toBeVisible()
      await expect(p.getByText(/No entró nada al inventario/)).toBeVisible()
      await expect(p.getByRole('button', { name: 'Recibir lo que llegó' })).toHaveCount(0)

      // ── La lista: filtros, y lo que espera mercancía arriba ───────────────
      const idEsperando = await crear('4', '5')
      await p.goto('/admin/inventario/compras')
      await expect(p.getByRole('heading', { name: 'Compras a proveedores', level: 1 })).toBeVisible()
      await expect(p.getByRole('list', { name: 'Órdenes esperando mercancía' }).getByRole('listitem')).toHaveCount(1)
      const todas = p.getByRole('list', { name: 'Órdenes de compra' })
      await expect(todas.getByRole('listitem')).toHaveCount(3)
      await p.goto('/admin/inventario/compras?estado=CANCELLED')
      await expect(todas.getByRole('listitem')).toHaveCount(1)
      await p.goto(`/admin/inventario/compras?q=${encodeURIComponent(numero)}`)
      await expect(todas.getByRole('listitem')).toHaveCount(1)
      await expect(todas).toContainText('Recibida')
      await p.goto('/admin/inventario/compras?estado=nada&proveedor=con%20espacio&desde=2026-02-31&q=%27%3Cscript%3E') // una URL manipulada no rompe nada
      await expect(p.getByRole('heading', { name: 'Compras a proveedores', level: 1 })).toBeVisible()
      await p.goto(`/admin/inventario/proveedores`)
      await expect(fila(p.getByRole('list', { name: 'Proveedores' }), PROVEEDOR)).toContainText('1 orden esperando mercancía')
      await expect(fila(p.getByRole('list', { name: 'Proveedores' }), PROVEEDOR)).toContainText('2 productos')

      // ── El detalle del proveedor, y desactivarlo ──────────────────────────
      await fila(p.getByRole('list', { name: 'Proveedores' }), PROVEEDOR).getByRole('link').click()
      await expect(p.getByRole('heading', { name: PROVEEDOR, level: 1 })).toBeVisible()
      await expect(p.getByRole('list', { name: 'Productos del proveedor' })).toContainText(NA)
      await expect(p.getByRole('list', { name: 'Órdenes del proveedor' }).getByRole('listitem')).toHaveCount(3)
      await p.getByRole('button', { name: 'Desactivar proveedor' }).click()
      await expect(p.getByText(/quedó desactivado: ya no recibe pedidos nuevos/)).toBeVisible({ timeout: 15_000 })
      await p.goto('/admin/inventario/compras/nueva')
      await expect(p.getByText(/primero registra a tu proveedor/)).toBeVisible()
      // La orden que ya estaba pedida se sigue recibiendo.
      await p.goto(`/admin/inventario/compras/${idEsperando}`)
      await p.getByRole('button', { name: 'Recibir todo lo pendiente' }).click()
      await expect(p.getByText(/cerrada: 4 recibidas/)).toBeVisible({ timeout: 20_000 })
      await p.goto('/admin/inventario/proveedores')
      await p.getByRole('button', { name: 'Buscar' }).click()
      await expect(p.getByText('Todavía no hay proveedores')).toBeVisible() // desactivado: no sale sin «incluir desactivados»
      await p.goto('/admin/inventario/proveedores?inactivos=1')
      await expect(fila(p.getByRole('list', { name: 'Proveedores' }), PROVEEDOR)).toContainText('Desactivado')
      void idCancelable

      // ── Vincular un proveedor a un producto desde su ficha ────────────────
      const otro = `Mayorista Sur ${sufijo}`
      await prisma.inventorySupplier.create({ data: { companyId: emp.id, name: otro } })
      await p.goto(`/admin/inventario/${vB}`)
      const vinculo = p.getByRole('form', { name: 'Agregar proveedor al producto' })
      await vinculo.getByLabel('Proveedor').selectOption({ label: otro })
      await vinculo.getByLabel('Su código').fill('MS-77')
      await vinculo.getByLabel('Días de entrega').fill('4')
      await vinculo.getByLabel('Preferido').check()
      await vinculo.getByRole('button', { name: 'Guardar' }).click()
      await expect(p.getByText(/Proveedor guardado como el preferido/)).toBeVisible({ timeout: 15_000 })
      const proveedoresB = p.getByRole('list', { name: 'Proveedores del producto' })
      await expect(fila(proveedoresB, otro)).toContainText('Preferido')
      await expect(fila(proveedoresB, otro)).toContainText('Código MS-77')
      await expect(fila(proveedoresB, otro)).toContainText('entrega en 4 días')
      await fila(proveedoresB, otro).getByRole('button', { name: `Quitar a ${otro}` }).click()
      await expect(p.getByText(/ya no figura como proveedor/)).toBeVisible({ timeout: 15_000 })

      // ── El archivo de la orden ────────────────────────────────────────────
      const csv = await p.request.get(`/admin/inventario/compras/${idOrden}/exportar`)
      expect(csv.status()).toBe(200)
      expect(csv.headers()['content-type'] ?? '').toContain('text/csv')
      const texto = await csv.text()
      expect(texto).toContain('Orden de compra')
      expect(texto).toContain(numero)
      expect(texto).toContain(PROVEEDOR)
      expect(texto).toContain('El proveedor se quedó sin azúcar')
      expect(texto).toMatch(/Valor pedido;75\.00/)

      // ── Una orden ajena o inventada no existe ──────────────────────────────
      await p.goto('/admin/inventario/compras/cinexistente000000000000')
      expect(await p.locator('meta[name=robots][content*=noindex]').count()).toBeGreaterThan(0)
      await expect(p.getByText(/^OC-\d{4}-\d{6}$/)).toHaveCount(0)
      await expect(p.getByRole('list', { name: 'Líneas de la orden' })).toHaveCount(0)
      expect((await p.request.get('/admin/inventario/compras/cinexistente000000000000/exportar')).status()).toBe(404)

      // ── La entrada que creó la recepción enlaza a su orden (el control positivo de la comprobación de abajo) ───
      const entrada = await prisma.inventoryReceipt.findFirstOrThrow({ where: { purchaseOrderId: idOrden }, select: { id: true } })
      await p.goto(`/admin/inventario/entradas/${entrada.id}`)
      await expect(p.getByText('Orden de compra:')).toBeVisible()
      await expect(p.getByRole('link', { name: numero })).toBeVisible()

      // ── Quien NO tiene la función «comprar» no ve ni una orden ───────────
      await prisma.user.update({ where: { email }, data: { permisos: { v: 1, secciones: {}, funciones: { inventario: { comprar: false } } } } })
      await p.goto('/admin/inventario')
      await expect(vistas.getByRole('link', { name: 'Existencias' })).toBeVisible()
      await expect(vistas.getByRole('link', { name: 'Compras' })).toHaveCount(0)
      await expect(vistas.getByRole('link', { name: 'Proveedores' })).toHaveCount(0)
      await p.goto('/admin/inventario/compras')
      await expect(p.getByText(/No tienes permiso para ver ni gestionar las compras a proveedores/)).toBeVisible()
      await expect(p.getByRole('list', { name: 'Órdenes de compra' })).toHaveCount(0)
      await p.goto(`/admin/inventario/compras/${idOrden}`)
      await expect(p.getByText(/No tienes permiso para ver las órdenes de compra/)).toBeVisible()
      expect(await p.locator('body').innerText()).not.toContain('75.00')
      await p.goto('/admin/inventario/proveedores')
      await expect(p.getByText(/No tienes permiso para ver ni gestionar los proveedores/)).toBeVisible()
      await p.goto('/admin/inventario/compras/nueva')
      await expect(p.getByText(/No tienes permiso para hacer órdenes de compra/)).toBeVisible()
      expect((await p.request.get(`/admin/inventario/compras/${idOrden}/exportar`)).status()).toBe(403)
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByLabel('Proveedores de este producto')).toHaveCount(0)
      await expect(p.getByLabel('Lo que está pedido a proveedores')).toHaveCount(0)
      // Lo demás del inventario sigue funcionando: la ficha y la entrada se ven, sin el enlace a la orden.
      await expect(p.getByLabel('Costo y valor del producto')).toBeVisible()
      await p.goto(`/admin/inventario/entradas/${entrada.id}`)
      await expect(p.getByRole('heading', { level: 1 })).toContainText('ENT-')
      await expect(p.getByText('Orden de compra:')).toHaveCount(0)
    } finally {
      await prisma.user.update({ where: { email }, data: { permisos: Prisma.DbNull } })
    }

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('INV-3c · reposición: «llenar hasta», la propuesta agrupa por proveedor, el borrador se crea con lo sugerido y lo pedido se descuenta — y quien no tiene «comprar» no ve nada', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    // Una empresa propia: la propuesta es de toda la empresa y tiene que contener solo lo de esta prueba.
    const emp = await empresaCatalogo(sufijo, 'invrepos', { capacidad: true })
    const prisma = prismaDeArnes()
    const principal = (await sucursalSembrada(emp.id, 'Principal')).id
    const NA = `Harina REP ${sufijo}`
    const NB = `Azúcar REP ${sufijo}`
    const NC = `Sal REP ${sufijo}`
    const mk = async (name: string, slug: string, sku: string) => {
      const it = await itemSembrado(emp.id, { name, slug, controlaInventario: true, variantes: [{ name: 'Default', sku, price: 100, porDefecto: true }] })
      return varianteDe(it.id)
    }
    const vA = await mk(NA, `harina-rep-${sufijo}`, `REP-A-${sufijo}`)
    const vB = await mk(NB, `azucar-rep-${sufijo}`, `REP-B-${sufijo}`)
    const vC = await mk(NC, `sal-rep-${sufijo}`, `REP-C-${sufijo}`)
    const PROVEEDOR = `Surtidor REP ${sufijo}`
    const email = 'e2e.catalogo.con@membego.test'
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, emp.id)
    const vistas = p.getByRole('navigation', { name: 'Vistas del inventario' })
    const fila = (lista: Locator, nombre: string) => lista.getByRole('listitem').filter({ hasText: nombre })

    try {
      // ── Sin ningún objetivo, la pantalla lo explica ───────────────────────
      await p.goto('/admin/inventario')
      await vistas.getByRole('link', { name: 'Reposición' }).click()
      await p.waitForURL('**/admin/inventario/reposicion')
      await expect(p.getByRole('heading', { name: 'Reposición', level: 1 })).toBeVisible()
      await expect(vistas.getByRole('link', { name: 'Reposición' })).toHaveAttribute('aria-current', 'page')
      await expect(p.getByText('Todavía no has dicho hasta cuánto quieres tener de ningún producto.')).toBeVisible()

      // ── «Llenar hasta» desde la ficha del producto ───────────────────────
      await prisma.inventoryLevel.create({ data: { companyId: emp.id, catalogVariantId: vA, locationId: principal, onHand: 3 } })
      await p.goto(`/admin/inventario/${vA}`)
      const llenar = p.getByRole('form', { name: 'Llenar hasta en Principal' })
      await llenar.getByLabel('Llenar hasta').fill('20')
      await llenar.getByRole('button', { name: 'Guardar objetivo' }).click()
      await expect(p.getByText('Reposición propondrá pedir hasta tener 20.')).toBeVisible({ timeout: 15_000 })
      // El umbral no puede quedar igual o por encima del objetivo; por debajo, sí.
      const avisar = p.getByRole('form', { name: 'Umbral de stock bajo en Principal' })
      await avisar.getByLabel('Avisar cuando queden').fill('25')
      await avisar.getByRole('button', { name: 'Guardar umbral' }).click()
      await expect(p.getByText(/«Llenar hasta» \(20\) en Principal tiene que ser mayor que el umbral de aviso \(25\)/)).toBeVisible({ timeout: 15_000 })
      await avisar.getByLabel('Avisar cuando queden').fill('5')
      await avisar.getByRole('button', { name: 'Guardar umbral' }).click()
      await expect(p.getByText('Te avisaremos cuando queden 5 o menos.')).toBeVisible({ timeout: 15_000 })
      // Y el objetivo no puede bajar al umbral.
      await llenar.getByLabel('Llenar hasta').fill('5')
      await llenar.getByRole('button', { name: 'Guardar objetivo' }).click()
      await expect(p.getByText(/«Llenar hasta» \(5\) en Principal tiene que ser mayor que el umbral de aviso \(5\)/)).toBeVisible({ timeout: 15_000 })
      expect((await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: vA, locationId: principal } })).targetStock).toBe(20)

      // ── Lo demás se siembra: otro producto con objetivo y sin existencias, uno sin proveedor, y los proveedores ──
      const prov = await prisma.inventorySupplier.create({ data: { companyId: emp.id, name: PROVEEDOR } })
      await prisma.inventoryVariantSupplier.create({ data: { companyId: emp.id, catalogVariantId: vA, supplierId: prov.id, preferred: true, lastCost: '2.5000' } })
      await prisma.inventoryVariantSupplier.create({ data: { companyId: emp.id, catalogVariantId: vB, supplierId: prov.id, preferred: true } })
      await prisma.inventoryLevel.create({ data: { companyId: emp.id, catalogVariantId: vB, locationId: principal, onHand: 0, targetStock: 10 } })
      await prisma.inventoryLevel.create({ data: { companyId: emp.id, catalogVariantId: vC, locationId: principal, onHand: 1, targetStock: 4 } })

      // ── La propuesta: agrupada por proveedor, con lo que falta para llegar al objetivo ──
      await p.goto('/admin/inventario/reposicion')
      const resumen = p.getByRole('list', { name: 'Resumen de la reposición' }).or(p.getByLabel('Resumen de la reposición'))
      await expect(resumen).toContainText('Por reponer')
      await expect(resumen).toContainText('30') // 17 + 10 + 3 unidades
      const grupo = p.getByRole('form', { name: `Reposición de ${PROVEEDOR} en Principal` })
      const lista = grupo.getByRole('list', { name: `Productos por reponer: ${PROVEEDOR} → Principal` })
      await expect(lista.getByRole('listitem')).toHaveCount(2)
      await expect(grupo.getByLabel(`Cantidad de ${NA}`)).toHaveValue('17') // 20 − 3 disponibles
      await expect(grupo.getByLabel(`Costo de ${NA}`)).toHaveValue('2.5') // el último costo de ese proveedor
      await expect(grupo.getByLabel(`Cantidad de ${NB}`)).toHaveValue('10')
      await expect(grupo.getByLabel(`Costo de ${NB}`)).toHaveValue('') // nunca se le compró: no se inventa un costo
      await expect(fila(lista, NA)).toContainText('Hay 3')
      await expect(fila(lista, NA)).toContainText('Llenar hasta 20')
      await expect(fila(lista, NA)).toContainText('Avisa en 5')
      // Sin proveedor no hay orden que crear: se manda a la ficha del producto.
      const sinProveedor = p.getByRole('list', { name: 'Productos por reponer: Sin proveedor → Principal' })
      await expect(fila(sinProveedor, NC)).toContainText('Sugerido 3')
      await expect(p.getByRole('form', { name: 'Reposición de productos sin proveedor en Principal' }).getByRole('button', { name: 'Crear borrador de orden' })).toHaveCount(0)
      await expect(p.getByText(/Estos productos no tienen un proveedor al que pedirlos/)).toBeVisible()

      // ── Crear el borrador: el costo es obligatorio, y lo marcado es lo que se pide ──
      await grupo.getByRole('button', { name: 'Crear borrador de orden' }).click()
      await expect(p.getByText(new RegExp(`«${NB}»: escribe el costo`))).toBeVisible()
      await grupo.getByLabel(`Costo de ${NB}`).fill('4')
      await grupo.getByLabel(`Cantidad de ${NA}`).fill('15') // se puede corregir lo sugerido
      await grupo.getByRole('button', { name: 'Crear borrador de orden' }).click()
      await p.waitForURL(/\/admin\/inventario\/compras\/(?!nueva)[^/]+$/, { timeout: 30_000 })
      const idBorrador = p.url().split('/').pop()!
      await expect(p.getByText('Borrador', { exact: true }).first()).toBeVisible()
      await expect(p.getByText('Borrador creado desde Reposición.')).toBeVisible()
      const numero = (await p.getByRole('heading', { level: 1 }).innerText()).trim()
      expect(numero).toMatch(/^OC-\d{4}-\d{6}$/)
      const lineasOrden = p.getByRole('list', { name: 'Líneas de la orden' })
      await expect(fila(lineasOrden, NA)).toContainText('15')
      await expect(fila(lineasOrden, NB)).toContainText('10')
      // Un borrador no pide nada ni mueve existencias.
      expect((await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: vA, locationId: principal } })).onHand).toBe(3)

      // ── De vuelta en la propuesta: el borrador se avisa, pero NO se descuenta ──
      await p.goto('/admin/inventario/reposicion')
      await expect(p.getByText(/Ya tienes un borrador de este proveedor para esta sucursal/)).toBeVisible()
      await expect(p.getByRole('link', { name: numero })).toBeVisible()
      await expect(fila(p.getByRole('list', { name: `Productos por reponer: ${PROVEEDOR} → Principal` }), NA)).toContainText('En borrador 15')
      await expect(p.getByRole('form', { name: `Reposición de ${PROVEEDOR} en Principal` }).getByLabel(`Cantidad de ${NA}`)).toHaveValue('17')

      // ── Pedir el borrador lo vuelve compromiso: lo pedido se descuenta y el grupo se va ──
      await p.goto(`/admin/inventario/compras/${idBorrador}`)
      await p.getByRole('button', { name: 'Pedir al proveedor' }).click()
      await expect(p.getByText(new RegExp(`Orden ${numero} pedida a ${PROVEEDOR}`))).toBeVisible({ timeout: 15_000 })
      await p.goto('/admin/inventario/reposicion')
      await expect(p.getByRole('form', { name: `Reposición de ${PROVEEDOR} en Principal` })).toHaveCount(0)
      await expect(fila(p.getByRole('list', { name: 'Productos por reponer: Sin proveedor → Principal' }), NC)).toBeVisible()
      // A (3 hay + 15 pedidos = 18 > su umbral de 5) y B (0 + 10 pedidos = su objetivo) ya no necesitan nada.
      await expect(p.getByText(NA)).toHaveCount(0)
      await expect(p.getByText(NB)).toHaveCount(0)

      // ── Filtros ──────────────────────────────────────────────────────────
      await p.goto('/admin/inventario/reposicion?proveedor=sin')
      await expect(fila(p.getByRole('list', { name: 'Productos por reponer: Sin proveedor → Principal' }), NC)).toBeVisible()
      await p.goto(`/admin/inventario/reposicion?q=${encodeURIComponent('no-existe-xyz')}`)
      await expect(p.getByText(/Ningún producto con «llenar hasta» coincide con esos filtros/)).toBeVisible()
      await p.goto('/admin/inventario/reposicion?sucursal=de-otra-empresa&proveedor=de-otra-empresa')
      await expect(fila(p.getByRole('list', { name: 'Productos por reponer: Sin proveedor → Principal' }), NC)).toBeVisible() // lo ajeno no filtra

      // ── El archivo: los mismos números, sin separador de miles ───────────
      const csv = await p.request.get('/admin/inventario/reposicion/exportar')
      expect(csv.status()).toBe(200)
      expect(csv.headers()['content-type'] ?? '').toContain('text/csv')
      const texto = await csv.text()
      expect(texto).toContain('Reposición')
      expect(texto).toContain('Qué comprar')
      expect(texto).toContain(NC)
      expect(texto).toContain('Sin proveedor')
      expect(texto).not.toContain(NA) // ya está pedido
      const filtrado = await p.request.get('/admin/inventario/reposicion/exportar?proveedor=sin')
      expect(await filtrado.text()).toContain('solo lo que no tiene proveedor')

      // ── Quien NO tiene la función «comprar» no ve ni una línea ───────────
      await prisma.user.update({ where: { email }, data: { permisos: { v: 1, secciones: {}, funciones: { inventario: { comprar: false } } } } })
      await p.goto('/admin/inventario')
      await expect(vistas.getByRole('link', { name: 'Existencias' })).toBeVisible()
      await expect(vistas.getByRole('link', { name: 'Reposición' })).toHaveCount(0)
      await expect(p.getByRole('link', { name: 'Ver qué comprar' })).toHaveCount(0)
      await p.goto('/admin/inventario/reposicion')
      await expect(p.getByText(/No tienes permiso para ver ni gestionar las compras a proveedores/)).toBeVisible()
      expect(await p.locator('body').innerText()).not.toContain(NC)
      expect((await p.request.get('/admin/inventario/reposicion/exportar')).status()).toBe(403)
      // «Llenar hasta» es configuración del saldo (la misma función que el umbral): sigue disponible.
      await p.goto(`/admin/inventario/${vA}`)
      await expect(p.getByRole('form', { name: 'Llenar hasta en Principal' })).toBeVisible()
    } finally {
      await prisma.user.update({ where: { email }, data: { permisos: Prisma.DbNull } })
    }

    expect(errores, `errores de consola o de página:\n${errores.join('\n')}`).toEqual([])
    await ctx.close()
  })

  test('aislamiento: la variante de otra empresa no se abre ni se lista', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    const vista = async (id: string) => {
      await p.goto(`/admin/inventario/${id}`)
      const texto = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
      return {
        noindex: (await p.locator('meta[name=robots][content*=noindex]').count()) > 0,
        fuga: /SECRETO|999/.test(texto),
        formularios: await p.getByRole('form').count(),
      }
    }
    const ajeno = await vista(varianteAjena)
    const inexistente = await vista('cinexistente000000000000')
    expect(ajeno.noindex).toBe(true)
    expect(ajeno.fuga).toBe(false)
    expect(ajeno.formularios).toBe(0)
    expect(ajeno).toEqual(inexistente)

    await p.goto('/admin/inventario')
    await expect(p.getByText(/SECRETO/)).toHaveCount(0)
    await ctx.close()
  })

  test('una empresa SIN la capacidad no entra a /admin/inventario ni ve la entrada de menú', async ({ browser }) => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await entrarComo(ctx, 'catalogoSinCapacidad', BASE, sin.id)
    await p.goto('/admin/inventario')
    await expect(p).not.toHaveURL(/\/admin\/inventario$/)
    await expect(p.getByRole('link', { name: /^Inventario$/ })).toHaveCount(0)
    await ctx.close()
  })
})
