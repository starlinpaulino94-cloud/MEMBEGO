import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { esMismaRecepcion, planDeRecepcionOrden, type LineaDeOrden, type RecepcionComparable } from '../src/modules/inventory/compras'
import { ordenToCsv, type OrdenParaCsv } from '../src/modules/inventory/exportacion'

/**
 * INV-5b2 · LOTES EN ÓRDENES DE COMPRA — el plan de recepción con lotes, cuándo una clave repetida es el mismo reintento, el archivo de la
 * orden y las guardias estáticas (el servicio, la acción, el formulario de recepción y la lectura de la orden).
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function cuerpoDe(src: string, nombre: string): string {
  const inicio = src.search(new RegExp(`^(export )?(async )?function ${nombre}\\b`, 'm'))
  assert.ok(inicio >= 0, `no encuentro la función ${nombre}`)
  const resto = src.slice(inicio + 10)
  const fin = resto.search(/^(export |async function |function |const |interface |type )/m)
  return src.slice(inicio, fin < 0 ? undefined : inicio + 10 + fin)
}

const linea = (varianteId: string, pedido: number, recibido = 0, cancelado = 0): LineaDeOrden => ({ varianteId, pedido, recibido, cancelado })

// ── El plan de recepción conserva los lotes ──────────────────────────────────

test('INV-5b2 · el plan de recepción lleva los lotes de cada línea y no inventa lotes para lo que no los trae', () => {
  const lineas = [linea('a', 10), linea('b', 6), linea('c', 4)]
  const p = planDeRecepcionOrden(
    lineas,
    [
      { varianteId: 'a', cantidad: 5, lotes: [{ codigo: 'L1', vencimiento: '2027-09-01', cantidad: 3 }, { codigo: 'L2', cantidad: 2 }] },
      { varianteId: 'b', cantidad: 4 },
      { varianteId: 'c', cantidad: 2, lotes: [] },
    ],
    false,
    null
  )
  assert.ok(p.ok)
  if (!p.ok) return
  assert.deepEqual(p.recibir, [
    { varianteId: 'a', cantidad: 5, lotes: [{ codigo: 'L1', vencimiento: '2027-09-01', cantidad: 3 }, { codigo: 'L2', cantidad: 2 }] },
    { varianteId: 'b', cantidad: 4 },
    { varianteId: 'c', cantidad: 2 },
  ])
  assert.equal(p.estadoFinal, 'PARTIAL')
  assert.equal(p.pendienteDespues, 5 + 2 + 2)
})

test('INV-5b2 · recibir 0 de una línea la ignora (con sus lotes); lotes que no son una lista se rechazan; «todo» no trae lotes', () => {
  const lineas = [linea('a', 10), linea('b', 6)]
  const cero = planDeRecepcionOrden(lineas, [{ varianteId: 'a', cantidad: 0, lotes: [{ codigo: 'L1', cantidad: 5 }] }, { varianteId: 'b', cantidad: 6 }], false, null)
  assert.ok(cero.ok)
  if (cero.ok) assert.deepEqual(cero.recibir, [{ varianteId: 'b', cantidad: 6 }])

  // `null` es «sin lotes» (no es una lista mal armada).
  const nulos = planDeRecepcionOrden(lineas, [{ varianteId: 'a', cantidad: 5, lotes: null as never }], false, null)
  assert.ok(nulos.ok)
  if (nulos.ok) assert.deepEqual(nulos.recibir, [{ varianteId: 'a', cantidad: 5 }])

  const mal = planDeRecepcionOrden(lineas, [{ varianteId: 'a', cantidad: 5, lotes: 'L1' as never }], false, null)
  assert.ok(!mal.ok)
  if (!mal.ok) assert.equal(mal.codigo, 'LOTES_INVALIDOS')
  const objeto = planDeRecepcionOrden(lineas, [{ varianteId: 'a', cantidad: 5, lotes: { codigo: 'L1' } as never }], false, null)
  assert.ok(!objeto.ok)

  const todo = planDeRecepcionOrden(lineas, 'TODO', false, null)
  assert.ok(todo.ok)
  if (todo.ok) assert.deepEqual(todo.recibir, [{ varianteId: 'a', cantidad: 10 }, { varianteId: 'b', cantidad: 6 }], 'sin lotes: el servicio decide si eso se admite')
})

test('INV-5b2 · los lotes no cambian las reglas de cantidad: ni más de lo pedido, ni una línea ajena o repetida', () => {
  const lineas = [linea('a', 10, 4)]
  const lotes = [{ codigo: 'L1', cantidad: 7 }]
  const de_mas = planDeRecepcionOrden(lineas, [{ varianteId: 'a', cantidad: 7, lotes }], false, null)
  assert.ok(!de_mas.ok)
  if (!de_mas.ok) assert.equal(de_mas.codigo, 'RECIBE_MAS_DE_LO_PEDIDO')
  const ajena = planDeRecepcionOrden(lineas, [{ varianteId: 'z', cantidad: 1, lotes }], false, null)
  assert.ok(!ajena.ok)
  if (!ajena.ok) assert.equal(ajena.codigo, 'LINEA_AJENA')
  const repetida = planDeRecepcionOrden(lineas, [{ varianteId: 'a', cantidad: 1, lotes }, { varianteId: 'a', cantidad: 1, lotes }], false, null)
  assert.ok(!repetida.ok)
  if (!repetida.ok) assert.equal(repetida.codigo, 'LINEA_REPETIDA')
})

// ── ¿Es la misma recepción? ──────────────────────────────────────────────────

const rc = (varianteId: string, cantidad: number, lotes: Array<[string, number]> = []): RecepcionComparable => ({ varianteId, cantidad, lotes: new Map(lotes) })

test('INV-5b2 · una clave repetida es un reintento solo con los mismos productos, cantidades Y lotes', () => {
  const previa = [rc('a', 6, [['L1', 4], ['L2', 2]]), rc('b', 3)]
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 4], ['L2', 2]]), rc('b', 3)]), true)
  assert.equal(esMismaRecepcion(previa, [rc('b', 3), rc('a', 6, [['L2', 2], ['L1', 4]])]), true, 'el orden no importa')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 3], ['L2', 3]]), rc('b', 3)]), false, 'las mismas unidades repartidas de otra forma')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 4], ['L3', 2]]), rc('b', 3)]), false, 'otro código de lote')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 6]]), rc('b', 3)]), false, 'un lote en vez de dos')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 4], ['L2', 2], ['L3', 1]]), rc('b', 3)]), false, 'un lote de más')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6), rc('b', 3)]), false, 'sin lotes lo que antes los traía')
  assert.equal(esMismaRecepcion(previa, [rc('a', 5, [['L1', 3], ['L2', 2]]), rc('b', 3)]), false, 'otra cantidad')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 4], ['L2', 2]])]), false, 'falta un producto')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 4], ['L2', 2]]), rc('b', 3), rc('c', 1)]), false, 'sobra un producto')
  assert.equal(esMismaRecepcion([rc('b', 3)], [rc('b', 4)]), false, 'otra cantidad, sin lotes')
  assert.equal(esMismaRecepcion([rc('b', 3)], [rc('b', 3)]), true, 'la misma, sin lotes')
  assert.equal(esMismaRecepcion(previa, [rc('a', 6, [['L1', 4], ['L2', 2]]), rc('c', 3)]), false, 'otro producto')
  assert.equal(esMismaRecepcion([rc('b', 3)], [rc('b', 3, [['L1', 3]])]), false, 'lotes donde antes no había')
  assert.equal(esMismaRecepcion([rc('b', 3), rc('b', 3)], [rc('b', 3), rc('b', 3)]), false, 'un producto repetido nunca es una recepción válida')
  assert.equal(esMismaRecepcion([], []), true)
})

// ── El archivo de la orden ───────────────────────────────────────────────────

function ordenDePrueba(lotesRecibidos: string | null | undefined): OrdenParaCsv {
  const f = new Date('2027-06-15T16:00:00.000Z')
  return {
    numero: 'OC-2027-000001',
    estado: 'PARTIAL',
    proveedorNombre: 'Proveedor',
    sucursalNombre: 'Principal',
    referencia: null,
    nota: null,
    creadoEn: f,
    pedidoEn: f,
    previstaEn: null,
    cerradoEn: null,
    creadoPorNombre: 'Ana',
    pedidoPorNombre: 'Ana',
    cerradoPorNombre: null,
    motivoCierre: null,
    valor: '125.00',
    valorRecibido: '50.00',
    valorPendiente: '75.00',
    detalle: [{ sku: 'SKU-1', barcode: null, itemNombre: 'Jabón', nombreVariante: 'Único', esDefault: true, pedido: 10, recibido: 4, cancelado: 0, pendiente: 6, costo: '12.50', valor: '125.00', ...(lotesRecibidos === undefined ? {} : { lotesRecibidos }) }],
    entradas: [],
  } as unknown as OrdenParaCsv
}

test('INV-5b2 · el archivo de la orden trae de qué lotes llegó cada línea (vacío si no lleva lotes) y neutraliza fórmulas', () => {
  const con = ordenToCsv(ordenDePrueba('A-1 ×3, B-2 ×1'), 'America/Santo_Domingo')
  assert.match(con, /Valor pedido;Lotes recibidos/, 'la columna va al final de las líneas')
  assert.match(con, /125\.00;"A-1 ×3, B-2 ×1"/, 'varios lotes en una celda (entre comillas por las comas)')
  const sin = ordenToCsv(ordenDePrueba(null), 'America/Santo_Domingo')
  assert.match(sin, /125\.00;\s*$/m, 'sin lotes, la celda queda vacía')
  const antiguo = ordenToCsv(ordenDePrueba(undefined), 'America/Santo_Domingo')
  assert.match(antiguo, /Valor pedido;Lotes recibidos/, 'quien no manda el campo sigue funcionando')
  const formula = ordenToCsv(ordenDePrueba('=1+1'), 'America/Santo_Domingo')
  assert.doesNotMatch(formula, /;=1\+1/, 'un texto que empieza como fórmula se neutraliza')
  assert.match(formula, /;'=1\+1/)
})

// ── Guardias estáticas ───────────────────────────────────────────────────────

test('INV-5b2 · el servicio de compras pide por producto y recibe con lotes: delega en la entrada de mercancía, no escribe lotes por su cuenta', () => {
  const f = sinComent(leer('src/modules/inventory/compras-service.ts'))
  assert.doesNotMatch(f, /exigirSinLotes/, 'ya no se niega a pedir un producto con lotes')
  assert.doesNotMatch(f, /inventoryLot\.(create|update|delete)|inventoryLotBalance|inventoryMovementLot\.(create|update|delete)|asegurarLotes|escribirRepartos/, 'los lotes los escribe la entrada de mercancía, no el servicio de compras')
  const recibir = cuerpoDe(f, 'recibirOrdenEnTx')
  assert.match(recibir, /\.\.\.\(x\.lotes \? \{ lotes: x\.lotes \} : \{\}\)/, 'los lotes de cada línea viajan a la entrada')
  assert.match(recibir, /esMismaRecepcion\(registradas, \[\.\.\.pedidas\.values\(\)\]\)/, 'la clave repetida compara también los lotes')
  assert.match(recibir, /repartosPorCodigoEnTx\(tx, companyId, previa\.lines\.map\(\(p\) => p\.movementId\)\)/, 'lo registrado se lee del reparto de sus movimientos')
  assert.match(recibir, /validarLotesDeLinea\(l\.lotes, l\.cantidad, \{ exigirVencimiento: false, series \}\)/, 'los lotes pedidos se normalizan igual que en la entrada antes de compararlos')
  // «Recibir todo» no sabe de qué lote llegó: con un producto con lotes se rechaza ANTES de escribir nada.
  assert.match(recibir, /if \(e\.todo\) \{[\s\S]*productosConLotes\(tx, companyId[\s\S]*fallo\('LOTES_FALTAN'/)
  assert.ok(recibir.indexOf("fallo('LOTES_FALTAN'") < recibir.indexOf('registrarEntradaMultipleEnTx('), 'la negativa va antes de escribir')
})

test('INV-5b2 · la entrada de mercancía y la recepción de una orden leen el reparto registrado con la MISMA lectura', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  assert.match(cuerpoDe(svc, 'registrarEntradaMultipleEnTx'), /repartosPorCodigoEnTx\(tx, companyId, previa\.lines\.map\(\(p\) => p\.movementId\)\)/)
  const q = sinComent(leer('src/modules/inventory/lotes-queries.ts'))
  const lectura = cuerpoDe(q, 'repartosPorCodigoEnTx')
  assert.match(lectura, /where: \{ companyId, movementId: \{ in: \[\.\.\.movimientoIds\] \} \}/, 'solo de la empresa')
  assert.match(lectura, /balance: \{ select: \{ lot: \{ select: \{ code: true \} \} \} \}/)
})

test('INV-5b2 · la acción de recibir pasa los lotes de cada línea y la lectura de la orden dice qué productos llevan lotes y de cuáles llegó', () => {
  const a = sinComent(leer('src/modules/inventory/actions.ts'))
  const accion = cuerpoDe(a, 'recibirOrdenCompra')
  assert.match(accion, /l\?\.lotes === undefined \|\| l\?\.lotes === null \? \{\} : \{ lotes: l\.lotes as never \}/)
  const q = sinComent(leer('src/modules/inventory/compras-queries.ts'))
  const detalle = cuerpoDe(q, 'ordenDetalleEnTx')
  assert.match(detalle, /lotTracking: \{ select: \{ requiresExpiry: true, tracksSerials: true \} \}/, 'si el producto lleva lotes (hoy) y si exige vencimiento')
  assert.match(detalle, /where: \{ companyId, receipt: \{ purchaseOrderId: r\.id \} \}/, 'los lotes recibidos salen de las entradas de ESTA orden y de esta empresa')
  assert.match(detalle, /repartosPorCodigoEnTx\(/)
  assert.match(detalle, /llevaLotes: l\.variant\.lotTracking\.length > 0/)
  assert.match(detalle, /exigeVencimiento: l\.variant\.lotTracking\[0\]\?\.requiresExpiry === true/)
})

test('INV-5b2 · el formulario de recepción pide el lote de lo que lo lleva, no ofrece «recibir todo» con lotes y valida con las reglas del servidor', () => {
  const f = leer('src/components/inventario/RecibirOrdenCompraForm.tsx')
  assert.match(f, /from '\.\/EditorDeLotes'/, 'usa el mismo editor de lotes que la entrada de mercancía')
  assert.match(f, /<EditorDeLotes[\s\S]*idBase="ro"/)
  assert.match(f, /validarLotesDeLinea\(lotesParaEnviar\(/, 'revisa con las reglas del servidor antes de enviar')
  assert.match(f, /\{!hayLotes && \([\s\S]*Recibir todo lo pendiente/, 'con productos con lotes no hay «recibir todo»')
  assert.match(f, /lineas\[i\]\.llevaLotes \? \{ lotes: lotesParaEnviar\(/, 'solo las líneas con lotes mandan lotes')
  assert.match(f, /l\.llevaLotes \? sumaDeLotes\(lotes\[l\.varianteId\] \?\? \[\], l\.llevaSeries\) : \(entero\(llego\[l\.varianteId\] \?\? '0'\) \?\? -1\)/, 'lo que llegó de un producto con lotes es la suma de sus lotes')
  const pagina = leer('src/app/(admin)/admin/inventario/compras/[id]/page.tsx')
  assert.match(pagina, /llevaLotes: l\.llevaLotes, exigeVencimiento: l\.exigeVencimiento/)
  assert.match(pagina, /key=\{o\.detalle\.map\(\(l\) => l\.pendiente\)\.join\('-'\)\}/, 'el formulario nace de nuevo tras cada tanda (lo que falta cambió)')
  assert.match(pagina, /Lotes recibidos: \{l\.lotesRecibidos\}/)
})

test('INV-5b2 · el editor de lotes lo comparten la entrada y la recepción, con los mismos nombres accesibles de siempre', () => {
  const ed = leer('src/components/inventario/EditorDeLotes.tsx')
  for (const nombre of ['Código del lote', 'Vencimiento del lote', 'Cantidad del lote', 'Quitar el lote', 'Agregar otro lote']) assert.ok(ed.includes(nombre), nombre)
  assert.match(ed, /aria-label=\{`Lotes de \$\{nombre\}`\}/)
  assert.match(ed, /id=\{`\$\{idBase\}-lote-\$\{indice\}-\$\{j\}`\}/)
  const entrada = leer('src/components/inventario/EntradaMultipleForm.tsx')
  assert.match(entrada, /<EditorDeLotes[\s\S]*idBase="en"/, 'la entrada de mercancía conserva sus ids (en-lote-…)')
  assert.doesNotMatch(entrada, /Agregar otro lote|Código del lote/, 'ya no repite el editor: lo trae el componente común')
})

test('INV-5b2 · activar los lotes ya no se niega por una orden de compra abierta (se recibe con lotes), y los textos lo dicen', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  const activar = cuerpoDe(svc, 'activarLotesEnTx')
  assert.doesNotMatch(activar, /inventoryPurchaseOrderLine|ACTIVAR_CON_ORDEN_DE_COMPRA/)
  assert.match(activar, /ACTIVAR_CON_CONTEO_ABIERTO/, 'el conteo abierto y la transferencia en tránsito siguen bloqueando (5b3 y 5b4)')
  assert.match(activar, /ACTIVAR_CON_TRANSFERENCIA/)
  assert.doesNotMatch(leer('src/components/inventario/ActivarLotesCard.tsx'), /ni pedir en una orden de compra/)
  assert.doesNotMatch(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'), /ni pedir en una orden de compra/)
})
