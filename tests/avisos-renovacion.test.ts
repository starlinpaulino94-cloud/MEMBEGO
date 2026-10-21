import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clavesDeAviso,
  etiquetaTarjeta,
  fechaLarga,
  formatoVencimiento,
  montoRD,
  nombreMarca,
  redactarAviso,
  type DatosAviso,
  type TipoAviso,
} from '../src/modules/pagos/avisosRenovacionCore'
import { armarCorreo } from '../src/modules/pagos/correoAvisoRenovacion'

/**
 * TARJETAS GUARDADAS · ETAPA 5 — los avisos y el orden de las operaciones.
 *
 * Los textos se EJECUTAN: lo que importa de ellos es lo que NO afirman. El orden
 * de las operaciones del cobro (qué se mira antes de cobrar, qué se escribe
 * junto) no se puede importar fuera de Next, así que se comprueba por su código,
 * y cada guarda dice qué fallo impide. El comportamiento real contra una base
 * está en `scripts/probar-tarjetas-guardadas.mts`.
 */

const raiz = join(__dirname, '..')
const fuente = (ruta: string) =>
  readFileSync(join(raiz, ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const trozo = (src: string, desde: string, hasta?: string) => {
  const i = src.indexOf(desde)
  assert.ok(i >= 0, `no se encontró «${desde}»`)
  const j = hasta ? src.indexOf(hasta, i + desde.length) : src.length
  assert.ok(j >= 0, `no se encontró «${hasta}»`)
  return src.slice(i, j)
}

const VENCE = new Date('2026-10-24T18:00:00Z')
const base = (o: Partial<DatosAviso> = {}): DatosAviso => ({
  empresa: 'Lavado Express',
  cliente: 'María',
  plan: 'Plan Premium',
  monto: 1600,
  tarjeta: 'Visa ····4242',
  vence: VENCE,
  membershipId: 'mem_123',
  motivo: 'Fondos insuficientes.',
  ...o,
})
const TIPOS: TipoAviso[] = [
  'renovacion_proxima',
  'rechazo_con_reintento',
  'rechazo_final',
  'tarjeta_no_servira',
  'tarjeta_vencida',
]
const todo = (tipo: TipoAviso, d = base()) => {
  const a = redactarAviso(tipo, d)
  return [a.titulo, a.mensaje, a.asunto, ...a.parrafos].join('\n')
}

// ── Lo que dicen ────────────────────────────────────────────────────────────

test('todos los avisos dicen quién, qué plan, cuánto y con qué tarjeta', () => {
  for (const tipo of TIPOS) {
    const a = redactarAviso(tipo, base())
    const t = todo(tipo)
    assert.match(t, /Plan Premium/, `${tipo}: no nombra el plan`)
    assert.match(t, /Visa ····4242/, `${tipo}: no nombra la tarjeta`)
    assert.match(a.parrafos[0], /^Hola María,$/, `${tipo}: no saluda`)
    assert.match(a.asunto, /Lavado Express/, `${tipo}: el asunto no dice de qué empresa es`)
    assert.equal(a.href, '/membresia/mem_123', `${tipo}: lleva a otra pantalla`)
  }
})

test('el monto y la fecha salen con el formato de la app', () => {
  assert.equal(montoRD(1600), 'RD$1,600.00')
  assert.equal(montoRD(49.5), 'RD$49.50')
  assert.match(fechaLarga(VENCE), /24 de octubre de 2026/)
  assert.match(todo('renovacion_proxima'), /RD\$1,600\.00/)
  assert.match(todo('renovacion_proxima'), /24 de octubre de 2026/)
})

test('solo se enseña marca y últimos 4: ningún aviso trae un número de tarjeta', () => {
  for (const tipo of TIPOS) {
    assert.doesNotMatch(todo(tipo), /\b\d{13,19}\b/, `${tipo}: parece un número de tarjeta`)
  }
})

// ── Lo que NO afirman ───────────────────────────────────────────────────────

test('«no se hizo ningún cargo» solo se dice cuando de verdad no hubo cargo', () => {
  // Los dos avisos de rechazo vienen de un rechazo REAL; el de tarjeta vencida,
  // de un cobro que ni se intentó. El aviso previo y el de «no servirá» hablan
  // de lo que VA a pasar: no tienen nada que decir de cargos.
  for (const tipo of ['rechazo_con_reintento', 'rechazo_final', 'tarjeta_vencida'] as const) {
    assert.match(todo(tipo), /No se hizo ningún cargo/, `${tipo}`)
  }
  for (const tipo of ['renovacion_proxima', 'tarjeta_no_servira'] as const) {
    assert.doesNotMatch(todo(tipo), /ningún cargo|no se cobr/i, `${tipo} afirma algo sobre cargos`)
  }
})

test('el aviso de cierre NO promete otro intento', () => {
  // Si el aviso dijera «volveremos a intentarlo» y no hay tiempo o ya se acabaron
  // los intentos, el cliente esperaría un cobro que no va a llegar.
  for (const causa of ['definitivo', 'agotado', 'sin_tiempo'] as const) {
    const t = todo('rechazo_final', base({ causa, intentos: 3 }))
    // Se buscan PROMESAS de reintento; frases negadas como «no tiene sentido
    // volver a intentarlo» son justo lo que el aviso tiene que decir.
    assert.doesNotMatch(
      t,
      /volveremos a|reintentaremos|intentaremos|lo intentaremos|en las próximas 24 horas/i,
      `causa ${causa}`
    )
    assert.match(t, /desactivamos la renovación automática/i, `causa ${causa}`)
  }
})

test('el aviso de rechazo con reintento SÍ dice cuándo y por qué es el último plazo', () => {
  const t = todo('rechazo_con_reintento')
  assert.match(t, /Volveremos a intentarlo/)
  assert.match(t, /antes de que tu membresía venza el 24 de octubre de 2026/)
})

test('cada causa de cierre se explica distinto', () => {
  const t = (causa: 'definitivo' | 'agotado' | 'sin_tiempo') =>
    todo('rechazo_final', base({ causa, intentos: 3 }))
  assert.match(t('definitivo'), /no se va a poder cobrar/)
  assert.match(t('agotado'), /Lo intentamos 3 veces/)
  assert.match(t('sin_tiempo'), /Ya no queda tiempo/)
  assert.notEqual(t('definitivo'), t('agotado'))
  assert.notEqual(t('agotado'), t('sin_tiempo'))
})

test('el aviso de cierre dice que la tarjeta se conserva y que la membresía sigue vigente', () => {
  const t = todo('rechazo_final', base({ causa: 'agotado', intentos: 3 }))
  assert.match(t, /Sigue guardada/)
  assert.match(t, /sigue vigente hasta el 24 de octubre de 2026/)
})

test('un motivo del banco con o sin punto final no deja puntuación rota', () => {
  const sin = todo('rechazo_con_reintento', base({ motivo: 'Fondos insuficientes' }))
  const con = todo('rechazo_con_reintento', base({ motivo: 'Fondos insuficientes.' }))
  assert.doesNotMatch(sin, /\.\./)
  assert.doesNotMatch(con, /\.\./)
  assert.match(sin, /Fondos insuficientes\./)
})

test('sin motivo se usa uno neutro, no «undefined»', () => {
  for (const motivo of [undefined, null, '', '   ']) {
    const t = todo('rechazo_con_reintento', base({ motivo }))
    assert.doesNotMatch(t, /undefined|null/)
    assert.match(t, /El pago no se pudo completar\./)
  }
})

// ── Cómo se nombra la tarjeta ───────────────────────────────────────────────

test('nombreMarca: las conocidas, las desconocidas y la ausencia', () => {
  assert.equal(nombreMarca('VISA'), 'Visa')
  assert.equal(nombreMarca('mc'), 'Mastercard')
  assert.equal(nombreMarca('American Express'), 'American Express')
  assert.equal(nombreMarca('dinersclub'), 'Dinersclub')
  assert.equal(nombreMarca(null), 'Tarjeta')
  assert.equal(nombreMarca('   '), 'Tarjeta')
})

test('etiquetaTarjeta: «Visa ····1234», y sin últimos 4 no inventa un número', () => {
  assert.equal(etiquetaTarjeta('VISA', '1234'), 'Visa ····1234')
  // Si llega de más, solo se enseñan los últimos 4: lo que sobra no se muestra.
  assert.equal(etiquetaTarjeta('VISA', '4111111111111111'), 'Visa ····1111')
  assert.equal(etiquetaTarjeta('VISA', null), 'Visa guardada')
  assert.equal(etiquetaTarjeta('VISA', '12'), 'Visa guardada')
  assert.equal(etiquetaTarjeta(null, 'abcd'), 'Tarjeta guardada')
})

test('formatoVencimiento: «MM/AA», o nada si el dato no sirve', () => {
  assert.equal(formatoVencimiento(8, 2027), '08/27')
  assert.equal(formatoVencimiento(11, 27), '11/27')
  assert.equal(formatoVencimiento(null, 2027), null)
  assert.equal(formatoVencimiento(13, 2027), null)
  assert.equal(formatoVencimiento(8, 1999), null)
  assert.equal(formatoVencimiento(1.5, 2027), null)
})

// ── Variantes ───────────────────────────────────────────────────────────────

test('una renovación heredada invita a revisarla; una nueva no', () => {
  assert.match(todo('renovacion_proxima', base({ heredado: true })), /antes de que registráramos tu autorización/)
  assert.doesNotMatch(todo('renovacion_proxima', base({ heredado: false })), /registráramos/)
  assert.doesNotMatch(todo('renovacion_proxima', base()), /registráramos/)
})

test('si la tarjeta vence antes de la renovación siguiente, el aviso normal lo añade', () => {
  const con = todo(
    'renovacion_proxima',
    base({ tarjetaVence: '12/26', tarjetaVenceAntesDeLaSiguiente: true })
  )
  assert.match(con, /tiene vencimiento 12\/26, antes de la renovación siguiente/)
  assert.doesNotMatch(todo('renovacion_proxima', base()), /tiene vencimiento/)
  // Sin el dato del vencimiento no se inventa un párrafo.
  assert.doesNotMatch(
    todo('renovacion_proxima', base({ tarjetaVence: null, tarjetaVenceAntesDeLaSiguiente: true })),
    /tiene vencimiento/
  )
})

test('el aviso de «no servirá» nombra el vencimiento si se conoce y no lo inventa si no', () => {
  assert.match(todo('tarjeta_no_servira', base({ tarjetaVence: '08/26' })), /vencimiento 08\/26/)
  assert.doesNotMatch(todo('tarjeta_no_servira', base({ tarjetaVence: null })), /vencimiento \d|undefined/)
})

test('los avisos de problema se pintan en ámbar y el informativo en verde', () => {
  assert.equal(redactarAviso('renovacion_proxima', base()).tono, 'info')
  for (const tipo of ['rechazo_con_reintento', 'rechazo_final', 'tarjeta_no_servira', 'tarjeta_vencida'] as const) {
    assert.equal(redactarAviso(tipo, base()).tono, 'alerta', tipo)
  }
})

test('cada aviso se archiva bajo el tipo de notificación que le corresponde', () => {
  assert.equal(redactarAviso('renovacion_proxima', base()).tipoNotificacion, 'MEMBRESIA_POR_VENCER')
  assert.equal(redactarAviso('rechazo_con_reintento', base()).tipoNotificacion, 'PAGO_RECHAZADO')
  assert.equal(redactarAviso('rechazo_final', base()).tipoNotificacion, 'PAGO_RECHAZADO')
  assert.equal(redactarAviso('tarjeta_vencida', base()).tipoNotificacion, 'PAGO_RECHAZADO')
  assert.equal(redactarAviso('tarjeta_no_servira', base()).tipoNotificacion, 'SISTEMA')
})

// ── El correo ───────────────────────────────────────────────────────────────

test('lo que viene de la base se escapa en el HTML del correo', () => {
  const a = redactarAviso(
    'renovacion_proxima',
    base({ plan: '<script>alert(1)</script>', cliente: 'Ana<img src=x>' })
  )
  const { html } = armarCorreo(a, { empresa: '<i>Empresa</i>', logoUrl: 'https://x/a.png" onerror="x' })
  assert.doesNotMatch(html, /<script>|<img src=x>|<i>Empresa<\/i>/)
  assert.doesNotMatch(html, /onerror="x/)
  assert.match(html, /&lt;script&gt;/)
})

test('el botón del correo apunta a la membresía, con la base de la app', () => {
  const a = redactarAviso('rechazo_con_reintento', base())
  const { html, text } = armarCorreo(a, { empresa: 'Lavado Express', urlBase: 'https://app.membego.com/' })
  assert.match(html, /href="https:\/\/app\.membego\.com\/membresia\/mem_123"/)
  assert.match(text, /Pagar ahora: https:\/\/app\.membego\.com\/membresia\/mem_123/)
})

test('sin URL base no hay botón ni enlace roto', () => {
  const a = redactarAviso('rechazo_con_reintento', base())
  const { html, text } = armarCorreo(a, { empresa: 'Lavado Express' })
  assert.doesNotMatch(html, /<a href/)
  assert.doesNotMatch(text, /http|undefined/)
})

test('la versión en texto plano trae lo mismo que el HTML', () => {
  const a = redactarAviso('rechazo_final', base({ causa: 'agotado', intentos: 3 }))
  const { text } = armarCorreo(a, { empresa: 'Lavado Express' })
  for (const p of a.parrafos) assert.ok(text.includes(p), `falta en el texto plano: ${p.slice(0, 40)}`)
})

// ── Identidad de cada aviso ─────────────────────────────────────────────────

test('la clave de un aviso identifica el hecho: mismo hecho igual, otro hecho distinta', () => {
  const k = clavesDeAviso
  assert.equal(k.renovacionProxima('m1', '2026-10-24'), k.renovacionProxima('m1', '2026-10-24'))
  assert.notEqual(k.renovacionProxima('m1', '2026-10-24'), k.renovacionProxima('m1', '2026-11-23'))
  assert.notEqual(k.renovacionProxima('m1', '2026-10-24'), k.renovacionProxima('m2', '2026-10-24'))
  assert.notEqual(k.rechazo('i1'), k.rechazo('i2'))
  // Tipos distintos de aviso del mismo ciclo no se pisan entre sí.
  const mismas = [
    k.renovacionProxima('m1', 'c'),
    k.tarjetaNoServira('m1', 'c'),
    k.tarjetaVencida('m1', 'c'),
    k.rechazo('m1'),
  ]
  assert.equal(new Set(mismas).size, mismas.length)
})

// ── El orden de las operaciones (por su código) ─────────────────────────────

const GUARDADO = 'src/modules/pagos/cardnetTokenGuardado.ts'
const RENOVACION = () =>
  trozo(
    fuente(GUARDADO),
    'export async function renovarMembresiaPorTarjeta',
    'export async function membresiasARenovar'
  )

test('la renovación vuelve a comprobar que toca, ANTES de cobrar', () => {
  // Un segundo cron que llega tras la renovación lee el estado nuevo; sin esta
  // comprobación cobraría otra vez (ver la REGRESIÓN en renovacion-politica).
  const src = RENOVACION()
  const estado = src.indexOf("m.estado !== 'ACTIVA'")
  const ventana = src.indexOf('tocaRenovar({')
  assert.ok(estado > 0, 'se cobra una membresía que ya no está activa, y la aprobación la dejaría ACTIVA')
  assert.ok(ventana > 0, 'se cobra sin comprobar la ventana')
  assert.ok(estado < src.indexOf('reclamarIntentoDeRenovacion('))
  assert.ok(ventana < src.indexOf('reclamarIntentoDeRenovacion('))
  assert.match(src, /graciaMs:\s*GRACIA_VENCIDA_MS/)
  assert.match(src, /fechaPago:\s*m\.fechaPago/)
})

test('el reclamo mira los intentos de TODOS los orígenes; el tope solo cuenta los del cron', () => {
  const src = trozo(
    fuente(GUARDADO),
    'export async function reclamarIntentoDeRenovacion',
    'function omisionPorBloqueo'
  )
  const consulta = trozo(src, 'tx.pagoIntento.findMany', 'select:')
  // Si se filtrara por `canal` en lo principal, un cliente pagando a mano ahora
  // mismo no frenaría el cobro del cron. (El `canal` que SÍ aparece, dentro del
  // `OR`, es la regla de siempre: una renovación aprobada y sin entregar de los
  // últimos 30 días bloquea otro cobro aunque quede fuera del ciclo.)
  assert.doesNotMatch(consulta, /proveedor: 'CARDNET',\s*canal:/)
  assert.match(consulta, /createdAt:\s*\{\s*gte:\s*input\.inicioCiclo\s*\}/)
  assert.match(consulta, /fulfillmentEstado:\s*\{\s*not:\s*'COMPLETADA'\s*\}/)
  assert.match(src, /delCron:\s*p\.canal === CANAL_RENOVACION/)
  assert.match(src, /rechazosPrevios:\s*rechazosDelCron\(previos\)/)
})

test('una tarjeta vencida se detiene ANTES de reclamar el intento y de cobrar', () => {
  // «Una tarjeta vencida no genera ningún intento de cobro»: ni siquiera la fila
  // de `pago_intentos`.
  const src = RENOVACION()
  const guarda = src.indexOf('tarjetaCardnetVencida(m.tarjetaTokenizada.vencMes, m.tarjetaTokenizada.vencAnio)')
  assert.ok(guarda > 0, 'ya no se comprueba el vencimiento de la tarjeta')
  assert.ok(guarda < src.indexOf('reclamarIntentoDeRenovacion('), 'se crea el intento ANTES de mirar si venció')
  assert.ok(guarda < src.indexOf('cobrarConCredencialGuardada('))
  const rama = trozo(src, 'tarjetaCardnetVencida(m.tarjetaTokenizada.vencMes', 'exigeAvisoPrevio(')
  assert.match(rama, /razon:\s*'tarjeta_vencida'/)
  assert.match(rama, /apagarRenovacionPorFallo\(/)
  assert.match(rama, /tipo:\s*'tarjeta_vencida'/)
})

test('quien aceptó un texto con aviso previo no se cobra sin aviso', () => {
  const src = RENOVACION()
  const gate = src.indexOf('exigeAvisoPrevio(consentimiento.textoVersion)')
  assert.ok(gate > 0, 'se cobra aunque el texto prometiera un aviso')
  assert.ok(gate < src.indexOf('reclamarIntentoDeRenovacion('))
  const rama = trozo(src, 'exigeAvisoPrevio(consentimiento.textoVersion)', 'let tokenAbierto')
  // Si no se puede ni comprobar, no se cobra.
  assert.match(rama, /\.catch\(\(\) => false\)/)
  assert.match(rama, /razon:\s*'sin_aviso'/)
})

test('el reclamo recibe desde cuándo cuenta el ciclo', () => {
  assert.match(RENOVACION(), /inicioCiclo:\s*inicioDelCiclo\(vencimiento,\s*m\.fechaPago\)/)
})

test('un bloqueo del ciclo se devuelve como omisión, sin cobrar', () => {
  const src = RENOVACION()
  const i = src.indexOf('if (!reclamo.ok)')
  assert.ok(i > 0)
  assert.ok(i < src.indexOf('cobrarConCredencialGuardada('))
  assert.match(src.slice(i, i + 80), /return omisionPorBloqueo\(/)
})

test('los dos bloqueos graves hacen ruido en el registro de errores', () => {
  // Son cobros que pudieron haber salido y nadie va a repetir solos: si no
  // hacen ruido, nadie se entera.
  const src = trozo(fuente(GUARDADO), 'function omisionPorBloqueo', 'export async function renovarMembresiaPorTarjeta')
  assert.match(trozo(src, "case 'incierto'", "case 'cobrado'"), /logErrorBd\(/)
  assert.match(trozo(src, "case 'cobrado'"), /logErrorBd\(/)
})

test('una excepción al cobrar se trata como resultado DESCONOCIDO, no como rechazo', () => {
  const src = RENOVACION()
  const intento = src.indexOf('cobro = await cobrarConCredencialGuardada(')
  const rama = trozo(src.slice(intento), 'catch (e)', 'const clase = clasificarCobro(')
  assert.match(rama, /marcarIntentoSinResultado\([\s\S]*'incierto'/)
  assert.match(rama, /incierto:\s*true/)
  assert.doesNotMatch(rama, /RECHAZADO|avisarCliente/)
})

test('lo incierto o técnico NO se avisa al cliente y NO se marca rechazado', () => {
  const src = RENOVACION()
  const rama = trozo(
    src,
    "if (clase === 'incierto' || clase === 'tecnico')",
    "if (clase !== 'aprobada')"
  )
  assert.doesNotMatch(rama, /avisarCliente\(/, 'se avisa «no se cobró» de algo que no se sabe')
  assert.doesNotMatch(rama, /RECHAZADO/)
  assert.match(rama, /marcarIntentoSinResultado\(/)
  assert.match(rama, /return \{ estado: 'error'/)
})

test('solo un rechazo real escribe RECHAZADO, y lo hace antes de que nada lo marque aprobado', () => {
  const src = RENOVACION()
  const clasifica = src.indexOf('clasificarCobro({')
  const incierto = src.indexOf("clase === 'incierto'")
  const rechaza = src.indexOf("estado: 'RECHAZADO'")
  assert.ok(clasifica > 0 && incierto > clasifica && rechaza > incierto,
    'el rechazo se escribe sin haber descartado antes lo incierto')
  assert.ok(rechaza < src.indexOf("estado: 'APROBADO'"))
})

test('el rechazo, su auditoría y apagar la renovación son UNA transacción', () => {
  const src = RENOVACION()
  const rama = trozo(src, "estado: 'RECHAZADO'", 'return { apagada }')
  assert.match(rama, /accion:\s*'PAGO_RECHAZADO'/, 'el rechazo no deja asiento de auditoría')
  assert.match(rama, /apagarRenovacionPorFallo\(/)
  // Si entre una cosa y otra se abriera otra transacción, un fallo dejaría el
  // intento rechazado sin su asiento, o la renovación apagada sin rastro.
  assert.doesNotMatch(rama, /conEmpresa\(|sinEmpresa\(/)
  // El asiento dice qué se decidió.
  assert.match(rama, /resultado:[\s\S]*se_reintentara[\s\S]*renovacion_desactivada/)
})

test('el aviso de rechazo se manda DESPUÉS de registrar, y solo si queda algo cierto que decir', () => {
  const src = RENOVACION()
  const registro = src.indexOf('return { apagada }')
  const aviso = src.indexOf("tipo: decision.accion === 'reintentar' ? 'rechazo_con_reintento' : 'rechazo_final'")
  assert.ok(registro > 0 && aviso > registro)
  // No se avisa «desactivamos» si otro la apagó antes (el cliente ya lo sabe).
  assert.match(src, /registro && \(decision\.accion === 'reintentar' \|\| registro\.apagada\)/)
  assert.match(src, /dedupeKey:\s*clavesDeAviso\.rechazo\(intento\.id\)/)
})

test('apagar la renovación por un fallo conserva la tarjeta y no programa cancelación', () => {
  const src = trozo(fuente(GUARDADO), 'async function apagarRenovacionPorFallo', 'function clasificacionDe')
  assert.match(src, /autoRenovar:\s*true/, 'no es idempotente: apagaría dos veces')
  assert.match(src, /autoRenovar:\s*false/)
  assert.match(src, /revocarConsentimientos\(tx/, 'apaga sin retirar el consentimiento')
  assert.doesNotMatch(src, /canceladaAlVencimiento/, 'una renovación fallida no es una cancelación del cliente')
  assert.doesNotMatch(src, /tarjetaTokenizadaId/, 'se desvincularía la tarjeta')
  assert.doesNotMatch(src, /tarjetaTokenizada\.(update|delete)|eliminadaAt|activa:\s*false/, 'se tocaría la tarjeta')
})

test('el cobro con resultado ya conocido no se repite al reclamar', () => {
  const src = trozo(
    fuente(GUARDADO),
    'export async function reclamarIntentoDeRenovacion',
    'function omisionPorBloqueo'
  )
  assert.match(src, /evaluarCiclo\(/)
  assert.match(src, /if \(!evaluacion\.permitido\) return/)
  assert.match(src, /canal:\s*CANAL_RENOVACION/)
  assert.ok(src.indexOf('evaluarCiclo(') < src.indexOf('tx.pagoIntento.create'), 'se crea antes de evaluar')
})

test('el cron corre los avisos ANTES de los cobros, y un fallo de avisos no los detiene', () => {
  const src = fuente('src/app/api/cron/renovaciones-tarjeta/route.ts')
  const avisos = src.indexOf('ejecutarAvisosDeRenovacion()')
  const cobros = src.indexOf('ejecutarRenovacionesTarjeta()')
  assert.ok(avisos > 0 && cobros > avisos, 'los cobros corren sin que el aviso de hoy exista')
  assert.match(src, /ejecutarAvisosDeRenovacion\(\)\.catch\(/)
  assert.match(src, /\.\.\.resumen,\s*avisos/)
})

test('la selección del cron empieza por lo que vence antes', () => {
  const src = trozo(fuente(GUARDADO), 'export async function membresiasARenovar', 'export interface ResumenRenovaciones')
  assert.match(src, /orderBy:\s*\{\s*fechaVencimiento:\s*'asc'\s*\}/)
})

// ── El envío de avisos (por su código) ──────────────────────────────────────

const AVISOS = 'src/modules/pagos/avisosRenovacion.ts'

test('un aviso se reclama con la clave única y se retira si el correo no sale', () => {
  const src = trozo(fuente(AVISOS), 'export async function avisarCliente', 'export async function avisoPrevioRegistrado')
  assert.match(src, /skipDuplicates:\s*true/)
  assert.match(src, /dedupeKey:\s*input\.dedupeKey/)
  assert.match(src, /if \(reclamo\.count === 0\) return 'ya_enviado'/)
  // El reclamo se retira para que mañana se reintente el aviso entero.
  assert.match(trozo(src, 'catch (e)', "return 'fallo'"), /deleteMany\(/)
})

test('avisar nunca lanza: un aviso que falla no rompe el cobro ni el cron', () => {
  const src = trozo(fuente(AVISOS), 'export async function avisarCliente', 'export async function avisoPrevioRegistrado')
  assert.match(src, /^\s*try \{/m)
  assert.match(src.slice(src.lastIndexOf('catch (e)')), /return 'fallo'/)
})

test('el cobro busca el aviso con la MISMA clave con la que se reclama', () => {
  const src = fuente(AVISOS)
  const consulta = trozo(src, 'export async function avisoPrevioRegistrado', 'export interface ResumenAvisos')
  const envio = trozo(src, 'export async function ejecutarAvisosDeRenovacion')
  assert.match(consulta, /clavesDeAviso\.renovacionProxima\(input\.membershipId,\s*claveDeCiclo\(input\.vence\)\)/)
  assert.match(envio, /clavesDeAviso\.renovacionProxima\(m\.id,\s*ciclo\)/)
  assert.match(envio, /const ciclo = claveDeCiclo\(vence\)/)
})

test('solo se avisa de una renovación que va a ocurrir', () => {
  const src = trozo(fuente(AVISOS), 'export async function ejecutarAvisosDeRenovacion')
  // Pasarela apagada o empresa de práctica: el cobro no saldría, así que decir
  // «se renovará automáticamente» sería mentirle al cliente.
  assert.ok(src.indexOf('puedeCobrarToken(') > 0)
  assert.ok(src.indexOf('puedeCobrarToken(') < src.indexOf('await avisarCliente('))
  assert.match(src, /consentimientosPago:\s*\{\s*some:\s*\{\s*tipo:\s*'RENOVACION_AUTOMATICA',\s*revocadoAt:\s*null/)
  assert.match(src, /tarjeta\.clienteId !== m\.clienteId/)
})

test('el aviso previo llega antes del primer cobro', () => {
  // La selección del aviso (`avisoPrevioDias`) tiene que abarcar la del cobro
  // (`diasAntesDelPrimerIntento`): si no, habría renovaciones que se cobran sin
  // haber tenido ocasión de avisar.
  const src = fuente(AVISOS)
  assert.match(src, /POLITICA_RENOVACION\.avisoPrevioDias \* DIA/)
  assert.match(src, /fechaVencimiento:\s*\{\s*not:\s*null,\s*gt:\s*ahora,\s*lte:\s*hasta\s*\}/)
})
