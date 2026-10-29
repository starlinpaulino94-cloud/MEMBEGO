import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UN FORMATO POR SECCIÓN, y que nadie lo esquive.
 *
 * Cada componente que sube una imagen DE LA MARCA (fotos de producto, logos,
 * banners, avatares…) tiene que pasar por el editor de encuadre con el formato
 * de su sección. Esta prueba recorre los componentes y falla si aparece uno
 * nuevo que sube un archivo sin decidir: o se enchufa al editor, o se declara
 * aquí como excepción con su motivo.
 */

const RAIZ = join(import.meta.dirname, '..')
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')

/** componente → formato(s) con que debe usar el editor. */
const SECCIONES: Record<string, string[]> = {
  'src/components/catalogo/ImagenesPanel.tsx': ['catalogo'],
  'src/components/admin/PromoImagenUpload.tsx': ['promocion'],
  'src/components/admin/PlanImagenUpload.tsx': ['plan'],
  'src/components/excursiones/ExcursionImagenUpload.tsx': ['excursion', 'galeria'],
  'src/components/admin/GalleryManager.tsx': ['galeria'],
  'src/components/admin/MediaUpload.tsx': ['banner', 'logo'],
  'src/components/superadmin/LogoUpload.tsx': ['logo'],
  'src/components/public/SolicitudEmpresaForm.tsx': ['logo', 'banner', 'promocion'],
  'src/components/cliente/AvatarUpload.tsx': ['avatar'],
  'src/components/admin/EditorInicio.tsx': ['bannerInicio'],
}

/** Suben un archivo y NO deben recortarse: son pruebas, no imagen de marca. */
const EXCEPCIONES: Record<string, string> = {
  'src/components/carwash/EvidenciaForm.tsx': 'fotos de evidencia del estado del vehículo: recortarlas cambiaría la prueba',
  'src/components/cliente/ComprobantePagoForm.tsx': 'comprobantes de pago: documento, no imagen de marca',
  'src/components/cliente/ReportarProblemaForm.tsx': 'adjunto de un reporte de problema: captura tal cual',
  'src/components/supply-v2/finanzas/adjunto.tsx': 'adjuntos contables (pueden ser PDF)',
  'src/components/inventario/ImportarForm.tsx': 'archivo CSV de existencias: se lee como texto en el navegador, no es una imagen',
  'src/components/inventario/ImportarConteoForm.tsx': 'archivo CSV de lo contado: se lee como texto en el navegador, no es una imagen',
  // Se delega en el editor mediante la prop `formato`; los formularios que la usan se comprueban abajo.
  'src/components/invitaciones/CampanaImagenUpload.tsx': 'recibe el formato por prop (ver prueba de sus llamadas)',
}

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(join(RAIZ, dir))) {
    const ruta = `${dir}/${nombre}`
    if (statSync(join(RAIZ, ruta)).isDirectory()) archivos(ruta, salida)
    else if (/\.tsx$/.test(nombre)) salida.push(ruta)
  }
  return salida
}

test('cada componente de imagen de marca usa el editor con el formato de SU sección', () => {
  for (const [ruta, formatos] of Object.entries(SECCIONES)) {
    const src = leer(ruta)
    const usaEditor = /useEditorDeImagen\(|<EditorDeImagen/.test(src)
    assert.ok(usaEditor, `${ruta}: sube imagen sin pasar por el editor de encuadre`)
    for (const f of formatos) {
      assert.match(src, new RegExp(`FORMATOS\\.${f}\\b`), `${ruta}: debe usar FORMATOS.${f}`)
    }
  }
})

test('las campañas reciben su formato por prop: compartir para la imagen del enlace y fondo para el banner', () => {
  const comp = leer('src/components/invitaciones/CampanaImagenUpload.tsx')
  assert.match(comp, /useEditorDeImagen\(\{ formato/)
  assert.match(comp, /formato: FormatoImagen/)
  const invita = leer('src/components/invitaciones/CampanaInvitacionForm.tsx')
  assert.match(invita, /name="imagenUrl"[\s\S]*?formato=\{FORMATOS\.compartir\}/)
  assert.match(invita, /name="bannerUrl"[\s\S]*?formato=\{FORMATOS\.fondo\}/)
  assert.match(leer('src/components/engagement/MarketingCampaignForm.tsx'), /formato=\{FORMATOS\.fondo\}/)
})

test('ningún componente nuevo sube un archivo sin decidir: o usa el editor o está en la lista de excepciones', () => {
  const conocidos = new Set([...Object.keys(SECCIONES), ...Object.keys(EXCEPCIONES), 'src/components/imagen/useEditorDeImagen.tsx', 'src/components/imagen/EditorDeImagen.tsx'])
  for (const ruta of archivos('src/components')) {
    const src = leer(ruta)
    const subeArchivo = /type=["']file["']/.test(src)
    if (!subeArchivo || conocidos.has(ruta)) continue
    assert.fail(`${ruta} sube un archivo y no está en SECCIONES (editor) ni en EXCEPCIONES. Decide: enchúfalo al editor con el formato de su sección o declara por qué no.`)
  }
})

test('las excepciones siguen existiendo (si un archivo se borra, se quita de la lista)', () => {
  for (const ruta of [...Object.keys(EXCEPCIONES), ...Object.keys(SECCIONES)]) {
    assert.doesNotThrow(() => statSync(join(RAIZ, ruta)), ruta)
  }
})

test('las imágenes de la marca se pintan con la proporción de su formato (nada se recorta distinto del que se encuadró)', () => {
  // Producto y oferta: cuadrado.
  assert.match(leer('src/components/catalogo/TarjetaCatalogoPublica.tsx'), /aspect-square/)
  assert.match(leer('src/components/deals/TarjetaOferta.tsx'), /aspect-square/)
  // Plan y excursión: 16:9.
  assert.match(leer('src/components/cliente/PlanesGrid.tsx'), /aspect-\[16\/9\]/)
  assert.match(leer('src/components/excursiones/FichaDeExcursion.tsx'), /aspect-\[16\/9\]/)
  assert.doesNotMatch(leer('src/app/(public)/excursiones/page.tsx'), /aspect-\[16\/10\]/)
  assert.doesNotMatch(leer('src/components/marketplace/CompanyProfile.tsx'), /aspect-\[16\/10\]/)
  // Promoción en la búsqueda: cuadrada, como su formato.
  assert.doesNotMatch(leer('src/components/cliente/inicio/BuscadorUnificado.tsx'), /aspect-\[4\/3\]/)
})
