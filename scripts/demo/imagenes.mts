import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

/**
 * IMÁGENES DE LAS EMPRESAS DEMO — generadas, no descargadas.
 *
 * Cada negocio recibe su juego completo (logo, banner, galería y arte por
 * promoción) compuesto como SVG con su paleta y rasterizado a PNG con sharp,
 * que ya es dependencia del proyecto. Nada se busca en internet y nada pesa
 * de más: son degradados con texto, no fotografías.
 *
 * Formatos según las reglas reales del producto: el arte de promoción es 1:1
 * (el rango que exige la subida), el banner 5:2 y el logo cuadrado.
 */

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Parte un titular en líneas de ancho legible para el SVG. */
function lineas(texto: string, max: number): string[] {
  const palabras = texto.split(/\s+/)
  const salida: string[] = []
  let actual = ''
  for (const p of palabras) {
    if ((actual + ' ' + p).trim().length > max) {
      if (actual) salida.push(actual)
      actual = p
    } else {
      actual = (actual + ' ' + p).trim()
    }
  }
  if (actual) salida.push(actual)
  return salida.slice(0, 4)
}

const FUENTE = 'Segoe UI, Arial, sans-serif'

async function png(svg: string, ruta: string) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(ruta)
}

export interface PaletaDemo {
  c1: string
  c2: string
  /** Color del texto sobre el degradado (blanco casi siempre). */
  tinta?: string
}

function burbujas(ancho: number, alto: number, opacidad = 0.14): string {
  return `
    <circle cx="${ancho * 0.85}" cy="${alto * 0.2}" r="${alto * 0.45}" fill="#ffffff" opacity="${opacidad}"/>
    <circle cx="${ancho * 0.1}" cy="${alto * 0.9}" r="${alto * 0.35}" fill="#ffffff" opacidad="${opacidad}" opacity="${opacidad}"/>
    <circle cx="${ancho * 0.75}" cy="${alto * 0.95}" r="${alto * 0.2}" fill="#000000" opacity="0.08"/>`
}

function fondo(id: string, c1: string, c2: string, ancho: number, alto: number): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="${ancho}" height="${alto}" fill="url(#${id})"/>`
}

export async function generarJuego(opts: {
  dir: string
  slug: string
  nombre: string
  iniciales: string
  rubro: string
  paleta: PaletaDemo
  galeria: string[]
  promos: { archivo: string; titulo: string; sello: string | null }[]
}) {
  const carpeta = join(opts.dir, opts.slug)
  mkdirSync(carpeta, { recursive: true })
  const { c1, c2 } = opts.paleta
  const tinta = opts.paleta.tinta ?? '#ffffff'
  const rutas = {
    logo: `/demo/${opts.slug}/logo.png`,
    banner: `/demo/${opts.slug}/banner.png`,
    galeria: [] as string[],
    promos: new Map<string, string>(),
  }

  // Logo 512×512: cuadro redondeado con las iniciales.
  await png(
    `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      ${fondo('g', c1, c2, 512, 512)}
      ${burbujas(512, 512)}
      <text x="256" y="300" text-anchor="middle" font-family="${FUENTE}" font-size="190" font-weight="800" fill="${tinta}">${esc(opts.iniciales)}</text>
    </svg>`,
    join(carpeta, 'logo.png')
  )

  // Banner 1500×600: nombre grande + rubro.
  await png(
    `<svg width="1500" height="600" xmlns="http://www.w3.org/2000/svg">
      ${fondo('g', c1, c2, 1500, 600)}
      ${burbujas(1500, 600)}
      <text x="90" y="300" font-family="${FUENTE}" font-size="92" font-weight="800" fill="${tinta}">${esc(opts.nombre)}</text>
      <text x="92" y="380" font-family="${FUENTE}" font-size="40" font-weight="500" fill="${tinta}" opacity="0.9">${esc(opts.rubro)}</text>
    </svg>`,
    join(carpeta, 'banner.png')
  )

  // Galería 1200×800: una lámina por rótulo, con variación de ángulo.
  for (const [i, rotulo] of opts.galeria.entries()) {
    const archivo = `galeria-${i + 1}.png`
    await png(
      `<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g" x1="${i % 2}" y1="0" x2="${1 - (i % 2)}" y2="1">
          <stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/>
        </linearGradient></defs>
        <rect width="1200" height="800" fill="url(#g)"/>
        ${burbujas(1200, 800, 0.12)}
        <rect x="60" y="620" width="${120 + rotulo.length * 22}" height="90" rx="45" fill="#000000" opacity="0.28"/>
        <text x="105" y="680" font-family="${FUENTE}" font-size="42" font-weight="700" fill="#ffffff">${esc(rotulo)}</text>
      </svg>`,
      join(carpeta, archivo)
    )
    rutas.galeria.push(`/demo/${opts.slug}/${archivo}`)
  }

  // Arte de promoción 800×800 (1:1): titular en líneas + sello de descuento.
  for (const promo of opts.promos) {
    const partes = lineas(promo.titulo, 14)
    const inicioY = 330 - (partes.length - 1) * 45
    await png(
      `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
        ${fondo('g', c1, c2, 800, 800)}
        ${burbujas(800, 800)}
        ${partes
          .map(
            (l, i) =>
              `<text x="70" y="${inicioY + i * 90}" font-family="${FUENTE}" font-size="72" font-weight="800" fill="${tinta}">${esc(l)}</text>`
          )
          .join('')}
        <text x="72" y="${inicioY + partes.length * 90 + 10}" font-family="${FUENTE}" font-size="34" font-weight="500" fill="${tinta}" opacity="0.88">${esc(opts.nombre)}</text>
        ${
          promo.sello
            ? `<circle cx="640" cy="640" r="110" fill="#ffffff"/>
               <text x="640" y="662" text-anchor="middle" font-family="${FUENTE}" font-size="58" font-weight="800" fill="${c1}">${esc(promo.sello)}</text>`
            : ''
        }
      </svg>`,
      join(carpeta, `${promo.archivo}.png`)
    )
    rutas.promos.set(promo.archivo, `/demo/${opts.slug}/${promo.archivo}.png`)
  }

  return rutas
}
