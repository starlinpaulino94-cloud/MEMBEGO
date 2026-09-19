import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CÓDIGOS Y REGALOS · LA CATEGORÍA QUE SUSTITUYE A «CUPONES»
 * (rediseño de reportes · Fase 4).
 *
 * El plan pedía cupones. No existen: no hay modelo `Cupon`, y los tipos
 * declarados no los escribe nadie. En su lugar se reporta lo que SÍ existe —
 * regalos entre clientes y gift cards—, y estas pruebas vigilan que no se
 * confundan entre sí ni con el dinero del negocio:
 *
 *  1. Un REGALO hay que aceptarlo; una GIFT CARD es dinero que ya entró.
 *     No se suman en ninguna cifra.
 *  2. El SALDO VIVO es un pasivo. Presentarlo como ingreso contaría el mismo
 *     dinero dos veces: al venderse y al consumirse.
 *  3. El consumo de una gift card NO tiene fecha, y la transacción que emite la
 *     comparten cuatro flujos: por eso va como acumulado y nunca por periodo.
 *  4. La tasa de aceptación sale de los CERRADOS y sin los que retiró quien los
 *     envió: cancelar es una decisión del remitente, no un rechazo.
 *  5. Si algún día aparece un modelo de cupones, esta categoría hay que
 *     revisarla — la guardia mira la causa.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const MOTOR = 'src/modules/reportes/regalos.ts'
const VISTA = 'src/components/reportes/ReporteRegalosVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/regalos/page.tsx'
const EXPORTA = 'src/app/(admin)/admin/reportes/regalos/export/route.ts'

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

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

test('el reporte conoce TODOS los tipos y desenlaces de regalo', () => {
  const motor = leer(MOTOR)
  const tipos = motor.slice(
    motor.indexOf('export const TIPOS_REGALO'),
    motor.indexOf('] as const', motor.indexOf('export const TIPOS_REGALO'))
  )
  const faltanTipos = valoresDelEnum('prisma/schema/caja.prisma', 'RegaloTipo').filter(
    (v) => !tipos.includes(`'${v}'`)
  )
  assert.deepEqual(faltanTipos, [], `tipos de regalo que el reporte no conoce: ${faltanTipos}`)

  // PENDIENTE no es un desenlace: es la espera, y se enseña como foto de hoy.
  const desenlaces = motor.slice(
    motor.indexOf('export const DESENLACES_REGALO'),
    motor.indexOf('] as const', motor.indexOf('export const DESENLACES_REGALO'))
  )
  const faltan = valoresDelEnum('prisma/schema/caja.prisma', 'RegaloEstado')
    .filter((v) => v !== 'PENDIENTE')
    .filter((v) => !desenlaces.includes(`'${v}'`))
  assert.deepEqual(faltan, [], `desenlaces que el reporte no conoce: ${faltan}`)
  assert.match(leer(VISTA), /Regalos sin responder/, 'la espera dejó de enseñarse')
})

test('el saldo vivo se declara como PASIVO, no como ingreso', () => {
  // Es la cifra que más fácil se lee mal: ese dinero ya se cobró al vender la
  // gift card, y el servicio todavía se debe.
  assert.match(leer(MOTOR), /EL SALDO VIVO ES UN PASIVO, NO UN INGRESO/)
  assert.match(leer(VISTA), /dinero cobrado que todavía debes/)
  assert.match(leer(VISTA), /lo contaría dos veces/)
  assert.match(leer(EXPORTA), /Es un PASIVO, no un ingreso/)
})

test('el consumo de gift card va como acumulado, nunca por periodo', () => {
  const motor = leer(MOTOR)
  // Lo consumido sale de la resta, no de contar transacciones: `BENEFIT_USE`
  // lo emiten cuatro flujos distintos.
  assert.match(motor, /consumidoAcumulado: number \| null/)
  assert.match(motor, /Number\(consumido\._sum\.monto \?\? 0\) - Number\(consumido\._sum\.saldo \?\? 0\)/)
  assert.ok(
    !/BENEFIT_USE/.test(motor.replace(/\/\*[\s\S]*?\*\//g, '')),
    'contar BENEFIT_USE mezclaría gift cards con ofertas privadas y regalos'
  )
  // La causa: ese tipo de transacción lo comparten varios flujos.
  const emisores = archivos(join(raiz, 'src')).filter((f) =>
    /tipo: 'BENEFIT_USE'/.test(readFileSync(f, 'utf8'))
  )
  assert.ok(
    emisores.length > 1,
    'si BENEFIT_USE pasara a ser exclusivo de gift cards, el consumo SÍ se podría fechar'
  )
  assert.match(leer(VISTA), /el consumo no guarda fecha/)
})

test('la tasa de aceptación sale de los CERRADOS y sin los retirados', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /cerrados === 0 \? null : Math\.round\(\(aceptados \/ cerrados\) \* 100\)/)
  assert.match(motor, /DESENLACES_REGALO\.filter\(\(d\) => d\.cierra\)/)
  // CANCELADO existe como desenlace pero NO cierra: lo retira el remitente.
  assert.match(motor, /clave: 'CANCELADO'.*cierra: false/s)
  assert.match(leer(VISTA), /no entran en la tasa de aceptación/)
})

test('regalos y gift cards no se suman en ninguna cifra', () => {
  const motor = leer(MOTOR)
  // Cada uno tiene sus propios campos; no hay un total combinado.
  assert.match(motor, /enviados: Kpi/)
  assert.match(motor, /emitidas: Kpi/)
  assert.ok(
    !/totalRegalosYGiftCards|totalCombinado/.test(motor),
    'un total combinado mezclaría algo que hay que aceptar con dinero que ya entró'
  )
  assert.match(leer(VISTA), /no se\s+suman en ninguna cifra/)
})

test('la categoría sigue siendo la sustituta de cupones mientras no existan', () => {
  // La guardia mira LA CAUSA: hoy no hay modelo `Cupon` en el esquema. Si
  // apareciera, habría que decidir si esta categoría se divide.
  const esquemas = readdirSync(join(raiz, 'prisma', 'schema'))
    .map((f) => readFileSync(join(raiz, 'prisma', 'schema', f), 'utf8'))
    .join('\n')
  assert.ok(
    !/\nmodel Cupon\b/.test(esquemas),
    'apareció un modelo Cupon: revisa si «Códigos y regalos» debe separarse'
  )
  assert.match(leer(MOTOR), /POR QUÉ ESTA CATEGORÍA Y NO «CUPONES»/)
  assert.match(leer(VISTA), /no existen como entidad en el\s*\n?\s*sistema/)
})

test('los dos permisos viajan a la consulta y NI SE LANZA lo que no toca', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /const verDinero = opciones\.verFinancieros === true/)
  assert.match(motor, /opciones\.verDatosPersonales === true/)
  assert.match(motor, /:\s*Promise\.resolve\(null\)/)
  const csv = leer(EXPORTA)
  assert.match(csv, /puedeFuncion\('reportes', 'ver_financieros'\)/)
  assert.match(csv, /puedeFuncion\('reportes', 'ver_datos_personales'\)/)
  assert.match(csv, /OMITIDO - sin permiso ver_datos_personales/)
  assert.match(leer(VISTA), /r\.topRemitentes === null/)
})

test('todo se cuenta en la base y el día se corta en la zona del negocio', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /AT TIME ZONE/, 'el día se cortaría en UTC')
  assert.match(motor, /groupBy\(/)
  assert.match(motor, /aggregate\(/)
  assert.ok(!/findMany\(\)\.length/.test(motor))
})

test('cada consulta cruda va acotada a la empresa', () => {
  const motor = leer(MOTOR)
  const crudas = motor.split('$queryRaw').slice(1)
  assert.ok(crudas.length >= 1, 'cambió la forma del módulo: revisa esta guardia')
  for (const c of crudas) {
    const abre = c.indexOf('`')
    const consulta = c.slice(abre, c.indexOf('`', abre + 1))
    // La serie une dos subconsultas: las DOS llevan su empresa.
    const veces = (consulta.match(/"companyId" = \$\{companyId\}/g) ?? []).length
    assert.ok(veces >= 1, `consulta sin empresa:\n${consulta}`)
    const desde = (consulta.match(/FROM "regalos"/g) ?? []).length
    assert.equal(veces, desde || veces, 'cada subconsulta debe llevar su propio filtro de empresa')
  }
})

test('la serie usa DOS relojes: enviado por createdAt, aceptado por resueltoAt', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /Dos relojes distintos en la misma consulta/)
  assert.match(motor, /"estado" = 'ACEPTADO'/)
  assert.match(motor, /"resueltoAt" >= \$\{rango\.desde\}/)
})

test('cada gráfico lleva su tabla equivalente', () => {
  const vista = leer(VISTA)
  const paneles = vista.split('<PanelGrafico').length - 1
  assert.ok(paneles >= 2, 'el reporte perdió sus gráficos')
  assert.equal(vista.split('tabla={').length - 1, paneles, 'hay un gráfico sin su tabla')
})

test('la alarma de vencimiento solo se enlaza a quien puede resolverla', () => {
  assert.match(leer(PAGINA), /requireSection\('regalos'\)/)
  assert.match(leer(VISTA), /hrefRegalos &&/)
})

test('el reporte se alcanza desde la pantalla de reportes y exporta el mismo periodo', () => {
  assert.match(leer('src/app/(admin)/admin/reportes/page.tsx'), /\/admin\/reportes\/regalos/)
  assert.match(leer(EXPORTA), /leerRango\(sp, timeZone\)/, 'el CSV no debe recalcular el periodo')
  assert.match(leer(PAGINA), /paramsDeRango\(rango\)/)
})
