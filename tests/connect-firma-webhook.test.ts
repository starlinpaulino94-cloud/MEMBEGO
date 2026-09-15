import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CABECERA_ENTREGA,
  CABECERA_FIRMA_EMPRESA,
  CABECERA_FIRMA_EMPRESA_V2,
  CABECERA_TIMESTAMP,
  VENTANA_REPLAY_SEGUNDOS,
  materialFirmado,
} from '@membego/contracts'
import { firmarHmac } from '../src/modules/integraciones/nucleo'

/**
 * FIRMA DE LOS WEBHOOKS DE EMPRESA · hallazgo A-2 de la auditoría.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTABA MAL
 *
 * La firma cubría SOLO el cuerpo. El timestamp viajaba al lado, en su propia
 * cabecera, sin que nada lo protegiera: quien capturara una entrega podía
 * reenviarla al día siguiente con el timestamp que quisiera y la firma seguía
 * cuadrando. La cabecera existía y no servía para nada — comprobar la ventana
 * con un valor que elige el atacante es comprobar su palabra.
 *
 * Lo que se prueba aquí no es que la firma «se calcule»: es que un receptor que
 * haga EXACTAMENTE lo que dice nuestra documentación acepte lo que mandamos, y
 * rechace lo que tiene que rechazar.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const SECRETO = 'whs_' + 'a'.repeat(48)
const GUIA = 'src/components/connect/GuiaDesarrolladores.tsx'

/**
 * EL RECEPTOR, tal como lo describe la guía que copia y pega quien integra.
 *
 * Escrito aquí a mano y a propósito: si esta función se importara del código de
 * MembeGo, la prueba comprobaría que nos entendemos con nosotros mismos, que es
 * justo lo que no hace falta comprobar.
 */
function avisoValido(
  cuerpoCrudo: string,
  cabeceras: Record<string, string>,
  secreto: string,
  ahora = Math.floor(Date.now() / 1000)
): boolean {
  const ts = Number(cabeceras[CABECERA_TIMESTAMP.toLowerCase()])
  const entrega = cabeceras[CABECERA_ENTREGA.toLowerCase()]
  if (!ts || !entrega) return false
  if (Math.abs(ahora - ts) > VENTANA_REPLAY_SEGUNDOS) return false

  const material = `${ts}.${entrega}.${cuerpoCrudo}`
  const esperada = createHmac('sha256', secreto).update(material, 'utf8').digest()
  const recibida = Buffer.from(cabeceras[CABECERA_FIRMA_EMPRESA_V2.toLowerCase()] ?? '', 'hex')
  if (recibida.length !== esperada.length) return false
  return timingSafeEqual(recibida, esperada)
}

/** Lo que MembeGo manda, con la misma forma que `entregar()`. */
function entregaFirmada(opciones: { ts?: number; entregaId?: string; cuerpo?: string } = {}) {
  const ts = opciones.ts ?? Math.floor(Date.now() / 1000)
  const entregaId = opciones.entregaId ?? 'ent_abc123'
  const cuerpo =
    opciones.cuerpo ??
    JSON.stringify({
      id: entregaId,
      event: 'visit.completed',
      companyId: 'cmp_1',
      createdAt: new Date(ts * 1000).toISOString(),
      data: { customerId: 'cli_1' },
    })
  return {
    cuerpo,
    cabeceras: {
      [CABECERA_TIMESTAMP.toLowerCase()]: String(ts),
      [CABECERA_ENTREGA.toLowerCase()]: entregaId,
      [CABECERA_FIRMA_EMPRESA_V2.toLowerCase()]: firmarHmac(
        SECRETO,
        materialFirmado(ts, entregaId, cuerpo)
      ),
      [CABECERA_FIRMA_EMPRESA.toLowerCase()]: firmarHmac(SECRETO, cuerpo),
    } as Record<string, string>,
  }
}

// ─── Emisor y receptor se entienden ──────────────────────────────────────────

test('un aviso nuestro pasa el verificador de la documentación', () => {
  const { cuerpo, cabeceras } = entregaFirmada()
  assert.ok(avisoValido(cuerpo, cabeceras, SECRETO))
})

test('con otro secreto, no', () => {
  const { cuerpo, cabeceras } = entregaFirmada()
  assert.ok(!avisoValido(cuerpo, cabeceras, 'whs_' + 'b'.repeat(48)))
})

// ─── Lo que A-2 viene a arreglar ─────────────────────────────────────────────

test('EL FALLO: cambiar el timestamp ya NO cuela', () => {
  /**
   * Es la prueba de la que va todo el hallazgo. Con la firma v1 —solo el
   * cuerpo— este caso pasaba: el atacante se quedaba una entrega, le ponía el
   * timestamp de hoy y la reenviaba, y la firma seguía siendo la de un aviso
   * legítimo. La ventana anti-replay no lo paraba porque el valor que la
   * ventana mira lo escribía él.
   */
  const ahora = Math.floor(Date.now() / 1000)
  const capturada = entregaFirmada({ ts: ahora - 60 * 60 * 24 })

  // El atacante refresca el timestamp para colarse dentro de la ventana…
  const reenviada = { ...capturada.cabeceras, [CABECERA_TIMESTAMP.toLowerCase()]: String(ahora) }
  assert.ok(!avisoValido(capturada.cuerpo, reenviada, SECRETO), 'el replay con timestamp nuevo coló')

  // …y sin refrescarlo, la ventana lo caza. Las dos salidas están cerradas.
  assert.ok(!avisoValido(capturada.cuerpo, capturada.cabeceras, SECRETO))
})

test('la firma v1 era, exactamente, lo que permitía ese replay', () => {
  // La contraprueba: con la v1 el timestamp no entra en el cálculo, así que
  // cambiarlo no altera nada. No es un defecto de su implementación; es lo que
  // significa firmar solo el cuerpo.
  const { cuerpo, cabeceras } = entregaFirmada({ ts: 1_000_000 })
  const v1 = cabeceras[CABECERA_FIRMA_EMPRESA.toLowerCase()]
  assert.equal(v1, firmarHmac(SECRETO, cuerpo))
  // Idéntica firma para otro timestamp cualquiera: no lo cubre.
  const otra = entregaFirmada({ ts: 2_000_000, cuerpo })
  assert.equal(otra.cabeceras[CABECERA_FIRMA_EMPRESA.toLowerCase()], v1)
})

test('cambiar el id de la entrega tampoco cuela', () => {
  // Dos suscripciones de la misma empresa reciben el mismo evento en el mismo
  // segundo. Con el id dentro, sus firmas dejan de ser intercambiables.
  const { cuerpo, cabeceras } = entregaFirmada({ entregaId: 'ent_uno' })
  const suplantada = { ...cabeceras, [CABECERA_ENTREGA.toLowerCase()]: 'ent_dos' }
  assert.ok(!avisoValido(cuerpo, suplantada, SECRETO))
})

test('tocar un solo byte del cuerpo tampoco', () => {
  const { cuerpo, cabeceras } = entregaFirmada()
  assert.ok(!avisoValido(cuerpo.replace('cli_1', 'cli_2'), cabeceras, SECRETO))
})

test('un aviso viejo se rechaza aunque su firma sea impecable', () => {
  const viejo = Math.floor(Date.now() / 1000) - VENTANA_REPLAY_SEGUNDOS - 10
  const { cuerpo, cabeceras } = entregaFirmada({ ts: viejo })
  assert.ok(!avisoValido(cuerpo, cabeceras, SECRETO))
  // Y uno dentro de la ventana sí pasa: el margen existe para relojes
  // desajustados, no para que la comprobación sea decorativa.
  const reciente = entregaFirmada({ ts: Math.floor(Date.now() / 1000) - 30 })
  assert.ok(avisoValido(reciente.cuerpo, reciente.cabeceras, SECRETO))
})

test('sin timestamp o sin id de entrega, no hay nada que verificar', () => {
  const { cuerpo, cabeceras } = entregaFirmada()
  for (const quitar of [CABECERA_TIMESTAMP, CABECERA_ENTREGA]) {
    const sin = { ...cabeceras }
    delete sin[quitar.toLowerCase()]
    assert.ok(!avisoValido(cuerpo, sin, SECRETO), `pasó sin ${quitar}`)
  }
})

// ─── La migración ────────────────────────────────────────────────────────────

test('salen LAS DOS firmas: nadie se queda fuera el día del despliegue', () => {
  /**
   * Cambiarle el significado a la cabecera de siempre haría que todo el que ya
   * integró empezara a rechazar sus propios avisos — y eso no se nota el primer
   * día, se nota tres días después cuando alguien echa de menos un dato.
   */
  const src = codigo('src/modules/connect/webhooks.ts')
  const bloque = src.slice(src.indexOf('const resp = await fetch('), src.indexOf('body: cuerpo'))
  assert.ok(bloque.includes('CABECERA_FIRMA_EMPRESA_V2'), 'no sale la firma nueva')
  assert.ok(
    /\[CABECERA_FIRMA_EMPRESA\]/.test(bloque),
    'se retiró la firma de legado antes de tiempo'
  )
})

test('la v2 firma el material común, no una variante propia', () => {
  // `materialFirmado` es el mismo que usan los satélites. Escribir aquí otra
  // concatenación «equivalente» es cómo emisor y receptor acaban discrepando
  // por un punto de más.
  const src = codigo('src/modules/connect/webhooks.ts')
  assert.match(src, /materialFirmado\(timestamp, sobre\.id, cuerpo\)/)
})

test('el timestamp que se firma es el MISMO que se manda en la cabecera', () => {
  /**
   * Si se calculara `Date.now()` dos veces —una para la cabecera y otra para la
   * firma— bastaría con que el reloj cruzara un segundo entre las dos líneas
   * para que la firma no cuadrara. Sería un fallo intermitente, de los que se
   * cierran como «no reproducible».
   */
  const src = codigo('src/modules/connect/webhooks.ts')
  const bloque = src.slice(src.indexOf('async function entregar('), src.indexOf('body: cuerpo'))
  assert.equal(
    (bloque.match(/Math\.floor\(Date\.now\(\) \/ 1000\)/g) ?? []).length,
    1,
    'el timestamp se calcula más de una vez en el mismo envío'
  )
  assert.match(bloque, /\[CABECERA_TIMESTAMP\]: String\(timestamp\)/)
})

// ─── La documentación no puede quedarse vieja ────────────────────────────────

test('la guía enseña a verificar la v2, con el mismo material', () => {
  // Una firma mejor que nadie verifica no protege de nada: el arreglo de A-2 es
  // mitad emisor, mitad esta guía.
  const guia = leer(GUIA)
  assert.ok(guia.includes('CABECERA_FIRMA_EMPRESA_V2'), 'la guía no nombra la cabecera nueva')
  // El `\$` del patrón: dentro del TSX el ejemplo vive en una plantilla, así
  // que sus interpolaciones van escapadas para que lleguen literales al lector.
  assert.match(guia, /\\?\$\{ts\}\.\\?\$\{entrega\}\.\\?\$\{cuerpoCrudo\}/)
})

test('la guía enseña a comprobar la ventana, y no con un número a mano', () => {
  const guia = leer(GUIA)
  assert.ok(
    guia.includes('VENTANA_REPLAY_SEGUNDOS'),
    'la ventana está escrita a mano y se separará del contrato'
  )
  assert.match(guia, /Math\.abs/)
})

test('la guía dice que la firma de legado sigue valiendo, y que hay que migrar', () => {
  // Quien ya integró tiene que poder leer que no se le ha roto nada hoy, y que
  // sí se le va a romper si no hace nada.
  const guia = leer(GUIA)
  assert.ok(guia.includes('CABECERA_FIRMA_EMPRESA'))
  assert.match(guia, /migra|migrar/i)
})
