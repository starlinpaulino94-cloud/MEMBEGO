/**
 * Cola sin conexión del escáner — pruebas. Ejecutar: npm test
 *
 * POR QUÉ SE PRUEBA ESTO CON TANTO DETALLE:
 *
 * Esta cola guarda lavados que YA SE HICIERON. Cada entrada perdida es un
 * servicio prestado que nadie cobró, un uso de membresía que el cliente
 * conserva y una comisión que el lavador no ve. Y el fallo es silencioso: nadie
 * se entera hasta que cuadran la caja a fin de mes, si es que la cuadran.
 *
 * Las tres cosas que aquí se rompen sin que se note en el camino feliz:
 *
 *  · Que el ORDEN deje de ser FIFO. Con red buena la cola nunca tiene más de
 *    una entrada, así que un `sort` mal puesto no se nota jamás — hasta el día
 *    de la caída, que es cuando los números de ticket salen desordenados.
 *  · Que un error definitivo se reintente para siempre, o que uno temporal se
 *    descarte a la primera. Lo segundo pierde el lavado.
 *  · Que la espera creciente se convierta en un bucle cerrado que se come la
 *    batería del teléfono en la pista.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_INTENTOS,
  MS_CONSERVAR_ENVIADA,
  aFormData,
  desdeFormData,
  esDefinitivo,
  esperaSiguiente,
  limpiar,
  marcarEnviada,
  marcarFallo,
  normalizarMotivo,
  nuevaPendiente,
  ordenar,
  reemplazar,
  resumen,
  siguienteAEnviar,
  type Pendiente,
} from '../src/modules/scanner/colaOffline'

function pendiente(over: Partial<Pendiente> = {}): Pendiente {
  return {
    ...nuevaPendiente({ tipo: 'visita', datos: { membershipId: 'm1' } }, 1000, 'a'),
    ...over,
  }
}

// ── El orden ────────────────────────────────────────────────────────────────

test('la cola es FIFO por momento del escaneo, no del envío', () => {
  // El caso real: tres lavados durante una caída. Deben reenviarse en el orden
  // en que ocurrieron, porque el número de ticket es secuencial por empresa.
  const cola = [
    pendiente({ id: 'c', creadoEn: 3000 }),
    pendiente({ id: 'a', creadoEn: 1000 }),
    pendiente({ id: 'b', creadoEn: 2000 }),
  ]
  assert.deepEqual(ordenar(cola).map((p) => p.id), ['a', 'b', 'c'])
})

test('dos escaneos en el mismo milisegundo tienen un orden estable', () => {
  // Sin desempate, el orden dependería del motor de JS y variaría entre
  // reenvíos. Un orden inestable es un orden que no se puede razonar.
  const cola = [
    pendiente({ id: 'z', creadoEn: 1000 }),
    pendiente({ id: 'a', creadoEn: 1000 }),
  ]
  assert.deepEqual(ordenar(cola).map((p) => p.id), ['a', 'z'])
  assert.deepEqual(ordenar([...cola].reverse()).map((p) => p.id), ['a', 'z'])
})

test('se envía la más antigua que ya cumplió su espera', () => {
  const cola = [
    pendiente({ id: 'nueva', creadoEn: 5000, proximoIntento: 0 }),
    pendiente({ id: 'vieja', creadoEn: 1000, proximoIntento: 0 }),
  ]
  assert.equal(siguienteAEnviar(cola, 10_000)?.id, 'vieja')
})

test('nunca se envían dos a la vez', () => {
  // Paralelizar rompería el orden y multiplicaría las peticiones sobre una red
  // que ya está fallando.
  const cola = [
    pendiente({ id: 'a', creadoEn: 1000, estado: 'enviando' }),
    pendiente({ id: 'b', creadoEn: 2000, proximoIntento: 0 }),
  ]
  assert.equal(siguienteAEnviar(cola, 10_000), null)
})

test('sin conexión no se intenta nada', () => {
  const cola = [pendiente({ proximoIntento: 0 })]
  assert.equal(siguienteAEnviar(cola, 10_000, false), null)
  assert.notEqual(siguienteAEnviar(cola, 10_000, true), null)
})

test('una entrada esperando su turno no se toca antes de tiempo', () => {
  const cola = [pendiente({ proximoIntento: 10_000 })]
  assert.equal(siguienteAEnviar(cola, 9_999), null)
  assert.notEqual(siguienteAEnviar(cola, 10_000), null)
})

// ── Los reintentos ──────────────────────────────────────────────────────────

test('la espera crece y se topa', () => {
  assert.equal(esperaSiguiente(0), 0, 'el primer intento sale ya')
  assert.equal(esperaSiguiente(1), 2000)
  assert.equal(esperaSiguiente(2), 4000)
  assert.equal(esperaSiguiente(3), 8000)
  assert.equal(esperaSiguiente(4), 16000)
  assert.equal(esperaSiguiente(5), 32000)
  assert.equal(esperaSiguiente(50), 32000, 'no crece sin límite')
})

test('un error de red se reintenta', () => {
  const p = marcarFallo(pendiente(), 'Failed to fetch', 10_000)
  assert.equal(p.estado, 'pendiente')
  assert.equal(p.intentos, 1)
  assert.equal(p.proximoIntento, 12_000)
})

test('un QR ya usado NO se reintenta', () => {
  // Reintentarlo cuatro veces no lo arregla y retrasa a los que sí valen.
  const p = marcarFallo(pendiente(), 'Este QR ya fue utilizado. Pide al cliente su QR actualizado.')
  assert.equal(p.estado, 'descartada')
  assert.equal(p.intentos, 1, 'se descarta al primer intento')
})

test('los demás errores definitivos tampoco', () => {
  for (const mensaje of [
    'No quedan usos disponibles en esta promoción.',
    'No tienes permisos para confirmar visitas.',
    'Datos del canje incompletos.',
    'Sucursal no válida.',
    'Selecciona un servicio antes de confirmar.',
    'No se encontró la membresía. Escanea el QR de nuevo.',
    'Este cliente pertenece a otra empresa.',
    'La membresía ha vencido.',
  ]) {
    assert.equal(marcarFallo(pendiente(), mensaje).estado, 'descartada', mensaje)
  }
})

test('ante un error desconocido se REINTENTA', () => {
  // La regla: equivocarse hacia "reintenta" cuesta segundos; equivocarse hacia
  // "descarta" pierde el registro de un lavado que sí se hizo.
  assert.equal(marcarFallo(pendiente(), 'Error interno del servidor').estado, 'pendiente')
  assert.equal(marcarFallo(pendiente(), null).estado, 'pendiente')
  assert.equal(marcarFallo(pendiente(), '').estado, 'pendiente')
})

test('tras agotar los intentos se descarta y se conserva visible', () => {
  let p = pendiente()
  for (let i = 0; i < MAX_INTENTOS - 1; i++) {
    p = marcarFallo(p, 'network error')
    assert.equal(p.estado, 'pendiente', `intento ${i + 1}`)
  }
  p = marcarFallo(p, 'network error')
  assert.equal(p.estado, 'descartada')
  assert.equal(p.intentos, MAX_INTENTOS)
})

test('esDefinitivo reconoce el motivo dentro del mensaje REAL del servidor', () => {
  // Esta prueba es la que encontró que la lista estaba escrita contra los
  // códigos internos y no contra los mensajes que de verdad llegan. Ver el
  // comentario de MOTIVOS_DEFINITIVOS.
  assert.equal(
    esDefinitivo(normalizarMotivo('Este código QR ya fue utilizado. Pide al cliente que muestre su QR actualizado.')),
    true
  )
  assert.equal(esDefinitivo(normalizarMotivo('Tiempo de espera agotado')), false)
  assert.equal(esDefinitivo(normalizarMotivo('Error interno al confirmar la visita. Intenta de nuevo.')), false,
    'un error interno del servidor SÍ puede resolverse solo: se reintenta')
})

test('normalizarMotivo aguanta acentos y basura', () => {
  assert.equal(normalizarMotivo('No quedan usos disponibles'), 'no_quedan_usos_disponibles')
  assert.equal(normalizarMotivo('Promoción vencida'), 'promocion_vencida')
  assert.equal(normalizarMotivo('   '), 'desconocido')
  assert.equal(normalizarMotivo(undefined), 'desconocido')
})

// ── La limpieza ─────────────────────────────────────────────────────────────

test('lo enviado se limpia solo pasado un rato', () => {
  const enviada = marcarEnviada(pendiente(), 1000)
  assert.equal(limpiar([enviada], 1000 + MS_CONSERVAR_ENVIADA).length, 1, 'todavía se ve')
  assert.equal(limpiar([enviada], 1000 + MS_CONSERVAR_ENVIADA + 1).length, 0)
})

test('lo DESCARTADO no se limpia nunca solo', () => {
  // Cada descartada puede ser un lavado sin registrar. Que desaparezca sola es
  // exactamente cómo se pierde dinero sin que nadie se entere.
  const rota = marcarFallo(pendiente(), 'qr ya fue utilizado', 1000)
  assert.equal(limpiar([rota], 1000 + MS_CONSERVAR_ENVIADA * 100).length, 1)
})

test('las pendientes tampoco se limpian por antigüedad', () => {
  const p = pendiente({ creadoEn: 0, proximoIntento: 0 })
  assert.equal(limpiar([p], 99_999_999).length, 1)
})

// ── El resumen que ve el empleado ───────────────────────────────────────────

test('el resumen distingue lo que espera de lo que necesita a una persona', () => {
  const cola = [
    pendiente({ id: '1', estado: 'pendiente' }),
    pendiente({ id: '2', estado: 'enviando' }),
    pendiente({ id: '3', estado: 'descartada' }),
    pendiente({ id: '4', estado: 'enviada' }),
  ]
  const r = resumen(cola)
  assert.deepEqual(
    { p: r.pendientes, e: r.enviando, d: r.descartadas, t: r.total },
    { p: 1, e: 1, d: 1, t: 3 },
    'las enviadas no cuentan en el total: ya no hay nada que hacer con ellas'
  )
  assert.equal(r.requiereAtencion, true)
})

test('sin descartadas no se reclama la atención de nadie', () => {
  assert.equal(resumen([pendiente({ estado: 'pendiente' })]).requiereAtencion, false)
  assert.equal(resumen([]).total, 0)
})

// ── La ida y vuelta del formulario ──────────────────────────────────────────

test('lo que se guarda reconstruye exactamente lo que se envió', () => {
  // Si el reenvío mandara algo distinto de lo que el empleado confirmó, el
  // registro sería falso — y peor que no tenerlo.
  const original = new FormData()
  original.set('membershipId', 'm-1')
  original.set('servicio', 'Lavado completo')
  original.set('qrTokenId', 'tok-1')
  original.set('notas', 'Cliente pidió aspirado extra')

  const p = pendiente({ datos: desdeFormData(original) })
  const reconstruido = aFormData(p)

  for (const clave of ['membershipId', 'servicio', 'qrTokenId', 'notas']) {
    assert.equal(reconstruido.get(clave), original.get(clave), clave)
  }
})

test('los archivos no se guardan', () => {
  // No caben en el almacenamiento local y no se serializan a texto. Está
  // documentado en almacenCola.ts: el día que el escáner suba fotos sin
  // conexión, hay que pasar a IndexedDB.
  const fd = new FormData()
  fd.set('servicio', 'Lavado')
  fd.set('foto', new Blob(['x']), 'antes.jpg')
  assert.deepEqual(desdeFormData(fd), { servicio: 'Lavado' })
})

test('reemplazar conserva la cola y cambia solo una entrada', () => {
  const cola = [pendiente({ id: 'a' }), pendiente({ id: 'b' })]
  const nueva = reemplazar(cola, { ...cola[1], estado: 'enviada' })
  assert.equal(nueva.length, 2)
  assert.equal(nueva[0].estado, 'pendiente')
  assert.equal(nueva[1].estado, 'enviada')
})

// ── El escenario completo ───────────────────────────────────────────────────

test('caída de red: tres lavados, vuelve la red, se envían en orden', () => {
  let cola: Pendiente[] = []
  let t = 1000

  // Tres escaneos con la red caída.
  for (const nombre of ['carro-1', 'carro-2', 'carro-3']) {
    cola = [...cola, nuevaPendiente({ tipo: 'visita', datos: { servicio: nombre } }, t, nombre)]
    t += 60_000
  }
  assert.equal(siguienteAEnviar(cola, t, false), null, 'sin red no se intenta')

  // Vuelve la red: salen de una en una y en orden.
  const enviados: string[] = []
  for (let i = 0; i < 3; i++) {
    const p = siguienteAEnviar(cola, t, true)
    assert.ok(p, `debería quedar la ${i + 1}`)
    enviados.push(p.id)
    cola = reemplazar(cola, marcarEnviada(p, t))
  }
  assert.deepEqual(enviados, ['carro-1', 'carro-2', 'carro-3'])
  assert.equal(siguienteAEnviar(cola, t, true), null, 'no queda nada')
  assert.equal(resumen(cola).total, 0)
})
