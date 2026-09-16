/**
 * Todo 14 · validación relajada del vehículo (placa + categoría obligatorias).
 * Ejecutar: npm test
 *
 * La parte pura (`validarVehiculoNuevo`) se ejercita de verdad. Las tres
 * reglas que viven en las server actions con BD (`agregarVehiculoCliente`,
 * `registrarCliente`) no pueden ejecutarse en `npm test` (sin BD ni sesión),
 * así que se protegen como contrato sobre el código: si alguien las mueve o
 * las borra, estos tests fallan.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validarVehiculoNuevo } from '../src/modules/registro/vehiculo-nuevo'

const RAIZ = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8')
const ANIO_ACTUAL = new Date().getFullYear()

// ── Parte pura ─────────────────────────────────────────────────────────────

test('solo placa + categoría ⇒ ok con los cuatro defaults exactos', () => {
  const r = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: 'a 123-456' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.vehiculo.marca, 'Sin marca')
    assert.equal(r.vehiculo.modelo, 'Sin modelo')
    assert.equal(r.vehiculo.anio, ANIO_ACTUAL)
    assert.equal(r.vehiculo.color, 'Sin color')
    assert.equal(r.vehiculo.placaNormalizada, 'A123456')
    assert.equal(r.vehiculo.tipoVehiculoId, 'tv1')
  }
})

test('sin placa ⇒ error (vacía, blancos)', () => {
  for (const placa of ['', '   ']) {
    const r = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /placa/i)
  }
})

test('placa con formato inválido ⇒ error (sin números, corta, larga)', () => {
  for (const placa of ['ABCDEF', 'AB1', 'ABCDEFGHIJK1']) {
    const r = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa })
    assert.equal(r.ok, false, placa)
    if (!r.ok) assert.match(r.error, /placa/i)
  }
})

test('sin categoría ⇒ error (vacía, blancos)', () => {
  for (const tipoVehiculoId of ['', '   ']) {
    const r = validarVehiculoNuevo({ tipoVehiculoId, placa: 'A123456' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /categoría/i)
  }
})

test('año presente pero inválido sigue siendo error; año válido se respeta', () => {
  for (const anioRaw of ['1890', 'abcd', '3000']) {
    const r = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: 'A123456', anioRaw })
    assert.equal(r.ok, false, anioRaw)
  }
  const r = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: 'A123456', anioRaw: '2020' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.vehiculo.anio, 2020)
})

test('entrada malformada no lanza: campos ausentes o no texto ⇒ errores de campo', () => {
  assert.doesNotThrow(() =>
    validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: undefined as never })
  )
  assert.doesNotThrow(() =>
    validarVehiculoNuevo(undefined as never)
  )
  const sinNada = validarVehiculoNuevo(undefined as never)
  assert.equal(sinNada.ok, false)
  const placaNula = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: null as never })
  assert.equal(placaNula.ok, false)
  if (!placaNula.ok) assert.match(placaNula.error, /placa/i)
  // Un número se coerciona a su texto ('123456' es formato válido): se maneja,
  // no se lanza.
  const placaNumero = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: 123456 as never })
  assert.equal(placaNumero.ok, true)
})

test('los valores provistos NO se pisan con los defaults', () => {
  // Teeth: si el validador ignorara la entrada y aplicara siempre los
  // defaults, los tests de «solo placa + categoría» seguirían verdes.
  const r = validarVehiculoNuevo({
    tipoVehiculoId: 'tv1',
    placa: 'a 123-456',
    marca: 'Toyota',
    modelo: 'Corolla',
    color: 'Blanco',
    anioRaw: '2022',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.vehiculo.marca, 'Toyota')
    assert.equal(r.vehiculo.modelo, 'Corolla')
    assert.equal(r.vehiculo.color, 'Blanco')
    assert.equal(r.vehiculo.anio, 2022)
  }
})

test('opcionales vacíos o en blancos (la forma real del FormData) ⇒ defaults exactos', () => {
  // La action siempre manda strings (posiblemente ''), no claves ausentes.
  const r = validarVehiculoNuevo({
    tipoVehiculoId: 'tv1',
    placa: 'A123456',
    marca: '',
    modelo: '   ',
    color: '  ',
    anioRaw: '',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.vehiculo.marca, 'Sin marca')
    assert.equal(r.vehiculo.modelo, 'Sin modelo')
    assert.equal(r.vehiculo.color, 'Sin color')
    assert.equal(r.vehiculo.anio, ANIO_ACTUAL)
  }
})

test('anioRaw numérico se acepta (la interfaz admite string | number)', () => {
  const r = validarVehiculoNuevo({ tipoVehiculoId: 'tv1', placa: 'A123456', anioRaw: 2021 })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.vehiculo.anio, 2021)
})

// ── Contrato sobre las actions con BD (se conservan intactas) ───────────────

const MENSAJE_DUPLICADA = 'Esta placa ya está registrada en otra cuenta'

test('categoría de otra empresa ⇒ error (chequeo acotado a la empresa, intacto)', () => {
  const registro = leer('src/modules/registro/actions.ts')
  assert.match(registro, /companyId: companyIdVerificado, activo: true/)
  assert.match(registro, /ya no está disponible/)
  const portal = leer('src/modules/cliente/vehiculosActions.ts')
  assert.match(portal, /where: \{ id: vehiculo\.tipoVehiculoId, companyId, activo: true \}/)
  assert.match(portal, /ya no está disponible/)
})

test('misma placa del mismo cliente ⇒ devuelve el vehículo existente (idempotencia intacta)', () => {
  const portal = leer('src/modules/cliente/vehiculosActions.ts')
  assert.match(portal, /where: \{ clienteId, pais: vehiculo\.pais, placaNormalizada: vehiculo\.placaNormalizada \}/)
  assert.match(portal, /if \(propio\) return propio/)
})

test('placa de OTRA cuenta ⇒ rechazada (detección cross-cuenta intacta)', () => {
  const registro = leer('src/modules/registro/actions.ts')
  assert.match(registro, /cliente: \{ email: \{ not: email \} \}/)
  assert.ok(registro.includes(MENSAJE_DUPLICADA))
  const portal = leer('src/modules/cliente/vehiculosActions.ts')
  assert.match(portal, /cliente: \{ supabaseId: \{ not: user\.supabaseId \} \}/)
  assert.ok(portal.includes(MENSAJE_DUPLICADA))
})

test('alta del portal es una sola pantalla y autoselecciona la única categoría', () => {
  const wizard = leer('src/components/cliente/AgregarVehiculoWizard.tsx')

  assert.doesNotMatch(wizard, /Paso \{idx \+ 1\}|const PASOS|setIdx/)
  assert.match(wizard, /<form action=\{dispatch\}/)
  assert.match(wizard, /defaultChecked=\{tiposVehiculo\.length === 1\}/)
})

// ── Orden de las guardias con BD ────────────────────────────────────────────
//
// Casos 5/6/7 de la matriz: la categoría ajena, la idempotencia misma-placa y
// la placa de otra cuenta viven en las server actions, que necesitan BD y
// sesión (imposibles en `npm test`). Los tests de arriba comprueban que cada
// guardia EXISTE; estos comprueban que corre ANTES del `create`. Si una se
// desplaza detrás, la fila se duplica aunque su texto siga en el archivo.

test('las guardias de la BD corren ANTES de crear el vehículo', () => {
  const portal = leer('src/modules/cliente/vehiculosActions.ts')
  const iTipo = portal.indexOf('if (!tipoValido) return null')
  const iPropio = portal.indexOf('if (propio) return propio')
  const iAjena = portal.indexOf('if (placaAjena)')
  const iCreate = portal.indexOf('tx.vehiculo.create(')
  assert.ok(iTipo >= 0, 'desapareció la guardia de categoría de la empresa')
  assert.ok(iPropio >= 0, 'desapareció la idempotencia por placa del mismo cliente')
  assert.ok(iAjena >= 0, 'desapareció el rechazo de placa de otra cuenta')
  assert.ok(iCreate >= 0, 'desapareció el alta del vehículo')
  assert.ok(iTipo < iCreate, 'la categoría se comprueba después de crear')
  assert.ok(iPropio < iCreate, 'la idempotencia corre después de crear: duplicaría la placa')
  assert.ok(iAjena < iCreate, 'la placa ajena se comprueba después de crear: duplicaría la placa')

  const registro = leer('src/modules/registro/actions.ts')
  const iAjenaReg = registro.indexOf('if (placaAjena)')
  const iCreateReg = registro.indexOf('vehiculo.create(')
  assert.ok(iAjenaReg >= 0, 'el registro perdió el rechazo de placa de otra cuenta')
  assert.ok(iCreateReg >= 0, 'el registro perdió el alta del vehículo')
  assert.ok(
    iAjenaReg < iCreateReg,
    'en el registro la placa ajena se comprueba después de crear'
  )
})
