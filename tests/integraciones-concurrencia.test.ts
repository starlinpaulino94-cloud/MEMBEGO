import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONCURRENCIA,
  CONCURRENCIA_POR_EMPRESA,
  antesDe,
  enParalelo,
  enParaleloPorClave,
} from '../src/modules/integraciones/concurrencia'

/**
 * FAN-OUT Y BARRIDO EN PARALELO · hallazgo A-6 de la auditoría.
 *
 * Las cuatro rutas de salida recorrían su lista con un `for` y un `await`
 * dentro. En el fan-out era una molestia; en el barrido era un fallo: con un
 * receptor caído, cien filas a diez segundos cada una dentro de un presupuesto
 * de sesenta significaba procesar unas seis y que la plataforma matara la
 * función — sin error, sin traza, y repitiendo con las mismas seis al día
 * siguiente.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── Que de verdad vaya en paralelo ──────────────────────────────────────────

test('nunca hay más de `limite` en vuelo a la vez', () => {
  return (async () => {
    let enVuelo = 0
    let pico = 0
    await enParalelo(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      enVuelo++
      pico = Math.max(pico, enVuelo)
      await esperar(5)
      enVuelo--
    })
    assert.equal(pico, 4, `llegó a haber ${pico} en vuelo con un límite de 4`)
  })()
})

test('un elemento lento NO deja parados a los demás', async () => {
  /**
   * Es la diferencia entre este recorrido y hacer `Promise.all` sobre lotes de
   * seis: en un lote, cinco que responden en 5 ms se quedan esperando al que
   * tarda 200. Aquí cada trabajador toma el siguiente en cuanto acaba el suyo.
   */
  const orden: number[] = []
  const t0 = Date.now()
  await enParalelo([200, 5, 5, 5, 5, 5], 2, async (ms, i) => {
    await esperar(ms)
    orden.push(i)
  })
  // Los rápidos terminan antes que el lento aunque entrara el primero.
  assert.equal(orden.at(-1), 0, 'el lento no fue el último en terminar')
  // Y el total se parece al lento, no a la suma de todos.
  assert.ok(Date.now() - t0 < 350, 'el recorrido se comportó como si fuera en serie')
})

test('devuelve un resultado por elemento y en el orden de entrada', async () => {
  const { resultados, sinEmpezar } = await enParalelo([1, 2, 3, 4, 5], 3, async (n) => {
    await esperar(n % 2 === 0 ? 1 : 10)
    return n * 10
  })
  assert.deepEqual(resultados, [10, 20, 30, 40, 50])
  assert.equal(sinEmpezar, 0)
})

test('una lista vacía no cuelga ni lanza', async () => {
  const r = await enParalelo([], 6, async () => 1)
  assert.deepEqual(r, { resultados: [], sinEmpezar: 0 })
})

test('con menos elementos que el límite no se crean trabajadores de más', async () => {
  let arranques = 0
  await enParalelo([1, 2], 10, async () => {
    arranques++
  })
  assert.equal(arranques, 2)
})

test('un límite absurdo no rompe el recorrido', async () => {
  for (const limite of [0, -3]) {
    const { resultados } = await enParalelo([1, 2, 3], limite, async (n) => n)
    assert.deepEqual(resultados, [1, 2, 3], `límite ${limite}`)
  }
})

test('si `fn` lanza, el error sale por donde entró y no se traga', async () => {
  // Quien llama envuelve cada entrega en su propio manejo de errores. Tragarlo
  // aquí escondería un fallo de programación dentro de un barrido silencioso.
  await assert.rejects(
    enParalelo([1], 2, async () => {
      throw new Error('revienta')
    }),
    /revienta/
  )
})

// ─── Tope por empresa: justicia entre inquilinos en el barrido ───────────────

/** Corre el scheduler midiendo el pico de concurrencia global y por clave. */
async function medir<T extends { k: string; id: number }>(
  items: T[],
  limiteGlobal: number,
  limitePorClave: number,
  msPorClave: (k: string) => number = () => 5
) {
  let global = 0
  let picoGlobal = 0
  const enClave = new Map<string, number>()
  const picoClave = new Map<string, number>()
  const orden: number[] = []
  const { resultados, sinEmpezar } = await enParaleloPorClave(
    items,
    async (it) => {
      global++
      picoGlobal = Math.max(picoGlobal, global)
      const c = (enClave.get(it.k) ?? 0) + 1
      enClave.set(it.k, c)
      picoClave.set(it.k, Math.max(picoClave.get(it.k) ?? 0, c))
      await esperar(msPorClave(it.k))
      orden.push(it.id)
      global--
      enClave.set(it.k, (enClave.get(it.k) ?? 1) - 1)
      return it.id
    },
    { limiteGlobal, limitePorClave, clave: (it) => it.k }
  )
  return { resultados, sinEmpezar, picoGlobal, picoClave, orden }
}

test('nunca hay más de `limitePorClave` de la MISMA clave en vuelo', async () => {
  // Diez filas de una empresa con un tope global holgado: sin el tope por clave
  // saldrían de seis en seis contra su (único) receptor.
  const items = Array.from({ length: 10 }, (_, i) => ({ k: 'a', id: i }))
  const { picoClave, picoGlobal, resultados } = await medir(items, 6, 2)
  assert.equal(picoClave.get('a'), 2, 'se pasó del tope por empresa')
  assert.equal(picoGlobal, 2, 'sin más claves, el pico global no puede superar el de la clave')
  assert.equal(resultados.length, 10, 'dejó filas sin procesar')
})

test('respeta el tope global aun con varias claves por debajo del suyo', async () => {
  // Cuatro empresas, tope por clave 3, global 6: 4×3=12 querría el por-clave,
  // pero el global lo corta en 6.
  const items = ['a', 'b', 'c', 'd'].flatMap((k) =>
    Array.from({ length: 5 }, (_, i) => ({ k, id: Number(`${k.charCodeAt(0)}${i}`) }))
  )
  const { picoGlobal, picoClave, resultados } = await medir(items, 6, 3)
  assert.ok(picoGlobal <= 6, `pico global ${picoGlobal} > 6`)
  for (const k of ['a', 'b', 'c', 'd']) {
    assert.ok((picoClave.get(k) ?? 0) <= 3, `la clave ${k} se pasó de 3`)
  }
  assert.equal(resultados.length, 20)
})

test('una empresa con el destino caído NO deja sin turno a las demás', async () => {
  // 'a' es lentísima (endpoint caído); 'b' responde rápido. Con tope por clave,
  // 'a' ocupa como mucho 2 huecos y 'b' sigue avanzando: todas las 'b' terminan
  // antes que la última 'a'. Sin el tope, las 'a' llenarían el pool y 'b'
  // esperaría a la siguiente vuelta del cron.
  const items = [
    ...Array.from({ length: 5 }, (_, i) => ({ k: 'a', id: 100 + i })),
    ...Array.from({ length: 5 }, (_, i) => ({ k: 'b', id: 200 + i })),
  ]
  const { orden } = await medir(items, 6, 2, (k) => (k === 'a' ? 40 : 3))
  const ultimaB = Math.max(...orden.map((id, i) => (id >= 200 ? i : -1)))
  const ultimaA = Math.max(...orden.map((id, i) => (id < 200 ? i : -1)))
  assert.ok(ultimaB < ultimaA, 'una empresa sana esperó a que terminara la caída')
})

test('devuelve un resultado por elemento y en el orden de entrada', async () => {
  const items = ['a', 'b', 'a', 'b', 'c'].map((k, i) => ({ k, id: i }))
  const { resultados } = await medir(items, 6, 2)
  assert.deepEqual(resultados, [0, 1, 2, 3, 4])
})

test('lista vacía: ni cuelga ni lanza', async () => {
  const r = await enParaleloPorClave([], async () => 1, {
    limiteGlobal: 6,
    limitePorClave: 3,
    clave: () => 'x',
  })
  assert.deepEqual(r, { resultados: [], sinEmpezar: 0 })
})

test('al parar por presupuesto, deja lo no empezado y lo dice', async () => {
  let hechos = 0
  const items = Array.from({ length: 12 }, (_, i) => ({ k: i % 3 === 0 ? 'a' : 'b', id: i }))
  const { resultados, sinEmpezar } = await enParaleloPorClave(
    items,
    async () => {
      hechos++
      await esperar(2)
    },
    {
      limiteGlobal: 4,
      limitePorClave: 2,
      clave: (it) => it.k,
      continuar: () => hechos < 5,
    }
  )
  assert.ok(resultados.length >= 5 && resultados.length < 12, `hizo ${resultados.length}`)
  assert.equal(resultados.length + sinEmpezar, 12, 'las cuentas no cuadran')
})

test('si `fn` lanza, el error sale por donde entró', async () => {
  await assert.rejects(
    enParaleloPorClave([{ k: 'a', id: 1 }], async () => {
      throw new Error('revienta')
    }, { limiteGlobal: 4, limitePorClave: 2, clave: (it) => it.k }),
    /revienta/
  )
})

test('el tope por empresa es menor que el global (si no, no acota nada)', () => {
  assert.ok(CONCURRENCIA_POR_EMPRESA >= 1, 'con cero no saldría ninguna entrega')
  assert.ok(
    CONCURRENCIA_POR_EMPRESA < CONCURRENCIA,
    'un tope por empresa igual o mayor que el global no limita a nadie'
  )
})

// ─── Parar a tiempo ──────────────────────────────────────────────────────────

test('al decir basta, deja de tomar trabajo y DICE cuánto quedó', async () => {
  /**
   * Parar y contarlo es lo que sustituye a que la plataforma mate la función.
   * Un barrido que se corta y lo dice se puede volver a lanzar; uno al que
   * matan deja filas a medias y nadie sabe cuántas faltaban.
   */
  let hechos = 0
  const { resultados, sinEmpezar } = await enParalelo(
    Array.from({ length: 10 }, (_, i) => i),
    2,
    async () => {
      hechos++
      await esperar(2)
    },
    { continuar: () => hechos < 4 }
  )
  assert.ok(resultados.length >= 4 && resultados.length < 10, `hizo ${resultados.length}`)
  assert.equal(sinEmpezar, 10 - resultados.length)
  assert.equal(resultados.length + sinEmpezar, 10, 'las cuentas no cuadran')
})

test('lo que ya estaba en vuelo al parar SÍ termina', async () => {
  // Cortarlo a mitad dejaría una entrega hecha sin su resultado escrito — el
  // estado del que más cuesta salir, porque la fila miente.
  let terminados = 0
  let arrancados = 0
  await enParalelo(
    Array.from({ length: 8 }, (_, i) => i),
    3,
    async () => {
      arrancados++
      await esperar(5)
      terminados++
    },
    { continuar: () => arrancados < 3 }
  )
  assert.equal(terminados, arrancados, 'algo arrancó y no llegó a terminar')
})

test('si nunca se dice basta, no se reporta nada sin empezar', async () => {
  const { sinEmpezar } = await enParalelo([1, 2, 3], 2, async (n) => n, {
    continuar: () => true,
  })
  assert.equal(sinEmpezar, 0)
})

// ─── El presupuesto de tiempo ────────────────────────────────────────────────

test('antesDe deja de dar permiso al agotarse el presupuesto menos el margen', () => {
  let reloj = 1_000
  const puede = antesDe(20_000, 12_000, () => reloj)
  assert.ok(puede(), 'al empezar debería dejar')
  reloj += 7_900
  assert.ok(puede(), 'a falta de 100 ms del corte debería dejar')
  reloj += 200
  assert.ok(!puede(), 'pasado el corte no puede seguir tomando trabajo')
})

test('el margen reserva tiempo para terminar lo que esté en vuelo', () => {
  /**
   * Sin margen, el barrido tomaría trabajo hasta el último milisegundo y la
   * plataforma lo mataría a mitad de una escritura. El margen tiene que cubrir
   * el timeout de una entrega (10 s) más lo que cuesta anotar su resultado.
   */
  const cron = codigo('src/modules/connect/webhooks.ts')
  const margen = /antesDe\(presupuestoMs, (\d[\d_]*)\)/.exec(cron)?.[1]
  assert.ok(margen, 'no se encontró el margen del barrido')
  assert.ok(Number(margen.replace(/_/g, '')) >= 10_000, 'el margen no cubre ni un timeout')
})

test('el cron reparte su presupuesto entre las DOS colas', () => {
  /**
   * Comparten cron, así que comparten los sesenta segundos. Sin repartirlo, la
   * primera cola podría consumirlo entero y la segunda no llegaría a intentar
   * ni una entrega — y eso solo se notaría el día en que una de las dos va mal,
   * o sea el día que más importa.
   */
  const src = codigo('src/app/api/cron/integraciones/route.ts')
  assert.match(src, /const PRESUPUESTO_POR_COLA_MS = /)
  assert.equal(
    [...src.matchAll(/PRESUPUESTO_POR_COLA_MS/g)].length,
    3,
    'el presupuesto tiene que declararse y pasarse a las dos colas'
  )
  const maxDuration = Number(/maxDuration = (\d+)/.exec(src)?.[1])
  const porCola = Number(/PRESUPUESTO_POR_COLA_MS = (\d[\d_]*)/.exec(src)![1].replace(/_/g, ''))
  assert.ok(porCola * 2 < maxDuration * 1000, 'las dos colas juntas no caben en el presupuesto')
})

// ─── Que las cuatro rutas lo usen ────────────────────────────────────────────

test('las cuatro rutas de salida recorren en paralelo, no en serie', () => {
  const casos: Array<[string, string]> = [
    ['src/modules/connect/webhooks.ts', 'repartirEventoAWebhooks'],
    ['src/modules/connect/webhooks.ts', 'reintentarWebhooksPendientes'],
    ['src/modules/integraciones/despacho.ts', 'reenviarEventoASistemas'],
    ['src/modules/integraciones/despacho.ts', 'reintentarPendientes'],
  ]
  for (const [ruta, fn] of casos) {
    const src = codigo(ruta)
    const cuerpo = src.slice(src.indexOf(`export async function ${fn}`))
    const hasta = cuerpo.indexOf('\n}\n')
    assert.match(
      cuerpo.slice(0, hasta > 0 ? hasta : 3000),
      // Los dos barridos (rutas compartidas entre inquilinos) usan la variante
      // con tope por empresa; los dos fan-out, la simple. Cualquiera vale aquí.
      /enParalelo(PorClave)?\(/,
      `${fn} sigue recorriendo su lista en serie`
    )
  }
})

test('los DOS barridos acotan la concurrencia POR EMPRESA, no solo global', () => {
  // El trabajador del barrido es el único compartido entre inquilinos: sin tope
  // por empresa, uno con el endpoint caído acapara los seis huecos y deja sin
  // reintento a los demás. Los fan-out son de una sola empresa: no lo necesitan.
  for (const [ruta, fn] of [
    ['src/modules/connect/webhooks.ts', 'reintentarWebhooksPendientes'],
    ['src/modules/integraciones/despacho.ts', 'reintentarPendientes'],
  ] as const) {
    const src = codigo(ruta)
    const cuerpo = src.slice(src.indexOf(`export async function ${fn}`))
    assert.match(cuerpo, /enParaleloPorClave\(/, `${fn} no acota por empresa`)
    assert.match(cuerpo, /limitePorClave:\s*CONCURRENCIA_POR_EMPRESA/, `${fn} no pasa el tope por empresa`)
    assert.match(cuerpo, /clave:\s*\(\w+\)\s*=>\s*\w+\.companyId/, `${fn} no llavea por companyId`)
  }
})

test('los dos barridos se cortan por tiempo; los dos fan-out no', () => {
  // El fan-out corre dentro del worker de eventos, que tiene 300 s y una lista
  // acotada por el entitlement: ahí no hay presupuesto que apurar. Ponerle un
  // corte sería complicarlo para protegerse de algo que no pasa.
  const web = codigo('src/modules/connect/webhooks.ts')
  const sat = codigo('src/modules/integraciones/despacho.ts')
  assert.equal([...web.matchAll(/continuar: antesDe\(/g)].length, 1)
  assert.equal([...sat.matchAll(/continuar: antesDe\(/g)].length, 1)
})

test('el memo de destinos guarda la PROMESA, no el resultado', () => {
  /**
   * En serie daba igual. En paralelo, seis trabajadores que empiezan a la vez
   * con filas de la misma empresa encontrarían el memo vacío los seis y
   * lanzarían seis veces la misma consulta — justo lo que el memo existía para
   * evitar («una consulta por empresa, no por evento»).
   */
  const src = codigo('src/modules/integraciones/despacho.ts')
  assert.match(src, /const memo = new Map<string, Promise</)
  const fn = src.slice(src.indexOf('const destinosDe = '))
  assert.ok(!/await sistemasDestino/.test(fn.slice(0, 400)), 'el memo vuelve a guardar el valor')
})

test('el trabajo que se deja sin hacer se dice, no se calla', () => {
  // Si el mensaje del panel siguiera diciendo solo «12 entregados» con cuarenta
  // filas sin tocar, quien pulsó el botón se iría creyendo la cola vacía.
  assert.match(codigo('src/modules/integraciones/panelActions.ts'), /sinTiempo/)
  for (const ruta of [
    'src/modules/connect/webhooks.ts',
    'src/modules/integraciones/despacho.ts',
  ]) {
    assert.match(codigo(ruta), /sinTiempo: sinEmpezar/, `${ruta} no devuelve lo que quedó`)
  }
})

test('la concurrencia es baja a propósito', () => {
  /**
   * No es un pool de trabajos independientes: en un barrido, muchas filas
   * apuntan AL MISMO servidor —están pendientes precisamente porque ese
   * servidor está mal—. Un número alto convertiría el reintento en una
   * avalancha contra alguien que ya está caído.
   */
  assert.ok(CONCURRENCIA >= 2, 'con menos de dos no hay paralelismo')
  assert.ok(CONCURRENCIA <= 10, 'demasiado para converger sobre un solo receptor')
})
