'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, FileCheck2, RefreshCw, CheckCheck, Store, UserRound, CircleSlash, ChevronDown, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import { CierreCajaDialog } from '@/components/caja/CierreCajaDialog'
import {
  anularPagoNoRecibidoAccion,
  cerrarSinEntregarAccion,
  generarComprobanteAccion,
  generarComprobantesPendientesAccion,
  marcarEntregadaAccion,
  reintentarEntregaAccion,
} from '@/modules/observabilidad/conciliacion-actions'
import { MOTIVOS_DE_CIERRE, NOTA_DE_CIERRE_MIN, motivoValeConProductoActivo } from '@/modules/observabilidad/conciliacion-entrega'
import type { CasoDeConciliacion } from '@/modules/observabilidad/conciliacion'
import { formatRD } from '@/lib/format'

/**
 * La lista de casos de UN hallazgo, cada uno con las acciones que el servidor ofrece para él.
 *
 * Los botones solo existen si la persona puede resolver cobros (`puedeResolver`); aun así cada acción se comprueba otra vez
 * en el servidor. Tras resolver un caso la pantalla se refresca: el caso desaparece porque la lectura ya no lo encuentra, no
 * porque la interfaz lo oculte.
 */

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
          <FilaDeCaso key={`${c.tipo}-${c.id}`} caso={c} puedeResolver={puedeResolver} fecha={fmtFecha(c.fecha)} fmtFecha={fmtFecha} />
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

function FilaDeCaso({
  caso,
  puedeResolver,
  fecha,
  fmtFecha,
}: {
  caso: CasoDeConciliacion
  puedeResolver: boolean
  fecha: string
  fmtFecha: (d: Date | string) => string
}) {
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
        {(caso.diagnostico || (caso.hechos && caso.hechos.length > 0)) && <DetalleDeCaso caso={caso} fmtFecha={fmtFecha} />}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {caso.monto != null && <span className="text-sm font-semibold tabular-nums text-foreground">{formatRD(caso.monto)}</span>}

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

        {caso.acciones.includes('CERRAR_SIN_ENTREGAR') && puedeResolver && (
          <CerrarSinEntregar
            caso={caso}
            pendiente={pendiente}
            onConfirmar={(motivo, nota) => correr(() => cerrarSinEntregarAccion(caso.id, motivo, nota))}
          />
        )}

        {caso.acciones.includes('ANULAR_PAGO_NO_RECIBIDO') && puedeResolver && (
          <AnularPagoNoRecibido caso={caso} pendiente={pendiente} onConfirmar={(nota) => correr(() => anularPagoNoRecibidoAccion(caso.id, nota))} />
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
            {caso.titulo}. El producto de este cobro ya se activó; solo falta cerrar el registro. No se cobra nada y queda en la
            bitácora a tu nombre. Si el cobro no tenía su venta en el libro, se registra ahora con la fecha del cobro (su
            comprobante). Si el dinero se devolvió, no uses esto: usa «Cerrar sin entregar».
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
 * «Anular pago no recibido»: para un pago de membresía confirmado a mano cuyo dinero nunca entró. Exige una nota; el servidor
 * vuelve a comprobar que el pago sigue sin venta y que la membresía no está activa, y lo asienta en la bitácora.
 */
function AnularPagoNoRecibido({ caso, pendiente, onConfirmar }: { caso: CasoDeConciliacion; pendiente: boolean; onConfirmar: (nota: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [nota, setNota] = useState('')
  const valida = nota.trim().length >= NOTA_DE_CIERRE_MIN

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={pendiente} data-testid="anular-pago-no-recibido">
          <Ban className="h-4 w-4" aria-hidden /> Anular pago no recibido
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular pago no recibido</DialogTitle>
          <DialogDescription>
            {caso.titulo}
            {caso.monto != null ? ` · ${formatRD(caso.monto)}` : ''}. Úsalo solo si el dinero nunca entró. El pago se quita de la
            membresía y deja de contar en los ingresos; la membresía no cambia de estado y no se registra ninguna venta. Queda en
            la bitácora a tu nombre con el importe y tu nota.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`nota-anular-${caso.id}`}>Nota (obligatoria)</Label>
          <Textarea
            id={`nota-anular-${caso.id}`}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={300}
            placeholder="Ej: La transferencia nunca llegó al banco; lo confirmó el negocio."
          />
        </div>
        <Button
          variant="destructive"
          disabled={!valida || pendiente}
          onClick={() => {
            onConfirmar(nota)
            setAbierto(false)
            setNota('')
          }}
        >
          Anular pago
        </Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * «Ver detalle»: POR QUÉ el caso está aquí y los datos del cobro para decidir (referencia, autorización, estado, intentos,
 * último error, evidencia). Sin esto la persona solo veía «Entrega pendiente» y un botón de reintentar, sin saber si
 * reintentar tenía sentido. Un `<details>` nativo: se abre con teclado y no necesita estado.
 */
function DetalleDeCaso({ caso, fmtFecha }: { caso: CasoDeConciliacion; fmtFecha: (d: Date | string) => string }) {
  return (
    <details className="group mt-1.5" data-testid="detalle-de-caso">
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden /> Ver detalle
      </summary>
      <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
        {caso.diagnostico && <p className="text-xs text-foreground">{caso.diagnostico}</p>}
        {caso.hechos && caso.hechos.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
            {caso.hechos.map((h) => (
              <div key={h.etiqueta} className="contents">
                <dt className="text-muted-foreground">{h.etiqueta}</dt>
                <dd className="break-all text-foreground">{h.fecha ? fmtFecha(h.fecha) : h.texto}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  )
}

/**
 * «Cerrar sin entregar»: para lo que reintentar no arregla (el dinero se devolvió, fue un cobro de prueba, el producto ya no
 * existe). Exige un motivo de la lista y una nota; el servidor lo vuelve a comprobar y lo asienta en la bitácora.
 */
function CerrarSinEntregar({
  caso,
  pendiente,
  onConfirmar,
}: {
  caso: CasoDeConciliacion
  pendiente: boolean
  onConfirmar: (motivo: string, nota: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [nota, setNota] = useState('')
  const valida = motivo !== '' && nota.trim().length >= NOTA_DE_CIERRE_MIN

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={pendiente} data-testid="cerrar-sin-entregar">
          <CircleSlash className="h-4 w-4" aria-hidden /> Cerrar sin entregar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar sin entregar</DialogTitle>
          <DialogDescription>
            {caso.titulo}. El cobro sale de la conciliación y no se entrega nada: no se cobra, no se devuelve dinero (un
            reembolso se hace en CardNET) y no se registra ninguna venta. Queda en la bitácora a tu nombre con el motivo y la nota.
          </DialogDescription>
        </DialogHeader>
        {caso.diagnostico && <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">{caso.diagnostico}</p>}
        {caso.cierreCancelaMembresia && (
          <p role="note" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs text-warning-ink">
            La membresía de este cobro está activa. Solo se cierra sin entregar si el dinero se devolvió o fue un cobro de
            prueba, y al cerrarlo <strong>se cancela la membresía</strong> (y su renovación). Si el cliente pagó, usa «Marcar
            entregada».
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor={`motivo-${caso.id}`}>Motivo</Label>
          <Select value={motivo} onValueChange={setMotivo}>
            <SelectTrigger id={`motivo-${caso.id}`}>
              <SelectValue placeholder="Elige por qué no se entrega" />
            </SelectTrigger>
            <SelectContent>
              {MOTIVOS_DE_CIERRE.filter((m) => !caso.cierreCancelaMembresia || motivoValeConProductoActivo(m.codigo)).map((m) => (
                <SelectItem key={m.codigo} value={m.codigo}>
                  {m.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`nota-cierre-${caso.id}`}>Nota (obligatoria)</Label>
          <Textarea
            id={`nota-cierre-${caso.id}`}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={300}
            placeholder="Ej: Reembolsado en CardNET el 20-oct, referencia 123456."
          />
        </div>
        <Button
          variant="destructive"
          disabled={!valida || pendiente}
          onClick={() => {
            onConfirmar(motivo, nota)
            setAbierto(false)
            setMotivo('')
            setNota('')
          }}
        >
          Cerrar sin entregar
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
        {lote.cantidad} pagos con tarjeta ya entregados no tienen comprobante ({formatRD(lote.monto)}).
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
              Se registrará la venta de {lote.cantidad} pagos con tarjeta ya entregados ({formatRD(lote.monto)} en total). No se cobra
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
