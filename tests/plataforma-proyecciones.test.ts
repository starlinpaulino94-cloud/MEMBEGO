import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROYECCIONES,
  camposPermitidos,
  entidadesProyectables,
  eventosDeSincronizacion,
  proyeccionDe,
  puedeDecidirLocalmente,
} from '../src/modules/plataforma/proyecciones'

/**
 * PROYECCIONES LOCALES · SHARED DATA CONTRACTS, NO SHARED DATABASE.
 *
 * Cada vertical tiene su base. Para que la experiencia se comporte como una
 * plataforma integrada, mantiene copias locales de los datos compartidos,
 * alimentadas por eventos.
 *
 * La regla que estas pruebas defienden: una proyección es una CACHÉ, nunca una
 * AUTORIDAD. Se lee para pintar; no se lee para decidir.
 *
 * No es purismo. Una copia puede estar desfasada por un webhook en cola. Un
 * nombre desfasado se ve raro; un canje decidido sobre una membresía desfasada
 * regala un beneficio ya consumido, cuesta dinero y no deja rastro de por qué.
 */

test('ninguna entidad del Core admite decisión local', () => {
  for (const p of PROYECCIONES) {
    if (p.autoridad !== 'CORE') continue
    assert.equal(
      puedeDecidirLocalmente(p.entidad),
      false,
      `"${p.entidad}" es del Core: su copia local no puede decidir nada`
    )
  }
})

test('la elegibilidad de beneficios NO se proyecta', () => {
  // Es la prueba más importante del archivo. Si algún día alguien le pone
  // `refresco: 'EVENTO'` para "que vaya más rápido", el sistema empieza a
  // autorizar canjes con datos viejos.
  const eleg = proyeccionDe('BenefitEligibility')
  assert.ok(eleg, 'falta el contrato de BenefitEligibility')
  assert.equal(eleg!.refresco, 'CONSULTA', 'la elegibilidad se consulta, no se copia')
  assert.deepEqual(eleg!.campos, [], 'no debe copiarse ningún campo de elegibilidad')
  assert.ok(!entidadesProyectables().some((p) => p.entidad === 'BenefitEligibility'))
})

test('la membresía se proyecta pero su uso permitido lo dice claro', () => {
  // Sí se copia —hace falta para pintar "cliente con membresía activa"— pero
  // el contrato tiene que decir explícitamente que no autoriza.
  const m = proyeccionDe('MembershipSummary')
  assert.ok(m)
  assert.equal(m!.refresco, 'EVENTO')
  assert.match(m!.usoPermitido, /NUNCA para autorizar|benefits\.evaluate/i)
})

test('toda entidad proyectable declara los eventos que la refrescan', () => {
  // Una proyección sin eventos es una copia que nace desfasada y no se entera.
  for (const p of entidadesProyectables()) {
    assert.ok(
      p.eventos.length > 0,
      `"${p.entidad}" se proyecta pero no declara ningún evento de refresco`
    )
  }
})

test('toda entidad proyectable declara qué campos se copian', () => {
  for (const p of entidadesProyectables()) {
    assert.ok(p.campos.length > 0, `"${p.entidad}" no declara campos: ¿qué se copia?`)
  }
})

test('la proyección de cliente no arrastra datos personales de más', () => {
  // §69, minimización. Un restaurante necesita nombre y contacto para operar;
  // no necesita la dirección, el documento ni las preferencias globales.
  const campos = camposPermitidos('Customer')
  assert.deepEqual([...campos].sort(), ['email', 'id', 'nombre', 'telefono'])
  for (const prohibido of ['direccion', 'documento', 'preferencias', 'ubicacion', 'vehiculos']) {
    assert.ok(!campos.includes(prohibido), `"${prohibido}" no debe salir del Core`)
  }
})

test('los eventos de sincronización son la suscripción mínima de un satélite', () => {
  const eventos = eventosDeSincronizacion()
  assert.ok(eventos.length > 0)
  // Sin duplicados y ordenados: es una lista que se copia a la documentación.
  assert.deepEqual(eventos, [...new Set(eventos)].sort())
  for (const esperado of ['customer.updated', 'company.updated', 'membership.activated']) {
    assert.ok(eventos.includes(esperado), `falta "${esperado}" en la suscripción mínima`)
  }
})

test('los eventos tienen forma `recurso.accion`', () => {
  for (const e of eventosDeSincronizacion()) {
    assert.match(e, /^[a-z]+\.[a-z_]+$/, `evento con formato inesperado: "${e}"`)
  }
})

test('preguntar por una entidad desconocida no inventa permisos', () => {
  // El fallo tiene que ser cerrado: lo que no está declarado, no se proyecta
  // ni decide.
  assert.equal(proyeccionDe('Factura'), undefined)
  assert.equal(puedeDecidirLocalmente('Factura'), false)
  assert.deepEqual(camposPermitidos('Factura'), [])
})
