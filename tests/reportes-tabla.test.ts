import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  columnasOrdenables,
  filtrarFilas,
  num,
  ordenarFilas,
  porcentaje,
  razon,
  siguienteOrden,
  UMBRAL_CONTROLES,
  type CeldaReporte,
} from '@/modules/reportes/tabla'

/**
 * LAS TABLAS DE LOS REPORTES (rediseño de reportes · Fase 7).
 *
 * Había OCHO COPIAS byte a byte de la misma función `Tabla` —una por vista—
 * con veintiséis usos entre todas y ni un control: el orden era el que trajera
 * la consulta. Ahora hay una sola tabla compartida que se ordena, se busca y
 * cambia de densidad.
 *
 * Lo que estas pruebas vigilan:
 *
 *  1. Que la copia no vuelva. Ocho ficheros idénticos no divergen el día que
 *     se pegan: divergen tres meses después, cuando alguien arregla uno.
 *  2. Que **ninguna columna de números se ordene como texto**. Es el fallo que
 *     hace esto peligroso en vez de solo inútil: ordenada como texto, «RD$9»
 *     queda por encima de «RD$1.200» y la tabla de finanzas dice lo contrario
 *     de lo que pasó. Se comprueba de dos maneras: el orden en sí, y que
 *     ninguna celda numérica de las ocho vistas se quedó sin su valor crudo.
 *  3. Que un hueco no se ordene como un cero.
 *  4. Que lo que se imprime siga siendo la tabla entera, y que un papel
 *     filtrado lo diga.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const VISTAS_DIR = join(raiz, 'src', 'components', 'reportes')
const COMPONENTE = 'src/components/reportes/TablaReporte.tsx'

/** Las vistas de reporte que pintan tablas. */
function vistas(): string[] {
  return readdirSync(VISTAS_DIR)
    .filter((f) => /^Reporte.*Vista\.tsx$/.test(f))
    .map((f) => `src/components/reportes/${f}`)
}

/** Cada bloque `<Tabla … />` de un fichero, respetando las llaves anidadas. */
function bloquesTabla(txt: string): string[] {
  const out: string[] = []
  const re = /<Tabla\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(txt))) {
    let d = 0
    for (let j = m.index + m[0].length; j < txt.length; j++) {
      const c = txt[j]
      if (c === '{') d++
      else if (c === '}') d--
      else if (d === 0 && txt.slice(j, j + 2) === '/>') {
        out.push(txt.slice(m.index, j + 2))
        break
      }
    }
  }
  return out
}

// ───────────────────────── la copia no vuelve ─────────────────────────

test('ninguna vista de reporte define su propia tabla', () => {
  for (const v of vistas()) {
    const txt = leer(v)
    assert.equal(
      /^function Tabla\(/m.test(txt),
      false,
      `${v} volvió a definir su propia Tabla: eran ocho copias idénticas y por eso se unificaron.`
    )
  }
})

test('toda vista que pinta una tabla importa la compartida', () => {
  let conTablas = 0
  for (const v of vistas()) {
    const txt = leer(v)
    if (!/<Tabla\b/.test(txt)) continue
    conTablas++
    assert.match(
      txt,
      /import \{ TablaReporte as Tabla \} from '@\/components\/reportes\/TablaReporte'/,
      `${v} usa <Tabla> sin importar la compartida.`
    )
  }
  assert.ok(conTablas >= 8, `esperaba al menos 8 vistas con tabla, encontré ${conTablas}`)
})

// ────────────────── ninguna columna numérica sin su valor ──────────────────

test('ninguna celda de número se pasa a la tabla sin su valor crudo', () => {
  const fallos: string[] = []
  for (const v of vistas()) {
    for (const bloque of bloquesTabla(leer(v))) {
      // Recorre el bloque marcando si estamos dentro de una llamada a num().
      const pila: boolean[] = []
      for (let i = 0; i < bloque.length; i++) {
        if (bloque[i] === '(') pila.push(/\bnum$/.test(bloque.slice(0, i)))
        else if (bloque[i] === ')') pila.pop()
        else {
          const resto = bloque.slice(i)
          const m = /^\b(entero|dinero)\(/.exec(resto)
          if (m && !pila.some(Boolean)) {
            fallos.push(`${v}: ${m[1]}(…) suelto — usa num(valor, ${m[1]}(valor))`)
          }
        }
      }
    }
  }
  assert.deepEqual(fallos, [], fallos.join('\n'))
})

test('ningún porcentaje se escribe a mano dentro de una tabla', () => {
  for (const v of vistas()) {
    for (const bloque of bloquesTabla(leer(v))) {
      assert.equal(
        /\}\s*%`/.test(bloque),
        false,
        `${v} arma un «%» a mano dentro de <Tabla>: usa porcentaje(), que además lo deja ordenable.`
      )
    }
  }
})

// ───────────────────────────── el orden ─────────────────────────────

test('una columna de dinero se ordena por el valor, no por el texto', () => {
  // El caso exacto que motivó `num()`: como texto, «RD$9,00» va después de
  // «RD$1.200,00» — y ordenar de mayor a menor pondría 9 pesos arriba.
  const filas: CeldaReporte[][] = [
    ['Efectivo', num(9, 'RD$9,00')],
    ['Tarjeta', num(1200, 'RD$1.200,00')],
    ['Transferencia', num(340, 'RD$340,00')],
  ]
  const desc = ordenarFilas(filas, { columna: 1, direccion: 'desc' })
  assert.deepEqual(
    desc.map((f) => f[0]),
    ['Tarjeta', 'Transferencia', 'Efectivo']
  )
  const asc = ordenarFilas(filas, { columna: 1, direccion: 'asc' })
  assert.deepEqual(
    asc.map((f) => f[0]),
    ['Efectivo', 'Transferencia', 'Tarjeta']
  )
})

test('los huecos van al final en las dos direcciones', () => {
  const filas: CeldaReporte[][] = [
    ['A', porcentaje(1, 0)],
    ['B', porcentaje(3, 10)],
    ['C', porcentaje(9, 10)],
  ]
  for (const direccion of ['asc', 'desc'] as const) {
    const r = ordenarFilas(filas, { columna: 1, direccion })
    assert.equal(r[r.length - 1][0], 'A', `el hueco no quedó al final en ${direccion}`)
  }
})

test('un empate conserva el orden que trajo el motor', () => {
  const filas: CeldaReporte[][] = [
    ['primero', num(5, '5')],
    ['segundo', num(5, '5')],
    ['tercero', num(5, '5')],
  ]
  for (const direccion of ['asc', 'desc'] as const) {
    assert.deepEqual(
      ordenarFilas(filas, { columna: 1, direccion }).map((f) => f[0]),
      ['primero', 'segundo', 'tercero']
    )
  }
})

test('sin orden elegido la tabla no toca nada', () => {
  const filas: CeldaReporte[][] = [['B', num(1, '1')], ['A', num(2, '2')]]
  assert.equal(ordenarFilas(filas, null), filas)
})

test('solo es ordenable lo que se puede ordenar bien', () => {
  const filas: CeldaReporte[][] = [
    ['Efectivo', num(9, 'RD$9,00'), 'RD$9,00'],
    ['Tarjeta', num(1200, 'RD$1.200,00'), 'RD$1.200,00'],
  ]
  // 0: texto, sí. 1: trae `orden`, sí. 2: formateada a pelo, NO.
  assert.deepEqual(columnasOrdenables(filas, 3), [true, true, false])
})

test('una sola fila no ofrece ordenar nada', () => {
  assert.deepEqual(columnasOrdenables([['Única', num(1, '1')]], 2), [false, false])
})

test('el encabezado hace tres pasos y vuelve al orden del motor', () => {
  const a = siguienteOrden(null, 2)
  assert.deepEqual(a, { columna: 2, direccion: 'desc' })
  const b = siguienteOrden(a, 2)
  assert.deepEqual(b, { columna: 2, direccion: 'asc' })
  assert.equal(siguienteOrden(b, 2), null)
  // Cambiar de columna empieza de nuevo por el mayor.
  assert.deepEqual(siguienteOrden(b, 1), { columna: 1, direccion: 'desc' })
})

// ───────────────────── porcentaje y razón ─────────────────────

test('sin base no hay porcentaje, y eso no es un cero', () => {
  assert.deepEqual(porcentaje(4, 0), { texto: '—', orden: null })
  assert.deepEqual(porcentaje(4, null), { texto: '—', orden: null })
  assert.deepEqual(porcentaje(4, null, 'Sin dato'), { texto: 'Sin dato', orden: null })
  assert.deepEqual(razon(4, 0), { texto: '—', orden: null })
})

test('dos filas que se enseñan igual se ordenan por lo que valen', () => {
  const a = porcentaje(334, 1000) // 33,4 %
  const b = porcentaje(332, 1000) // 33,2 %
  assert.equal(typeof a === 'object' && a.texto, '33 %')
  assert.equal(typeof b === 'object' && b.texto, '33 %')
  const r = ordenarFilas([['b', b], ['a', a]], { columna: 1, direccion: 'desc' })
  assert.deepEqual(r.map((f) => f[0]), ['a', 'b'])
})

// ───────────────────────────── buscar ─────────────────────────────

test('la búsqueda ignora acentos y mayúsculas, y mira lo que se ve', () => {
  const filas: CeldaReporte[][] = [
    ['José Ramírez', num(3, '3')],
    ['Ana Pérez', num(9, '9')],
  ]
  assert.equal(filtrarFilas(filas, 'jose').length, 1)
  assert.equal(filtrarFilas(filas, 'RAMIREZ').length, 1)
  assert.equal(filtrarFilas(filas, '  ').length, 2, 'un espacio no es un filtro')
  assert.equal(filtrarFilas(filas, 'z').length, 2)
})

// ───────────────────── lo que sale por la impresora ─────────────────────

test('los controles no se imprimen y el aviso de filtro sí', () => {
  const txt = leer(COMPONENTE)
  const controles = txt.slice(txt.indexOf('conControles && ('), txt.indexOf('filtrando && ('))
  assert.match(controles, /print:hidden/, 'la barra de controles saldría en el papel')

  const aviso = txt.slice(txt.indexOf('filtrando && ('), txt.indexOf('visibles.length === 0'))
  assert.match(aviso, /Filtrado por/)
  assert.equal(
    /print:hidden/.test(aviso),
    false,
    'un papel filtrado que no dice que está filtrado enseña menos filas de las que hay'
  )
})

test('la tabla de un reporte no pagina', () => {
  const txt = leer(COMPONENTE)
  for (const señal of ['pageSize', 'getPaginationRowModel', 'porPagina']) {
    assert.equal(
      txt.includes(señal),
      false,
      `paginar escondería filas del papel sin avisar (${señal})`
    )
  }
})

test('la densidad se guarda en una sola clave y nunca rompe la tabla', () => {
  const txt = leer(COMPONENTE)
  const usos = [...txt.matchAll(/localStorage\.(?:get|set)Item\(\s*([A-Za-z_$][\w$]*|'[^']*')/g)].map(
    (m) => m[1]
  )
  assert.ok(usos.length >= 2, 'esperaba leer y escribir la densidad')
  assert.equal(
    new Set(usos).size,
    1,
    `la densidad debe ser una sola para todas las tablas, no ${[...new Set(usos)].join(' y ')}`
  )
  assert.match(txt, /const CLAVE_DENSIDAD = '[^']+'/, 'la clave debe estar declarada una sola vez')
  for (const uso of ['getItem', 'setItem']) {
    const i = txt.indexOf(`localStorage.${uso}`)
    const antes = txt.lastIndexOf('try {', i)
    assert.ok(antes !== -1 && antes < i, `localStorage.${uso} sin try: una pestaña privada rompe`)
  }
})

test('el umbral de controles es el mismo que usa el componente', () => {
  assert.ok(UMBRAL_CONTROLES > 1)
  assert.match(leer(COMPONENTE), /filas\.length > UMBRAL_CONTROLES/)
})
