'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SupplyV2CampaignStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  adjuntarPromocionAction,
  ajustarPromocionAction,
  agregarOfertaCampanaAction,
  aprobarCampanaAction,
  asignarCampanaAction,
  buscarClientesCampanaAction,
  cancelarCampanaAction,
  cancelarCuponAction,
  enviarCampanaARevisionAction,
  generarCuponesAction,
  pausarCampanaAction,
  publicarCampanaAction,
  quitarOfertaCampanaAction,
  reanudarCampanaAction,
  rechazarCampanaAction,
} from '@/modules/supply-v2/actions-campanas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { CuponesGenerados } from '@/modules/supply-v2/campaigns/coupons'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · acciones de una campaña (§4, §23, §27).
 *
 * Cada botón es un formulario y lo que decide es el servidor. Lo que exige un
 * motivo lo pide aquí y no se manda vacío. Los permisos llegan como props
 * porque la pantalla los consulta una vez; la barrera real está en la acción.
 */

function useAviso(estados: EstadoAccion<unknown>[]): void {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    const exito = estados.find((e) => e.success)?.success
    if (exito && visto.current !== exito) {
      visto.current = exito
      toast.success(exito)
      router.refresh()
    }
  }, [estados, router])
}

export function AccionesCampana({
  campaignId,
  estado,
  aprobada,
  puedeEditar,
  puedeAprobar,
  puedePublicar,
}: {
  campaignId: string
  estado: SupplyV2CampaignStatus
  aprobada: boolean
  puedeEditar: boolean
  puedeAprobar: boolean
  puedePublicar: boolean
}) {
  const [revision, enviar, enviando] = useActionState<EstadoAccion, FormData>(enviarCampanaARevisionAction, {})
  const [aprobado, aprobar, aprobando] = useActionState<EstadoAccion, FormData>(aprobarCampanaAction, {})
  const [rechazado, rechazar, rechazando] = useActionState<EstadoAccion, FormData>(rechazarCampanaAction, {})
  const [publicado, publicar, publicando] = useActionState<EstadoAccion, FormData>(publicarCampanaAction, {})
  const [pausado, pausar, pausando] = useActionState<EstadoAccion, FormData>(pausarCampanaAction, {})
  const [reanudado, reanudar, reanudando] = useActionState<EstadoAccion, FormData>(reanudarCampanaAction, {})
  const [cancelado, cancelar, cancelando] = useActionState<EstadoAccion, FormData>(cancelarCampanaAction, {})
  const [pidiendo, setPidiendo] = useState<'rechazo' | 'cancelacion' | null>(null)
  const [motivo, setMotivo] = useState('')
  useAviso([revision, aprobado, rechazado, publicado, pausado, reanudado, cancelado])
  const error = revision.error ?? aprobado.error ?? rechazado.error ?? publicado.error ?? pausado.error ?? reanudado.error ?? cancelado.error
  const cerrada = estado === 'CANCELLED' || estado === 'COMPLETED'

  return (
    <div className="space-y-3" data-testid="acciones-campana">
      <div className="flex flex-wrap gap-2">
        {puedeEditar && estado === 'DRAFT' && (
          <form action={enviar}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <Button type="submit" disabled={enviando} loading={enviando} data-testid="btn-enviar-revision">Enviar a revisión</Button>
          </form>
        )}
        {puedeAprobar && estado === 'PENDING_APPROVAL' && (
          <>
            <form action={aprobar}>
              <input type="hidden" name="campaignId" value={campaignId} />
              <Button type="submit" disabled={aprobando} loading={aprobando} data-testid="btn-aprobar-campana">Aprobar</Button>
            </form>
            <Button type="button" variant="outline" onClick={() => setPidiendo((v) => (v === 'rechazo' ? null : 'rechazo'))} data-testid="btn-rechazar-campana">Devolver a borrador</Button>
          </>
        )}
        {puedePublicar && aprobada && (estado === 'PENDING_APPROVAL' || estado === 'DRAFT') && (
          <form action={publicar}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <Button type="submit" disabled={publicando} loading={publicando} data-testid="btn-publicar-campana">Publicar</Button>
          </form>
        )}
        {puedeEditar && (estado === 'ACTIVE' || estado === 'SCHEDULED') && (
          <form action={pausar}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <Button type="submit" variant="outline" disabled={pausando} data-testid="btn-pausar-campana">Pausar</Button>
          </form>
        )}
        {puedeEditar && estado === 'PAUSED' && (
          <form action={reanudar}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <Button type="submit" variant="outline" disabled={reanudando} data-testid="btn-reanudar-campana">Reactivar</Button>
          </form>
        )}
        {puedePublicar && !cerrada && (
          <Button type="button" variant="ghost" onClick={() => setPidiendo((v) => (v === 'cancelacion' ? null : 'cancelacion'))} data-testid="btn-cancelar-campana">Cancelar campaña</Button>
        )}
      </div>

      {pidiendo === 'rechazo' && (
        <form action={rechazar} className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3" data-testid="form-rechazar-campana">
          <input type="hidden" name="campaignId" value={campaignId} />
          <Label htmlFor="motivoRechazo">¿Qué hay que corregir?</Label>
          <Input id="motivoRechazo" name="motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="El presupuesto no cuadra con el descuento propuesto" required />
          <Button type="submit" variant="outline" size="sm" disabled={rechazando || motivo.trim().length === 0}>Devolver con este motivo</Button>
        </form>
      )}

      {pidiendo === 'cancelacion' && (
        <form action={cancelar} className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="form-cancelar-campana">
          <input type="hidden" name="campaignId" value={campaignId} />
          <Label htmlFor="motivoCancelar">¿Por qué se cancela?</Label>
          <Input id="motivoCancelar" name="motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="La campaña se adelantó por error" required />
          <p className="text-caption text-muted-foreground">Lo aplicado queda aplicado. Sus promociones y cupones vivos se cancelan. Con checkouts en curso no se puede: pausa y espera.</p>
          <Button type="submit" variant="destructive" size="sm" disabled={cancelando || motivo.trim().length === 0} data-testid="btn-confirmar-cancelar-campana">Confirmar cancelación</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}

/** Añadir una oferta participante (§8). */
export function FormAgregarOferta({ campaignId, ofertas }: { campaignId: string; ofertas: { id: string; title: string; proveedor: string; salePrice: string; currency: string; sourceType: string }[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(agregarOfertaCampanaAction, {})
  useAviso([estado])
  if (ofertas.length === 0) return <p className="text-sm text-muted-foreground">No quedan ofertas disponibles para añadir.</p>
  return (
    <form action={accion} className="flex flex-wrap items-end gap-2" data-testid="form-agregar-oferta-campana">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div className="min-w-64 flex-1">
        <Label htmlFor="ofertaCampana">Oferta participante</Label>
        <select id="ofertaCampana" name="offerId" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="select-oferta-campana" required>
          <option value="">Selecciona una oferta…</option>
          {ofertas.map((o) => (
            <option key={o.id} value={o.id}>{o.title} · {o.proveedor} · {o.salePrice} {o.currency}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="featured" value="si" /> Destacada
      </label>
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-agregar-oferta-campana">Añadir</Button>
      {estado.error && <p className="w-full text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function QuitarOferta({ campaignId, offerId }: { campaignId: string; offerId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(quitarOfertaCampanaAction, {})
  useAviso([estado])
  return (
    <form action={accion}>
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="offerId" value={offerId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pendiente} data-testid="btn-quitar-oferta-campana">Quitar</Button>
      {estado.error && <p className="text-caption text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

/** Configurar la promoción de una oferta: es un beneficio del Slice 6 (§6). */
/** Lo guardado de una promoción ya configurada, para poder ajustarla (§16). */
export interface PromocionActual {
  nombre: string
  valueType: 'FIXED_AMOUNT' | 'PERCENTAGE'
  membegoValue: string
  supplierValue: string
  maxMembegoAmount: string | null
  budgetTotal: string | null
  requiresCoupon: boolean
  requiresAssignment: boolean
}

export function FormPromocion({ campaignId, offerId, moneda, funding, presupuestoDisponible, actual }: { campaignId: string; offerId: string; moneda: string; funding: 'MEMBEGO' | 'SUPPLIER' | 'SHARED'; presupuestoDisponible: string | null; actual?: PromocionActual | null }) {
  // La misma pantalla configura la promoción nueva y ajusta la que ya está:
  // el asistente deja una repartiendo el techo a partes iguales y desde aquí
  // se rebalancea. Es el MISMO beneficio del Slice 6, no otro.
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(actual ? ajustarPromocionAction : adjuntarPromocionAction, {})
  const [valueType, setValueType] = useState<'FIXED_AMOUNT' | 'PERCENTAGE'>(actual?.valueType ?? 'FIXED_AMOUNT')
  const [abierto, setAbierto] = useState(false)
  useAviso([estado])
  if (!abierto) {
    return (
      <Button type="button" size="sm" variant={actual ? 'outline' : 'default'} onClick={() => setAbierto(true)} data-testid="btn-abrir-promocion">{actual ? 'Ajustar promoción' : 'Configurar promoción'}</Button>
    )
  }
  return (
    <form action={accion} className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="form-promocion-campana">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="valueType" value={valueType} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`tipoValor-${offerId}`}>Tipo de valor</Label>
          <select id={`tipoValor-${offerId}`} value={valueType} onChange={(e) => setValueType(e.target.value as 'FIXED_AMOUNT' | 'PERCENTAGE')} className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="promocion-tipo-valor">
            <option value="FIXED_AMOUNT">Importe fijo</option>
            <option value="PERCENTAGE">Porcentaje</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`nombre-${offerId}`}>Nombre (opcional)</Label>
          <Input id={`nombre-${offerId}`} name="nombre" maxLength={120} defaultValue={actual?.nombre ?? ''} placeholder="Bono Semana Gastronómica" />
        </div>
        {funding !== 'SUPPLIER' && (
          <div>
            <Label htmlFor={`membego-${offerId}`}>Parte de Membego {valueType === 'PERCENTAGE' ? '(%)' : `(${moneda})`}</Label>
            <Input id={`membego-${offerId}`} name="membegoValue" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={actual?.membegoValue ?? ''} placeholder={valueType === 'PERCENTAGE' ? '15' : '300'} data-testid="promocion-valor-membego" />
          </div>
        )}
        {funding !== 'MEMBEGO' && (
          <div>
            <Label htmlFor={`proveedor-${offerId}`}>Parte del proveedor {valueType === 'PERCENTAGE' ? '(%)' : `(${moneda})`}</Label>
            <Input id={`proveedor-${offerId}`} name="supplierValue" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={actual?.supplierValue ?? ''} placeholder={valueType === 'PERCENTAGE' ? '10' : '100'} data-testid="promocion-valor-proveedor" />
          </div>
        )}
        {valueType === 'PERCENTAGE' && funding !== 'SUPPLIER' && (
          <div>
            <Label htmlFor={`topeM-${offerId}`}>Tope de la parte de Membego ({moneda})</Label>
            <Input id={`topeM-${offerId}`} name="maxMembegoAmount" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={actual?.maxMembegoAmount ?? ''} />
          </div>
        )}
        {funding !== 'SUPPLIER' && (
          <div>
            <Label htmlFor={`presu-${offerId}`}>Presupuesto de esta promoción ({moneda})</Label>
            <Input id={`presu-${offerId}`} name="budgetTotal" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={actual?.budgetTotal ?? ''} data-testid="promocion-presupuesto" />
            <p className="text-caption text-muted-foreground">{presupuestoDisponible ? `Cabe hasta ${presupuestoDisponible} del techo de la campaña.` : 'La campaña no tiene techo: esta promoción puede ir sin tope.'}</p>
          </div>
        )}
        <div>
          <Label htmlFor={`cupon-${offerId}`}>¿Se abre con código?</Label>
          <select id={`cupon-${offerId}`} name="requiresCoupon" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue={actual?.requiresCoupon ? 'si' : 'no'} data-testid="promocion-exige-cupon">
            <option value="no">No: se aplica sola en la oferta</option>
            <option value="si">Sí: hace falta el cupón</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`asig-${offerId}`}>¿Hay que asignarla cliente por cliente?</Label>
          <select id={`asig-${offerId}`} name="requiresAssignment" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue={actual?.requiresAssignment ? 'si' : 'no'} data-testid="promocion-exige-asignacion">
            <option value="no">No</option>
            <option value="si">Sí: solo los clientes asignados</option>
          </select>
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-guardar-promocion">{actual ? 'Guardar ajuste' : 'Guardar promoción'}</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

/** Generar cupones (§10). Un código a medida o un lote aleatorio. */
export function FormCupones({ campaignId, promociones, moneda }: { campaignId: string; promociones: { id: string; nombre: string }[]; moneda: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<CuponesGenerados>, FormData>(generarCuponesAction, {})
  const [kind, setKind] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC')
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<{ id: string; nombre: string; email: string }[]>([])
  const [elegidos, setElegidos] = useState<{ id: string; nombre: string; email: string }[]>([])
  const [buscando, buscar] = useTransition()
  useAviso([estado])
  const generados = estado.data?.codigos ?? []

  if (promociones.length === 0) {
    return <p className="text-sm text-muted-foreground">Configura antes la promoción de alguna oferta: un cupón abre una promoción.</p>
  }
  return (
    <form action={accion} className="space-y-3" data-testid="form-cupones">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="kind" value={kind} />
      {elegidos.map((c) => (
        <input key={c.id} type="hidden" name="customerIds" value={c.id} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cuponPromocion">Promoción que abre</Label>
          <select id="cuponPromocion" name="benefitId" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" required data-testid="cupon-promocion">
            <option value="">Selecciona…</option>
            {promociones.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="cuponTipo">Tipo</Label>
          <select id="cuponTipo" value={kind} onChange={(e) => setKind(e.target.value as 'PUBLIC' | 'PRIVATE')} className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="cupon-tipo">
            <option value="PUBLIC">Público: cualquier cliente elegible</option>
            <option value="PRIVATE">Privado: de clientes concretos</option>
          </select>
        </div>
        {kind === 'PUBLIC' && (
          <>
            <div>
              <Label htmlFor="cuponCodigo">Código a medida (opcional)</Label>
              <Input id="cuponCodigo" name="codigo" maxLength={32} placeholder="COMIDA15" data-testid="cupon-codigo" />
              <p className="text-caption text-muted-foreground">Si lo dejas vacío se genera al azar.</p>
            </div>
            <div>
              <Label htmlFor="cuponCantidad">Cuántos generar</Label>
              <Input id="cuponCantidad" name="cantidad" type="number" min={1} max={1000} step={1} defaultValue={1} inputMode="numeric" data-testid="cupon-cantidad" />
            </div>
            <div>
              <Label htmlFor="cuponPrefijo">Prefijo de los aleatorios (opcional)</Label>
              <Input id="cuponPrefijo" name="prefijo" maxLength={16} placeholder="BIENVENIDO" />
            </div>
          </>
        )}
        {kind === 'PRIVATE' && (
          <div className="sm:col-span-2">
            <Label htmlFor="cuponCliente">Clientes</Label>
            <Input
              id="cuponCliente"
              value={consulta}
              onChange={(e) => {
                setConsulta(e.target.value)
                if (e.target.value.trim().length < 2) {
                  setResultados([])
                  return
                }
                buscar(async () => setResultados(await buscarClientesCampanaAction(e.target.value)))
              }}
              placeholder="Nombre o correo"
              autoComplete="off"
              data-testid="cupon-buscar-cliente"
            />
            {buscando && <p className="text-caption text-muted-foreground">Buscando…</p>}
            {resultados.length > 0 && (
              <ul className="mt-1 max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {resultados.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setElegidos((v) => (v.some((x) => x.id === c.id) ? v : [...v, c]))
                        setConsulta('')
                        setResultados([])
                      }}
                      data-testid="cupon-opcion-cliente"
                    >
                      {c.nombre} <span className="text-muted-foreground">· {c.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {elegidos.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1 text-caption" data-testid="cupon-clientes-elegidos">
                {elegidos.map((c) => (
                  <li key={c.id} className="rounded-full border border-border px-2 py-0.5">
                    {c.nombre}
                    <button type="button" className="ml-1 text-muted-foreground" onClick={() => setElegidos((v) => v.filter((x) => x.id !== c.id))} aria-label={`Quitar ${c.nombre}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <Label htmlFor="cuponMaxTotal">Usos totales (opcional)</Label>
          <Input id="cuponMaxTotal" name="maxRedemptions" type="number" min={1} step={1} inputMode="numeric" placeholder="100" data-testid="cupon-max-total" />
        </div>
        <div>
          <Label htmlFor="cuponMaxCliente">Usos por cliente</Label>
          <Input id="cuponMaxCliente" name="maxPerCustomer" type="number" min={1} step={1} defaultValue={1} inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor="cuponMinimo">Compra mínima ({moneda}, opcional)</Label>
          <Input id="cuponMinimo" name="minPurchase" type="number" min={0} step="0.01" inputMode="decimal" data-testid="cupon-minimo" />
        </div>
        <div>
          <Label htmlFor="cuponVence">Vence (opcional)</Label>
          <Input id="cuponVence" name="expiresAt" type="date" />
        </div>
      </div>
      <Button type="submit" disabled={pendiente || (kind === 'PRIVATE' && elegidos.length === 0)} loading={pendiente} data-testid="btn-generar-cupones">Generar</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      {generados.length > 0 && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm" data-testid="cupones-generados">
          <p className="font-medium">{generados.length} cupón(es) generado(s)</p>
          <p className="mt-1 break-words font-mono text-caption">{generados.join(' · ')}</p>
        </div>
      )}
    </form>
  )
}

export function CancelarCupon({ campaignId, couponId }: { campaignId: string; couponId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(cancelarCuponAction, {})
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  useAviso([estado])
  if (!abierto) {
    return <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(true)} data-testid="btn-cancelar-cupon">Cancelar</Button>
  }
  return (
    <form action={accion} className="space-y-1" data-testid="form-cancelar-cupon">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="couponId" value={couponId} />
      <Input name="motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo para cancelar el cupón" required />
      <Button type="submit" variant="destructive" size="sm" disabled={pendiente || motivo.trim().length === 0}>Cancelar cupón</Button>
      {estado.error && <p className="text-caption text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

/** Asignar la campaña completa a un cliente (público SELECTED, §14). */
export function FormAsignarCampana({ campaignId }: { campaignId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(asignarCampanaAction, {})
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<{ id: string; nombre: string; email: string }[]>([])
  const [elegido, setElegido] = useState<{ id: string; nombre: string; email: string } | null>(null)
  const [buscando, buscar] = useTransition()
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || visto.current === estado.success) return
    visto.current = estado.success
    toast.success(estado.success)
    setElegido(null)
    setConsulta('')
    router.refresh()
  }, [estado, router])

  return (
    <form action={accion} className="space-y-3" data-testid="form-asignar-campana">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="customerId" value={elegido?.id ?? ''} />
      <div>
        <Label htmlFor="clienteCampana">Cliente</Label>
        <Input
          id="clienteCampana"
          value={elegido ? `${elegido.nombre} · ${elegido.email}` : consulta}
          onChange={(e) => {
            setConsulta(e.target.value)
            setElegido(null)
            if (e.target.value.trim().length < 2) {
              setResultados([])
              return
            }
            buscar(async () => setResultados(await buscarClientesCampanaAction(e.target.value)))
          }}
          placeholder="Nombre o correo del cliente"
          autoComplete="off"
          data-testid="input-buscar-cliente-campana"
        />
        {buscando && <p className="text-caption text-muted-foreground">Buscando…</p>}
        {!elegido && resultados.length > 0 && (
          <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {resultados.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setElegido(c)} className="w-full px-3 py-2 text-left text-sm hover:bg-muted" data-testid="opcion-cliente-campana">
                  <span className="font-medium">{c.nombre}</span>
                  <span className="block text-caption text-muted-foreground">{c.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="usosCampana">Usos por promoción</Label>
          <Input id="usosCampana" name="usesAllowed" type="number" min={1} step={1} inputMode="numeric" placeholder="1" />
        </div>
        <div>
          <Label htmlFor="notaCampana">Nota interna (opcional)</Label>
          <Input id="notaCampana" name="note" maxLength={500} />
        </div>
      </div>
      <Button type="submit" disabled={pendiente || !elegido} loading={pendiente} data-testid="btn-asignar-campana">Asignar la campaña</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
