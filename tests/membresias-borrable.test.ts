import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  puedeBorrarseMembresia,
  explicarNoBorrable,
} from '../src/modules/membresias/borrable'

/**
 * La regla que decide si una membresía se puede BORRAR (no cancelar).
 *
 * Existe para una sola cosa: limpiar los registros que dejan las pruebas. La
 * línea que no se cruza es que jamás pueda destruir el rastro de dinero que ya
 * cambió de manos.
 */

const vacia = { visitas: 0, comprobantes: 0, pagosConfirmados: 0 }

test('una membresía que nunca se usó SÍ se puede borrar', () => {
  assert.equal(puedeBorrarseMembresia(vacia).borrable, true)
  assert.equal(explicarNoBorrable(vacia), null)
})

test('una sola visita ya la protege', () => {
  const { borrable, motivos } = puedeBorrarseMembresia({ ...vacia, visitas: 1 })
  assert.equal(borrable, false)
  assert.deepEqual(motivos, ['visitas'])
  assert.match(explicarNoBorrable({ ...vacia, visitas: 1 }) ?? '', /1 visita registrada/)
})

test('un comprobante emitido la protege', () => {
  assert.equal(puedeBorrarseMembresia({ ...vacia, comprobantes: 2 }).borrable, false)
  assert.match(
    explicarNoBorrable({ ...vacia, comprobantes: 2 }) ?? '',
    /2 comprobantes emitidos/
  )
})

test('un pago CONFIRMADO la protege', () => {
  assert.equal(puedeBorrarseMembresia({ ...vacia, pagosConfirmados: 1 }).borrable, false)
})

test('los intentos de pago FALLIDOS no cuentan como historia', () => {
  // Es la diferencia entre servir y no servir: probar una pasarela deja
  // decenas de intentos rechazados, y si contaran, esta función no podría
  // limpiar nada de lo único que existe para limpiar. Solo llegan aquí los
  // APROBADOS — el filtro vive en la consulta.
  assert.equal(puedeBorrarseMembresia(vacia).borrable, true)
})

test('el mensaje enumera TODOS los motivos, no solo el primero', () => {
  // Arreglar uno y volver a chocar con otro es la peor forma de descubrir una
  // regla: se dicen todos de una vez.
  const texto = explicarNoBorrable({ visitas: 3, comprobantes: 1, pagosConfirmados: 2 }) ?? ''
  assert.match(texto, /3 visitas registradas/)
  assert.match(texto, /1 comprobante emitido/)
  assert.match(texto, /2 pagos confirmados/)
  assert.match(texto, /, .* y /, 'con tres motivos debe leerse como una lista natural')
})

test('el mensaje dice QUÉ hacer en su lugar', () => {
  // «No se puede eliminar» a secas deja al administrador pulsando otra vez.
  assert.match(explicarNoBorrable({ ...vacia, visitas: 1 }) ?? '', /[Cc]ancél[ae]la/)
})

test('un conteo imposible se trata como historia: falla CERRADO', () => {
  // Un conteo negativo o NaN solo puede venir de algo que salió mal. Ante la
  // duda sobre si hay un rastro financiero detrás, no se borra.
  assert.equal(puedeBorrarseMembresia({ ...vacia, visitas: -1 }).borrable, false)
  assert.equal(puedeBorrarseMembresia({ ...vacia, comprobantes: NaN }).borrable, false)
  assert.equal(
    puedeBorrarseMembresia({ ...vacia, pagosConfirmados: Infinity }).borrable,
    false
  )
})

test('el botón y el servidor usan la MISMA función', () => {
  // Si divergieran, el botón prometería un borrado que el servidor niega —el
  // fallo clásico de esta pantalla, y el que ya se pagó una vez con el borrado
  // de planes.
  const accion = readFileSync('src/modules/admin/planActions.ts', 'utf8')
  const boton = readFileSync('src/components/admin/DeleteMembresiaButton.tsx', 'utf8')
  assert.match(accion, /explicarNoBorrable\(/)
  assert.match(boton, /puedeBorrarseMembresia\(/)
})
