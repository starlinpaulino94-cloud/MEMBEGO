/**
 * Modo mantenimiento — pruebas de la DECISIÓN. Ejecutar: npm test
 *
 * POR QUÉ SE PRUEBA ESTO:
 *
 * Este interruptor tiene dos formas de fallar y las dos son caras.
 *
 * Si falla ABIERTO —deja pasar tráfico con el mantenimiento encendido— la
 * restauración se hace sobre una base que sigue recibiendo escrituras, y el
 * resultado es una mezcla de datos que ya no se puede desenredar. Ese es el
 * escenario entero que el modo mantenimiento existe para evitar.
 *
 * Si falla CERRADO —bloquea cuando no debería— tira el sitio. Una variable de
 * entorno que quedó en `"false"`, o vacía, o con un espacio, no puede cerrar
 * MembeGo.
 *
 * Ninguno de los dos fallos se nota en el camino feliz: con la variable
 * apagada todo funciona igual estén bien o mal escritas estas reglas.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidirMantenimiento,
  igualdadConstante,
  mantenimientoEncendido,
  LARGO_MINIMO_PASE,
} from '../src/modules/mantenimiento'

const PASE = 'pase-de-prueba-largo-suficiente'

/** Entrada por defecto: mantenimiento encendido, sin cookie ni parámetro. */
function entrada(extra: Partial<Parameters<typeof decidirMantenimiento>[0]> = {}) {
  return {
    modo: 'true',
    pase: PASE,
    path: '/cliente/inicio',
    cookie: undefined,
    parametro: null,
    ...extra,
  }
}

// ── El interruptor ──────────────────────────────────────────────────────────

test('solo "true" y "1" encienden el mantenimiento', () => {
  assert.equal(mantenimientoEncendido('true'), true)
  assert.equal(mantenimientoEncendido('TRUE'), true)
  assert.equal(mantenimientoEncendido(' true '), true)
  assert.equal(mantenimientoEncendido('1'), true)
})

test('cualquier otro valor deja el sitio ABIERTO', () => {
  // El caso real que importa: en el panel de Vercel se "borra" el valor pero
  // la variable sigue existiendo, vacía. Eso no puede cerrar MembeGo.
  for (const v of [undefined, '', '  ', 'false', '0', 'no', 'si', 'yes', 'on']) {
    assert.equal(mantenimientoEncendido(v), false, `"${v}" no debería encender`)
  }
})

test('apagado, todo pasa', () => {
  assert.equal(decidirMantenimiento(entrada({ modo: 'false' })), 'pasar')
  assert.equal(decidirMantenimiento(entrada({ modo: undefined })), 'pasar')
})

// ── El bloqueo ──────────────────────────────────────────────────────────────

test('encendido y sin pase, se bloquea', () => {
  assert.equal(decidirMantenimiento(entrada()), 'bloquear')
})

test('se bloquean también las rutas de API', () => {
  // Importa: /api/jobs escribe en lote. Si pasara durante una restauración,
  // notificaría a partir de datos que están a medio restaurar.
  assert.equal(decidirMantenimiento(entrada({ path: '/api/jobs' })), 'bloquear')
})

test('/api/health sigue respondiendo', () => {
  // Si el monitor de uptime viera caída cada mantenimiento planificado, en dos
  // meses nadie distinguiría su alerta de una caída real.
  assert.equal(decidirMantenimiento(entrada({ path: '/api/health' })), 'pasar')
})

// ── El pase ─────────────────────────────────────────────────────────────────

test('el pase por URL abre y siembra la cookie', () => {
  assert.equal(decidirMantenimiento(entrada({ parametro: PASE })), 'abrir')
})

test('la cookie del pase deja pasar sin volver a escribirlo', () => {
  assert.equal(decidirMantenimiento(entrada({ cookie: PASE })), 'pasar')
})

test('un pase equivocado no abre nada', () => {
  assert.equal(decidirMantenimiento(entrada({ parametro: 'otra-cosa-larga-igual' })), 'bloquear')
  assert.equal(decidirMantenimiento(entrada({ cookie: 'otra-cosa-larga-igual' })), 'bloquear')
})

test('un prefijo correcto del pase tampoco abre', () => {
  assert.equal(decidirMantenimiento(entrada({ parametro: PASE.slice(0, -1) })), 'bloquear')
})

test('sin MANTENIMIENTO_PASE configurado no hay puerta', () => {
  // Fail-closed: si no hay pase, nadie entra — ni siquiera enviando cadena
  // vacía, que es lo que llega cuando la variable existe pero está en blanco.
  assert.equal(decidirMantenimiento(entrada({ pase: undefined, parametro: '' })), 'bloquear')
  assert.equal(decidirMantenimiento(entrada({ pase: '', cookie: '' })), 'bloquear')
})

test('un pase demasiado corto se ignora', () => {
  // Escenario real: alguien pone `MANTENIMIENTO_PASE=temporal` a las tres de la
  // mañana. Preferimos que no haya puerta a que haya una que se abre a mano.
  const corto = 'a'.repeat(LARGO_MINIMO_PASE - 1)
  assert.equal(decidirMantenimiento(entrada({ pase: corto, parametro: corto })), 'bloquear')

  const justo = 'a'.repeat(LARGO_MINIMO_PASE)
  assert.equal(decidirMantenimiento(entrada({ pase: justo, parametro: justo })), 'abrir')
})

// ── La comparación ──────────────────────────────────────────────────────────

test('la comparación constante distingue lo que tiene que distinguir', () => {
  assert.equal(igualdadConstante('abc', 'abc'), true)
  assert.equal(igualdadConstante('abc', 'abd'), false)
  assert.equal(igualdadConstante('abc', 'ab'), false)
  assert.equal(igualdadConstante('', ''), true)
})
