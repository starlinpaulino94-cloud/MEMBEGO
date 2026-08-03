import { ImageResponse } from 'next/og'
import { getPromotionOg } from '@/modules/marketplace/cached'
import { originalImageResponse } from '@/lib/share/og'
import { SITE_NAME } from '@/lib/site'

// Fase E8 · Imagen dinámica de vista previa (Open Graph / Twitter Card) por
// promoción. Se sirve como <ruta>/opengraph-image y Next la referencia sola
// desde la metadata de page.tsx. Estilo tarjeta tipo marketplace (Temu/ML).
export const runtime = 'nodejs'
export const revalidate = 3600
export const alt = 'Vista previa de promoción en MembeGo'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Marca MembeGo (esquina de la tarjeta): logotipo + wordmark.
function MembeGoMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width="44" height="44" viewBox="0 0 512 512">
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
      <span style={{ fontSize: 34, fontWeight: 800, color: '#0F172A', letterSpacing: -1 }}>
        {SITE_NAME}
      </span>
    </div>
  )
}

export default async function Image({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params
  const og = await getPromotionOg(clave).catch(() => null)

  // Con imagen oficial se entrega la imagen ORIGINAL ENTERA (sin recortes ni
  // composición, como Temu) hasta 4 MB. La tarjeta compuesta queda solo para
  // promociones sin imagen o con imagen inservible.
  if (og?.imagenUrl) {
    const original = await originalImageResponse(og.imagenUrl, 4000, 4_000_000)
    if (original) return original
  }

  // Fallback: promoción no pública o inexistente → tarjeta de marca genérica.
  if (!og) {
    return new ImageResponse(
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
          <span style={{ fontSize: 84, fontWeight: 800, letterSpacing: -2 }}>{SITE_NAME}</span>
          <span style={{ fontSize: 34, marginTop: 12, opacity: 0.92 }}>
            Beneficios digitales con validación por QR
          </span>
        </div>
      ),
      size
    )
  }

  const descuento = og.descuento && og.descuento > 0 ? `-${og.descuento}%` : null
  const descripcion = (og.descripcion || '').slice(0, 140)

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#FFFFFF' }}>
        {/* Panel de imagen (izquierda) */}
        <div
          style={{
            width: 470,
            height: '100%',
            display: 'flex',
            background: '#EEF2F7',
            position: 'relative',
          }}
        >
          {og.imagenUrl ? (
            <img
              src={og.imagenUrl}
              alt=""
              width={470}
              height={630}
              style={{ width: 470, height: 630, objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #6D28D9 0%, #3B82F6 50%, #0D9488 100%)',
              }}
            >
              <span style={{ fontSize: 120 }}>🎁</span>
            </div>
          )}
          {descuento && (
            <div
              style={{
                position: 'absolute',
                top: 34,
                left: 34,
                display: 'flex',
                background: '#DC2626',
                color: 'white',
                fontSize: 46,
                fontWeight: 800,
                padding: '12px 26px',
                borderRadius: 18,
              }}
            >
              {descuento}
            </div>
          )}
        </div>

        {/* Panel de contenido (derecha) */}
        <div
          style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: 60,
          }}
        >
          <MembeGoMark />

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 30, fontWeight: 600, color: '#6D28D9', marginBottom: 14 }}>
              {og.empresa}
            </span>
            <span
              style={{
                fontSize: 60,
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.05,
                letterSpacing: -1.5,
              }}
            >
              {og.titulo.slice(0, 80)}
            </span>
            {descripcion && (
              <span style={{ fontSize: 30, color: '#475569', marginTop: 22, lineHeight: 1.35 }}>
                {descripcion}
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              background: 'linear-gradient(90deg, #6D28D9, #0D9488)',
              color: 'white',
              fontSize: 30,
              fontWeight: 700,
              padding: '16px 34px',
              borderRadius: 999,
            }}
          >
            Adquirir promoción →
          </div>
        </div>
      </div>
    ),
    size
  )
}
