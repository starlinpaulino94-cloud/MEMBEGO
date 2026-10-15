import { test, expect, type Locator, type Page } from '@playwright/test'
import { cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * INVENTARIO · LOTES Y VENCIMIENTO (INV-5a), de punta a punta en el panel.
 *
 *   ficha sin lotes (ofrece activarlos, en dos pasos) → activar → recibir con lote y vencimiento (el lote es obligatorio; el
 *   vencimiento de un lote que ya existe no se reescribe) → la tabla de lotes en orden FEFO con su estado (vencido, por vencer,
 *   vigente) → dañar sin decir el lote (sale del que antes vence, no del vencido) y eligiéndolo → mover unidades entre lotes (no es una
 *   merma) → el historial dice de qué lotes es cada movimiento → una entrada de varias líneas con los lotes de cada producto, y su
 *   detalle → un producto sin lotes no pide lotes → y nada del producto con lotes se puede transferir.
 *
 * INV-5b1 (lo que vence pronto): el hub ofrece el informe → la lista de lo vencido y lo que vence en la ventana, de lo que antes vence a lo
 * que después, con lo vendible, lo apartado y lo dañado → los filtros (estado, ventana, producto o lote, sucursal) → el CSV con los mismos
 * filtros → la tarjeta «Inventario» del dashboard con su «Vence pronto».
 *
 * Las fechas son relativas a HOY (10 días atrás, 10 y 400 días adelante): la prueba no depende del día en que se corra.
 *
 * La base de E2E se crea con `db push` y `scripts/e2e/base-limpia.mjs` le aplica la migración de lotes (los saldos por lote los
 * mantiene la base con disparadores). Si la base no los trae, esta prueba se OMITE con un aviso claro en vez de fallar por otra cosa.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
const sufijo = Date.now().toString(36)
const PRODUCTO = `Crema con lotes E2E ${sufijo}`
const OTRO = `Jabón con lotes E2E ${sufijo}`
const SIN_LOTES = `Cinta sin lotes E2E ${sufijo}`

const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const VIEJO = dia(-10)
const PRONTO = dia(10)
const LEJANO = dia(400)

const tarjeta = (p: Page, nombre: string): Locator => p.locator(`[data-sucursal="${nombre}"]`)
const tabla = (p: Page, sucursal: string): Locator => p.getByRole('table', { name: `Lotes en ${sucursal}` })
const filaDe = (p: Page, sucursal: string, codigo: string): Locator => tabla(p, sucursal).locator(`tbody tr[data-lote="${codigo}"]`)

/** Las cuatro cifras de una fila de lote: disponible, apartado, dañado. */
async function cifras(fila: Locator): Promise<number[]> {
  const celdas = await fila.locator('td').allInnerTexts()
  return celdas.slice(1).map((t) => Number(t.replace(/[.,\s]/g, '')))
}

/** Elige una opción de un `<select>` por un fragmento de su texto (las opciones de lotes llevan más texto que su código). */
async function elegir(select: Locator, fragmento: string | RegExp) {
  const valor = await select.locator('option', { hasText: fragmento }).first().getAttribute('value')
  expect(valor, `no hay una opción con «${fragmento}»`).toBeTruthy()
  await select.selectOption(valor as string)
}

/** Llena el formulario de movimientos de una sucursal con los campos de lote que haga falta. */
async function movimiento(p: Page, sucursal: string, o: { operacion: string; cantidad: number; lote?: string; vence?: string; deLote?: RegExp | string; codigo?: string; detalle?: string }) {
  const f = p.getByRole('form', { name: `Registrar movimiento en ${sucursal}` })
  await f.getByLabel('Movimiento').selectOption({ label: o.operacion })
  await f.getByLabel(/^Cantidad|^Cantidad que llegó/).first().fill(String(o.cantidad))
  if (o.lote !== undefined) await f.getByLabel(/^Lote/).fill(o.lote)
  if (o.vence !== undefined) await f.getByLabel(/^Vence/).fill(o.vence)
  if (o.deLote !== undefined) await elegir(f.getByLabel('De qué lote'), o.deLote)
  if (o.codigo !== undefined) await f.getByLabel('Motivo *').selectOption({ label: o.codigo })
  if (o.detalle !== undefined) await f.getByLabel(/^Detalle/).fill(o.detalle)
  await f.getByRole('button', { name: 'Registrar' }).click()
}

test.describe('Inventario · lotes y vencimiento', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere SUPABASE_JWT_SECRET, DATABASE_URL y NEXT_PUBLIC_SUPABASE_URL para firmar sesiones')
    test.skip(testInfo.project.name !== 'escritorio', 'el recorrido completo corre una vez, en escritorio')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let con: EmpresaCatalogo
  let variante = ''
  let varianteOtro = ''

  test('prepara: empresa con la capacidad, dos sucursales y tres productos (y comprueba que la base trae los disparadores de lotes)', async () => {
    const hay = await prismaDeArnes().$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'inventory_movement_lots_aplicar'`
    test.skip(Number(hay[0]?.n ?? 0) === 0, 'la base de E2E no trae la migración de lotes (20261068): aplícala con `npm run e2e:base`')
    con = await empresaCatalogo(sufijo, 'lot', { capacidad: true })
    await sucursalSembrada(con.id, 'Principal')
    await sucursalSembrada(con.id, 'Norte')
    const a = await itemSembrado(con.id, { name: PRODUCTO, slug: `crema-lot-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `LOT-${sufijo}`, price: 800, porDefecto: true }] })
    const b = await itemSembrado(con.id, { name: OTRO, slug: `jabon-lot-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `JAB-${sufijo}`, price: 300, porDefecto: true }] })
    await itemSembrado(con.id, { name: SIN_LOTES, slug: `cinta-lot-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `CIN-${sufijo}`, price: 100, porDefecto: true }] })
    variante = await varianteDe(a.id)
    varianteOtro = await varianteDe(b.id)
  })

  test('activar → recibir con lotes → FEFO y estados → dañar → mover entre lotes → historial', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // ── Sin lotes: la ficha los ofrece, y el formulario de siempre no pide ninguno ──
    await p.goto(`/admin/inventario/${variante}`)
    const oferta = p.getByLabel('Lotes y vencimiento')
    await expect(oferta).toBeVisible()
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 4 })
    await expect(p.getByText(/Entrada registrada. Disponible: 4/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel(/^Lote/)).toHaveCount(0)

    // ── Activar: en dos pasos y de un solo sentido ───────────────────────
    await oferta.getByRole('button', { name: 'Activar lotes en este producto' }).click()
    const confirmar = oferta.getByRole('group', { name: 'Confirmar la activación de lotes' })
    await expect(confirmar).toContainText('no se puede deshacer')
    await confirmar.getByRole('button', { name: 'Cancelar' }).click()
    await expect(confirmar).toHaveCount(0)
    await oferta.getByRole('button', { name: 'Activar lotes en este producto' }).click()
    await confirmar.getByRole('button', { name: 'Sí, activar lotes' }).click()
    await expect(p.getByText(/Lotes activados. 4 unidades pasaron al lote «SIN LOTE»/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByLabel('Lotes y vencimiento')).toHaveCount(0)
    await expect(p.getByText(/Este producto lleva/).first()).toBeVisible()
    expect(await cifras(filaDe(p, 'Principal', 'SIN LOTE'))).toEqual([4, 0, 0])
    // Con lotes no hay conteo suelto ni transferencia.
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Movimiento').locator('option', { hasText: 'Conteo físico' })).toHaveCount(0)
    await expect(p.getByRole('form', { name: 'Transferir existencias' })).toHaveCount(0)

    // ── Recibir: el lote es obligatorio; el vencimiento de un lote existente no se reescribe ──
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 5 })
    await expect(p.getByText(/Indica de qué lote es lo que llegó/).first()).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 5, lote: 'e2e-pronto', vence: PRONTO })
    await expect(filaDe(p, 'Principal', 'E2E-PRONTO')).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 7, lote: 'E2E-LEJANO', vence: LEJANO })
    await expect(filaDe(p, 'Principal', 'E2E-LEJANO')).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 3, lote: 'E2E-VIEJO', vence: VIEJO })
    await expect(filaDe(p, 'Principal', 'E2E-VIEJO')).toBeVisible({ timeout: 15_000 })
    // Escribir un lote que ya existe fija su vencimiento: el campo se bloquea y lo dice.
    const f = p.getByRole('form', { name: 'Registrar movimiento en Principal' })
    await f.getByLabel('Movimiento').selectOption({ label: 'Entrada de mercancía' })
    await f.getByLabel(/^Lote/).fill('E2E-PRONTO')
    await expect(f.getByLabel(/^Vence/)).toBeDisabled()
    await expect(f.getByText(/Ese lote ya existe: vence el/)).toContainText(PRONTO)
    await f.getByLabel(/^Lote/).fill('')

    // ── La tabla: orden FEFO (lo vencido primero, lo que no vence al final) y su estado ──
    await expect(tabla(p, 'Principal').locator('tbody tr')).toHaveCount(4)
    expect(await tabla(p, 'Principal').locator('tbody tr').evaluateAll((filas) => filas.map((x) => x.getAttribute('data-lote')))).toEqual(['E2E-VIEJO', 'E2E-PRONTO', 'E2E-LEJANO', 'SIN LOTE'])
    await expect(filaDe(p, 'Principal', 'E2E-VIEJO')).toHaveAttribute('data-estado', 'VENCIDO')
    await expect(filaDe(p, 'Principal', 'E2E-VIEJO')).toContainText('Venció hace 10 días')
    await expect(filaDe(p, 'Principal', 'E2E-PRONTO')).toHaveAttribute('data-estado', 'POR_VENCER')
    await expect(filaDe(p, 'Principal', 'E2E-PRONTO')).toContainText('Vence en 10 días')
    await expect(filaDe(p, 'Principal', 'E2E-LEJANO')).toHaveAttribute('data-estado', 'VIGENTE')
    await expect(filaDe(p, 'Principal', 'SIN LOTE')).toHaveAttribute('data-estado', 'SIN_VENCIMIENTO')
    expect(await cifras(filaDe(p, 'Principal', 'E2E-PRONTO'))).toEqual([5, 0, 0])

    // ── Dañar sin decir el lote: sale del que antes vence y NO está vencido (PRONTO), no del vencido ──
    await movimiento(p, 'Principal', { operacion: 'Mercancía dañada', cantidad: 2, codigo: 'Mal almacenamiento', detalle: 'Se mojaron' })
    await expect.poll(async () => (await cifras(filaDe(p, 'Principal', 'E2E-PRONTO')))[2], { timeout: 15_000 }).toBe(2)
    expect(await cifras(filaDe(p, 'Principal', 'E2E-PRONTO'))).toEqual([3, 0, 2])
    expect(await cifras(filaDe(p, 'Principal', 'E2E-VIEJO'))).toEqual([3, 0, 0])
    // Eligiendo el lote (el vencido, que sí se puede dañar a mano).
    await movimiento(p, 'Principal', { operacion: 'Mercancía dañada', cantidad: 1, deLote: /E2E-VIEJO/, codigo: 'Vencido', detalle: 'Caducó' })
    await expect.poll(async () => (await cifras(filaDe(p, 'Principal', 'E2E-VIEJO')))[2], { timeout: 15_000 }).toBe(1)
    // Un faltante de más de lo que tiene el lote elegido avisa y no mueve nada.
    await movimiento(p, 'Principal', { operacion: 'Ajuste: faltante', cantidad: 50, deLote: /E2E-LEJANO/, codigo: 'Pérdida o extravío', detalle: 'Imposible' })
    await expect(p.getByText(/El lote E2E-LEJANO solo tiene 7 unidad\(es\) disponible\(s\); no se pueden usar 50/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cifras(filaDe(p, 'Principal', 'E2E-LEJANO'))).toEqual([7, 0, 0])

    // ── Mover unidades de un lote a otro (corregir un lote mal capturado) ──
    const mover = p.getByRole('form', { name: 'Mover unidades entre lotes en Principal' })
    await elegir(mover.getByLabel('Del lote'), /E2E-LEJANO/)
    await elegir(mover.getByLabel('Al lote'), /E2E-PRONTO/)
    await mover.getByLabel('Cantidad').fill('4')
    await mover.getByRole('button', { name: 'Mover' }).click()
    await expect(p.getByText(/Listo: 4 unidades pasaron de un lote a otro/).first()).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await cifras(filaDe(p, 'Principal', 'E2E-LEJANO')))[0], { timeout: 15_000 }).toBe(3)
    expect((await cifras(filaDe(p, 'Principal', 'E2E-PRONTO')))[0]).toBe(7)
    // Origen y destino iguales o sin elegir se rechazan antes de ir al servidor.
    await mover.getByRole('button', { name: 'Mover' }).click()
    await expect(p.getByText(/Elige el lote de origen y el de destino/).first()).toBeVisible()

    // ── La otra sucursal no tiene lotes con existencias ───────────────────
    await expect(tarjeta(p, 'Norte')).toContainText('No hay existencias de ningún lote en esta sucursal')

    // ── El historial dice de qué lotes es cada movimiento; la reasignación se ve pero no cuenta como pérdida ──
    const historial = p.getByRole('list', { name: 'Historial de movimientos' })
    await expect(historial.getByText('Lotes: E2E-PRONTO ×5')).toBeVisible()
    await expect(historial.getByText(/Lotes: E2E-LEJANO ×4/)).toBeVisible()
    await expect(historial.getByText('Motivo: Reasignación de lote').first()).toBeVisible()
    await p.goto('/admin/inventario/reportes/mermas')
    await expect(p.getByText('Reasignación de lote')).toHaveCount(0)

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })

  test('entrada de varias líneas con los lotes de cada producto; un producto sin lotes no los pide', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // El segundo producto también lleva lotes (sin existencias de antes) y el tercero no.
    await p.goto(`/admin/inventario/${varianteOtro}`)
    await p.getByLabel('Lotes y vencimiento').getByRole('button', { name: 'Activar lotes en este producto' }).click()
    await p.getByRole('group', { name: 'Confirmar la activación de lotes' }).getByText('Exigir fecha de vencimiento en cada lote nuevo').click()
    await p.getByRole('group', { name: 'Confirmar la activación de lotes' }).getByRole('button', { name: 'Sí, activar lotes' }).click()
    await expect(p.getByText(/Lotes activados/).first()).toBeVisible({ timeout: 15_000 })

    await p.goto('/admin/inventario/entradas/nueva')
    const buscar = p.getByLabel('Escanear o buscar un producto')
    await buscar.fill(`JAB-${sufijo}`)
    await buscar.press('Enter')
    const lotesJabon = p.getByRole('group', { name: new RegExp(`^Lotes de ${OTRO}`) })
    await expect(lotesJabon).toBeVisible({ timeout: 15_000 })
    await expect(lotesJabon).toContainText('cuándo vence')
    await buscar.fill(`CIN-${sufijo}`)
    await buscar.press('Enter')
    await expect(p.getByLabel(new RegExp(`^Cantidad de ${SIN_LOTES}`))).toBeVisible({ timeout: 15_000 })
    await expect(p.getByRole('group', { name: new RegExp(`^Lotes de ${SIN_LOTES}`) })).toHaveCount(0)

    // Sin lote ni vencimiento el formulario lo señala antes de enviar nada.
    await p.getByRole('button', { name: 'Registrar entrada' }).click()
    await expect(p.getByText(/Lote 1|Escribe el código del lote|Este producto lleva lotes/).first()).toBeVisible({ timeout: 15_000 })
    // Dos lotes del jabón: uno con su vencimiento, y se le añade el otro con el botón.
    await lotesJabon.getByLabel(/^Código del lote 1/).fill('JAB-A')
    await lotesJabon.getByLabel(/^Vencimiento del lote 1/).fill(PRONTO)
    await lotesJabon.getByLabel(/^Cantidad del lote 1/).fill('6')
    await lotesJabon.getByRole('button', { name: 'Agregar otro lote' }).click()
    await lotesJabon.getByLabel(/^Código del lote 2/).fill('JAB-B')
    await lotesJabon.getByLabel(/^Vencimiento del lote 2/).fill(LEJANO)
    await lotesJabon.getByLabel(/^Cantidad del lote 2/).fill('4')
    await expect(p.getByLabel(new RegExp(`^Total de ${OTRO}`))).toHaveText('10')
    await p.getByLabel(new RegExp(`^Cantidad de ${SIN_LOTES}`)).fill('3')
    await expect(p.getByText(/2 productos · 13 unidades/)).toBeVisible()
    await p.getByRole('button', { name: 'Registrar entrada' }).click()
    await p.waitForURL(/\/admin\/inventario\/entradas\/[^/]+$/, { timeout: 30_000 })

    // El detalle de la entrada dice de qué lotes llegó cada línea.
    await expect(p.getByText('Lotes: JAB-A ×6, JAB-B ×4')).toBeVisible()
    // Y la ficha del jabón lo enseña en la tabla de la sucursal donde llegó (la que el formulario de entradas trae elegida: «Norte»).
    await p.goto(`/admin/inventario/${varianteOtro}`)
    await expect(filaDe(p, 'Norte', 'JAB-A')).toHaveAttribute('data-estado', 'POR_VENCER')
    await expect(filaDe(p, 'Norte', 'JAB-B')).toHaveAttribute('data-estado', 'VIGENTE')
    expect(await cifras(filaDe(p, 'Norte', 'JAB-A'))).toEqual([6, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'JAB-B'))).toEqual([4, 0, 0])
    // Y en la otra sucursal no hay nada de esos lotes.
    await expect(filaDe(p, 'Principal', 'JAB-A')).toHaveCount(0)
    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })
  test('INV-5b1 · vence pronto: el hub lo ofrece, la lista va de lo que antes vence a lo que después, los filtros acotan, el archivo trae lo mismo y el dashboard lo resume', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const lista = p.getByRole('list', { name: 'Lotes que vencen pronto' })
    const filasLista = () => lista.locator('li[data-lote]')
    const codigosLista = () => filasLista().evaluateAll((l) => l.map((x) => x.getAttribute('data-lote')))

    // ── La puerta: el hub de reportes ofrece «Vence pronto» ───────────────
    await p.goto('/admin/inventario/reportes')
    await p.getByRole('list', { name: 'Informes' }).getByRole('link', { name: /Vence pronto/ }).click()
    await p.waitForURL('**/admin/inventario/reportes/vencimientos')
    await expect(p.getByRole('heading', { name: 'Vence pronto', level: 1 })).toBeVisible()

    // ── La lista: lo vencido primero y, a igual día, por nombre; solo lo que vence en 30 días o ya venció (el de 400 días y «SIN LOTE» no salen) ──
    await expect(filasLista()).toHaveCount(3)
    await expect.poll(codigosLista, { timeout: 15_000 }).toEqual(['E2E-VIEJO', 'E2E-PRONTO', 'JAB-A'])
    await expect(lista.locator('li[data-lote="E2E-VIEJO"]')).toHaveAttribute('data-estado', 'VENCIDO')
    await expect(lista.locator('li[data-lote="E2E-VIEJO"]')).toContainText('Venció hace 10 días')
    await expect(lista.locator('li[data-lote="E2E-VIEJO"]')).toContainText(VIEJO)
    await expect(lista.locator('li[data-lote="E2E-PRONTO"]')).toHaveAttribute('data-estado', 'POR_VENCER')
    await expect(lista.locator('li[data-lote="E2E-PRONTO"]')).toContainText('Vence en 10 días')
    await expect(lista.locator('li[data-lote="E2E-PRONTO"]')).toContainText('Principal')
    await expect(lista.locator('li[data-lote="JAB-A"]')).toContainText('Norte')
    // Lo vendible, lo apartado y lo dañado de cada lote (lo que dejaron las pruebas de arriba).
    await expect(lista.locator('li[data-lote="E2E-VIEJO"]')).toContainText('2 vendibles')
    await expect(lista.locator('li[data-lote="E2E-VIEJO"]')).toContainText('1 dañada')
    await expect(lista.locator('li[data-lote="E2E-PRONTO"]')).toContainText('7 vendibles')
    await expect(lista.locator('li[data-lote="E2E-PRONTO"]')).toContainText('2 dañadas')
    await expect(lista.locator('li[data-lote="JAB-A"]')).toContainText('6 vendibles')
    const resumen = p.getByLabel('Resumen de lo que vence pronto')
    await expect(resumen).toContainText('15') // unidades vendibles: 2 + 7 + 6
    await expect(p.getByLabel('Lotes ya vencidos')).toContainText('Hay 1 lote vencido')
    // El producto lleva a su ficha.
    await filasLista().first().getByRole('link', { name: new RegExp(PRODUCTO) }).click()
    await p.waitForURL(`**/admin/inventario/${variante}`)
    await p.goBack()

    // ── Los filtros: estado, ventana, producto o lote, sucursal ───────────
    const form = p.getByRole('form', { name: 'Filtrar lo que vence pronto' })
    await form.getByLabel('Estado').selectOption('VENCIDO')
    await form.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/estado=VENCIDO/)
    await expect.poll(codigosLista, { timeout: 15_000 }).toEqual(['E2E-VIEJO'])
    await p.getByRole('link', { name: 'Quitar filtros' }).click()
    await expect(filasLista()).toHaveCount(3)
    await expect(form.getByLabel('Estado')).toHaveValue('') // el formulario vuelve a lo que dice la URL (no conserva «Vencidos»)
    await form.getByLabel('Vence en').selectOption('7')
    await form.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/dias=7/)
    await expect.poll(codigosLista, { timeout: 15_000 }).toEqual(['E2E-VIEJO'])
    await form.getByLabel('Vence en').selectOption('15')
    await form.getByRole('button', { name: 'Filtrar' }).click()
    await expect(filasLista()).toHaveCount(3)
    await form.getByLabel('Producto o lote').fill('jab-a')
    await form.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/q=jab-a/)
    await expect.poll(codigosLista, { timeout: 15_000 }).toEqual(['JAB-A'])
    await form.getByLabel('Producto o lote').fill('no-existe-este-lote')
    await form.getByRole('button', { name: 'Filtrar' }).click()
    await expect(p.getByText('Nada coincide con esos filtros')).toBeVisible()
    await p.getByRole('link', { name: 'Quitar filtros' }).click()
    await expect(filasLista()).toHaveCount(3)
    await expect(form.getByLabel('Producto o lote')).toHaveValue('')
    await form.getByLabel('Sucursal').selectOption({ label: 'Norte' })
    await form.getByRole('button', { name: 'Filtrar' }).click()
    await p.waitForURL(/sucursal=/)
    await expect.poll(codigosLista, { timeout: 15_000 }).toEqual(['JAB-A'])
    await expect(p.getByLabel('Resumen de lo que vence pronto')).toContainText('6')
    // Una sucursal inventada no filtra (la pantalla las ignora si no son de la empresa).
    await p.goto('/admin/inventario/reportes/vencimientos?sucursal=cinexistente000000000000')
    await expect(filasLista()).toHaveCount(3)

    // ── El archivo: los mismos filtros, y lo vencido con los días en negativo ──
    const csv = await p.request.get('/admin/inventario/reportes/vencimientos/exportar')
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    const t = await csv.text()
    expect(t).toContain('Lotes que vencen en 30 dias o ya vencieron')
    expect(t).toContain('Ventana (dias);30')
    expect(t).toContain('Lotes ya vencidos;1')
    expect(t).toMatch(new RegExp(`${PRODUCTO}[^\n]*;E2E-VIEJO;${VIEJO};-10;Vencidos;Vencido;2;0;1`))
    expect(t).toContain(`;E2E-PRONTO;${PRONTO};10;Por vencer;Por vencer;7;0;2`)
    expect(t).not.toContain('E2E-LEJANO')
    const filtrado = await (await p.request.get('/admin/inventario/reportes/vencimientos/exportar?estado=VENCIDO&dias=7')).text()
    expect(filtrado).toContain('Filtro: Estado;Vencidos')
    expect(filtrado).toContain('E2E-VIEJO')
    expect(filtrado).not.toContain('E2E-PRONTO')
    expect(filtrado).not.toContain('JAB-A')
    const anonimo = await (await browser.newContext()).request.get('/admin/inventario/reportes/vencimientos/exportar', { maxRedirects: 0 })
    expect([302, 303, 307, 308, 401, 403]).toContain(anonimo.status())

    // ── El dashboard: la tarjeta de inventario resume lo que vence ────────
    await p.goto('/admin/dashboard')
    const tarjeta = p.getByRole('region', { name: 'Inventario' })
    await expect(tarjeta).toBeVisible()
    const vence = tarjeta.getByRole('link', { name: /Vence pronto/ })
    await expect(vence).toContainText('2 lotes')
    await expect(vence).toContainText('en 30 días')
    await expect(vence).toContainText('1 ya vencido')
    await vence.click()
    await p.waitForURL(/\/admin\/inventario\/reportes\/vencimientos\?estado=VENCIDO/)
    await expect.poll(codigosLista, { timeout: 15_000 }).toEqual(['E2E-VIEJO'])

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })
})
