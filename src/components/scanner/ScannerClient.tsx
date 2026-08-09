'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import dynamic from 'next/dynamic'
import {
  Loader2,
  ScanLine,
  ScanBarcode,
  Camera,
  XCircle,
  AlertTriangle,
  ShieldX,
  Ban,
  Clock,
  ServerCrash,
  RefreshCw,
  QrCode,
  Building2,
  CheckCircle2,
  Wifi,
  Usb,
  Bluetooth,
} from 'lucide-react'
import { toast } from 'sonner'
import { buscarPorToken, type ClienteLookup, type LookupResult, type PromoCompraLookup } from '@/modules/visitas/actions'
import type { TransaccionScanInfo } from '@/modules/transacciones/actions'
import { guardarEscanerModoEmpresa } from '@/modules/scanner/actions'
import { ConfirmVisit } from '@/components/scanner/ConfirmVisit'
import { ConfirmPromo } from '@/components/scanner/ConfirmPromo'
import { TransaccionRecord } from '@/components/scanner/TransaccionRecord'
import { ScannerErrorBoundary } from '@/components/scanner/ScannerErrorBoundary'
import { useHidScanner } from '@/components/scanner/useHidScanner'
import { useColaOffline } from '@/components/scanner/useColaOffline'
import { IndicadorCola } from '@/components/scanner/IndicadorCola'
import { aFormData, type Pendiente } from '@/modules/scanner/colaOffline'
import { confirmarVisita } from '@/modules/visitas/actions'
import { confirmarCanjePromocion } from '@/modules/promociones/canjeActions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const QRScanner = dynamic(
  () => import('@/components/scanner/QRScanner').then((m) => m.QRScanner),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto flex h-56 w-full max-w-sm items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    ),
  }
)

interface Sucursal {
  id: string
  nombre: string
}

type Modo = 'camara' | 'lector'
type ErrorCode = NonNullable<LookupResult['errorCode']>

const STORAGE_KEY = 'membego.scanner.modo'

const emptySubscribe = () => () => {}

function leerModoGuardado(): Modo | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'camara' || v === 'lector' ? v : null
  } catch {
    return null
  }
}

// Tono del error sobre tokens semánticos (dark-safe): el contenido de cada
// código (título + qué hacer) viene del diagnóstico del servidor.
const TONE = {
  destructive: {
    box: 'border-destructive/25 bg-destructive/10',
    icon: 'text-destructive',
    title: 'text-destructive',
  },
  warning: {
    box: 'border-warning/30 bg-warning/10',
    icon: 'text-warning-foreground',
    title: 'text-warning-foreground',
  },
  muted: {
    box: 'border-border bg-muted/50',
    icon: 'text-muted-foreground',
    title: 'text-foreground',
  },
} as const

const ERROR_CONFIG: Record<ErrorCode, { icon: typeof XCircle; title: string; tone: keyof typeof TONE; action: string }> = {
  QR_NOT_FOUND: {
    icon: QrCode,
    title: 'Código QR no encontrado',
    tone: 'destructive',
    action: 'Verifica que el código sea correcto o pide al cliente un QR actualizado.',
  },
  QR_INACTIVE: {
    icon: Ban,
    title: 'Código QR ya utilizado',
    tone: 'warning',
    action: 'Este QR es de un solo uso y ya fue canjeado. Pide al cliente que muestre el código vigente en su app; si no le aparece, ya no tiene usos disponibles.',
  },
  WRONG_COMPANY: {
    icon: Building2,
    title: 'Cliente de otra empresa',
    tone: 'warning',
    action: 'Este cliente pertenece a otra empresa. Verifica que esté en el lugar correcto.',
  },
  NO_MEMBERSHIP: {
    icon: ShieldX,
    title: 'Sin membresía registrada',
    tone: 'muted',
    action: 'El cliente no tiene ninguna membresía. Puede registrarse desde la app.',
  },
  MEMBERSHIP_INACTIVE: {
    icon: AlertTriangle,
    title: 'Membresía no activa',
    tone: 'warning',
    action: 'La membresía está pendiente, cancelada o rechazada. El cliente debe contactar soporte.',
  },
  MEMBERSHIP_EXPIRED: {
    icon: Clock,
    title: 'Membresía vencida',
    tone: 'destructive',
    action: 'La membresía ha expirado. El cliente debe renovar desde la app.',
  },
  NO_USES_LEFT: {
    icon: Ban,
    title: 'Sin usos disponibles',
    tone: 'warning',
    action: 'Se agotaron los usos del período actual. El cliente puede actualizar su plan.',
  },
  RATE_LIMITED: {
    icon: Clock,
    title: 'Demasiadas búsquedas',
    tone: 'warning',
    action: 'Espera unos segundos antes de intentar de nuevo.',
  },
  UNAUTHORIZED: {
    icon: ShieldX,
    title: 'Acceso no autorizado',
    tone: 'destructive',
    action: 'No tienes permisos para escanear. Contacta al administrador.',
  },
  INTERNAL: {
    icon: ServerCrash,
    title: 'Error del servidor',
    tone: 'destructive',
    action: 'Ocurrió un error interno. Intenta de nuevo en unos segundos.',
  },
}

function ErrorScreen({
  errorCode,
  errorMessage,
  onScanNext,
  onClose,
}: {
  errorCode: ErrorCode | null
  errorMessage: string
  onScanNext: () => void
  onClose: () => void
}) {
  const config = errorCode ? ERROR_CONFIG[errorCode] : ERROR_CONFIG.INTERNAL
  const tone = TONE[config.tone]
  const Icon = config.icon

  return (
    <div className={`animate-scale-in space-y-4 rounded-2xl border p-6 text-center ${tone.box}`}>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-card shadow-premium">
        <Icon className={`h-7 w-7 ${tone.icon}`} />
      </div>
      <div>
        <h3 className={`text-h2 ${tone.title}`}>{config.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
      </div>
      <p className="text-sm text-foreground/80">{config.action}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={onScanNext} size="lg" className="gap-2">
          <ScanLine className="h-4 w-4" />
          Escanear siguiente
        </Button>
        <Button onClick={onClose} variant="outline" size="lg" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Volver al inicio
        </Button>
      </div>
    </div>
  )
}

export function ScannerClient({
  sucursales = [],
  modoDefault = 'camara',
  puedeConfigurar = false,
}: {
  sucursales?: Sucursal[]
  /** Modo predeterminado de la empresa (Fase E7). */
  modoDefault?: Modo
  /** El usuario (admin) puede fijar el predeterminado de la empresa. */
  puedeConfigurar?: boolean
}) {
  // Preferencia por usuario (persistida) sobre el predeterminado de la empresa.
  // Patrón "mounted" para no romper la hidratación ni llamar setState en efecto:
  // el servidor y el 1er render usan modoDefault; tras montar, aplica localStorage.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [override, setOverride] = useState<Modo | null>(null)
  const guardado = mounted ? leerModoGuardado() : null
  const modo: Modo = override ?? guardado ?? modoDefault

  const [scanning, setScanning] = useState(false)
  const [cliente, setCliente] = useState<ClienteLookup | null>(null)
  const [promoCompra, setPromoCompra] = useState<PromoCompraLookup | null>(null)
  const [txRecord, setTxRecord] = useState<{ info: TransaccionScanInfo; esQrUsado: boolean } | null>(null)
  const [errorState, setErrorState] = useState<{ message: string; code: ErrorCode | null } | null>(null)
  const [lectorDetectado, setLectorDetectado] = useState(false)
  const [pending, startTransition] = useTransition()
  const guardadoRef = useRef(false)

  const cambiarModo = useCallback((m: Modo) => {
    setOverride(m)
    setScanning(false)
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* ignore */ }
  }, [])

  const hayResultado = !!(cliente || promoCompra || txRecord)

  const lookup = useCallback((token: string) => {
    const clean = token.trim()
    if (!clean) return
    setErrorState(null)
    setScanning(false)
    startTransition(async () => {
      try {
        const res = await buscarPorToken(clean)
        if (res.transaccion) {
          setTxRecord({ info: res.transaccion, esQrUsado: res.errorCode === 'QR_INACTIVE' })
        } else if (res.promoCompra) {
          setPromoCompra(res.promoCompra)
        } else if (res.error) {
          setErrorState({ message: res.error, code: res.errorCode ?? null })
        } else if (res.cliente) {
          setCliente(res.cliente)
        } else {
          setErrorState({ message: 'Respuesta vacía del servidor.', code: 'INTERNAL' })
        }
      } catch (err) {
        console.error('[scanner] lookup error:', err)
        setErrorState({
          message: 'No se pudo conectar con el servidor. Verifica tu conexión a internet.',
          code: 'INTERNAL',
        })
      }
    })
  }, [startTransition])

  // Lector físico HID: mismo flujo que la cámara (buscarPorToken → …).
  // La captura global procesa la ráfaga en CUALQUIER estado, así una sola
  // lectura basta: en modo cámara cambia solo a lector; con un resultado en
  // pantalla pasa directo al siguiente cliente (escaneo continuo).
  const onReaderScan = useCallback(
    (token: string, fromReader: boolean) => {
      // En cámara o sobre un resultado solo actúa una ráfaga inequívoca de
      // lector físico (cadencia), nunca tecleo humano suelto.
      if ((modo === 'camara' || hayResultado) && !fromReader) return
      if (modo === 'camara') cambiarModo('lector')
      if (hayResultado) {
        setCliente(null)
        setPromoCompra(null)
        setTxRecord(null)
      }
      if (fromReader && !lectorDetectado) {
        setLectorDetectado(true)
        toast.success('Lector físico detectado')
      }
      lookup(token)
    },
    [modo, hayResultado, cambiarModo, lookup, lectorDetectado]
  )

  const reader = useHidScanner({
    focusActive: modo === 'lector' && !hayResultado,
    disabled: pending,
    onScan: onReaderScan,
  })

  function reset() {
    setCliente(null)
    setPromoCompra(null)
    setTxRecord(null)
    setErrorState(null)
    setScanning(false)
  }

  const scanNext = useCallback(() => {
    setCliente(null)
    setPromoCompra(null)
    setTxRecord(null)
    setErrorState(null)
    // En cámara volvemos directo a la cámara; en lector, el foco se recupera solo.
    setScanning((prev) => (modo === 'camara' ? true : prev))
  }, [modo])

  // Atajos de accesibilidad: Alt+C → cámara, Alt+L → lector.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const k = e.key.toLowerCase()
      if (k === 'c') { e.preventDefault(); cambiarModo('camara') }
      else if (k === 'l') { e.preventDefault(); cambiarModo('lector') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cambiarModo])

  async function fijarPredeterminado() {
    if (guardadoRef.current) return
    guardadoRef.current = true
    const res = await guardarEscanerModoEmpresa(modo)
    if (res.error) { toast.error(res.error); guardadoRef.current = false }
    else toast.success('Predeterminado de la empresa actualizado.')
  }

  /**
   * COLA SIN CONEXIÓN (Fase 7 · punto 28).
   *
   * Vive aquí, en el componente que está montado durante toda la sesión del
   * escáner, y no dentro de ConfirmVisit/ConfirmPromo: esos se desmontan en
   * cuanto el empleado pasa al siguiente coche, y con ellos se iría el bucle
   * de reenvío. Además, dos instancias del hook escribirían sobre el mismo
   * `localStorage` y se pisarían.
   */
  const cola = useColaOffline(
    useCallback(async (p: Pendiente) => {
      const fd = aFormData(p)
      return p.tipo === 'canje'
        ? confirmarCanjePromocion({}, fd)
        : confirmarVisita({}, fd)
    }, [])
  )

  // ── Pantallas de resultado (mismas que antes) ───────────────────────────────
  if (txRecord) {
    return (
      <ScannerErrorBoundary onReset={reset}>
        <Card className="border-border/60 shadow-card-hover animate-scale-in">
          <CardContent className="p-6">
            <TransaccionRecord transaccion={txRecord.info} esQrUsado={txRecord.esQrUsado} onScanNext={scanNext} onClose={reset} />
          </CardContent>
        </Card>
      </ScannerErrorBoundary>
    )
  }
  if (promoCompra) {
    return (
      <ScannerErrorBoundary onReset={reset}>
        <Card className="border-border/60 shadow-card-hover animate-scale-in">
          <CardContent className="space-y-4 p-6">
            <IndicadorCola cola={cola} />
            <ConfirmPromo compra={promoCompra} sucursales={sucursales} onDone={reset} onScanNext={scanNext} />
          </CardContent>
        </Card>
      </ScannerErrorBoundary>
    )
  }
  if (cliente) {
    return (
      <ScannerErrorBoundary onReset={reset}>
        <Card className="border-border/60 shadow-card-hover animate-scale-in">
          <CardContent className="space-y-4 p-6">
            <IndicadorCola cola={cola} />
            <ConfirmVisit cliente={cliente} sucursales={sucursales} onDone={reset} onScanNext={scanNext} encolar={cola.encolar} />
          </CardContent>
        </Card>
      </ScannerErrorBoundary>
    )
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <IndicadorCola cola={cola} />

      {errorState && (
        <ErrorScreen errorCode={errorState.code} errorMessage={errorState.message} onScanNext={scanNext} onClose={reset} />
      )}

      {/* Selector de modo: Cámara | Lector físico (cambia sin recargar) */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-border/60 bg-muted/40 p-1" role="tablist" aria-label="Modo de escaneo">
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'camara'}
            onClick={() => cambiarModo('camara')}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              modo === 'camara' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Camera className="h-4 w-4" /> Cámara
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'lector'}
            onClick={() => cambiarModo('lector')}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              modo === 'lector' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ScanBarcode className="h-4 w-4" /> Lector físico
          </button>
        </div>
        <span className="hidden text-caption text-muted-foreground sm:inline">
          Atajos: <kbd className="rounded bg-muted px-1">Alt</kbd>+<kbd className="rounded bg-muted px-1">C</kbd> / <kbd className="rounded bg-muted px-1">Alt</kbd>+<kbd className="rounded bg-muted px-1">L</kbd>
        </span>
      </div>

      {modo === 'camara' ? (
        /* ── Cámara ── */
        <Card className="overflow-hidden rounded-3xl border-border/60 py-0 shadow-premium">
          <div className="relative bg-gradient-to-b from-slate-950 via-blue-950 to-slate-900 p-7 text-center sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-40" />
            <div className="pointer-events-none absolute left-1/2 top-0 h-32 w-64 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative">
              {pending ? (
                <div className="space-y-4 py-3">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-white">Validando…</h2>
                    <p className="mt-1 text-sm text-white/60">Consultando la membresía y sus beneficios</p>
                  </div>
                </div>
              ) : (
                <>
                  {!scanning && (
                    <>
                      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                        <ScanLine className="h-7 w-7 text-primary" />
                      </span>
                      <h2 className="text-xl font-bold tracking-tight text-white">Escanear QR</h2>
                      <p className="mt-1 text-sm text-white/60">Apunta la cámara al código QR del cliente</p>
                    </>
                  )}
                  {scanning ? (
                    <div className="space-y-4">
                      <QRScanner onScan={lookup} onUseReader={() => cambiarModo('lector')} />
                      <Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => setScanning(false)}>
                        Detener cámara
                      </Button>
                    </div>
                  ) : (
                    <Button className="mt-6 w-full font-semibold shadow-glow sm:w-auto sm:px-10" onClick={() => setScanning(true)} size="xl">
                      Abrir cámara
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      ) : (
        /* ── Lector físico HID ── */
        <ReaderPanel
          status={pending ? 'validando' : reader.status}
          inputRef={reader.inputRef}
          onBlur={reader.handleBlur}
          onFocusArea={reader.focusCapture}
          lectorDetectado={lectorDetectado}
        />
      )}

      {puedeConfigurar && (
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={fijarPredeterminado}
            className="text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Hacer de «{modo === 'camara' ? 'Cámara' : 'Lector físico'}» el predeterminado de la empresa
          </button>
        </div>
      )}
    </div>
  )
}

/** Panel del lector físico con estados animados. */
function ReaderPanel({
  status,
  inputRef,
  onBlur,
  onFocusArea,
  lectorDetectado,
}: {
  status: 'ready' | 'listening' | 'received' | 'validando'
  inputRef: React.RefObject<HTMLInputElement | null>
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void
  onFocusArea: () => void
  lectorDetectado: boolean
}) {
  const UI: Record<typeof status, { titulo: string; sub: string; icon: typeof ScanBarcode; tono: string; anim: string }> = {
    ready: { titulo: 'Lector listo', sub: 'Esperando escaneo…', icon: ScanBarcode, tono: 'text-primary', anim: 'animate-pulse' },
    listening: { titulo: 'Recibiendo código…', sub: 'No sueltes el código del lector', icon: ScanLine, tono: 'text-primary', anim: '' },
    received: { titulo: 'Código recibido', sub: 'Procesando…', icon: CheckCircle2, tono: 'text-success', anim: '' },
    validando: { titulo: 'Validando…', sub: 'Consultando la membresía y sus beneficios', icon: Loader2, tono: 'text-primary', anim: 'animate-spin' },
  }
  const s = UI[status]
  const Icon = s.icon

  return (
    <Card className="overflow-hidden rounded-3xl border-border/60 py-0 shadow-premium">
      <div
        className="relative cursor-text bg-gradient-to-b from-slate-950 via-blue-950 to-slate-900 p-8 text-center"
        onClick={onFocusArea}
      >
        <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-40" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-32 w-64 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

        {/* Campo OCULTO: solo aparca el foco (la captura real es global, en
            window — así una lectura funciona aunque el foco ande en otro lado). */}
        <input
          ref={inputRef}
          type="text"
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Captura del lector físico"
          onBlur={onBlur}
          className="sr-only"
        />

        <div className="relative space-y-4">
          <span className={cn('mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur')}>
            <Icon className={cn('h-8 w-8', s.tono, s.anim)} />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">{s.titulo}</h2>
            <p className="mt-1 text-sm text-white/60">{s.sub}</p>
          </div>

          {/* Indicador de compatibilidad */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-caption text-white/50">
            <span className="inline-flex items-center gap-1"><Usb className="h-3.5 w-3.5" /> USB</span>
            <span className="inline-flex items-center gap-1"><Bluetooth className="h-3.5 w-3.5" /> Bluetooth</span>
            <span className="inline-flex items-center gap-1"><Wifi className="h-3.5 w-3.5" /> Inalámbrico</span>
          </div>
          {lectorDetectado && (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-caption font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Lector físico detectado
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border/60 bg-muted/30 px-6 py-3 text-center text-caption text-muted-foreground">
        Conecta tu lector QR / código de barras (USB o Bluetooth) y escanea:
        el código se procesa automáticamente, sin tocar la pantalla.
      </div>
    </Card>
  )
}
