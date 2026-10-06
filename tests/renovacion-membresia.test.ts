import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  explicarNoRenovable,
  motivoNoRenovable,
  puedeRenovarse,
  type MembresiaParaRenovar,
} from '../src/modules/membresia/renovacion'
import { periodEnd } from '../src/lib/periodos'

/**
 * CUÁNDO SE RENUEVA UNA MEMBRESÍA.
 *
 * «Las que aún no han vencido no se pueden renovar, al menos que ya no tengan
 * lavados» (dueño, 26-09-2026). Lo que esto sustituye es un encadenado que
 * movía `fechaInicio` a una fecha FUTURA: una membresía renovada hoy se leía
 * «Inicio 26 oct · Vencimiento 26 nov» mientras el cliente la usaba.
 */

const HOY = new Date('2026-09-26T15:00:00.000Z')
const EN_UN_MES = new Date('2026-10-26T23:59:59.999Z')
const HACE_UNA_SEMANA = new Date('2026-09-19T23:59:59.999Z')

const base: MembresiaParaRenovar = {
  estado: 'ACTIVA',
  fechaVencimiento: EN_UN_MES,
  lavadosRestantes: 4,
  esIlimitado: false,
}

// ── el caso del reporte ─────────────────────────────────────────────────────

test('una membresía vigente y con usos NO se renueva', () => {
  // Es el caso de la captura: 4 usos restantes y vencimiento dentro de un mes.
  // Antes se renovaba y el período salía encadenado un mes hacia adelante.
  assert.equal(motivoNoRenovable(base, HOY), 'vigente_con_usos')
  assert.equal(puedeRenovarse(base, HOY), false)
})

test('sin usos, aunque siga vigente, SÍ se renueva', () => {
  // El caso que de verdad ocurre en el mostrador: gastó los cuatro lavados en
  // una semana y vuelve a pagar. Los días que le sobran no valen nada.
  assert.equal(motivoNoRenovable({ ...base, lavadosRestantes: 0 }, HOY), null)
})

test('vencida se renueva, tenga el contador que tenga', () => {
  for (const lavados of [0, 4]) {
    assert.equal(
      motivoNoRenovable(
        { ...base, fechaVencimiento: HACE_UNA_SEMANA, lavadosRestantes: lavados },
        HOY
      ),
      null
    )
  }
})

test('el período que resulta empieza HOY y dura lo que dice el plan', () => {
  // La cuenta que el mostrador ve: renovar el 26 de septiembre tiene que dar
  // 26 de septiembre → 26 de octubre, no 26 de octubre → 26 de noviembre.
  const fin = periodEnd(HOY, 30)
  assert.equal(fin.toISOString().slice(0, 10), '2026-10-27')
  // (27 en UTC = el cierre del día 26 en la zona del negocio, UTC−4.)
  assert.ok(fin > HOY)
})

// ── los casos que hay que no equivocar ──────────────────────────────────────

test('una ilimitada vigente no se renueva: no tiene usos que agotar', () => {
  // `lavadosRestantes` vale 0 en las ilimitadas, así que la regla de los usos
  // las habría dejado renovables SIEMPRE — justo al revés de lo que toca.
  const ilimitada = { ...base, esIlimitado: true, lavadosRestantes: 0 }
  assert.equal(motivoNoRenovable(ilimitada, HOY), 'vigente_ilimitada')
})

test('una ilimitada vencida sí se renueva', () => {
  assert.equal(
    motivoNoRenovable(
      { ...base, esIlimitado: true, lavadosRestantes: 0, fechaVencimiento: HACE_UNA_SEMANA },
      HOY
    ),
    null
  )
})

test('sin fecha de vencimiento cuenta como VIGENTE, no como vencida', () => {
  // `estaVigente` trata null como «no caduca». Si aquí se leyera como vencida,
  // se le cobraría de nuevo a quien tiene una membresía sin caducidad.
  assert.equal(motivoNoRenovable({ ...base, fechaVencimiento: null }, HOY), 'vigente_con_usos')
  assert.equal(
    motivoNoRenovable({ ...base, fechaVencimiento: null, lavadosRestantes: 0 }, HOY),
    null
  )
})

test('cancelada se renueva: es reactivar a quien vuelve', () => {
  assert.equal(motivoNoRenovable({ ...base, estado: 'CANCELADA' }, HOY), null)
})

test('los estados que no son de membresía viva se rechazan', () => {
  for (const estado of ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA']) {
    assert.equal(motivoNoRenovable({ ...base, estado }, HOY), 'estado')
  }
})

test('el vencimiento es exclusivo: el instante exacto todavía es vigente', () => {
  const justo = { ...base, fechaVencimiento: HOY }
  // `> ahora` es falso en el instante exacto, así que ya no está vigente.
  assert.equal(motivoNoRenovable(justo, HOY), null)
  const unMsDespues = { ...base, fechaVencimiento: new Date(HOY.getTime() + 1) }
  assert.equal(motivoNoRenovable(unMsDespues, HOY), 'vigente_con_usos')
})

test('cada motivo se explica con algo accionable', () => {
  assert.match(explicarNoRenovable('vigente_con_usos', 3), /3 usos/)
  assert.match(explicarNoRenovable('vigente_con_usos', 1), /1 uso\b/)
  assert.match(explicarNoRenovable('vigente_ilimitada'), /ilimitado/i)
  assert.match(explicarNoRenovable('estado'), /no admite/i)
})

// ── estructural: la barrera de verdad y el fin del encadenado ───────────────

const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')
const ACCION = join('src', 'modules', 'admin', 'actions.ts')
const fuente = (p: string) => sinComentarios(readFileSync(p, 'utf8'))

test('la action hace cumplir la regla, no solo el diálogo', () => {
  // Una server action se despacha por su id desde cualquier path: el botón no
  // la protege.
  const src = fuente(ACCION)
  const renovar = src.slice(src.indexOf('export async function renovarMembresia'))
  assert.match(renovar, /motivoNoRenovable\(/)
  assert.match(renovar, /if \(bloqueo\)/)
})

test('renovar ya no encadena el período desde el vencimiento anterior', () => {
  const src = fuente(ACCION)
  const renovar = src.slice(
    src.indexOf('export async function renovarMembresia'),
    src.indexOf('export async function', src.indexOf('export async function renovarMembresia') + 10)
  )
  assert.match(renovar, /const arranque = now/)
  assert.doesNotMatch(
    renovar,
    /arranque = sigueVigente/,
    'el encadenado es lo que ponía `fechaInicio` en el futuro'
  )
  assert.doesNotMatch(
    renovar,
    /encadenada:/,
    'guardar `encadenada` cuando nada se encadena deja el registro mintiendo'
  )
})

test('la renovación por tarjeta sigue sin tocar fechaInicio', () => {
  // Es la otra vía y NUNCA tuvo este fallo: mueve el vencimiento para dar
  // continuidad y deja el inicio en paz. Si alguien le añadiera `fechaInicio`,
  // reaparecería la fecha futura por el otro lado.
  const src = fuente(join('src', 'modules', 'pagos', 'cardnetTokenGuardado.ts'))
  const renovar = src.slice(src.indexOf('export async function renovarMembresiaPorTarjeta'))
  assert.doesNotMatch(renovar, /fechaInicio/)
})

test('el SQL de corrección replica los mismos tramos de vigencia que el código', () => {
  /**
   * `periodEnd` decide los meses con `RANGOS_MESES`, y el SQL que corrige las
   * filas ya guardadas tiene que sumar exactamente lo mismo. Son dos copias de
   * una tabla, y el día que alguien añada un tramo al código el SQL se queda
   * atrás sin que nada se queje: corregiría un plan trimestral como si fuera
   * mensual.
   */
  const js = readFileSync(join('src', 'lib', 'periodos.ts'), 'utf8')
  const tramos = [...js.matchAll(/\{ min: (\d+), max: (\d+), meses: (\d+) \}/g)].map((m) => ({
    min: Number(m[1]),
    max: Number(m[2]),
    meses: Number(m[3]),
  }))
  assert.ok(tramos.length >= 4, 'no se leyeron los tramos de periodos.ts')

  const sql = readFileSync(
    join('prisma', 'migrations_manual', '2026-09-renovaciones-encadenadas.sql'),
    'utf8'
  )
  for (const t of tramos) {
    const plural = t.meses === 1 ? 'month' : 'months'
    const esperado = new RegExp(
      `BETWEEN\\s+${t.min}\\s+AND\\s+${t.max}\\s+THEN interval '${t.meses} ${plural}'`
    )
    assert.match(sql, esperado, `al SQL le falta el tramo ${t.min}-${t.max} → ${t.meses} meses`)
  }
})
