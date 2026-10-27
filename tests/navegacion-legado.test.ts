/* eslint-disable no-console -- la prueba sustituye `console.log` a propósito: el evento estructurado sale por ahí. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { RUTAS_LEGADAS, registrarAccesoLegado } from '../src/modules/navegacion/legado'

/**
 * LAS RUTAS QUE EL MENÚ DEJÓ SIN ENTRADA SE CUENTAN, NO SE RETIRAN (auditoría admin · fase 6, tarea 6.4; 03 · D.4).
 *
 * La auditoría propone retirar cuatro rutas «previa verificación de uso». El dato de uso no existe: esto lo produce. Lo que se
 * prueba es que el evento sale con la forma correcta, sin datos de persona, y que ninguna de las cuatro cambió de comportamiento.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const pagina = (ruta: string) => `src/app/(admin)${ruta}/page.tsx`

function capturar(f: () => void): Record<string, unknown>[] {
  const original = console.log
  const lineas: string[] = []
  console.log = (...a: unknown[]) => void lineas.push(String(a[0]))
  try {
    f()
  } finally {
    console.log = original
  }
  return lineas.map((l) => JSON.parse(l) as Record<string, unknown>)
}

test('cada acceso deja UN evento estructurado: dominio, acción y la ruta como etiqueta', () => {
  const [e] = capturar(() => registrarAccesoLegado('/admin/campanas', 'ckx7p2q9a0001abcd1234efgh'))
  assert.equal(e?.dom, 'navegacion')
  assert.equal(e?.acc, 'ruta_legada')
  assert.equal(e?.ok, true)
  assert.equal(e?.ruta, 'admin_campanas')
  assert.equal(e?.emp, 'ckx7p2q9a0001abcd1234efgh')
})

test('el evento no lleva ninguna persona: ni correo, ni nombre, ni la URL cruda', () => {
  for (const ruta of RUTAS_LEGADAS) {
    const [e] = capturar(() => registrarAccesoLegado(ruta))
    assert.deepEqual(Object.keys(e!).sort(), ['acc', 'dom', 'evt', 'ok', 'ruta', 't'].sort(), `${ruta}: campos inesperados`)
    assert.match(String(e!.ruta), /^[a-z][a-z0-9_]*$/, `${ruta}: la ruta no salió como etiqueta`)
  }
})

test('son exactamente las cuatro rutas que la auditoría propone retirar, y las cuatro existen', () => {
  assert.deepEqual([...RUTAS_LEGADAS], ['/admin/whatsapp', '/admin/campanas', '/admin/excursiones/reportes', '/admin/referidos'])
  for (const r of RUTAS_LEGADAS) assert.ok(existsSync(pagina(r)), `${r} ya no existe: quita su registro o recupera la ruta`)
})

test('cada una registra su propio acceso y NADA más cambió: siguen siendo las pantallas de siempre', () => {
  for (const r of RUTAS_LEGADAS) {
    const src = sinComentarios(readFileSync(pagina(r), 'utf8'))
    assert.ok(src.includes(`registrarAccesoLegado('${r}'`), `${r} no registra su acceso`)
    // El registro va ANTES de cualquier salida de la pantalla, para que cuente también al que rebota.
    const cuerpo = src.slice(src.indexOf('export default'))
    assert.ok(
      cuerpo.indexOf('registrarAccesoLegado(') < cuerpo.search(/return\s*[<(]|redirect\(/),
      `${r} registra después de la primera salida: no contaría ese acceso`
    )
  }
  // WhatsApp sigue redirigiendo al mismo sitio.
  assert.match(sinComentarios(readFileSync(pagina('/admin/whatsapp'), 'utf8')), /redirect\('\/admin\/comunicacion'\)/)
  // Y las otras tres conservan su guardia de rol: registrar un acceso no es una puerta ni la abre.
  for (const r of ['/admin/campanas', '/admin/excursiones/reportes', '/admin/referidos'] as const) {
    assert.match(sinComentarios(readFileSync(pagina(r), 'utf8')), /requireRole\(ADMIN_ROLES\)/, `${r} perdió su guardia`)
  }
})

test('observar no puede tumbar la pantalla: el registro nunca lanza', () => {
  const original = console.log
  console.log = () => {
    throw new Error('el log está roto')
  }
  try {
    assert.doesNotThrow(() => registrarAccesoLegado('/admin/campanas'))
  } finally {
    console.log = original
  }
})
