'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, FileCheck2, RefreshCw, CheckCheck, Store, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import { CierreCajaDialog } from '@/components/caja/CierreCajaDialog'
import {
  generarComprobanteAccion,
  generarComprobantesPendientesAccion,
  marcarEntregadaAccion,
  reintentarEntregaAccion,
} from '@/modules/observabilidad/conciliacion-actions'
import type { CasoDeConciliacion } from '@/modules/observabilidad/conciliacion'

/**
 * La lista de casos de UN hallazgo, cada uno con las acciones que el servidor ofrece para él.
 *
 * Los botones solo existen si la persona puede resolver cobros (`puedeResolver`); aun así cada acción se comprueba otra vez
 * en el servidor. Tras resolver un caso la pantalla se refresca: el caso desaparece porque la lectura ya no lo encuentra, no
 * porque la interfaz lo oculte.
 */

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

export function CasosDeHallazgo({
  casos,
  total,
  puedeResolver,
  zonaHoraria,
  lote,
  dias,
}: {
  casos: CasoDeConciliacion[]
  /** La cifra real del hallazgo; `casos` es lo que cabe en pantalla. */
  total: number
  puedeResolver: boolean
  zonaHoraria: string
  /** Generar de una vez todos los comprobantes de tarjeta pendientes del periodo (con la cifra a la vista). */
  lote?: { cantidad: number; monto: number }
  /** El periodo que se está mirando: el lote usa el mismo. */
  dias: number
}) {
  const fmtFecha = (d: Date | string) =>
    new Intl.DateTimeFormat('es-DO', { timeZone: zonaHoraria, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d))

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-card">
      {lote && puedeResolver && <LoteDeComprobantes lote={lote} dias={dias} />}
      <ul className="divide-y divide-border/50" data-testid="casos-de-hallazgo">
        {casos.map((c) => (
          <FilaDeCaso key={`${c.tipo}-${c.id}`} caso={c} puedeResolver={puedeResolver} fecha={fmtFecha(c.fecha)} />
        ))}
      </ul>
      {total > casos.length && (
        <p className="border-t border-border/50 px-4 py-2.5 text-caption text-muted-foreground">
          Se muestran los {casos.length} más recientes de {total}. Resuelve estos y la lista se completa sola.
        </p>
      )}
    </div>
  )
}

function FilaDeCaso({ caso, puedeResolver, fecha }: { caso: CasoDeConciliacion; puedeResolver: boolean; fecha: string }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  /** La venta que acaba de nacer: se ofrece imprimirla sin salir de aquí. */
  const [comprobante, setComprobante] = useState<{ id: string; ticket: string | undefined } | null>(null)

  function correr(
    accion: () => Promise<{ ok: boolean; mensaje?: string; error?: string; transactionId?: string; ticketNumero?: string }>,
    /** Con `false` el caso se queda a la vista (con su comprobante para imprimir) hasta que la persona actualiza la lista. */
    refrescar = true
  ) {
    empezar(async () => {
      const r = await accion()
      if (r.ok) {
        toast.success(r.mensaje ?? 'Listo.')
        if (r.transactionId) setComprobante({ id: r.transactionId, ticket: r.ticketNumero })
        if (refrescar) router.refresh()
      } else {
        toast.error(r.error ?? 'No se pudo completar la acción.')
      }
    })
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{caso.titulo}</p>
        {caso.detalle && <p className="mt-0.5 text-xs text-muted-foreground">{caso.detalle}</p>}
        <p className="mt-0.5 text-overline text-muted-foreground">{fecha}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {caso.monto != null && <span className="text-sm font-semibold tabular-nums text-foreground">{fmtRD(caso.monto)}</span>}

        {caso.acciones.includes('GENERAR_COMPROBANTE') && puedeResolver && !comprobante && (
          <Button size="sm" variant="secondary" disabled={pendiente} onClick={() => correr(() => generarComprobanteAccion(caso.id), false)}>
            {pendiente ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileCheck2 className="h-4 w-4" aria-hidden />}
            Generar comprobante
          </Button>
        )}
        {comprobante && (
          <>
            <span className="text-xs font-medium text-success" data-testid="comprobante-generado">
              Comprobante {comprobante.ticket ?? ''} generado
            </span>
            <FacturaPrintDialog transactionId={comprobante.id} yaImpresa={false} triggerLabel="Imprimir" />
            <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
              Actualizar lista
            </Button>
          </>
        )}

        {caso.acciones.includes('REINTENTAR_ENTREGA') && puedeResolver && (
          <Button size="sm" variant="secondary" disabled={pendiente} onClick={() => correr(() => reintentarEntregaAccion(caso.id))}>
            {pendiente ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            Reintentar entrega
          </Button>
        )}

        {caso.acciones.includes('MARCAR_ENTREGADA') && puedeResolver && (
          <MarcarEntregada caso={caso} pendiente={pendiente} onConfirmar={(nota) => correr(() => marcarEntregadaAccion(caso.id, nota))} />
        )}

        {caso.acciones.includes('ABRIR_FICHA') && caso.clienteId && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/admin/clientes/${caso.clienteId}?vista=historial`}>
              <UserRound className="h-4 w-4" aria-hidden /> Abrir ficha
            </Link>
          </Button>
        )}
        {caso.acciones.includes('ABRIR_CAJA') && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/empleado/caja?caja=${caso.id}`}>
              <Store className="h-4 w-4" aria-hidden /> Abrir caja
            </Link>
          </Button>
        )}
        {caso.acciones.includes('VER_CIERRE') && <CierreCajaDialog cajaSesionId={caso.id} triggerLabel="Ver cierre" />}
      </div>
    </li>
  )
}

/** Cerrar el registro exige una nota: es lo que queda en la bitácora de por qué un cobro sin marcar se dio por entregado. */
function MarcarEntregada({ caso, pendiente, onConfirmar }: { caso: CasoDeConciliacion; pendiente: boolean; onConfirmar: (nota: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [nota, setNota] = useState('')
  const valida = nota.trim().length >= 5

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={pendiente}>
          <CheckCheck className="h-4 w-4" aria-hidden /> Marcar entregada
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como entregada</DialogTitle>
          <DialogDescription>
            {caso.titulo}. El producto de este cobro ya está activo; solo falta cerrar el registro. No se cobra nada y queda en la
            bitácora a tu nombre.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`nota-${caso.id}`}>Nota (obligatoria)</Label>
          <Textarea
            id={`nota-${caso.id}`}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={300}
            placeholder="Ej: Se activó a mano el mismo día; lo confirmé con el cliente."
          />
        </div>
        <Button
          disabled={!valida || pendiente}
          onClick={() => {
            onConfirmar(nota)
            setAbierto(false)
            setNota('')
          }}
        >
          Marcar entregada
        </Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * «Generar los N comprobantes»: para ponerse al día con los pagos con tarjeta anteriores al comprobante. La cifra y lo que va a
 * pasar se ven ANTES de confirmar; nada se cobra, cada comprobante lleva la fecha de su cobro y todos quedan en la bitácora.
 */
function LoteDeComprobantes({ lote, dias }: { lote: { cantidad: number; monto: number }; dias: number }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [pendiente, empezar] = useTransition()

  function confirmar() {
    empezar(async () => {
      const r = await generarComprobantesPendientesAccion(dias)
      if (r.ok) {
        toast.success(r.mensaje)
        setAbierto(false)
        router.refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {lote.cantidad} pagos con tarjeta ya entregados no tienen comprobante ({fmtRD(lote.monto)}).
      </p>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary" data-testid="lote-comprobantes">
            <FileCheck2 className="h-4 w-4" aria-hidden /> Generar los {lote.cantidad} comprobantes
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar {lote.cantidad} comprobantes</DialogTitle>
            <DialogDescription>
              Se registrará la venta de {lote.cantidad} pagos con tarjeta ya entregados ({fmtRD(lote.monto)} en total). No se cobra
              nada. Cada comprobante lleva la fecha en que el cliente pagó, así que los reportes de esos días los verán donde
              corresponde; el número de ticket sigue el orden de hoy. Quedan todos en la bitácora a tu nombre.
            </DialogDescription>
          </DialogHeader>
          <Button disabled={pendiente} onClick={confirmar} data-testid="lote-confirmar">
            {pendiente && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Generar {lote.cantidad} comprobantes
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
