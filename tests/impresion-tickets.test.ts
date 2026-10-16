import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * IMPRESIÓN DE TICKETS: UN SOLO CANAL (16-10-2026).
 *
 * Los comprobantes salían en 3 páginas (o en 3 copias idénticas) y recortados
 * porque seis pantallas imprimían cada una con su propio `@media print` a mano
 * (`body * { visibility: hidden }` + región `position: absolute`). Ahora todo
 * ticket pasa por `AreaDeImpresion`. Estas pruebas fijan esa decisión: si una
 * pantalla nueva vuelve a llamar a `window.print` o a escribir su `@media print`,
 * el fallo reaparece sin que nadie lo note hasta el mostrador.
 *
 * Lo que de verdad llega a la impresora (una página, ticket en el origen de la
 * hoja, QR cargado) lo mide `tests/e2e/impresion-tickets.spec.ts` en el navegador.
 */

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
/** Quita comentarios de bloque y de línea: lo que cuenta es el código, no la explicación de por qué existe. */
const sinComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function archivos(dir: string): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(join(RAIZ, dir))) {
    const ruta = join(dir, nombre)
    if (statSync(join(RAIZ, ruta)).isDirectory()) salida.push(...archivos(ruta))
    else if (/\.(tsx?|mjs)$/.test(nombre) && !/\.test\./.test(nombre)) salida.push(ruta)
  }
  return salida
}

const AREA = 'src/components/impresion/AreaDeImpresion.tsx'

/** Las pantallas que imprimen tickets de rollo (58/80 mm) o facturas. */
const SUPERFICIES_DE_TICKET = [
  'src/components/scanner/ReceiptTicket.tsx',
  'src/components/scanner/ComprobanteReceipt.tsx',
  'src/components/facturas/FacturaPrintDialog.tsx',
  'src/components/caja/CierreCajaDialog.tsx',
  'src/components/caja/ReporteDiaDialog.tsx',
]

/** Los únicos sitios que pueden llamar a `window.print`: el área de tickets y el botón de los reportes A4 del panel. */
const PUEDEN_IMPRIMIR = new Set([AREA, 'packages/ui/src/ui/boton-imprimir.tsx', 'src/components/admin/BotonImprimir.tsx'])

test('solo el área de impresión y el botón de los reportes llaman a window.print; nadie lo hace con un setTimeout', () => {
  for (const ruta of [...archivos('src'), ...archivos('packages/ui/src')]) {
    const src = leer(ruta)
    assert.doesNotMatch(src, /setTimeout\([^)]*window\.print/, `${ruta}: imprimir con un setTimeout imprime lo que había antes del render (el COPIA #N no estaba)`)
    if (PUEDEN_IMPRIMIR.has(ruta)) continue
    // Comentarios aparte: lo que cuenta es la llamada.
    assert.doesNotMatch(sinComentarios(src), /window\.print\s*\(/, `${ruta} llama a window.print: un ticket se imprime pidiéndoselo a AreaDeImpresion (solicitud)`)
  }
})

test('el truco de «body * { visibility: hidden }» solo vive en el reporte A4 del panel', () => {
  for (const ruta of [...archivos('src'), ...archivos('packages/ui/src')]) {
    if (ruta === 'packages/ui/src/ui/reporte-imprimible.tsx') continue
    assert.doesNotMatch(sinComentarios(leer(ruta)), /body\s*\*\s*\{\s*visibility/, `${ruta}: ese truco deja el panel ocupando altura y salen páginas de más`)
  }
})

test('cada superficie de ticket imprime por AreaDeImpresion y no trae su propio @media print', () => {
  for (const ruta of SUPERFICIES_DE_TICKET) {
    const src = leer(ruta)
    assert.match(src, /from '@\/components\/impresion\/AreaDeImpresion'/, `${ruta} no usa AreaDeImpresion`)
    assert.doesNotMatch(src, /@media print/, `${ruta} escribe su propio @media print`)
    assert.doesNotMatch(src, /receipt-print|factura-print|cierre-print|reporte-dia-print/, `${ruta} conserva una región de impresión a mano`)
  }
  // Las pantallas que montan ReceiptTicket le piden la impresión con `solicitud`.
  for (const ruta of ['src/components/scanner/ConfirmPromo.tsx', 'src/components/scanner/TransaccionRecord.tsx', 'src/components/scanner/ComprobanteReceipt.tsx']) {
    assert.match(leer(ruta), /<ReceiptTicket[\s\S]*?solicitud=\{solicitud\}/, `${ruta}: ReceiptTicket sin solicitud nunca imprime`)
  }
})

test('el área: portal al body, el resto sin altura al imprimir, scroll del diálogo neutralizado, ancho útil del papel', async () => {
  const src = leer(AREA)
  const { ESTILOS_IMPRESION, ANCHO_IMPRIMIBLE_MM } = await import('../src/components/impresion/AreaDeImpresion')
  const css = ESTILOS_IMPRESION.replace(/\s+/g, ' ')
  assert.match(src, /createPortal\(/)
  assert.match(src, /document\.body\.appendChild\(div\)/, 'el nodo cuelga directamente de <body>: fuera de diálogos, transforms y overflows')
  assert.match(css, /body\[data-imprimiendo\] > :not\(\[data-impresion\]\) \{ display: none !important; \}/, 'display:none (y no visibility) es lo que quita la altura: una sola página')
  assert.match(css, /html body\[data-imprimiendo\] \{[^}]*overflow: visible !important/, 'gana al overflow:hidden del bloqueo de scroll de los diálogos')
  assert.match(css, /\[data-impresion\]\[data-activa\] \{ display: block !important; position: static !important/, 'posición estática: nada se ancla a un contenedor transformado ni se repite por página')
  assert.match(css, /@media screen \{ \[data-impresion\] \{ display: none !important; \} \}/, 'en pantalla el área nunca se ve')
  assert.deepEqual(ANCHO_IMPRIMIBLE_MM, { 58: 48, 80: 72 }, 'ancho útil: 576 puntos en 80 mm, 384 en 58 mm')
  assert.match(src, /esperarImagenes\(nodo\)/, 'el QR y el logo tienen que estar decodificados cuando se abre el diálogo')
  assert.match(src, /requestAnimationFrame\(\(\) => requestAnimationFrame/, 'se imprime después de pintar el render con los datos de ESTA impresión')
  assert.match(src, /@page \{ \$\{paginaDe\(papel\)\} \}/)
  assert.match(src, /'size: auto; margin: 0;'/, 'un rollo no fija tamaño de página: lo decide el driver de la impresora')
})

test('las vistas previas de caja enseñan el ancho útil de 80 mm: en el papel se imprime lo mismo que se ve', () => {
  for (const ruta of ['src/components/caja/CierreCajaDialog.tsx', 'src/components/caja/ReporteDiaDialog.tsx']) {
    const src = leer(ruta)
    assert.match(src, /\(80 - ANCHO_IMPRIMIBLE_MM\[80\]\) \/ 2/, `${ruta}: la vista previa debe dejar los márgenes del rollo`)
    assert.match(src, /papel=\{false\}/, `${ruta}: al papel va solo el contenido, con el ancho del área`)
  }
  const factura = leer('src/components/facturas/FacturaPrintDialog.tsx')
  assert.match(factura, /const margen = \(widthMm - ANCHO_IMPRIMIBLE_MM\[widthMm\]\) \/ 2/)
  assert.match(factura, /onImpreso=\{\(\) => setImprimiendo\(false\)\}/, 'el botón se libera cuando el diálogo del sistema se cierra, no antes')
})
