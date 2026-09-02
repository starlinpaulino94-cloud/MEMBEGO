'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Receipt,
  FileText,
  User,
  Sliders,
  DollarSign,
  AlertCircle,
  PlusCircle,
  MinusCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  cambiarEstadoComision,
  ajustarComision,
  type ComisionActionState,
} from '@/modules/excursiones/comisiones/actions'
import {
  ESTADO_COMISION_LABEL,
  TONO_COMISION,
  type EstadoComision,
} from '@/modules/excursiones/comisiones/nucleo'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'

const init: ComisionActionState = {}

export interface ComisionDetalleItem {
  id: string
  vendedorId: string
  vendedor: string
  vendedorCodigo: string | null
  base: number
  monto: number
  neto: number
  ajustes: Array<{ monto: number; motivo: string }>
  moneda: string
  desglose: string
  estado: string
  createdAt: Date | string
  venta: { id: string; numero: string; estado: string } | null
  liquidacionId?: string | null
  liquidacion?: { id: string; numero: string } | null
}

interface ComisionDetalleSheetProps {
  comision: ComisionDetalleItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ComisionDetalleSheet({
  comision,
  open,
  onOpenChange,
}: ComisionDetalleSheetProps) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoComision, init)
  const [ajusteState, ajusteAction, ajustando] = useActionState(ajustarComision, init)
  const [mostrandoAjuste, setMostrandoAjuste] = useState(false)
  const [tipoAjuste, setTipoAjuste] = useState<'RESTAR' | 'SUMAR'>('RESTAR')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
      onOpenChange(false)
    }
    if (state.error) toast.error(state.error)
  }, [state, router, onOpenChange])

  useEffect(() => {
    if (ajusteState.success) {
      toast.success(ajusteState.success)
      setMostrandoAjuste(false)
      router.refresh()
      onOpenChange(false)
    }
    if (ajusteState.error) toast.error(ajusteState.error)
  }, [ajusteState, router, onOpenChange])

  if (!comision) return null

  const estado = comision.estado as EstadoComision
  const puedeAjustar = estado === 'GENERADA'
  const puedeAnular = (estado === 'GENERADA' || estado === 'APROBADA') && !comision.liquidacionId
  const puedeReanudar = estado === 'ANULADA'
  const puedeAprobar = estado === 'GENERADA'

  const EXPLICACION_ESTADO: Record<EstadoComision, string> = {
    ESTIMADA: 'Cálculo proyectado antes de la confirmación de la venta.',
    GENERADA: 'Generada por venta confirmada. Requiere aprobación contable para poder ser liquidada.',
    APROBADA: 'Aprobada contablemente. Lista para entrar en una liquidación de pago.',
    PENDIENTE_PAGO: 'Incluida en un borrador de liquidación. Pasará a Pagada cuando se registre el pago.',
    PAGADA: 'Liquidada y pagada al vendedor. Estado contable definitivo.',
    ANULADA: 'Comisión anulada. No se incluirá en ninguna liquidación.',
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-6 space-y-6">
        <SheetHeader className="text-left space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-caption text-muted-foreground uppercase">
              Comisión #{comision.id.slice(-6).toUpperCase()}
            </span>
            <StatusChip tone={TONO_COMISION[estado] ?? 'neutral'}>
              {ESTADO_COMISION_LABEL[estado] ?? estado}
            </StatusChip>
          </div>
          <SheetTitle className="text-h2 text-foreground font-semibold">
            Detalle de Comisión
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Registrada el {formatDateTime(comision.createdAt)}
          </SheetDescription>
        </SheetHeader>

        {/* Guía explicativa del estado actual */}
        <div className="rounded-xl border border-border bg-muted/30 p-3.5 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-primary" />
            Estado actual: {ESTADO_COMISION_LABEL[estado] ?? estado}
          </p>
          <p>{EXPLICACION_ESTADO[estado] ?? ''}</p>
        </div>

        {/* Ficha: Vendedor y Venta */}
        <div className="space-y-3">
          <h3 className="text-caption uppercase tracking-wider font-semibold text-muted-foreground">
            Atribución Comercial
          </h3>
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <span className="text-caption text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> Vendedor
              </span>
              <p className="font-semibold text-foreground text-sm">
                <Link
                  href={`/admin/excursiones/vendedores/${comision.vendedorId}`}
                  className="hover:text-primary hover:underline"
                >
                  {comision.vendedor}
                </Link>
              </p>
              {comision.vendedorCodigo && (
                <p className="font-mono text-caption text-muted-foreground">
                  {comision.vendedorCodigo}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-caption text-muted-foreground flex items-center gap-1">
                <Receipt className="h-3 w-3" /> Venta Asociada
              </span>
              {comision.venta ? (
                <Link
                  href={`/admin/excursiones/ventas/${comision.venta.id}`}
                  className="font-mono font-semibold text-sm text-foreground hover:text-primary hover:underline"
                >
                  {comision.venta.numero}
                </Link>
              ) : (
                <p className="font-mono text-muted-foreground text-sm">—</p>
              )}
            </div>

            {comision.liquidacion && (
              <div className="col-span-2 pt-2 border-t border-border/60 space-y-1">
                <span className="text-caption text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Liquidación Relacionada
                </span>
                <Link
                  href={`/admin/excursiones/liquidaciones/${comision.liquidacion.id}`}
                  className="font-mono font-semibold text-sm text-primary hover:underline"
                >
                  {comision.liquidacion.numero}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Ficha: Desglose Contable */}
        <div className="space-y-3">
          <h3 className="text-caption uppercase tracking-wider font-semibold text-muted-foreground">
            Cálculo & Regla
          </h3>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Sliders className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-foreground leading-relaxed">{comision.desglose}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/60 text-sm">
              <div>
                <span className="text-caption text-muted-foreground">Base Comisionable</span>
                <p className="font-mono font-medium text-foreground">
                  {formatMoney(comision.base, { moneda: comision.moneda }, 2)}
                </p>
              </div>
              <div>
                <span className="text-caption text-muted-foreground">Monto Original</span>
                <p className="font-mono font-medium text-foreground">
                  {formatMoney(comision.monto, { moneda: comision.moneda }, 2)}
                </p>
              </div>
            </div>

            {/* Ajustes contables */}
            {comision.ajustes.length > 0 && (
              <div className="pt-3 border-t border-border/60 space-y-2">
                <span className="text-caption font-semibold text-muted-foreground block">
                  Ajustes Contables Firmados (+/−)
                </span>
                <ul className="space-y-1.5">
                  {comision.ajustes.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-xs rounded-lg bg-muted/40 p-2"
                    >
                      <span className="text-muted-foreground">{a.motivo}</span>
                      <span
                        className={`font-mono font-bold ${
                          a.monto < 0 ? 'text-destructive' : 'text-primary'
                        }`}
                      >
                        {a.monto > 0 ? '+' : ''}
                        {formatMoney(a.monto, { moneda: comision.moneda }, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Neto Final */}
            <div className="flex items-center justify-between pt-3 border-t border-border/60">
              <span className="font-medium text-foreground">Neto a Liquidar</span>
              <span className="text-h3 font-mono font-bold text-foreground">
                {formatMoney(comision.neto, { moneda: comision.moneda }, 2)}
              </span>
            </div>
          </div>
        </div>

        {/* Panel de Cambio de Estados y Acciones */}
        <div className="space-y-3 pt-2">
          <h3 className="text-caption uppercase tracking-wider font-semibold text-muted-foreground">
            Gestión de Estado
          </h3>

          <div className="space-y-2">
            {/* Si está en GENERADA: Botón Aprobar */}
            {puedeAprobar && (
              <form action={formAction}>
                <input type="hidden" name="comisionId" value={comision.id} />
                <input type="hidden" name="estado" value="APROBADA" />
                <Button type="submit" size="default" disabled={pending} className="w-full gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Aprobar Comisión
                </Button>
              </form>
            )}

            {/* Si está en GENERADA o APROBADA: Botón Anular */}
            {puedeAnular && (
              <form action={formAction}>
                <input type="hidden" name="comisionId" value={comision.id} />
                <input type="hidden" name="estado" value="ANULADA" />
                <Button
                  type="submit"
                  size="default"
                  variant="outline"
                  disabled={pending}
                  className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <XCircle className="h-4 w-4" /> Anular Comisión
                </Button>
              </form>
            )}

            {/* Si está en ANULADA: Botón Reanudar */}
            {puedeReanudar && (
              <form action={formAction}>
                <input type="hidden" name="comisionId" value={comision.id} />
                <input type="hidden" name="estado" value="GENERADA" />
                <Button type="submit" size="default" variant="outline" disabled={pending} className="w-full gap-2">
                  <RotateCcw className="h-4 w-4" /> Reanudar Comisión (a Generada)
                </Button>
              </form>
            )}

            {/* Mensajes de solo lectura si está en proceso o pagada */}
            {estado === 'PENDIENTE_PAGO' && (
              <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-xl border border-border">
                Esta comisión está incluida en el proceso de liquidación activo. Pasará a <strong>PAGADA</strong> automáticamente cuando se registre el comprobante de pago en el módulo de liquidaciones.
              </p>
            )}
            {estado === 'PAGADA' && (
              <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-xl border border-border">
                Esta comisión fue pagada y saldada con el vendedor. No admite cambios manuales.
              </p>
            )}

            {/* Formulario de Ajuste Contable (solo en GENERADA) */}
            {puedeAjustar && (
              <div className="pt-3 border-t border-border/60">
                {!mostrandoAjuste ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMostrandoAjuste(true)}
                    className="w-full gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <DollarSign className="h-4 w-4" /> Registrar ajuste contable previo a aprobación
                  </Button>
                ) : (
                  <form
                    action={ajusteAction}
                    className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5"
                  >
                    <input type="hidden" name="comisionId" value={comision.id} />
                    <input type="hidden" name="tipoAjuste" value={tipoAjuste} />

                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Nuevo Ajuste Contable
                      </span>
                      {/* Selector Restar / Sumar */}
                      <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
                        <button
                          type="button"
                          onClick={() => setTipoAjuste('RESTAR')}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            tipoAjuste === 'RESTAR'
                              ? 'bg-destructive text-destructive-foreground shadow-xs'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Restar (−)
                        </button>
                        <button
                          type="button"
                          onClick={() => setTipoAjuste('SUMAR')}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            tipoAjuste === 'SUMAR'
                              ? 'bg-primary text-primary-foreground shadow-xs'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Sumar (+)
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="sheet-ajuste-monto" className="text-caption text-muted-foreground">
                        {tipoAjuste === 'RESTAR' ? 'Monto a restar' : 'Monto a sumar'} ({comision.moneda})
                      </label>
                      <Input
                        id="sheet-ajuste-monto"
                        name="monto"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        placeholder="Ej. 25.00"
                        aria-label="Monto del ajuste"
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="sheet-ajuste-motivo" className="text-caption text-muted-foreground">
                        Motivo auditado del ajuste
                      </label>
                      <Input
                        id="sheet-ajuste-motivo"
                        name="motivo"
                        required
                        placeholder="Ej. Penalidad por retraso / Bonificación especial"
                        aria-label="Motivo del ajuste"
                        className="h-9"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button type="submit" size="sm" disabled={ajustando} className="flex-1">
                        Guardar ajuste
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setMostrandoAjuste(false)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
