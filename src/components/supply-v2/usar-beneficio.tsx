'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toQrDataUrl } from '@/lib/qr'
import { usarBeneficioAction, type QrParaMostrar } from '@/modules/supply-v2/actions-canje'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY 2.0 · «Usar beneficio» (§11–§13).
 *
 * El QR se genera SOLO al pulsar el botón (nunca al abrir la página) y solo
 * contiene el nonce temporal. La cuenta atrás usa el vencimiento que dio el
 * servidor. Al expirar: «Generar nuevo QR», mismo derecho, mismo voucher.
 * Mientras el QR está en pantalla la página se refresca sola cada pocos
 * segundos para que «Utilizado» aparezca en cuanto el comercio entregue.
 */
export function UsarBeneficio({
  entitlementId,
  proveedor,
  sesionInicial,
}: {
  entitlementId: string
  proveedor: string
  sesionInicial: { id: string; nonce: string; expiresAt: Date } | null
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<QrParaMostrar>, FormData>(usarBeneficioAction, {})
  const [sesion, setSesion] = useState<{ id: string; nonce: string; expiresAt: Date } | null>(sesionInicial)
  const [abierto, setAbierto] = useState(Boolean(sesionInicial))
  const vista = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (estado.data && vista.current !== estado.data.id) {
      vista.current = estado.data.id
      setSesion({ id: estado.data.id, nonce: estado.data.nonce, expiresAt: new Date(estado.data.expiresAt) })
      setAbierto(true)
    }
  }, [estado.data])

  if (!abierto || !sesion) {
    return (
      <form action={enviar} className="flex flex-col items-start gap-1">
        <input type="hidden" name="entitlementId" value={entitlementId} />
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-usar-beneficio">
          Usar beneficio
        </Button>
        {estado.error && <p className="text-caption text-destructive" role="alert" data-testid="usar-beneficio-error">{estado.error}</p>}
      </form>
    )
  }

  return <QrTemporal key={sesion.id} sesion={sesion} proveedor={proveedor} entitlementId={entitlementId} onCerrar={() => setAbierto(false)} onRenovar={enviar} renovando={pendiente} />
}

function QrTemporal({
  sesion,
  proveedor,
  entitlementId,
  onCerrar,
  onRenovar,
  renovando,
}: {
  sesion: { id: string; nonce: string; expiresAt: Date }
  proveedor: string
  entitlementId: string
  onCerrar: () => void
  onRenovar: (fd: FormData) => void
  renovando: boolean
}) {
  const router = useRouter()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [restante, setRestante] = useState(() => Math.max(0, sesion.expiresAt.getTime() - Date.now()))

  useEffect(() => {
    let activo = true
    toQrDataUrl(sesion.nonce, 220)
      .then((u) => {
        if (activo) setDataUrl(u)
      })
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [sesion.nonce])

  useEffect(() => {
    const t = setInterval(() => setRestante(Math.max(0, sesion.expiresAt.getTime() - Date.now())), 1000)
    return () => clearInterval(t)
  }, [sesion.expiresAt])

  // Mientras el QR está en pantalla, refrescar para ver «Utilizado» al entregar.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(t)
  }, [router])

  const expirado = restante <= 0
  const m = Math.floor(restante / 60_000)
  const s = Math.floor((restante % 60_000) / 1000)

  return (
    <div className="w-full rounded-xl border border-border bg-card p-4 text-center" data-testid="qr-beneficio">
      <p className="text-sm font-medium">Presenta este código en {proveedor}</p>
      <div className="mx-auto my-3 flex w-fit items-center justify-center rounded-2xl bg-card p-3 shadow-sm">
        {dataUrl && !expirado ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Código QR temporal de tu beneficio" width={220} height={220} data-testid="qr-imagen" />
        ) : (
          <div className="flex size-[220px] items-center justify-center text-sm text-muted-foreground">{expirado ? 'Código expirado' : 'Generando…'}</div>
        )}
      </div>
      {expirado ? (
        <form
          action={(fd) => {
            fd.set('entitlementId', entitlementId)
            onRenovar(fd)
          }}
          className="space-y-2"
        >
          <p className="text-sm text-destructive" data-testid="qr-expirado">Este código expiró.</p>
          <Button type="submit" size="sm" disabled={renovando} loading={renovando} data-testid="btn-nuevo-qr">
            Generar nuevo QR
          </Button>
        </form>
      ) : (
        <>
          <p className="text-sm">
            Expira en <span className="font-mono tabular-nums" data-testid="qr-cuenta-atras">{m}:{String(s).padStart(2, '0')}</span>
          </p>
          <p className="mt-1 text-caption text-muted-foreground">Si la cámara falla, dicta este código:</p>
          <p className="mx-auto mt-1 max-w-full break-all font-mono text-caption" data-testid="qr-codigo">{sesion.nonce}</p>
          <p className="mt-2 text-caption text-muted-foreground">No compartas este código.</p>
        </>
      )}
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onCerrar}>
        Cerrar
      </Button>
    </div>
  )
}
