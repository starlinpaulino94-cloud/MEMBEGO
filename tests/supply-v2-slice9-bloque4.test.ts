import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPACIDADES,
  CIFRAS_EN_CERO,
  CONDICIONES,
  ETIQUETA_CAPACIDAD,
  ETIQUETA_CONDICION,
  ORDEN_ESTADO,
  ORDEN_SEVERIDAD,
  QUE_APAGA,
  UMBRALES_POR_DEFECTO,
  banderaActiva,
  capacidadEfectiva,
  componentesDeSalud,
  enmascarar,
  enteroPositivo,
  estadoDelSistema,
  evaluarAlertas,
  interpretarBusqueda,
  minutosDesde,
  peorEstado,
  secretoValido,
  transicionDeAlerta,
  umbralesDelEntorno,
  type CifrasOperativas,
  type EntradaDeSalud,
  type EstadoComponente,
} from '../src/modules/supply-v2/operations/salud-dominio'
import { HTTP_DE_CODIGO, MENSAJE_DE_CODIGO, invitaAReintentar } from '../src/modules/supply-v2/operations/respuestas'
import { SUPPLY_V2_PERMISSIONS, SUPPLY_V2_PERMISSION_LABELS } from '../src/modules/supply-v2/contracts/gateways'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · DOMINIO (§31).
 *
 * El juicio operativo, puro: estados de componente, umbrales, banderas,
 * interruptores, readiness, agregación de alertas, su máquina de estados, el
 * intérprete de búsqueda, el orden de severidad y el enmascarado.
 *
 * `npm test`.
 */

const UMBRALES = UMBRALES_POR_DEFECTO

function entrada(p: {
  cifras?: Partial<CifrasOperativas>
  baseViva?: boolean
  derivaDeEsquema?: boolean
  config?: { clave: string; estado: 'CONFIGURED' | 'MISSING' | 'INVALID' | 'DISABLED' }[]
  capacidades?: Partial<Record<(typeof CAPACIDADES)[number], boolean>>
} = {}): EntradaDeSalud {
  return {
    cifras: { ...CIFRAS_EN_CERO, ...p.cifras },
    baseViva: p.baseViva ?? true,
    derivaDeEsquema: p.derivaDeEsquema ?? false,
    configuracion: p.config ?? [
      { clave: 'SUPPLY_V2_WEBHOOK_ACTOR_ID', estado: 'CONFIGURED' },
      { clave: 'SUPPLY_V2_TEST_GATEWAY_SECRET', estado: 'CONFIGURED' },
    ],
    capacidades: {
      SUPPLY_V2_EXTERNAL_PAYMENTS: true,
      SUPPLY_V2_OUTBOX_DELIVERY: true,
      SUPPLY_V2_RECONCILIATION_SWEEP: true,
      SUPPLY_V2_OPERATIONS_CENTER: true,
      ...p.capacidades,
    },
    umbrales: UMBRALES,
  }
}

const componente = (e: EntradaDeSalud, clave: string) => componentesDeSalud(e).find((c) => c.clave === clave)!

// ── 1 a 4 · los cuatro estados, cada uno de un dato ─────────────────────────

test('1 · un componente sano lo dice porque los números lo dicen, no porque exista', () => {
  const c = componente(entrada(), 'outbox')
  assert.equal(c.estado, 'HEALTHY')
  assert.match(c.detalle, /Sin efectos pendientes/)
  // Y con cosas en cola pero recientes, sigue sano y lo explica con la cifra.
  const conCola = componente(entrada({ cifras: { outboxPendiente: 3, outboxMasViejoMin: 2 } }), 'outbox')
  assert.equal(conCola.estado, 'HEALTHY')
  assert.match(conCola.detalle, /3 efecto/)
})

test('2 · DEGRADADO: funciona y hay trabajo acumulado', () => {
  // Por encima del umbral de aviso, por debajo del crítico.
  const porEdad = componente(entrada({ cifras: { outboxPendiente: 4, outboxMasViejoMin: UMBRALES.outboxPendienteAviso } }), 'outbox')
  assert.equal(porEdad.estado, 'DEGRADED')
  assert.match(porEdad.detalle, new RegExp(String(UMBRALES.outboxPendienteAviso)))

  assert.equal(componente(entrada({ cifras: { outboxMuertos: 1 } }), 'outbox').estado, 'DEGRADED')
  assert.equal(componente(entrada({ cifras: { difuntosDeCola: 1 } }), 'trabajos').estado, 'DEGRADED')
  assert.equal(componente(entrada({ cifras: { incidentesAltos: 1 } }), 'conciliacion').estado, 'DEGRADED')
  assert.equal(componente(entrada({ cifras: { discrepancias: 2 } }), 'conciliacion').estado, 'DEGRADED')
  assert.equal(componente(entrada({ cifras: { eventosMuertos: 1 } }), 'pagos').estado, 'DEGRADED')
})

test('3 · NO DISPONIBLE: no se puede operar', () => {
  // La base caída es lo único que tumba todo.
  const sinBase = entrada({ baseViva: false })
  assert.equal(componente(sinBase, 'base').estado, 'UNAVAILABLE')
  assert.equal(estadoDelSistema(componentesDeSalud(sinBase)), 'UNAVAILABLE')

  // Un outbox parado más allá del umbral crítico no es «lento»: no está
  // corriendo la entrega.
  const parado = componente(entrada({ cifras: { outboxPendiente: 9, outboxMasViejoMin: UMBRALES.outboxPendienteCritico } }), 'outbox')
  assert.equal(parado.estado, 'UNAVAILABLE')

  // Pagos encendidos y sin configurar: no se puede aceptar un aviso.
  const sinSecreto = componente(
    entrada({ config: [{ clave: 'SUPPLY_V2_TEST_GATEWAY_SECRET', estado: 'MISSING' }, { clave: 'SUPPLY_V2_WEBHOOK_ACTOR_ID', estado: 'CONFIGURED' }] }),
    'pagos'
  )
  assert.equal(sinSecreto.estado, 'UNAVAILABLE')
})

test('4 · APAGADO no es avería, y no arrastra el total a rojo', () => {
  const e = entrada({ capacidades: { SUPPLY_V2_EXTERNAL_PAYMENTS: false } })
  const pagos = componente(e, 'pagos')
  assert.equal(pagos.estado, 'NOT_CONFIGURED')
  assert.match(pagos.detalle, /a propósito/)
  // El sistema sigue sano: lo apagado por decisión no cuenta como roto.
  assert.equal(estadoDelSistema(componentesDeSalud(e)), 'HEALTHY')

  // Y si falta el secreto de algo APAGADO, tampoco es avería.
  const apagadoYSinSecreto = entrada({
    capacidades: { SUPPLY_V2_EXTERNAL_PAYMENTS: false },
    config: [{ clave: 'SUPPLY_V2_TEST_GATEWAY_SECRET', estado: 'DISABLED' }, { clave: 'SUPPLY_V2_WEBHOOK_ACTOR_ID', estado: 'DISABLED' }],
  })
  assert.equal(componente(apagadoYSinSecreto, 'pagos').estado, 'NOT_CONFIGURED')
  assert.equal(estadoDelSistema(componentesDeSalud(apagadoYSinSecreto)), 'HEALTHY')
})

test('4a · la deriva de esquema degrada, no tumba: la base responde', () => {
  const c = componente(entrada({ derivaDeEsquema: true }), 'base')
  assert.equal(c.estado, 'DEGRADED')
  assert.match(c.detalle, /migraciones pendientes/)
})

// ── 5 y 6 · banderas e interruptores ───────────────────────────────────────

test('5 · la bandera por defecto está ENCENDIDA, y solo un valor negativo la apaga', () => {
  // Lo seguro aquí no es «apagado»: la protección de este camino es la firma,
  // la cuenta de integración y la conciliación, que fallan cerrado cada una.
  // Una bandera apagada por defecto dejaría de aceptar avisos en silencio.
  assert.equal(banderaActiva('SUPPLY_V2_EXTERNAL_PAYMENTS', {}), true)
  assert.equal(banderaActiva('SUPPLY_V2_EXTERNAL_PAYMENTS', { SUPPLY_V2_EXTERNAL_PAYMENTS: '' }), true)
  for (const v of ['false', 'FALSE', '0', 'off', 'no', ' No ']) {
    assert.equal(banderaActiva('SUPPLY_V2_EXTERNAL_PAYMENTS', { SUPPLY_V2_EXTERNAL_PAYMENTS: v }), false, v)
  }
  for (const v of ['true', '1', 'on', 'si', 'cualquier-cosa']) {
    assert.equal(banderaActiva('SUPPLY_V2_EXTERNAL_PAYMENTS', { SUPPLY_V2_EXTERNAL_PAYMENTS: v }), true, v)
  }
})

test('6 · el interruptor apaga aunque la bandera esté encendida, y hacen falta las dos para funcionar', () => {
  const env = { SUPPLY_V2_EXTERNAL_PAYMENTS: 'true' }
  // Nadie lo ha tocado → manda la bandera.
  assert.equal(capacidadEfectiva('SUPPLY_V2_EXTERNAL_PAYMENTS', undefined, env), true)
  // Apagado en la base → apagado, pese a la bandera.
  assert.equal(capacidadEfectiva('SUPPLY_V2_EXTERNAL_PAYMENTS', false, env), false)
  // Encendido en la base pero bandera apagada → apagado. Para apagar basta una.
  assert.equal(capacidadEfectiva('SUPPLY_V2_EXTERNAL_PAYMENTS', true, { SUPPLY_V2_EXTERNAL_PAYMENTS: 'false' }), false)
})

test('6a · lo que un interruptor NO apaga queda escrito, capacidad por capacidad', () => {
  for (const clave of CAPACIDADES) {
    const q = QUE_APAGA[clave]
    assert.ok(q.corta.length > 0, `${clave} dice qué corta`)
    assert.ok(q.conserva.length > 0, `${clave} dice qué conserva`)
    assert.ok(ETIQUETA_CAPACIDAD[clave].length > 5, `${clave} tiene etiqueta legible`)
  }
  // El caso que importa: apagar los pagos NO apaga el panel ni la
  // investigación. Si lo hiciera, nadie podría ver por qué se apagó.
  const pagos = QUE_APAGA.SUPPLY_V2_EXTERNAL_PAYMENTS.conserva.join(' ')
  assert.match(pagos, /Centro de Operaciones/)
  assert.match(pagos, /incidentes/)
  // Y apagar el panel no apaga el procesamiento.
  assert.match(QUE_APAGA.SUPPLY_V2_OPERATIONS_CENTER.conserva.join(' '), /no apaga el sistema/)
})

// ── 7 a 9 · readiness ──────────────────────────────────────────────────────

test('7 · encendido y configurado: listo', () => {
  assert.equal(estadoDelSistema(componentesDeSalud(entrada())), 'HEALTHY')
})

test('8 · encendido y SIN configurar: no listo', () => {
  const e = entrada({
    config: [{ clave: 'SUPPLY_V2_WEBHOOK_ACTOR_ID', estado: 'MISSING' }, { clave: 'SUPPLY_V2_TEST_GATEWAY_SECRET', estado: 'CONFIGURED' }],
  })
  assert.equal(estadoDelSistema(componentesDeSalud(e)), 'UNAVAILABLE')
  assert.equal(componente(e, 'config').estado, 'UNAVAILABLE')
})

test('9 · apagado a propósito: listo, con el componente apagado', () => {
  // Es la distinción de §26, y la que evita que un entorno sin pasarela
  // aparezca eternamente en rojo.
  const e = entrada({
    capacidades: { SUPPLY_V2_EXTERNAL_PAYMENTS: false },
    config: [{ clave: 'SUPPLY_V2_WEBHOOK_ACTOR_ID', estado: 'DISABLED' }, { clave: 'SUPPLY_V2_TEST_GATEWAY_SECRET', estado: 'DISABLED' }],
  })
  assert.equal(estadoDelSistema(componentesDeSalud(e)), 'HEALTHY')
  assert.equal(componente(e, 'pagos').estado, 'NOT_CONFIGURED')
})

// ── 10 y 11 · umbrales ─────────────────────────────────────────────────────

test('10 · el umbral de aviso avisa, y es configurable', () => {
  const u = umbralesDelEntorno({ SUPPLY_V2_OUTBOX_PENDING_WARN_MINUTES: '5', SUPPLY_V2_OUTBOX_PENDING_CRITICAL_MINUTES: '30' })
  assert.equal(u.outboxPendienteAviso, 5)
  assert.equal(u.outboxPendienteCritico, 30)
  // Un valor absurdo NO apaga la vigilancia: se vuelve al de siempre.
  for (const malo of ['0', '-3', 'mucho', '', undefined, '1.5']) {
    assert.equal(enteroPositivo(malo, 15), 15, String(malo))
  }
  assert.deepEqual(umbralesDelEntorno({}), UMBRALES_POR_DEFECTO)
})

test('11 · el umbral crítico nunca queda por debajo del de aviso', () => {
  // Si alguien los invierte, lo grave avisaría más tarde que lo leve.
  const u = umbralesDelEntorno({ SUPPLY_V2_OUTBOX_PENDING_WARN_MINUTES: '60', SUPPLY_V2_OUTBOX_PENDING_CRITICAL_MINUTES: '10' })
  assert.equal(u.outboxPendienteAviso, 60)
  assert.equal(u.outboxPendienteCritico, 60, 'el crítico se sube al del aviso')
})

// ── 12 a 14 · alertas ──────────────────────────────────────────────────────

test('12 · UNA alerta por condición, con la cuenta dentro', () => {
  const alertas = evaluarAlertas(entrada({ cifras: { outboxPendiente: 23, outboxMasViejoMin: 17 } }))
  const backlog = alertas.filter((a) => a.condicion === 'OUTBOX_BACKLOG')
  assert.equal(backlog.length, 1, '23 efectos no son 23 alertas')
  assert.equal(backlog[0]!.cuenta, 23)
  assert.equal(backlog[0]!.detalle.masViejoMin, 17)
  assert.match(backlog[0]!.resumen, /23 efecto/)
  assert.match(backlog[0]!.resumen, /17 min/)
})

test('12a · cada condición tiene etiqueta y las graves van primero', () => {
  for (const c of CONDICIONES) assert.ok(ETIQUETA_CONDICION[c].length > 5, c)
  const alertas = evaluarAlertas(entrada({ cifras: { incidentesAltos: 1, difuntosDeCola: 1, outboxMuertos: 1 } }))
  assert.ok(alertas.length >= 3)
  // Lo crítico arriba: es el orden en que un operador quiere la cola.
  assert.equal(alertas[0]!.severidad, 'CRITICAL')
  for (let i = 1; i < alertas.length; i++) {
    assert.ok(ORDEN_SEVERIDAD[alertas[i - 1]!.severidad] <= ORDEN_SEVERIDAD[alertas[i]!.severidad])
  }
})

test('12b · el backlog es crítico pasado el umbral crítico, y no antes', () => {
  const aviso = evaluarAlertas(entrada({ cifras: { outboxPendiente: 1, outboxMasViejoMin: UMBRALES.outboxPendienteAviso } }))
  assert.equal(aviso.find((a) => a.condicion === 'OUTBOX_BACKLOG')!.severidad, 'WARNING')
  const critico = evaluarAlertas(entrada({ cifras: { outboxPendiente: 1, outboxMasViejoMin: UMBRALES.outboxPendienteCritico } }))
  assert.equal(critico.find((a) => a.condicion === 'OUTBOX_BACKLOG')!.severidad, 'CRITICAL')
})

test('12c · una capacidad apagada no genera la alerta de su propio atraso', () => {
  // Si la entrega está apagada a propósito, que haya efectos esperando es la
  // consecuencia esperada, no una alerta que despierte a nadie.
  const alertas = evaluarAlertas(
    entrada({ cifras: { outboxPendiente: 50, outboxMasViejoMin: 999 }, capacidades: { SUPPLY_V2_OUTBOX_DELIVERY: false } })
  )
  assert.equal(alertas.find((a) => a.condicion === 'OUTBOX_BACKLOG'), undefined)
})

test('13 · reconocer no reabre: la alerta se queda reconocida mientras la condición siga', () => {
  assert.equal(transicionDeAlerta(null, true), 'ACTIVE', 'nueva')
  assert.equal(transicionDeAlerta('ACTIVE', true), null, 'sigue igual')
  assert.equal(transicionDeAlerta('ACKNOWLEDGED', true), null, 'no se vuelve a gritar')
  assert.equal(transicionDeAlerta('RESOLVED', true), 'ACTIVE', 'si vuelve, es nueva')
})

test('14 · la alerta se cierra porque la condición desapareció, no porque alguien la cerrara', () => {
  assert.equal(transicionDeAlerta('ACTIVE', false), 'RESOLVED')
  assert.equal(transicionDeAlerta('ACKNOWLEDGED', false), 'RESOLVED')
  assert.equal(transicionDeAlerta('RESOLVED', false), null)
  assert.equal(transicionDeAlerta(null, false), null)
})

// ── 15 · el intérprete de búsqueda ─────────────────────────────────────────

test('15 · el texto se interpreta ANTES de consultar, para buscar por índice', () => {
  assert.deepEqual(interpretarBusqueda('MBG-SO-000123'), { tipo: 'ORDEN', valor: 'MBG-SO-000123' })
  assert.deepEqual(interpretarBusqueda('  mbg-so-000123 '), { tipo: 'ORDEN', valor: 'MBG-SO-000123' })
  assert.equal(interpretarBusqueda('sv2-abc-123').tipo, 'CORRELACION')
  assert.equal(interpretarBusqueda('TX-9').tipo, 'TRANSACCION')
  assert.equal(interpretarBusqueda('evt_abc123').tipo, 'EVENTO_EXTERNO')
  assert.equal(interpretarBusqueda('cmur9kvlc00107ds89ixrkj8y').tipo, 'ID')
  // Lo que no tiene forma reconocible NO se busca con `%texto%`: se dice que no
  // se sabe qué es.
  for (const basura of ['', '   ', 'juan', '12345', 'select * from']) {
    assert.equal(interpretarBusqueda(basura).tipo, 'DESCONOCIDO', basura)
  }
})

// ── 16 · orden de severidad ────────────────────────────────────────────────

test('16 · el orden pone lo peor primero', () => {
  assert.equal(peorEstado(['HEALTHY', 'DEGRADED', 'UNAVAILABLE']), 'UNAVAILABLE')
  assert.equal(peorEstado(['HEALTHY', 'NOT_CONFIGURED']), 'NOT_CONFIGURED')
  assert.equal(peorEstado([]), 'HEALTHY')
  const estados: EstadoComponente[] = ['UNAVAILABLE', 'DEGRADED', 'NOT_CONFIGURED', 'HEALTHY']
  for (let i = 1; i < estados.length; i++) {
    assert.ok(ORDEN_ESTADO[estados[i - 1]!] < ORDEN_ESTADO[estados[i]!])
  }
  // Todo apagado: el sistema no está roto, está apagado.
  assert.equal(estadoDelSistema([{ estado: 'NOT_CONFIGURED' }, { estado: 'NOT_CONFIGURED' }]), 'NOT_CONFIGURED')
})

// ── 17 · enmascarado ───────────────────────────────────────────────────────

test('17 · de un secreto solo sale que está, ni los últimos caracteres', () => {
  assert.equal(enmascarar('sv2-secreto-larguisimo-de-produccion'), 'configurado')
  assert.equal(enmascarar(''), 'sin configurar')
  assert.equal(enmascarar(undefined), 'sin configurar')
  // Lo que NO puede pasar: que el valor aparezca entero o en parte.
  const valor = 'SECRETO-REAL-123456'
  assert.ok(!enmascarar(valor).includes('SECRETO'))
  assert.ok(!enmascarar(valor).includes('3456'))
})

test('17a · «está puesto» no basta: se comprueba la forma', () => {
  assert.equal(secretoValido('sv2-un-secreto-de-verdad-largo'), 'CONFIGURED')
  assert.equal(secretoValido(undefined), 'MISSING')
  assert.equal(secretoValido('   '), 'MISSING')
  // Un secreto de cuatro letras pasa cualquier «¿está puesto?» y no protege.
  assert.equal(secretoValido('abc'), 'INVALID')
  // Y los valores de ejemplo que se cuelan al copiar un `.env`.
  for (const marcador of ['cambiame-por-favor-ya', 'CHANGEME-CHANGEME-123', 'xxxxxxxxxxxxxxxxxxxx', 'tu-secreto-aqui-123']) {
    assert.equal(secretoValido(marcador), 'INVALID', marcador)
  }
})

// ── 18 · permisos ──────────────────────────────────────────────────────────

test('18 · los permisos del bloque existen, con etiqueta, y son DOS', () => {
  assert.ok(SUPPLY_V2_PERMISSIONS.includes('SUPPLY_V2_OPERATIONS_VIEW'))
  assert.ok(SUPPLY_V2_PERMISSIONS.includes('SUPPLY_V2_OPERATIONS_MANAGE'))
  assert.ok(SUPPLY_V2_PERMISSION_LABELS.SUPPLY_V2_OPERATIONS_VIEW.length > 10)
  assert.ok(SUPPLY_V2_PERMISSION_LABELS.SUPPLY_V2_OPERATIONS_MANAGE.length > 10)
  // Dos y no cinco: ver y actuar. Crear cinco permisos que va a tener siempre
  // la misma persona es burocracia, no segregación.
  const delBloque = SUPPLY_V2_PERMISSIONS.filter((p) => p.startsWith('SUPPLY_V2_OPERATIONS'))
  assert.equal(delBloque.length, 2)
  // Y resolver un incidente sigue siendo su propio permiso: no se diluyó.
  assert.ok(SUPPLY_V2_PERMISSIONS.includes('SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE'))
  // Ningún permiso se queda sin etiqueta.
  for (const p of SUPPLY_V2_PERMISSIONS) assert.ok(SUPPLY_V2_PERMISSION_LABELS[p], p)
})

// ── 19 · el kill switch y su respuesta HTTP ────────────────────────────────

test('19 · apagado responde 503: no se acepta en silencio y el proveedor reintenta', () => {
  // 200 sin procesar le diría al proveedor que quedó entregado y no volvería a
  // mandarlo: eso es perder un aviso de pago. Un 4xx diría que él tiene algo
  // mal, y no lo tiene.
  assert.equal(HTTP_DE_CODIGO.FEATURE_DISABLED, 503)
  assert.equal(invitaAReintentar('FEATURE_DISABLED'), true)
  assert.equal(MENSAJE_DE_CODIGO.FEATURE_DISABLED, 'integración desactivada')
  // Y el mensaje no explica qué está apagado ni por qué.
  assert.ok(!/secreto|actor|interruptor|bandera/i.test(MENSAJE_DE_CODIGO.FEATURE_DISABLED))
  // Los códigos y los mensajes siguen cuadrando uno a uno.
  assert.deepEqual(Object.keys(HTTP_DE_CODIGO).sort(), Object.keys(MENSAJE_DE_CODIGO).sort())
})

// ── 20 · el resumen ────────────────────────────────────────────────────────

test('20 · el resumen se calcula de las cifras, y no hay componente sin veredicto', () => {
  const e = entrada({ cifras: { incidentesAbiertos: 3, incidentesAltos: 1, discrepancias: 2, outboxPendiente: 4, outboxMuertos: 1, difuntosDeCola: 1 } })
  const comps = componentesDeSalud(e)
  assert.equal(comps.length, 6, 'base, pagos, outbox, conciliación, trabajos y configuración')
  for (const c of comps) {
    assert.ok(['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'NOT_CONFIGURED'].includes(c.estado), c.clave)
    assert.ok(c.detalle.length > 10, `${c.clave} se explica en palabras`)
    assert.ok(c.etiqueta.length > 3, c.clave)
  }
  // Con esas cifras el sistema está degradado, no caído.
  assert.equal(estadoDelSistema(comps), 'DEGRADED')
})

test('20a · minutosDesde no inventa negativos ni se rompe sin fecha', () => {
  const ahora = new Date('2026-10-02T12:00:00Z')
  assert.equal(minutosDesde(new Date('2026-10-02T11:45:00Z'), ahora), 15)
  assert.equal(minutosDesde(new Date('2026-10-02T12:05:00Z'), ahora), 0, 'una fecha futura es 0, no -5')
  assert.equal(minutosDesde(null, ahora), null)
  assert.equal(minutosDesde(undefined, ahora), null)
})

test('20b · si la base no responde, el resumen NO dice «todo en cero»', () => {
  // Un cero inventado se lee como «todo en orden» justo cuando nada lo está.
  const e = entrada({ baseViva: false })
  assert.equal(estadoDelSistema(componentesDeSalud(e)), 'UNAVAILABLE')
  const alertas = evaluarAlertas(e)
  assert.ok(alertas.some((a) => a.condicion === 'READINESS_DEGRADED'), 'y se alerta de que no está listo')
})
