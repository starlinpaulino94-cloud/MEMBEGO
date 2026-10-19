'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  ajustarInventario,
  contarInventario,
  fijarObjetivoInventario,
  fijarUmbralInventario,
  moverEntreLotesInventario,
  registrarDanoInventario,
  registrarDevolucionInventario,
  registrarEntradaInventario,
  resolverDanadoInventario,
} from '@/modules/inventory/actions'
import { BADGE_ESTADO_STOCK, ETIQUETA_ESTADO_STOCK, OPERACIONES, formatearCantidad, type OperacionManual } from '@/modules/inventory/formato'
import { MOTIVO_OTRO, motivosDeClase } from '@/modules/inventory/motivos'
import { CODIGO_SIN_LOTE, esCodigoSinLote, normalizarCodigoLote } from '@/modules/inventory/lotes'
import type { LoteDelCatalogo, LoteVista } from '@/modules/inventory/lotes-queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import { LotesDeSucursal } from './LotesDeSucursal'
import { AsignarSeries } from './AsignarSeries'

export interface SaldoSucursalVista {
  sucursalId: string
  nombre: string
  activa: boolean
  onHand: number
  reserved: number
  damaged: number
  disponible: number
  lowStockThreshold: number
  /** INV-3c · «Llenar hasta»: 0 = sin objetivo. */
  targetStock: number
  estado: 'AGOTADO' | 'BAJO' | 'OK'
}

/** Lo que la tarjeta necesita saber de los lotes del producto (solo si lo lleva). */
export interface LotesParaTarjeta {
  exigeVencimiento: boolean
  /** INV-5c: el producto lleva SERIES: cada unidad es un lote con su número de serie. */
  series?: boolean
  /** Los lotes con existencias en ESTA sucursal, de lo que antes vence a lo que no vence. */
  deSucursal: LoteVista[]
  /** Todos los lotes del producto (para elegir el destino al mover unidades). */
  catalogo: LoteDelCatalogo[]
}

const OPERACIONES_QUE_ENTRAN: readonly OperacionManual[] = ['ENTRADA', 'DEVOLUCION', 'AJUSTE_SOBRANTE']
const OPERACIONES_QUE_SALEN: readonly OperacionManual[] = ['AJUSTE_FALTANTE', 'DANO', 'DANADO_VENDIBLE', 'DANADO_BAJA']
const OPERACIONES_DE_LO_DANADO: readonly OperacionManual[] = ['DANADO_VENDIBLE', 'DANADO_BAJA']

function Cifra({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: number; fuerte?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={fuerte ? 'text-2xl font-semibold tabular-nums' : 'text-lg tabular-nums'}>{formatearCantidad(valor)}</p>
    </div>
  )
}

/**
 * Las existencias de una variante en UNA sucursal, con el formulario de
 * movimientos manuales y el umbral de stock bajo. El estado de cada formulario
 * vive aquí; lo que hay en la base se refresca con `router.refresh()`.
 */
export function SucursalInventarioCard({
  varianteId,
  saldo,
  puedeAjustar,
  puedeCostos = false,
  hayOtrasConSaldo = false,
  lotes,
}: {
  varianteId: string
  saldo: SaldoSucursalVista
  puedeAjustar: boolean
  /** INV-3a: ¿puede registrar costos? Solo entonces la entrada ofrece el campo «Costo unitario». */
  puedeCostos?: boolean
  /** ¿Hay otras sucursales activas donde este producto ya tiene saldo? Solo entonces tiene sentido ofrecer aplicar el umbral a todas. */
  hayOtrasConSaldo?: boolean
  /** INV-5a: presente solo si el producto lleva lotes. */
  lotes?: LotesParaTarjeta
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [operacion, setOperacion] = useState<OperacionManual>('ENTRADA')
  // Cantidad y motivo son estado controlado: `form.reset()` devolvería el selector
  // de movimiento (también controlado) a su primera opción sin avisar a React.
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  // INV-4b: el motivo del catálogo (ajuste, daño, baja); `motivo` pasa a ser el detalle en texto libre.
  const [motivoCodigo, setMotivoCodigo] = useState('')
  const [costo, setCosto] = useState('')
  // INV-5a: el lote de lo que entra (código y vencimiento) o de lo que sale (el lote elegido; vacío = el que antes vence).
  const [loteCodigo, setLoteCodigo] = useState('')
  const [loteVence, setLoteVence] = useState('')
  const [loteSalida, setLoteSalida] = useState('')
  const clave = useRef(nuevaClave())
  const claveMover = useRef(nuevaClave())
  const k = saldo.sucursalId

  const def = OPERACIONES.find((o) => o.valor === operacion) ?? OPERACIONES[0]
  // Con lotes no hay conteo suelto (se cuenta lote por lote en un conteo de Inventario → Conteos): se ofrece todo lo demás.
  const disponibles = OPERACIONES.filter((o) => (!o.soloConDanados || saldo.damaged > 0) && !(lotes && o.valor === 'CONTEO'))
  const entra = lotes !== undefined && OPERACIONES_QUE_ENTRAN.includes(operacion)
  const sale = lotes !== undefined && OPERACIONES_QUE_SALEN.includes(operacion)
  // De qué lotes se puede sacar: lo disponible, o lo dañado si es lo dañado lo que se resuelve.
  const deDanados = OPERACIONES_DE_LO_DANADO.includes(operacion)
  const lotesDeLosQueSale = (lotes?.deSucursal ?? []).filter((l) => (deDanados ? l.damaged > 0 : l.disponible > 0))
  const codigoEscrito = normalizarCodigoLote(loteCodigo)
  const loteExistente = lotes && codigoEscrito.ok ? lotes.catalogo.find((l) => l.codigo === codigoEscrito.valor) : undefined
  const esSinLote = codigoEscrito.ok && esCodigoSinLote(codigoEscrito.valor)
  const conSeries = lotes?.series === true

  function registrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const numero = Number(cantidad.trim())
    if (cantidad.trim() === '' || !Number.isInteger(numero) || (operacion === 'CONTEO' ? numero < 0 : numero < 1)) {
      toast.error(operacion === 'CONTEO' ? 'Escribe cuántas unidades contaste (0 o más).' : 'Escribe una cantidad entera de 1 en adelante.')
      return
    }
    if (def.claseMotivo && motivoCodigo === '') {
      toast.error('Elige el motivo.')
      return
    }
    if (def.claseMotivo && motivoCodigo === MOTIVO_OTRO && motivo.trim() === '') {
      toast.error('Con «Otro» escribe el detalle: por sí solo no explica nada.')
      return
    }
    // INV-5a: los lotes. Lo que entra dice su lote (en una entrada es obligatorio; en una devolución o un sobrante, sin decirlo va al
    // legado o a donde salió); lo que sale dice de cuál (sin decirlo, el que antes vence).
    let delLote: { lotes?: unknown; lotesSalida?: unknown } = {}
    if (entra) {
      if (loteCodigo.trim() === '') {
        if (operacion === 'ENTRADA') {
          toast.error('Indica de qué lote es lo que llegó (o escribe SIN LOTE).')
          return
        }
      } else if (!codigoEscrito.ok) {
        toast.error(codigoEscrito.error)
        return
      } else if (conSeries && (esSinLote || numero !== 1)) {
        toast.error(esSinLote ? 'Un producto con series lleva el número de serie de cada unidad: «SIN LOTE» no es una serie.' : 'Una serie es una sola unidad: la cantidad es 1. Para varias, usa «Entrada de mercancía».')
        return
      } else {
        if (lotes.exigeVencimiento && !esSinLote && !loteExistente && loteVence === '') {
          toast.error('Este producto exige fecha de vencimiento en cada lote nuevo.')
          return
        }
        delLote = { lotes: [{ codigo: codigoEscrito.valor, vencimiento: esSinLote || loteExistente ? null : loteVence || null, cantidad: numero }] }
      }
    } else if (sale && loteSalida !== '') {
      delLote = { lotesSalida: [{ loteId: loteSalida, cantidad: numero }] }
    }
    const base = { varianteId, sucursalId: saldo.sucursalId, motivo, ...(def.claseMotivo ? { motivoCodigo } : {}), clave: clave.current, ...delLote }
    start(async () => {
      let r: { ok: true; mensaje: string } | { ok: false; error: string }
      switch (operacion) {
        case 'ENTRADA': {
          const x = await registrarEntradaInventario({ ...base, cantidad: numero, ...(puedeCostos && costo.trim() !== '' ? { costo: costo.trim() } : {}) })
          r = x.ok ? { ok: true, mensaje: `Entrada registrada. Disponible: ${formatearCantidad(x.saldo.disponible)}.` } : x
          break
        }
        case 'DEVOLUCION': {
          const x = await registrarDevolucionInventario({ ...base, cantidad: numero })
          r = x.ok ? { ok: true, mensaje: `Devolución registrada. Disponible: ${formatearCantidad(x.saldo.disponible)}.` } : x
          break
        }
        case 'AJUSTE_SOBRANTE':
        case 'AJUSTE_FALTANTE': {
          const x = await ajustarInventario({ ...base, cambio: operacion === 'AJUSTE_SOBRANTE' ? numero : -numero })
          r = x.ok ? { ok: true, mensaje: `Ajuste registrado. Disponible: ${formatearCantidad(x.saldo.disponible)}.` } : x
          break
        }
        case 'CONTEO': {
          const x = await contarInventario({ varianteId, sucursalId: saldo.sucursalId, conteo: numero, motivo })
          r = x.ok
            ? { ok: true, mensaje: x.diferencia === 0 ? 'El conteo coincide con el sistema: no hubo cambios.' : `Conteo registrado (${x.diferencia > 0 ? '+' : '−'}${formatearCantidad(Math.abs(x.diferencia))}).` }
            : x
          break
        }
        case 'DANO': {
          const x = await registrarDanoInventario({ ...base, cantidad: numero })
          r = x.ok ? { ok: true, mensaje: `Daño registrado. Dañado: ${formatearCantidad(x.saldo.damaged)}.` } : x
          break
        }
        case 'DANADO_VENDIBLE':
        case 'DANADO_BAJA': {
          const x = await resolverDanadoInventario({ ...base, cantidad: numero, destino: operacion === 'DANADO_VENDIBLE' ? 'VENDIBLE' : 'BAJA' })
          r = x.ok ? { ok: true, mensaje: `Listo. Dañado: ${formatearCantidad(x.saldo.damaged)}.` } : x
          break
        }
      }
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.mensaje)
      clave.current = nuevaClave()
      setCantidad('')
      setMotivo('')
      setMotivoCodigo('')
      setCosto('')
      setLoteCodigo('')
      setLoteVence('')
      setLoteSalida('')
      router.refresh()
    })
  }

  function moverLotes(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // `currentTarget` ya no existe cuando termina la acción: se guarda antes.
    const formulario = e.currentTarget
    const f = new FormData(formulario)
    const deLoteId = String(f.get('deLote') ?? '')
    const aLoteId = String(f.get('aLote') ?? '')
    const cantidadMover = Number(String(f.get('cantidad') ?? '').trim())
    if (deLoteId === '' || aLoteId === '') {
      toast.error('Elige el lote de origen y el de destino.')
      return
    }
    if (!Number.isInteger(cantidadMover) || cantidadMover < 1) {
      toast.error('Escribe una cantidad entera de 1 en adelante.')
      return
    }
    start(async () => {
      const r = await moverEntreLotesInventario({ varianteId, sucursalId: saldo.sucursalId, deLoteId, aLoteId, cantidad: cantidadMover, clave: claveMover.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Listo: ${formatearCantidad(cantidadMover)} unidad${cantidadMover === 1 ? '' : 'es'} pasaron de un lote a otro.`)
      claveMover.current = nuevaClave()
      formulario.reset()
      router.refresh()
    })
  }

  function guardarUmbral(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const umbral = Number(String(f.get('umbral') ?? '').trim())
    const aplicarAOtras = f.get('aplicarAOtras') === 'on'
    if (!Number.isInteger(umbral) || umbral < 0) {
      toast.error('El umbral es un número entero, 0 o más.')
      return
    }
    start(async () => {
      const r = await fijarUmbralInventario({ varianteId, sucursalId: saldo.sucursalId, umbral, aplicarAOtras })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const base = r.umbral === 0 ? 'Sin aviso de stock bajo.' : `Te avisaremos cuando queden ${formatearCantidad(r.umbral)} o menos.`
      toast.success(r.otras > 0 ? `${base} También se aplicó en ${r.otras} ${r.otras === 1 ? 'sucursal más' : 'sucursales más'}.` : base)
      router.refresh()
    })
  }

  function guardarObjetivo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const llenarHasta = Number(String(f.get('llenarHasta') ?? '').trim())
    const aplicarAOtras = f.get('aplicarAOtras') === 'on'
    if (!Number.isInteger(llenarHasta) || llenarHasta < 0) {
      toast.error('«Llenar hasta» es un número entero, 0 o más.')
      return
    }
    start(async () => {
      const r = await fijarObjetivoInventario({ varianteId, sucursalId: saldo.sucursalId, llenarHasta, aplicarAOtras })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const base = r.llenarHasta === 0 ? 'Sin objetivo: este producto no saldrá en Reposición.' : `Reposición propondrá pedir hasta tener ${formatearCantidad(r.llenarHasta)}.`
      toast.success(r.otras > 0 ? `${base} También se aplicó en ${r.otras} ${r.otras === 1 ? 'sucursal más' : 'sucursales más'}.` : base)
      router.refresh()
    })
  }

  return (
    <Card data-sucursal={saldo.nombre}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          {saldo.nombre}
          {!saldo.activa && <span className="ml-2 text-xs font-normal text-muted-foreground">(sucursal desactivada)</span>}
        </CardTitle>
        <Badge variant={BADGE_ESTADO_STOCK[saldo.estado]}>{ETIQUETA_ESTADO_STOCK[saldo.estado]}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label={`Existencias en ${saldo.nombre}`}>
          <Cifra etiqueta="Disponible" valor={saldo.disponible} fuerte />
          <Cifra etiqueta="Apartado" valor={saldo.reserved} />
          <Cifra etiqueta="Dañado" valor={saldo.damaged} />
          <Cifra etiqueta="En existencia" valor={saldo.onHand} />
        </div>

        {lotes && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{conSeries ? 'Series en esta sucursal' : 'Lotes en esta sucursal'}</p>
            <LotesDeSucursal lotes={lotes.deSucursal} sucursal={saldo.nombre} series={conSeries} corregir={puedeAjustar ? { exigeVencimiento: lotes.exigeVencimiento } : undefined} />
            <p className="text-xs text-muted-foreground">
              {conSeries
                ? 'Cada serie es una sola unidad. Se vende primero la más antigua; busca una serie con su historia en Inventario → Reportes → Buscar una serie.'
                : 'Se vende, se aparta y se saca primero lo que antes vence. Lo vencido no se vende y el barrido diario lo pasa a dañado.'}
            </p>
          </div>
        )}

        {puedeAjustar ? (
          <>
            <form onSubmit={registrar} className="space-y-3 border-t pt-4" aria-label={`Registrar movimiento en ${saldo.nombre}`}>
              <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor={`op-${k}`}>Movimiento</Label>
                  <select
                    id={`op-${k}`}
                    value={operacion}
                    onChange={(e) => {
                      setOperacion(e.target.value as OperacionManual)
                      // Los motivos dependen de la operación: el que se había elegido puede no servir para la nueva.
                      setMotivoCodigo('')
                    }}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    {disponibles.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`cant-${k}`}>{def.campo}</Label>
                  <Input id={`cant-${k}`} name="cantidad" inputMode="numeric" autoComplete="off" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{def.ayuda}</p>
              {entra && lotes && (
                <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`lote-${k}`}>{conSeries ? (operacion === 'ENTRADA' ? 'Serie *' : 'Serie (opcional)') : operacion === 'ENTRADA' ? 'Lote *' : 'Lote (opcional)'}</Label>
                    <Input
                      id={`lote-${k}`}
                      name="lote"
                      list={`lotes-${k}`}
                      autoComplete="off"
                      maxLength={60}
                      value={loteCodigo}
                      onChange={(e) => setLoteCodigo(e.target.value)}
                      placeholder={conSeries ? 'Número de serie de la unidad' : operacion === 'ENTRADA' ? `Código del empaque, o ${CODIGO_SIN_LOTE}` : operacion === 'DEVOLUCION' ? 'Vacío: vuelve al lote de que salió' : `Vacío: va a ${CODIGO_SIN_LOTE}`}
                    />
                    <datalist id={`lotes-${k}`}>
                      {lotes.catalogo.map((l) => (
                        <option key={l.loteId} value={l.codigo} />
                      ))}
                    </datalist>
                  </div>
                  {!conSeries && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`vence-${k}`}>{lotes.exigeVencimiento && !esSinLote && !loteExistente ? 'Vence *' : 'Vence (opcional)'}</Label>
                      <Input
                        id={`vence-${k}`}
                        name="vence"
                        type="date"
                        value={loteExistente ? (loteExistente.vencimiento ?? '') : esSinLote ? '' : loteVence}
                        disabled={esSinLote || loteExistente !== undefined}
                        onChange={(e) => setLoteVence(e.target.value)}
                      />
                    </div>
                  )}
                  {loteExistente && !conSeries && (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Ese lote ya existe: {loteExistente.vencimiento ? `vence el ${loteExistente.vencimiento}` : 'no vence'}. Un lote tiene un solo vencimiento.
                    </p>
                  )}
                </div>
              )}
              {sale && lotes && (
                <div className="space-y-1.5">
                  <Label htmlFor={`lote-salida-${k}`}>{conSeries ? 'De qué serie' : 'De qué lote'}</Label>
                  <select id={`lote-salida-${k}`} name="loteSalida" value={loteSalida} onChange={(e) => setLoteSalida(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    <option value="">{conSeries ? 'Automático (la más antigua)' : deDanados ? 'Automático (el que antes vence)' : 'Automático (el que antes vence, sin lo vencido)'}</option>
                    {lotesDeLosQueSale.map((l) => (
                      <option key={l.loteId} value={l.loteId}>
                        {l.codigo} · {conSeries ? '' : `${l.textoVencimiento} · `}{formatearCantidad(deDanados ? l.damaged : l.disponible)} {deDanados ? 'dañada(s)' : 'disponible(s)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {puedeCostos && operacion === 'ENTRADA' && (
                <div className="space-y-1.5">
                  <Label htmlFor={`costo-${k}`}>Costo unitario (opcional)</Label>
                  <Input id={`costo-${k}`} name="costo" inputMode="decimal" autoComplete="off" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Ej: 12.50, sin impuestos" className="w-48" />
                  <p className="text-xs text-muted-foreground">Con costo, el costo promedio del producto se actualiza; sin él, no cambia.</p>
                </div>
              )}
              {def.claseMotivo ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`motivo-codigo-${k}`}>Motivo *</Label>
                    <select
                      id={`motivo-codigo-${k}`}
                      name="motivoCodigo"
                      required
                      value={motivoCodigo}
                      onChange={(e) => setMotivoCodigo(e.target.value)}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Elige el motivo…</option>
                      {motivosDeClase(def.claseMotivo).map((m) => (
                        <option key={m.codigo} value={m.codigo}>
                          {m.etiqueta}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`motivo-${k}`}>{motivoCodigo === MOTIVO_OTRO ? 'Detalle *' : 'Detalle (opcional)'}</Label>
                    <Input
                      id={`motivo-${k}`}
                      name="motivo"
                      maxLength={300}
                      required={motivoCodigo === MOTIVO_OTRO}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder={motivoCodigo === MOTIVO_OTRO ? 'Qué pasó' : 'Ej: lote 12, estante 3'}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor={`motivo-${k}`}>{def.motivoObligatorio ? 'Motivo *' : 'Motivo (opcional)'}</Label>
                  <Input id={`motivo-${k}`} name="motivo" maxLength={300} required={def.motivoObligatorio} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={def.motivoObligatorio ? 'Qué pasó' : 'Ej: factura 123 del proveedor'} />
                </div>
              )}
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Registrar
              </Button>
            </form>

            {conSeries && (lotes?.deSucursal.find((l) => l.legado)?.disponible ?? 0) > 0 && (
              <AsignarSeries varianteId={varianteId} sucursalId={saldo.sucursalId} sucursal={saldo.nombre} sinSerie={lotes?.deSucursal.find((l) => l.legado)?.disponible ?? 0} />
            )}
            {lotes && !conSeries && lotes.deSucursal.some((l) => l.disponible > 0) && (
              <form onSubmit={moverLotes} className="space-y-3 border-t pt-4" aria-label={`Mover unidades entre lotes en ${saldo.nombre}`}>
                <p className="text-sm font-medium">Mover unidades de un lote a otro</p>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`mover-de-${k}`}>Del lote</Label>
                    <select id={`mover-de-${k}`} name="deLote" defaultValue="" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      <option value="">Elige el lote…</option>
                      {lotes.deSucursal
                        .filter((l) => l.disponible > 0)
                        .map((l) => (
                          <option key={l.loteId} value={l.loteId}>
                            {l.codigo} · {formatearCantidad(l.disponible)} disponible(s)
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`mover-a-${k}`}>Al lote</Label>
                    <select id={`mover-a-${k}`} name="aLote" defaultValue="" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      <option value="">Elige el lote…</option>
                      {lotes.catalogo.map((l) => (
                        <option key={l.loteId} value={l.loteId}>
                          {l.codigo} · {l.textoVencimiento}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`mover-cant-${k}`}>Cantidad</Label>
                    <Input id={`mover-cant-${k}`} name="cantidad" inputMode="numeric" autoComplete="off" />
                  </div>
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={pending}>
                  Mover
                </Button>
                <p className="text-xs text-muted-foreground">
                  Sirve para corregir un lote mal capturado: sus unidades pasan a otro lote y queda el rastro. No cuenta como merma. Para un lote nuevo, recíbelo primero con una entrada.
                </p>
              </form>
            )}

            <form onSubmit={guardarUmbral} className="flex flex-wrap items-end gap-3 border-t pt-4" aria-label={`Umbral de stock bajo en ${saldo.nombre}`}>
              <div className="space-y-1.5">
                <Label htmlFor={`umbral-${k}`}>Avisar cuando queden</Label>
                <Input id={`umbral-${k}`} name="umbral" inputMode="numeric" defaultValue={saldo.lowStockThreshold} className="w-32" />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                Guardar umbral
              </Button>
              {hayOtrasConSaldo && (
                <label className="flex basis-full items-center gap-2 text-sm">
                  <input type="checkbox" name="aplicarAOtras" className="h-4 w-4" />
                  Aplicar también a las otras sucursales donde este producto ya tiene existencias
                </label>
              )}
              <p className="basis-full text-xs text-muted-foreground">0 = sin aviso. Cuenta lo disponible (sin lo apartado).</p>
            </form>

            <form onSubmit={guardarObjetivo} className="flex flex-wrap items-end gap-3 border-t pt-4" aria-label={`Llenar hasta en ${saldo.nombre}`}>
              <div className="space-y-1.5">
                <Label htmlFor={`llenar-${k}`}>Llenar hasta</Label>
                <Input id={`llenar-${k}`} name="llenarHasta" inputMode="numeric" defaultValue={saldo.targetStock} className="w-32" />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                Guardar objetivo
              </Button>
              {hayOtrasConSaldo && (
                <label className="flex basis-full items-center gap-2 text-sm">
                  <input type="checkbox" name="aplicarAOtras" className="h-4 w-4" />
                  Aplicar también a las otras sucursales donde este producto ya tiene existencias
                </label>
              )}
              <p className="basis-full text-xs text-muted-foreground">
                Hasta cuánto quieres tener aquí. 0 = sin objetivo. En Reposición se propone pedir lo que falta para llegar, descontando lo ya pedido y lo que va en camino. Tiene que ser mayor que el umbral de aviso.
              </p>
            </form>
          </>
        ) : (
          <p className="border-t pt-4 text-sm text-muted-foreground">No tienes permiso para mover existencias.</p>
        )}
      </CardContent>
    </Card>
  )
}
