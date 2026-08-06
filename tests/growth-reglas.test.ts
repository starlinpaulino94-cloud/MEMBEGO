import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerRegla, resumirRegla } from '../src/modules/growth/reglas'

/**
 * Estas reglas deciden qué se le regala a un cliente. Un fallo aquí no rompe
 * una pantalla: entrega premios que el negocio no quiso dar, o deja de entregar
 * los que sí prometió. Además, el formulario viejo fallaba EN SILENCIO, así que
 * lo que más se prueba es que siempre haya un motivo legible.
 */

function fd(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

const BASE = {
  nombre: 'Bono por registro',
  trigger: 'REGISTRO',
  beneficiario: 'REFERENTE',
  recompensaTipo: 'PUNTOS',
  recompensaValor: '50',
}

test('una regla completa se normaliza sin perder nada', () => {
  const r = leerRegla(fd({ ...BASE, planId: 'plan-1' }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.datos.nombre, 'Bono por registro')
  assert.equal(r.datos.trigger, 'REGISTRO')
  assert.equal(r.datos.recompensaValor, 50)
  assert.equal(r.datos.planId, 'plan-1')
  assert.equal(r.datos.recompensaPromocionId, null)
})

test('cada rechazo trae un motivo que se le puede enseñar al usuario', () => {
  const casos = [
    { campos: { ...BASE, nombre: '  ' }, esperado: /nombre/i },
    { campos: { ...BASE, trigger: 'INVENTADO' }, esperado: /cuándo/i },
    { campos: { ...BASE, beneficiario: 'NADIE' }, esperado: /quién/i },
    { campos: { ...BASE, recompensaTipo: 'ORO' }, esperado: /tipo/i },
    { campos: { ...BASE, recompensaValor: '0' }, esperado: /mayor que cero/i },
    { campos: { ...BASE, recompensaValor: '-5' }, esperado: /mayor que cero/i },
    { campos: { ...BASE, recompensaValor: 'abc' }, esperado: /mayor que cero/i },
  ]
  for (const c of casos) {
    const r = leerRegla(fd(c.campos))
    assert.equal(r.ok, false, `debió rechazar: ${JSON.stringify(c.campos)}`)
    if (r.ok) continue
    assert.match(r.error, c.esperado)
    assert.ok(r.error.length > 10, 'el motivo debe ser una frase, no un código')
  }
})

test('un beneficio digital sin promoción elegida no se guarda', () => {
  // Guardarla dejaría una regla que se dispara y no entrega nada: el cliente
  // cumple, el negocio cree que premió, y nadie recibe el beneficio.
  const r = leerRegla(fd({ ...BASE, recompensaTipo: 'BENEFICIO', recompensaValor: '0' }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /beneficio digital/i)
})

test('el beneficio digital ignora el valor numérico y conserva la promoción', () => {
  const r = leerRegla(
    fd({
      ...BASE,
      recompensaTipo: 'BENEFICIO',
      recompensaPromocionId: 'promo-9',
      recompensaValor: '999',
    })
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.datos.recompensaPromocionId, 'promo-9')
  assert.equal(r.datos.recompensaValor, 0, 'el valor no aplica a un beneficio')
})

test('una promoción elegida por error no se arrastra a otro tipo de recompensa', () => {
  // El usuario eligió BENEFICIO, seleccionó una promo, y luego cambió a PUNTOS.
  const r = leerRegla(fd({ ...BASE, recompensaTipo: 'PUNTOS', recompensaPromocionId: 'promo-9' }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.datos.recompensaPromocionId, null)
})

test('un descuento en porcentaje no puede pasar de 100', () => {
  const malo = leerRegla(fd({ ...BASE, recompensaTipo: 'DESCUENTO_PORCENTAJE', recompensaValor: '150' }))
  assert.equal(malo.ok, false)
  if (!malo.ok) assert.match(malo.error, /100/)

  const bueno = leerRegla(fd({ ...BASE, recompensaTipo: 'DESCUENTO_PORCENTAJE', recompensaValor: '100' }))
  assert.equal(bueno.ok, true, '100% es válido: el beneficio sale gratis')
})

test('el umbral solo existe para «alcanza N referidos»', () => {
  const conUmbral = leerRegla(fd({ ...BASE, trigger: 'N_REFERIDOS', valorCondicion: '5' }))
  assert.equal(conUmbral.ok, true)
  if (conUmbral.ok) assert.equal(conUmbral.datos.valorCondicion, 5)

  // En el resto se normaliza a 1 aunque el formulario mande otra cosa: si no,
  // queda un dato que no significa nada y confunde al editar.
  const sinUmbral = leerRegla(fd({ ...BASE, trigger: 'REGISTRO', valorCondicion: '9' }))
  assert.equal(sinUmbral.ok, true)
  if (sinUmbral.ok) assert.equal(sinUmbral.datos.valorCondicion, 1)
})

test('«N referidos» exige un umbral de al menos 1', () => {
  for (const v of ['0', '-3', 'abc']) {
    const r = leerRegla(fd({ ...BASE, trigger: 'N_REFERIDOS', valorCondicion: v }))
    assert.equal(r.ok, false, `umbral inválido aceptado: ${v}`)
    if (!r.ok) assert.match(r.error, /referidos/i)
  }
  const decimal = leerRegla(fd({ ...BASE, trigger: 'N_REFERIDOS', valorCondicion: '3.7' }))
  assert.equal(decimal.ok, true)
  if (decimal.ok) assert.equal(decimal.datos.valorCondicion, 3, 'medio referido no existe')
})

test('el resumen de la lista se lee como una frase, no como códigos', () => {
  assert.equal(
    resumirRegla({
      trigger: 'REGISTRO',
      valorCondicion: 1,
      recompensaTipo: 'PUNTOS',
      recompensaValor: 50,
      beneficiario: 'REFERENTE',
    }),
    'Se registra → 50 · Puntos · para Quien invita'
  )
  assert.match(
    resumirRegla({
      trigger: 'N_REFERIDOS',
      valorCondicion: 5,
      recompensaTipo: 'BENEFICIO',
      recompensaValor: 0,
      recompensaPromocion: 'Lavado premium',
      beneficiario: 'AMBOS',
    }),
    /\(5\).*Lavado premium.*Ambos/
  )
})
