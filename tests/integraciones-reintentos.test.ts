import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ESPERAS_S,
  MAX_INTENTOS,
  agotoLosIntentos,
  esperaTrasIntento,
  proximoIntentoTras,
  ventanaTotalHoras,
} from '../src/modules/integraciones/reintentos'
import { claveDedup } from '../src/modules/jobs/cola'
import { TIPOS_TRABAJO } from '../src/modules/jobs/tipos'

/**
 * REINTENTOS PROGRAMADOS · hallazgo A-1 de la auditoría de integraciones.
 *
 * Lo que se prueba de verdad es el núcleo puro —la escalera, el jitter y el
 * descarte— y la clave de deduplicación. Lo que no se puede ejecutar sin base
 * ni red (que las dos colas programen, que el barrido respete la fecha) se
 * vigila estructuralmente: son las invariantes que, si alguien las rompe, no
 * dan error sino silencio, y el silencio aquí significa eventos que no llegan.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

/**
 * El archivo SIN comentarios. Una guardia estructural tiene que mirar lo que el
 * módulo HACE, no lo que explica: el programador documenta largamente por qué
 * NO usa `encolar()`, y una búsqueda ingenua de ese nombre encuentra justo la
 * frase que dice que no se usa.
 */
const leerCodigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── La escalera ─────────────────────────────────────────────────────────────

test('escalera: hay una espera por cada intento menos el primero', () => {
  // El primer intento es inmediato y no se espera para él: con 8 intentos
  // totales quedan 7 esperas. Si esto se desalinea, el último intento se hace
  // sin espera o sobra una espera que nadie usa.
  assert.equal(ESPERAS_S.length, MAX_INTENTOS - 1)
})

test('escalera: crece siempre, y empieza en segundos para terminar en horas', () => {
  for (let i = 1; i < ESPERAS_S.length; i++) {
    assert.ok(
      ESPERAS_S[i] > ESPERAS_S[i - 1],
      `la espera ${i} (${ESPERAS_S[i]}s) no crece sobre la anterior`
    )
  }
  // El primer reintento tiene que caber en un despliegue del receptor, y el
  // último no puede castigar a un dominio caído durante días.
  assert.ok(ESPERAS_S[0] <= 60, 'el primer reintento tarda demasiado en llegar')
  assert.equal(ESPERAS_S[ESPERAS_S.length - 1], 86_400)
})

test('escalera: los ocho intentos cubren más de un día entero', () => {
  // Un fallo del domingo por la noche tiene que seguir vivo el lunes por la
  // mañana, que es cuando alguien lo mira.
  assert.ok(ventanaTotalHoras() > 24, `solo cubre ${ventanaTotalHoras()} h`)
  assert.ok(ventanaTotalHoras() < 72, 'una entrega no debería seguir viva tres días')
})

test('escalera: tras el último intento no hay siguiente — la entrega muere', () => {
  assert.equal(esperaTrasIntento(MAX_INTENTOS, 'e1'), null)
  assert.equal(esperaTrasIntento(MAX_INTENTOS + 5, 'e1'), null)
  assert.equal(proximoIntentoTras(MAX_INTENTOS, 'e1'), null)
  assert.ok(agotoLosIntentos(MAX_INTENTOS))
  assert.ok(!agotoLosIntentos(MAX_INTENTOS - 1))
})

test('escalera: cada intento anterior al último sí tiene siguiente', () => {
  for (let intentos = 1; intentos < MAX_INTENTOS; intentos++) {
    const e = esperaTrasIntento(intentos, 'entrega-x')
    assert.ok(e !== null && e > 0, `el intento ${intentos} se quedó sin siguiente`)
  }
})

// ─── El jitter ───────────────────────────────────────────────────────────────

test('jitter: la misma entrega y el mismo intento dan SIEMPRE la misma espera', () => {
  // Estable, no aleatorio: si dos publicaciones del mismo reintento calcularan
  // esperas distintas, la clave de deduplicación dejaría de describir el mismo
  // mensaje y QStash entregaría los dos.
  for (let i = 1; i < MAX_INTENTOS; i++) {
    assert.equal(esperaTrasIntento(i, 'entrega-A'), esperaTrasIntento(i, 'entrega-A'))
  }
})

test('jitter: dos entregas que fallan a la vez NO vuelven en el mismo segundo', () => {
  // Cuando un receptor se cae, todas sus entregas fallan en el mismo segundo.
  // Sin dispersión, lo primero que recibe al levantarse es la misma avalancha.
  const esperas = new Set(
    Array.from({ length: 40 }, (_, i) => esperaTrasIntento(1, `entrega-${i}`))
  )
  assert.ok(esperas.size > 5, `solo ${esperas.size} esperas distintas en 40 entregas`)
})

test('jitter: nunca se va más de un 20 % del valor nominal', () => {
  // Que disperse no puede convertirse en que mienta: una espera de 24 h no
  // puede volverse de 40 h por el camino.
  for (let intentos = 1; intentos < MAX_INTENTOS; intentos++) {
    const base = ESPERAS_S[intentos - 1]
    for (let i = 0; i < 60; i++) {
      const e = esperaTrasIntento(intentos, `id-${i}`)!
      assert.ok(
        e >= base * 0.8 && e <= base * 1.2,
        `intento ${intentos}: ${e}s se sale del ±20 % de ${base}s`
      )
    }
  }
})

test('jitter: una entrega «rápida» no lo es en todos sus reintentos', () => {
  // Si el desvío dependiera solo del id, una entrega desafortunada arrastraría
  // el mismo +20 % en los siete intentos.
  const factores = new Set(
    Array.from({ length: MAX_INTENTOS - 1 }, (_, i) =>
      (esperaTrasIntento(i + 1, 'misma-entrega')! / ESPERAS_S[i]).toFixed(3)
    )
  )
  assert.ok(factores.size > 1, 'el desvío no depende del número de intento')
})

// ─── La fecha ────────────────────────────────────────────────────────────────

test('fecha: el próximo intento cae a su espera del momento del fallo', () => {
  const ahora = new Date('2026-09-15T12:00:00.000Z')
  const p = proximoIntentoTras(1, 'entrega-A', ahora)!
  assert.equal(p.fecha.getTime(), ahora.getTime() + p.esperaS * 1_000)
  assert.ok(p.fecha > ahora)
})

// ─── La cola ─────────────────────────────────────────────────────────────────

test('cola: el trabajo de reintento está en el catálogo del endpoint', () => {
  // `/api/jobs` rechaza con 400 cualquier tipo que no esté en esta lista: sin
  // la línea, los reintentos se publican y se rechazan al llegar.
  assert.ok((TIPOS_TRABAJO as readonly string[]).includes('reintento-entrega'))
})

test('cola: la clave de dedup distingue el intento, la entrega y la cola', () => {
  const base = { tipo: 'reintento-entrega', companyId: 'c1', entregaId: 'e1' } as const
  const k = (cola: 'satelite' | 'empresa', intentos: number) =>
    claveDedup({ ...base, cola, intentos })

  // El mismo reintento publicado dos veces es el MISMO mensaje…
  assert.equal(k('empresa', 3), k('empresa', 3))
  // …y el siguiente intento es uno distinto, o el 4.º nunca saldría.
  assert.notEqual(k('empresa', 3), k('empresa', 4))
  // Dos colas distintas pueden tener ids iguales sin pisarse.
  assert.notEqual(k('empresa', 3), k('satelite', 3))
})

// ─── Invariantes estructurales ───────────────────────────────────────────────

test('estructura: el programador NO usa encolar() — degradaría a ejecución en línea', () => {
  /**
   * Es la trampa de esta fase. `encolar()` ejecuta el trabajo dentro del
   * request cuando QStash no está configurado; para un reintento eso significa
   * intentar otra vez AHORA, fallar otra vez, programar otra vez… dentro del
   * mismo request. Una recursión que se come los ocho intentos y el
   * presupuesto de la función en el mismo segundo.
   */
  const codigo = leerCodigo('src/modules/integraciones/programador.ts')
  assert.ok(!/\bencolar\(/.test(codigo), 'el programador llama a encolar()')
  assert.ok(codigo.includes('publicar('), 'el programador debe publicar directamente')
  // Y la razón queda escrita donde el siguiente la va a leer.
  assert.ok(
    leer('src/modules/integraciones/programador.ts').includes('encolar()'),
    'falta explicar por qué este módulo se sale del patrón de la casa'
  )
})

test('estructura: las dos colas programan desde donde anotan el fallo', () => {
  // Si el fallo se anotara en un sitio y se programara en otro, existiría un
  // camino que anota y no programa — y esa entrega no volvería a intentarse
  // hasta el barrido, que es justo lo que esta fase viene a quitar.
  for (const ruta of [
    'src/modules/connect/webhooks.ts',
    'src/modules/integraciones/despacho.ts',
  ]) {
    const fuente = leer(ruta)
    assert.ok(fuente.includes('programarReintento('), `${ruta} no programa reintentos`)
    assert.equal(
      (fuente.match(/programarReintento\(\{/g) ?? []).length,
      1,
      `${ruta} programa desde más de un sitio`
    )
  }
})

test('estructura: MAX_INTENTOS tiene un solo dueño', () => {
  // Estaba declarado por duplicado en las dos colas, con el mismo valor: la
  // forma más cómoda de que un día dejen de tener el mismo valor.
  for (const ruta of [
    'src/modules/connect/webhooks.ts',
    'src/modules/integraciones/despacho.ts',
  ]) {
    assert.ok(
      !/const MAX_INTENTOS\s*=/.test(leer(ruta)),
      `${ruta} vuelve a declarar su propio máximo de intentos`
    )
  }
})

test('estructura: el barrido solo toma lo VENCIDO, y NULL cuenta como vencido', () => {
  // Las dos mitades importan. Sin el filtro, el cron atiende entregas que ya
  // tienen su reintento programado y la escalera vuelve a ser «una vez al
  // día». Sin tratar NULL como vencido, las filas anteriores a la migración
  // —y las que no se pudieron programar— no se reintentarían nunca.
  for (const ruta of [
    'src/modules/connect/webhooks.ts',
    'src/modules/integraciones/despacho.ts',
  ]) {
    const fuente = leer(ruta)
    assert.ok(
      fuente.includes('{ proximoIntentoAt: null }, { proximoIntentoAt: { lte: new Date() } }'),
      `${ruta} no acota el barrido a lo vencido`
    )
  }
})

test('estructura: el botón del panel ignora la escalera y despacha ya', () => {
  // Quien acaba de arreglar la ruta del satélite y pulsa «reintentar» está
  // diciendo «ahora». Responderle que toca dentro de seis horas sería
  // devolverle su propia espera.
  assert.ok(
    leer('src/modules/integraciones/panelActions.ts').includes('soloVencidos: false'),
    'el botón del panel respeta la fecha del próximo intento'
  )
})

test('estructura: revivir un evento lo deja vencido, no con la espera colgando', () => {
  const fuente = leer('src/modules/integraciones/panel.ts')
  const revivir = fuente.slice(fuente.indexOf('export async function revivirFallidos'))
  assert.ok(
    revivir.includes('proximoIntentoAt: null'),
    'revivirFallidos no limpia la fecha del próximo intento'
  )
})

test('estructura: el cerrojo de intentos protege los dos reintentos por cola', () => {
  // Sin él, el barrido y la cola pueden atender la misma entrega a la vez y
  // gastar un intento que nadie contó.
  const casos = [
    ['src/modules/integraciones/despacho.ts', 'reintentarEventoSaliente'],
    ['src/modules/connect/webhooks.ts', 'reintentarEntregaWebhook'],
  ] as const
  for (const [ruta, fn] of casos) {
    const fuente = leer(ruta)
    const cuerpo = fuente.slice(fuente.indexOf(`export async function ${fn}`))
    assert.ok(
      cuerpo.includes('intentos !== intentosEsperados'),
      `${fn} no comprueba el cerrojo de intentos`
    )
  }
})
