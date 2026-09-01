import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  destinoDeVueltaSeguro,
  nombreDelDestino,
  origenSeguro,
} from '../src/modules/connect/oauthNucleo'

/**
 * MEMBEGO CONNECT · Fase 13 (Integraciones dentro de los módulos).
 *
 * Lo que de verdad hay que blindar aquí no es la pantalla: es que ningún
 * módulo se salte el catálogo y empiece a interpretar el estado de una
 * conexión por su cuenta. En cuanto haya dos códigos que respondan a la misma
 * pregunta, un día responderán distinto.
 */

const leer = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Los módulos donde una integración aparece fuera de /admin/integraciones. */
const MODULOS = [
  'src/app/(admin)/admin/citas/page.tsx',
  'src/app/(admin)/admin/automatizaciones/page.tsx',
  'src/app/(admin)/admin/comunicacion/page.tsx',
]

// ─── Fuente única ────────────────────────────────────────────────────────────

test('contextual: el componente lee el MISMO ensamblador del catálogo', () => {
  const src = leer('src/components/connect/ConexionIntegracion.tsx')
  assert.match(src, /entradaDeCatalogo/)
  // Ni consulta conexiones por su cuenta ni decide estados: todo llega hecho.
  const limpio = codigo('src/components/connect/ConexionIntegracion.tsx')
  for (const prohibido of [
    'conexionEmpresa',
    'conexionesDeEmpresa',
    'decidirEstadoIntegracion',
    'ETIQUETA_ESTADO',
  ]) {
    assert.ok(!limpio.includes(prohibido), `el componente reimplementa ${prohibido}`)
  }
})

test('contextual: ningún módulo consulta conexiones ni conectores por su cuenta', () => {
  // Ésta es la prueba que sostiene la exigencia de «una sola conexión»: si un
  // módulo empieza a leer `conexiones_empresa` directamente, aquí se ve.
  for (const m of MODULOS) {
    const src = codigo(m)
    for (const prohibido of [
      'conexionEmpresa',
      'conexionesDeEmpresa',
      'catalogoDeEmpresa',
      'proveedorDe',
      'credencialConexion',
    ]) {
      assert.ok(!src.includes(prohibido), `${m} consulta ${prohibido} sin pasar por el componente`)
    }
  }
})

test('contextual: ningún módulo tiene acciones de conexión', () => {
  // Conectar y desconectar viven en UN solo sitio. Un módulo con su propio
  // botón de conectar sería la segunda implementación que el rediseño prohíbe.
  for (const m of MODULOS) {
    const src = codigo(m)
    for (const prohibido of [
      'crearConexion',
      'desconectarConexion',
      'conectarWhatsapp',
      'adminActions',
      'altaActions',
    ]) {
      assert.ok(!src.includes(prohibido), `${m} tiene su propia acción de conexión: ${prohibido}`)
    }
  }
})

test('contextual: los tres módulos usan el componente compartido', () => {
  for (const m of MODULOS) {
    assert.match(leer(m), /<ConexionIntegracion/, `${m} no lo usa`)
  }
})

// ─── El destino de vuelta ────────────────────────────────────────────────────

test('vuelta: solo se aceptan rutas internas de /admin/', () => {
  assert.equal(origenSeguro('/admin/citas'), '/admin/citas')
  // Un destino elegido por quien llama convertiría un enlace nuestro en un
  // redirector abierto hacia el sitio de otro.
  for (const malo of [
    'https://evil.example/roba',
    '//evil.example/roba',
    '/cliente/pagos',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ]) {
    assert.equal(origenSeguro(malo), null, `${malo} no debería aceptarse como origen`)
  }
})

test('vuelta: «a dónde voy» y «de dónde vengo» son preguntas distintas', () => {
  // La primera SIEMPRE tiene que responder algo; la segunda puede decir «de
  // ningún sitio», y confundirlas hace que una pantalla sin parámetro pinte un
  // «volver» que no lleva a donde el usuario estaba.
  assert.equal(destinoDeVueltaSeguro(null), '/admin/integraciones')
  assert.equal(origenSeguro(null), null)
  // Y un origen inválido se trata como ausente, no como el panel.
  assert.equal(destinoDeVueltaSeguro('https://evil.example'), '/admin/integraciones')
  assert.equal(origenSeguro('https://evil.example'), null)
})

test('vuelta: el destino se enseña por su nombre, no por su ruta', () => {
  assert.equal(nombreDelDestino('/admin/citas'), 'Citas')
  assert.equal(nombreDelDestino('/admin/automatizaciones'), 'Automatizaciones')
  assert.equal(nombreDelDestino('/admin/comunicacion'), 'Comunicación')
  // Lo que no está en la lista se llama «atrás»: cierto, sin afirmar de más.
  assert.equal(nombreDelDestino('/admin/loquesea'), 'atrás')
  assert.equal(nombreDelDestino(null), 'atrás')
})

test('vuelta: la página de la integración VALIDA el destino, no lo usa crudo', () => {
  const src = codigo('src/app/(admin)/admin/integraciones/[slug]/page.tsx')
  assert.match(src, /origenSeguro\(sp\.volver\)/)
  const asistente = codigo('src/app/(admin)/admin/integraciones/[slug]/conectar/page.tsx')
  assert.match(asistente, /origenSeguro\(volverCrudo\)/)
})

test('vuelta: el origen sobrevive al viaje a Google', () => {
  // Sin esto, quien empezó desde Citas volvería del proveedor sin recordar de
  // dónde venía y terminaría el alta en Integraciones.
  const src = leer('src/app/(admin)/admin/integraciones/[slug]/conectar/page.tsx')
  assert.match(src, /conectar\$\{volver \? `\?volver=\$\{volver\}` : ''\}/)
})

// ─── Honestidad de la pantalla ───────────────────────────────────────────────

test('contextual: lo que no está publicado no se enseña en el módulo', () => {
  const src = leer('src/components/connect/ConexionIntegracion.tsx')
  // Un recuadro permanente diciendo «no disponible» dentro de Citas sería
  // ruido sobre algo que la empresa no pidió.
  assert.match(src, /if \(!entrada\) return null/)
})

test('contextual: sin acción posible NO se pinta ningún enlace', () => {
  const src = leer('src/components/connect/ConexionIntegracion.tsx')
  assert.match(src, /\{entrada\.accion && \(/)
})

test('automatizaciones: los canales los responde la misma función que el motor', () => {
  const pagina = leer('src/app/(admin)/admin/automatizaciones/page.tsx')
  assert.match(pagina, /canalesDeEmpresa/)
  // Y el motor consulta esas mismas funciones al actuar.
  const canales = leer('src/modules/connect/canales.ts')
  assert.match(canales, /whatsappDisponible\(companyId\)/)
  const sink = leer('src/modules/estrategias/actionSink.ts')
  assert.match(sink, /whatsappDisponible|enviarWhatsapp/)
})

test('comunicación: los dos WhatsApp de la pantalla se distinguen por escrito', () => {
  // En la misma página conviven el número al que el cliente escribe y el canal
  // por el que Membego envía. Sin decirlo, quien configure uno creerá que
  // tiene el otro.
  const src = leer('src/app/(admin)/admin/comunicacion/page.tsx')
  assert.match(src, /No es el número de contacto/)
})
