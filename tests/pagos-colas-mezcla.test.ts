import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  COLAS,
  colaInicial,
  cortarSucursal,
  descuentoDeBienvenidaVigente,
  diasDesde,
  esImagen,
  montoEsperado,
  unirSeguimiento,
  waLink,
  ventanaDe,
  type Cola,
} from '../src/modules/pagos/colasMezcla'

/**
 * PAGOS NO CAMBIA DE RESULTADO AL PARTIRSE EN PIEZAS (auditoría admin · fase 5, tarea 5.2).
 *
 * Pagos mueve dinero, así que la prueba de que el movimiento de código no cambió nada es comparar. Aquí van, escritas aparte y
 * tal como estaban en `pagos/page.tsx` (1 049 líneas), las reglas originales —monto esperado, recorte de las colas mixtas,
 * seguimiento unificado, días, WhatsApp— y se comparan con las funciones extraídas sobre cientos de entradas generadas. Si una
 * sola difiere, el movimiento no fue limpio.
 */

// ── La lógica ORIGINAL, copiada de la página tal como estaba ───────────────────────────────────────────────────────

const originalMonto = (precio: unknown, desc: unknown, fechaInicio: Date | null) =>
  Math.max(0, Number(precio) - (fechaInicio == null ? Number(desc ?? 0) : 0))

const originalDias = (d: Date, ahora: number) => Math.max(0, Math.floor((ahora - d.getTime()) / 86_400_000))

function originalWaLink(telefono: string | null) {
  if (!telefono) return null
  let digits = telefono.replace(/\D/g, '')
  if (digits.length === 10 && !digits.startsWith('1')) digits = `1${digits}`
  return digits.length >= 10 ? `https://wa.me/${digits}` : null
}

const originalIsImage = (url: string) => /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url)

function originalCortarSucursal<M, C>(
  sucursalMembresias: M[],
  sucursalCompras: C[],
  totalSucursalMembresias: number,
  pagSuc: { saltar: number; tomar: number }
) {
  const enSucursal = sucursalMembresias.slice(pagSuc.saltar, pagSuc.saltar + pagSuc.tomar)
  const restoVentana = Math.max(0, pagSuc.tomar - enSucursal.length)
  const saltarCompras = Math.max(0, pagSuc.saltar - totalSucursalMembresias)
  const enSucursalCompras = sucursalCompras.slice(saltarCompras, saltarCompras + restoVentana)
  return { enSucursal, enSucursalCompras }
}

// ── Generador determinista de entradas ─────────────────────────────────────────────────────────────────────────────

function lcg(semilla: number) {
  let s = semilla >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000)
}
const azar = lcg(20261021)
const entero = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1))
const elige = <T,>(xs: readonly T[]): T => xs[entero(0, xs.length - 1)]!

const CLIENTE = { nombre: 'Ana', email: 'ana@x.do', telefono: '809-555-0101', company: { name: 'CARTOWN' } }

// ── Equivalencias ──────────────────────────────────────────────────────────────────────────────────────────────────

test('el monto esperado es el de la página original, con y sin descuento, activada o no', () => {
  for (let i = 0; i < 400; i++) {
    const precio = elige([0, 99, 1200.5, '1500', 7777.77])
    const desc = elige([null, undefined, 0, 100, '250', 5000, 2000])
    const inicio = elige([null, new Date('2026-09-01T00:00:00Z')])
    assert.equal(montoEsperado(precio, desc, inicio), originalMonto(precio, desc, inicio), `${precio}/${desc}/${inicio}`)
    assert.equal(descuentoDeBienvenidaVigente(desc, inicio), inicio == null ? Number(desc ?? 0) : 0)
  }
  // El caso que justifica la regla: un descuento mayor que el precio nunca da un monto negativo.
  assert.equal(montoEsperado(100, 500, null), 0)
  // Una membresía ya activada no recibe el descuento congelado.
  assert.equal(montoEsperado(1000, 300, new Date()), 1000)
})

test('el recorte de «En sucursal» (membresías primero, luego compras) es el mismo en cualquier página', () => {
  for (let i = 0; i < 500; i++) {
    const totalM = entero(0, 60)
    const totalC = entero(0, 60)
    const tomar = elige([25, 50])
    const saltar = tomar * entero(0, 5)
    // Cada lista llega con hasta el FINAL de la ventana visible (saltar + tomar), como en la consulta.
    const ventana = saltar + tomar
    const membresias = Array.from({ length: Math.min(totalM, ventana) }, (_, k) => `m${k}`)
    const compras = Array.from({ length: Math.min(totalC, ventana) }, (_, k) => `c${k}`)
    const nuevo = cortarSucursal(membresias, compras, totalM, { saltar, tomar })
    const viejo = originalCortarSucursal(membresias, compras, totalM, { saltar, tomar })
    assert.deepEqual(nuevo.membresias, viejo.enSucursal)
    assert.deepEqual(nuevo.compras, viejo.enSucursalCompras)
    assert.ok(nuevo.membresias.length + nuevo.compras.length <= tomar, 'nunca más de una página')
  }
})

test('numeradas como una sola lista, páginas consecutivas no repiten ni saltan filas', () => {
  const totalM = 30
  const totalC = 30
  const todas: string[] = []
  for (let pagina = 0; pagina < 3; pagina++) {
    const saltar = pagina * 25
    const ventana = saltar + 25
    const membresias = Array.from({ length: Math.min(totalM, ventana) }, (_, k) => `m${k}`)
    const compras = Array.from({ length: Math.min(totalC, ventana) }, (_, k) => `c${k}`)
    const { membresias: m, compras: c } = cortarSucursal(membresias, compras, totalM, { saltar, tomar: 25 })
    todas.push(...m, ...c)
  }
  assert.equal(todas.length, 60)
  assert.equal(new Set(todas).size, 60, 'ninguna fila repetida')
})

test('el seguimiento unificado (membresías + compras, los más antiguos primero) es el de la página original', () => {
  const estadosM = ['RECHAZADA', 'PENDIENTE_PAGO', 'PENDIENTE'] as const
  const estadosC = ['RECHAZADA', 'PENDIENTE_PAGO', 'PENDIENTE'] as const
  for (let i = 0; i < 200; i++) {
    const base = new Date('2026-10-01T00:00:00Z').getTime()
    const membresias = Array.from({ length: entero(0, 12) }, (_, k) => ({
      id: `m${k}`,
      estado: elige(estadosM),
      clienteId: `cli${k}`,
      updatedAt: new Date(base + entero(0, 20 * 86_400_000)),
      descuentoBienvenida: elige([null, 100, '50']),
      fechaInicio: elige([null, new Date('2026-09-01T00:00:00Z')]),
      rechazadoReason: elige([null, 'Comprobante ilegible']),
      metodoPago: elige([null, { tipo: 'TRANSFERENCIA' }, { tipo: 'EFECTIVO' }]),
      cliente: CLIENTE,
      plan: { nombre: `Plan ${k}`, precio: elige([500, '900', 1200]) },
    }))
    const compras = Array.from({ length: entero(0, 12) }, (_, k) => ({
      id: `c${k}`,
      estado: elige(estadosC),
      clienteId: `cli${100 + k}`,
      updatedAt: new Date(base + entero(0, 20 * 86_400_000)),
      precioCongelado: elige([null, 300, '450']),
      rechazadoReason: elige([null, 'Monto distinto']),
      cliente: CLIENTE,
      promocion: elige([null, { titulo: `Promo ${k}`, precio: 250 }]),
    }))
    const pag = { saltar: elige([0, 5, 10]), tomar: elige([5, 25]) }

    // Original: mapeo + orden por fecha + corte.
    const original = [
      ...membresias.map((m) => ({
        key: `m-${m.id}`, clienteId: m.clienteId, cliente: m.cliente, concepto: `Plan ${m.plan.nombre}`,
        monto: Math.max(0, Number(m.plan.precio) - (m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0)),
        situacion: m.estado === 'RECHAZADA'
          ? `Pago rechazado sin reintento${m.rechazadoReason ? ` (${m.rechazadoReason})` : ''}`
          : m.metodoPago?.tipo === 'TRANSFERENCIA' ? 'Eligió transferencia y no ha enviado el comprobante' : 'Solicitó el plan y no ha completado el pago',
        fecha: m.updatedAt,
      })),
      ...compras.map((c) => ({
        key: `c-${c.id}`, clienteId: c.clienteId, cliente: c.cliente, concepto: `Promoción ${c.promocion?.titulo ?? '—'}`,
        monto: Number(c.precioCongelado ?? c.promocion?.precio ?? 0),
        situacion: c.estado === 'RECHAZADA'
          ? `Pago rechazado sin reintento${c.rechazadoReason ? ` (${c.rechazadoReason})` : ''}`
          : c.estado === 'PENDIENTE_PAGO' ? 'Eligió transferencia y no ha enviado el comprobante' : 'Solicitó la promoción y no ha completado el pago',
        fecha: c.updatedAt,
      })),
    ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).slice(pag.saltar, pag.saltar + pag.tomar)

    assert.deepEqual(unirSeguimiento(membresias, compras, pag), original)
  }
})

test('días, WhatsApp e imagen se comportan como en la página original', () => {
  const ahora = new Date('2026-10-21T12:00:00Z').getTime()
  for (const fecha of ['2026-10-21T11:00:00Z', '2026-10-20T00:00:00Z', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z']) {
    assert.equal(diasDesde(new Date(fecha), ahora), originalDias(new Date(fecha), ahora), fecha)
  }
  for (const tel of [null, '', '809-555-0101', '8095550101', '18095550101', '(809) 555 0101', '555', '+1 809 555 0101']) {
    assert.equal(waLink(tel), originalWaLink(tel), String(tel))
  }
  for (const url of ['a.jpg', 'a.JPEG?x=1', 'a.pdf', 'a.png', 'https://x/y.webp?t=2', 'a.gif#', 'sin-extension']) {
    assert.equal(esImagen(url), originalIsImage(url), url)
  }
})

// ── La cola en la que abre Pagos (prototipo aprobado, decisión 3) ───────────────────────────────────────────────────

const conteos = (p: Partial<Record<Cola, number>>) =>
  Object.fromEntries(COLAS.map((c) => [c.clave, p[c.clave] ?? 0])) as Record<Cola, number>

test('una cola pedida en la URL se respeta aunque esté vacía', () => {
  assert.equal(colaInicial('cambios', conteos({ transferencias: 5 })), 'cambios')
  assert.equal(colaInicial('seguimiento', conteos({})), 'seguimiento')
})

test('sin cola en la URL abre en la primera con trabajo: transferencias, sucursal, compras, cambios', () => {
  assert.equal(colaInicial(undefined, conteos({ transferencias: 2, sucursal: 9 })), 'transferencias')
  assert.equal(colaInicial(undefined, conteos({ sucursal: 1, compras: 4 })), 'sucursal')
  assert.equal(colaInicial(undefined, conteos({ compras: 1, cambios: 3 })), 'compras')
  assert.equal(colaInicial(undefined, conteos({ cambios: 3 })), 'cambios')
})

test('con la cola inválida o sin trabajo en ninguna, abre en «En sucursal» como siempre', () => {
  assert.equal(colaInicial('inventada', conteos({})), 'sucursal')
  assert.equal(colaInicial(undefined, conteos({})), 'sucursal')
  // El seguimiento no es trabajo por validar: no decide dónde se abre.
  assert.equal(colaInicial(undefined, conteos({ seguimiento: 40 })), 'sucursal')
})

test('la ventana de una cola mixta crece con la página pedida, no con el tamaño de la cola', () => {
  assert.equal(ventanaDe({ saltar: 0, tomar: 25 }), 25)
  assert.equal(ventanaDe({ saltar: 50, tomar: 25 }), 75)
})

// ── La forma: sin archivos de 1 000 líneas, y la página no consulta por su cuenta ───────────────────────────────────

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const lineas = (ruta: string) => readFileSync(ruta, 'utf8').split('\n').length

test('Pagos queda en archivos de menos de 300 líneas (criterio de la fase 5)', () => {
  assert.ok(lineas('src/app/(admin)/admin/pagos/page.tsx') <= 300)
  for (const f of readdirSync('src/components/admin/pagos')) assert.ok(lineas(join('src/components/admin/pagos', f)) <= 300, f)
  for (const f of ['colasLectura.ts', 'colasMezcla.ts']) assert.ok(lineas(join('src/modules/pagos', f)) <= 300, f)
})

test('la página de Pagos no escribe consultas: lee con `leerCola` y cuenta con `contarColasDePago`', () => {
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/pagos/page.tsx', 'utf8'))
  assert.doesNotMatch(pagina, /tx\.(membership|productoCompra)|\.findMany\(|\.count\(/, 'ninguna consulta suelta en la página')
  assert.match(pagina, /leerCola\(tx, companyId, cola, paginaciones\)/)
  assert.match(pagina, /contarColasDePago\(companyId\)/)
})

test('cada consulta de cola usa el `where` de `colas.ts`, que es el único criterio de qué es cada cola', () => {
  const lectura = sinComentarios(readFileSync('src/modules/pagos/colasLectura.ts', 'utf8'))
  for (const w of [
    'whereTransferencias(companyId)',
    'whereCambiosDePlan(companyId)',
    'whereComprasEnValidacion(companyId)',
    'whereMembresiasEnSucursal(companyId)',
    'whereComprasEnSucursal(companyId)',
    'whereMembresiasSinCompletar(companyId)',
    'whereComprasSinCompletar(companyId)',
  ]) {
    assert.ok(lectura.includes(w), `falta ${w}`)
  }
  // Y ninguna condición de estado escrita a mano.
  assert.doesNotMatch(lectura, /estado:\s*'(PENDIENTE_PAGO|PENDIENTE|EN_VALIDACION|ACTIVA)'/)
})

test('las acciones de dinero son los botones de siempre, en la cola que les toca', () => {
  const leer = (f: string) => sinComentarios(readFileSync(join('src/components/admin/pagos', f), 'utf8'))
  const transf = leer('TarjetaPagoPendiente.tsx')
  for (const b of ['ConfirmarPagoButton', 'RechazarPagoButton', 'SolicitarEvidenciaButton', 'NotaInternaForm']) assert.match(transf, new RegExp(`<${b} `), b)
  const suc = leer('TarjetasSucursal.tsx')
  for (const b of ['ConfirmarPagoButton', 'RechazarPagoButton', 'AprobarCompraButton', 'RechazarCompraButton']) assert.match(suc, new RegExp(`<${b} `), b)
  const cc = leer('TarjetasCompraYCambio.tsx')
  for (const b of ['AprobarCompraButton', 'RechazarCompraButton', 'AprobarCambioButton', 'RechazarCambioButton']) assert.match(cc, new RegExp(`<${b} `), b)
  // Cada acción apunta al id de SU fila.
  assert.match(transf, /<ConfirmarPagoButton membershipId=\{m\.id\} \/>/)
  assert.match(cc, /<AprobarCambioButton membershipId=\{c\.id\} \/>/)
  assert.match(cc, /<AprobarCompraButton compraId=\{c\.id\} \/>/)
})
