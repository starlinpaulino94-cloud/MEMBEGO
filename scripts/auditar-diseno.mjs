#!/usr/bin/env node
/**
 * AUDITORÍA DEL SISTEMA DE DISEÑO — cuenta, no opina.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DESCUENTA LOS COMENTARIOS ANTES DE CONTAR
 *
 * Sin eso, un archivo que documenta «no escribas `text-[11px]`» se cuenta como
 * infracción y el número deja de significar nada. Pasó de verdad: dos guardias
 * de este mismo trabajo fallaron por encontrar el texto de su propio comentario.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEPARA LO LEGÍTIMO DE LA DEUDA
 *
 * De los HEX que aparecen, buena parte están en generadores de imágenes OG y
 * plantillas de correo, donde las variables CSS no existen y el hexadecimal es
 * la única opción. Contarlos como deuda sería falsear el diagnóstico.
 *
 * Se usa desde la línea de órdenes (`node scripts/auditar-diseno.mjs`) y desde
 * `tests/deuda-diseno.test.ts`, que congela los números como TECHOS: pueden
 * bajar, nunca subir.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const RAIZ = ['src', 'packages/ui/src']
const archivos = (d) => {
  const acc = []
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) acc.push(...archivos(p))
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}
const TODOS = RAIZ.flatMap(archivos)

/**
 * ¿Es un sitio donde el hexadecimal es la ÚNICA opción?
 *
 * `reporte-imprimible` entra por un motivo distinto al de los OG y los correos,
 * y conviene dejarlo escrito: ahí las variables SÍ existen, pero usarlas sería
 * el error. El papel es blanco y la tinta negra pase lo que pase; si el bloque
 * `@media print` heredara el tema, quien tenga el panel en oscuro imprimiría
 * texto casi blanco sobre una hoja blanca. El color de la impresión no es una
 * decisión de tema, es una propiedad del papel.
 *
 * `connect/proveedores/metadatos` entra por ese mismo razonamiento: el verde de
 * WhatsApp y el azul de Google son propiedades de MARCAS AJENAS, no decisiones
 * de nuestro tema. Pintarlos con un token semántico haría que el logotipo de
 * WhatsApp saliera del color primario de Membego, que es justamente lo
 * contrario de reconocer una marca. Es data sobre terceros, no estilo propio.
 */

/**
 * Archivos exentos por RUTA EXACTA, no por patrón.
 *
 * La diferencia importa: una expresión regular que dijera
 * `connect/proveedores/metadatos` eximiría también a un futuro
 * `metadatos-extra.tsx` o `metadatos/Tarjeta.tsx` sin que nadie lo decidiera.
 * Una excepción del sistema de diseño tiene que ser una decisión explícita por
 * archivo, y añadir uno a esta lista se ve en la revisión.
 */
const EXENTOS_EXACTOS = new Set([
  // Los colores oficiales de marcas ajenas (el verde de WhatsApp, el azul de
  // Google) son datos sobre terceros, no decisiones de nuestro tema. Pintarlos
  // con un token semántico haría que el logotipo de WhatsApp saliera del color
  // primario de Membego, que es lo contrario de reconocer una marca.
  'src/modules/connect/proveedores/metadatos.ts',
])

const SIN_VARIABLES_CSS = (ruta) =>
  EXENTOS_EXACTOS.has(ruta.split(sep).join('/')) ||
  /opengraph-image|\/og\/|share\/og|correo|email|reporte-imprimible/i.test(ruta)
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

export const cuenta = (re, filtro = () => true) => {
  const porArchivo = {}, valores = {}
  let total = 0
  for (const a of TODOS) {
    const src = sinComentarios(readFileSync(a, 'utf8'))
    for (const m of src.matchAll(re)) {
      if (!filtro(m, a)) continue
      total++
      porArchivo[a] = (porArchivo[a] ?? 0) + 1
      const v = m[0].trim()
      valores[v] = (valores[v] ?? 0) + 1
    }
  }
  return { total, porArchivo, valores }
}

const top = (o, n = 12) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v}`)
    .join('  ')

/** Los patrones. Uno por deuda, con lo que significa si sube. */
export const MEDIDAS = {
  hexEnInterfaz: {
    que: 'HEX escritos en la interfaz',
    porque:
      'Un color a mano no tiene modo oscuro ni significado. Los de generadores ' +
      'de OG y correos NO cuentan: ahí las variables CSS no existen.',
    re: /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g,
    filtro: (_m, a) => !SIN_VARIABLES_CSS(a),
  },
  colorCrudo: {
    que: 'Clases de color de Tailwind fuera del vocabulario',
    porque: 'No cambian con el tema: en modo oscuro se ven igual que en claro.',
    re: /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  },
  radiosFuera: {
    que: 'Radios fuera del vocabulario',
    porque: 'El vocabulario es lg / xl / 2xl / full. Lo demás desalinea las familias.',
    re: /\brounded(?:-[a-z]+)?-(?:sm|md|3xl)\b|\brounded-none\b/g,
  },
  microTextos: {
    que: 'Textos por debajo de 12px',
    porque: 'Media plataforma se usa de pie: una pista de lavado, una caja, una cocina.',
    re: /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g,
  },
  sombrasArbitrarias: {
    que: 'Sombras fuera de la escala',
    porque: 'Hay tres elevaciones y dicen para qué son. Una sombra suelta no.',
    re: /\bshadow-\[[^\]]+\]/g,
  },
  duracionesSueltas: {
    que: 'Duraciones de animación fuera de los tokens',
    porque: 'Coinciden en valor con los tokens: son alias no declarados.',
    re: /\bduration-\[[^\]]+\]|\bduration-(?:75|100|150|200|300|500|700|1000)\b/g,
  },
  zIndexSueltos: {
    que: 'z-index arbitrarios',
    porque: 'Sin escala, el síntoma es un modal por debajo de un mapa, en producción.',
    re: /\bz-\[[^\]]+\]/g,
  },
}

/** Cuenta todo. Devuelve `{ clave: número }`. */
export function auditar() {
  const r = {}
  for (const [clave, m] of Object.entries(MEDIDAS)) {
    r[clave] = cuenta(m.re, m.filtro ?? (() => true)).total
  }
  return r
}

/** Lo que un satélite instalaría: la deuda de aquí se reparte. */
export function auditarPaquete() {
  const soloUi = (_m, a) => a.startsWith('packages/ui')
  return {
    colorCrudo: cuenta(MEDIDAS.colorCrudo.re, soloUi).total,
    radiosFuera: cuenta(MEDIDAS.radiosFuera.re, soloUi).total,
  }
}

// ── Línea de órdenes ────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('auditar-diseno.mjs')) {
  console.log(`Archivos analizados: ${TODOS.length}\n`)
  for (const [clave, m] of Object.entries(MEDIDAS)) {
    const r = cuenta(m.re, m.filtro ?? (() => true))
    console.log(`${m.que}: ${r.total}`)
    if (r.total > 0) {
      const arch = Object.entries(r.porArchivo)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
      console.log(`   ${m.porque}`)
      if (Object.keys(r.valores).length) console.log(`   ${top(r.valores, 8)}`)
      console.log('   ' + arch.map(([k, v]) => `${v} ${k}`).join('\n   '))
    }
    console.log()
  }
  const paquete = auditarPaquete()
  console.log('EN @membego/ui — lo que un satélite instalaría:')
  console.log(`   color crudo: ${paquete.colorCrudo} · radios fuera: ${paquete.radiosFuera}`)
}
