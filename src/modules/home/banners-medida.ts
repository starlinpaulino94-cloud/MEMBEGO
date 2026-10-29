import { getHomeBorrador, getHomePublicada } from './composicion'
import { HeroSlide } from './esquema'
import { heroPublico } from './hero-publico'
import { huellaDeSlide } from './banner-huella'
import type { HeroInicio } from './vista'

/**
 * LOS BANNERS A MEDIDA DE UNA EMPRESA, tal como están PUBLICADOS hoy.
 *
 * El editor de inicio solo cargaba el borrador: al publicar, el borrador pasa a
 * ser la revisión publicada y los banners activos dejaban de verse en el panel.
 * Esta lectura los devuelve siempre, estén o no al aire en este momento, para
 * que la empresa pueda editarlos o quitarlos.
 */
export interface BannerMedidaVista {
  /** Posición dentro del hero publicado (con la huella, identifica el banner). */
  indice: number
  huella: string
  titulo: string
  subtitulo: string
  ctaTexto: string
  destinoTipo: HeroSlide['ctaDestino']['tipo']
  formato: HeroSlide['formato']
  imagen: string | null
  /** La tarjeta tal como la ve el cliente; null si hoy no se puede mostrar. */
  hero: HeroInicio | null
}

export interface BannersMedida {
  publicados: BannerMedidaVista[]
  /** Hay cambios sin publicar en el editor. */
  hayBorrador: boolean
  /** El bloque de banners está apagado en la composición publicada. */
  bloqueApagado: boolean
}

export async function bannersAMedida(companyId: string): Promise<BannersMedida> {
  const [publicada, borrador] = await Promise.all([getHomePublicada(companyId), getHomeBorrador(companyId)])
  const hayBorrador = !!borrador && borrador.id !== publicada?.id
  const bloque = publicada?.bloques.find((b) => b.tipo === 'HERO')
  if (!publicada || !bloque) return { publicados: [], hayBorrador, bloqueApagado: false }
  const slides = HeroSlide.array().safeParse((bloque.config as { slides?: unknown } | null)?.slides ?? [])
  if (!slides.success) return { publicados: [], hayBorrador, bloqueApagado: !bloque.activo }

  const publicados = await Promise.all(
    slides.data.map(async (s, indice): Promise<BannerMedidaVista> => {
      const hero = await heroPublico(companyId, s, 'app').catch(() => null)
      return {
        indice,
        huella: huellaDeSlide(s),
        titulo: s.titulo,
        subtitulo: s.subtitulo,
        ctaTexto: s.ctaTexto,
        destinoTipo: s.ctaDestino.tipo,
        formato: s.formato,
        imagen: hero?.imagen ?? s.imagenUrl,
        hero: bloque.activo ? hero : null,
      }
    }),
  )
  return { publicados, hayBorrador, bloqueApagado: !bloque.activo }
}
