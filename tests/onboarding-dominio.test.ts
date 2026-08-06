/**
 * Onboarding v2 · pruebas del DOMINIO PURO (Fase 1).
 * Ejecutar: npm test
 *
 * Tres propiedades críticas se protegen aquí:
 *   1. IDENTIDAD DE PLACA: "A 123-456", "a123456" y "A123456" normalizan al
 *      mismo valor — es la base del unique y de la detección de duplicados.
 *   2. NIVELES, NO NOMBRES: la asociación vehículo↔membresía se decide por
 *      número, y un plan SIN nivel (los existentes) acepta todo — así los
 *      planes de hoy no cambian de comportamiento (grandfathering).
 *   3. FLUJOS DECLARATIVOS: solo CAR_WASH exige vehículo; un salón jamás
 *      llega a pedir placa. Agregar categorías no rompe el resolutor.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarPlaca,
  validarPlaca,
  validarAnio,
} from '../src/modules/onboarding/vehiculo'
import {
  nivelPermitido,
  evaluarAsociacion,
  nivelDeCompra,
} from '../src/modules/onboarding/niveles'
import {
  FLUJOS_ONBOARDING,
  FLUJO_GENERAL,
  flujoParaCategoria,
  flujoRequiereVehiculo,
  evaluarRequisitos,
} from '../src/modules/onboarding/flujos'
import { CATEGORIAS } from '../src/modules/capacidades/catalogo'

// ── Placa ────────────────────────────────────────────────────────────────────

test('normalizarPlaca: variantes de escritura → misma identidad', () => {
  assert.equal(normalizarPlaca('A 123-456'), 'A123456')
  assert.equal(normalizarPlaca('a123456'), 'A123456')
  assert.equal(normalizarPlaca(' a-123.456 '), 'A123456')
  assert.equal(normalizarPlaca('A123456'), 'A123456')
})

test('normalizarPlaca: entradas vacías o nulas → cadena vacía', () => {
  assert.equal(normalizarPlaca(null), '')
  assert.equal(normalizarPlaca(undefined), '')
  assert.equal(normalizarPlaca('  --- '), '')
})

test('validarPlaca: placa dominicana típica pasa y devuelve la normalizada', () => {
  const r = validarPlaca('a 123456')
  assert.equal(r.ok, true)
  assert.equal(r.normalizada, 'A123456')
})

test('validarPlaca: rechaza vacía, demasiado corta, demasiado larga y sin dígitos', () => {
  assert.equal(validarPlaca('').ok, false)
  assert.equal(validarPlaca('A1').ok, false)
  assert.equal(validarPlaca('A1234567890X').ok, false)
  assert.equal(validarPlaca('ABCDEF').ok, false)
  // Cada rechazo trae un mensaje apto para el cliente.
  assert.ok(validarPlaca('').error && validarPlaca('').error!.length > 0)
})

// ── Año ──────────────────────────────────────────────────────────────────────

test('validarAnio: acepta años razonables, incluido el modelo del año próximo', () => {
  const ahora = new Date('2026-08-06')
  assert.deepEqual(validarAnio('2022', ahora), { ok: true, anio: 2022 })
  assert.equal(validarAnio(2027, ahora).ok, true) // año actual + 1 (modelos nuevos)
  assert.equal(validarAnio('1950', ahora).ok, true)
})

test('validarAnio: rechaza vacío, texto, decimales y fuera de rango', () => {
  const ahora = new Date('2026-08-06')
  assert.equal(validarAnio('', ahora).ok, false)
  assert.equal(validarAnio('hace poco', ahora).ok, false)
  assert.equal(validarAnio('2022.5', ahora).ok, false)
  assert.equal(validarAnio('1949', ahora).ok, false)
  assert.equal(validarAnio('2028', ahora).ok, false) // más allá del margen
})

// ── Niveles tarifarios ───────────────────────────────────────────────────────

test('nivelPermitido: vehículo cabe cuando su nivel <= tope de la membresía', () => {
  assert.equal(nivelPermitido(1, 3), true) // sedán en membresía de SUV
  assert.equal(nivelPermitido(3, 3), true) // SUV en membresía de SUV
  assert.equal(nivelPermitido(3, 1), false) // SUV en membresía de sedán
})

test('nivelPermitido: plan sin nivel (null) acepta cualquier vehículo — planes existentes intactos', () => {
  assert.equal(nivelPermitido(1, null), true)
  assert.equal(nivelPermitido(99, null), true)
})

test('evaluarAsociacion: el rechazo trae opciones, nunca un error mudo', () => {
  const ok = evaluarAsociacion(2, 3)
  assert.deepEqual(ok, { permitido: true })

  const rechazo = evaluarAsociacion(4, 2)
  assert.equal(rechazo.permitido, false)
  if (!rechazo.permitido) {
    assert.equal(rechazo.motivo, 'NIVEL_SUPERIOR')
    assert.ok(rechazo.opciones.includes('ACTUALIZAR_MEMBRESIA'))
    assert.ok(rechazo.opciones.includes('REGISTRAR_SIN_ASOCIAR'))
    assert.ok(rechazo.opciones.length >= 3)
  }
})

test('nivelDeCompra: congela el MAYOR nivel de los vehículos asociados', () => {
  assert.equal(nivelDeCompra([1, 3, 2]), 3)
  assert.equal(nivelDeCompra([2]), 2)
  assert.equal(nivelDeCompra([]), 1) // sin vehículos: nivel base
})

// ── Flujos declarativos ──────────────────────────────────────────────────────

test('flujos: TODAS las categorías del catálogo tienen flujo definido', () => {
  for (const categoria of CATEGORIAS) {
    const flujo = FLUJOS_ONBOARDING[categoria]
    assert.ok(flujo, `falta flujo para ${categoria}`)
    assert.ok(flujo.version >= 1)
    assert.ok(flujo.pasos.length >= 1)
    // Todo flujo arranca por el perfil general.
    assert.equal(flujo.pasos[0].id, 'PERFIL_GENERAL')
  }
})

test('flujos: solo CAR_WASH exige vehículo; un salón jamás pide placa', () => {
  assert.equal(flujoRequiereVehiculo('CAR_WASH'), true)
  assert.equal(flujoRequiereVehiculo('BARBERIA'), false)
  assert.equal(flujoRequiereVehiculo('RESTAURANTE'), false)
  assert.equal(flujoRequiereVehiculo('GYM'), false)
  assert.ok(!FLUJOS_ONBOARDING.BARBERIA.pasos.some((p) => p.id === 'VEHICULO'))
})

test('flujos: el registro general (sin empresa) solo pide el perfil', () => {
  assert.equal(flujoRequiereVehiculo(null), false)
  assert.deepEqual(flujoParaCategoria(null), FLUJO_GENERAL)
  assert.deepEqual(
    FLUJO_GENERAL.pasos.map((p) => p.id),
    ['PERFIL_GENERAL']
  )
})

// ── Contrato del motor de requisitos ─────────────────────────────────────────

test('evaluarRequisitos: sin faltantes → puede continuar, sin redirección', () => {
  assert.deepEqual(evaluarRequisitos([]), {
    canProceed: true,
    missingRequirements: [],
    nextAction: null,
  })
})

test('evaluarRequisitos: con faltantes → bloqueado y redirigido al primero', () => {
  const r = evaluarRequisitos(['VEHICLE_REQUIRED', 'LICENSE_PLATE_REQUIRED'])
  assert.equal(r.canProceed, false)
  assert.deepEqual(r.missingRequirements, ['VEHICLE_REQUIRED', 'LICENSE_PLATE_REQUIRED'])
  assert.equal(r.nextAction, 'START_VEHICLE_ONBOARDING')

  assert.equal(evaluarRequisitos(['PROFILE_REQUIRED']).nextAction, 'START_PROFILE_COMPLETION')
})
