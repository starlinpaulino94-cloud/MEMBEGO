import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoUi, type DominioEstado } from '../src/lib/estados'
import { TONOS_ESTADO } from '../packages/ui/src/ui/estado-chip'

/**
 * `estadoUi(dominio, estado)` — EL contrato único «estado → etiqueta y tono» (docs/auditoria-admin/07 · FE-03, fase 4 · 4.5).
 *
 * Hay 54 mapas de estado repartidos por el código. Este es el destino de todos: la pantalla pide el estado de su dominio y
 * recibe qué decir y de qué tono, y SOLO pinta. Lo que se comprueba aquí es lo que no puede cambiar sin que alguien lo decida:
 * la regla de color de `docs/GUIA_LENGUAJE_MEMBEGO.md` (verde = activo/listo, ámbar = requiere acción, rojo = SOLO error o
 * rechazo, gris = terminado).
 */

const DOMINIOS: readonly DominioEstado[] = ['membresia', 'campana', 'referido']

test('las membresías dicen lo mismo que decían y con el tono de la guía de lenguaje', () => {
  assert.deepEqual(estadoUi('membresia', 'ACTIVA'), { label: 'Activa', tono: 'exito' })
  assert.deepEqual(estadoUi('membresia', 'PENDIENTE_PAGO'), { label: 'En validación', tono: 'info' })
  assert.deepEqual(estadoUi('membresia', 'PENDIENTE'), { label: 'Pendiente de pago', tono: 'aviso' })
  assert.deepEqual(estadoUi('membresia', 'VENCIDA'), { label: 'Vencida', tono: 'neutro' }, 'vencer no es un error: gris')
  assert.deepEqual(estadoUi('membresia', 'RECHAZADA'), { label: 'Rechazada', tono: 'peligro' }, 'rechazar sí: rojo')
})

test('el cliente final lee «Finalizada» donde el panel dice «Cancelada»', () => {
  assert.equal(estadoUi('membresia', 'CANCELADA').label, 'Cancelada')
  assert.equal(estadoUi('membresia', 'CANCELADA', { cliente: true }).label, 'Finalizada')
  assert.equal(estadoUi('referido', 'COMPLETADO', { cliente: true }).label, 'Ya se registró')
  assert.equal(estadoUi('referido', 'COMPLETADO').label, 'Convertido')
})

test('campañas: activa en verde, finalizada en gris (es un fin normal, no un error)', () => {
  assert.equal(estadoUi('campana', 'ACTIVA').tono, 'exito')
  assert.equal(estadoUi('campana', 'FINALIZADA').tono, 'neutro')
  assert.equal(estadoUi('campana', 'PAUSADA').tono, 'aviso')
  assert.equal(estadoUi('campana', 'BORRADOR').tono, 'neutro')
})

test('un estado que el dominio no conoce se muestra con su texto y tono neutro, nunca en blanco', () => {
  for (const d of DOMINIOS) {
    const r = estadoUi(d, 'ESTADO_NUEVO_DE_LA_BASE')
    assert.equal(r.label, 'ESTADO_NUEVO_DE_LA_BASE')
    assert.equal(r.tono, 'neutro', `${d}: un color que prometa algo para un estado desconocido sería mentir`)
  }
})

test('todos los dominios devuelven un tono que el EstadoChip sabe pintar', () => {
  const muestras: Record<DominioEstado, string[]> = {
    membresia: ['PENDIENTE', 'PENDIENTE_PAGO', 'ACTIVA', 'VENCIDA', 'RECHAZADA', 'CANCELADA'],
    campana: ['BORRADOR', 'ACTIVA', 'PAUSADA', 'FINALIZADA'],
    referido: ['PENDIENTE', 'COMPLETADO'],
  }
  for (const d of DOMINIOS) {
    for (const e of muestras[d]) {
      const { label, tono } = estadoUi(d, e)
      assert.ok(label.length > 0, `${d}/${e} sin etiqueta`)
      assert.ok(TONOS_ESTADO.includes(tono), `${d}/${e}: «${tono}» no es un tono del chip`)
    }
  }
})
