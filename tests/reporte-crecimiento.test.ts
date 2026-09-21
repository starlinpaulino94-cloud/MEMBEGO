import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CRECIMIENTO · EL EMBUDO QUE SÍ TIENE DATO (rediseño de reportes · Fase 2).
 *
 * La auditoría del módulo dejó tres áreas que NO se pueden reportar con
 * honestidad —cupones no existe como entidad, `Promocion.canjes` no cuenta
 * canjes, `BenefitGrant.redeemedAt` no lo escribe nadie— y una que sí:
 * crecimiento tiene dos bitácoras que el código vivo escribe de verdad.
 *
 * Lo que estas pruebas vigilan no es que las cifras salgan, sino que el reporte
 * no empiece a aparentar más de lo que sabe:
 *
 *  1. Un tipo de evento NUEVO tiene que entrar en el embudo o quedar declarado
 *     fuera CON SU RAZÓN. Si no, desaparecería sin que nada fallara.
 *  2. `PRIMER_USO` está en el enum y nadie lo escribe. La guardia vigila LA
 *     CAUSA: el día que alguien lo escriba, exige que entre en el embudo.
 *  3. Los dos embudos —referidos y campañas «Invita y Gana»— miden los mismos
 *     hitos con otros nombres. Sumarlos contaría dos veces a la misma persona.
 *  4. El embudo es un SUELO: `logReferralEvent` traga sus errores a propósito.
 *     Si ese aviso desaparece, el reporte pasa a leerse como un conteo exacto
 *     sin cambiar una cifra.
 *  5. Los nombres van detrás de `ver_datos_personales`, y la consulta ni se
 *     lanza sin él: la exportación usa la misma función.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const MOTOR = 'src/modules/reportes/crecimiento.ts'
const VISTA = 'src/components/reportes/ReporteCrecimientoVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/crecimiento/page.tsx'
const EXPORTA = 'src/app/(admin)/admin/reportes/crecimiento/export/route.ts'

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

test('el reporte conoce TODOS los tipos de evento: o son etapa, o están declarados fuera', () => {
  // Un tipo nuevo que no llegue a ninguna de las dos listas se caería del
  // reporte en silencio: los eventos existirían y no se contarían.
  const motor = leer(MOTOR)
  const etapas = motor.slice(motor.indexOf('export const ETAPAS'), motor.indexOf('] as const'))
  const fuera = motor.slice(
    motor.indexOf('export const FUERA_DEL_EMBUDO'),
    motor.lastIndexOf('] as const')
  )
  const faltan = valoresDelEnum('prisma/schema/referidos.prisma', 'ReferralEventTipo').filter(
    (v) => !etapas.includes(`'${v}'`) && !fuera.includes(`'${v}'`)
  )
  assert.deepEqual(
    faltan,
    [],
    'estos tipos existen en la tabla y el reporte no los conoce:\n' +
      faltan.map((v) => `  · ${v}`).join('\n')
  )
})

test('PRIMER_USO se queda fuera mientras nadie lo escriba, y entra en cuanto alguien lo haga', () => {
  // La guardia mira LA CAUSA, no el síntoma. Hoy el tipo está declarado y tiene
  // cero escrituras: enseñarlo daría un cero permanente que se leería como
  // «nadie canjea». El día que el código lo escriba, esta prueba obliga a
  // subirlo al embudo en vez de dejar el reporte incompleto sin avisar.
  const escrito = archivos(join(raiz, 'src')).some((f) =>
    /tipo:\s*'PRIMER_USO'/.test(readFileSync(f, 'utf8'))
  )
  const motor = leer(MOTOR)
  const etapas = motor.slice(motor.indexOf('export const ETAPAS'), motor.indexOf('] as const'))
  if (escrito) {
    assert.match(
      etapas,
      /'PRIMER_USO'/,
      'ya hay código que escribe PRIMER_USO: la etapa tiene que entrar en el embudo'
    )
  } else {
    assert.ok(
      !etapas.includes("'PRIMER_USO'"),
      'PRIMER_USO sigue sin escribirse: como etapa sería un cero permanente'
    )
    assert.match(leer(MOTOR), /sin una sola escritura en el código/)
  }
})

test('los dos embudos NO se suman: el de campañas va en su propia sección', () => {
  // `ReferralEventTipo` e `InvitacionEventoTipo` miden los mismos hitos con
  // otros nombres —el propio esquema lista las equivalencias—, así que quien
  // pasó por una campaña puede dejar huella en los dos.
  const motor = leer(MOTOR)
  assert.match(motor, /campanas: FilaCampana\[\]/, 'el embudo de campañas no tiene campo propio')
  assert.match(motor, /invitacion_eventos/, 'el reporte no mira la bitácora de campañas')
  assert.match(leer(VISTA), /NO se suman a las de arriba/, 'la pantalla ya no avisa')
  assert.match(leer(EXPORTA), /NO se suman a las del programa de referidos/, 'el CSV ya no lo dice')
})

test('el embudo se declara como un SUELO, no como un conteo exacto', () => {
  // `logReferralEvent` traga sus errores a propósito para no romper el registro
  // ni el pago. Sin este aviso, «1.240 clics» se lee como una verdad exacta.
  assert.match(
    leer('src/lib/referidos.ts'),
    /Nunca lanza|nunca lanza/,
    'si el tracking dejara de ser best-effort, este reporte puede dejar de avisar'
  )
  assert.match(leer(MOTOR), /SUELO, NO UNA VERDAD EXACTA/)
  assert.match(
    leer(VISTA),
    /el evento se pierde en silencio/,
    'la pantalla ya no avisa de que el embudo es un suelo'
  )
  assert.match(leer(EXPORTA), /ES UN SUELO, no un conteo exacto/, 'descargado sería indistinguible')
})

test('sin ver_datos_personales la consulta de personas NI SE LANZA', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /opciones\.verDatosPersonales === true/)
  assert.match(motor, /:\s*Promise\.resolve\(null\)/)
  const csv = leer(EXPORTA)
  assert.match(
    csv,
    /puedeFuncion\('reportes', 'ver_datos_personales'\)/,
    'el CSV no recomprueba el permiso y los nombres saldrían cambiando de ruta'
  )
  assert.match(csv, /OMITIDO - sin permiso ver_datos_personales/)
  assert.match(leer(VISTA), /r\.topReferentes === null/)
})

test('todo se cuenta en la base y el día se corta en la zona del negocio', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /count\(DISTINCT "clienteId"\)/, 'los referentes distintos no se cuentan en SQL')
  assert.match(motor, /AT TIME ZONE/, 'el día se cortaría en UTC y los clics de la noche bailarían')
  assert.match(motor, /groupBy\(/)
  assert.ok(!/findMany\(\)\.length/.test(motor), 'una lista traída a memoria no es un conteo')
})

test('cada consulta cruda va acotada a la empresa, también en el JOIN', () => {
  const motor = leer(MOTOR)
  const crudas = motor.split('$queryRaw').slice(1)
  assert.ok(crudas.length >= 4, 'cambió la forma del módulo: revisa esta guardia')
  for (const c of crudas) {
    // El corte va de la PRIMERA comilla invertida a la segunda: antes vienen
    // los parámetros de tipo, que no son la consulta.
    const abre = c.indexOf('`')
    const consulta = c.slice(abre, c.indexOf('`', abre + 1))
    assert.match(consulta, /"companyId" = \$\{companyId\}/, `consulta sin empresa:\n${consulta}`)
  }
  // El JOIN con las campañas lleva su PROPIO filtro de empresa: acotar solo la
  // tabla de eventos dejaría el nombre de una campaña ajena entrando por el
  // join si algún día un evento quedara mal etiquetado.
  assert.match(motor, /JOIN "campanas_invitacion" c\n\s*ON c\."id" = e\."campanaId"\n\s*AND c\."companyId" = \$\{companyId\}/)
})

test('las agrupaciones van con tope y lo recortado se declara', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /LIMIT \$\{TOPE_GRUPOS\}/)
  assert.match(motor, /RESTO = '\(resto, agrupado\)'/)
  assert.match(motor, /conElResto\(canales, compartidos, clics\)/)
})

test('una tasa sin denominador es «sin dato», nunca 0 %', () => {
  // Un 0 % afirma que nadie que entró se registró; lo que pasó es que no entró
  // nadie. Son cosas distintas y el reporte no las confunde.
  const motor = leer(MOTOR)
  assert.match(motor, /tasaRegistro: clics === 0 \? null :/)
  assert.match(motor, /tasaMembresia: registros === 0 \? null :/)
  assert.match(leer(VISTA), /r\.tasaRegistro == null \? 'Sin dato'/)
})

test('los sospechosos no cuentan como crecimiento', () => {
  // El antifraude los aparta del programa; contarlos aquí inflaría el embudo
  // justo con lo que el propio sistema decidió no premiar.
  const motor = leer(MOTOR)
  assert.match(motor, /sospechoso: false/, 'los completados dejaron de filtrar los sospechosos')
  assert.match(motor, /sospechoso: true/, 'ya no se enseña cuántos se apartaron')
  assert.match(leer(VISTA), /no cuentan en el embudo/)
})

test('los dos motores de recompensa se enseñan separados', () => {
  // Una misma empresa puede tener reglas en los dos: un total sumado no
  // correspondería a ninguna configuración real.
  const motor = leer(MOTOR)
  assert.match(motor, /referralRecompensa\.groupBy/)
  assert.match(motor, /growthReward\.groupBy/)
  assert.match(leer(VISTA), /sumarlos daría un total que no corresponde/)
})

test('cada gráfico lleva su tabla equivalente', () => {
  // La regla del rediseño: `PanelGrafico` la exige en su firma, pero la
  // guardia comprueba que nadie la satisfaga con un hueco.
  const vista = leer(VISTA)
  const paneles = vista.split('<PanelGrafico').length - 1
  assert.ok(paneles >= 3, 'el reporte perdió sus gráficos')
  assert.equal(vista.split('tabla={').length - 1, paneles, 'hay un gráfico sin su tabla')
})

test('el reporte se alcanza desde la pantalla de reportes y exporta el mismo periodo', () => {
  assert.match(leer('src/app/(admin)/admin/reportes/page.tsx'), /\/admin\/reportes\/crecimiento/)
  assert.match(leer(EXPORTA), /leerRango\(sp, timeZone\)/, 'el CSV no debe recalcular el periodo')
  assert.match(leer(PAGINA), /paramsDeRango\(rango\)/)
})
