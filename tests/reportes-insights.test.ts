import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  calcularInsights,
  MINIMO_OPERACIONES,
  UMBRAL_ENTREGAS,
  UMBRAL_VARIACION,
  type Insight,
} from '@/modules/reportes/insights'

/**
 * QUÉ DICEN ESTOS NÚMEROS — y a dónde ir (rediseño de reportes · Fase 9).
 *
 * Las frases existían y no llevaban a ninguna parte: cero enlaces. «Los
 * ingresos bajaron 18 %» es un titular, y un titular sin sitio a donde ir deja
 * a quien lo lee PEOR que antes — sabe que algo pasa y no tiene el siguiente
 * paso. La respuesta estaba a dos clics y no se encontraba desde ahí.
 *
 * Lo que estas pruebas vigilan:
 *
 *  1. Que ninguna frase se quede sin destino. Una sí y otra no es la peor
 *     mezcla: enseña que los enlaces son decorativos.
 *  2. Que el núcleo NO arme URLs. Es puro para poder probarlo sin base de
 *     datos, y el mismo reporte se monta donde esos enlaces no existen.
 *  3. Que el enlace solo se pinte cuando ese montaje tiene a dónde ir, y que
 *     la frase se enseñe igual cuando no.
 *  4. Que la regla de oro siga viva: solo sale lo que tiene algo que decir.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const NUCLEO = 'src/modules/reportes/insights.ts'
const VISTA = 'src/components/reportes/ReporteEmpresaVista.tsx'

/** Una entrada que enciende las tres frases a la vez. */
const TODO_ENCENDIDO = {
  ingresosCaja: { variacion: -18 },
  clientesNuevos: { variacion: 25 },
  operaciones: { valor: 10 },
  entregas: { valor: 90 },
}

// ───────────────────── ninguna frase sin destino ─────────────────────

test('toda frase que sale lleva a dónde investigarla', () => {
  const insights = calcularInsights(TODO_ENCENDIDO)
  assert.ok(insights.length >= 3, `esperaba al menos 3 frases, salieron ${insights.length}`)
  for (const i of insights) {
    assert.ok(
      i.investigar,
      `«${i.texto}» no dice a dónde ir: un titular sin siguiente paso deja a quien lo lee peor que antes.`
    )
    assert.ok(
      i.investigar.etiqueta.length > 0,
      `«${i.texto}» trae un destino sin etiqueta`
    )
  }
})

test('la etiqueta dice QUÉ se va a mirar, no «ver más»', () => {
  // Un enlace que no promete nada no se pulsa.
  const genericas = ['ver más', 'ver mas', 'más información', 'detalles', 'clic aquí']
  for (const i of calcularInsights(TODO_ENCENDIDO)) {
    const etiqueta = i.investigar!.etiqueta.toLowerCase()
    for (const g of genericas) {
      assert.equal(etiqueta.includes(g), false, `etiqueta genérica: «${i.investigar!.etiqueta}»`)
    }
    assert.ok(
      etiqueta.split(' ').length >= 3,
      `«${i.investigar!.etiqueta}» no dice qué se va a mirar`
    )
  }
})

test('cada frase lleva al reporte del que habla', () => {
  const porTexto = new Map(
    calcularInsights(TODO_ENCENDIDO).map((i) => [i.texto, i.investigar!.destino])
  )
  const buscar = (aguja: string) => {
    const par = [...porTexto].find(([texto]) => texto.includes(aguja))
    assert.ok(par, `no salió la frase que contiene «${aguja}»`)
    return par![1]
  }
  assert.equal(buscar('ingresos de caja'), 'finanzas')
  assert.equal(buscar('clientes nuevos'), 'clientes')
  assert.equal(buscar('entregas sin cobro'), 'operacion')
})

// ───────────────── el núcleo no sabe de URLs, y no debe ─────────────────

test('el núcleo no arma ninguna URL', () => {
  // Es puro para probarlo sin base de datos, y el mismo reporte se monta en
  // /admin/reportes y en /superadmin/reportes/[id], donde esos enlaces no
  // existen. Una ruta escrita aquí ataría las frases a un solo montaje.
  //
  // Se mira el CÓDIGO, no los comentarios: la cabecera del módulo nombra los
  // dos montajes a propósito, que es justo lo que explica la regla.
  const codigo = leer(NUCLEO)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  for (const aguja of ['/admin/', '/superadmin/', 'href', 'http']) {
    assert.equal(
      codigo.includes(aguja),
      false,
      `el núcleo de insights construye «${aguja}»: las rutas las pone quien monta la pantalla`
    )
  }
})

test('los destinos son exactamente las claves que la pantalla sabe resolver', () => {
  // Un destino que `EnlacesReporte` no tiene sería un enlace que nunca se
  // pinta, y nadie se enteraría hasta que alguien lo buscara.
  const union = leer(NUCLEO).match(/export type DestinoInsight =([^\n]+)/)?.[1]
  assert.ok(union, 'ya no existe DestinoInsight: revisa esta prueba')
  const destinos = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()

  const bloque = leer(VISTA).match(/export interface EnlacesReporte \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(bloque, 'ya no existe EnlacesReporte: revisa esta prueba')
  const claves = [...bloque.matchAll(/^\s*(\w+)\?:/gm)].map((m) => m[1]).sort()

  assert.deepEqual(
    destinos,
    claves,
    `los destinos de los insights y los enlaces del reporte se separaron: ${destinos.join(', ')} vs ${claves.join(', ')}`
  )
})

// ───────────────── cómo se pinta, y cuándo no se pinta ─────────────────

test('el enlace solo se pinta si ese montaje tiene a dónde ir', () => {
  const txt = leer(VISTA)
  assert.match(
    txt,
    /i\.investigar && enlaces\?\.\[i\.investigar\.destino\]/,
    'el enlace de un insight se pintaría aunque el montaje no tenga esa ruta'
  )
})

test('el enlace no se imprime, pero la frase sí', () => {
  const txt = leer(VISTA)
  const i = txt.indexOf('i.investigar && enlaces')
  assert.ok(i > 0)
  const bloque = txt.slice(i, i + 700)
  assert.match(bloque, /print:hidden/, 'en el papel no hay nada que pulsar')

  // La frase en sí NO puede llevar print:hidden, o el papel perdería el
  // insight entero.
  const frase = txt.match(/<p className="([^"]*)">\{i\.texto\}<\/p>/)?.[1] ?? ''
  assert.equal(frase.includes('print:hidden'), false, 'la frase del insight dejó de imprimirse')
})

// ───────────────── la regla de oro sigue viva ─────────────────

test('por debajo del umbral no sale ninguna frase', () => {
  // Una sección que siempre está encendida enseña a ignorarla.
  const casi = UMBRAL_VARIACION - 1
  const insights = calcularInsights({
    ingresosCaja: { variacion: casi },
    clientesNuevos: { variacion: -casi },
    operaciones: { valor: MINIMO_OPERACIONES },
    entregas: { valor: 0 },
  })
  assert.deepEqual(insights, [] as Insight[])
})

test('sin permiso financiero no sale la frase de ingresos', () => {
  const insights = calcularInsights({ ...TODO_ENCENDIDO, ingresosCaja: null })
  assert.equal(
    insights.some((i) => i.investigar?.destino === 'finanzas'),
    false,
    'salió un insight de dinero sin permiso para ver dinero'
  )
  // Y las otras dos siguen saliendo: el permiso recorta, no apaga la sección.
  assert.ok(insights.length >= 2)
})

test('con pocas operaciones el porcentaje de entregas no se pronuncia', () => {
  const insights = calcularInsights({
    ingresosCaja: null,
    clientesNuevos: { variacion: 0 },
    operaciones: { valor: 1 },
    entregas: { valor: MINIMO_OPERACIONES - 2 },
  })
  assert.deepEqual(insights, [] as Insight[])
  assert.ok(UMBRAL_ENTREGAS > 50, 'el umbral de entregas dejó de significar «la mayoría»')
})
