/**
 * Observabilidad — pruebas. Ejecutar: npm test
 *
 * QUÉ SE PRUEBA Y POR QUÉ:
 *
 * 1. Que los DATOS PERSONALES NO SALEN en los eventos. Es la prueba más
 *    importante del archivo. Una fuga por logs no da error, no rompe nada y no
 *    la nota nadie: simplemente, dentro de seis meses los correos de todos los
 *    clientes llevan un año en un proveedor externo. Lo único que lo impide es
 *    la forma que acepta `extra`, y lo único que impide que alguien la relaje
 *    "un momentito" son estas pruebas.
 *
 * 2. La aritmética del presupuesto de error. Es contraintuitiva —un 0,25% de
 *    fallos con un objetivo del 99,5% no es "casi nada", es medio mes gastado—
 *    y si está mal, las alertas saltan tarde o no saltan.
 *
 * 3. Los umbrales del estado del sistema. Nadie prueba los umbrales de alerta,
 *    y luego alertan mal. Por eso `estadoGeneral` es una función pura separada
 *    de la lectura de la base.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aEtiqueta,
  esEtiqueta,
  lineaDeEvento,
  saneaExtra,
} from '../src/modules/observabilidad/eventos'
import {
  SLOS,
  consumoPresupuesto,
  estadoDeConsumo,
  hayDatos,
  minutosPresupuesto,
  presupuestoLegible,
  sloPorId,
  umbralDeAlerta,
  VENTANAS_ALERTA,
} from '../src/modules/observabilidad/slo'
import { estadoGeneral, saturacionConexiones } from '../src/modules/observabilidad/metricas'
import {
  limpiarEvento,
  limpiarMiga,
  limpiarUrl,
} from '../src/modules/observabilidad/sentryLimpieza'
import type { Metricas } from '../src/modules/observabilidad/metricas'

// ── 1 · Los datos personales no salen ───────────────────────────────────────

test('una etiqueta es una etiqueta y un correo no lo es', () => {
  assert.equal(esEtiqueta('qr_ya_usado'), true)
  assert.equal(esEtiqueta('p2024'), true)
  assert.equal(esEtiqueta('modelo-visit'), true)

  assert.equal(esEtiqueta('starlin@ejemplo.com'), false, 'un correo NO puede pasar')
  assert.equal(esEtiqueta('809-555-1234'), false, 'un teléfono NO puede pasar')
  assert.equal(esEtiqueta('Juan Pérez'), false, 'un nombre NO puede pasar')
  assert.equal(esEtiqueta('https://membego.com/x?token=abc'), false)
  assert.equal(esEtiqueta('a'.repeat(49)), false, 'demasiado largo')
  assert.equal(esEtiqueta(''), false)
  assert.equal(esEtiqueta(123), false)
})

test('extra descarta cualquier cosa con forma de dato personal', () => {
  const limpio = saneaExtra({
    intentos: 3,
    interno: true,
    motivo: 'sin_saldo',
    correo: 'cliente@ejemplo.com',
    telefono: '8095551234',
    nombre: 'María',
    token: 'eyJhbGciOiJIUzI1NiJ9.abc.def',
  })

  assert.deepEqual(limpio, { intentos: 3, interno: true, motivo: 'sin_saldo' })
})

test('el evento serializado no contiene el correo aunque se intente colar', () => {
  // El caso real: alguien "depurando" mete el correo en extra.
  const linea = lineaDeEvento({
    dominio: 'escaneo',
    accion: 'canje',
    ok: false,
    companyId: 'empresa-1',
    motivo: 'qr_ya_usado',
    extra: { cliente: 'starlin@ejemplo.com' as never, intentos: 2 },
  })

  assert.equal(linea.includes('@'), false, 'no puede salir ninguna dirección')
  assert.equal(linea.includes('starlin'), false)
  assert.ok(linea.includes('"intentos":2'))
  assert.ok(linea.includes('"emp":"empresa-1"'))
})

test('un teléfono con formato numérico tampoco se cuela como número', () => {
  // 8095551234 SÍ es un número finito, así que pasaría el filtro de tipo. Lo
  // que lo salva es que la clave tenga sentido: quien escriba `telefono: 809…`
  // está haciendo algo mal y esta prueba deja constancia de que el filtro no
  // lo detecta. La forma protege del texto, no de un número puesto a mano.
  const limpio = saneaExtra({ telefono: 8095551234 })
  assert.deepEqual(limpio, { telefono: 8095551234 })
  // Documentado a propósito: la barrera es la revisión de código, no el tipo.
})

test('aEtiqueta convierte un mensaje de error en algo contable', () => {
  assert.equal(aEtiqueta('Timed out fetching a new connection'), 'timed_out_fetching_a_new_connection')
  assert.equal(aEtiqueta('Conexión perdida'), 'conexion_perdida')
  assert.equal(aEtiqueta('!!!'), 'desconocido')
  assert.equal(aEtiqueta(undefined), 'desconocido')
  assert.equal(aEtiqueta(null), 'desconocido')
})

test('la línea del evento tiene la forma fija que se puede filtrar y contar', () => {
  const linea = lineaDeEvento(
    { dominio: 'cola', accion: 'lote_enviado', ok: true, ms: 1234.7 },
    new Date('2026-07-29T12:00:00.000Z')
  )
  const o = JSON.parse(linea)
  assert.equal(o.evt, 1)
  assert.equal(o.t, '2026-07-29T12:00:00.000Z')
  assert.equal(o.dom, 'cola')
  assert.equal(o.acc, 'lote_enviado')
  assert.equal(o.ok, true)
  assert.equal(o.ms, 1235, 'los milisegundos se redondean')
  assert.equal('emp' in o, false, 'sin empresa no se inventa el campo')
})

// ── 2 · El presupuesto de error ─────────────────────────────────────────────

test('el presupuesto sale de la aritmética, no de la intuición', () => {
  const disponibilidad = sloPorId('disponibilidad')!
  // 99,5% de 30 días = 216 minutos = 3 h 36 min.
  assert.equal(Math.round(minutosPresupuesto(disponibilidad)), 216)
  assert.equal(presupuestoLegible(disponibilidad), '3 h 36 min al mes')
})

test('un 0,25% de fallos gasta MEDIO mes de presupuesto', () => {
  // Este es el número que la gente calcula mal: parece "casi nada".
  const slo = sloPorId('disponibilidad')!
  const c = consumoPresupuesto(slo, 9975, 10000)
  assert.ok(Math.abs(c.consumido - 0.5) < 0.001, `consumido=${c.consumido}`)
  assert.equal(c.estado, 'atencion')
})

test('el presupuesto se agota justo al incumplir el objetivo', () => {
  const slo = sloPorId('disponibilidad')!
  assert.equal(consumoPresupuesto(slo, 995, 1000).estado, 'agotado')
  assert.equal(consumoPresupuesto(slo, 1000, 1000).estado, 'sano')
})

test('sin eventos no se inventa un veredicto', () => {
  const slo = sloPorId('canje')!
  const c = consumoPresupuesto(slo, 0, 0)
  assert.equal(c.consumido, 0)
  assert.equal(c.restante, 1)
  assert.equal(hayDatos(0), false)
  assert.equal(hayDatos(19), false)
  assert.equal(hayDatos(20), true)
})

test('los tramos del estado no se solapan ni dejan huecos', () => {
  assert.equal(estadoDeConsumo(0), 'sano')
  assert.equal(estadoDeConsumo(0.49), 'sano')
  assert.equal(estadoDeConsumo(0.5), 'atencion')
  assert.equal(estadoDeConsumo(0.74), 'atencion')
  assert.equal(estadoDeConsumo(0.75), 'critico')
  assert.equal(estadoDeConsumo(0.99), 'critico')
  assert.equal(estadoDeConsumo(1), 'agotado')
  assert.equal(estadoDeConsumo(5), 'agotado')
})

test('el umbral de alerta es un número que se puede copiar al monitor', () => {
  const slo = sloPorId('disponibilidad')!
  // (1 - 0.995) * 14.4 = 7,2% de fallos sostenido durante una hora.
  assert.ok(Math.abs(umbralDeAlerta(slo, 14.4) - 0.072) < 1e-9)
  // Nunca puede pedir más del 100% de fallos.
  assert.equal(umbralDeAlerta({ ...slo, objetivo: 0.5 }, 14.4), 1)
})

test('las ventanas de alerta van de la más agresiva a la más lenta', () => {
  for (let i = 1; i < VENTANAS_ALERTA.length; i++) {
    assert.ok(
      VENTANAS_ALERTA[i].factor < VENTANAS_ALERTA[i - 1].factor,
      'el factor tiene que decrecer'
    )
    assert.ok(
      VENTANAS_ALERTA[i].ventanaHoras > VENTANAS_ALERTA[i - 1].ventanaHoras,
      'la ventana tiene que crecer'
    )
    assert.ok(
      VENTANAS_ALERTA[i].ventanaCortaHoras < VENTANAS_ALERTA[i].ventanaHoras,
      'la ventana corta confirma que SIGUE pasando: tiene que ser menor'
    )
  }
})

test('todos los SLO están completos', () => {
  // Un SLO sin SLI no se puede medir, y uno sin razón nadie lo defiende cuando
  // toca decir que no.
  for (const s of SLOS) {
    assert.ok(s.objetivo > 0 && s.objetivo < 1, `${s.id}: objetivo fuera de rango`)
    assert.ok(s.ventanaDias > 0, `${s.id}: sin ventana`)
    assert.ok(s.sli.length > 20, `${s.id}: SLI vacío o vago`)
    assert.ok(s.razon.length > 40, `${s.id}: sin razón escrita`)
  }
  assert.equal(new Set(SLOS.map((s) => s.id)).size, SLOS.length, 'ids duplicados')
})

// ── 3 · Los umbrales del estado del sistema ─────────────────────────────────

function metricas(sistema: Partial<Metricas['sistema']>): Metricas {
  return {
    negocio: {
      visitas24h: 0,
      visitasPrevias24h: 0,
      transacciones24h: 0,
      clientesNuevos24h: 0,
      pagosAprobados24h: 0,
      pagosRechazados24h: 0,
      pagosSinResolver: 0,
      empresasActivas: 0,
      notificaciones24h: 0,
    },
    sistema: {
      latenciaBdMs: 20,
      bdViva: true,
      conexiones: null,
      conexionesMax: null,
      indicesInvalidos: 0,
      ...sistema,
    },
    medidoEn: new Date().toISOString(),
    fallos: [],
  }
}

test('la base caída es crítico, sin matices', () => {
  assert.equal(estadoGeneral(metricas({ bdViva: false })), 'critico')
})

test('la saturación de conexiones se detecta ANTES del P2024', () => {
  assert.equal(estadoGeneral(metricas({ conexiones: 100, conexionesMax: 200 })), 'ok')
  assert.equal(estadoGeneral(metricas({ conexiones: 150, conexionesMax: 200 })), 'degradado')
  assert.equal(estadoGeneral(metricas({ conexiones: 185, conexionesMax: 200 })), 'critico')
})

test('la latencia de la base marca el estado por tramos', () => {
  assert.equal(estadoGeneral(metricas({ latenciaBdMs: 100 })), 'ok')
  assert.equal(estadoGeneral(metricas({ latenciaBdMs: 500 })), 'degradado')
  assert.equal(estadoGeneral(metricas({ latenciaBdMs: 2000 })), 'critico')
})

test('un índice inválido degrada aunque todo lo demás vaya bien', () => {
  // Es el rastro de una migración CONCURRENTLY que se cortó: la app funciona y
  // las consultas van lentas sin motivo aparente.
  assert.equal(estadoGeneral(metricas({ indicesInvalidos: 1 })), 'degradado')
})

test('lo que no se pudo medir no cuenta como cero', () => {
  assert.equal(saturacionConexiones(metricas({}).sistema), null)
  assert.equal(saturacionConexiones(metricas({ conexiones: 50, conexionesMax: 200 }).sistema), 0.25)
})

// ── 4 · Lo que Sentry NO debe recibir ───────────────────────────────────────

test('el pase de mantenimiento no llega a Sentry', () => {
  // El caso concreto: alguien opera con `/?pase=…` y en ese momento revienta
  // una página. Sin esto, el pase queda escrito en el panel de errores.
  const limpia = limpiarUrl('https://membego.com/admin/dashboard?pase=secreto-largo-de-verdad')
  assert.equal(limpia.includes('secreto-largo-de-verdad'), false)
  assert.ok(limpia.includes('/admin/dashboard'), 'la ruta sí se conserva: es el dato útil')
})

test('los tokens de las URL se ocultan y lo demás se conserva', () => {
  const limpia = limpiarUrl('/confirmar?token=abc123&page=2')
  assert.equal(limpia.includes('abc123'), false)
  assert.ok(limpia.includes('page=2'), 'un parámetro inocuo ayuda a depurar')
})

test('una URL sin nada sensible se devuelve intacta', () => {
  assert.equal(limpiarUrl('/cliente/inicio?tab=promos'), '/cliente/inicio?tab=promos')
})

test('el evento pierde cookies, secretos y correo, pero conserva el id', () => {
  const evento = limpiarEvento({
    request: {
      url: '/admin?pase=xxx',
      query_string: 'pase=xxx',
      cookies: { 'sb-abc-auth-token': 'muy-secreto' },
      headers: {
        Authorization: 'Bearer x',
        Cookie: 'a=b',
        'x-metricas-secret': 'y',
        'user-agent': 'Chrome',
      },
    },
    user: { id: 'user-1', email: 'starlin@ejemplo.com', ip_address: '1.2.3.4' },
  })

  assert.equal(evento.request!.cookies, undefined)
  assert.equal(evento.request!.headers!.Authorization, undefined)
  assert.equal(evento.request!.headers!['x-metricas-secret'], undefined)
  assert.equal(evento.request!.headers!['user-agent'], 'Chrome', 'el navegador sí sirve')
  assert.equal(evento.request!.url!.includes('xxx'), false)
  assert.equal(evento.request!.query_string, '[oculto]')
  assert.deepEqual(evento.user, { id: 'user-1' })
})

test('las migas de navegación también se limpian', () => {
  const miga = limpiarMiga({ data: { from: '/x?token=1', to: '/y?pase=2', url: '/z?code=3' } })
  assert.equal(JSON.stringify(miga).includes('token=1'), false)
  assert.equal(JSON.stringify(miga).includes('pase=2'), false)
  assert.equal(JSON.stringify(miga).includes('code=3'), false)
})
