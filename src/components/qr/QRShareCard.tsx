'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toQrDataUrl } from '@/lib/qr'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Download, ShieldCheck, Clock, Check } from 'lucide-react'
import { toast } from 'sonner'
import { compartirQrToken } from '@/modules/cliente/qrActions'
import { NativeShareButton } from '@/components/wallet/NativeShareButton'

interface QRShareCardProps {
  qrTokenId: string
  token: string
  companyName: string
  /** Días que le quedan a la membresía. null = sin fecha de vencimiento. */
  diasRestantes: number | null
  esIlimitado: boolean
  lavadosRestantes: number
  /** Estado inicial del contador de compartidos (viene del servidor). */
  compartidoCount: number
  ultimoCompartidoISO: string | null
}

/** Texto explícito de vigencia para mostrar y para incrustar en la imagen. */
function vigenciaLabel(dias: number | null): { texto: string; urgente: boolean } {
  if (dias === null) return { texto: 'Sin vencimiento', urgente: false }
  if (dias < 0) return { texto: 'Membresía vencida', urgente: true }
  if (dias === 0) return { texto: 'Vence hoy', urgente: true }
  if (dias === 1) return { texto: 'Te queda 1 día', urgente: true }
  return { texto: `Te quedan ${dias} días`, urgente: dias <= 7 }
}

/**
 * Tarjeta del QR con opción de compartir (WhatsApp / compartir nativo).
 *
 * - El QR sigue siendo de un solo uso: compartir la imagen no crea un token
 *   nuevo; quien lo escanee primero lo consume y se regenera.
 * - Al compartir se registra en el historial (audit log) con la fecha.
 * - La imagen que se comparte lleva incrustados, de forma bien visible, los
 *   días que le quedan al cliente.
 */
export function QRShareCard({
  qrTokenId,
  token,
  companyName,
  diasRestantes,
  esIlimitado,
  lavadosRestantes,
  compartidoCount,
  ultimoCompartidoISO,
}: QRShareCardProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [count, setCount] = useState(compartidoCount)
  const [ultimo, setUltimo] = useState<string | null>(ultimoCompartidoISO)
  const shareFileRef = useRef<File | null>(null)

  const vigencia = vigenciaLabel(diasRestantes)
  const size = 240

  // QR simple para mostrar en pantalla.
  useEffect(() => {
    let active = true
    toQrDataUrl(token, size)
      .then((url) => {
        if (active) setDataUrl(url)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [token])

  /** Compone una imagen (QR + empresa + días restantes) lista para compartir. */
  const buildShareImage = useCallback(async (): Promise<Blob | null> => {
    try {
      const W = 640
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = 820
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // Fondo
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, canvas.height)

      // Empresa
      ctx.fillStyle = '#0f172a'
      ctx.textAlign = 'center'
      ctx.font = 'bold 40px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillText(companyName.slice(0, 26), W / 2, 90)

      ctx.fillStyle = '#64748b'
      ctx.font = '26px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillText('Membresía digital', W / 2, 132)

      // QR
      const qrSize = 420
      const qrUrl = await toQrDataUrl(token, qrSize)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = qrUrl
      })
      const qrX = (W - qrSize) / 2
      ctx.drawImage(img, qrX, 176, qrSize, qrSize)

      // Badge de días restantes (bien explícito)
      const badgeY = 176 + qrSize + 44
      ctx.fillStyle = vigencia.urgente ? '#b91c1c' : '#1d4ed8'
      ctx.font = 'bold 46px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillText(vigencia.texto, W / 2, badgeY)

      // Usos restantes
      ctx.fillStyle = '#334155'
      ctx.font = '28px system-ui, -apple-system, Segoe UI, sans-serif'
      const usos = esIlimitado
        ? 'Usos ilimitados'
        : `${lavadosRestantes} uso${lavadosRestantes !== 1 ? 's' : ''} restante${lavadosRestantes !== 1 ? 's' : ''}`
      ctx.fillText(usos, W / 2, badgeY + 46)

      // Pie
      ctx.fillStyle = '#94a3b8'
      ctx.font = '24px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillText('Preséntalo en el negocio para canjear · MembeGo', W / 2, badgeY + 96)

      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png', 0.95)
      )
    } catch {
      return null
    }
  }, [token, companyName, vigencia.texto, vigencia.urgente, esIlimitado, lavadosRestantes])

  /** Registra el envío en el historial y refresca los contadores locales. */
  const registrarCompartido = useCallback(async () => {
    const res = await compartirQrToken(qrTokenId)
    if (res.success) {
      setCount(res.compartidoCount ?? count + 1)
      setUltimo(res.compartidoEn ?? new Date().toISOString())
    } else if (res.error) {
      // No bloquea el compartir; solo avisa que no quedó registrado.
      toast.error(res.error)
    }
  }, [qrTokenId, count])

  /** Imagen lista para compartir, cacheada tras la primera generación. */
  const getShareFile = useCallback(async (): Promise<File | null> => {
    if (shareFileRef.current) return shareFileRef.current
    const blob = await buildShareImage()
    if (!blob) return null
    const file = new File([blob], 'mi-qr-membresia.png', { type: 'image/png' })
    shareFileRef.current = file
    return file
  }, [buildShareImage])

  const handleShared = useCallback(async () => {
    await registrarCompartido()
    toast.success('QR compartido. Quedó registrado en tu historial.')
  }, [registrarCompartido])

  const handleDownload = useCallback(async () => {
    const blob = await buildShareImage()
    if (!blob) {
      toast.error('No se pudo generar la imagen.')
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mi-qr-membresia.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    toast.success('QR descargado.')
  }, [buildShareImage])

  return (
    <div className="mb-8 flex flex-col items-center rounded-2xl border border-border/60 bg-card px-6 py-8 text-center shadow-sm">
      <h2 className="text-h2 text-foreground">Tu llave de acceso</h2>
      <p className="mt-1 max-w-sm text-small text-muted-foreground">
        Muéstralo en {companyName} y listo: tu membresía se valida al instante.
      </p>

      {/* Días restantes: bien explícito, encima del QR */}
      <div
        className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold ${
          vigencia.urgente
            ? 'bg-destructive/15 text-destructive'
            : 'bg-info/15 text-info'
        }`}
      >
        <Clock className="h-4 w-4" />
        {vigencia.texto}
      </div>

      {/* QR */}
      <div className="mt-5 rounded-[1.75rem] bg-gradient-to-br from-emerald-500 via-teal-400 to-emerald-600 p-[3px] shadow-premium-lg">
        <div
          className="flex items-center justify-center rounded-2xl bg-card p-4"
          style={{ width: size + 32, height: size + 32 }}
        >
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt="Código QR único de validación de membresía"
              role="img"
              aria-label="Código QR único de validación de membresía"
              width={size}
              height={size}
              className="animate-scale-in"
            />
          ) : (
            <div
              className="skeleton-shimmer rounded-xl"
              style={{ width: size, height: size }}
            />
          )}
        </div>
      </div>

      {/* Acciones: dos botones simétricos con targets táctiles ≥48px.
          Compartir usa la hoja nativa del sistema (WhatsApp, Telegram, fotos…)
          en vez de un botón verde acoplado a una sola app. */}
      <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-2">
        <NativeShareButton
          title={`QR de ${companyName}`}
          text={`Mi código de ${companyName} · ${vigencia.texto}. Preséntalo en el negocio para canjear.`}
          getFile={getShareFile}
          onShared={handleShared}
        >
          Compartir
        </NativeShareButton>
        <button
          onClick={handleDownload}
          className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-muted active:scale-[0.98]"
        >
          <Download className="h-4 w-4" aria-hidden />
          Descargar
        </button>
      </div>

      {/* Historial de envíos */}
      {count > 0 && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-caption text-success">
          <Check className="h-3.5 w-3.5" />
          Compartido {count} {count === 1 ? 'vez' : 'veces'}
          {ultimo && (
            <>
              {' · '}último envío el{' '}
              {format(new Date(ultimo), "d 'de' MMM, HH:mm", { locale: es })}
            </>
          )}
        </p>
      )}

      <p className="mt-3 inline-flex items-center gap-1.5 text-caption">
        <ShieldCheck className="h-3.5 w-3.5" />
        Por seguridad, cada código es de un solo uso: al canjearlo deja de ser válido.
      </p>
    </div>
  )
}
