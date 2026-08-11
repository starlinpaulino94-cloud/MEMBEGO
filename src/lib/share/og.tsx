import { ImageResponse } from 'next/og'
import { OG_MAX_BYTES, OG_SIZE } from './og-tamano'
import { SITE_NAME } from '@/lib/site'

/**
 * Share Engine · tarjeta de vista previa (Open Graph / Twitter Card) genérica.
 *
 * Cualquier entidad compartible (promoción, plan/membresía, empresa, campaña,
 * invitación) genera su tarjeta con este componente: si tiene imagen oficial,
 * es el FONDO de la tarjeta (con velo para legibilidad); si no, un degradado
 * con los colores de la entidad. Así todo enlace de MembeGo se ve como una
 * tarjeta visual completa en WhatsApp/Facebook/Telegram/X, nunca como texto
 * plano.
 */

// El tamaño y los límites viven en `og-tamano.ts`, sin dependencias, para que
// también los pueda leer la vista previa del panel (componente de cliente) sin
// arrastrar `next/og` al navegador.
export { OG_SIZE, OG_ASPECTO, OG_MAX_BYTES, OG_MAX_MB, OG_RECOMENDACION } from './og-tamano'

/**
 * ÚNICA FORMA DE GENERAR UNA TARJETA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LOS TAMAÑOS ESTÁN ESCRITOS Y NO ESCALADOS AL VUELO
 *
 * Al subir el lienzo de 1200×630 a `OG_SIZE`, lo evidente era envolver el
 * diseño en un `transform: scale()` y no tocar ningún número. **No funciona, y
 * falla de la peor manera posible:** satori descarta los `<svg>` y los `<img>`
 * que están dentro de un contenedor transformado. Solo sobrevive el texto.
 *
 * Se comprobó renderizando: el logo de MembeGo DESAPARECÍA de todas las
 * tarjetas. Un cambio pensado para que la marca se vea mejor la habría borrado
 * de cada enlace compartido.
 *
 * Así que los tamaños del diseño están escritos ya en las coordenadas finales,
 * multiplicados una vez por `OG_ESCALA`. Es más verboso y es lo que funciona.
 *
 * Regla para quien retoque estas tarjetas: los números son píxeles del lienzo
 * de `OG_SIZE`, no de 1200×630.
 */
export function tarjetaOg(elemento: React.ReactElement): ImageResponse {
  return new ImageResponse(elemento, OG_SIZE)
}

export interface ShareCardData {
  /** Categoría del enlace (Promoción · Membresía · Empresa · Invitación). */
  badge?: string | null
  /** Nombre del negocio (chip superior derecha). */
  empresa?: string | null
  titulo: string
  /** Frase corta sobre el título (ej: "Has recibido una invitación exclusiva"). */
  subtitulo?: string | null
  /** Dato protagonista en pastilla blanca (descuento, precio, regalo). */
  destacado?: string | null
  /** Línea de cierre (ej: "Regístrate gratis y reclama tu regalo"). */
  footer?: string | null
  /** Imagen oficial: fondo de la tarjeta. */
  imagenUrl?: string | null
  colorPrimario?: string | null
  colorSecundario?: string | null
}

/** Formatos que satori (next/og) rasteriza de forma fiable. */
const OG_IMG_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif']


/**
 * Descarga la imagen y la devuelve como data URL para incrustarla en la
 * tarjeta. Se hace aquí (y no dejando que satori haga el fetch) para poder
 * controlar timeout, tamaño y formato: cualquier problema → null y la
 * tarjeta cae al diseño degradado, nunca a una imagen rota.
 */
export async function fetchImageDataUrl(url: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const tipo = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!OG_IMG_TYPES.includes(tipo)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    // El tope va contra lo que se admite al subir, no contra un número suelto:
    // ver `OG_MAX_BYTES`. El timeout de 4 s sigue siendo la defensa real contra
    // una vista previa lenta (WhatsApp corta alrededor de 5 s), y esa no cambia.
    if (buf.length === 0 || buf.length > OG_MAX_BYTES) return null
    return `data:${tipo};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Sirve la imagen ORIGINAL de la entidad como respuesta del endpoint
 * opengraph-image. WhatsApp solo muestra la tarjeta GRANDE si la imagen pesa
 * menos de ~600 KB: un JPEG subido por el negocio pasa; un PNG compuesto con
 * foto de fondo casi nunca. Por eso, con foto oficial se entrega la foto
 * (como hace Temu) y la tarjeta compuesta queda para entidades sin foto.
 * Devuelve null si la imagen no es apta (formato/tamaño/timeout) para que el
 * llamador caiga a la tarjeta compuesta.
 */
export async function originalImageResponse(
  url: string,
  timeoutMs = 4000,
  // >600 KB: WhatsApp puede degradar a miniatura. El llamador puede subir el
  // tope (ej. 4 MB) cuando prefiera SIEMPRE la imagen original entera.
  maxBytes = 600_000
): Promise<Response | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const tipo = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(tipo)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > maxBytes) return null
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': tipo,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch {
    return null
  }
}

export function MembeGoMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width="69" height="69" viewBox="0 0 512 512">
        <defs>
          <linearGradient id="l" x1="104" y1="148" x2="104" y2="424" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#6D28D9" />
          </linearGradient>
          <linearGradient id="r" x1="408" y1="148" x2="408" y2="424" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="100%" stopColor="#0D9488" />
          </linearGradient>
          <linearGradient id="v" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="50%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <path d="M104 148 L104 424" stroke="url(#l)" strokeWidth="88" strokeLinecap="round" fill="none" />
        <path d="M408 148 L408 424" stroke="url(#r)" strokeWidth="88" strokeLinecap="round" fill="none" />
        <path d="M104 148 L256 308 L408 148" stroke="url(#v)" strokeWidth="88" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span style={{ fontSize: 52, fontWeight: 800, color: '#FFFFFF', letterSpacing: -1.4 }}>
        {SITE_NAME}
      </span>
    </div>
  )
}

/** Tarjeta genérica de marca (entidad inexistente o enlace inválido). */
export function genericOgResponse(subtitulo = 'Conecta. Disfruta. Ahorra.') {
  return tarjetaOg(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #6D28D9 0%, #3B82F6 50%, #0D9488 100%)',
          color: 'white',
        }}
      >
        <span style={{ fontSize: 127, fontWeight: 800, letterSpacing: -2.9 }}>{SITE_NAME}</span>
        <span style={{ fontSize: 49, marginTop: 17, opacity: 0.92 }}>{subtitulo}</span>
      </div>
    )
  )
}

/** Chips superiores (marca + badge de categoría + empresa). */
function CardHeader({ badge, empresa }: { badge?: string | null; empresa?: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 23 }}>
        <MembeGoMark />
        {badge ? (
          <span
            style={{
              fontSize: 35,
              fontWeight: 700,
              color: '#FFFFFF',
              background: 'rgba(255,255,255,0.22)',
              padding: '8px 20px',
              borderRadius: 1443,
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      {empresa ? (
        <span
          style={{
            fontSize: 38,
            fontWeight: 600,
            color: '#FFFFFF',
            background: 'rgba(255,255,255,0.22)',
            padding: '10px 22px',
            borderRadius: 1443,
            maxWidth: 607,
            overflow: 'hidden',
          }}
        >
          {empresa}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Tarjeta de compartición de cualquier entidad. Si trae imagen oficial, es el
 * FONDO (con degradado para que el texto se lea); si no, diseño degradado con
 * los colores de la entidad.
 */
export async function shareCardResponse(data: ShareCardData) {
  const primary = data.colorPrimario || '#10b981'
  const secondary = data.colorSecundario || '#059669'
  const titulo = (data.titulo || '').slice(0, 90)
  const subtitulo = (data.subtitulo || '').slice(0, 90)
  const destacado = (data.destacado || '').slice(0, 80)
  const footer = (data.footer || '').slice(0, 90)

  const fondo = data.imagenUrl ? await fetchImageDataUrl(data.imagenUrl) : null

  if (fondo) {
    return tarjetaOg(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            position: 'relative',
            backgroundColor: '#0f172a',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fondo}
            alt=""
            width={OG_SIZE.width}
            height={OG_SIZE.height}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {/* Velo para que el texto se lea sobre cualquier arte. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              background:
                'linear-gradient(180deg, rgba(2,6,23,0.45) 0%, rgba(2,6,23,0.10) 45%, rgba(2,6,23,0.85) 100%)',
            }}
          />
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: 81,
              color: '#FFFFFF',
            }}
          >
            <CardHeader badge={data.badge} empresa={data.empresa} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 23 }}>
              {subtitulo ? (
                <span style={{ fontSize: 40, fontWeight: 600, opacity: 0.95 }}>{subtitulo}</span>
              ) : null}
              <span style={{ fontSize: 84, fontWeight: 800, letterSpacing: -2.2, lineHeight: 1.08 }}>
                {titulo}
              </span>
              {destacado ? (
                <span
                  style={{
                    display: 'flex',
                    alignSelf: 'flex-start',
                    fontSize: 46,
                    fontWeight: 700,
                    color: '#0f172a',
                    background: '#FFFFFF',
                    padding: '12px 28px',
                    borderRadius: 23,
                  }}
                >
                  {destacado}
                </span>
              ) : footer ? (
                <span style={{ fontSize: 40, fontWeight: 600, opacity: 0.95 }}>{footer}</span>
              ) : null}
            </div>
          </div>
        </div>
      )
    )
  }

  return tarjetaOg(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 92,
          background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
          color: '#FFFFFF',
        }}
      >
        <CardHeader badge={data.badge} empresa={data.empresa} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {subtitulo ? (
            <span style={{ fontSize: 43, fontWeight: 600, opacity: 0.95 }}>{subtitulo}</span>
          ) : null}
          <span style={{ fontSize: 98, fontWeight: 800, letterSpacing: -2.2, lineHeight: 1.05 }}>
            {titulo}
          </span>
          {destacado ? (
            <span
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                fontSize: 49,
                fontWeight: 700,
                color: primary,
                background: '#FFFFFF',
                padding: '14px 30px',
                borderRadius: 26,
                marginTop: 9,
              }}
            >
              {destacado}
            </span>
          ) : null}
        </div>

        {footer ? (
          <span style={{ fontSize: 43, fontWeight: 600, opacity: 0.95 }}>{footer}</span>
        ) : (
          <span style={{ fontSize: 43, fontWeight: 600, opacity: 0.95 }}>membego.com</span>
        )}
      </div>
    )
  )
}
