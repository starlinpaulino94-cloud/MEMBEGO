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
  // Normaliza el color de marca que cada EMPRESA elige y calcula con qué tinta
  // se lee encima: el valor por defecto y las dos tintas son DATOS de una
  // fórmula de contraste (luminancia relativa), y a una fórmula no se le puede
  // pasar `var(--foreground)`. Es el único sitio que los escribe; la interfaz
  // los importa de aquí (`COLOR_MARCA_POR_DEFECTO`).
  'src/lib/company-branding.ts',
  // Los colores con los que el editor de imágenes RELLENA lo que la foto no
  // cubre (blanco, gris claro, oscuro) quedan horneados en los píxeles del
  // archivo que se sube: no son estilo de interfaz y no hay variable CSS que
  // valga dentro de una imagen. Son datos de formato, como el color de marca.
  'src/lib/imagen/formatos.ts',
])

/**
 * Las rutas se NORMALIZAN a barra normal antes de mirarlas.
 *
 * En Windows las rutas llegan con barra invertida y los patrones de abajo
 * estan escritos con barra normal, asi que "share/og" no casaba y los
 * generadores de imagenes OG contaban como deuda SOLO en esa plataforma: 143
 * en Windows contra 117 en CI sobre el MISMO codigo. El techo esta medido en
 * CI, de modo que la suite fallaba en el portatil de quien la ejecutara.
 *
 * Un auditor que cuenta distinto segun el sistema operativo no mide nada.
 */
const SIN_VARIABLES_CSS = (ruta) =>
  EXENTOS_EXACTOS.has(ruta.split(sep).join('/')) ||
  /opengraph-image|\/og\/|share\/og|correo|email|reporte-imprimible/i.test(ruta.split(sep).join('/'))
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const normalizar = (ruta) => ruta.split(sep).join('/')

/** Cada archivo se lee y se limpia una sola vez, aunque lo miren quince medidas. */
const FUENTES = new Map()
const fuenteSinComentarios = (ruta) => {
  if (!FUENTES.has(ruta)) FUENTES.set(ruta, sinComentarios(readFileSync(ruta, 'utf8')))
  return FUENTES.get(ruta)
}

/**
 * EL PANEL, para las medidas que solo le tocan a él.
 *
 * Las páginas de los cinco grupos de rutas de personal y los componentes propios de administración y de plataforma. El cliente final
 * (`(cliente)`, `(public)`) queda fuera A PROPÓSITO: usa `<button>`, `<h1>` y tablas legítimamente, y la auditoría del panel
 * (`docs/auditoria-admin`) lo declaró fuera de alcance. Los componentes que comparten panel y cliente (`src/components/crm`, `scanner`…)
 * tampoco entran: no hay forma de decir de quién son sin mirar quién los importa, y una medida que cuenta lo que no es suyo no mide.
 */
const PREFIJOS_DE_PANEL = [
  'src/app/(admin)/',
  'src/app/(superadmin)/',
  'src/app/(empleado)/',
  'src/app/(vendedor)/',
  'src/app/(onboarding)/',
  'src/components/admin/',
  'src/components/superadmin/',
]
const enPanel = (_m, ruta) => PREFIJOS_DE_PANEL.some((p) => normalizar(ruta).startsWith(p))

export const cuenta = (re, filtro = () => true) => {
  const porArchivo = {}, valores = {}
  let total = 0
  for (const a of TODOS) {
    const src = fuenteSinComentarios(a)
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

/**
 * Variables CSS con un hex literal en `globals.css`.
 *
 * El auditor cuenta hex en TSX y NO veía estas: los temas `retail`, `vibe` y `theme-landing` nacieron pegados al `@theme` global con
 * el hexadecimal escrito, y cada uno es un azul (u otro color) más que no sale de la escala. Se cuenta la declaración
 * `--nombre: #hex;`, no cada hex suelto, para que un degradado con dos paradas no pese doble.
 */
const contarVariablesHexEnGlobalsCss = () => {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/--[\w-]+\s*:\s*#[0-9a-fA-F]{3,8}\s*;/g)].length
}

/**
 * Mapas «estado → clases de color» escritos a mano.
 *
 * HEURÍSTICA, y se dice: una declaración `const X = { … }` (con o sin tipo `Record<…>`) cuyo nombre o tipo habla de estado, tono,
 * insignia o variante Y cuyo cuerpo trae clases `bg-`/`text-`/`border-`. Cada una es un contrato «estado → aspecto» propio que debería
 * salir de `estadoUi`. Se mide en TODO el código (como el informe 07 · FE-03), porque el cliente repite el mismo defecto.
 */
const contarMapasDeEstado = () => {
  let total = 0
  for (const a of TODOS) {
    const s = fuenteSinComentarios(a)
    for (const m of s.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*Record<[^=\n]*?>)?\s*=\s*\{/g)) {
      if (!/estado|status|tone|tono|state|badge|chip|variant/i.test(m[0])) continue
      let profundidad = 1
      let i = m.index + m[0].length
      const inicio = i
      while (i < s.length && profundidad > 0) {
        const c = s[i++]
        if (c === '{') profundidad++
        else if (c === '}') profundidad--
      }
      if (/['"`][^'"`]*\b(?:bg|text|border)-[a-z]/.test(s.slice(inicio, i))) total++
    }
  }
  return total
}

/**
 * Componentes de `@membego/ui` que NADIE importa.
 *
 * Se importan por `@/components/ui/<nombre>` (alias a `packages/ui/src/ui`), por `@membego/ui/ui/<nombre>` o, dentro del paquete, por
 * ruta relativa. Un componente sin importadores es mantenimiento sin cliente, y el paquete es lo que un satélite instalaría: se entrega
 * tal cual. No sigue la cadena (un componente que solo usa otro componente sin uso cuenta como usado): es un suelo, no el total.
 */
/**
 * Primitivas de la fase 4 que ya existen y todavía no tienen consumidor: es lo que la fase pide («primitivas con su ficha y sin
 * consumidores aún», docs/auditoria-admin/12). Se EXCLUYEN de «sin uso» mientras esperan, para que construirlas no sea subir un
 * techo. La lista solo puede ENCOGERSE: `tests/deuda-diseno.test.ts` falla si alguna ya tiene importador (hay que quitarla de
 * aquí) y la fase 8 (`knip`) falla si alguna sigue sin él. Cada una tiene su consumidor previsto en el plan: `Tabla` y
 * `BarraFiltros` en Clientes y Pagos (fase 5), `Campo` en los formularios (fase 7), `SelectorColor` en Empresa,
 * `BarrasSimples` en el Resumen (fase 5). `NavSeccion` salió de la lista con las pestañas de Beneficios (fase 5, 5.4); el
 * menú de 21 (fase 6) será su segundo consumidor.
 */
export const PRIMITIVAS_EN_ESPERA = new Set(['campo', 'barra-filtros', 'selector-color'])

const contarComponentesSinUso = () => {
  const dir = join('packages', 'ui', 'src', 'ui')
  const nombres = readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => f.slice(0, -4)).filter((n) => !PRIMITIVAS_EN_ESPERA.has(n))
  const fuentes = TODOS.map((a) => [normalizar(a), fuenteSinComentarios(a)])
  return nombres.filter((nombre) => {
    const re = new RegExp(`['"](?:@/components/ui/|@membego/ui/ui/|\\./|\\.\\./ui/)${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
    return !fuentes.some(([ruta, src]) => ruta !== `packages/ui/src/ui/${nombre}.tsx` && re.test(src))
  }).length
}

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

  // ── Fase 2 de la auditoría del panel (docs/auditoria-admin · 07). Techos NUEVOS: miden lo que antes nada vigilaba. ──
  h1Crudo: {
    que: '`<h1>` escritos a mano en el panel',
    porque:
      'La cabecera de página es `PageHeader`. Cada `<h1>` a mano es una variante más de título (FE-02) y, a menudo, una pantalla sin migas ' +
      'ni descripción.',
    re: /<h1\b/g,
    filtro: enPanel,
  },
  botonCrudo: {
    que: '`<button>` crudos en el panel',
    porque: 'No traen foco, tamaño ni estado de carga del sistema (FE-05); cada uno es un primario con hover propio.',
    re: /<button\b/g,
    filtro: enPanel,
  },
  titulo2xlBold: {
    que: '`text-2xl font-bold` en el panel',
    porque:
      'Es el título de página escrito a mano: el panel usa `text-h1`. Dos tallas para lo mismo es lo que hace que 17 pantallas se vean ' +
      'distintas (FE-12).',
    re: /\b(?:text-2xl font-bold|font-bold text-2xl)\b/g,
    filtro: enPanel,
  },
  tarjetaLocal: {
    que: 'Funciones LOCALES de tarjeta (`Kpi`, `Tarjeta*`, `Metrica`, `Cifra`, `Dato`) en el panel',
    porque:
      'Definidas dentro de una página o de un archivo y NO exportadas, repiten lo que `StatCard` ya hace, con otro tamaño de cifra y otro radio ' +
      '(FE-04). Una página que se llame `MetricasPage` no es una tarjeta y no cuenta. Una tarjeta EXPORTADA y compartida (`TarjetaAccion` del ' +
      'Resumen, las tarjetas de pago de Pagos) es el remedio, no el defecto: desde la fase 5 no cuenta (la medida cuenta lo que su nombre ' +
      'dice, «locales»; el techo se recalcula con esa definición y solo puede bajar).',
    re: /\bfunction\s+(?:Kpi|Tarjeta|Metrica|Cifra|Dato|StatCard|KpiCard)(?!\w*(?:Page|Layout)\b)\w*\s*\(|\bconst\s+(?:Kpi|Tarjeta|Metrica|Cifra|Dato|StatCard|KpiCard)(?!\w*(?:Page|Layout)\b)\w*\s*=\s*(?:\(|async|function|memo)/g,
    filtro: (m, a) => enPanel(m, a) && !/\bexport\s+(?:default\s+)?$/.test(m.input.slice(Math.max(0, m.index - 24), m.index)),
  },
  tablaCruda: {
    que: '`<table>` crudas en el panel',
    porque:
      'Sin `caption`, sin `scope` y con su propia paginación: 47 tablas que se ven y se leen distinto (06 · T-01, FE-13). La primitiva de ' +
      'tabla llega en la fase 4.',
    re: /<table\b/g,
    filtro: enPanel,
  },
  variablesHexEnGlobalsCss: {
    que: 'Variables CSS con hex literal en globals.css',
    porque:
      'El auditor de TSX no las veía. Cada una es un color de marca más fuera de la escala (FE-12): el azul de la marca existe varias ' +
      'veces. Los temas del cliente deben derivarse de la escala, no repetirla.',
    medir: contarVariablesHexEnGlobalsCss,
  },
  mapasDeEstado: {
    que: 'Mapas «estado → clases de color» escritos a mano',
    porque: 'Cada uno es un contrato estado→aspecto propio (FE-03). Debe salir de un solo `estadoUi`. Heurística: ver `contarMapasDeEstado`.',
    medir: contarMapasDeEstado,
  },
  componentesSinUso: {
    que: 'Componentes de @membego/ui que nadie importa',
    porque: 'Mantenimiento sin cliente, y el paquete se entrega tal cual a cada satélite (FE-14).',
    medir: contarComponentesSinUso,
  },

  // ── Fase 4 (tarea 4.10): accesibilidad, medida en el panel. Techos nuevos; antes nada los vigilaba (FE-13). ──
  botonIconoSinNombre: {
    que: '`<Button size="icon">` sin `aria-label` ni `title` en el panel',
    porque:
      'Un botón que solo trae un icono no tiene nombre para un lector de pantalla: «botón» a secas. Se cuenta como CANDIDATO: un ' +
      '`{...props}` podría traer el nombre, y aun así conviene que se vea en la etiqueta.',
    re: /<Button\b(?:=>|[^>])*>/g,
    filtro: (m, a) => enPanel(m, a) && /\bsize=(?:"icon(?:-sm)?"|\{['"]icon(?:-sm)?['"]\})/.test(m[0]) && !/\baria-label=|\btitle=/.test(m[0]),
  },
  outlineSinFoco: {
    que: 'Líneas con `outline-none` sin `focus-visible` en el panel',
    porque:
      'Quitar el contorno sin ofrecer otro deja el foco invisible para quien navega con teclado (WCAG 2.4.7). Se cuenta por línea: ' +
      'un `focus-visible` en la línea siguiente de la misma `className` sale como candidato.',
    re: /^[^\n]*\boutline-none\b[^\n]*$/gm,
    filtro: (m, a) => enPanel(m, a) && !/focus-visible/.test(m[0]),
  },
}

/** Cuenta una medida: por expresión regular (con su filtro) o por una función propia cuando no es cuestión de texto. */
const medida = (m) => (m.medir ? { total: m.medir(), porArchivo: {}, valores: {} } : cuenta(m.re, m.filtro ?? (() => true)))

/** Cuenta todo. Devuelve `{ clave: número }`. */
export function auditar() {
  const r = {}
  for (const [clave, m] of Object.entries(MEDIDAS)) {
    r[clave] = medida(m).total
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
    const r = medida(m)
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
