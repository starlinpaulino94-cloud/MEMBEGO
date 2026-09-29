'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearAcuerdoAction, type EstadoAccion } from '@/modules/supply/actions'
import {
  SUPPLY_ALCANCE_LABELS,
  SUPPLY_FRECUENCIA_CORTE_LABELS,
  SUPPLY_MODALIDAD_PAGO_LABELS,
  SUPPLY_POLITICA_SOBRANTE_LABELS,
  SUPPLY_TIPOS,
  SUPPLY_TIPO_ACUERDO_EXPLICACION,
  SUPPLY_TIPO_ACUERDO_LABELS,
  SUPPLY_TIPO_EJEMPLOS,
  SUPPLY_TIPO_LABELS,
} from '@/modules/supply/catalogo'

interface Proveedor {
  id: string
  nombre: string
  sucursales: { id: string; nombre: string }[]
}

type TipoAcuerdo = keyof typeof SUPPLY_TIPO_ACUERDO_LABELS
type Alcance = keyof typeof SUPPLY_ALCANCE_LABELS

/**
 * MEMBEGO SUPPLY · WIZARD de acuerdo (encargo 2026-09 bis, §3).
 *
 * Seis pasos sobre UN solo formulario: los campos de los pasos no activos se
 * ocultan, no se desmontan, así que lo escrito no se pierde y el envío final
 * lleva todo. El TIPO de acuerdo (paso 2) decide qué pide el paso 3: una
 * compra anticipada pide costo por unidad; una venta a comisión pide comisión
 * y precio público; un depósito abierto avisa de que el dinero se registra
 * después en Finanzas → Depósitos.
 *
 * El modelo comercial y la modalidad de pago se derivan del tipo en el
 * servidor (`derivarDeTipoAcuerdo`): el wizard los enseña, no los inventa.
 */
export function FormAcuerdo({ proveedores }: { proveedores: Proveedor[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearAcuerdoAction, {})
  const [paso, setPaso] = useState(1)
  const [proveedorId, setProveedorId] = useState(proveedores[0]?.id ?? '')
  const [tipoAcuerdo, setTipoAcuerdo] = useState<TipoAcuerdo>('COMPRA_PREPAGO')
  const [tipo, setTipo] = useState<(typeof SUPPLY_TIPOS)[number]>('ON_DEMAND')
  const [alcance, setAlcance] = useState<Alcance>('ITEM')
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')
  const [precio, setPrecio] = useState('')
  const [comision, setComision] = useState('')
  const [item, setItem] = useState('')

  const esComision = tipoAcuerdo === 'VENTA_COMISION'
  const esSubsidio = tipoAcuerdo === 'HIBRIDO'
  const esDeposito = tipoAcuerdo === 'DEPOSITO_ABIERTO'
  const modalidadPorDefecto = tipoAcuerdo === 'COMPRA_PREPAGO' ? 'PREPAGO_TOTAL' : esSubsidio ? 'SUBSIDIO' : 'PAGO_POR_REDENCION'
  const inversion = Number(cantidad) * Number(costo)
  const sucursales = proveedores.find((p) => p.id === proveedorId)?.sucursales ?? []
  const PASOS = ['Proveedor', 'Tipo', 'Economía', 'Producto', 'Condiciones', 'Resumen']

  if (proveedores.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay proveedores. Agrega uno en{' '}
        <Link href="/superadmin/supply/proveedores#nuevo" className="underline underline-offset-4">
          Proveedores → Nuevo proveedor
        </Link>{' '}
        (una empresa que ya opera en Membego o un proveedor externo) y vuelve aquí.
      </p>
    )
  }

  const oculto = (n: number) => (paso === n ? '' : 'hidden')
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <form action={accion} className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-sm">
        {PASOS.map((nombre, i) => (
          <li key={nombre}>
            <button
              type="button"
              onClick={() => setPaso(i + 1)}
              className={`rounded-full border px-3 py-1 ${paso === i + 1 ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
            >
              {i + 1}. {nombre}
            </button>
          </li>
        ))}
      </ol>

      {/* ── 1 · Proveedor ─────────────────────────────────────────────── */}
      <section className={`${oculto(1)} space-y-4`}>
        <div>
          <Label htmlFor="proveedorId">Proveedor</Label>
          <select id="proveedorId" name="proveedorId" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={select}>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <p className="mt-1 text-caption text-muted-foreground">
            ¿No está? Agrégalo en <Link href="/superadmin/supply/proveedores#nuevo" className="underline">Proveedores</Link>.
          </p>
        </div>
      </section>

      {/* ── 2 · Tipo ──────────────────────────────────────────────────── */}
      <section className={`${oculto(2)} space-y-4`}>
        <input type="hidden" name="tipoAcuerdo" value={tipoAcuerdo} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SUPPLY_TIPO_ACUERDO_LABELS) as TipoAcuerdo[]).map((t) => (
            <label key={t} className={`cursor-pointer rounded-lg border p-3 ${tipoAcuerdo === t ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input type="radio" name="tipoAcuerdoRadio" value={t} checked={tipoAcuerdo === t} onChange={() => setTipoAcuerdo(t)} className="mr-2" />
              <span className="font-medium">{SUPPLY_TIPO_ACUERDO_LABELS[t]}</span>
              <p className="mt-1 text-caption text-muted-foreground">{SUPPLY_TIPO_ACUERDO_EXPLICACION[t]}</p>
            </label>
          ))}
        </div>
        {esDeposito && (
          <p className="rounded-lg bg-muted/40 p-3 text-caption">
            El acuerdo fija las condiciones; el dinero se registra después en <strong>Finanzas → Depósitos</strong> contra este acuerdo, y cada compra o factura se aplica a su saldo.
          </p>
        )}
      </section>

      {/* ── 3 · Economía ──────────────────────────────────────────────── */}
      <section className={`${oculto(3)} space-y-4`}>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="moneda">Moneda</Label>
            <Input id="moneda" name="moneda" maxLength={3} defaultValue="DOP" />
          </div>
          <div>
            <Label htmlFor="cantidad">{esComision ? 'Tope de unidades a vender' : 'Cantidad'}</Label>
            <Input id="cantidad" name="cantidad" type="number" min={1} required value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="1000" />
          </div>
          {esComision ? (
            <>
              <div>
                <Label htmlFor="comisionPorcentaje">% comisión Membego</Label>
                <Input id="comisionPorcentaje" name="comisionPorcentaje" type="number" min={0.01} max={100} step="0.01" required value={comision} onChange={(e) => setComision(e.target.value)} placeholder="15" />
                <input type="hidden" name="costoUnitario" value="0" />
              </div>
              <div>
                <Label htmlFor="precioReferencia">Precio público (lo que paga el cliente)</Label>
                <Input id="precioReferencia" name="precioReferencia" type="number" min={0} step="0.01" required value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="700" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="costoUnitario">Precio negociado (costo Membego)</Label>
                <Input id="costoUnitario" name="costoUnitario" type="number" min={0} step="0.01" required value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="300" />
              </div>
              <div>
                <Label htmlFor="precioReferencia">Precio público</Label>
                <Input id="precioReferencia" name="precioReferencia" type="number" min={0} step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="700" />
              </div>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          {esSubsidio && (
            <div>
              <Label htmlFor="aporteMembego">Aporte Membego por unidad</Label>
              <Input id="aporteMembego" name="aporteMembego" type="number" min={0} step="0.01" placeholder="300" />
            </div>
          )}
          {!esComision && (
            <div>
              <Label htmlFor="comisionPorcentajeOpcional">% comisión (si aplica)</Label>
              <Input id="comisionPorcentajeOpcional" name="comisionPorcentaje" type="number" min={0} max={100} step="0.01" placeholder="0" />
            </div>
          )}
          <div>
            <Label htmlFor="descuentoPorcentaje">% descuento</Label>
            <Input id="descuentoPorcentaje" name="descuentoPorcentaje" type="number" min={0} max={100} step="0.01" placeholder="0" />
          </div>
          <div>
            <Label htmlFor="impuestoPorcentaje">% impuestos</Label>
            <Input id="impuestoPorcentaje" name="impuestoPorcentaje" type="number" min={0} max={100} step="0.01" placeholder="18" />
          </div>
          <div>
            <Label htmlFor="modalidadPago">Modalidad de pago</Label>
            <select id="modalidadPago" name="modalidadPago" key={modalidadPorDefecto} defaultValue={modalidadPorDefecto} className={select}>
              {(Object.keys(SUPPLY_MODALIDAD_PAGO_LABELS) as (keyof typeof SUPPLY_MODALIDAD_PAGO_LABELS)[]).map((m) => (
                <option key={m} value={m}>
                  {SUPPLY_MODALIDAD_PAGO_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="anticipoPorcentaje">% de anticipo</Label>
            <Input id="anticipoPorcentaje" name="anticipoPorcentaje" type="number" min={1} max={99} placeholder="30" />
          </div>
          <div>
            <Label htmlFor="plazoPagoDias">Plazo de pago (días)</Label>
            <Input id="plazoPagoDias" name="plazoPagoDias" type="number" min={0} max={365} step="1" placeholder="30" />
          </div>
          <div>
            <Label htmlFor="frecuenciaCorte">Frecuencia de corte</Label>
            <select id="frecuenciaCorte" name="frecuenciaCorte" defaultValue="" className={select}>
              <option value="">Sin definir</option>
              {(Object.keys(SUPPLY_FRECUENCIA_CORTE_LABELS) as (keyof typeof SUPPLY_FRECUENCIA_CORTE_LABELS)[]).map((f) => (
                <option key={f} value={f}>
                  {SUPPLY_FRECUENCIA_CORTE_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="condicionesPago">Términos de pago</Label>
            <Input id="condicionesPago" name="condicionesPago" maxLength={1000} placeholder="30% al firmar, resto a 30 días" />
          </div>
        </div>

        {!esComision && inversion > 0 && (
          <p className="rounded-lg bg-muted/40 p-3 text-sm">
            Inversión total: <strong className="tabular-nums">RD${inversion.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
            {precio && Number(precio) > Number(costo) ? ` · margen potencial por unidad RD$${(Number(precio) - Number(costo)).toLocaleString('es-DO')}` : ''}
          </p>
        )}
        {esComision && precio && comision && (
          <p className="rounded-lg bg-muted/40 p-3 text-sm">
            Por cada venta de RD${Number(precio).toLocaleString('es-DO')}: Membego retiene RD${((Number(precio) * Number(comision)) / 100).toLocaleString('es-DO', { maximumFractionDigits: 2 })} y el proveedor recibe RD${(Number(precio) - (Number(precio) * Number(comision)) / 100).toLocaleString('es-DO', { maximumFractionDigits: 2 })}.
          </p>
        )}
      </section>

      {/* ── 4 · Producto / alcance ────────────────────────────────────── */}
      <section className={`${oculto(4)} space-y-4`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="alcance">Sobre qué aplica</Label>
            <select id="alcance" name="alcance" value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)} className={select}>
              {(Object.keys(SUPPLY_ALCANCE_LABELS) as Alcance[]).map((a) => (
                <option key={a} value={a}>
                  {SUPPLY_ALCANCE_LABELS[a]}
                </option>
              ))}
            </select>
            {alcance !== 'ITEM' && (
              <p className="mt-1 text-caption text-muted-foreground">
                «15% sobre todo el menú»: hoy se contrata como venta a comisión con descuento; Membego no precompra unidades de todo un catálogo.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="tipo">Tipo de supply</Label>
            <select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as (typeof SUPPLY_TIPOS)[number])} className={select}>
              {SUPPLY_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {SUPPLY_TIPO_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-caption text-muted-foreground">{SUPPLY_TIPO_EJEMPLOS[tipo]}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label htmlFor="itemNombre">{alcance === 'ITEM' ? 'Qué se compra o vende' : alcance === 'CATEGORIA' ? 'Nombre de la categoría' : 'Descripción («todo el menú»)'}</Label>
            <Input id="itemNombre" name="itemNombre" required maxLength={200} value={item} onChange={(e) => setItem(e.target.value)} placeholder={alcance === 'ITEM' ? 'Pizza Grande Pepperoni' : alcance === 'CATEGORIA' ? 'Pizzas' : 'Todo el menú'} />
          </div>
          {alcance === 'CATEGORIA' ? (
            <div>
              <Label htmlFor="categoriaCodigo">Código de categoría</Label>
              <Input id="categoriaCodigo" name="categoriaCodigo" maxLength={80} placeholder="pizzas" />
            </div>
          ) : (
            <div>
              <Label htmlFor="varianteEtiqueta">Variante</Label>
              <Input id="varianteEtiqueta" name="varianteEtiqueta" maxLength={120} placeholder="Grande" />
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="itemDescripcion">Descripción para el cliente</Label>
          <Textarea id="itemDescripcion" name="itemDescripcion" rows={2} maxLength={1000} />
        </div>
      </section>

      {/* ── 5 · Condiciones ───────────────────────────────────────────── */}
      <section className={`${oculto(5)} space-y-4`}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="inicioAt">Inicio de vigencia</Label>
            <Input id="inicioAt" name="inicioAt" type="date" required />
          </div>
          <div>
            <Label htmlFor="finAt">Fin de vigencia</Label>
            <Input id="finAt" name="finAt" type="date" required />
          </div>
          <div>
            <Label htmlFor="politicaSobrante">Qué pasa con lo que sobre</Label>
            <select id="politicaSobrante" name="politicaSobrante" defaultValue="EXPIRAR" className={select}>
              {(Object.keys(SUPPLY_POLITICA_SOBRANTE_LABELS) as (keyof typeof SUPPLY_POLITICA_SOBRANTE_LABELS)[]).map((p) => (
                <option key={p} value={p}>
                  {SUPPLY_POLITICA_SOBRANTE_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="capacidadDiaria">Máximo por día</Label>
            <Input id="capacidadDiaria" name="capacidadDiaria" type="number" min={1} placeholder="50" />
          </div>
          <div>
            <Label htmlFor="capacidadHoraria">Máximo por hora</Label>
            <Input id="capacidadHoraria" name="capacidadHoraria" type="number" min={1} placeholder="10" />
          </div>
          <div>
            <Label htmlFor="horarioTexto">Horario</Label>
            <Input id="horarioTexto" name="horarioTexto" maxLength={120} placeholder="11:00-22:00" />
          </div>
        </div>
        {sucursales.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium">Sucursales donde se canjea</legend>
            <p className="mb-2 text-caption text-muted-foreground">Sin marcar ninguna, vale en todas las del proveedor.</p>
            <div className="flex flex-wrap gap-3">
              {sucursales.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="sucursalIds" value={s.id} />
                  {s.nombre}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="metodoLiquidacion">Método de liquidación</Label>
            <Input id="metodoLiquidacion" name="metodoLiquidacion" maxLength={120} placeholder="Transferencia bancaria" />
          </div>
          <div>
            <Label htmlFor="politicaDevoluciones">Política de devoluciones</Label>
            <Input id="politicaDevoluciones" name="politicaDevoluciones" maxLength={2000} placeholder="Reembolso total si no se entrega" />
          </div>
          <div>
            <Label htmlFor="slaTexto">SLA</Label>
            <Input id="slaTexto" name="slaTexto" maxLength={2000} placeholder="Entrega en 30 min desde el escaneo" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="reglasRedencion">Reglas de redención</Label>
            <Textarea id="reglasRedencion" name="reglasRedencion" rows={3} maxLength={2000} placeholder="QR de Membego obligatorio. No acumulable con otras promociones." />
          </div>
          <div>
            <Label htmlFor="reglasSustitucion">Sustituciones y extras</Label>
            <Textarea id="reglasSustitucion" name="reglasSustitucion" rows={3} maxLength={2000} placeholder="Sustituciones solo con aprobación. Los extras los paga el cliente." />
          </div>
        </div>
      </section>

      {/* ── 6 · Resumen ───────────────────────────────────────────────── */}
      <section className={`${oculto(6)} space-y-4`}>
        <dl className="grid gap-2 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
          <Resumen t="Proveedor" v={proveedores.find((p) => p.id === proveedorId)?.nombre ?? '—'} />
          <Resumen t="Tipo" v={SUPPLY_TIPO_ACUERDO_LABELS[tipoAcuerdo]} />
          <Resumen t="Alcance" v={SUPPLY_ALCANCE_LABELS[alcance]} />
          <Resumen t="Producto" v={item || '—'} />
          <Resumen t="Cantidad" v={cantidad || '—'} />
          <Resumen t={esComision ? 'Comisión' : 'Costo unitario'} v={esComision ? (comision ? `${comision}%` : '—') : costo ? `RD$${Number(costo).toLocaleString('es-DO')}` : '—'} />
          <Resumen t="Precio público" v={precio ? `RD$${Number(precio).toLocaleString('es-DO')}` : '—'} />
          {!esComision && inversion > 0 && <Resumen t="Inversión" v={`RD$${inversion.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`} />}
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Creando…' : 'Crear acuerdo en borrador'}
          </Button>
          <span className="text-caption text-muted-foreground">
            Nace en borrador: todavía no compromete nada. Después se envía a aprobación, se aprueba y se activa desde su ficha.
          </span>
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" disabled={paso === 1} onClick={() => setPaso((p) => Math.max(1, p - 1))}>
          ← Anterior
        </Button>
        {paso < 6 ? (
          <Button type="button" size="sm" onClick={() => setPaso((p) => Math.min(6, p + 1))}>
            Siguiente →
          </Button>
        ) : null}
      </div>

      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success">{estado.success}</p>}
    </form>
  )
}

function Resumen({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{t}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  )
}
