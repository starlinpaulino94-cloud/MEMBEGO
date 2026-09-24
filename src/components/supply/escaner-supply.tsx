'use client'

import { useActionState, useState } from 'react'
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRScanner } from '@/components/scanner/QRScanner'
import {
  escanearSupplyAction,
  redimirAction,
  type EstadoAccion,
  type EstadoEscaneo,
} from '@/modules/supply/actions'

interface Sucursal {
  id: string
  nombre: string
}

/**
 * MEMBEGO SUPPLY · ESCÁNER DEL PROVEEDOR (Fases 14, 15).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS PASOS, SIEMPRE
 *
 * Escanear ENSEÑA quién es y qué le toca. Solo «Confirmar entrega» redime. Un
 * escáner de un paso deja el voucher consumido si el empleado se arrepiente o
 * la pantalla se cae antes de servir — y el cliente sin pizza y sin beneficio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL AVISO DE COBRO NO ES DECORACIÓN
 *
 * En una compra de unidad completa Membego YA pagó esa unidad: cobrársela otra
 * vez al cliente es el fraude que la Fase 22 prohíbe, y el servidor lo rechaza.
 * Decirlo en la pantalla del empleado evita la discusión en el mostrador, que
 * es donde el problema le pasa a una persona real.
 */
export function EscanerSupply({
  companyId,
  sucursales,
}: {
  companyId: string
  sucursales: Sucursal[]
}) {
  const [escaneo, accionEscanear, escaneando] = useActionState<EstadoEscaneo, FormData>(
    escanearSupplyAction,
    {}
  )
  const [entrega, accionRedimir, redimiendo] = useActionState<EstadoAccion, FormData>(
    redimirAction,
    {}
  )
  const [manual, setManual] = useState(false)
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '')

  const ficha = escaneo.ficha
  const entregada = Boolean(entrega.success)

  return (
    <div className="space-y-4">
      {sucursales.length > 1 && (
        <div>
          <Label htmlFor="sucursal">Sucursal donde estás</Label>
          <select
            id="sucursal"
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {!ficha && !entregada && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {manual ? (
              <form action={accionEscanear} className="space-y-3">
                <input type="hidden" name="companyId" value={companyId} />
                <Label htmlFor="codigo">Código del cliente</Label>
                <Input id="codigo" name="codigo" required maxLength={200} autoFocus />
                <div className="flex gap-2">
                  <Button type="submit" disabled={escaneando}>
                    {escaneando ? 'Buscando…' : 'Buscar'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setManual(false)}>
                    Usar la cámara
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <QRScanner
                  onScan={(texto) => {
                    const fd = new FormData()
                    fd.set('companyId', companyId)
                    fd.set('codigo', texto)
                    accionEscanear(fd)
                  }}
                  onUseReader={() => setManual(true)}
                />
                <Button type="button" variant="ghost" onClick={() => setManual(true)}>
                  <ScanLine className="mr-2 size-4" aria-hidden />
                  Escribir el código a mano
                </Button>
              </>
            )}
            {escaneo.error && (
              <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <XCircle className="size-4 shrink-0" aria-hidden />
                {escaneo.error}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {ficha && !entregada && (
        <Card className="border-success/40">
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-center gap-2 font-semibold text-success">
              <CheckCircle2 className="size-5" aria-hidden />
              VOUCHER VÁLIDO
            </p>

            <dl className="space-y-1 text-sm">
              <Fila termino="Cliente" valor={ficha.cliente} />
              <Fila
                termino="Producto"
                valor={ficha.variante ? `${ficha.producto} · ${ficha.variante}` : ficha.producto}
              />
              <Fila termino="Proveedor" valor={ficha.proveedor} />
              <Fila termino="Lote" valor={ficha.loteCodigo} />
              {ficha.campana && <Fila termino="Campaña" valor={ficha.campana} />}
              <Fila
                termino="Vence"
                valor={new Intl.DateTimeFormat('es-DO', { dateStyle: 'long' }).format(
                  new Date(ficha.venceAt)
                )}
              />
            </dl>

            <p className="rounded-lg bg-muted/40 p-3 text-caption">{ficha.avisoCobro}</p>

            <form action={accionRedimir} className="space-y-3">
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="voucherId" value={ficha.voucherId} />
              <input type="hidden" name="sesionQrId" value={ficha.sesionQrId ?? ''} />
              <input type="hidden" name="sucursalId" value={sucursalId} />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="extrasMonto">Extras cobrados aparte</Label>
                  <Input
                    id="extrasMonto"
                    name="extrasMonto"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="extrasNota">Qué extras</Label>
                  <Input
                    id="extrasNota"
                    name="extrasNota"
                    maxLength={500}
                    placeholder="Refresco, extra queso…"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={redimiendo}>
                {redimiendo ? 'Registrando…' : 'CONFIRMAR ENTREGA'}
              </Button>
            </form>

            {entrega.error && (
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {entrega.error}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {entregada && (
        <Card className="border-success/40">
          <CardContent className="space-y-3 pt-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
            <p className="font-semibold">Entrega registrada</p>
            <p className="text-caption text-muted-foreground">
              El voucher quedó utilizado y no se puede volver a canjear. La entrega ya está en tu
              historial y en el de Membego: los dos leen los mismos movimientos.
            </p>
            <Button type="button" onClick={() => window.location.reload()}>
              Escanear otro
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Fila({ termino, valor }: { termino: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{termino}</dt>
      <dd className="text-right font-medium">{valor}</dd>
    </div>
  )
}
