import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_NIVELES_REPOSICION,
  NOTA_BORRADOR_REPOSICION,
  armarReposicion,
  claveDeBorradores,
  claveDeNivel,
  elegirProveedor,
  errorObjetivoContraUmbral,
  posicionDeStock,
  resumirReposicion,
  sugerenciaDeReposicion,
  validarObjetivo,
  valorDeGrupo,
  type EntradaReposicion,
  type NivelParaReposicion,
  type VinculoReposicion,
} from '../src/modules/inventory/reposicion'
import { MAX_LINEAS_ORDEN } from '../src/modules/inventory/compras'
import { CANTIDAD_MAXIMA } from '../src/modules/inventory/domain'
import { parsearCosto, formatearMonto, type Costo } from '../src/modules/inventory/costos'
import { consultaDeFiltrosReposicion, leerFiltrosReposicion } from '../src/modules/inventory/filtros'
import { reposicionToCsv } from '../src/modules/inventory/exportacion'

const costo = (t: string): Costo => {
  const r = parsearCosto(t)
  if (!r.ok) throw new Error(r.error)
  return r.valor
}

// ── «Llenar hasta» ───────────────────────────────────────────────────────────

test('validarObjetivo: enteros de 0 al máximo; todo lo demás se rechaza con su mensaje', () => {
  for (const ok of [0, 1, 50, CANTIDAD_MAXIMA]) assert.deepEqual(validarObjetivo(ok), { ok: true, valor: ok })
  for (const mal of [-1, 1.5, CANTIDAD_MAXIMA + 1, Number.NaN, Infinity, '10', null, undefined, {}, [10]]) {
    const r = validarObjetivo(mal)
    assert.equal(r.ok, false, String(mal))
  }
  assert.match((validarObjetivo(-1) as { error: string }).error, /negativo/)
  assert.match((validarObjetivo(1.5) as { error: string }).error, /entero/)
  assert.match((validarObjetivo('x') as { error: string }).error, /entero/)
  assert.match((validarObjetivo(CANTIDAD_MAXIMA + 1) as { error: string }).error, /no puede pasar de 1\.000\.000|no puede pasar de 1,000,000|no puede pasar de 1000000/)
})

test('errorObjetivoContraUmbral: el objetivo tiene que ser MAYOR que el umbral; con un 0 no hay nada que comparar', () => {
  assert.equal(errorObjetivoContraUmbral({ umbral: 5, llenarHasta: 6 }), null)
  assert.equal(errorObjetivoContraUmbral({ umbral: 5, llenarHasta: 100 }), null)
  assert.notEqual(errorObjetivoContraUmbral({ umbral: 5, llenarHasta: 5 }), null, 'igual no vale')
  assert.notEqual(errorObjetivoContraUmbral({ umbral: 5, llenarHasta: 4 }), null)
  assert.equal(errorObjetivoContraUmbral({ umbral: 0, llenarHasta: 4 }), null, 'sin umbral')
  assert.equal(errorObjetivoContraUmbral({ umbral: 5, llenarHasta: 0 }), null, 'sin objetivo')
  assert.equal(errorObjetivoContraUmbral({ umbral: 0, llenarHasta: 0 }), null)
  const m = errorObjetivoContraUmbral({ umbral: 25, llenarHasta: 20, sucursal: 'Bávaro' })!
  assert.match(m, /«Llenar hasta» \(20\) en Bávaro tiene que ser mayor que el umbral de aviso \(25\)/)
  assert.match(m, /deja «llenar hasta» en 0/)
  assert.doesNotMatch(errorObjetivoContraUmbral({ umbral: 25, llenarHasta: 20 })!, / en undefined/)
})

// ── Posición y sugerencia ────────────────────────────────────────────────────

test('posicionDeStock: lo que hay + lo pedido + lo que va en camino', () => {
  assert.equal(posicionDeStock({ disponible: 4, pedido: 10, enCamino: 3 }), 17)
  assert.equal(posicionDeStock({ disponible: 0, pedido: 0, enCamino: 0 }), 0)
  assert.equal(posicionDeStock({ disponible: 4, pedido: 0, enCamino: 0 }), 4)
  assert.equal(posicionDeStock({ disponible: 0, pedido: 7, enCamino: 0 }), 7)
  assert.equal(posicionDeStock({ disponible: 0, pedido: 0, enCamino: 9 }), 9)
})

test('sugerenciaDeReposicion: sin objetivo no hay propuesta, ni con el stock en cero', () => {
  assert.deepEqual(sugerenciaDeReposicion({ umbral: 5, llenarHasta: 0 }, 0), { estado: 'SIN_OBJETIVO', sugerida: 0 })
  assert.deepEqual(sugerenciaDeReposicion({ umbral: 0, llenarHasta: 0 }, 0), { estado: 'SIN_OBJETIVO', sugerida: 0 })
})

test('sugerenciaDeReposicion con umbral: se repone al llegar al umbral (igual o menos) y se pide hasta el objetivo', () => {
  const cfg = { umbral: 5, llenarHasta: 20 }
  assert.deepEqual(sugerenciaDeReposicion(cfg, 5), { estado: 'REPONER', sugerida: 15 }, 'justo en el umbral')
  assert.deepEqual(sugerenciaDeReposicion(cfg, 0), { estado: 'REPONER', sugerida: 20 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 3), { estado: 'REPONER', sugerida: 17 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 6), { estado: 'AL_DIA', sugerida: 0 }, 'sobre el umbral aún no toca')
  assert.deepEqual(sugerenciaDeReposicion(cfg, 19), { estado: 'AL_DIA', sugerida: 0 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 20), { estado: 'AL_DIA', sugerida: 0 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 50), { estado: 'AL_DIA', sugerida: 0 })
})

test('sugerenciaDeReposicion sin umbral: se repone en cuanto queda por debajo del objetivo', () => {
  const cfg = { umbral: 0, llenarHasta: 10 }
  assert.deepEqual(sugerenciaDeReposicion(cfg, 9), { estado: 'REPONER', sugerida: 1 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 0), { estado: 'REPONER', sugerida: 10 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 10), { estado: 'AL_DIA', sugerida: 0 })
  assert.deepEqual(sugerenciaDeReposicion(cfg, 11), { estado: 'AL_DIA', sugerida: 0 })
})

test('sugerenciaDeReposicion: un umbral que quedó igual o mayor que el objetivo (datos viejos) no pide nada ni pide de más', () => {
  assert.deepEqual(sugerenciaDeReposicion({ umbral: 10, llenarHasta: 10 }, 4), { estado: 'REPONER', sugerida: 6 }, 'umbral igual: aún hay hueco hasta el objetivo')
  assert.deepEqual(sugerenciaDeReposicion({ umbral: 10, llenarHasta: 10 }, 10), { estado: 'AL_DIA', sugerida: 0 })
  assert.deepEqual(sugerenciaDeReposicion({ umbral: 30, llenarHasta: 10 }, 20), { estado: 'AL_DIA', sugerida: 0 }, 'ya pasó del objetivo: nada que pedir')
  assert.deepEqual(sugerenciaDeReposicion({ umbral: 30, llenarHasta: 10 }, 10), { estado: 'AL_DIA', sugerida: 0 })
})

// ── Proveedor de cada línea ──────────────────────────────────────────────────

const v = (proveedorId: string, nombre: string, extra: Partial<VinculoReposicion> = {}): VinculoReposicion => ({
  proveedorId,
  proveedorNombre: nombre,
  activo: true,
  preferido: false,
  ultimoCosto: null,
  ...extra,
})

test('elegirProveedor: el preferido activo; si no hay, el único activo; si hay varios o ninguno, ninguno', () => {
  assert.equal(elegirProveedor([]), null)
  assert.equal(elegirProveedor([v('a', 'A'), v('b', 'B', { preferido: true })])?.proveedorId, 'b', 'el preferido gana aunque no sea el primero')
  assert.equal(elegirProveedor([v('a', 'A')])?.proveedorId, 'a', 'solo uno y sin preferido: ese')
  assert.equal(elegirProveedor([v('a', 'A'), v('b', 'B')]), null, 'dos sin preferido: es decisión de compra')
  assert.equal(elegirProveedor([v('a', 'A', { activo: false, preferido: true }), v('b', 'B')])?.proveedorId, 'b', 'el preferido desactivado se salta y queda el único activo')
  assert.equal(elegirProveedor([v('a', 'A', { activo: false, preferido: true }), v('b', 'B'), v('c', 'C')]), null, 'preferido desactivado y dos activos: ninguno')
  assert.equal(elegirProveedor([v('a', 'A', { activo: false })]), null, 'solo uno y está desactivado')
  assert.equal(elegirProveedor([v('a', 'A', { activo: false }), v('b', 'B', { activo: false })]), null)
  // Dos «preferidos» (la base no lo deja, pero la función no depende de eso): el de nombre menor, y a igual nombre, el de id menor.
  assert.equal(elegirProveedor([v('z', 'Zeta', { preferido: true }), v('m', 'Alfa', { preferido: true })])?.proveedorId, 'm')
  assert.equal(elegirProveedor([v('y', 'Igual', { preferido: true }), v('x', 'igual', { preferido: true })])?.proveedorId, 'x')
})

// ── Armar la pantalla ────────────────────────────────────────────────────────

let n = 0
const nivel = (o: Partial<NivelParaReposicion> & { varianteId: string; sucursalId?: string }): NivelParaReposicion => ({
  nivelId: `n${++n}`,
  sucursalId: 's1',
  sucursalNombre: 'Principal',
  sku: `SKU-${o.varianteId}`,
  barcode: null,
  producto: `Producto ${o.varianteId}`,
  nombreVariante: 'Default',
  esDefault: true,
  onHand: 0,
  reserved: 0,
  umbral: 0,
  llenarHasta: 10,
  ...o,
})
const entrada = (niveles: NivelParaReposicion[], extra: Partial<EntradaReposicion> = {}): EntradaReposicion => ({
  niveles,
  pedido: new Map(),
  enCamino: new Map(),
  enBorrador: new Map(),
  vinculos: new Map(),
  borradores: new Map(),
  ...extra,
})

test('armarReposicion: solo lo que hay que reponer, con lo disponible = existencias − apartado y lo sugerido hasta el objetivo', () => {
  const r = armarReposicion(entrada([nivel({ varianteId: 'a', onHand: 8, reserved: 3, llenarHasta: 20 })]))
  assert.equal(r.grupos.length, 1)
  const l = r.grupos[0].lineas[0]
  assert.equal(l.disponible, 5)
  assert.equal(l.sugerida, 15)
  assert.deepEqual([l.pedido, l.enCamino, l.enBorrador, l.umbral, l.llenarHasta], [0, 0, 0, 0, 20])
  assert.equal(r.grupos[0].unidades, 15)
})

test('armarReposicion: lo ya pedido y lo que va en camino se descuentan; un borrador se enseña pero NO se descuenta', () => {
  const k = claveDeNivel('a', 's1')
  const base = nivel({ varianteId: 'a', onHand: 2, llenarHasta: 20 })
  const sinNada = armarReposicion(entrada([base]))
  assert.equal(sinNada.grupos[0].lineas[0].sugerida, 18)
  const conPedido = armarReposicion(entrada([base], { pedido: new Map([[k, 6]]) }))
  assert.equal(conPedido.grupos[0].lineas[0].sugerida, 12)
  assert.equal(conPedido.grupos[0].lineas[0].pedido, 6)
  const conCamino = armarReposicion(entrada([base], { enCamino: new Map([[k, 5]]) }))
  assert.equal(conCamino.grupos[0].lineas[0].sugerida, 13)
  const ambos = armarReposicion(entrada([base], { pedido: new Map([[k, 6]]), enCamino: new Map([[k, 5]]) }))
  assert.equal(ambos.grupos[0].lineas[0].sugerida, 7)
  const conBorrador = armarReposicion(entrada([base], { enBorrador: new Map([[k, 9]]) }))
  assert.equal(conBorrador.grupos[0].lineas[0].sugerida, 18, 'el borrador no es un compromiso')
  assert.equal(conBorrador.grupos[0].lineas[0].enBorrador, 9)
  // Lo pedido para OTRA sucursal no cuenta aquí.
  const otra = armarReposicion(entrada([base], { pedido: new Map([[claveDeNivel('a', 's2'), 99]]), enCamino: new Map([[claveDeNivel('b', 's1'), 7]]) }))
  assert.equal(otra.grupos[0].lineas[0].sugerida, 18)
})

test('armarReposicion: lo que ya viene cubre el objetivo → desaparece de la propuesta y cuenta como «al día»', () => {
  const k = claveDeNivel('a', 's1')
  const r = armarReposicion(entrada([nivel({ varianteId: 'a', onHand: 2, llenarHasta: 20 })], { pedido: new Map([[k, 18]]) }))
  assert.equal(r.grupos.length, 0)
  assert.equal(r.alDia, 1)
  assert.equal(r.conObjetivo, 1)
})

test('armarReposicion con umbral: ni siquiera propone mientras la posición esté por encima del umbral', () => {
  const k = claveDeNivel('a', 's1')
  const base = nivel({ varianteId: 'a', onHand: 3, umbral: 5, llenarHasta: 20 })
  assert.equal(armarReposicion(entrada([base])).grupos.length, 1, 'disponible 3 ≤ 5')
  assert.equal(armarReposicion(entrada([base], { pedido: new Map([[k, 3]]) })).grupos.length, 0, 'con 3 pedidos la posición es 6 > 5')
  assert.equal(armarReposicion(entrada([base], { enCamino: new Map([[k, 2]]) })).grupos.length, 1, 'con 2 en camino la posición es 5: aún toca')
})

test('armarReposicion: una línea es de su sucursal; las cantidades se cruzan por producto Y sucursal', () => {
  const a1 = nivel({ varianteId: 'a', sucursalId: 's1', sucursalNombre: 'Principal', onHand: 0, llenarHasta: 10 })
  const a2 = nivel({ varianteId: 'a', sucursalId: 's2', sucursalNombre: 'Bávaro', onHand: 0, llenarHasta: 10 })
  const r = armarReposicion(entrada([a1, a2], { pedido: new Map([[claveDeNivel('a', 's2'), 4]]) }))
  const porSucursal = new Map(r.grupos.map((g) => [g.sucursalNombre, g.lineas[0].sugerida]))
  assert.equal(porSucursal.get('Principal'), 10)
  assert.equal(porSucursal.get('Bávaro'), 6)
})

test('armarReposicion: agrupa por proveedor Y sucursal; los productos sin proveedor van aparte y al final', () => {
  const niveles = [
    nivel({ varianteId: 'a', sucursalId: 's1', sucursalNombre: 'Principal' }),
    nivel({ varianteId: 'b', sucursalId: 's1', sucursalNombre: 'Principal' }),
    nivel({ varianteId: 'c', sucursalId: 's2', sucursalNombre: 'Bávaro' }),
    nivel({ varianteId: 'd', sucursalId: 's1', sucursalNombre: 'Principal' }),
  ]
  const vinculos = new Map<string, VinculoReposicion[]>([
    ['a', [v('p1', 'Zeta', { preferido: true })]],
    ['b', [v('p1', 'Zeta', { preferido: true })]],
    ['c', [v('p1', 'Zeta', { preferido: true })]],
    // 'd' no tiene proveedor.
  ])
  const r = armarReposicion(entrada(niveles, { vinculos }))
  assert.deepEqual(
    r.grupos.map((g) => [g.proveedor?.nombre ?? null, g.sucursalNombre, g.lineas.map((l) => l.varianteId)]),
    [
      ['Zeta', 'Bávaro', ['c']],
      ['Zeta', 'Principal', ['a', 'b']],
      [null, 'Principal', ['d']],
    ]
  )
  assert.deepEqual(r.grupos.map((g) => g.clave), ['p1:s2', 'p1:s1', 'sin:s1'])
})

test('armarReposicion: los grupos salen por nombre de proveedor (sin importar mayúsculas) y después por sucursal', () => {
  const niveles = [
    nivel({ varianteId: 'a', sucursalId: 's2', sucursalNombre: 'Bávaro' }),
    nivel({ varianteId: 'b', sucursalId: 's1', sucursalNombre: 'Principal' }),
    nivel({ varianteId: 'c', sucursalId: 's1', sucursalNombre: 'Principal' }),
    nivel({ varianteId: 'd', sucursalId: 's1', sucursalNombre: 'Principal' }),
  ]
  const vinculos = new Map<string, VinculoReposicion[]>([
    ['a', [v('p9', 'beta', { preferido: true })]],
    ['b', [v('p9', 'beta', { preferido: true })]],
    ['c', [v('p5', 'Alfa', { preferido: true })]],
    ['d', [v('p6', 'alfa', { preferido: true })]],
  ])
  const r = armarReposicion(entrada(niveles, { vinculos }))
  assert.deepEqual(r.grupos.map((g) => `${g.proveedor!.id}@${g.sucursalNombre}`), ['p5@Principal', 'p6@Principal', 'p9@Bávaro', 'p9@Principal'])
})

test('armarReposicion: las líneas salen por producto, variante y SKU: siempre en el mismo orden', () => {
  const niveles = [
    nivel({ varianteId: 'x1', producto: 'Zapato', nombreVariante: 'Talla 9', sku: 'Z-9' }),
    nivel({ varianteId: 'x2', producto: 'Zapato', nombreVariante: 'Talla 10', sku: 'Z-10' }),
    nivel({ varianteId: 'x3', producto: 'abrigo', nombreVariante: 'Default', sku: 'A-1' }),
    nivel({ varianteId: 'x4', producto: 'Zapato', nombreVariante: 'Talla 10', sku: 'Z-10' }),
  ]
  const r = armarReposicion(entrada(niveles))
  assert.deepEqual(r.grupos[0].lineas.map((l) => l.varianteId), ['x3', 'x2', 'x4', 'x1'])
})

test('armarReposicion: el orden de las líneas desempata por variante, SKU y id, y no distingue mayúsculas en el nombre', () => {
  const orden = (ns: NivelParaReposicion[]) => armarReposicion(entrada(ns)).grupos[0].lineas.map((l) => l.varianteId)
  // Mismo nombre de producto salvo mayúsculas: manda el desempate (SKU), no la mayúscula.
  assert.deepEqual(orden([nivel({ varianteId: 'm1', producto: 'sal', sku: 'B-1' }), nivel({ varianteId: 'm2', producto: 'Sal', sku: 'A-1' })]), ['m2', 'm1'])
  // Mismo producto: manda el nombre de la variante aunque el SKU diga lo contrario.
  assert.deepEqual(orden([nivel({ varianteId: 'v1', producto: 'Camisa', nombreVariante: 'B', sku: 'Z-1' }), nivel({ varianteId: 'v2', producto: 'Camisa', nombreVariante: 'A', sku: 'Z-2' })]), ['v2', 'v1'])
  // Mismo producto y variante: manda el SKU aunque el id diga lo contrario.
  assert.deepEqual(orden([nivel({ varianteId: 'a1', producto: 'Gorra', sku: 'S-2' }), nivel({ varianteId: 'a2', producto: 'Gorra', sku: 'S-1' })]), ['a2', 'a1'])
  // Todo igual salvo el id: manda el id, no el orden en que llegaron.
  assert.deepEqual(orden([nivel({ varianteId: 'b2', producto: 'Taza', sku: 'T-1' }), nivel({ varianteId: 'b1', producto: 'Taza', sku: 'T-1' })]), ['b1', 'b2'])
  assert.deepEqual(orden([nivel({ varianteId: 'b1', producto: 'Taza', sku: 'T-1' }), nivel({ varianteId: 'b2', producto: 'Taza', sku: 'T-1' })]), ['b1', 'b2'])
})

test('armarReposicion: las sucursales de un proveedor salen por nombre (sin distinguir mayúsculas) y, a igual nombre, por id', () => {
  const vinculos = new Map<string, VinculoReposicion[]>(['x', 'y', 'z', 'w'].map((id) => [id, [v('p1', 'P', { preferido: true })]]))
  const clavesDe = (ns: NivelParaReposicion[]) => armarReposicion(entrada(ns, { vinculos })).grupos.map((g) => g.sucursalId)
  // «norte» y «Norte» son el mismo nombre para ordenar: manda el id.
  assert.deepEqual(clavesDe([nivel({ varianteId: 'x', sucursalId: 's9', sucursalNombre: 'norte' }), nivel({ varianteId: 'y', sucursalId: 's1', sucursalNombre: 'Norte' })]), ['s1', 's9'])
  // Mismo nombre y mismo proveedor, distinto id: manda el id, no el orden de llegada.
  assert.deepEqual(clavesDe([nivel({ varianteId: 'x', sucursalId: 's2', sucursalNombre: 'Este' }), nivel({ varianteId: 'y', sucursalId: 's1', sucursalNombre: 'Este' })]), ['s1', 's2'])
  assert.deepEqual(clavesDe([nivel({ varianteId: 'x', sucursalId: 's1', sucursalNombre: 'Este' }), nivel({ varianteId: 'y', sucursalId: 's2', sucursalNombre: 'Este' })]), ['s1', 's2'])
})

test('armarReposicion: el valor suma solo lo que tiene costo; lo demás se cuenta como línea sin costo', () => {
  const niveles = [nivel({ varianteId: 'a', llenarHasta: 10 }), nivel({ varianteId: 'b', llenarHasta: 4 }), nivel({ varianteId: 'c', llenarHasta: 7 })]
  const vinculos = new Map<string, VinculoReposicion[]>([
    ['a', [v('p1', 'P', { preferido: true, ultimoCosto: costo('2.50') })]],
    ['b', [v('p1', 'P', { preferido: true, ultimoCosto: costo('0.0525') })]],
    ['c', [v('p1', 'P', { preferido: true, ultimoCosto: null })]],
  ])
  const g = armarReposicion(entrada(niveles, { vinculos })).grupos[0]
  assert.equal(g.unidades, 21)
  assert.equal(g.valor, formatearMonto(costo('25') + costo('0.21')), '10 × 2.50 + 4 × 0.0525')
  assert.equal(g.valor, '25.21')
  assert.equal(g.lineasSinCosto, 1)
  assert.equal(valorDeGrupo(g), costo('25.21'))
  const porVariante = new Map(g.lineas.map((l) => [l.varianteId, l.ultimoCosto]))
  assert.equal(porVariante.get('a'), costo('2.50'))
  assert.equal(porVariante.get('c'), null)
})

test('armarReposicion: un grupo sin proveedor no tiene costo ni borradores; uno con proveedor trae los borradores que ya hay', () => {
  const niveles = [nivel({ varianteId: 'a' }), nivel({ varianteId: 'b' })]
  const vinculos = new Map<string, VinculoReposicion[]>([['a', [v('p1', 'P', { preferido: true })]]])
  const borradores = new Map([
    [claveDeBorradores('p1', 's1'), [{ id: 'o1', numero: 'OC-2026-000001' }, { id: 'o2', numero: 'OC-2026-000002' }]],
    [claveDeBorradores('p1', 's2'), [{ id: 'o3', numero: 'OC-2026-000003' }]],
  ])
  const r = armarReposicion(entrada(niveles, { vinculos, borradores }))
  const con = r.grupos.find((g) => g.proveedor)!
  const sin = r.grupos.find((g) => !g.proveedor)!
  assert.deepEqual(con.borradores.map((b) => b.numero), ['OC-2026-000001', 'OC-2026-000002'], 'solo los de ese proveedor y esa sucursal')
  assert.deepEqual(sin.borradores, [])
  assert.equal(sin.lineas[0].ultimoCosto, null)
})

test('armarReposicion: conObjetivo = lo que se repone + lo que está al día; lo que no tiene objetivo ni cuenta', () => {
  const niveles = [
    nivel({ varianteId: 'a', onHand: 0, llenarHasta: 10 }), // repone
    nivel({ varianteId: 'b', onHand: 10, llenarHasta: 10 }), // al día
    nivel({ varianteId: 'c', onHand: 3, llenarHasta: 0 }), // sin objetivo
    nivel({ varianteId: 'd', onHand: 50, umbral: 5, llenarHasta: 60 }), // al día (sobre el umbral)
  ]
  const r = armarReposicion(entrada(niveles))
  assert.equal(r.grupos.reduce((t, g) => t + g.lineas.length, 0), 1)
  assert.equal(r.alDia, 2)
  assert.equal(r.conObjetivo, 3)
})

test('armarReposicion: un grupo con más líneas de las que admite una orden lo dice', () => {
  const muchos = Array.from({ length: MAX_LINEAS_ORDEN + 1 }, (_, i) => nivel({ varianteId: `v${String(i).padStart(4, '0')}` }))
  const vinculos = new Map<string, VinculoReposicion[]>(muchos.map((m) => [m.varianteId, [v('p1', 'P', { preferido: true })]]))
  const grande = armarReposicion(entrada(muchos, { vinculos })).grupos[0]
  assert.equal(grande.lineas.length, MAX_LINEAS_ORDEN + 1)
  assert.equal(grande.excedeLaOrden, true)
  const justo = armarReposicion(entrada(muchos.slice(0, MAX_LINEAS_ORDEN), { vinculos })).grupos[0]
  assert.equal(justo.lineas.length, MAX_LINEAS_ORDEN)
  assert.equal(justo.excedeLaOrden, false, 'exactamente el tope cabe')
})

test('armarReposicion: sin saldos con objetivo no hay nada', () => {
  const r = armarReposicion(entrada([]))
  assert.deepEqual(r, { grupos: [], alDia: 0, conObjetivo: 0 })
})

test('resumirReposicion: cuenta grupos, productos, unidades, valor, y lo que no tiene proveedor ni costo', () => {
  const niveles = [
    nivel({ varianteId: 'a', llenarHasta: 10 }),
    nivel({ varianteId: 'b', llenarHasta: 5 }),
    nivel({ varianteId: 'c', llenarHasta: 3 }),
    nivel({ varianteId: 'e', llenarHasta: 2 }), // otra sin proveedor, en el mismo grupo que 'c'
    nivel({ varianteId: 'd', sucursalId: 's2', sucursalNombre: 'Bávaro', llenarHasta: 8 }),
  ]
  const vinculos = new Map<string, VinculoReposicion[]>([
    ['a', [v('p1', 'P', { preferido: true, ultimoCosto: costo('3') })]],
    ['b', [v('p1', 'P', { preferido: true })]],
    ['d', [v('p2', 'Q', { preferido: true, ultimoCosto: costo('1.5') })]],
  ])
  const grupos = armarReposicion(entrada(niveles, { vinculos })).grupos
  assert.deepEqual(resumirReposicion(grupos), { grupos: 3, productos: 5, unidades: 28, valor: formatearMonto(costo('30') + costo('12')), sinProveedor: 2, sinCosto: 3 })
  assert.deepEqual(resumirReposicion([]), { grupos: 0, productos: 0, unidades: 0, valor: '0.00', sinProveedor: 0, sinCosto: 0 })
})

test('constantes: la nota del borrador dice de dónde viene y el tope de saldos es grande pero finito', () => {
  assert.match(NOTA_BORRADOR_REPOSICION, /Reposición/)
  assert.ok(NOTA_BORRADOR_REPOSICION.length <= 500, 'cabe en la nota de una orden')
  assert.equal(MAX_NIVELES_REPOSICION, 5000)
  assert.equal(claveDeNivel('v', 's'), 'v|s')
  assert.equal(claveDeBorradores('p', 's'), 'p|s')
})

// ── Filtros de la URL ────────────────────────────────────────────────────────

test('los filtros de reposición se leen de la URL, se recortan y vuelven a la misma URL', () => {
  const f = leerFiltrosReposicion({ q: '  harina  ', sucursal: 'suc1', proveedor: 'prov1' })
  assert.deepEqual(f, { q: 'harina', sucursalId: 'suc1', proveedorId: 'prov1' })
  const p = new URLSearchParams(consultaDeFiltrosReposicion(f))
  assert.equal(p.get('q'), 'harina')
  assert.equal(p.get('sucursal'), 'suc1')
  assert.equal(p.get('proveedor'), 'prov1')
  assert.deepEqual(leerFiltrosReposicion(Object.fromEntries(p)), f)
  assert.equal(consultaDeFiltrosReposicion({}), '')
  assert.deepEqual(leerFiltrosReposicion({}), {})
  // «sin» pide lo que no tiene proveedor.
  assert.deepEqual(leerFiltrosReposicion({ proveedor: 'sin' }), { proveedorId: 'sin' })
  assert.deepEqual(leerFiltrosReposicion({ proveedor: ' sin ' }), { proveedorId: 'sin' })
  assert.equal(new URLSearchParams(consultaDeFiltrosReposicion({ proveedorId: 'sin' })).get('proveedor'), 'sin')
})

test('un id con espacios o demasiado largo, o una búsqueda vacía o larguísima, no filtran como se espera', () => {
  assert.deepEqual(leerFiltrosReposicion({ sucursal: 'con espacio', proveedor: 'otro con espacio' }), {})
  assert.deepEqual(leerFiltrosReposicion({ sucursal: 'x'.repeat(200), proveedor: 'y'.repeat(200) }), {})
  assert.deepEqual(leerFiltrosReposicion({ q: '   ' }), {})
  assert.equal(leerFiltrosReposicion({ q: 'a'.repeat(300) }).q?.length, 80, 'la búsqueda se recorta a 80')
  assert.deepEqual(leerFiltrosReposicion({ q: ['uno', 'dos'], sucursal: ['s1', 's2'] }), { q: 'uno', sucursalId: 's1' }, 'si viene repetido manda el primero')
})

// ── CSV ──────────────────────────────────────────────────────────────────────

test('el CSV de reposición trae el resumen y una fila por producto, con números planos y las celdas de costo VACÍAS si no se sabe', () => {
  const niveles = [
    nivel({ varianteId: 'a', producto: 'Aceite', nombreVariante: '1 L', esDefault: false, sku: 'ACE-1', barcode: '7501', onHand: 2, umbral: 150, llenarHasta: 1002 }),
    nivel({ varianteId: 'b', producto: 'Sal', sku: 'SAL-1', onHand: 0, llenarHasta: 5 }),
    nivel({ varianteId: 'c', producto: '=HYPERLINK("x")', sku: '+SKU', llenarHasta: 4 }),
  ]
  const vinculos = new Map<string, VinculoReposicion[]>([
    ['a', [v('p1', 'Distribuidora Norte', { preferido: true, ultimoCosto: costo('1250.5') })]],
    ['b', [v('p1', 'Distribuidora Norte', { preferido: true })]],
  ])
  const r = armarReposicion(entrada(niveles, { vinculos, pedido: new Map([[claveDeNivel('a', 's1'), 100]]) }))
  const csv = reposicionToCsv(r.grupos, { alDia: 4, conObjetivo: 7, truncado: false, filtros: [['Sucursal', 'Principal']] })
  assert.ok(csv.startsWith('﻿'), 'con BOM para que Excel lea los acentos')
  assert.match(csv, /^\uFEFF?Reposición$/m)
  assert.match(csv, /^Qué comprar$/m)
  assert.match(csv, /Sucursal;Principal/, 'el archivo dice con qué filtros se hizo')
  assert.match(csv, /Productos por reponer;3/)
  assert.match(csv, /Unidades sugeridas;909/, 'unidades: (1002 − 2 − 100) + 5 + 4')
  assert.match(csv, /Valor sugerido \(con el último costo conocido\);1125450\.00/, '900 × 1250.50, sin separador de miles y sin contar lo que no tiene costo')
  assert.match(csv, /Productos sin proveedor al que pedirlos;1/)
  assert.match(csv, /Productos sin costo conocido;2/)
  assert.match(csv, /Saldos con objetivo que están al día;4/)
  assert.match(csv, /Saldos con objetivo en total;7/)
  // La fila de Aceite: proveedor, sucursal, producto con variante, SKU, código, disponible, pedido, camino, borrador, umbral, objetivo, sugerida, costo, valor.
  assert.match(csv, /Distribuidora Norte;Principal;Aceite · 1 L;ACE-1;7501;2;100;0;0;150;1002;900;1250\.50;1125450\.00/)
  // Sal: sin costo conocido → costo y valor vacíos, nunca un cero.
  assert.match(csv, /Distribuidora Norte;Principal;Sal;SAL-1;;0;0;0;0;0;5;5;;$/m)
  // Lo que no tiene proveedor lo dice.
  assert.match(csv, /Sin proveedor;Principal;/)
  // Nada que Excel evalúe: los textos libres que empiezan por = + - @ llevan apóstrofo delante.
  assert.ok(csv.includes("'=HYPERLINK"), 'el producto con fórmula queda neutralizado')
  assert.ok(csv.includes("'+SKU"), 'el SKU con fórmula queda neutralizado')
  assert.ok(!/(^|;)=HYPERLINK/m.test(csv))
  assert.doesNotMatch(csv, /Aviso;/, 'sin corte no hay aviso')
})

test('el CSV de reposición avisa si la lista se cortó, y vacío sale completo', () => {
  const corto = reposicionToCsv([], { alDia: 0, conObjetivo: 0, truncado: true, filtros: [] })
  assert.match(corto, /Aviso;Había más saldos con objetivo de los que caben en este archivo: la lista está cortada\./)
  assert.match(corto, /Productos por reponer;0/)
  assert.match(corto, /Valor sugerido \(con el último costo conocido\);0\.00/)
  assert.match(corto, /^Qué comprar$/m)
  assert.match(corto, /Proveedor;Sucursal;Producto;SKU;Codigo de barras;Disponible;Pedido;En camino;En borrador;Avisar en;Llenar hasta;Sugerida;Ultimo costo;Valor/)
  const sinFiltros = reposicionToCsv([], { alDia: 2, conObjetivo: 2, truncado: false, filtros: [] })
  assert.doesNotMatch(sinFiltros, /Aviso;/)
  assert.match(sinFiltros, /Saldos con objetivo que están al día;2/)
})
