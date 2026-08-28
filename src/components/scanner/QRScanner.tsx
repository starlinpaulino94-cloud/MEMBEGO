'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Flashlight, FlashlightOff, ScanBarcode, RefreshCw, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type CameraError = 'permission-denied' | 'no-camera' | 'in-use' | 'insecure' | 'unknown'

const CAMERA_ERROR_CONFIG: Record<CameraError, { icon: typeof Camera; title: string; help: string }> = {
  'permission-denied': {
    icon: CameraOff,
    title: 'Permiso de cámara denegado',
    help: 'Activa el permiso de cámara para este sitio en la configuración de tu navegador (icono del candado junto a la dirección) y vuelve a intentar.',
  },
  'no-camera': {
    icon: CameraOff,
    title: 'No se encontró una cámara',
    help: 'Este dispositivo no tiene cámara disponible. Usa la entrada manual del código.',
  },
  'in-use': {
    icon: CameraOff,
    title: 'La cámara está ocupada',
    help: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentar.',
  },
  insecure: {
    icon: ShieldAlert,
    title: 'Conexión no segura',
    help: 'El escáner requiere una conexión HTTPS. Abre la app desde la dirección segura.',
  },
  unknown: {
    icon: CameraOff,
    title: 'No se pudo iniciar la cámara',
    help: 'Ocurrió un error al acceder a la cámara. Reintenta o usa la entrada manual.',
  },
}

function classifyCameraError(err: unknown): CameraError {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure'
  const name = (err as { name?: string })?.name ?? ''
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase()
  if (name === 'NotAllowedError' || msg.includes('permission') || msg.includes('denied')) {
    return 'permission-denied'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || msg.includes('no camera') || msg.includes('not found')) {
    return 'no-camera'
  }
  if (name === 'NotReadableError' || msg.includes('in use') || msg.includes('busy')) {
    return 'in-use'
  }
  return 'unknown'
}

interface TorchCapable {
  getRunningTrackCameraCapabilities?: () => {
    torchFeature: () => {
      isSupported: () => boolean
      apply: (on: boolean) => Promise<void>
      value: () => boolean
    }
  }
}

/**
 * Escáner QR sobre html5-qrcode con la capa física que exige el mostrador:
 * estados explícitos de error de cámara (permiso denegado, sin cámara, ocupada,
 * HTTPS) con instrucciones y recuperación, linterna (si el dispositivo la
 * soporta), vibración + flash verde al leer, y overlay propio de escaneo
 * (esquinas + línea de barrido).
 */
export function QRScanner({
  onScan,
  onUseReader,
}: {
  onScan: (text: string) => void
  /** Abre la entrada manual (CTA de los estados de error de cámara). */
  /** Fase E7: pasar a modo lector físico desde la vista de cámara. */
  onUseReader?: () => void
}) {
  const containerId = 'qr-reader'
  const handledRef = useRef(false)
  const scannerRef = useRef<TorchCapable | null>(null)
  const [cameraError, setCameraError] = useState<CameraError | null>(null)
  const [ready, setReady] = useState(false)
  const [flash, setFlash] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null

    async function start() {
      try {
        if (typeof window !== 'undefined' && !window.isSecureContext) {
          throw new DOMException('insecure context', 'SecurityError')
        }
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return
        const s = new Html5Qrcode(containerId)
        scanner = s as unknown as { stop: () => Promise<void>; clear: () => void }
        scannerRef.current = s as unknown as TorchCapable

        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (decoded) => {
            if (handledRef.current) return
            handledRef.current = true
            // Feedback físico: vibración + flash verde para que el empleado
            // sepa que "lo agarró" sin mirar el estado de la pantalla.
            try {
              navigator.vibrate?.(80)
            } catch {}
            setFlash(true)
            setTimeout(() => onScan(decoded), 180)
          },
          () => {}
        )

        if (cancelled) return
        setReady(true)

        // Linterna: solo si el track de la cámara la soporta.
        try {
          const caps = (s as unknown as TorchCapable).getRunningTrackCameraCapabilities?.()
          if (caps?.torchFeature().isSupported()) setTorchSupported(true)
        } catch {}
      } catch (err) {
        if (!cancelled) setCameraError(classifyCameraError(err))
      }
    }

    const starting = start()

    return () => {
      cancelled = true
      // Esperar a que el arranque termine antes de detener: si se desmonta
      // durante los 0.5-2 s que tarda start(), un stop() inmediato falla
      // ("not running") y el MediaStream que start() adquiere después
      // quedaba encendido (cámara ocupada + memoria en el móvil).
      starting.finally(() => {
        const s = scanner
        scanner = null
        scannerRef.current = null
        if (s) {
          s.stop().then(() => { try { s.clear() } catch {} }).catch(() => {})
        }
      })
    }
  }, [onScan, attempt])

  const toggleTorch = useCallback(async () => {
    try {
      const feature = scannerRef.current?.getRunningTrackCameraCapabilities?.()?.torchFeature()
      if (!feature?.isSupported()) return
      const next = !torchOn
      await feature.apply(next)
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }, [torchOn])

  if (cameraError) {
    const cfg = CAMERA_ERROR_CONFIG[cameraError]
    const Icon = cfg.icon
    return (
      <div className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
          <Icon className="h-7 w-7 text-warning" />
        </div>
        <div>
          <p className="font-semibold text-white">{cfg.title}</p>
          <p className="mt-1.5 text-sm text-white/70">{cfg.help}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {cameraError !== 'no-camera' && cameraError !== 'insecure' && (
            <Button
              variant="outline"
              className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() => {
                handledRef.current = false
                setCameraError(null)
                setReady(false)
                setTorchSupported(false)
                setTorchOn(false)
                setAttempt((a) => a + 1)
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </Button>
          )}
          {onUseReader && (
            <Button
              variant="outline"
              className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={onUseReader}
            >
              <ScanBarcode className="h-4 w-4" />
              Usar lector físico
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-black">
        <div id={containerId} className="w-full [&_video]:!rounded-2xl" />

        {/* Overlay de guía: esquinas + línea de barrido (solo con cámara activa) */}
        {ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[230px] w-[230px]">
              <span className="absolute left-0 top-0 h-7 w-7 rounded-tl-lg border-l-4 border-t-4 border-white/90" />
              <span className="absolute right-0 top-0 h-7 w-7 rounded-tr-lg border-r-4 border-t-4 border-white/90" />
              <span className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-lg border-b-4 border-l-4 border-white/90" />
              <span className="absolute bottom-0 right-0 h-7 w-7 rounded-br-lg border-b-4 border-r-4 border-white/90" />
              <span className="scanner-line absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary shadow-glow" />
            </div>
          </div>
        )}

        {/* Flash verde al decodificar */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-2xl bg-success/35 ring-4 ring-success transition-opacity duration-fast',
            flash ? 'opacity-100' : 'opacity-0'
          )}
        />

        {/* Linterna */}
        {torchSupported && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
            aria-pressed={torchOn}
            className={cn(
              'absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition',
              torchOn
                ? 'bg-warning text-warning-foreground'
                : 'bg-white/15 text-white hover:bg-white/25'
            )}
          >
            {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
          </button>
        )}
      </div>
      <p className="mt-3 text-center text-caption text-white/60">
        Centra el código QR dentro del recuadro
      </p>
    </div>
  )
}
