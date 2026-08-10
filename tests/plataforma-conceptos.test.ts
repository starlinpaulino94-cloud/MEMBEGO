import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CAPACIDADES, type Capacidad } from '../src/modules/capacidades/catalogo'
import {
  CAPABILITIES,
  CLASIFICACION,
  FUNCIONES_EMPRESA,
  MODULOS_VERTICAL,
  SCOPES,
  SCOPES_POR_CAPABILITY,
  conceptoDe,
  scopesDe,
  verticalDelModulo,
} from '../src/modules/plataforma/conceptos'

/**
 * LOS TRES CONCEPTOS DE PLATAFORMA (Fase 1).
 *
 * La lista `CAPACIDADES` mezclaba funciones de MembeGo con módulos del vertical
 * Car Wash. Con un vertical se aguanta; con diez son doscientos valores en un
 * enum del Core y la Regla §6 se incumple por acumulación.
 *
 * Estas pruebas existen para que la frontera sea real y no una intención
 * escrita en un comentario.
 */

test('toda capacidad existente está clasificada', () => {
  // Si mañana alguien añade `MESAS` a CAPACIDADES sin decidir si es función de
  // empresa o módulo de vertical, esta prueba lo para. Es el punto exacto
  // donde la lista volvería a mezclarse.
  for (const c of CAPACIDADES) {
    assert.ok(
      CLASIFICACION[c] === 'FUNCION_EMPRESA' || CLASIFICACION[c] === 'MODULO_VERTICAL',
      `"${c}" no está clasificada: decide si es función de empresa o módulo de vertical`
    )
  }
})

test('ningún valor pertenece a los dos conceptos a la vez', () => {
  for (const f of FUNCIONES_EMPRESA) {
    assert.equal(
      verticalDelModulo(f),
      null,
      `"${f}" está declarada como función de empresa Y como módulo de vertical`
    )
  }
})

test('la clasificación cubre las 19 capacidades sin inventarse ninguna', () => {
  const clasificadas = [...FUNCIONES_EMPRESA, ...Object.keys(MODULOS_VERTICAL)]
  assert.equal(
    new Set(clasificadas).size,
    CAPACIDADES.length,
    'la clasificación y CAPACIDADES no cubren el mismo conjunto'
  )
  for (const c of clasificadas) {
    assert.ok(
      (CAPACIDADES as readonly string[]).includes(c),
      `"${c}" está clasificada pero no existe en CAPACIDADES`
    )
  }
})

test('los módulos de vertical declaran a qué vertical pertenecen', () => {
  // Sin esto no se puede comprobar que el Core no los referencia, que es el
  // único motivo por el que la clasificación sirve para algo.
  for (const [modulo, vertical] of Object.entries(MODULOS_VERTICAL)) {
    assert.ok(vertical, `"${modulo}" no dice de qué vertical es`)
  }
})

/**
 * LA GUARDIA QUE IMPORTA.
 *
 * El Core no puede razonar sobre módulos de un vertical. Si `modules/pagos`
 * empieza a preguntar por `COLA_VEHICULOS`, MembeGo dejó de ser una plataforma
 * y volvió a ser una aplicación de car wash con extras.
 *
 * Se excluyen: el propio vertical, el catálogo (que los declara), esta
 * clasificación, y el panel de capacidades (que los administra por definición).
 */
test('el núcleo no razona sobre módulos de un vertical', () => {
  const EXENTOS = [
    join('src', 'modules', 'carwash'),
    join('src', 'modules', 'capacidades'),
    join('src', 'modules', 'plataforma'),
    join('src', 'modules', 'apps'),
    join('src', 'app', '(admin)', 'admin', 'app'),
    join('src', 'app', '(admin)', 'admin', 'aplicaciones'),
    join('src', 'components', 'carwash'),
  ]

  function archivos(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) archivos(p, acc)
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p)
    }
    return acc
  }

  const modulos = Object.keys(MODULOS_VERTICAL)
  const infractores: string[] = []

  for (const archivo of archivos('src')) {
    if (EXENTOS.some((e) => archivo.startsWith(e))) continue
    const src = readFileSync(archivo, 'utf8')
    for (const m of modulos) {
      if (new RegExp(`['"\`]${m}['"\`]`).test(src)) infractores.push(`${archivo}: ${m}`)
    }
  }

  assert.deepEqual(
    infractores,
    [],
    'El núcleo referencia módulos de un vertical. Si el Core necesita saberlo, ' +
      'es una función de empresa; si no, la comprobación va dentro del vertical.\n' +
      infractores.join('\n')
  )
})

// ── Capabilities de integración ─────────────────────────────────────────────

test('cada capability declara sus scopes', () => {
  for (const c of CAPABILITIES) {
    const scopes = SCOPES_POR_CAPABILITY[c]
    assert.ok(scopes?.length, `la capability "${c}" no declara ningún scope`)
  }
})

test('los scopes tienen forma `recurso:accion`', () => {
  for (const s of SCOPES) {
    assert.match(s, /^[a-z]+:[a-z]+$/, `scope con formato inesperado: "${s}"`)
  }
})

test('pedir una capability no arrastra permisos de más', () => {
  // Regla §26: concesión mínima. Declarar que solo se consultan clientes NO
  // puede dar permiso de escribir transacciones.
  const soloLectura = scopesDe(['CUSTOMER_LOOKUP'])
  assert.deepEqual(soloLectura, ['customers:read'])
  assert.ok(!soloLectura.some((s) => s.endsWith(':write') || s.endsWith(':redeem')))
})

test('canjear un beneficio exige poder leerlo primero', () => {
  // Un sistema que puede consumir pero no evaluar consumiría a ciegas.
  const canje = scopesDe(['BENEFIT_REDEMPTION'])
  assert.ok(canje.includes('benefits:read'))
  assert.ok(canje.includes('benefits:redeem'))
})

test('las capabilities son identificadores de protocolo, en inglés', () => {
  // Viajan en el manifest, en los scopes y en la documentación del satélite.
  // El resto del dominio está en español; esto no, y es deliberado.
  for (const c of CAPABILITIES) {
    assert.match(c, /^[A-Z][A-Z_]+$/, `"${c}" no tiene forma de identificador de protocolo`)
  }
})

test('conceptoDe clasifica sin depender del orden de las listas', () => {
  assert.equal(conceptoDe('POS_CAJA' as Capacidad), 'FUNCION_EMPRESA')
  assert.equal(conceptoDe('COLA_VEHICULOS' as Capacidad), 'MODULO_VERTICAL')
  assert.equal(verticalDelModulo('COLA_VEHICULOS' as Capacidad), 'CAR_WASH')
})
