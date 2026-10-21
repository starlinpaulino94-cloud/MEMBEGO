import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MARGEN_PRIMER_INTENTO_MS,
  POLITICA_RENOVACION,
  claveDeCiclo,
  clasificarCobro,
  decidirTrasRechazo,
  evaluarCiclo,
  inicioDelCiclo,
  rechazosDelCron,
  tocaRenovar,
  type IntentoDelCiclo,
} from '../src/modules/pagos/renovacionPolitica'

/**
 * TARJETAS GUARDADAS · ETAPA 5 — la política de renovación, ejecutada.
 *
 * Todo lo de aquí es puro: se prueba con valores y fechas fijas. Lo que escribe
 * en la base (reclamar el intento, apagar la renovación, avisar) se prueba contra
 * una base real en `tests/postgres/pagos-renovacion-politica.db.test.ts`.
 */

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA
const AHORA = new Date('2026-10-21T12:00:00Z')

const intento = (o: Partial<IntentoDelCiclo> & { haceMs?: number } = {}): IntentoDelCiclo => ({
  estado: 'RECHAZADO',
  createdAt: new Date(AHORA.getTime() - (o.haceMs ?? 25 * HORA)),
  activadoAt: null,
  fulfillmentEstado: 'PENDIENTE',
  clasificacion: null,
  delCron: true,
  ...o,
})

// ── Qué fue el cobro ────────────────────────────────────────────────────────

const cobro = (o: Partial<Parameters<typeof clasificarCobro>[0]> = {}) =>
  clasificarCobro({ aprobada: false, codigo: '', requiereActivacion: false, httpStatus: 200, ...o })

test('un cobro aprobado es aprobado, sin importar lo demás', () => {
  assert.equal(cobro({ aprobada: true, httpStatus: 200, codigo: '00' }), 'aprobada')
})

test('«sin respuesta» NO es un rechazo: es un cobro de resultado desconocido', () => {
  // El caso que justifica todo este módulo: un timeout puede haber cobrado. Si
  // se tratara como rechazo se le diría al cliente «no se cobró» y el cron
  // volvería a cobrar mañana.
  assert.equal(cobro({ httpStatus: 0 }), 'incierto')
  assert.equal(cobro({ httpStatus: undefined }), 'incierto')
  assert.equal(cobro({ httpStatus: null }), 'incierto')
})

test('un error del servidor de la pasarela es incierto aunque traiga un código', () => {
  // Con un 5xx ningún código del cuerpo es de fiar: la transacción pudo haberse
  // procesado a medias.
  assert.equal(cobro({ httpStatus: 500, codigo: '51' }), 'incierto')
  assert.equal(cobro({ httpStatus: 503 }), 'incierto')
})

test('el código 94 («este pago ya se procesó») NO es un rechazo', () => {
  // Decirle al cliente que «no se cobró» cuando el banco dice que ya se hizo.
  assert.equal(cobro({ codigo: '94' }), 'incierto')
})

test('un código del banco es un rechazo reintentable', () => {
  for (const codigo of ['51', '05', '61', '91', '96', '97', '99']) {
    assert.equal(cobro({ codigo }), 'rechazo', `código ${codigo}`)
  }
})

test('tarjeta vencida, reportada o inválida: el rechazo es definitivo', () => {
  for (const codigo of ['54', '41', '43', '14']) {
    assert.equal(cobro({ codigo }), 'rechazo_definitivo', `código ${codigo}`)
  }
})

test('un perfil sin activar es un rechazo definitivo: reintentar no lo activa', () => {
  assert.equal(cobro({ requiereActivacion: true }), 'rechazo_definitivo')
})

test('la pasarela que ni procesó la petición es un fallo técnico, no un rechazo', () => {
  // Llave inválida o ruta que no existe: seguro que no se cobró y no es culpa del
  // cliente, así que ni cuenta como intento suyo ni se le avisa.
  for (const httpStatus of [401, 403, 404]) {
    assert.equal(cobro({ httpStatus }), 'tecnico', `HTTP ${httpStatus}`)
  }
})

test('sin código y sin razón clara de que no se procesó, es incierto', () => {
  // Una respuesta 200 o 400 sin código no dice nada: es el caso que más importa
  // que NO se convierta en «tu banco rechazó la tarjeta».
  assert.equal(cobro({ httpStatus: 200, codigo: '' }), 'incierto')
  assert.equal(cobro({ httpStatus: 400, codigo: '' }), 'incierto')
})

test('el código se limpia de espacios antes de clasificarlo', () => {
  assert.equal(cobro({ codigo: ' 54 ' }), 'rechazo_definitivo')
  assert.equal(cobro({ codigo: ' 94 ' }), 'incierto')
})

// ── El ciclo ────────────────────────────────────────────────────────────────

test('sin intentos previos se puede cobrar', () => {
  assert.deepEqual(evaluarCiclo([], AHORA), { permitido: true })
})

test('un intento de hace menos de 20 h frena el siguiente', () => {
  for (const haceMs of [0, HORA, 12 * HORA, 19 * HORA]) {
    assert.deepEqual(
      evaluarCiclo([intento({ haceMs })], AHORA),
      { permitido: false, motivo: 'reciente' },
      `hace ${haceMs / HORA} h`
    )
  }
})

test('a partir de 20 h el siguiente día de cron sí puede intentar', () => {
  assert.deepEqual(evaluarCiclo([intento({ haceMs: 20 * HORA })], AHORA), { permitido: true })
  assert.deepEqual(evaluarCiclo([intento({ haceMs: 24 * HORA })], AHORA), { permitido: true })
})

test('con el tope de rechazos ya no se cobra más', () => {
  const tres = [30, 54, 78].map((h) => intento({ haceMs: h * HORA }))
  assert.deepEqual(evaluarCiclo(tres, AHORA), { permitido: false, motivo: 'agotado' })
  // Con dos todavía queda uno.
  assert.deepEqual(evaluarCiclo(tres.slice(0, 2), AHORA), { permitido: true })
})

test('solo los RECHAZOS cuentan para el tope: un fallo técnico no gasta intentos', () => {
  const intentos = [30, 54, 78].map((h) =>
    intento({ haceMs: h * HORA, estado: 'ERROR', clasificacion: 'tecnico' })
  )
  assert.deepEqual(evaluarCiclo(intentos, AHORA), { permitido: true })
})

test('un intento de resultado desconocido bloquea el ciclo entero', () => {
  // El caso del doble cargo: el primer intento se cayó sin respuesta. Puede
  // haber cobrado. Mañana NO se vuelve a cobrar solo.
  const r = evaluarCiclo([intento({ estado: 'ERROR', clasificacion: 'incierto', haceMs: 30 * HORA })], AHORA)
  assert.deepEqual(r, { permitido: false, motivo: 'incierto' })
})

test('un intento que quedó CREADO sin cerrar se da por perdido: tampoco se repite', () => {
  // El proceso murió entre reclamar el intento y guardar el resultado. No se
  // sabe si llegó a cobrar.
  const r = evaluarCiclo([intento({ estado: 'CREADO', haceMs: 2 * HORA })], AHORA)
  assert.deepEqual(r, { permitido: false, motivo: 'incierto' })
})

test('un intento CREADO reciente está en curso: se espera, no se da por perdido', () => {
  const r = evaluarCiclo([intento({ estado: 'CREADO', haceMs: 2 * 60 * 1000 })], AHORA)
  assert.deepEqual(r, { permitido: false, motivo: 'reciente' })
})

test('un cobro aprobado que no extendió la membresía bloquea: ya se cobró', () => {
  // Cobró y la extensión falló. La membresía sigue pareciendo por vencer, así que
  // el cron la elegiría de nuevo y cobraría OTRA vez.
  const r = evaluarCiclo(
    [
      intento({
        estado: 'APROBADO',
        activadoAt: new Date(AHORA.getTime() - 30 * HORA),
        fulfillmentEstado: 'FALLIDA',
        haceMs: 30 * HORA,
      }),
    ],
    AHORA
  )
  assert.deepEqual(r, { permitido: false, motivo: 'cobrado' })
})

test('un cobro aprobado Y entregado no bloquea: es una renovación normal', () => {
  const r = evaluarCiclo(
    [
      intento({
        estado: 'APROBADO',
        activadoAt: new Date(AHORA.getTime() - 30 * HORA),
        fulfillmentEstado: 'COMPLETADA',
        haceMs: 30 * HORA,
      }),
    ],
    AHORA
  )
  assert.deepEqual(r, { permitido: true })
})

test('«cobrado» gana sobre todo lo demás: es el caso más grave', () => {
  const r = evaluarCiclo(
    [
      intento({ estado: 'RECHAZADO', haceMs: 2 * HORA }),
      intento({ estado: 'APROBADO', activadoAt: new Date(), fulfillmentEstado: 'PENDIENTE', haceMs: 50 * HORA }),
    ],
    AHORA
  )
  assert.deepEqual(r, { permitido: false, motivo: 'cobrado' })
})

test('los rechazos del CLIENTE no gastan los intentos del cron', () => {
  // Un cliente que probó a pagar a mano tres veces no deja a su renovación
  // automática sin intentos.
  const manuales = [30, 54, 78].map((h) => intento({ haceMs: h * HORA, delCron: false }))
  assert.equal(rechazosDelCron(manuales), 0)
  assert.deepEqual(evaluarCiclo(manuales, AHORA), { permitido: true })
  // Mezclados, solo cuentan los del cron.
  const mezcla = [...manuales, intento({ haceMs: 26 * HORA })]
  assert.equal(rechazosDelCron(mezcla), 1)
})

test('un intento del CLIENTE sí frena el cobro encima: está pagando ahora mismo', () => {
  // Doble pago: el cliente está en la pantalla de pago y el cron dispara.
  for (const estado of ['CREADO', 'REDIRIGIDO']) {
    const r = evaluarCiclo([intento({ estado, haceMs: 60 * 1000, delCron: false })], AHORA)
    assert.equal(r.permitido, false, estado)
  }
  assert.deepEqual(
    evaluarCiclo([intento({ estado: 'RECHAZADO', haceMs: 2 * HORA, delCron: false })], AHORA),
    { permitido: false, motivo: 'reciente' }
  )
})

test('un cobro del cliente que no se le entregó también bloquea', () => {
  const r = evaluarCiclo(
    [
      intento({
        estado: 'APROBADO',
        delCron: false,
        activadoAt: new Date(AHORA.getTime() - 30 * HORA),
        fulfillmentEstado: 'FALLIDA',
        haceMs: 30 * HORA,
      }),
    ],
    AHORA
  )
  assert.deepEqual(r, { permitido: false, motivo: 'cobrado' })
})

// ── ¿Toca renovar ahora? ────────────────────────────────────────────────────

const toca = (o: Partial<Parameters<typeof tocaRenovar>[0]> = {}) =>
  tocaRenovar({
    vencimiento: new Date(AHORA.getTime() + 2 * DIA),
    fechaPago: null,
    ahora: AHORA,
    graciaMs: 3 * DIA,
    ...o,
  })

test('toca renovar dentro de la ventana: desde el margen hasta la gracia', () => {
  assert.deepEqual(toca(), { toca: true })
  assert.deepEqual(toca({ vencimiento: new Date(AHORA.getTime() + MARGEN_PRIMER_INTENTO_MS) }), { toca: true })
  assert.deepEqual(toca({ vencimiento: new Date(AHORA.getTime() - 2 * DIA) }), { toca: true })
})

test('no toca si falta más que el margen del primer intento', () => {
  assert.deepEqual(
    toca({ vencimiento: new Date(AHORA.getTime() + MARGEN_PRIMER_INTENTO_MS + 1) }),
    { toca: false, razon: 'todavia_no' }
  )
})

test('no toca resucitar una membresía vencida hace más de la gracia', () => {
  assert.deepEqual(
    toca({ vencimiento: new Date(AHORA.getTime() - 3 * DIA - 1) }),
    { toca: false, razon: 'ya_vencio' }
  )
})

test('sin fecha de vencimiento no hay nada que renovar', () => {
  assert.deepEqual(toca({ vencimiento: null }), { toca: false, razon: 'sin_fecha' })
  assert.deepEqual(toca({ vencimiento: undefined }), { toca: false, razon: 'sin_fecha' })
})

test('REGRESIÓN: un segundo cron que llega tras la renovación no cobra otra vez', () => {
  // Dos crons listan la misma membresía. El primero renueva: el vencimiento salta
  // un período adelante y `fechaPago` queda en este instante. El segundo lee ese
  // estado NUEVO. El ciclo también se movió, así que ya no ve el intento del
  // primero: sin esta comprobación cobraría dos veces.
  const renovada = {
    vencimiento: new Date(AHORA.getTime() + 30 * DIA),
    fechaPago: new Date(AHORA.getTime() - 5_000),
  }
  assert.deepEqual(toca(renovada), { toca: false, razon: 'todavia_no' })
})

test('REGRESIÓN con un plan tan corto que el vencimiento nuevo vuelve a caer en el margen', () => {
  // Plan de 2 días: tras renovar, el vencimiento queda a 2 días, DENTRO del
  // margen de 3. La ventana por sí sola diría «toca». Lo detiene «pagada hace
  // poco».
  const renovada = {
    vencimiento: new Date(AHORA.getTime() + 2 * DIA),
    fechaPago: new Date(AHORA.getTime() - 5_000),
  }
  assert.deepEqual(toca(renovada), { toca: false, razon: 'pagada_hace_poco' })
  // Y al día siguiente, con la renovación de ayer, sí vuelve a tocar.
  assert.deepEqual(
    toca({ ...renovada, fechaPago: new Date(AHORA.getTime() - 24 * HORA) }),
    { toca: true }
  )
})

test('pagar a mano hace poco también frena el cobro automático', () => {
  assert.deepEqual(
    toca({ fechaPago: new Date(AHORA.getTime() - 10 * HORA) }),
    { toca: false, razon: 'pagada_hace_poco' }
  )
  assert.deepEqual(toca({ fechaPago: new Date(AHORA.getTime() - 20 * HORA) }), { toca: true })
})

// ── Desde cuándo cuenta el ciclo ────────────────────────────────────────────

test('el ciclo se abre antes de que el cron pueda elegir la membresía', () => {
  const venc = new Date('2026-10-24T18:00:00Z')
  const abre = inicioDelCiclo(venc, null)
  // El cron la elige a 3 días del vencimiento; el ciclo abre media jornada antes.
  assert.equal(abre.getTime(), venc.getTime() - MARGEN_PRIMER_INTENTO_MS - 12 * HORA)
})

test('el ciclo nunca empieza antes del último pago', () => {
  // Plan corto: la renovación anterior cae DENTRO de la ventana del ciclo
  // siguiente. Sin este suelo contaría como un intento de éste.
  const venc = new Date('2026-10-24T18:00:00Z')
  const fechaPago = new Date('2026-10-22T10:00:00Z')
  assert.equal(inicioDelCiclo(venc, fechaPago).getTime(), fechaPago.getTime())
  // Y un pago viejo no lo adelanta.
  assert.equal(
    inicioDelCiclo(venc, new Date('2026-09-01T00:00:00Z')).getTime(),
    venc.getTime() - MARGEN_PRIMER_INTENTO_MS - 12 * HORA
  )
})

test('la clave del ciclo es la fecha de vencimiento', () => {
  assert.equal(claveDeCiclo(new Date('2026-10-24T18:00:00Z')), '2026-10-24')
})

// ── Qué pasa tras un rechazo ────────────────────────────────────────────────

const venceEnDias = (d: number) => new Date(AHORA.getTime() + d * DIA)

test('el primer rechazo, con tiempo por delante: se reintenta', () => {
  assert.deepEqual(
    decidirTrasRechazo({ clase: 'rechazo', rechazosEnCiclo: 1, ahora: AHORA, vencimiento: venceEnDias(2) }),
    { accion: 'reintentar' }
  )
})

test('un rechazo definitivo apaga la renovación en el acto', () => {
  assert.deepEqual(
    decidirTrasRechazo({ clase: 'rechazo_definitivo', rechazosEnCiclo: 1, ahora: AHORA, vencimiento: venceEnDias(3) }),
    { accion: 'desactivar', causa: 'definitivo' }
  )
})

test('al llegar al tope de rechazos se apaga', () => {
  assert.deepEqual(
    decidirTrasRechazo({
      clase: 'rechazo',
      rechazosEnCiclo: POLITICA_RENOVACION.maxRechazosPorCiclo,
      ahora: AHORA,
      vencimiento: venceEnDias(3),
    }),
    { accion: 'desactivar', causa: 'agotado' }
  )
})

test('sin tiempo para otro intento antes de vencer, se apaga y se dice la verdad', () => {
  // Vence en 10 h: el siguiente cron caería después. «Lo reintentaremos» sería
  // prometer algo que no va a ocurrir.
  assert.deepEqual(
    decidirTrasRechazo({ clase: 'rechazo', rechazosEnCiclo: 1, ahora: AHORA, vencimiento: new Date(AHORA.getTime() + 10 * HORA) }),
    { accion: 'desactivar', causa: 'sin_tiempo' }
  )
})

test('el reintento exige que el siguiente cron caiga ANTES del vencimiento', () => {
  const justo = new Date(AHORA.getTime() + POLITICA_RENOVACION.horizonteDeReintentoMs)
  assert.deepEqual(
    decidirTrasRechazo({ clase: 'rechazo', rechazosEnCiclo: 1, ahora: AHORA, vencimiento: justo }),
    { accion: 'reintentar' }
  )
  assert.deepEqual(
    decidirTrasRechazo({ clase: 'rechazo', rechazosEnCiclo: 1, ahora: AHORA, vencimiento: new Date(justo.getTime() - 1) }),
    { accion: 'desactivar', causa: 'sin_tiempo' }
  )
})

test('la política es coherente: tres intentos caben con un cron diario', () => {
  // Si el margen del primer intento bajara a 1 día, «3 intentos» volvería a ser
  // imposible (el job de vencimientos pasa la membresía a VENCIDA antes). Esta
  // prueba es el recordatorio de por qué el margen es el que es.
  const p = POLITICA_RENOVACION
  assert.ok(
    p.diasAntesDelPrimerIntento >= p.maxRechazosPorCiclo,
    'el margen tiene que dejar al menos un día de cron por cada intento'
  )
  assert.ok(p.avisoPrevioDias > p.diasAntesDelPrimerIntento, 'el aviso tiene que llegar antes del primer cobro')
  assert.ok(p.espaciadoMinimoMs < DIA, 'el espaciado debe dejar pasar el siguiente día de cron')
  assert.ok(p.horizonteDeReintentoMs >= DIA, 'el siguiente intento no puede estar a menos de un día de cron')
})
