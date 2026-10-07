'use client'

import { useActionState, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  confirmarEntregaAction,
  escanearBeneficioAction,
  registrarIncidenciaAction,
  type PreviewParaEscaner,
} from '@/modules/supply-v2/actions-canje'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { EntregaConfirmada } from '@/modules/supply-v2/redemption/service'
import { INCIDENT_TYPE_LABELS, RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

const QRScanner = dynamic(() => import('@/components/scanner/QRScanner').then((m) => m.QRScanner), {
  ssr: false,
  loading: () => <div className="flex h-64 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">Abriendo la cámara…</div>,
})

interface Sucursal {
  id: string
  nombre: string
}

/**
 * MEMBEGO SUPPLY · ESCÁNER DEL PROVEEDOR (§15–§19, §51–§52, §66–§67).
 *
 * Escanear ENSEÑA quién es y qué entregar; solo «Confirmar entrega» redime, y
 * el servidor vuelve a validar todo dentro de la transacción. La cámara puede
 * fallar: el código temporal también se puede escribir a mano. Nunca se
 * valida nada en el navegador.
 */
export function EscanerProveedor({ sucursales }: { sucursales: Sucursal[] }) {
  const [escaneo, accionEscanear, escaneando] = useActionState<EstadoAccion<PreviewParaEscaner>, FormData>(escanearBeneficioAction, {})
  const [entrega, accionConfirmar, confirmando] = useActionState<EstadoAccion<EntregaConfirmada>, FormData>(confirmarEntregaAction, {})
  const [manual, setManual] = useState(false)
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '')
  const [canal, setCanal] = useState<'QR_SCAN' | 'MANUAL_CODE'>('QR_SCAN')
  const [ronda, setRonda] = useState(0)

  const escanearCodigo = useCallback(
    (texto: string, canalLeido: 'QR_SCAN' | 'MANUAL_CODE') => {
      const fd = new FormData()
      fd.set('codigo', texto)
      fd.set('branchId', sucursalId)
      setCanal(canalLeido)
      // Cada lectura remonta la cámara: el escáner dispara una sola vez por montaje.
      setRonda((r) => r + 1)
      accionEscanear(fd)
    },
    [accionEscanear, sucursalId]
  )
  const onScan = useCallback((texto: string) => escanearCodigo(texto, 'QR_SCAN'), [escanearCodigo])

  const preview = escaneo.data
  const entregada = entrega.data

  const reiniciar = () => window.location.reload()

  return (
    <div className="space-y-4">
      {sucursales.length > 0 && (
        <div>
          <Label htmlFor="sucursal">Sucursal donde estás</Label>
          <select id="sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="select-sucursal">
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {entregada ? (
        <Card className="border-success/40" data-testid="entrega-confirmada">
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 text-h4 text-success">
              <CheckCircle2 className="size-5" aria-hidden />
              Entrega confirmada
            </p>
            <dl className="space-y-1 text-sm">
              <Dato label="Cliente">{entregada.customerName}</Dato>
              <Dato label="Producto">{entregada.productName}</Dato>
              {entregada.branchName && <Dato label="Sucursal">{entregada.branchName}</Dato>}
              <Dato label="Referencia"><span className="font-mono">{entregada.number}</span></Dato>
            </dl>
            {entrega.success && <p className="text-caption text-muted-foreground">{entrega.success}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={reiniciar} data-testid="btn-escanear-otro">Escanear otro</Button>
              <Button asChild variant="ghost"><Link href={RUTA_PORTAL_PROVEEDOR}>Ver entregas</Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : preview?.valid ? (
        <Card className="border-success/40" data-testid="preview-valido">
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-center gap-2 text-h4 text-success">
              <CheckCircle2 className="size-5" aria-hidden />
              Beneficio válido
            </p>
            <dl className="space-y-1 text-sm">
              <Dato label="Cliente"><span data-testid="preview-cliente">{preview.customerName}</span></Dato>
              <Dato label="Producto"><span data-testid="preview-producto">{preview.productName}</span></Dato>
              <Dato label="Cantidad">{preview.quantity}</Dato>
              <Dato label="Proveedor">{preview.supplierName}</Dato>
              {preview.branchName && <Dato label="Sucursal">{preview.branchName}</Dato>}
              <Dato label="Cubierto por Membego">Sí</Dato>
              <Dato label="Cliente debe pagar al comercio"><span data-testid="preview-paga">RD${preview.customerPaysMerchant}</span></Dato>
              <Dato label="Estado">Listo para entregar</Dato>
            </dl>
            <form action={accionConfirmar} className="space-y-2">
              <input type="hidden" name="nonce" value={preview.nonce ?? ''} />
              <input type="hidden" name="branchId" value={sucursalId} />
              <input type="hidden" name="idempotencyKey" value={preview.idempotencyKey ?? ''} />
              <input type="hidden" name="channel" value={canal} />
              {entrega.error && (
                <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="entrega-error">
                  <XCircle className="size-4 shrink-0" aria-hidden />
                  {entrega.error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" disabled={confirmando} loading={confirmando} data-testid="btn-confirmar-entrega">Confirmar entrega</Button>
                <Button type="button" variant="ghost" onClick={reiniciar}>Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {manual ? (
              <form
                action={(fd) => escanearCodigo(String(fd.get('codigo') ?? ''), 'MANUAL_CODE')}
                className="space-y-3"
              >
                <Label htmlFor="codigo">Código del cliente</Label>
                <Input id="codigo" name="codigo" required maxLength={200} autoFocus autoComplete="off" spellCheck={false} data-testid="input-codigo" />
                <div className="flex gap-2">
                  <Button type="submit" disabled={escaneando} loading={escaneando} data-testid="btn-buscar-codigo">Buscar</Button>
                  <Button type="button" variant="ghost" onClick={() => setManual(false)}>Usar la cámara</Button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-caption text-muted-foreground">Necesitamos acceso a la cámara para escanear el beneficio. Si no está disponible, escribe el código a mano.</p>
                <QRScanner key={ronda} onScan={onScan} onUseReader={() => setManual(true)} />
                <Button type="button" variant="ghost" onClick={() => setManual(true)} data-testid="btn-codigo-manual">
                  <ScanLine className="mr-2 size-4" aria-hidden />
                  Escribir el código a mano
                </Button>
              </>
            )}
            {escaneando && <p className="text-sm text-muted-foreground">Comprobando…</p>}
            {(escaneo.error || (preview && !preview.valid)) && (
              <div className="space-y-3">
                <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="preview-rechazado">
                  <XCircle className="size-4 shrink-0" aria-hidden />
                  {escaneo.error ?? preview?.message}
                </p>
                <Incidencia sucursalId={sucursalId} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

/** Incidencia mínima desde el escáner (§41). */
function Incidencia({ sucursalId }: { sucursalId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(registrarIncidenciaAction, {})
  const [abierto, setAbierto] = useState(false)
  if (estado.success) return <p className="text-sm text-success" data-testid="incidencia-registrada">{estado.success}</p>
  if (!abierto) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)} data-testid="btn-incidencia">
        Registrar incidencia
      </Button>
    )
  }
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="branchId" value={sucursalId} />
      <div>
        <Label htmlFor="incidenciaTipo">Qué pasó</Label>
        <select id="incidenciaTipo" name="type" className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue="INVALID_QR" data-testid="select-incidencia">
          {(Object.keys(INCIDENT_TYPE_LABELS) as (keyof typeof INCIDENT_TYPE_LABELS)[]).map((k) => (
            <option key={k} value={k}>{INCIDENT_TYPE_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="incidenciaNotas">Notas (opcional)</Label>
        <Textarea id="incidenciaNotas" name="notes" rows={2} maxLength={500} />
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-incidencia-guardar">Guardar</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
