import { test, expect, type Locator, type Page } from '@playwright/test'
import { cerrarPrisma, entrarComo, prismaDeArnes, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { empresaCatalogo, existenciasSembradas, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

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
 * INV-5b3 (conteo por lote): contar a ciegas eligiendo el lote de un producto que los lleva → la lista de lo contado y lo que falta por
 * contar salen por lote → importar una hoja con la columna «lote» (con errores no entra nada) → la hoja en blanco trae una fila por lote →
 * revisar las diferencias por lote y su CSV → aplicar ajusta cada lote por su diferencia → la ficha, el historial y el informe lo muestran.
 *
 * INV-5b4 (transferencias con lotes): transferir desde la ficha sin elegir lote (sale el que antes vence) y eligiéndolos → enviar con lotes
 * (la línea de un producto con lotes deja elegirlos y su cantidad es la suma; un producto sin lotes viaja en el mismo envío) → la
 * transferencia enseña los lotes de cada línea → recibir lote por lote con tope por lote → cancelar devuelve cada lote a su sitio → el
 * historial y el CSV dicen de qué lotes es cada movimiento.
 *
 * INV-5b5 (corregir y deshacer): activar lotes por error y deshacerlo (las existencias no cambian y se ofrece activarlos otra vez) → con
 * lotes recibidos ya no se puede deshacer → corregir el vencimiento de un lote (motivo obligatorio, vale para el lote, queda en la historia
 * de la ficha y el informe «Vence pronto» lo refleja; el «SIN LOTE» no tiene el botón).
 *
 * INV-5c (series): activar eligiendo «por series» (lo que había queda «SIN SERIE») → asignar números de serie a lo que había → una serie
 * repetida o que ya está en el inventario se rechaza → una entrada con series (un número por unidad) → la tabla de la ficha habla de series
 * (sin vencimiento, sin mover entre lotes) → buscar una serie dice de qué producto es, dónde está y su historia.
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
  // Las tres cifras (disponible, apartado, dañado); la columna de «Corregir vencimiento» (INV-5b5) no cuenta.
  return celdas.slice(1, 4).map((t) => Number(t.replace(/[.,\s]/g, '')))
}

/** Las tres cifras de una fila de la tabla de SERIES (sin la columna de vencimiento): disponible, apartado, dañado. */
async function cifrasSerie(fila: Locator): Promise<number[]> {
  const celdas = await fila.locator('td').allInnerTexts()
  return celdas.slice(0, 3).map((t) => Number(t.replace(/[.,\s]/g, '')))
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
    // Con lotes no hay conteo suelto; la transferencia SÍ (INV-5b4) y pregunta de qué lotes sale.
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel('Movimiento').locator('option', { hasText: 'Conteo físico' })).toHaveCount(0)
    await expect(p.getByRole('form', { name: 'Transferir existencias' }).getByRole('group', { name: 'De qué lotes sale' })).toBeVisible()

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

  test('INV-5b2 · órdenes de compra con lotes: se pide por producto, se recibe diciendo el lote (uno o varios, con vencimiento) y la orden, la entrada y la ficha lo cuentan', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const PROVEEDOR = `Proveedor lotes E2E ${sufijo}`
    const fila = (lista: Locator, nombre: string) => lista.getByRole('listitem').filter({ hasText: nombre })

    // ── Un proveedor, y una orden con un producto que lleva lotes y otro que no (antes esto se negaba) ──
    await p.goto('/admin/inventario/proveedores')
    const nuevoProveedor = p.getByRole('form', { name: 'Nuevo proveedor' })
    await nuevoProveedor.getByLabel('Nombre *').fill(PROVEEDOR)
    await nuevoProveedor.getByRole('button', { name: 'Crear proveedor' }).click()
    await expect(p.getByText(`Proveedor «${PROVEEDOR}» creado.`)).toBeVisible({ timeout: 15_000 })

    await p.goto('/admin/inventario/compras/nueva')
    const form = p.getByRole('form', { name: 'Nueva orden de compra' })
    await form.getByLabel('Sucursal que recibe').selectOption({ label: 'Principal' })
    const buscar = form.getByLabel('Escanear o buscar un producto')
    const lineasNueva = form.getByRole('list', { name: 'Productos de la orden' })
    await buscar.fill(`LOT-${sufijo}`)
    await buscar.press('Enter')
    await expect(fila(lineasNueva, PRODUCTO)).toHaveCount(1)
    await buscar.fill(`CIN-${sufijo}`)
    await buscar.press('Enter')
    await expect(fila(lineasNueva, SIN_LOTES)).toHaveCount(1)
    await fila(lineasNueva, PRODUCTO).getByLabel(/^Cantidad de /).fill('10')
    await fila(lineasNueva, PRODUCTO).getByLabel(/^Costo de /).fill('8')
    await fila(lineasNueva, SIN_LOTES).getByLabel(/^Cantidad de /).fill('4')
    await fila(lineasNueva, SIN_LOTES).getByLabel(/^Costo de /).fill('3')
    await form.getByRole('button', { name: 'Guardar y pedir' }).click()
    await p.waitForURL(/\/admin\/inventario\/compras\/(?!nueva)[^/]+$/, { timeout: 30_000 })
    const idOrden = p.url().split('/').pop()!
    await expect(p.getByText('Pedida', { exact: true }).first()).toBeVisible()
    const lineasOrden = p.getByRole('list', { name: 'Líneas de la orden' })
    await expect(fila(lineasOrden, PRODUCTO)).toContainText('lleva lotes')
    await expect(fila(lineasOrden, SIN_LOTES)).not.toContainText('lleva lotes')

    // ── Recibir: el producto con lotes pide su lote; el otro, solo la cantidad; y no hay «recibir todo» ──
    const recibir = p.getByRole('list', { name: 'Lo que llegó' })
    await expect(p.getByRole('button', { name: 'Recibir todo lo pendiente' })).toHaveCount(0)
    await expect(p.getByText(/por eso aquí no hay «recibir todo»/)).toBeVisible()
    await expect(fila(recibir, SIN_LOTES).getByLabel(/^Llegó de /)).toHaveValue('4')
    await expect(fila(recibir, SIN_LOTES).getByRole('group')).toHaveCount(0)
    const lotesDe = p.getByRole('group', { name: `Lotes de ${PRODUCTO}` })
    await expect(lotesDe).toBeVisible()
    await expect(lotesDe.getByLabel(`Cantidad del lote 1 de ${PRODUCTO}`)).toHaveValue('10') // por defecto, todo lo que falta
    await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
    await expect(p.getByText(new RegExp(`«${PRODUCTO}»: Escribe el código del lote`)).first()).toBeVisible({ timeout: 15_000 })

    // Dos lotes de la misma línea, cada uno con su vencimiento; la cantidad de la línea es la suma.
    await lotesDe.getByLabel(`Código del lote 1 de ${PRODUCTO}`).fill('e2e-oc-1')
    await lotesDe.getByLabel(`Vencimiento del lote 1 de ${PRODUCTO}`).fill(PRONTO)
    await lotesDe.getByLabel(`Cantidad del lote 1 de ${PRODUCTO}`).fill('6')
    await lotesDe.getByRole('button', { name: 'Agregar otro lote' }).click()
    await lotesDe.getByLabel(`Código del lote 2 de ${PRODUCTO}`).fill('E2E-OC-2')
    await lotesDe.getByLabel(`Vencimiento del lote 2 de ${PRODUCTO}`).fill(LEJANO)
    await lotesDe.getByLabel(`Cantidad del lote 2 de ${PRODUCTO}`).fill('2')
    await expect(p.getByLabel(`Total de ${PRODUCTO}`)).toHaveText('8')
    await p.getByLabel(/^Factura o remisión/).fill('FAC-LOTES-1')
    await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
    await expect(p.getByText(/Recibidas 12 en Principal \(entrada ENT-/)).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('Recibida en parte', { exact: true }).first()).toBeVisible()
    await expect(fila(lineasOrden, PRODUCTO)).toContainText('Lotes recibidos: E2E-OC-1 ×6, E2E-OC-2 ×2')
    await expect(fila(lineasOrden, SIN_LOTES)).not.toContainText('Lotes recibidos')

    // La entrada que produjo la tanda dice de qué lotes llegó cada línea.
    await p.getByRole('list', { name: 'Entradas de la orden' }).getByRole('link').first().click()
    await p.waitForURL(/\/admin\/inventario\/entradas\/(?!nueva)[^/]+$/)
    await expect(p.getByText('E2E-OC-1 ×6, E2E-OC-2 ×2').first()).toBeVisible()

    // ── Lo que falta (2): otro vencimiento para un lote que ya existe se rechaza, y no se mueve nada ──
    await p.goto(`/admin/inventario/compras/${idOrden}`)
    await expect(recibir.getByRole('listitem')).toHaveCount(1) // la cinta ya llegó completa
    const lotesResto = p.getByRole('group', { name: `Lotes de ${PRODUCTO}` })
    await expect(lotesResto.getByLabel(`Cantidad del lote 1 de ${PRODUCTO}`)).toHaveValue('2')
    await lotesResto.getByLabel(`Código del lote 1 de ${PRODUCTO}`).fill('E2E-OC-1')
    await lotesResto.getByLabel(`Vencimiento del lote 1 de ${PRODUCTO}`).fill(LEJANO)
    await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
    await expect(p.getByText(/El lote E2E-OC-1 ya existe y vence el/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText('Recibida en parte', { exact: true }).first()).toBeVisible()
    // Con el vencimiento que tiene, entra en ese lote y la orden se cierra sola.
    await lotesResto.getByLabel(`Vencimiento del lote 1 de ${PRODUCTO}`).fill(PRONTO)
    await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
    await expect(p.getByText(/cerrada: 2 recibidas \(entrada ENT-/)).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('Recibida', { exact: true }).first()).toBeVisible()
    await expect(fila(lineasOrden, PRODUCTO)).toContainText('Lotes recibidos: E2E-OC-1 ×8, E2E-OC-2 ×2')

    // ── La ficha: los dos lotes en la sucursal que recibió, cada uno con su vencimiento ──
    await p.goto(`/admin/inventario/${variante}`)
    await expect(filaDe(p, 'Principal', 'E2E-OC-1')).toBeVisible({ timeout: 15_000 })
    expect(await cifras(filaDe(p, 'Principal', 'E2E-OC-1'))).toEqual([8, 0, 0])
    expect(await cifras(filaDe(p, 'Principal', 'E2E-OC-2'))).toEqual([2, 0, 0])
    await expect(filaDe(p, 'Principal', 'E2E-OC-1')).toContainText(PRONTO)
    await expect(filaDe(p, 'Principal', 'E2E-OC-2')).toContainText(LEJANO)

    // ── El archivo de la orden trae los lotes recibidos ──
    const csv = await p.request.get(`/admin/inventario/compras/${idOrden}/exportar`)
    expect(csv.status()).toBe(200)
    expect(await csv.text()).toContain('E2E-OC-1 ×8, E2E-OC-2 ×2')

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })

  test('INV-5b3 · conteo por lote: se cuenta a ciegas eligiendo el lote, se importa una hoja con lotes, se revisan y aplican las diferencias lote por lote', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)

    // ── Lo que el sistema sabe de Norte: la crema en dos lotes (se recibe ahora) y el jabón con sus dos lotes y la cinta sin lotes (de antes) ──
    await p.goto(`/admin/inventario/${variante}`)
    await movimiento(p, 'Norte', { operacion: 'Entrada de mercancía', cantidad: 6, lote: 'CNT-A', vence: PRONTO })
    await expect(filaDe(p, 'Norte', 'CNT-A')).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Norte', { operacion: 'Entrada de mercancía', cantidad: 4, lote: 'CNT-B' })
    await expect(filaDe(p, 'Norte', 'CNT-B')).toBeVisible({ timeout: 15_000 })

    // ── Abrir el conteo de Norte ──────────────────────────────────────────
    await p.goto('/admin/inventario/conteos')
    const abrir = p.getByRole('form', { name: 'Iniciar conteo' })
    await abrir.getByLabel('Sucursal que vas a contar').selectOption({ label: 'Norte' })
    await abrir.getByLabel(/^Para qué es/).fill('Conteo por lote E2E')
    await abrir.getByRole('button', { name: 'Abrir conteo' }).click()
    await p.waitForURL(/\/admin\/inventario\/conteos\/(?!nuevo)[^/]+$/, { timeout: 30_000 })
    const idConteo = p.url().split('/').pop()!
    const numero = (await p.getByRole('heading', { level: 1 }).innerText()).trim()

    // A ciegas: ni una cifra del sistema; lo que falta por contar sale POR LOTE y sin cantidades.
    await expect(p.getByText(/Esperado|Disponible|El sistema dice/)).toHaveCount(0)
    await p.getByText(/Con existencias y todavía sin contar \(/).click()
    const porContar = p.getByRole('list', { name: 'Productos por contar' })
    await expect(p.getByText(/Con existencias y todavía sin contar \(5\)/)).toBeVisible()
    await expect(porContar.getByRole('listitem').filter({ hasText: PRODUCTO }).filter({ hasText: 'Lote CNT-A' })).toContainText(`vence ${PRONTO}`)
    await expect(porContar.getByRole('listitem').filter({ hasText: PRODUCTO }).filter({ hasText: 'Lote CNT-B' })).toContainText('no vence')
    await expect(porContar.getByRole('listitem').filter({ hasText: OTRO })).toHaveCount(2)
    await expect(porContar.getByRole('listitem').filter({ hasText: SIN_LOTES })).toHaveCount(1)
    await expect(porContar.getByText(/\b(6|4|10)\b(?!-)/)).toHaveCount(0)

    // ── Captura: escanear un producto con lotes pide el lote; el sin lotes se suma como siempre ──
    const buscar = p.getByLabel('Escanear o buscar un producto para contar')
    const estado = p.getByRole('status')
    await buscar.fill(`LOT-${sufijo}`)
    await buscar.press('Enter')
    await expect(estado).toContainText(`${PRODUCTO} lleva lotes: elige el lote que estás contando.`, { timeout: 15_000 })
    const lotes = p.getByRole('group', { name: `Lotes de ${PRODUCTO}` })
    await expect(lotes).toBeVisible()
    const opciones = lotes.getByRole('list', { name: 'Lotes para contar' })
    // Sin cantidades del sistema, y con SIN LOTE y los lotes que existen aunque no tengan nada en esta sucursal.
    await expect(opciones.getByRole('button', { name: /^SIN LOTE/ })).toBeVisible()
    await expect(opciones.getByRole('button', { name: /E2E-LEJANO/ })).toBeVisible()
    await expect(lotes).not.toContainText(/\b(6|4)\b disponibles?/)
    await p.getByLabel('Unidades por escaneo').fill('5')
    await opciones.getByRole('button', { name: /Lote CNT-A/ }).click()
    await expect(estado).toContainText(`${PRODUCTO} · Lote CNT-A · vence ${PRONTO}: ahora 5 contados`, { timeout: 15_000 })
    await p.getByLabel('Unidades por escaneo').fill('1')
    for (let i = 0; i < 3; i++) await opciones.getByRole('button', { name: /Lote CNT-B/ }).click()
    await expect(estado).toContainText('Lote CNT-B · no vence: ahora 3 contados', { timeout: 20_000 })
    // Un lote que el sistema no tiene aquí (está en Principal) también se cuenta: es lo que apareció en el estante.
    await opciones.getByRole('button', { name: /E2E-LEJANO/ }).click()
    await expect(estado).toContainText(`Lote E2E-LEJANO · vence ${LEJANO}: ahora 1 contados`, { timeout: 15_000 })
    // Un lote equivocado se quita de la lista (por lote: los demás siguen).
    await opciones.getByRole('button', { name: /Lote E2E-PRONTO/ }).click()
    await expect(estado).toContainText('Lote E2E-PRONTO', { timeout: 15_000 })

    const lista = p.getByRole('list', { name: 'Productos contados' })
    await expect(p.getByRole('heading', { name: /^Productos contados \(4\)$/ })).toBeVisible({ timeout: 20_000 })
    await lista.getByRole('button', { name: new RegExp(`^Quitar ${PRODUCTO} · Lote E2E-PRONTO`) }).click()
    await expect(p.getByRole('heading', { name: /^Productos contados \(3\)$/ })).toBeVisible({ timeout: 20_000 })
    // Corregir escribiendo el número: el lote CNT-B era 4.
    await lista.getByLabel(new RegExp(`^Contado de ${PRODUCTO} · Lote CNT-B`)).fill('4')
    await lista.getByLabel(new RegExp(`^Contado de ${PRODUCTO} · Lote CNT-B`)).press('Enter')
    await expect(lista.getByLabel(new RegExp(`^Contado de ${PRODUCTO} · Lote CNT-B`))).toHaveValue('4', { timeout: 20_000 })
    expect(await lista.getByRole('listitem').count()).toBe(3)

    // ── La hoja en blanco: una fila por lote con existencias en la sucursal, sin cantidades ──
    const hoja = await (await p.request.get(`/admin/inventario/conteos/${idConteo}/hoja`)).text()
    expect(hoja).toContain('sku;codigo_de_barras;producto;lote;contado')
    expect(hoja).toMatch(new RegExp(`^LOT-${sufijo};;${PRODUCTO};CNT-A;$`, 'mi'))
    expect(hoja).toMatch(new RegExp(`^LOT-${sufijo};;${PRODUCTO};CNT-B;$`, 'mi'))
    expect(hoja).toMatch(new RegExp(`^JAB-${sufijo};;${OTRO};JAB-A;$`, 'mi'))
    expect(hoja).toMatch(new RegExp(`^CIN-${sufijo};;${SIN_LOTES};;$`, 'mi'))

    // ── Importar lo contado de los demás lotes: con un error no entra nada ─
    await p.getByRole('link', { name: 'Importar hoja contada' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}/importar`)
    // Si el archivo se elige antes de que la página termine de hidratarse, el formulario no se entera: se vuelve a elegir hasta que «Revisar» se habilita.
    const subir = (nombre: string, contenido: string) =>
      expect(async () => {
        await p.getByLabel('Archivo CSV').setInputFiles({ name: nombre, mimeType: 'text/csv', buffer: Buffer.from(contenido, 'utf8') })
        await expect(p.getByRole('button', { name: 'Revisar archivo' })).toBeEnabled({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
    await subir('malo.csv', `sku;lote;contado\nJAB-${sufijo};;6\nJAB-${sufijo};NO-EXISTE;2\nCIN-${sufijo};JAB-A;1\n`)
    await p.getByRole('button', { name: 'Revisar archivo' }).click()
    await expect(p.getByText(/3 filas con problemas/)).toBeVisible({ timeout: 15_000 })
    const problemas = p.getByRole('list', { name: 'Filas con problemas' })
    await expect(problemas).toContainText('lleva lotes: escribe el lote en la columna «lote»')
    await expect(problemas).toContainText('El lote «NO-EXISTE» no existe')
    await expect(problemas).toContainText('no lleva lotes: deja vacía la columna «lote»')
    await expect(p.getByRole('button', { name: /^Cargar/ })).toHaveCount(0)
    await p.goto(`/admin/inventario/conteos/${idConteo}/importar`)
    await subir('limpio.csv', `sku;lote;contado\nJAB-${sufijo};jab-a;6\nJAB-${sufijo};JAB-B;3\nCIN-${sufijo};;3\n`)
    await p.getByRole('button', { name: 'Revisar archivo' }).click()
    await expect(p.getByText(/El archivo está limpio/)).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText(`lote JAB-A`).first()).toBeVisible()
    await p.getByRole('button', { name: /^Cargar 3 productos contados$/ }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}`, { timeout: 30_000 })
    await expect(p.getByRole('heading', { name: /^Productos contados \(6\)$/ })).toBeVisible({ timeout: 20_000 })
    await expect(p.getByRole('list', { name: 'Productos contados' }).getByLabel(new RegExp(`^Contado de ${OTRO} · Lote JAB-B`))).toHaveValue('3')

    // ── Revisar: AHORA sí se ve lo esperado por lote y la diferencia ──────
    await p.getByRole('link', { name: 'Revisar y aplicar' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}/revisar`)
    const dif = p.getByRole('list', { name: 'Diferencias por producto' })
    const lote = (codigo: string) => dif.locator(`li[data-lote="${codigo}"]`)
    await expect(lote('CNT-A')).toContainText('Faltante')
    await expect(lote('CNT-A').getByText('Esperado').locator('..')).toContainText('6')
    await expect(lote('CNT-A').getByText('Contado').locator('..')).toContainText('5')
    await expect(lote('CNT-A')).toContainText(PRODUCTO)
    await expect(lote('CNT-B')).toContainText('Coincide')
    await expect(lote('E2E-LEJANO')).toContainText('Sobrante')
    await expect(lote('E2E-LEJANO').getByText('Esperado').locator('..')).toContainText('0')
    await expect(lote('JAB-A')).toContainText('Coincide')
    await expect(lote('JAB-B')).toContainText('Faltante')
    await expect(lote('JAB-B').getByText('Esperado').locator('..')).toContainText('4')
    const resumen = p.getByLabel('Resumen de diferencias')
    await expect(resumen).toContainText('+1 u.')
    await expect(resumen).toContainText('−2 u.')
    await expect(p.getByText(/Hay \d+ línea/)).toHaveCount(0) // todo lo que tenía existencias en Norte se contó
    const csvDif = await p.request.get(`/admin/inventario/conteos/${idConteo}/exportar`)
    expect(csvDif.status()).toBe(200)
    const textoDif = await csvDif.text()
    expect(textoDif).toContain(`Número;${numero}`)
    expect(textoDif).toContain('SKU;Codigo de barras;Producto;Lote;Vencimiento del lote;Esperado al contar;Contado;Diferencia;Resultado')
    expect(textoDif).toMatch(new RegExp(`LOT-${sufijo};;${PRODUCTO};CNT-A;${PRONTO};6;5;-1;Faltante`, 'i'))
    expect(textoDif).toMatch(new RegExp(`LOT-${sufijo};;${PRODUCTO};E2E-LEJANO;${LEJANO};0;1;1;Sobrante`, 'i'))
    expect(textoDif).toMatch(new RegExp(`JAB-${sufijo};;${OTRO};JAB-B;${LEJANO};4;3;-1;Faltante`, 'i'))
    expect(textoDif).toMatch(new RegExp(`CIN-${sufijo};;${SIN_LOTES};;;3;3;0;Coincide`, 'i'))

    // ── Aplicar: cada lote se ajusta por SU diferencia ────────────────────
    await p.getByLabel('Revisé las diferencias y quiero ajustar las existencias.').check()
    await p.getByRole('button', { name: 'Aplicar conteo' }).click()
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}`, { timeout: 30_000 })
    await expect(p.getByText(/^Aplicado \d/)).toBeVisible({ timeout: 20_000 })
    const aplicado = p.getByRole('list', { name: 'Diferencias por producto' })
    await expect(aplicado.locator('li[data-lote="CNT-A"]')).toContainText('6 → 5')
    await expect(aplicado.locator('li[data-lote="E2E-LEJANO"]')).toContainText('0 → 1')
    await expect(aplicado.locator('li[data-lote="JAB-B"]')).toContainText('4 → 3')
    await expect(aplicado.locator('li[data-lote="CNT-B"]')).toContainText('sin cambio')
    // Ya no se captura ni se revisa.
    await p.goto(`/admin/inventario/conteos/${idConteo}/revisar`)
    await p.waitForURL(`**/admin/inventario/conteos/${idConteo}`)

    // ── Las fichas: los saldos por lote quedaron como se contaron, y lo que no se tocó sigue igual ──
    await p.goto(`/admin/inventario/${variante}`)
    await expect(filaDe(p, 'Norte', 'CNT-A')).toBeVisible({ timeout: 15_000 })
    expect(await cifras(filaDe(p, 'Norte', 'CNT-A'))).toEqual([5, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'CNT-B'))).toEqual([4, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'E2E-LEJANO'))).toEqual([1, 0, 0])
    expect((await cifras(filaDe(p, 'Principal', 'E2E-LEJANO')))[0], 'la otra sucursal no se tocó').toBe(3)
    const historial = p.getByRole('list', { name: 'Historial de movimientos' })
    await expect(historial.getByText('Motivo: Diferencia de conteo').first()).toBeVisible()
    await expect(historial.getByText(/Lotes: E2E-LEJANO ×1/)).toBeVisible()
    await expect(historial.getByText(/Lotes: CNT-A ×1/)).toBeVisible()
    await p.goto(`/admin/inventario/${varianteOtro}`)
    await expect(filaDe(p, 'Norte', 'JAB-A')).toBeVisible({ timeout: 15_000 })
    expect(await cifras(filaDe(p, 'Norte', 'JAB-A'))).toEqual([6, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'JAB-B'))).toEqual([3, 0, 0])

    // ── La lista de conteos lo resume ─────────────────────────────────────
    await p.goto('/admin/inventario/conteos')
    const conteos = p.getByRole('list', { name: 'Conteos físicos' })
    await expect(conteos.getByRole('listitem').first()).toContainText(numero)
    await expect(conteos.getByRole('listitem').first()).toContainText('Aplicado')
    await expect(conteos.getByRole('listitem').first()).toContainText('+1')
    await expect(conteos.getByRole('listitem').first()).toContainText('−2')

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })

  test('INV-5b4 · transferencias con lotes: transferir sin elegir (FEFO) y eligiendo, enviar con lotes junto a un producto sin lotes, recibir lote por lote con tope, cancelar devuelve cada lote a su sitio', async ({ browser }) => {
    test.setTimeout(300_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const LECHE = `Leche con lotes E2E ${sufijo}`
    const PAN = `Pan sin lotes E2E ${sufijo}`
    const principalId = (await sucursalSembrada(con.id, 'Principal')).id
    const leche = await itemSembrado(con.id, { name: LECHE, slug: `leche-lot-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `LEC-${sufijo}`, price: 90, porDefecto: true }] })
    const pan = await itemSembrado(con.id, { name: PAN, slug: `pan-lot-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `PAN-${sufijo}`, price: 40, porDefecto: true }] })
    const vLeche = await varianteDe(leche.id)
    const vPan = await varianteDe(pan.id)
    await existenciasSembradas(con.id, vPan, principalId, 10)

    // ── Los lotes: se activan y entran L-A (vence pronto, 6) y L-B (lejano, 4) en Principal ──
    await p.goto(`/admin/inventario/${vLeche}`)
    const oferta = p.getByLabel('Lotes y vencimiento')
    await oferta.getByRole('button', { name: 'Activar lotes en este producto' }).click()
    await oferta.getByRole('group', { name: 'Confirmar la activación de lotes' }).getByRole('button', { name: 'Sí, activar lotes' }).click()
    await expect(p.getByText(/Este producto lleva/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText(/Se transfiere \(y se envía a otra sucursal\) lote por lote/)).toBeVisible()
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 6, lote: 'L-A', vence: PRONTO })
    await expect(filaDe(p, 'Principal', 'L-A')).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 4, lote: 'L-B', vence: LEJANO })
    await expect(filaDe(p, 'Principal', 'L-B')).toBeVisible({ timeout: 15_000 })

    // ── Transferir desde la ficha SIN elegir: sale el que antes vence (L-A) y entra al destino en el mismo lote ──
    const tr = p.getByRole('form', { name: 'Transferir existencias' })
    await elegir(tr.getByLabel('Desde'), 'Principal')
    await elegir(tr.getByLabel('Hacia'), 'Norte')
    await expect(tr.getByRole('radio', { name: 'El que antes vence (automático)' })).toBeChecked()
    await tr.getByLabel('Cantidad').fill('8')
    await tr.getByRole('button', { name: 'Transferir' }).click()
    await expect(filaDe(p, 'Norte', 'L-A')).toBeVisible({ timeout: 15_000 })
    expect(await cifras(filaDe(p, 'Norte', 'L-A'))).toEqual([6, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'L-B'))).toEqual([2, 0, 0])
    await expect(filaDe(p, 'Principal', 'L-A'), 'L-A se agotó en Principal').toHaveCount(0)
    expect(await cifras(filaDe(p, 'Principal', 'L-B'))).toEqual([2, 0, 0])

    // ── Transferir ELIGIENDO los lotes (de Norte a Principal: 1 de L-A y 2 de L-B); la cantidad es la suma ──
    await elegir(tr.getByLabel('Desde'), 'Norte')
    await elegir(tr.getByLabel('Hacia'), 'Principal')
    await tr.getByRole('radio', { name: 'Elegir los lotes' }).check()
    await expect(tr.getByLabel('Cantidad')).toHaveText('0')
    await tr.getByLabel('Cuánto sale del lote L-A de este producto').fill('1')
    await tr.getByLabel('Cuánto sale del lote L-B de este producto').fill('2')
    await expect(tr.getByLabel('Cantidad')).toHaveText('3')
    await tr.getByRole('button', { name: 'Transferir' }).click()
    await expect.poll(async () => (await cifras(filaDe(p, 'Principal', 'L-A')).catch(() => [-1]))[0], { timeout: 15_000 }).toBe(1)
    expect(await cifras(filaDe(p, 'Principal', 'L-B'))).toEqual([4, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'L-A'))).toEqual([5, 0, 0])
    await expect(filaDe(p, 'Norte', 'L-B'), 'L-B se agotó en Norte').toHaveCount(0)
    // El historial de la ficha dice de qué lotes es la transferencia.
    await expect(p.getByRole('list', { name: 'Historial de movimientos' }).getByText(/Lotes: L-B ×2, L-A ×1/).first()).toBeVisible()

    // ── Enviar con lotes: la línea deja elegirlos y viaja junto a un producto sin lotes ──
    await p.goto('/admin/inventario/transferencias/nueva')
    const form = p.getByRole('form', { name: 'Nueva transferencia con envío' })
    await form.getByLabel('Sucursal que envía').selectOption({ label: 'Principal' })
    await form.getByLabel('Sucursal que recibe').selectOption({ label: 'Norte' })
    const buscar = form.getByLabel('Escanear o buscar un producto para enviar')
    const lineas = form.getByRole('list', { name: 'Productos del envío' })
    await buscar.fill(`LEC-${sufijo}`)
    await buscar.press('Enter')
    const fLeche = lineas.getByRole('listitem').filter({ hasText: LECHE })
    await expect(fLeche).toContainText('lleva lotes')
    await expect(fLeche).toContainText('Sale el lote que antes vence')
    await fLeche.getByLabel('Elegir de qué lotes sale').check()
    await expect(fLeche.getByRole('table', { name: `Lotes de ${LECHE}` })).toBeVisible({ timeout: 15_000 })
    // Los lotes se enseñan con lo que hay y en orden FEFO.
    await expect(fLeche.locator('tr[data-lote="L-A"]')).toContainText('1')
    await expect(fLeche.locator('tr[data-lote="L-B"]')).toContainText('4')
    await fLeche.getByLabel(`Cuánto sale del lote L-A de ${LECHE}`).fill('1')
    await fLeche.getByLabel(`Cuánto sale del lote L-B de ${LECHE}`).fill('3')
    await expect(fLeche.getByLabel(`Cantidad de ${LECHE}`)).toHaveText('4')
    await buscar.fill(`PAN-${sufijo}`)
    await buscar.press('Enter')
    const fPan = lineas.getByRole('listitem').filter({ hasText: PAN })
    await expect(fPan).not.toContainText('lleva lotes')
    await fPan.getByRole('textbox').fill('3')
    await expect(form.getByText(/2 productos · 7 unidades · de Principal a Norte/)).toBeVisible()
    // Más de lo que hay en total rechaza TODO el envío (y el pan, que sí alcanzaba, tampoco sale).
    await fLeche.getByLabel(`Cuánto sale del lote L-B de ${LECHE}`).fill('9')
    await form.getByRole('button', { name: 'Enviar transferencia' }).click()
    await expect(p.getByText(/No alcanza para enviar desde «Principal»/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p).toHaveURL(/\/transferencias\/nueva$/)
    // Alcanza en total pero NO en el lote elegido (de L-A hay 1 y se piden 3): también se rechaza todo, y dice qué lote.
    await fLeche.getByLabel(`Cuánto sale del lote L-A de ${LECHE}`).fill('3')
    await fLeche.getByLabel(`Cuánto sale del lote L-B de ${LECHE}`).fill('1')
    await form.getByRole('button', { name: 'Enviar transferencia' }).click()
    await expect(p.getByText(/El lote L-A solo tiene 1 unidad/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p).toHaveURL(/\/transferencias\/nueva$/)
    await fLeche.getByLabel(`Cuánto sale del lote L-A de ${LECHE}`).fill('1')
    await fLeche.getByLabel(`Cuánto sale del lote L-B de ${LECHE}`).fill('3')
    await form.getByRole('button', { name: 'Enviar transferencia' }).click()
    await p.waitForURL(/\/admin\/inventario\/transferencias\/(?!nueva)[^/]+$/, { timeout: 30_000 })
    const trasladoId = p.url().split('/').pop()!

    // ── La transferencia enseña los lotes de cada línea ──
    const lotesLinea = p.getByRole('list', { name: `Lotes de ${LECHE}` })
    await expect(lotesLinea.locator('li[data-lote="L-A"]')).toContainText('Enviado 1')
    await expect(lotesLinea.locator('li[data-lote="L-B"]')).toContainText('Enviado 3')
    await expect(lotesLinea.locator('li[data-lote="L-B"]')).toContainText('En camino 3')
    await expect(p.getByRole('list', { name: `Lotes de ${PAN}` })).toHaveCount(0)
    const movs = p.getByRole('list', { name: 'Movimientos de la transferencia' })
    await expect(movs).toContainText('lotes: L-B ×3, L-A ×1')

    // ── Recibir lote por lote: el tope es POR LOTE ──
    const llego = p.getByRole('list', { name: 'Lo que llegó' })
    await expect(llego.getByLabel(`Llegó del lote L-B de ${LECHE}`)).toHaveValue('3')
    await llego.getByLabel(`Llegó del lote L-B de ${LECHE}`).fill('4') // de L-B solo faltan 3
    await expect(p.getByRole('button', { name: 'Recibir lo que llegó' })).toBeDisabled()
    await llego.getByLabel(`Llegó del lote L-B de ${LECHE}`).fill('1')
    await llego.getByLabel(`Llegó del lote L-A de ${LECHE}`).fill('0')
    await llego.getByLabel(`Llegó de ${PAN}`).fill('0')
    await p.getByRole('button', { name: 'Recibir lo que llegó' }).click()
    await expect(p.getByText('Recibida en parte', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(lotesLinea.locator('li[data-lote="L-B"]')).toContainText('Recibido 1')
    await expect(lotesLinea.locator('li[data-lote="L-B"]')).toContainText('En camino 2')
    await expect(lotesLinea.locator('li[data-lote="L-A"]')).toContainText('En camino 1')
    await expect(movs).toContainText('lotes: L-B ×1')

    // ── Cancelar: lo que sigue en camino vuelve al origen, lote por lote ──
    await p.getByRole('button', { name: 'Cancelar envío' }).click()
    await p.getByRole('button', { name: /^Sí, cancelar la transferencia/ }).click()
    await expect(p.getByText('Cancelada', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(lotesLinea.locator('li[data-lote="L-B"]')).toContainText('Devuelto 2')
    await expect(lotesLinea.locator('li[data-lote="L-A"]')).toContainText('Devuelto 1')
    await expect(movs).toContainText('lotes: L-B ×2, L-A ×1')
    // El archivo trae el bloque de lotes y la columna de lotes de cada movimiento.
    const csv = await p.request.get(`/admin/inventario/transferencias/${trasladoId}/exportar`)
    expect(csv.status()).toBe(200)
    const texto = await csv.text()
    expect(texto).toContain('SKU;Producto;Lote;Vencimiento;Enviado;Recibido;Devuelto al origen;En camino')
    expect(texto).toMatch(new RegExp(`LEC-${sufijo};${LECHE};L-B;${LEJANO};3;1;2;0`, 'i'))
    expect(texto).toMatch(new RegExp(`LEC-${sufijo};${LECHE};L-A;${PRONTO};1;0;1;0`, 'i'))
    expect(texto).toContain('Motivo;Lotes')

    // ── La ficha: cada lote volvió a su sitio (A 1+1, B 1+2 en Principal; lo recibido se quedó en Norte) ──
    await p.goto(`/admin/inventario/${vLeche}`)
    await expect(filaDe(p, 'Principal', 'L-A')).toBeVisible({ timeout: 15_000 })
    expect(await cifras(filaDe(p, 'Principal', 'L-A'))).toEqual([1, 0, 0])
    expect(await cifras(filaDe(p, 'Principal', 'L-B'))).toEqual([3, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'L-A'))).toEqual([5, 0, 0])
    expect(await cifras(filaDe(p, 'Norte', 'L-B'))).toEqual([1, 0, 0])
    // El pan (sin lotes) volvió entero a Principal: 10.
    await p.goto(`/admin/inventario/${vPan}`)
    await expect(tarjeta(p, 'Principal')).toBeVisible({ timeout: 15_000 })
    await expect(p.getByLabel(/^Lotes en/)).toHaveCount(0)

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })

  test('INV-5b5 · activar por error y deshacerlo; con lotes recibidos ya no; corregir el vencimiento de un lote con motivo y verlo en la historia y en «Vence pronto»', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const YOGUR = `Yogur lotes E2E ${sufijo}`
    const principalId = (await sucursalSembrada(con.id, 'Principal')).id
    const yogur = await itemSembrado(con.id, { name: YOGUR, slug: `yogur-lot-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `YOG-${sufijo}`, price: 60, porDefecto: true }] })
    const vYogur = await varianteDe(yogur.id)
    await existenciasSembradas(con.id, vYogur, principalId, 4)
    const existencia = async () => (await prismaDeArnes().inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: vYogur, locationId: principalId } })).onHand
    const oferta = () => p.getByLabel('Lotes y vencimiento')

    // ── Activados por error: se deshace, las existencias no cambian y se ofrece activarlos otra vez ──
    await p.goto(`/admin/inventario/${vYogur}`)
    await oferta().getByRole('button', { name: 'Activar lotes en este producto' }).click()
    await oferta().getByRole('group', { name: 'Confirmar la activación de lotes' }).getByRole('button', { name: 'Sí, activar lotes' }).click()
    const deshacer = p.getByLabel('Deshacer la activación de lotes')
    await expect(deshacer).toBeVisible({ timeout: 15_000 })
    await deshacer.getByRole('button', { name: 'Desactivar los lotes de este producto' }).click()
    await deshacer.getByRole('group', { name: 'Confirmar la desactivación de lotes' }).getByRole('button', { name: 'Cancelar' }).click()
    await expect(deshacer.getByRole('group', { name: 'Confirmar la desactivación de lotes' })).toHaveCount(0)
    await deshacer.getByRole('button', { name: 'Desactivar los lotes de este producto' }).click()
    await deshacer.getByRole('button', { name: 'Sí, desactivar lotes' }).click()
    await expect(oferta()).toBeVisible({ timeout: 15_000 })
    await expect(deshacer).toHaveCount(0)
    expect(await existencia(), 'deshacer no toca las existencias').toBe(4)
    expect(await prismaDeArnes().inventoryLotTracking.count({ where: { catalogVariantId: vYogur } })).toBe(0)

    // ── Otra vez activados y con lotes recibidos: ya no se puede deshacer ──
    await oferta().getByRole('button', { name: 'Activar lotes en este producto' }).click()
    await oferta().getByRole('group', { name: 'Confirmar la activación de lotes' }).getByRole('button', { name: 'Sí, activar lotes' }).click()
    await expect(deshacer).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 6, lote: 'Y-A', vence: PRONTO })
    await expect(filaDe(p, 'Principal', 'Y-A')).toBeVisible({ timeout: 15_000 })
    await movimiento(p, 'Principal', { operacion: 'Entrada de mercancía', cantidad: 4, lote: 'Y-B', vence: LEJANO })
    await expect(filaDe(p, 'Principal', 'Y-B')).toBeVisible({ timeout: 15_000 })
    await p.reload()
    await expect(filaDe(p, 'Principal', 'Y-A')).toBeVisible({ timeout: 15_000 })
    await expect(deshacer, 'con lotes recibidos ya no se ofrece deshacer').toHaveCount(0)

    // ── «Vence pronto» ve el lote de Y-A en 10 días ──
    await p.goto('/admin/inventario/reportes/vencimientos')
    const lista = p.getByRole('list', { name: 'Lotes que vencen pronto' })
    await expect(lista.locator('li[data-lote="Y-A"]')).toContainText('Vence en 10 días', { timeout: 15_000 })

    // ── Corregir el vencimiento de Y-A: el «SIN LOTE» no tiene el botón; sin motivo no pasa; con motivo, sí ──
    await p.goto(`/admin/inventario/${vYogur}`)
    await expect(filaDe(p, 'Principal', 'SIN LOTE').getByRole('button', { name: /Corregir/ })).toHaveCount(0)
    await filaDe(p, 'Principal', 'Y-A').getByRole('button', { name: 'Corregir el vencimiento del lote Y-A' }).click()
    const corregir = p.getByRole('form', { name: 'Corregir el vencimiento del lote Y-A' })
    await corregir.getByLabel(/^Vence el/).fill(dia(40))
    await corregir.getByLabel('Motivo *').fill('   ')
    await corregir.getByRole('button', { name: 'Guardar corrección' }).click()
    await expect(p.getByText(/necesita un motivo/).first()).toBeVisible({ timeout: 15_000 })
    expect(await prismaDeArnes().inventoryLotExpiryChange.count({ where: { catalogVariantId: vYogur } }), 'sin motivo no se guarda nada').toBe(0)
    await corregir.getByLabel('Motivo *').fill('Se leyó mal la fecha del empaque')
    await corregir.getByRole('button', { name: 'Guardar corrección' }).click()
    await expect(p.getByText(new RegExp(`Vencimiento del lote Y-A corregido: ${PRONTO} → ${dia(40)}`)).first()).toBeVisible({ timeout: 15_000 })
    await expect(filaDe(p, 'Principal', 'Y-A')).toContainText(dia(40), { timeout: 15_000 })
    await expect(filaDe(p, 'Principal', 'Y-A')).toContainText('Vence en 40 días')
    const historia = p.getByRole('list', { name: 'Historial de correcciones de vencimiento' })
    await expect(historia.locator('li[data-lote="Y-A"]')).toContainText(`${PRONTO} → ${dia(40)}`)
    await expect(historia.locator('li[data-lote="Y-A"]')).toContainText('Se leyó mal la fecha del empaque')
    // Corregirlo es del LOTE: el número de unidades no cambió.
    expect((await cifras(filaDe(p, 'Principal', 'Y-A')))[0]).toBe(6)

    // ── «Vence pronto» ya no lo ve a los 30 días ──
    await p.goto('/admin/inventario/reportes/vencimientos')
    await expect(p.getByRole('heading', { name: 'Vence pronto', level: 1 })).toBeVisible()
    await expect(lista.locator('li[data-lote="Y-A"]')).toHaveCount(0)

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })

  test('INV-5c · series: activar por series, asignar números a lo que había, entrada con series (repetidas y existentes se rechazan) y buscar una serie con su historia', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const errores: string[] = []
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`)
    })
    await entrarComo(ctx, 'catalogoConCapacidad', BASE, con.id)
    const TALADRO = `Taladro series E2E ${sufijo}`
    const principalId = (await sucursalSembrada(con.id, 'Principal')).id
    const taladro = await itemSembrado(con.id, { name: TALADRO, slug: `taladro-ser-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `TAL-${sufijo}`, price: 2500, porDefecto: true }] })
    const vTaladro = await varianteDe(taladro.id)
    await existenciasSembradas(con.id, vTaladro, principalId, 4)
    const tablaSeries = (sucursal: string) => p.getByRole('table', { name: `Series en ${sucursal}` })
    const fila = (sucursal: string, codigo: string) => tablaSeries(sucursal).locator(`tbody tr[data-lote="${codigo}"]`)

    // ── Activar eligiendo «por series»: sin vencimiento, y lo que había queda «SIN SERIE» ──
    await p.goto(`/admin/inventario/${vTaladro}`)
    const oferta = p.getByLabel('Lotes y vencimiento')
    await oferta.getByRole('button', { name: 'Activar lotes en este producto' }).click()
    const confirmar = oferta.getByRole('group', { name: 'Confirmar la activación de lotes' })
    await confirmar.getByLabel(/Por series/).check()
    await expect(confirmar.getByText('Exigir fecha de vencimiento en cada lote nuevo')).toHaveCount(0)
    await confirmar.getByRole('button', { name: 'Sí, activar series' }).click()
    await expect(p.getByText(/Series activadas/).first()).toBeVisible({ timeout: 15_000 })
    await expect(p.getByText(/lleva series/).first()).toBeVisible({ timeout: 15_000 })
    await expect(fila('Principal', 'SIN LOTE')).toContainText('SIN SERIE')
    expect(await cifrasSerie(fila('Principal', 'SIN LOTE'))).toEqual([4, 0, 0])
    expect(await prismaDeArnes().inventoryLotTracking.findFirstOrThrow({ where: { catalogVariantId: vTaladro } }).then((t) => [t.tracksSerials, t.requiresExpiry])).toEqual([true, false])
    // Una serie no vence ni se corrige, y no se mueve entre lotes.
    await expect(tablaSeries('Principal').getByRole('columnheader', { name: 'Vencimiento' })).toHaveCount(0)
    await expect(p.getByRole('form', { name: 'Mover unidades entre lotes en Principal' })).toHaveCount(0)
    await expect(p.getByRole('form', { name: 'Registrar movimiento en Principal' }).getByLabel(/^Vence/)).toHaveCount(0)

    // ── Asignar números de serie a lo que había ──
    const asignar = p.getByRole('form', { name: 'Asignar series en Principal' })
    await expect(asignar).toContainText('4 unidades «SIN SERIE»')
    await asignar.getByLabel('Números de serie a asignar en Principal').fill('TAL-001\ntal-002')
    await expect(asignar).toContainText('2 series')
    await asignar.getByRole('button', { name: 'Asignar series' }).click()
    await expect(p.getByText('2 series asignadas.').first()).toBeVisible({ timeout: 15_000 })
    await expect(fila('Principal', 'TAL-001')).toBeVisible({ timeout: 15_000 })
    expect(await cifrasSerie(fila('Principal', 'TAL-001'))).toEqual([1, 0, 0])
    expect(await cifrasSerie(fila('Principal', 'TAL-002'))).toEqual([1, 0, 0])
    expect(await cifrasSerie(fila('Principal', 'SIN LOTE'))).toEqual([2, 0, 0])
    // Una serie que ya está en el inventario no se asigna otra vez, y nada cambió.
    await asignar.getByLabel('Números de serie a asignar en Principal').fill('TAL-001')
    await asignar.getByRole('button', { name: 'Asignar series' }).click()
    await expect(p.getByText(/La serie TAL-001 ya está en el inventario/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cifrasSerie(fila('Principal', 'SIN LOTE'))).toEqual([2, 0, 0])
    // Una serie es una sola unidad: la cantidad de un movimiento suelto con serie es 1.
    const f = p.getByRole('form', { name: 'Registrar movimiento en Principal' })
    await f.getByLabel('Movimiento').selectOption({ label: 'Entrada de mercancía' })
    await f.getByLabel(/^Cantidad/).first().fill('2')
    await f.getByLabel(/^Serie/).fill('TAL-009')
    await f.getByRole('button', { name: 'Registrar' }).click()
    await expect(p.getByText(/Una serie es una sola unidad/).first()).toBeVisible({ timeout: 15_000 })

    // ── Entrada con series: un número por unidad; repetidas y existentes se rechazan ──
    await p.goto('/admin/inventario/entradas/nueva')
    const buscar = p.getByLabel('Escanear o buscar un producto')
    await buscar.fill(`TAL-${sufijo}`)
    await buscar.press('Enter')
    const series = p.getByRole('group', { name: new RegExp(`^Series de ${TALADRO}`) })
    await expect(series).toBeVisible({ timeout: 15_000 })
    await expect(series).not.toContainText('cuándo vence')
    const texto = series.getByLabel(new RegExp(`^Números de serie de ${TALADRO}`))
    await texto.fill('TAL-003\nTAL-003')
    await expect(series).toContainText('2 series')
    await p.getByRole('button', { name: 'Registrar entrada' }).click()
    await expect(p.getByText(/repetida/).first()).toBeVisible({ timeout: 15_000 })
    await texto.fill('TAL-001\nTAL-004')
    await p.getByRole('button', { name: 'Registrar entrada' }).click()
    await expect(p.getByText(/La serie TAL-001 ya está en el inventario \(Principal\)/).first()).toBeVisible({ timeout: 15_000 })
    expect(await prismaDeArnes().inventoryLot.count({ where: { catalogVariantId: vTaladro, code: { in: ['TAL-003', 'TAL-004'] } } }), 'lo rechazado no dejó series').toBe(0)
    await texto.fill('TAL-003\nTAL-004')
    await expect(p.getByLabel(new RegExp(`^Total de ${TALADRO}`))).toHaveText('2')
    await p.getByRole('button', { name: 'Registrar entrada' }).click()
    await p.waitForURL(/\/admin\/inventario\/entradas\/[^/]+$/, { timeout: 30_000 })
    await expect(p.getByText('Lotes: TAL-003 ×1, TAL-004 ×1')).toBeVisible()
    for (const c of ['TAL-001', 'TAL-002', 'TAL-003', 'TAL-004']) {
      const unidades = await prismaDeArnes().inventoryLotBalance.findMany({ where: { lot: { catalogVariantId: vTaladro, code: c } }, select: { onHand: true, damaged: true } })
      expect(unidades.reduce((t, b) => t + b.onHand + b.damaged, 0), `la serie ${c} es una sola unidad`).toBe(1)
    }

    // ── Buscar una serie: de qué producto es, dónde está y su historia ──
    await p.goto('/admin/inventario/reportes')
    await p.getByRole('link', { name: /Buscar una serie/ }).click()
    await p.waitForURL(/\/admin\/inventario\/reportes\/series$/)
    const buscador = p.getByRole('form', { name: 'Buscar una serie' })
    await buscador.getByLabel('Número de serie').fill('tal-00')
    await buscador.getByRole('button', { name: 'Buscar' }).click()
    const lista = p.getByRole('list', { name: 'Series encontradas' })
    await expect(lista.locator(':scope > li')).toHaveCount(4, { timeout: 15_000 })
    await buscador.getByLabel('Número de serie').fill('TAL-001')
    await buscador.getByRole('button', { name: 'Buscar' }).click()
    const una = lista.locator('[data-serie="TAL-001"]')
    await expect(una).toBeVisible({ timeout: 15_000 })
    await expect(una).toContainText(TALADRO)
    await expect(una).toContainText('En existencia')
    await expect(una.getByRole('list', { name: 'Dónde está la serie TAL-001' })).toContainText('Principal')
    await expect(una.getByRole('list', { name: 'Historia de la serie TAL-001' }).getByRole('listitem').first()).toContainText('Ajuste')
    await buscador.getByLabel('Número de serie').fill('NO-EXISTE-999')
    await buscador.getByRole('button', { name: 'Buscar' }).click()
    await expect(p.getByText(/No hay ninguna serie que contenga/)).toBeVisible({ timeout: 15_000 })

    expect(errores, errores.join('\n')).toEqual([])
    await ctx.close()
  })
})
