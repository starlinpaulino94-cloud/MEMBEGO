import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarRaiz,
  normalizarCondicion,
  resolverRadios,
  contarCondiciones,
  esRaizVacia,
  PROFUNDIDAD_MAXIMA,
  type SegmentoRaiz,
} from '../src/modules/geo/segmentacion/arbol'
import { predicadoDeNodo, predicadoConsentimiento } from '../src/modules/geo/segmentacion/sql'
import {
  CAMPOS_POR_NOMBRE,
  etiquetaOperador,
  VALORES_MEMBRESIA,
  RADIO_MAX_KM,
  type CampoDefinicion,
} from '../src/modules/geo/segmentacion/campos'

/**
 * Núcleo puro del constructor de segmentos (docs/GEOLOCALIZACION.md §10):
 * el catálogo de campos, la validación del árbol y el builder SQL que el
 * AudienceEstimator usa para contar. Sin base de datos: son funciones puras.
 */

// ─── Catálogo ─────────────────────────────────────────────────────────────────

test('el catálogo expone todos los campos de la especificación §10.2', () => {
  const campos: CampoDefinicion[] = [...CAMPOS_POR_NOMBRE.values()]
  const nombres = campos.map((c) => c.campo)
  for (const esperado of [
    'cliente.cityId',
    'cliente.sectorId',
    'cliente.distanciaSucursalKm',
    'cliente.esLocal',
    'cliente.createdAt',
    'cliente.ultimaVisitaDias',
    'cliente.membresia.estado',
    'cliente.vehiculo.tipoVehiculoId',
    'cliente.cumpleMes',
  ]) {
    assert.ok(nombres.includes(esperado), `falta ${esperado}`)
  }
})

test('cada campo declara solo operadores coherentes con su tipo', () => {
  const radio = CAMPOS_POR_NOMBRE.get('cliente.distanciaSucursalKm')!
  assert.deepEqual(radio.operadores, ['lte'])
  const bool = CAMPOS_POR_NOMBRE.get('cliente.esLocal')!
  assert.deepEqual(bool.operadores, ['es_true', 'es_falso'])
  const mes = CAMPOS_POR_NOMBRE.get('cliente.cumpleMes')!
  assert.ok(mes.operadores.includes('eq'))
  assert.ok(!mes.operadores.includes('in'), 'mes no admite lista')
})

test('etiquetas de operador en lenguaje natural', () => {
  assert.equal(etiquetaOperador('eq'), 'es')
  assert.equal(etiquetaOperador('not_in'), 'no es ninguno de')
  assert.equal(etiquetaOperador('gte'), 'al menos')
})

test('los valores de membresía segmentables son un conjunto cerrado', () => {
  assert.ok(VALORES_MEMBRESIA.includes('ACTIVA'))
  assert.ok(VALORES_MEMBRESIA.includes('SIN_ACTIVA'))
})

// ─── Validación estructural ───────────────────────────────────────────────────

test('normalizarRaiz acepta un árbol simple de ciudad + sector', () => {
  const raiz: SegmentoRaiz = {
    operador: 'AND',
    condiciones: [
      { campo: 'cliente.cityId', operador: 'eq', valor: 'ciudad-1' },
      { campo: 'cliente.sectorId', operador: 'in', valor: ['s1', 's2'] },
    ],
    grupos: [],
  }
  const nodo = normalizarRaiz(raiz)
  assert.equal(nodo.tipo, 'grupo')
  assert.equal(contarCondiciones(nodo), 2)
})

test('rechaza campo desconocido', () => {
  assert.throws(
    () =>
      normalizarCondicion({ campo: 'cliente.moneda', operador: 'eq', valor: 'DOP' }),
    /Campo de segmentación desconocido/
  )
})

test('rechaza operador no permitido para el campo', () => {
  assert.throws(
    () =>
      normalizarCondicion({
        campo: 'cliente.cumpleMes',
        operador: 'in',
        valor: ['1', '2'],
      }),
    /no está disponible/
  )
})

test('rechaza radio fuera de rango y sin sucursal', () => {
  assert.throws(
    () =>
      normalizarCondicion({
        campo: 'cliente.distanciaSucursalKm',
        operador: 'lte',
        valor: { sucursalId: 's1', km: RADIO_MAX_KM + 1 },
      }),
    /radio/
  )
  assert.throws(
    () =>
      normalizarCondicion({
        campo: 'cliente.distanciaSucursalKm',
        operador: 'lte',
        valor: { sucursalId: 's1' },
      }),
    /sucursalId y km/
  )
})

test('rechaza valor de lista vacía para in', () => {
  assert.throws(
    () =>
      normalizarCondicion({
        campo: 'cliente.cityId',
        operador: 'in',
        valor: [],
      }),
    /Elige al menos una opción/
  )
})

test('rechaza estado de membresía inventado', () => {
  assert.throws(
    () =>
      normalizarCondicion({
        campo: 'cliente.membresia.estado',
        operador: 'eq',
        valor: 'MEJOR_VIP',
      }),
    /Estado de membresía inválido/
  )
})

test('rechaza grupos vacíos y profundidad excesiva', () => {
  assert.throws(
    () =>
      normalizarRaiz({
        operador: 'AND',
        condiciones: [],
        grupos: [{ operador: 'OR', condiciones: [], grupos: [] }],
      }),
    /no puede estar vacío/
  )
  let profundo: SegmentoRaiz = {
    operador: 'AND',
    condiciones: [],
    grupos: [],
  }
  for (let i = 0; i <= PROFUNDIDAD_MAXIMA; i++) {
    profundo = {
      operador: 'AND',
      condiciones: [],
      grupos: [profundo],
    }
  }
  assert.throws(() => normalizarRaiz(profundo), /profundidad máxima/)
})

test('esRaizVacia detecta un segmento sin condiciones', () => {
  assert.ok(esRaizVacia({ operador: 'AND', condiciones: [], grupos: [] }))
  assert.ok(!esRaizVacia({ operador: 'AND', condiciones: [{ campo: 'x', operador: 'eq', valor: 1 }], grupos: [] }))
})

// ─── Builder SQL ──────────────────────────────────────────────────────────────

test('el SQL usa parámetros, nunca valores interpolados', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [{ campo: 'cliente.cityId', operador: 'eq', valor: 'ciudad-1' }],
    grupos: [],
  })
  const { sql, params } = predicadoDeNodo(nodo)
  assert.ok(sql.includes('$1'))
  assert.ok(!sql.includes('ciudad-1'))
  assert.deepEqual(params, ['ciudad-1'])
})

test('ciudad in genera EXISTS con ANY', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [{ campo: 'cliente.cityId', operador: 'in', valor: ['a', 'b'] }],
    grupos: [],
  })
  const { sql } = predicadoDeNodo(nodo)
  assert.ok(sql.includes('cl.isPrimary'))
  assert.ok(sql.includes('cl.cityId = ANY($1)'))
})

test('ciudad not_in se construye como negación de la positiva', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [{ campo: 'cliente.cityId', operador: 'not_in', valor: ['a'] }],
    grupos: [],
  })
  const { sql } = predicadoDeNodo(nodo)
  assert.ok(sql.includes('NOT (EXISTS'))
})

test('membresía SIN_ACTIVA se traduce a no-existe activa', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [{ campo: 'cliente.membresia.estado', operador: 'eq', valor: 'SIN_ACTIVA' }],
    grupos: [],
  })
  const { sql } = predicadoDeNodo(nodo)
  assert.ok(sql.includes("m.estado = 'ACTIVA'"))
  assert.ok(!sql.includes('ANY'), 'sin estados, no hay ANY')
})

test('grupos AND/OR/NOT producen paréntesis y negación del AND', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [],
    grupos: [
      {
        operador: 'NOT',
        condiciones: [{ campo: 'cliente.esLocal', operador: 'es_true', valor: true }],
        grupos: [],
      },
      {
        operador: 'OR',
        condiciones: [{ campo: 'cliente.cumpleMes', operador: 'eq', valor: 6 }],
        grupos: [],
      },
    ],
  })
  const { sql } = predicadoDeNodo(nodo)
  assert.ok(sql.includes('NOT (c.esLocal = $1)'))
  assert.ok(sql.includes('EXTRACT(MONTH FROM c.fechaNacimiento) = $2'))
})

test('el predicado de consentimiento exige MARKETING_GEO activo', () => {
  const p = predicadoConsentimiento()
  assert.ok(p.sql.includes("gc.tipo = 'MARKETING_GEO'"))
  assert.ok(p.sql.includes("gc.estado = 'ACTIVE'"))
})

test('segmento sin condiciones produce predicado vacío', () => {
  const { sql } = predicadoDeNodo(normalizarRaiz({ operador: 'AND', condiciones: [], grupos: [] }))
  assert.equal(sql, '')
})

test('resolverRadios inyecta coordenadas y valida la sucursal', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [
      { campo: 'cliente.distanciaSucursalKm', operador: 'lte', valor: { sucursalId: 's1', km: 3 } },
    ],
    grupos: [],
  })
  const resuelto = resolverRadios(nodo, new Map([['s1', { latitud: 18.48, longitud: -69.93 }]]))
  assert.deepEqual(resuelto, {
    tipo: 'grupo',
    operador: 'AND',
    hijos: [
      {
        tipo: 'condicion',
        cond: { campo: 'cliente.distanciaSucursalKm', operador: 'lte', valor: { latitud: 18.48, longitud: -69.93, km: 3 } },
      },
    ],
  })
  assert.throws(
    () => resolverRadios(nodo, new Map()),
    /no existe en esta empresa/
  )
})

test('el SQL del radio usa haversine con la coordenada resuelta', () => {
  const nodo = normalizarRaiz({
    operador: 'AND',
    condiciones: [
      { campo: 'cliente.distanciaSucursalKm', operador: 'lte', valor: { sucursalId: 's1', km: 5 } },
    ],
    grupos: [],
  })
  const resuelto = resolverRadios(nodo, new Map([['s1', { latitud: 18.48, longitud: -69.93 }]]))
  const { sql, params } = predicadoDeNodo(resuelto)
  assert.ok(sql.includes('6371000 * acos'))
  assert.deepEqual(params, [18.48, -69.93, 5])
})
