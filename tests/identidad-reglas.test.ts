/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 5 · las reglas por función, núcleo puro (sin base de datos).
 *
 * Cada prueba falla si vuelve el defecto que cierra:
 *   · una regla apagada, o con la verificación apagada, frena un pago;
 *   · una regla encendida deja pasar a quien no está verificado (o solo tiene contacto verificado);
 *   · el alcance «primer pago» frena el segundo pago, o «todos» deja de frenarlo;
 *   · una compra, promoción, membresía, renovación o acceso entra en la lista de lo que pide identidad.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALCANCES_DE_REGLA,
  OPERACIONES_CON_REGLA,
  OPERACIONES_SIN_REGLA,
  decidirRequisito,
  esAlcanceDeRegla,
  esOperacionConRegla,
  mensajeDeRequisito,
  operacionConRegla,
  reglaPorDefecto,
  type HechosDelPago,
  type HechosDelRepresentante,
  type ReglaDeIdentidad,
} from '../src/modules/identidad/reglasCore'

const verificado: HechosDelRepresentante = { userId: 'u1', contacto: 'Ana · ana@proveedor.test', estado: 'verificada', nivel: 'documento_selfie' }
const hechos = (p: Partial<HechosDelPago> = {}): HechosDelPago => ({ compuertaAbierta: true, esPrimerPago: true, representante: verificado, ...p })
const regla = (p: Partial<ReglaDeIdentidad> = {}): ReglaDeIdentidad => ({ operacion: 'PAGO_A_PROVEEDOR', activa: true, alcance: 'primer_pago', ...p })

test('DE SERIE NO SE PIDE NADA: sin fila o con la regla apagada, el pago pasa aunque nadie esté verificado', () => {
  const sinVerificar = { userId: null, contacto: null, estado: null, nivel: null }
  assert.deepEqual(decidirRequisito(null, hechos({ representante: sinVerificar })), { aplica: false, razon: 'sin_regla' })
  assert.deepEqual(decidirRequisito(reglaPorDefecto('PAGO_A_PROVEEDOR'), hechos({ representante: sinVerificar })), { aplica: false, razon: 'inactiva' })
  assert.deepEqual(reglaPorDefecto('PAGO_A_PROVEEDOR'), { operacion: 'PAGO_A_PROVEEDOR', activa: false, alcance: 'primer_pago' })
})

test('CON LA VERIFICACIÓN APAGADA las reglas se suspenden: no se le pide a nadie algo que no puede hacer', () => {
  const d = decidirRequisito(regla(), hechos({ compuertaAbierta: false, representante: { userId: 'u1', contacto: null, estado: 'no_verificada', nivel: null } }))
  assert.deepEqual(d, { aplica: false, razon: 'compuerta_cerrada' })
})

test('REGLA ENCENDIDA: solo pasa quien está verificado con documento (o con la vía oficial)', () => {
  assert.deepEqual(decidirRequisito(regla(), hechos()), { aplica: true, cumple: true })
  assert.deepEqual(decidirRequisito(regla(), hechos({ representante: { ...verificado, nivel: 'jce_oficial' } })), { aplica: true, cumple: true })
  const sinVerificar = decidirRequisito(regla(), hechos({ representante: { ...verificado, estado: 'no_verificada', nivel: null } }))
  assert.equal(sinVerificar.aplica && !sinVerificar.cumple && sinVerificar.motivo, 'no_verificada')
  const soloContacto = decidirRequisito(regla(), hechos({ representante: { ...verificado, nivel: 'contacto' } }))
  assert.equal(soloContacto.aplica && !soloContacto.cumple && soloContacto.motivo, 'nivel_insuficiente')
  const sinNivel = decidirRequisito(regla(), hechos({ representante: { ...verificado, nivel: null } }))
  assert.equal(sinNivel.aplica && !sinNivel.cumple && sinNivel.motivo, 'nivel_insuficiente')
  // Vencida, retirada o por revalidar: cada una frena, y cada una se dice con sus palabras.
  for (const [estado, texto] of [
    ['expirada', /vencida/],
    ['revocada', /retirada/],
    ['requiere_revalidacion', /revalidar/],
  ] as const) {
    const d = decidirRequisito(regla(), hechos({ representante: { ...verificado, estado } }))
    assert.ok(d.aplica && !d.cumple && d.motivo === 'no_verificada', estado)
    assert.match(d.aplica && !d.cumple ? d.mensaje : '', texto)
  }
})

test('SIN REPRESENTANTE (nadie aceptó el contrato) frena y dice qué hacer, sin inventar a quién pedírselo', () => {
  const d = decidirRequisito(regla(), hechos({ representante: { userId: null, contacto: null, estado: null, nivel: null } }))
  assert.ok(d.aplica && !d.cumple && d.motivo === 'sin_representante')
  assert.match(d.aplica && !d.cumple ? d.mensaje : '', /no tiene a nadie que haya aceptado su contrato/)
})

test('EL MENSAJE al equipo dice a quién pedírselo y dónde lo hace, y no cuenta nada de cómo salió la verificación', () => {
  const d = decidirRequisito(regla(), hechos({ representante: { ...verificado, estado: 'no_verificada', nivel: null } }))
  const m = d.aplica && !d.cumple ? d.mensaje : ''
  assert.match(m, /Ana · ana@proveedor\.test/)
  assert.match(m, /Verificación de identidad/)
  assert.doesNotMatch(m, /rechaz|duplicad|selfie|c[eé]dula|documento repetido/i)
  assert.match(mensajeDeRequisito('no_verificada', { userId: 'x', contacto: null, estado: null, nivel: null }), /^La persona que aceptó el contrato no ha verificado/)
})

test('ALCANCE «primer pago»: frena solo el primero; «todos» frena cada uno', () => {
  const sinVerificar = { ...verificado, estado: 'no_verificada' as const, nivel: null }
  const primero = decidirRequisito(regla({ alcance: 'primer_pago' }), hechos({ esPrimerPago: true, representante: sinVerificar }))
  assert.ok(primero.aplica && !primero.cumple)
  const segundo = decidirRequisito(regla({ alcance: 'primer_pago' }), hechos({ esPrimerPago: false, representante: sinVerificar }))
  assert.deepEqual(segundo, { aplica: false, razon: 'fuera_de_alcance' })
  const segundoTodos = decidirRequisito(regla({ alcance: 'todos' }), hechos({ esPrimerPago: false, representante: sinVerificar }))
  assert.ok(segundoTodos.aplica && !segundoTodos.cumple)
  // Con «todos», una verificación que se vence o se retira detiene los pagos siguientes.
  const retirada = decidirRequisito(regla({ alcance: 'todos' }), hechos({ esPrimerPago: false, representante: { ...verificado, estado: 'revocada' } }))
  assert.ok(retirada.aplica && !retirada.cumple)
})

test('EL CATÁLOGO: una sola operación con regla hoy, con alcances válidos y explicados; las demás no existen', () => {
  assert.deepEqual(OPERACIONES_CON_REGLA.map((o) => o.clave), ['PAGO_A_PROVEEDOR'])
  const o = operacionConRegla('PAGO_A_PROVEEDOR')
  assert.deepEqual(o.alcances.map((a) => a.valor), [...ALCANCES_DE_REGLA])
  for (const a of o.alcances) assert.ok(a.etiqueta.length > 3 && a.explicacion.length > 20)
  assert.ok(esOperacionConRegla('PAGO_A_PROVEEDOR'))
  for (const x of ['COMPRA_MEMBRESIA', 'pago_a_proveedor', '', null, undefined, 42]) assert.equal(esOperacionConRegla(x), false, String(x))
  assert.ok(esAlcanceDeRegla('todos') && esAlcanceDeRegla('primer_pago'))
  for (const x of ['siempre', 'TODOS', '', null]) assert.equal(esAlcanceDeRegla(x), false, String(x))
})

test('LO QUE NUNCA PIDE IDENTIDAD: compras, reservas, renovaciones, pago con tarjeta, accesos y registro; y no se cruza con lo que sí', () => {
  const nunca = OPERACIONES_SIN_REGLA.map((o) => o.clave)
  for (const clave of ['COMPRA_MEMBRESIA', 'COMPRA_PROMOCION', 'RESERVA', 'RENOVACION', 'PAGO_CON_TARJETA', 'CHECK_IN_QR', 'REGISTRO']) assert.ok(nunca.includes(clave as never), clave)
  const si = OPERACIONES_CON_REGLA.map((o) => o.clave as string)
  assert.deepEqual(nunca.filter((c) => si.includes(c)), [], 'nada puede estar en las dos listas')
  for (const c of nunca) assert.equal(esOperacionConRegla(c), false, c)
  assert.equal(new Set(nunca).size, nunca.length, 'sin repetidos')
})
