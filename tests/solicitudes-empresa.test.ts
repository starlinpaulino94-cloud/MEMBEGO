import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validarDatosSolicitud,
  horarioComoTexto,
  extensionDeMime,
  VERTICAL_POR_TIPO,
} from '../src/modules/solicitudes/nucleo'

/**
 * Solicitudes de alta (etapa concierge): el payload llega del navegador de un
 * desconocido, así que la validación es la frontera. Estas pruebas fijan que
 * nada crudo pasa y que los requeridos se reclaman en el orden del formulario.
 */

function solicitudValida() {
  return {
    negocio: {
      nombre: 'Car Wash El Rápido',
      tipo: 'Car Wash',
      descripcion: 'Lavado y detailing.',
      telefono: '809-555-0000',
      correo: 'CONTACTO@rapido.com',
    },
    ubicacion: { direccion: 'Av. Principal 1', ciudad: 'Santiago' },
    horario: [{ dia: 'Lun', cerrado: false, desde: '08:00', hasta: '18:00' }],
    admin: { nombre: 'Ana Pérez', correo: 'ana@rapido.com', telefono: '829-555-0000' },
    marca: { color: '#ff8800' },
    planes: [{ nombre: 'Básico', precio: '1500', incluye: '4 lavados' }],
    promos: [{ titulo: '2x1 martes', oferta: 'Dos lavados al precio de uno' }],
    cobros: { efectivo: true, transferencia: true, banco: 'BHD', usaCitas: false },
    extras: { ruleta: true },
  }
}

test('una solicitud completa pasa y sale normalizada (correo en minúsculas)', () => {
  const r = validarDatosSolicitud(solicitudValida())
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.negocio.correo, 'contacto@rapido.com')
    assert.equal(r.datos.negocio.tipo, 'Car Wash')
    assert.equal(r.datos.marca.color, '#ff8800')
    assert.equal(r.datos.planes.length, 1)
    assert.equal(r.datos.cobros.transferencia, true)
  }
})

test('los requeridos se reclaman en el orden del formulario', () => {
  const sin = solicitudValida()
  sin.negocio.nombre = ''
  const r1 = validarDatosSolicitud(sin)
  assert.equal(r1.ok, false)
  if (!r1.ok) assert.match(r1.error, /nombre comercial/)

  const sinAdmin = solicitudValida()
  sinAdmin.admin.correo = 'no-es-correo'
  const r2 = validarDatosSolicitud(sinAdmin)
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.error, /administrador/)
})

test('un tipo inventado (payload a mano) se rechaza, no se degrada en silencio', () => {
  const s = solicitudValida() as Record<string, unknown>
  ;(s.negocio as Record<string, unknown>).tipo = 'HACKER'
  const r = validarDatosSolicitud(s)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /tipo de negocio/)
})

test('la basura no pasa: color inválido se descarta y las listas se recortan', () => {
  const s = solicitudValida() as Record<string, unknown>
  ;(s.marca as Record<string, unknown>).color = 'javascript:alert(1)'
  s.planes = Array.from({ length: 30 }, () => ({ nombre: 'x', precio: '1', incluye: 'y' }))
  const r = validarDatosSolicitud(s)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.marca.color, undefined)
    assert.equal(r.datos.planes.length, 10)
  }
})

test('payloads vacíos o no-objeto se rechazan sin explotar', () => {
  assert.equal(validarDatosSolicitud(null).ok, false)
  assert.equal(validarDatosSolicitud('texto').ok, false)
  assert.equal(validarDatosSolicitud(42).ok, false)
  assert.equal(validarDatosSolicitud({}).ok, false)
})

test('el horario se vuelve el texto libre de Company.horario', () => {
  const texto = horarioComoTexto([
    { dia: 'Lun', cerrado: false, desde: '08:00', hasta: '18:00' },
    { dia: 'Dom', cerrado: true, desde: '', hasta: '' },
  ])
  assert.equal(texto, 'Lun: 08:00–18:00 · Dom: cerrado')
})

test('mapeos auxiliares: vertical por tipo y extensión por MIME', () => {
  assert.equal(VERTICAL_POR_TIPO['Car Wash'], 'CAR_WASH')
  assert.equal(VERTICAL_POR_TIPO['Restaurante'], 'RESTAURANTE')
  assert.equal(VERTICAL_POR_TIPO['Otro' as keyof typeof VERTICAL_POR_TIPO], undefined)
  assert.equal(extensionDeMime('image/png'), 'png')
  assert.equal(extensionDeMime('image/webp'), 'webp')
  assert.equal(extensionDeMime('image/jpeg'), 'jpg')
})
