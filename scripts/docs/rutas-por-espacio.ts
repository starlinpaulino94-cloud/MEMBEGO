/**
 * MEMBEGO · LA TABLA DE RUTAS POR ESPACIO (separación landing / app / paneles · F6).
 *
 * Lee `src/app` y clasifica CADA página y CADA handler en el espacio al que pertenece. La tabla de
 * `docs/SEPARACION_LANDING_APP.md` sale de aquí, y `tests/separacion-rutas.test.ts` falla si:
 *
 *   · aparece una ruta o un grupo de rutas que no está clasificado (hay que decidir de qué espacio es), o
 *   · la tabla del documento no coincide con la que sale del código (el documento no se puede quedar viejo).
 *
 * USO
 *   bun scripts/docs/rutas-por-espacio.ts              # imprime la tabla
 *   bun scripts/docs/rutas-por-espacio.ts --escribir   # la escribe en el documento, entre sus marcas
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type Espacio = 'landing' | 'enlaces' | 'acceso' | 'cliente' | 'paneles' | 'api' | 'sistema'

export const ESPACIOS: Array<{ clave: Espacio; titulo: string; que: string }> = [
  { clave: 'landing', titulo: 'Landing', que: 'Informa y descubre: consulta, SEO y enlaces compartidos. No opera; ofrece el traspaso a la app.' },
  { clave: 'enlaces', titulo: 'Enlaces compartidos', que: 'Invitaciones y enlaces cortos que llevan a la landing, al registro o a la app.' },
  { clave: 'acceso', titulo: 'Acceso', que: 'Entrar, registrarse, recuperar, confirmar y aceptar invitaciones.' },
  { clave: 'cliente', titulo: 'App del cliente', que: 'Todo lo que el cliente hace: comprar, reservar, contratar, reclamar, pagar.' },
  { clave: 'paneles', titulo: 'Paneles', que: 'Administrador, superadmin, empleado, vendedor y asistente de negocio.' },
  { clave: 'api', titulo: 'API', que: 'Handlers de servidor (`/api/**`, incluida la API v1 que usa la app móvil).' },
  { clave: 'sistema', titulo: 'Sistema', que: 'Páginas de error, sin conexión, imágenes para compartir, `robots` y `sitemap`.' },
]

/** Cada grupo de rutas o carpeta de primer nivel de `src/app`, en su espacio. Una carpeta que no esté aquí hace fallar la prueba. */
export const ESPACIO_DE: Record<string, Espacio> = {
  '(public)': 'landing',
  invitar: 'enlaces',
  invita: 'enlaces',
  e: 'enlaces',
  r: 'enlaces',
  '(auth)': 'acceso',
  auth: 'acceso',
  sso: 'acceso',
  invitacion: 'acceso',
  '(cliente)': 'cliente',
  '(admin)': 'paneles',
  '(superadmin)': 'paneles',
  '(empleado)': 'paneles',
  '(vendedor)': 'paneles',
  '(onboarding)': 'paneles',
  api: 'api',
  offline: 'sistema',
  og: 'sistema',
}

/** Archivos de la raíz de `src/app` que son del sistema (error, no encontrada, robots, sitemap…). */
const RAIZ_DEL_SISTEMA = /^(error|global-error|not-found|loading|robots|sitemap|manifest|opengraph-image|icon|apple-icon)\.(tsx?|ts)$/

const ES_RUTA = /^(page\.tsx|route\.tsx?|opengraph-image\.tsx)$/

export interface Ruta {
  url: string
  tipo: 'pagina' | 'handler'
  espacio: Espacio | null
  archivo: string
}

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) recorrer(p, acc)
    else acc.push(p)
  }
  return acc
}

/** La URL de un archivo de `src/app`: sin grupos `(x)`, con los segmentos dinámicos tal cual. */
function urlDe(relativo: string): string {
  const segmentos = relativo.split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s))
  return '/' + segmentos.join('/')
}

export function rutasDe(raiz = 'src/app'): Ruta[] {
  if (!existsSync(raiz)) return []
  const rutas: Ruta[] = []
  for (const archivo of recorrer(raiz)) {
    const rel = relative(raiz, archivo)
    const nombre = rel.split(sep).at(-1) as string
    const esRaiz = !rel.includes(sep)
    if (esRaiz ? !(ES_RUTA.test(nombre) || RAIZ_DEL_SISTEMA.test(nombre)) : !ES_RUTA.test(nombre)) continue
    const primero = rel.split(sep)[0]
    const espacio: Espacio | null = esRaiz ? (RAIZ_DEL_SISTEMA.test(nombre) || ES_RUTA.test(nombre) ? 'sistema' : null) : (ESPACIO_DE[primero] ?? null)
    const url = esRaiz ? '/' + (/^(page|route|opengraph-image)\./.test(nombre) ? '' : nombre.replace(/\.(tsx?|ts)$/, '')) : urlDe(rel)
    rutas.push({ url: url === '' ? '/' : url, tipo: nombre === 'page.tsx' ? 'pagina' : 'handler', espacio, archivo: relative('.', archivo) })
  }
  return rutas.sort((a, b) => a.url.localeCompare(b.url) || a.tipo.localeCompare(b.tipo))
}

export const MARCA_INICIO = '<!-- RUTAS-POR-ESPACIO:INICIO (generado por scripts/docs/rutas-por-espacio.ts; no editar a mano) -->'
export const MARCA_FIN = '<!-- RUTAS-POR-ESPACIO:FIN -->'

/** Las páginas de la landing, el acceso, los enlaces y la app, una por una; los paneles y la API, por prefijo y conteo. */
const DETALLE: Espacio[] = ['landing', 'enlaces', 'acceso', 'cliente']

export function tablaMarkdown(rutas: Ruta[]): string {
  const por = (e: Espacio) => rutas.filter((r) => r.espacio === e)
  const lineas: string[] = [MARCA_INICIO, '', '| Espacio | Qué es | Páginas | Handlers |', '|---|---|---:|---:|']
  for (const e of ESPACIOS) {
    const rs = por(e.clave)
    lineas.push(`| **${e.titulo}** | ${e.que} | ${rs.filter((r) => r.tipo === 'pagina').length} | ${rs.filter((r) => r.tipo === 'handler').length} |`)
  }
  lineas.push('')
  for (const e of ESPACIOS.filter((x) => DETALLE.includes(x.clave))) {
    const urls = [...new Set(por(e.clave).map((r) => r.url))]
    lineas.push(`**${e.titulo}** (${urls.length}): ${urls.map((u) => `\`${u}\``).join(' · ')}`, '')
  }
  const paneles = por('paneles')
  const prefijo = (u: string) => '/' + (u.split('/')[1] ?? '')
  const grupos = [...new Set(paneles.map((r) => prefijo(r.url)))].sort()
  lineas.push(
    `**Paneles**: ${grupos.map((g) => `\`${g}\` (${paneles.filter((r) => prefijo(r.url) === g).length})`).join(' · ')}`,
    '',
    MARCA_FIN
  )
  return lineas.join('\n')
}

/** Las rutas sin espacio: lo que obliga a decidir de dónde es. */
export const sinClasificar = (rutas: Ruta[]) => rutas.filter((r) => r.espacio === null)

/** Escribe la tabla en el documento, entre sus marcas. */
export function escribirEnElDocumento(doc = 'docs/SEPARACION_LANDING_APP.md', raiz = 'src/app'): void {
  const texto = readFileSync(doc, 'utf8')
  const a = texto.indexOf('<!-- RUTAS-POR-ESPACIO:INICIO')
  const b = texto.indexOf(MARCA_FIN)
  if (a < 0 || b < 0) throw new Error(`Faltan las marcas de la tabla en ${doc}`)
  writeFileSync(doc, texto.slice(0, a) + tablaMarkdown(rutasDe(raiz)) + texto.slice(b + MARCA_FIN.length))
}

if (process.argv[1]?.endsWith('rutas-por-espacio.ts')) {
  const rutas = rutasDe()
  const sin = sinClasificar(rutas)
  if (sin.length) {
    console.error(`Rutas sin espacio (clasifícalas en ESPACIO_DE):\n${sin.map((r) => `  ${r.url}  (${r.archivo})`).join('\n')}`)
    process.exit(1)
  }
  if (process.argv.includes('--escribir')) {
    escribirEnElDocumento()
    console.log('Tabla escrita en docs/SEPARACION_LANDING_APP.md')
  } else {
    console.log(tablaMarkdown(rutas))
  }
}
