'use client'

import { useMemo } from 'react'
import { PartyPopper, Gift, Sparkles, Share2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { QRDisplay } from '@/components/qr/QRDisplay'

export interface CelebracionData {
  /** Descripción del regalo, p. ej. "Un lavado GRATIS". */
  regalo?: string | null
  /** Token del QR del regalo de bienvenida (si ya se entregó). */
  qrToken?: string | null
  /** Código de invitación propio para la cadena viral. */
  codigoInvitacion?: string | null
  empresaName?: string | null
  vigenciaDias?: number | null
  pendingVerification?: boolean
  colorPrimario?: string | null
  colorSecundario?: string | null
  /** Título de la campaña (para el texto de compartir). */
  titulo?: string | null
}

const CONFETTI_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444']

function generateConfettiPieces() {
  return Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 2.5,
    duration: 2.5 + Math.random() * 2,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    rotate: Math.random() * 360,
  }))
}

/** Lluvia de confeti en CSS puro (sin dependencias). */
function Confetti() {
  const pieces = useMemo(() => generateConfettiPieces(), [])
  return (
    <div className="pointer-events-none fixed inset-0 z-[110] overflow-hidden" aria-hidden>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.6; }
        }
      `}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.45,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Anuncio de felicitación tras el registro: modal POR ENCIMA de la pantalla
 * (estilo Temu), con confeti, el regalo recibido, su QR y el CTA para invitar
 * amigos. Compartido por la landing de invitación (invitado sin sesión) y por
 * el Home ya con sesión (aterrizaje tras el auto-login).
 */
export function CelebracionOverlay({
  data,
  mode,
  onClose,
}: {
  data: CelebracionData
  /** 'cerrar' = ya está dentro de la app; 'entrar' = aún sin sesión → login. */
  mode: 'cerrar' | 'entrar'
  onClose?: () => void
}) {
  const primary = data.colorPrimario || '#10b981'
  const secondary = data.colorSecundario || '#059669'
  const regalo = data.regalo || 'Un lavado GRATIS'

  const compartir = async () => {
    if (!data.codigoInvitacion) return
    // ?v con fecha del día: si WhatsApp cacheó una vista previa vieja de este
    // enlace, la variante diaria fuerza una tarjeta fresca sin romper la ruta.
    const v = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const url = `${window.location.origin}/invitar/${data.codigoInvitacion}?v=${v}`
    const text = `🎉 ¡A mí ya me regalaron: ${regalo}!\n\nAcabo de registrarme en MembeGo y tú también puedes recibir el tuyo GRATIS al crear tu cuenta.\n\nRegístrate aquí:`
    const copiar = async () => {
      await navigator.clipboard.writeText(`${text} ${url}`)
      toast.success('Enlace copiado. ¡Compártelo con tus amigos!')
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: data.titulo || 'MembeGo', text, url })
        return
      }
      await copiar()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      await copiar().catch(() => toast.error('No se pudo compartir.'))
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Fondo oscuro difuminado: el modal queda "por encima" de la app */}
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
      <Confetti />
      <style>{`
        @keyframes celebra-pop {
          0% { transform: scale(0.85) translateY(12px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
      <div
        className="relative z-[120] max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-6 text-center shadow-2xl"
        style={{ animation: 'celebra-pop 0.45s cubic-bezier(0.16,1,0.3,1)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto flex h-20 w-20 animate-bounce items-center justify-center rounded-full bg-emerald-100 shadow-lg">
          <PartyPopper className="h-10 w-10 text-emerald-600" />
        </div>
        <h1 className="mt-4 text-3xl font-extrabold text-foreground">🎉 ¡Felicidades!</h1>
        <p className="mt-1.5 text-muted-foreground">
          {data.pendingVerification
            ? 'Revisa tu correo y confirma tu cuenta para activar tu regalo.'
            : data.empresaName
              ? `Ya eres parte de ${data.empresaName}.`
              : '¡Bienvenido a MembeGo!'}
        </p>

        {/* Regalo destacado */}
        <div className="mt-5 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-5 shadow-sm">
          <Gift className="mx-auto mb-1.5 h-9 w-9 text-emerald-600" />
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Por tu registro recibiste
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{regalo}</p>
          {data.vigenciaDias ? (
            <p className="mt-1 text-xs text-muted-foreground">Vigencia: {data.vigenciaDias} días</p>
          ) : null}
        </div>

        {/* QR del regalo, inmediato */}
        {data.qrToken && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <QRDisplay token={data.qrToken} size={180} />
            <p className="text-xs text-muted-foreground">
              Presenta este código QR en el negocio para usar tu beneficio.
            </p>
          </div>
        )}

        {/* Invitar amigos: el momento de máxima emoción → cadena viral */}
        {data.codigoInvitacion && (
          <div className="mt-5 rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-5 shadow-sm">
            <Sparkles className="mx-auto mb-1.5 h-8 w-8 text-amber-500" />
            <h2 className="text-lg font-bold text-foreground">Invita a tus amigos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ellos también recibirán{' '}
              <span className="font-semibold text-foreground">{regalo}</span> al registrarse con tu
              enlace.
            </p>
            <Button
              onClick={compartir}
              className="mt-3 w-full py-6 text-lg font-bold text-white shadow-lg transition-transform hover:scale-[1.02]"
              style={{ backgroundColor: secondary }}
            >
              <Share2 className="mr-2 h-5 w-5" />
              Compartir mi enlace
            </Button>
          </div>
        )}

        {mode === 'cerrar' ? (
          <Button
            onClick={onClose}
            className="mt-4 w-full py-5 font-bold text-white"
            style={{ backgroundColor: primary }}
          >
            <Wallet className="mr-2 h-5 w-5" />
            Ver mi cuenta
          </Button>
        ) : (
          !data.pendingVerification && (
            <Button
              onClick={() => {
                window.location.href = '/login?next=/mis-membresias'
              }}
              variant="outline"
              className="mt-4 w-full py-5 font-semibold"
            >
              <Wallet className="mr-2 h-5 w-5" />
              Entrar a mi cuenta
            </Button>
          )
        )}
      </div>
    </div>
  )
}
