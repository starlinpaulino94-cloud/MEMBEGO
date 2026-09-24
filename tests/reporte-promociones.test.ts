import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PROMOCIONES · TRES RELOJES Y UNA COLUMNA MUERTA (rediseño de reportes · Fase 3).
 *
 * Lo que estas pruebas vigilan no es que salgan cifras, sino que el reporte no
 * empiece a medir con el reloj equivocado:
 *
 *  1. ADQUIRIR, ENTREGAR y USAR son tres momentos. Medirlos con la misma fecha
 *     daría un reporte que cuadra consigo mismo y no con el negocio.
 *  2. Los usos salen de la TRANSACCIÓN del mostrador, no de restar
 *     `usosRestantes`: regalar usos también baja ese contador.
 *  3. El enlace hasta la promoción va por ID y no por el título congelado del
 *     snapshot, que juntaría dos promociones homónimas.
 *  4. `Promocion.canjes` está declarada y NADIE la escribe. La guardia mira la
 *     causa: el día que alguien la escriba, habrá que decidir si se usa.
 *  5. El estado de una compra se pisa a sí mismo; el movimiento del periodo
 *     sale de la bitácora inmutable de transiciones, que sí tiene fecha.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const MOTOR = 'src/modules/reportes/promociones.ts'
const VISTA = 'src/components/reportes/ReportePromocionesVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/promociones/page.tsx'
const EXPORTA = 'src/app/(admin)/admin/reportes/promociones/export/route.ts'

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

/** Los valores de un enum del esquema, sin comentarios. */
function valoresDelEnum(archivo: string, nombre: string): string[] {
  const src = leer(archivo)
  const abre = src.indexOf(`enum ${nombre} {`)
  assert.notEqual(abre, -1, `no se encontró el enum ${nombre}`)
  return src
    .slice(abre, src.indexOf('\n}', abre))
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l && !l.startsWith('///'))
}

test('el reporte conoce TODOS los estados de compra', () => {
  // Un estado nuevo que no llegara a `ESTADOS_COMPRA` desaparecería del
  // movimiento del periodo sin que nada fallara.
  const motor = leer(MOTOR)
  const lista = motor.slice(
    motor.indexOf('export const ESTADOS_COMPRA'),
    motor.indexOf('] as const', motor.indexOf('export const ESTADOS_COMPRA'))
  )
  const faltan = valoresDelEnum('prisma/schema/promociones.prisma', 'CompraEstado').filter(
    (v) => !lista.includes(`'${v}'`)
  )
  assert.deepEqual(
    faltan,
    [],
    'estos estados existen en la tabla y el reporte no los conoce:\n' +
      faltan.map((v) => `  · ${v}`).join('\n')
  )
})

test('los tres relojes se miden con tres fechas distintas', () => {
  const motor = leer(MOTOR)
  // Adquirida: la fecha de la compra.
  assert.match(motor, /createdAt: \{ gte: r\.desde, lt: r\.hasta \}/)
  // Entregada: la transición a ACTIVA de la bitácora.
  assert.match(motor, /movimientos\.get\('ACTIVA'\)/, 'la entrega dejó de salir de la bitácora')
  assert.match(motor, /t\."hacia" = 'ACTIVA'/)
  // Usada: la transacción del mostrador.
  assert.match(motor, /tipo: 'PROMOTION_USE' as const/)
  // Y se dice en la pantalla y en el archivo, que es donde se leen mal.
  assert.match(leer(VISTA), /Cada una tiene su propio reloj/)
  assert.match(leer(EXPORTA), /Los tres relojes/)
})

test('los usos NO se cuentan restando usosRestantes', () => {
  // Regalar usos a un amigo baja ese contador sin que nadie haya canjeado: el
  // reporte metería los regalos dentro de los canjes.
  const motor = leer(MOTOR)
  assert.ok(
    !/usosRestantes.*decrement|decrement.*usosRestantes/.test(motor),
    'el reporte volvió a contar usos por diferencias del contador'
  )
  assert.match(motor, /REGALAR usos/, 'desapareció la explicación de por qué no se resta')
  // La causa que hace válida la regla: el regalo sigue moviendo el contador.
  assert.match(
    leer('src/modules/regalos/actions.ts'),
    /usosRestantes: \{ decrement: usos \}/,
    'si el regalo dejara de mover usos, esta guardia hay que replantearla'
  )
})

test('la promoción se identifica por ID, nunca por el título del snapshot', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /JOIN "qr_tokens" q\n\s*ON q\."id" = t\."qrTokenUsadoId"/)
  assert.match(motor, /ON pc\."id" = q\."compraId"/)
  // Solo se mira DENTRO de las consultas: el comentario del módulo sí nombra
  // el snapshot, justamente para explicar por qué no se agrupa por él.
  for (const c of motor.split('$queryRaw').slice(1)) {
    const abre = c.indexOf('`')
    const consulta = c.slice(abre, c.indexOf('`', abre + 1))
    assert.ok(
      !/snapshot/.test(consulta),
      `agrupar por el título congelado juntaría dos promociones homónimas:\n${consulta}`
    )
  }
})

test('Promocion.canjes no se usa mientras nadie la escriba', () => {
  // La guardia mira LA CAUSA. Hoy la columna existe, el marketplace la lee y
  // ningún código la escribe: vale 0 para todas y un ranking por ahí sería una
  // lista de ceros con pinta de dato.
  const escrita = archivos(join(raiz, 'src')).some((f) =>
    /canjes:\s*\{\s*(increment|decrement|set)/.test(readFileSync(f, 'utf8'))
  )
  const motor = leer(MOTOR)
  if (escrita) {
    assert.fail(
      'ya hay código que escribe Promocion.canjes: decide si el reporte pasa a usarla y actualiza esta guardia'
    )
  }
  assert.ok(
    !/"canjes"|canjes: true/.test(motor),
    'el reporte usa una columna que nadie escribe: daría cero en todas las filas'
  )
  assert.match(leer(VISTA), /la columna existe y no la\s*\n?\s*escribe nadie/)
})

test('el movimiento del periodo sale de la bitácora, no del estado de hoy', () => {
  // `ProductoCompra.estado` se pisa a sí mismo: contar por ahí diría «14
  // rechazadas» sin poder decir cuándo se rechazaron.
  const motor = leer(MOTOR)
  assert.match(motor, /FROM "producto_compra_transiciones" t/)
  assert.match(motor, /se pisa a sí mismo/)
  // Y la causa: la bitácora la escribe un helper único desde todos los sitios.
  assert.match(
    leer('src/modules/promociones/compra.ts'),
    /productoCompraTransicion\.create/,
    'si nadie escribe la bitácora, el movimiento del periodo queda vacío'
  )
})

test('sin ver_financieros la consulta del dinero NI SE LANZA', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /verDinero \? seguro\(ingresosEntregados/)
  assert.match(motor, /: Promise\.resolve\(0\)/)
  const csv = leer(EXPORTA)
  assert.match(csv, /puedeFuncion\('reportes', 'ver_financieros'\)/, 'el CSV no recomprueba')
  assert.match(csv, /OMITIDO - sin permiso ver_financieros/)
  assert.match(leer(VISTA), /r\.ingresos \?/)
})

test('el dinero declara su reloj, porque no es el de whereCobrado', () => {
  // `ProductoCompra` no tiene `fechaPago`: el dinero se fecha por la ENTREGA.
  // Una cifra sin su reloj declarado se compara con la de Finanzas y no cuadra.
  const motor = leer(MOTOR)
  assert.match(motor, /no guarda una\s*\n?\s*\/\/ fecha de pago propia/)
  assert.match(leer(VISTA), /Se fecha por la entrega/)
  assert.match(leer(EXPORTA), /fechado por la ENTREGA/)
})

test('cada consulta cruda va acotada a la empresa, también en los JOIN', () => {
  const motor = leer(MOTOR)
  const crudas = motor.split('$queryRaw').slice(1)
  assert.ok(crudas.length >= 5, 'cambió la forma del módulo: revisa esta guardia')
  for (const c of crudas) {
    const abre = c.indexOf('`')
    const consulta = c.slice(abre, c.indexOf('`', abre + 1))
    assert.match(consulta, /"companyId" = \$\{companyId\}/, `consulta sin empresa:\n${consulta}`)
  }
  // La tabla de transiciones NO guarda companyId: el JOIN lleva el suyo, para
  // que la acotación no dependa de una sola tabla.
  assert.match(motor, /JOIN "producto_compras" pc\n\s*ON pc\."id" = t\."compraId"\n\s*AND pc\."companyId" = \$\{companyId\}/)
})

test('todo se cuenta en la base y el día se corta en la zona del negocio', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /AT TIME ZONE/, 'el día se cortaría en UTC')
  assert.match(motor, /count\(\*\) AS total/)
  assert.ok(!/findMany\(\)\.length/.test(motor))
})

test('las agrupaciones van con tope y lo recortado se declara', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /LIMIT \$\{TOPE_GRUPOS\}/)
  assert.match(motor, /RESTO = '\(resto, agrupado\)'/)
  assert.match(motor, /conElResto\(top, adquiridas, usadas\)/)
})

test('la foto de hoy no se compara contra el periodo anterior', () => {
  // Catálogo, cola de trabajo y vitrina no dependen del rango: una variación
  // ahí sería inventada. Van como números pelados, nunca como Kpi.
  const motor = leer(MOTOR)
  const tipos = motor.slice(motor.indexOf('export interface ReportePromociones'), motor.indexOf('/**', motor.indexOf('export interface ReportePromociones')))
  for (const campo of ['publicadas', 'comprables', 'archivadas', 'vencenPronto', 'enValidacion', 'vistas']) {
    const linea = tipos.split('\n').find((l) => l.trim().startsWith(`${campo}:`))
    if (linea) assert.ok(!linea.includes('Kpi'), `«${campo}» es foto de hoy y no puede ser un Kpi`)
  }
  assert.match(leer(VISTA), /Foto de hoy — no depende del periodo/)
})

test('la vitrina se declara como acumulada y como suelo', () => {
  // `viewCount` se escribe con tope por navegador y sin fecha: no se puede
  // recortar al periodo ni presentarse como un conteo exacto.
  assert.match(
    leer('src/modules/marketplace/actions.ts'),
    /MAX_VIEWS_PER_WINDOW/,
    'si el contador dejara de estar topado, revisa el aviso del reporte'
  )
  assert.match(leer(VISTA), /acumulados DESDE SIEMPRE/)
  assert.match(leer(EXPORTA), /un suelo, no un conteo exacto/)
})

test('cada gráfico lleva su tabla equivalente', () => {
  const vista = leer(VISTA)
  const paneles = vista.split('<PanelGrafico').length - 1
  assert.ok(paneles >= 2, 'el reporte perdió sus gráficos')
  assert.equal(vista.split('tabla={').length - 1, paneles, 'hay un gráfico sin su tabla')
})

test('la alarma de comprobantes solo se enlaza a quien puede resolverla', () => {
  assert.match(leer(PAGINA), /requireSection\('promociones'\)/)
  assert.match(leer(VISTA), /hrefCompras &&/)
})

test('el reporte se alcanza desde la pantalla de reportes y exporta el mismo periodo', () => {
  assert.match(leer('src/app/(admin)/admin/reportes/page.tsx'), /\/admin\/reportes\/promociones/)
  assert.match(leer(EXPORTA), /leerRango\(sp, timeZone\)/, 'el CSV no debe recalcular el periodo')
  assert.match(leer(PAGINA), /paramsDeRango\(rango\)/)
})
