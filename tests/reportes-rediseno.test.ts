import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * REPORTES · EL REDISEÑO (centro de analítica · Fase 1).
 *
 * El módulo funcionaba y se leía mal: catorce presets de fecha siempre
 * visibles, cifras sin contexto, una sola gráfica en todo el sistema y ningún
 * camino desde un número hasta su explicación.
 *
 * Lo que estas guardias fijan es lo que NO puede deshacerse al seguir
 * construyendo encima:
 *
 *  1. Los gráficos se pintan con la PALETA de gráficos, por clases. Un
 *     hexadecimal o un `var(--…)` dentro de un atributo SVG rompe el modo
 *     oscuro sin avisar, y nadie mira el modo oscuro hasta que un cliente lo
 *     usa en una reunión.
 *  2. Todo gráfico lleva su tabla: en la hoja Recharts sale en blanco.
 *  3. El periodo se pliega. Si vuelven los catorce presets sueltos, vuelve la
 *     pared de botones.
 *  4. El color nunca es la única señal.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const GRAFICOS = join(raiz, 'src/components/reportes/graficos')
function archivosDeGraficos(): string[] {
  return readdirSync(GRAFICOS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(GRAFICOS, f))
}

test('los gráficos usan la paleta de gráficos, no colores inventados', () => {
  // Los tokens `chart-1..6` existían en `globals.css` desde la Fase 1 del
  // design system, con las luminosidades elegidas para distinguirse también en
  // escala de grises, y no los usaba NADIE. Son estos.
  const usanPaleta = archivosDeGraficos()
    .map((f) => readFileSync(f, 'utf8'))
    .filter((s) => /(fill|stroke|bg|text)-chart-\d/.test(s))
  assert.ok(
    usanPaleta.length >= 3,
    'los gráficos dejaron de usar la paleta chart-1..6 del sistema de diseño'
  )
})

test('ningún gráfico quema un color: el modo oscuro depende de ello', () => {
  for (const f of archivosDeGraficos()) {
    const src = readFileSync(f, 'utf8')
    const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    assert.ok(
      !/#[0-9a-fA-F]{3,8}\b/.test(sinComentarios),
      `${f.split('/').pop()} tiene un color en hexadecimal: en modo oscuro se verá como un parche`
    )
    assert.ok(
      !/(fill|stroke)=["']var\(--/.test(sinComentarios),
      `${f.split('/').pop()} mete una variable CSS en un atributo SVG, que no siempre resuelve`
    )
  }
})

test('el marco de gráfico EXIGE la tabla equivalente', () => {
  // La regla vieja era «acuérdate de pintar también una tabla». Las reglas que
  // dependen de la memoria se rompen; esta es de tipo.
  const marco = leer('src/components/reportes/graficos/PanelGrafico.tsx')
  assert.match(marco, /tabla: ReactNode/, 'la tabla dejó de ser obligatoria en la firma')
  assert.ok(!/tabla\?:/.test(marco), 'la tabla se volvió opcional: volvería el hueco en la hoja')
  assert.match(marco, /print:hidden/, 'el gráfico ya no se esconde del papel')
})

test('el sparkline no arrastra Recharts a la tarjeta', () => {
  // Dentro de un KPI no hace falta interacción, y a cambio se gana que se
  // imprima y que no baje JavaScript al cliente.
  const chispa = leer('src/components/reportes/graficos/Sparkline.tsx')
  assert.ok(!/recharts/.test(chispa), 'el sparkline pasó a Recharts: dejaría de imprimirse')
  assert.ok(!/'use client'/.test(chispa), 'el sparkline se volvió cliente sin necesitarlo')
  assert.match(chispa, /aria-hidden/, 'el sparkline debe ser decorativo para un lector de pantalla')
})

test('el periodo va plegado, no como pared de botones', () => {
  const barra = leer('src/components/reportes/RangoFechas.tsx')
  assert.match(barra, /<details/, 'el selector de periodo dejó de estar plegado')
  // Sigue funcionando sin JavaScript: los presets son enlaces, no botones de
  // un menú de React. Cada combinación de filtros es una URL.
  assert.ok(!/'use client'/.test(barra), 'la barra de periodo se volvió cliente')
  assert.match(barra, /Rápidos/, 'desaparecieron los grupos del selector')
  assert.match(barra, /Calendario/)
  assert.match(barra, /Personalizado/)
})

test('la comparación de periodos tiene mando, no solo motor', () => {
  // `rango.ts` sabía comparar contra el año pasado y la exportación arrastraba
  // el parámetro, pero no había dónde elegirlo salvo escribiéndolo en la URL.
  const barra = leer('src/components/reportes/RangoFechas.tsx')
  assert.match(barra, /COMPARACIONES\.map/, 'no hay control para elegir contra qué se compara')
  assert.match(barra, /comparar/, 'el parámetro de comparación no viaja en los enlaces')
})

test('una cifra se puede abrir: del KPI al reporte que lo explica', () => {
  const tarjeta = leer('src/components/reportes/KpiReporte.tsx')
  assert.match(tarjeta, /href\?: string/, 'el KPI dejó de poder enlazar a su reporte')
  const vista = leer('src/components/reportes/ReporteEmpresaVista.tsx')
  assert.match(vista, /enlaces\?\.finanzas/, 'el resumen dejó de llevar a finanzas')
  assert.match(vista, /enlaces\?\.operacion/)
  assert.match(vista, /enlaces\?\.clientes/)
})

test('cada cifra del resumen dice qué mide', () => {
  // Una métrica sin definición se interpreta, y dos personas la interpretan
  // distinto en la misma reunión.
  const vista = leer('src/components/reportes/ReporteEmpresaVista.tsx')
  const definiciones = vista.match(/definicion="/g) ?? []
  assert.ok(
    definiciones.length >= 5,
    `solo ${definiciones.length} de las cinco cifras del resumen dicen qué miden`
  )
})

test('el color no es la única señal en ninguna pieza nueva', () => {
  const tarjeta = leer('src/components/reportes/KpiReporte.tsx')
  assert.match(tarjeta, /sr-only/, 'la variación volvió a decirse solo con color')
  const vista = leer('src/components/reportes/ReporteEmpresaVista.tsx')
  assert.match(vista, /sr-only/, 'los insights volvieron a decirse solo con color')
  // El ranking marca la variación con signo y texto, no solo con verde/rojo.
  const ranking = leer('src/components/reportes/graficos/GraficoRanking.tsx')
  assert.match(ranking, /sr-only/)
})

test('el mapa de reportes dice qué pregunta responde cada uno', () => {
  // «Finanzas» no le dice a nadie si ahí está lo que busca; «¿cuánto entró y
  // por qué vía?» sí. Es la diferencia entre un menú y un índice.
  const nav = leer('src/components/reportes/NavegacionReportes.tsx')
  assert.match(nav, /pregunta: string/)
  const pagina = leer('src/app/(admin)/admin/reportes/page.tsx')
  const preguntas = pagina.match(/pregunta: '/g) ?? []
  assert.ok(preguntas.length >= 5, 'el mapa de reportes perdió sus preguntas')
})
