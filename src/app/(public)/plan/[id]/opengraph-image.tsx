import { getPlanOg } from '@/modules/marketplace/cached'
import { OG_SIZE, tarjetaOg } from '@/lib/share/og'
import { SITE_NAME } from '@/lib/site'

// Fase E8 · Imagen dinámica de vista previa (Open Graph / Twitter Card) por
// plan de membresía. Estilo tarjeta de plan (encabezado de marca + precio).
export const runtime = 'nodejs'
export const revalidate = 3600
export const alt = 'Vista previa de plan de membresía en MembeGo'
// El tamaño lo manda `OG_SIZE`: tres literales iguales se separan al primer
// cambio, y entonces cada enlace se comparte con una resolución distinta.
export const size = OG_SIZE
export const contentType = 'image/png'

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

function MembeGoMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
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
      <span style={{ fontSize: 46, fontWeight: 800, color: 'white', letterSpacing: -1.4 }}>{SITE_NAME}</span>
    </div>
  )
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const og = await getPlanOg(id).catch(() => null)

  if (!og) {
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
          <span style={{ fontSize: 121, fontWeight: 800, letterSpacing: -2.9 }}>{SITE_NAME}</span>
          <span style={{ fontSize: 49, marginTop: 17, opacity: 0.92 }}>Planes de membresía con QR</span>
        </div>
      )
    )
  }

  const precio = og.precio > 0 ? fmtRD(og.precio) : 'Gratis'
  const incluye = og.esIlimitado
    ? 'Servicios ilimitados'
    : `${og.lavadosIncluidos} servicio${og.lavadosIncluidos !== 1 ? 's' : ''} incluido${og.lavadosIncluidos !== 1 ? 's' : ''}`

  return tarjetaOg(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 101,
          background: 'linear-gradient(135deg, #6D28D9 0%, #3B82F6 55%, #0D9488 100%)',
          color: 'white',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <MembeGoMark />
          <span
            style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.18)',
              padding: '10px 22px',
              borderRadius: 1443,
              fontSize: 38,
              fontWeight: 600,
            }}
          >
            {og.empresa}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 43, fontWeight: 600, opacity: 0.9 }}>Plan de membresía</span>
          <span style={{ fontSize: 104, fontWeight: 800, letterSpacing: -2.9, lineHeight: 1.05 }}>
            {og.nombre.slice(0, 60)}
          </span>
          <span style={{ fontSize: 58, fontWeight: 700, marginTop: 23 }}>{precio}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 35 }}>
          <span
            style={{
              display: 'flex',
              background: 'white',
              color: '#0F172A',
              fontSize: 40,
              fontWeight: 700,
              padding: '14px 30px',
              borderRadius: 1443,
            }}
          >
            {incluye}
          </span>
          <span style={{ fontSize: 40, fontWeight: 700, opacity: 0.95 }}>Elegir este plan →</span>
        </div>
      </div>
    )
  )
}
