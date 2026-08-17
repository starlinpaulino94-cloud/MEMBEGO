import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dentroDeVentana,
  resolverVendedorAtribuido,
  sanitizarCanalAtribucion,
  politicaValida,
  type AtribucionHecho,
} from '../src/modules/excursiones/atribucion/nucleo'

/**
 * Excursiones · Fase 4 — la política de atribución decide de quién es una
 * comisión. Es dinero: se prueba pura, sin base de datos, con fechas fijas.
 */

const AHORA = new Date('2026-08-17T12:00:00Z')
const dias = (n: number) => new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000)

const hechos: AtribucionHecho[] = [
  { vendedorId: 'juan', etapa: 'VISITA', createdAt: dias(20) },
  { vendedorId: 'juan', etapa: 'REGISTRO', createdAt: dias(20) },
  { vendedorId: 'ana', etapa: 'VISITA', createdAt: dias(3) },
  { vendedorId: 'ana', etapa: 'RESERVA', createdAt: dias(1) },
]

test('la ventana deja fuera lo caducado y 0 días significa sin caducidad', () => {
  assert.equal(dentroDeVentana(dias(10), 30, AHORA), true)
  assert.equal(dentroDeVentana(dias(40), 30, AHORA), false)
  assert.equal(dentroDeVentana(dias(400), 0, AHORA), true)
  assert.equal(dentroDeVentana(dias(400), Number.NaN, AHORA), true)
})

test('PRIMERA premia a quien lo trajo; ÚLTIMA a quien lo cerró', () => {
  assert.equal(
    resolverVendedorAtribuido(hechos, { politica: 'PRIMERA', ventanaDias: 30, ahora: AHORA }),
    'juan'
  )
  assert.equal(
    resolverVendedorAtribuido(hechos, { politica: 'ULTIMA', ventanaDias: 30, ahora: AHORA }),
    'ana'
  )
})

test('RESERVA se la lleva quien tomó la reserva, y sin reserva cae a la última', () => {
  assert.equal(
    resolverVendedorAtribuido(hechos, { politica: 'RESERVA', ventanaDias: 30, ahora: AHORA }),
    'ana'
  )
  const sinReserva = hechos.filter((h) => h.etapa !== 'RESERVA')
  assert.equal(
    resolverVendedorAtribuido(sinReserva, { politica: 'RESERVA', ventanaDias: 30, ahora: AHORA }),
    'ana' // la última viva, no se queda sin dueño por un tecnicismo
  )
})

test('una ventana corta cambia el dueño: lo viejo ya no cuenta', () => {
  // Con 7 días, la captación de Juan (hace 20) caducó: la venta es de Ana.
  assert.equal(
    resolverVendedorAtribuido(hechos, { politica: 'PRIMERA', ventanaDias: 7, ahora: AHORA }),
    'ana'
  )
  // Con 1 día ya no queda nada vivo salvo la reserva de Ana.
  assert.equal(
    resolverVendedorAtribuido([hechos[0]], { politica: 'PRIMERA', ventanaDias: 7, ahora: AHORA }),
    null
  )
})

test('sin hechos no hay atribución: la comisión no tiene dueño inventado', () => {
  assert.equal(resolverVendedorAtribuido([], { politica: 'PRIMERA', ahora: AHORA }), null)
})

test('el canal y la política solo aceptan lo conocido', () => {
  assert.equal(sanitizarCanalAtribucion('qr'), 'QR')
  assert.equal(sanitizarCanalAtribucion('  whatsapp '), 'WHATSAPP')
  assert.equal(sanitizarCanalAtribucion('telepatía'), 'ENLACE')
  assert.equal(sanitizarCanalAtribucion(null), 'ENLACE')
  assert.equal(politicaValida('ultima'), 'ULTIMA')
  assert.equal(politicaValida('lo-que-sea'), 'PRIMERA')
})
