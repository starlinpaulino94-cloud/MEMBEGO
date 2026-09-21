import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LOS GRÁFICOS DE LOS REPORTES (rediseño de reportes · Fase 8).
 *
 * Cinco reportes no tenían ni un gráfico: finanzas, membresías, clientes,
 * operación y citas. Y en cuatro de ellos estaba escrito en la cabecera que era
 * una DECISIÓN, con su razón: `ResponsiveContainer` de Recharts sale en blanco
 * en `@media print`, y esos reportes se imprimen.
 *
 * La razón era cierta. La conclusión dejó de serlo el día que apareció
 * `PanelGrafico`, que **exige** la tabla equivalente además del gráfico: el
 * papel sale con los mismos números de siempre y la pantalla gana la forma.
 *
 * Lo que estas pruebas vigilan:
 *
 *  1. Que ningún reporte se quede sin gráfico otra vez, y que ninguno pinte un
 *     gráfico suelto: todo gráfico va dentro de un `PanelGrafico`, que es lo
 *     único que garantiza la tabla para el papel y para un lector de pantalla.
 *  2. Que las tablas NO se hayan perdido por el camino. El encargo decía «no
 *     eliminar funcionalidades»: cada tabla que estaba antes sigue estando,
 *     ahora dentro del panel.
 *  3. Que toda serie que se dibuja esté plegada a la granularidad del periodo.
 *     Un año en días son 365 puntos y no se lee ninguno.
 *  4. Que la serie de finanzas siga siendo SOLO caja. Es la que puede mentir:
 *     los cobros de membresía se fechan con otro reloj.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const VISTAS_DIR = join(raiz, 'src', 'components', 'reportes')

/** Los reportes que estrenan gráfico en esta fase. */
const ESTRENAN = ['Finanzas', 'Membresias', 'Clientes', 'Operacion', 'Citas']

function vistas(): string[] {
  return readdirSync(VISTAS_DIR)
    .filter((f) => /^Reporte.*Vista\.tsx$/.test(f))
    .map((f) => `src/components/reportes/${f}`)
}

const cuantos = (txt: string, aguja: string) => txt.split(aguja).length - 1

// ───────────────────── todo gráfico va dentro de un panel ─────────────────────

test('los cinco reportes que no tenían gráfico ahora tienen al menos dos', () => {
  for (const v of ESTRENAN) {
    const txt = leer(`src/components/reportes/Reporte${v}Vista.tsx`)
    const paneles = cuantos(txt, '<PanelGrafico')
    assert.ok(
      paneles >= 2,
      `Reporte${v}Vista tiene ${paneles} paneles de gráfico: esta fase los estrenó y no puede quedarse en menos.`
    )
  }
})

test('ninguna vista pinta un gráfico fuera de un PanelGrafico', () => {
  // Un gráfico suelto deja la hoja impresa en blanco y a un lector de pantalla
  // sin nada que leer. `PanelGrafico` es lo que obliga a la tabla equivalente.
  for (const v of vistas()) {
    const txt = leer(v)
    const graficos =
      cuantos(txt, '<GraficoTendencia') +
      cuantos(txt, '<GraficoRanking') +
      cuantos(txt, '<GraficoDistribucion')
    if (graficos === 0) continue
    assert.ok(
      cuantos(txt, '<PanelGrafico') >= 1,
      `${v} pinta gráficos sin ningún PanelGrafico alrededor.`
    )
    // Cada gráfico tiene que ir en la prop `grafico=` de un panel.
    assert.equal(
      cuantos(txt, 'grafico={'),
      cuantos(txt, '<PanelGrafico'),
      `${v}: hay gráficos que no cuelgan de la prop grafico= de un panel.`
    )
  }
})

test('todo panel de gráfico trae su tabla', () => {
  // `PanelGrafico` ya exige `tabla` por tipos; esto vigila que nadie la
  // convierta en opcional, que es como se pierde la versión imprimible.
  const panel = leer('src/components/reportes/graficos/PanelGrafico.tsx')
  assert.match(panel, /\n  \/\*\* Los MISMOS datos en tabla[\s\S]{0,200}\n  tabla: ReactNode/)
  assert.equal(
    /tabla\?: ReactNode/.test(panel),
    false,
    'la tabla del panel se volvió opcional: el gráfico dejaría de imprimirse sin que nada falle'
  )
  for (const v of vistas()) {
    const txt = leer(v)
    assert.equal(
      cuantos(txt, '<PanelGrafico'),
      cuantos(txt, 'tabla={'),
      `${v}: hay paneles sin su tabla equivalente.`
    )
  }
})

// ───────────────── las tablas de antes siguen estando ─────────────────

test('los cinco reportes no perdieron ninguna de sus tablas', () => {
  // Las secciones de tabla que esta fase movió DENTRO de un panel siguen
  // pintándose. Si alguien las borrara «porque ya está el gráfico», el reporte
  // perdería las cifras exactas y el papel se quedaría sin ellas.
  const imprescindibles: Record<string, string[]> = {
    Finanzas: ["encabezados={['Método', 'Operaciones', 'Monto']}", "'Ingreso de caja'"],
    Membresias: ["encabezados={['Plan', 'Activaciones', 'Renovaciones', 'Bajas']}"],
    Clientes: ['<TablaClientes', "encabezados={['Día', 'Altas']}"],
    Operacion: ['<TablaOperacion', "encabezados={['Día', 'Canjes', 'Descontaron']}"],
    Citas: ['<TablaCitas', "encabezados={['Día', 'Agendadas', 'Completadas', 'Canceladas', 'No asistió']}"],
  }
  for (const [vista, agujas] of Object.entries(imprescindibles)) {
    const txt = leer(`src/components/reportes/Reporte${vista}Vista.tsx`)
    for (const aguja of agujas) {
      assert.ok(txt.includes(aguja), `Reporte${vista}Vista perdió una tabla: ${aguja}`)
    }
  }
})

// ───────────────────────── la serie se pliega ─────────────────────────

test('toda vista que dibuja una serie la pliega a la granularidad del periodo', () => {
  for (const v of vistas()) {
    const txt = leer(v)
    if (!txt.includes('<GraficoTendencia')) continue
    assert.match(
      txt,
      /const serie = serieParaGrafico\(r\.serie, rango\.granularidad\)/,
      `${v} dibuja una tendencia sin plegar la serie: un año en días son 365 puntos.`
    )
  }
})

// ────────────── la serie de finanzas es SOLO caja, y lo dice ──────────────

test('la serie de finanzas no mezcla dos relojes', () => {
  const motor = leer('src/modules/reportes/finanzas.ts')
  const i = motor.indexOf('async function serieDiaria')
  assert.ok(i > 0, 'finanzas ya no tiene serie diaria: revisa esta prueba')
  const fin = motor.indexOf('\nasync function', i + 10)
  const cuerpo = motor.slice(i, fin === -1 ? undefined : fin)

  assert.match(cuerpo, /FROM "transactions"/, 'la serie de finanzas ya no sale de la caja')
  assert.equal(
    /whereCobrado|"fechaPago"|"memberships"/.test(cuerpo),
    false,
    'la serie de finanzas metió el reloj de las membresías: esa definición vive en modules/pagos/cobrado.ts y copiarla aquí sería la cuarta copia'
  )
  // Los mismos dos estados que la cifra de arriba, o la línea no sumaría el KPI.
  assert.match(cuerpo, /"estado"::text IN \(\$\{Prisma\.join\(\[\.\.\.COBRADOS\]\)\}\)/)
  // Y el corte por día, en la zona del negocio.
  assert.match(cuerpo, /AT TIME ZONE \$\{timeZone\}/)
})

test('la pantalla y el CSV de finanzas dicen que la línea es solo caja', () => {
  assert.match(
    leer('src/components/reportes/ReporteFinanzasVista.tsx'),
    /SOLO la caja del mostrador/,
    'la vista no advierte que la línea no incluye los cobros de membresía'
  )
  assert.match(
    leer('src/app/(admin)/admin/reportes/finanzas/export/route.ts'),
    /NO incluye cobros de membresia/,
    'el CSV no se defiende solo una vez bajado'
  )
})

test('finanzas recibe la zona horaria, igual que los otros cuatro motores', () => {
  // Sin ella el corte por día se haría en UTC y un cobro de las nueve de la
  // noche caería en el día siguiente.
  assert.match(leer('src/modules/reportes/finanzas.ts'), /rango: Rango,\n[\s\S]{0,300}timeZone: string,/)
  for (const ruta of [
    'src/app/(admin)/admin/reportes/finanzas/page.tsx',
    'src/app/(admin)/admin/reportes/finanzas/export/route.ts',
  ]) {
    assert.match(
      leer(ruta),
      /getReporteFinanzas\(companyId, rango, timeZone,/,
      `${ruta} llama al motor de finanzas sin la zona horaria`
    )
  }
})
