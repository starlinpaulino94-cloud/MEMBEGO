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
  cabeceraDeFirmas,
  firmasDeCabecera,
  materialFirmado,
} from '@membego/contracts'
import { firmarHmac } from '../src/modules/integraciones/nucleo'
import { secretosVivos } from '../src/modules/connect/webhooksNucleo'

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

  // La cabecera trae una LISTA: una firma normalmente, dos durante una
  // rotación. Se acepta si alguna cuadra con el secreto que tiene el receptor.
  return (cabeceras[CABECERA_FIRMA_EMPRESA_V2.toLowerCase()] ?? '')
    .split(',')
    .some((f) => {
      const recibida = Buffer.from(f.trim(), 'hex')
      return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
    })
}

/** Lo que MembeGo manda, con la misma forma que `entregar()`. */
function entregaFirmada(
  opciones: { ts?: number; entregaId?: string; cuerpo?: string; secretos?: string[] } = {}
) {
  const ts = opciones.ts ?? Math.floor(Date.now() / 1000)
  const entregaId = opciones.entregaId ?? 'ent_abc123'
  const secretos = opciones.secretos ?? [SECRETO]
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
      [CABECERA_FIRMA_EMPRESA_V2.toLowerCase()]: cabeceraDeFirmas(
        secretos.map((sec) => firmarHmac(sec, materialFirmado(ts, entregaId, cuerpo)))
      ),
      // La v1 firma SIEMPRE con el vigente, que es el primero: no puede llevar
      // lista porque su verificador hace un único `timingSafeEqual`.
      [CABECERA_FIRMA_EMPRESA.toLowerCase()]: firmarHmac(secretos[0], cuerpo),
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

// ─── Rotación con solape (A-7) ───────────────────────────────────────────────

const SECRETO_NUEVO = 'whs_' + 'c'.repeat(48)

test('ROTAR: durante el solape valen los DOS, y por eso no se corta nada', () => {
  /**
   * Es la propiedad entera del hallazgo A-7. Antes había un solo secreto: al
   * cambiarlo, todas las entregas quedaban de golpe sin una firma que el
   * receptor reconociera hasta que alguien copiara el nuevo a mano. Una
   * rotación que obliga a un corte es una rotación que no se hace — y la
   * primera vez que hace falta rotar de verdad es cuando se sospecha que el
   * secreto se filtró, o sea el peor momento para descubrirlo.
   */
  const { cuerpo, cabeceras } = entregaFirmada({ secretos: [SECRETO_NUEVO, SECRETO] })

  // Quien ya copió el nuevo, valida.
  assert.ok(avisoValido(cuerpo, cabeceras, SECRETO_NUEVO), 'el que ya rotó no valida')
  // Y quien todavía no, también. Los dos lados dejan de tener que coincidir
  // en el mismo minuto, que es justo lo que no se podía antes.
  assert.ok(avisoValido(cuerpo, cabeceras, SECRETO), 'el que aún no rotó se quedó fuera')
})

test('ROTAR: un tercer secreto cualquiera sigue sin valer', () => {
  // Aceptar una lista no puede convertirse en aceptar más de la cuenta.
  const { cuerpo, cabeceras } = entregaFirmada({ secretos: [SECRETO_NUEVO, SECRETO] })
  assert.ok(!avisoValido(cuerpo, cabeceras, 'whs_' + 'z'.repeat(48)))
})

test('ROTAR: acabado el solape, el viejo deja de valer', () => {
  // La lista vuelve a tener un elemento y quien no copió el nuevo se entera —
  // que es el punto del plazo. Lo que no puede pasar es que se entere antes.
  const { cuerpo, cabeceras } = entregaFirmada({ secretos: [SECRETO_NUEVO] })
  assert.ok(avisoValido(cuerpo, cabeceras, SECRETO_NUEVO))
  assert.ok(!avisoValido(cuerpo, cabeceras, SECRETO))
})

test('fuera de una rotación la cabecera lleva UNA firma y se lee igual que siempre', () => {
  // La lista no puede tener coste para quien no está rotando: si la cabecera
  // habitual cambiara de forma, cada receptor tendría que desplegar por algo
  // que no le afecta.
  const { cabeceras } = entregaFirmada()
  assert.ok(!cabeceras[CABECERA_FIRMA_EMPRESA_V2.toLowerCase()].includes(','))
  assert.equal(firmasDeCabecera(cabeceras[CABECERA_FIRMA_EMPRESA_V2.toLowerCase()]).length, 1)
})

test('la lista se compone y se lee con las mismas funciones del contrato', () => {
  // Emisor y receptor no pueden separar el formato: si uno usara `', '` y el
  // otro `','`, la segunda firma sería basura y solo fallaría durante una
  // rotación, que es cuando nadie quiere descubrir un fallo de formato.
  const firmas = ['aa', 'bb']
  assert.deepEqual(firmasDeCabecera(cabeceraDeFirmas(firmas)), firmas)
  assert.deepEqual(firmasDeCabecera(' aa , bb '), firmas)
  assert.deepEqual(firmasDeCabecera(''), [])
  assert.deepEqual(firmasDeCabecera(null), [])
})

test('el solape se acaba SOLO, sin depender de que nadie limpie la fila', () => {
  /**
   * Si el final del solape dependiera de un trabajo que borra el secreto viejo,
   * un trabajo que no corre lo dejaría firmando para siempre — o sea, lo
   * contrario de rotar. Se compara contra el reloj en cada envío.
   */
  const base = {
    secreto: SECRETO_NUEVO,
    secretoAnterior: SECRETO,
    secretoAnteriorHasta: new Date('2026-09-20T00:00:00Z'),
  }
  assert.deepEqual(secretosVivos(base, new Date('2026-09-19T23:59:00Z')), [
    SECRETO_NUEVO,
    SECRETO,
  ])
  assert.deepEqual(secretosVivos(base, new Date('2026-09-20T00:01:00Z')), [SECRETO_NUEVO])
})

test('sin rotación en curso se firma solo con el vigente', () => {
  assert.deepEqual(
    secretosVivos({ secreto: SECRETO, secretoAnterior: null, secretoAnteriorHasta: null }),
    [SECRETO]
  )
  // Y una fila a medias —un secreto sin fecha, o al revés— no resucita nada.
  assert.deepEqual(
    secretosVivos({ secreto: SECRETO, secretoAnterior: 'x', secretoAnteriorHasta: null }),
    [SECRETO]
  )
  assert.deepEqual(
    secretosVivos({
      secreto: SECRETO,
      secretoAnterior: null,
      secretoAnteriorHasta: new Date(Date.now() + 1000),
    }),
    [SECRETO]
  )
})

test('el vigente va SIEMPRE el primero de la lista', () => {
  // La v1 firma con `secretos[0]`, y tiene que ser el vigente: si el orden se
  // invirtiera, un receptor en v1 se quedaría con el secreto que se retira.
  const vivos = secretosVivos({
    secreto: SECRETO_NUEVO,
    secretoAnterior: SECRETO,
    secretoAnteriorHasta: new Date(Date.now() + 60_000),
  })
  assert.equal(vivos[0], SECRETO_NUEVO)
})

test('rotar dos veces no deja tres secretos vivos', () => {
  // La segunda rotación retira el de la primera, no el de antes. Quien rota dos
  // veces en la misma tarde —porque se equivocó al copiar— quiere que el
  // penúltimo muera.
  const src = codigo('src/modules/connect/webhooks.ts')
  const fn = src.slice(src.indexOf('export async function rotarSecretoSuscripcion'))
  assert.match(fn.slice(0, 1500), /secretoAnterior: actual\.secreto/)
})

test('rotar está acotado por empresa en la lectura Y en la escritura', () => {
  // El id sale del formulario. Rotarle el secreto a otra empresa no es solo
  // leer de más: es cortarle el servicio.
  const src = codigo('src/modules/connect/webhooks.ts')
  const fn = src.slice(src.indexOf('export async function rotarSecretoSuscripcion'))
  const cuerpo = fn.slice(0, 1500)
  assert.match(cuerpo, /findFirst\(\{[\s\S]{0,200}where: \{ id, companyId \}/)
  assert.match(cuerpo, /updateMany\(\{[\s\S]{0,120}where: \{ id, companyId \}/)
})

test('los secretos NUNCA viajan a la lista del navegador: solo la fecha', () => {
  const vista = codigo('src/app/(admin)/admin/integraciones/desarrolladores/webhooks/page.tsx')
  const mapeo = vista.slice(vista.indexOf('webhooks={webhooks.map('), vista.indexOf('puedeRotar='))
  assert.ok(!/secreto:/.test(mapeo), 'el mapeo a la vista incluye un secreto')
  assert.match(mapeo, /rotandoHasta:/)
})

test('la guía enseña a recorrer la lista, no a comparar una sola firma', () => {
  // Un receptor que compare solo la primera firma se rompe justo el día de una
  // rotación, y el fallo parecerá nuestro.
  const guia = leer(GUIA)
  assert.match(guia, /\.split\(','\)/)
  assert.match(guia, /some\(/)
  assert.match(guia, /rota|rotación/i)
})
