import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estaVigente } from '../src/modules/membresia/vigencia'

/**
 * RENOVAR UNA MEMBRESÍA QUE YA SE ACABÓ.
 *
 * El cliente con la membresía vencida no tenía forma de renovar desde su app:
 * la sección de pago solo se dibujaba en PENDIENTE o RECHAZADA, y el guardia
 * de `seleccionarPlan` lo cortaba con «espera a que venza» mirando solo el
 * estado — que sigue diciendo ACTIVA hasta que el trabajo diario pasa.
 *
 * Estas pruebas fijan la regla que ahora comparten los dos sitios.
 */

const AHORA = new Date('2026-09-03T12:00:00Z')
const ANTES = new Date('2026-08-01T00:00:00Z')
const DESPUES = new Date('2026-10-01T00:00:00Z')

test('una membresía activa con fecha futura está vigente', () => {
  assert.equal(estaVigente({ estado: 'ACTIVA', fechaVencimiento: DESPUES }, AHORA), true)
})

test('una membresía sin fecha de vencimiento es perpetua y está vigente', () => {
  // Si esto se rompiera, los planes perpetuos verían de golpe el aviso de
  // «tu membresía terminó» sin haber terminado nada.
  assert.equal(estaVigente({ estado: 'ACTIVA', fechaVencimiento: null }, AHORA), true)
})

test('una membresía que dice ACTIVA pero cuya fecha pasó NO está vigente', () => {
  // El caso que dejaba al cliente sin poder renovar: el job no la marcó
  // todavía, así que el estado miente y la fecha es la que manda.
  assert.equal(estaVigente({ estado: 'ACTIVA', fechaVencimiento: ANTES }, AHORA), false)
})

test('una membresía marcada VENCIDA o CANCELADA no está vigente', () => {
  for (const estado of ['VENCIDA', 'CANCELADA']) {
    assert.equal(
      estaVigente({ estado, fechaVencimiento: DESPUES }, AHORA),
      false,
      `${estado} con fecha futura tampoco debería contar como vigente`
    )
  }
})

test('los estados de alta sin terminar tampoco cuentan como vigentes', () => {
  for (const estado of ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA']) {
    assert.equal(estaVigente({ estado, fechaVencimiento: DESPUES }, AHORA), false)
  }
})

test('el corte es estricto: vencer justo ahora ya no es vigente', () => {
  assert.equal(estaVigente({ estado: 'ACTIVA', fechaVencimiento: AHORA }, AHORA), false)
})
