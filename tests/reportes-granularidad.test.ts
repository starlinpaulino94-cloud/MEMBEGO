import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  leerRango,
  granularidadAutomatica,
  GRANULARIDADES,
  MAX_DIAS_SERIE,
  DIAS_MAX_DIARIO,
} from '../src/modules/reportes/rango'
import { plegarSerie, serieParaGrafico, etiquetaCubo } from '../src/modules/reportes/serie'

/**
 * TENDENCIAS · LA GRANULARIDAD DE LA SERIE (rediseño de reportes · Fase 5).
 *
 * Una serie diaria de 365 puntos no es una tendencia: es ruido con forma de
 * gráfica. Lo que estas pruebas vigilan:
 *
 *  1. Que plegar sea SUMAR los mismos días que ya vinieron de la base. Si la
 *     semana no cuadrara con sus días, habría dos verdades del mismo periodo.
 *  2. Que solo se plieguen cifras ADITIVAS. La media de una semana no es la
 *     suma de las medias de sus días, y una tasa plegada así sería mentira.
 *  3. Que la granularidad viaje en la URL, como todo en esta pantalla.
 *  4. Que el recorte de la serie larga se DIGA. Antes se hacía en silencio.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const TZ = 'America/Santo_Domingo'
/** Miércoles 16 de septiembre de 2026, 15:00 en Santo Domingo. */
const RELOJ = new Date('2026-09-16T19:00:00Z')

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

// ── Plegar es sumar ──────────────────────────────────────────────────────────

test('plegar por semana suma exactamente los mismos días', () => {
  // Lunes 7 a domingo 20 de septiembre de 2026: dos semanas completas.
  const dias = Array.from({ length: 14 }, (_, i) => ({
    dia: `2026-09-${String(7 + i).padStart(2, '0')}`,
    ventas: i + 1,
    ingresos: (i + 1) * 100,
  }))
  const semanas = plegarSerie(dias, 'semana')
  assert.equal(semanas.length, 2)
  assert.equal(semanas[0].dia, '2026-09-07', 'la semana se rotula por su lunes')
  assert.equal(semanas[1].dia, '2026-09-14')
  // 1..7 = 28 y 8..14 = 77. Si esto cambiara, la semana y el día dirían cosas
  // distintas del mismo periodo.
  assert.equal(semanas[0].ventas, 28)
  assert.equal(semanas[1].ventas, 77)
  assert.equal(
    semanas.reduce((s, x) => s + x.ventas, 0),
    dias.reduce((s, x) => s + x.ventas, 0),
    'la suma de los cubos tiene que ser la suma de los días'
  )
  assert.equal(semanas[0].ingresos, 2800, 'el dinero se pliega igual que los conteos')
})

test('plegar por mes agrupa por mes natural y conserva el total', () => {
  const dias = [
    { dia: '2026-08-30', canjes: 5 },
    { dia: '2026-08-31', canjes: 7 },
    { dia: '2026-09-01', canjes: 2 },
  ]
  const meses = plegarSerie(dias, 'mes')
  assert.deepEqual(
    meses.map((m) => [m.dia, m.canjes]),
    [
      ['2026-08-01', 12],
      ['2026-09-01', 2],
    ]
  )
})

test('un rango que empieza a media semana da un primer cubo PARCIAL', () => {
  // Y es lo correcto: el reporte enseña lo que pasó dentro del periodo pedido,
  // no la semana entera a la que ese tramo pertenece.
  const dias = [
    { dia: '2026-09-10', n: 1 }, // jueves
    { dia: '2026-09-11', n: 1 },
    { dia: '2026-09-14', n: 1 }, // lunes siguiente
  ]
  const semanas = plegarSerie(dias, 'semana')
  assert.equal(semanas.length, 2)
  assert.equal(semanas[0].n, 2, 'el tramo suelto no se rellena con días de fuera del periodo')
})

test('«por día» devuelve la serie intacta', () => {
  const dias = [{ dia: '2026-09-10', n: 1 }]
  assert.equal(plegarSerie(dias, 'dia'), dias, 'plegar por día no debe copiar ni recalcular nada')
})

test('la etiqueta distingue semana de día, y pone el año cuando hace falta', () => {
  assert.equal(etiquetaCubo('2026-09-14', 'dia'), '14/09')
  // «14/09» a secas en un eje semanal se lee como un día suelto.
  assert.equal(etiquetaCubo('2026-09-14', 'semana'), 'sem. 14/09')
  assert.equal(etiquetaCubo('2026-09-01', 'mes'), 'sep')
  assert.equal(etiquetaCubo('2026-09-01', 'mes', { conAno: true }), 'sep 2026')
  // Un rango que cruza de año necesita el año: «ene» detrás de «dic» no dice cuál.
  const cruzado = serieParaGrafico(
    [{ dia: '2025-12-15', n: 1 }, { dia: '2026-01-15', n: 1 }],
    'mes'
  )
  assert.deepEqual(cruzado.map((p) => p.dia), ['dic 2025', 'ene 2026'])
  // Y conserva la clave cruda, para que la tabla pueda ordenar o enlazar.
  assert.equal(cruzado[0].clave, '2025-12-01')
})

// ── Solo cifras aditivas ─────────────────────────────────────────────────────

test('ninguna serie del módulo mete una tasa, un promedio ni un porcentaje', () => {
  // Plegar SUMA. La media de una semana no es la suma de las medias de sus
  // días: si alguna serie empezara a llevar una tasa, la gráfica semanal
  // enseñaría un número inventado.
  const prohibidos = /^\s*(tasa|promedio|media|porcentaje|ratio)[A-Za-z]*:/i
  const motores = archivos(join(raiz, 'src', 'modules', 'reportes'))
  for (const f of motores) {
    const src = readFileSync(f, 'utf8')
    const re = /export interface Punto[A-Za-z]*\s*\{([\s\S]*?)\n\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      for (const linea of m[1].split('\n')) {
        assert.ok(
          !prohibidos.test(linea),
          `${f}: una serie no puede llevar «${linea.trim()}» — plegarla la sumaría`
        )
      }
    }
  }
})

// ── La granularidad viaja en la URL ──────────────────────────────────────────

test('sin pedir nada, la granularidad se ajusta al largo del periodo', () => {
  assert.equal(granularidadAutomatica(1), 'dia')
  assert.equal(granularidadAutomatica(DIAS_MAX_DIARIO), 'dia')
  assert.equal(granularidadAutomatica(DIAS_MAX_DIARIO + 1), 'semana')
  assert.equal(granularidadAutomatica(365), 'semana')
  assert.equal(granularidadAutomatica(500), 'mes')

  const mes = leerRango({ rango: '30d' }, TZ, RELOJ)
  assert.equal(mes.granularidad, 'dia')
  assert.equal(mes.granularidadPedida, false)
  const ano = leerRango({ rango: '365d' }, TZ, RELOJ)
  assert.equal(ano.granularidad, 'semana', 'un año en días son 365 barras')
})

test('la granularidad pedida a mano manda y viaja en el enlace', () => {
  const r = leerRango({ rango: '30d', g: 'mes' }, TZ, RELOJ)
  assert.equal(r.granularidad, 'mes')
  assert.equal(r.granularidadPedida, true)
  // Una inventada no rompe ni filtra a ciegas: se cae a la automática.
  const malo = leerRango({ rango: '30d', g: 'decada' }, TZ, RELOJ)
  assert.equal(malo.granularidad, 'dia')
  assert.equal(malo.granularidadPedida, false)
})

test('la exportación se lleva la granularidad elegida, y solo esa', () => {
  const rango = leer('src/modules/reportes/rango.ts')
  assert.match(rango, /if \(rango\.granularidadPedida\) \{\n\s*sp\.set\('g', rango\.granularidad\)/)
  // La automática NO viaja: se recalcula sola y así el enlace no se llena de
  // parámetros que no hacen falta.
  assert.match(rango, /la automática se recalcula sola/)
})

test('cambiar de periodo no pierde la granularidad elegida', () => {
  assert.match(
    leer('src/components/reportes/RangoFechas.tsx'),
    /if \(rango\.granularidadPedida\) sp\.set\('g', rango\.granularidad\)/
  )
})

// ── El recorte se dice ───────────────────────────────────────────────────────

test('una serie más larga que el tope lo AVISA en vez de recortar en silencio', () => {
  const largo = leerRango({ desde: '2024-01-01', hasta: '2026-09-16' }, TZ, RELOJ)
  assert.ok(largo.dias > MAX_DIAS_SERIE)
  assert.equal(largo.serieRecortada, true)
  const corto = leerRango({ rango: '30d' }, TZ, RELOJ)
  assert.equal(corto.serieRecortada, false)
  const barra = leer('src/components/reportes/RangoFechas.tsx')
  assert.match(barra, /rango\.serieRecortada &&/)
  // El aviso SÍ se imprime: en papel, una serie corta sin nota es
  // indistinguible de un periodo sin datos.
  // Solo la etiqueta del aviso: justo detrás empieza la fila de controles, que
  // sí es `print:hidden` y con una ventana más ancha daría un falso positivo.
  const aviso = barra.slice(barra.indexOf('rango.serieRecortada &&'))
  const etiqueta = aviso.slice(aviso.indexOf('<p '), aviso.indexOf('>', aviso.indexOf('<p ')))
  assert.ok(
    !etiqueta.includes('print:hidden'),
    'el aviso del recorte no puede quedarse fuera del papel'
  )
})

// ── Todas las vistas pliegan ─────────────────────────────────────────────────

test('las ocho vistas con serie la pliegan, ninguna pinta los días crudos', () => {
  const vistas = archivos(join(raiz, 'src', 'components', 'reportes')).filter((f) =>
    /Reporte[A-Za-z]+Vista\.tsx$/.test(f)
  )
  const conSerie = vistas.filter((f) => /serieParaGrafico|\bserie\b/.test(readFileSync(f, 'utf8')))
  assert.ok(conSerie.length >= 8, `esperaba al menos 8 vistas con serie, hay ${conSerie.length}`)
  for (const f of conSerie) {
    const src = readFileSync(f, 'utf8')
    if (!/const serie = serieParaGrafico/.test(src)) continue
    // Fuera la línea que DEFINE el plegado: ahí `r.serie` es la entrada.
    const resto = src.replace(/const serie = serieParaGrafico\([^)]*\)/g, '')
    assert.ok(
      !/\br\.serie\b|\breporte\.serie\b/.test(resto),
      `${f}: quedó un uso de la serie sin plegar; la gráfica y el control dirían cosas distintas`
    )
  }
})

test('el plegado NO toca ninguna consulta: el corte del día sigue en la base', () => {
  // Si la agrupación se reescribiera con `date_trunc`, habría que volver a
  // pasarle la zona horaria a cada consulta y una que se olvidara cortaría en
  // UTC sin avisar.
  // Sin comentarios: el módulo NOMBRA `date_trunc` justo para explicar por qué
  // no lo usa, y esa explicación no puede hacer fallar la guardia.
  const serie = leer('src/modules/reportes/serie.ts')
  const codigo = serie
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/date_trunc|\$queryRaw/.test(codigo), 'el plegado no debe bajar a SQL')
  // La explicación sí se exige, y vive en el comentario del módulo.
  assert.match(serie, /POR QUÉ SE PLIEGA AQUÍ Y NO EN SQL/)
  // Y los motores siguen cortando el día en la zona del negocio.
  for (const f of archivos(join(raiz, 'src', 'modules', 'reportes'))) {
    const src = readFileSync(f, 'utf8')
    if (!/to_char\(/.test(src)) continue
    assert.match(src, /AT TIME ZONE/, `${f}: el día se cortaría en UTC`)
  }
})

test('la granularidad solo cambia la gráfica, nunca las cifras del resumen', () => {
  // Los KPI salen de `count`/`sum` en la base sobre el rango entero; el
  // plegado vive solo en la capa de presentación.
  for (const g of GRANULARIDADES) {
    const r = leerRango({ rango: '90d', g: g.clave }, TZ, RELOJ)
    assert.equal(r.dias, 90, 'la granularidad no puede mover los límites del periodo')
    assert.equal(r.desdeDia, leerRango({ rango: '90d' }, TZ, RELOJ).desdeDia)
    assert.equal(r.hasta.getTime(), leerRango({ rango: '90d' }, TZ, RELOJ).hasta.getTime())
  }
  assert.match(leer('src/components/reportes/RangoFechas.tsx'), /nunca las cifras del resumen/)
})
