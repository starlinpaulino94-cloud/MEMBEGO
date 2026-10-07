import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  textoEstadoCardnet,
  AVISO_AMBIENTE_PRUEBAS,
} from '../src/modules/pagos/estadoCardnetTexto'

/**
 * EL AMBIENTE DE LA PASARELA TIENE QUE VERSE DESDE EL PANEL.
 *
 * El caso que motiva estas pruebas: «la tarjeta se registra bien pero el
 * código de verificación nunca llega». En el ambiente de PRUEBAS CardNET no
 * hace el cargo de RD$1.00 y el banco no muestra ningún código; todo lo
 * demás del flujo se ve exactamente igual que en producción. Si el único
 * sitio donde eso se puede leer es una variable de Vercel, el administrador
 * lo busca en el banco, en CardNET y en el cliente antes que en la
 * configuración.
 */

test('apagada o sin credenciales: no se ofrece y no hay aviso de pruebas', () => {
  const apagada = textoEstadoCardnet({ capacidad: false, configurado: true, ambiente: 'pruebas' })
  assert.equal(apagada.activo, false)
  assert.equal(apagada.avisoPruebas, null)

  const sinLlaves = textoEstadoCardnet({ capacidad: true, configurado: false, ambiente: 'pruebas' })
  assert.equal(sinLlaves.activo, false)
  assert.equal(sinLlaves.avisoPruebas, null)
  assert.match(sinLlaves.detalle, /credenciales/i)
})

test('en PRUEBAS sigue activa (la pasarela responde) pero el aviso lo dice sin rodeos', () => {
  const r = textoEstadoCardnet({ capacidad: true, configurado: true, ambiente: 'pruebas' })
  assert.equal(r.activo, true)
  assert.match(r.detalle, /pruebas/i)
  assert.equal(r.avisoPruebas, AVISO_AMBIENTE_PRUEBAS)
  // Lo que el administrador necesita saber: que el código NO va a llegar, y
  // qué variable tiene que cambiar.
  assert.match(AVISO_AMBIENTE_PRUEBAS, /c[oó]digo/i)
  assert.match(AVISO_AMBIENTE_PRUEBAS, /CARDNET_TOKENS_AMBIENTE=produccion/)
})

test('en producción: activa, sin aviso', () => {
  const r = textoEstadoCardnet({ capacidad: true, configurado: true, ambiente: 'produccion' })
  assert.equal(r.activo, true)
  assert.equal(r.avisoPruebas, null)
  assert.match(r.detalle, /producci[oó]n/i)
})

test('ambiente desconocido: se trata como producción a efectos del aviso (no se inventa)', () => {
  const r = textoEstadoCardnet({ capacidad: true, configurado: true, ambiente: null })
  assert.equal(r.activo, true)
  assert.equal(r.avisoPruebas, null)
})

test('la página de métodos de pago le pasa el ambiente real al panel', () => {
  // Si el panel tiene la propiedad pero la página no se la pasa, el aviso no
  // sale nunca y la prueba de arriba protege un texto que nadie ve.
  const pagina = readFileSync('src/app/(admin)/admin/metodos-pago/page.tsx', 'utf8')
  assert.match(pagina, /cardnetAmbiente=\{ambienteConfigurado\(\)\.ambiente\}/)
  const panel = readFileSync('src/components/admin/EstadoPasarelas.tsx', 'utf8')
  assert.match(panel, /textoEstadoCardnet\(/)
})
