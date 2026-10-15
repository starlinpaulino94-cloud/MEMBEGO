import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ChevronLeft, Coins, ShoppingCart, Truck } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { detalleVarianteEnTx, enTransitoDeVarianteEnTx, historialDeVarianteEnTx, reservasVivasEnTx, type EnTransitoDeVariante } from '@/modules/inventory/queries'
import { advertenciaEstadoManual, formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { formatDate, formatDateTime } from '@/lib/format'
import { pedidoEnCaminoDeVarianteEnTx, proveedoresActivosEnTx, proveedoresDeVarianteEnTx, type OpcionProveedor, type PedidoDeVariante, type ProveedorDeProducto } from '@/modules/inventory/compras-queries'
import { costoDeVarianteEnTx, type CostoDeVarianteVista } from '@/modules/inventory/valor'
import { CorregirCostoForm } from '@/components/inventario/CorregirCostoForm'
import { ProveedoresDeProductoCard } from '@/components/inventario/ProveedoresDeProductoCard'
import { SucursalInventarioCard } from '@/components/inventario/SucursalInventarioCard'
import { TransferirForm } from '@/components/inventario/TransferirForm'
import { HistorialMovimientos } from '@/components/inventario/HistorialMovimientos'

export const dynamic = 'force-dynamic'

export default async function InventarioVariantePage({ params }: { params: Promise<{ varianteId: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { varianteId } = await params

  const datos = await conEmpresa(companyId, async (tx) => {
    const detalle = await detalleVarianteEnTx(tx, companyId, varianteId)
    if (!detalle) return null
    return {
      detalle,
      historial: await historialDeVarianteEnTx(tx, companyId, varianteId),
      reservas: await reservasVivasEnTx(tx, companyId, varianteId),
    }
  })
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos) notFound()
  const { detalle, historial, reservas } = datos
  // Lo que va EN CAMINO entre sucursales (INV-2c). En su PROPIA transacción y con su propio try: un error dentro de una
  // transacción de PostgreSQL la aborta entera, y si la migración de transferencias aún no se aplicó la ficha tiene que
  // seguir funcionando, solo que sin esta tarjeta.
  let enTransito: EnTransitoDeVariante | null = null
  if (detalle.controlaInventario) {
    try {
      enTransito = await conEmpresa(companyId, (tx) => enTransitoDeVarianteEnTx(tx, companyId, varianteId))
    } catch (e) {
      console.error('[admin-inventario-ficha] lo que va en camino no está disponible', e instanceof Error ? e.message : e)
    }
  }
  const [puedeAjustar, puedeTransferir, puedeCostos, puedeComprar] = await Promise.all([puedeFuncion('inventario', 'ajustar'), puedeFuncion('inventario', 'transferir'), puedeFuncion('inventario', 'costos'), puedeFuncion('inventario', 'comprar')])
  // El costo y el valor (INV-3a): solo con la función `costos`, y leído —como lo que va en camino— en su PROPIA transacción y con
  // su propio try: si algo falla, la ficha sigue funcionando sin esta tarjeta.
  let costo: CostoDeVarianteVista | null = null
  if (puedeCostos && detalle.controlaInventario) {
    try {
      costo = await conEmpresa(companyId, (tx) => costoDeVarianteEnTx(tx, companyId, varianteId))
    } catch (e) {
      console.error('[admin-inventario-ficha] el costo no está disponible', e instanceof Error ? e.message : e)
    }
  }

  // Los proveedores del producto y lo que está pedido (INV-3b): solo con la función `comprar` (traen costos) y, como lo anterior,
  // en su PROPIA transacción y con su propio try: si la migración de compras aún no se aplicó, la ficha sigue funcionando.
  let compras: { proveedores: ProveedorDeProducto[]; opciones: OpcionProveedor[]; pedido: PedidoDeVariante } | null = null
  if (puedeComprar && detalle.controlaInventario) {
    try {
      compras = await conEmpresa(companyId, async (tx) => ({
        proveedores: await proveedoresDeVarianteEnTx(tx, companyId, varianteId),
        opciones: await proveedoresActivosEnTx(tx, companyId),
        pedido: await pedidoEnCaminoDeVarianteEnTx(tx, companyId, varianteId),
      }))
    } catch (e) {
      console.error('[admin-inventario-ficha] los proveedores no están disponibles', e instanceof Error ? e.message : e)
    }
  }

  const activas = detalle.sucursales.filter((s) => s.activa)
  const total = detalle.sucursales.reduce(
    (t, s) => ({ disponible: t.disponible + s.disponible, reserved: t.reserved + s.reserved, damaged: t.damaged + s.damaged, onHand: t.onHand + s.onHand }),
    { disponible: 0, reserved: 0, damaged: 0, onHand: 0 }
  )
  const historialSerializable = {
    siguiente: historial.siguiente,
    filas: historial.filas.map((f) => ({ ...f, creadoEn: f.creadoEn.toISOString() })),
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Inventario
          </Link>
        }
        title={nombreCompleto(detalle.itemNombre, detalle.nombreVariante, detalle.esDefault)}
        description={`SKU ${detalle.sku}`}
        action={
          <Link href={`/admin/catalogo/${detalle.itemId}`} className="text-sm underline">
            Ver en el catálogo
          </Link>
        }
      />

      {!detalle.controlaInventario && (
        <Alert>
          <AlertDescription>
            Este producto no controla inventario, así que no se pueden registrar movimientos. Actívalo en{' '}
            <Link href={`/admin/catalogo/${detalle.itemId}`} className="underline">
              su ficha del catálogo
            </Link>
            . El historial se conserva.
          </AlertDescription>
        </Alert>
      )}

      {detalle.controlaInventario && advertenciaEstadoManual(detalle.estadoVariante, total.disponible) && (
        <Alert className="border-warning/40">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
          <AlertDescription>
            {advertenciaEstadoManual(detalle.estadoVariante, total.disponible)}{' '}
            <Link href={`/admin/catalogo/${detalle.itemId}`} className="underline">
              Cambiar su estado en el catálogo
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Totales de todas las sucursales">
        {(
          [
            ['Disponible', total.disponible],
            ['Apartado', total.reserved],
            ['Dañado', total.damaged],
            ['En existencia', total.onHand],
          ] as const
        ).map(([etiqueta, valor]) => (
          <Card key={etiqueta}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{etiqueta} (total)</p>
              <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(valor)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {enTransito && enTransito.total > 0 && (
        <Card aria-label="Lo que va en camino">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4" aria-hidden />
              En camino entre sucursales ({formatearCantidad(enTransito.total)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Transferencias en camino de este producto">
              {enTransito.traslados.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {formatearCantidad(t.pendiente)} de {t.origenNombre} a {t.destinoNombre}
                  </span>
                  <Link href={`/admin/inventario/transferencias/${t.id}`} className="text-xs underline underline-offset-2">
                    {t.numero}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">Ya salieron del origen y todavía no llegan al destino: no están disponibles en ninguna sucursal, así que no suman en los totales de arriba.</p>
          </CardContent>
        </Card>
      )}

      {compras && compras.pedido.total > 0 && (
        <Card aria-label="Lo que está pedido a proveedores">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" aria-hidden />
              Pedido a proveedores ({formatearCantidad(compras.pedido.total)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Órdenes de compra con este producto por llegar">
              {compras.pedido.ordenes.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {formatearCantidad(o.pendiente)} de {o.proveedorNombre} para {o.sucursalNombre}
                    {o.previstaEn && <span className="text-xs text-muted-foreground"> · prevista {formatDate(o.previstaEn, { zonaHoraria: 'UTC' })}</span>}
                  </span>
                  <Link href={`/admin/inventario/compras/${o.id}`} className="text-xs underline underline-offset-2">
                    {o.numero}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">Ya se pidió y todavía no ha llegado: no está en el inventario, así que no suma en los totales de arriba.</p>
          </CardContent>
        </Card>
      )}

      {costo && (
        <Card aria-label="Costo y valor del producto">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" aria-hidden />
              Costo y valor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Costo vigente</p>
                <p className="text-lg font-semibold tabular-nums">{costo.costo ?? 'Sin costo'}</p>
                <p className="text-xs text-muted-foreground">{costo.fuente === 'PROMEDIO' ? 'promedio de las entradas' : costo.fuente === 'REFERENCIA' ? 'referencia del catálogo' : 'no suma al valor'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Valor de lo que hay</p>
                <p className="text-lg font-semibold tabular-nums">{costo.valor ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{formatearCantidad(costo.unidades)} unidades</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Último costo de entrada</p>
                <p className="text-lg tabular-nums">{costo.ultimoCosto ?? '—'}</p>
                {costo.ultimoCostoEn && <p className="text-xs text-muted-foreground">{formatDateTime(costo.ultimoCostoEn)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Referencia del catálogo</p>
                <p className="text-lg tabular-nums">{costo.referencia ?? '—'}</p>
              </div>
            </div>
            {costo.fuente === null && detalle.sucursales.length > 0 && (
              <Alert className="border-warning/40">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                <AlertDescription>
                  Este producto no tiene costo: lo que hay de él no suma al valor del inventario y sus ventas quedan sin costo. Registra una entrada con costo o fíjalo aquí abajo.
                </AlertDescription>
              </Alert>
            )}
            {detalle.sucursales.some((s) => s.nivelId !== null) ? (
              <CorregirCostoForm varianteId={detalle.varianteId} costoActual={costo.costo} />
            ) : (
              <p className="text-xs text-muted-foreground">Este producto todavía no ha tenido existencias: su costo de referencia se escribe en su ficha del catálogo.</p>
            )}
            {costo.correcciones.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">Últimas correcciones</p>
                <ul className="divide-y rounded-lg border text-sm" aria-label="Correcciones del costo">
                  {costo.correcciones.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-2.5">
                      <span>
                        {c.anterior ?? 'sin costo'} → <strong className="tabular-nums">{c.nuevo}</strong> <span className="text-xs text-muted-foreground">· {c.motivo}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(c.creadoEn)} · {c.autor ?? 'Sistema'} · {formatearCantidad(c.unidades)} unidades
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Corregir el costo cambia lo que vale el inventario y el costo de las ventas desde ahora; las ventas y movimientos que ya ocurrieron conservan el costo con que se valoraron.
            </p>
          </CardContent>
        </Card>
      )}

      {compras && (
        <Card aria-label="Proveedores de este producto">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" aria-hidden />
              Proveedores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProveedoresDeProductoCard
              varianteId={detalle.varianteId}
              opciones={compras.opciones}
              proveedores={compras.proveedores.map((p) => ({ ...p, ultimoCostoEn: p.ultimoCostoEn ? formatDate(p.ultimoCostoEn) : null }))}
            />
          </CardContent>
        </Card>
      )}

      {detalle.controlaInventario && (
        <>
          {activas.length === 0 && detalle.sucursales.length === 0 && (
            <Alert>
              <AlertDescription>
                Para llevar existencias necesitas una sucursal activa.{' '}
                <Link href="/admin/sucursales" className="underline">
                  Ir a sucursales
                </Link>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {detalle.sucursales.map((s) => (
              <SucursalInventarioCard
                key={s.sucursalId}
                varianteId={detalle.varianteId}
                puedeAjustar={puedeAjustar}
                puedeCostos={puedeCostos}
                hayOtrasConSaldo={detalle.sucursales.some((o) => o.activa && o.sucursalId !== s.sucursalId && o.nivelId !== null)}
                saldo={{ sucursalId: s.sucursalId, nombre: s.nombre, activa: s.activa, onHand: s.onHand, reserved: s.reserved, damaged: s.damaged, disponible: s.disponible, lowStockThreshold: s.lowStockThreshold, estado: s.estado }}
              />
            ))}
          </div>
          {activas.length > 1 && puedeTransferir && (
            <TransferirForm varianteId={detalle.varianteId} sucursales={activas.map((s) => ({ id: s.sucursalId, nombre: s.nombre, disponible: s.disponible }))} />
          )}
        </>
      )}

      {reservas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reservas vivas ({reservas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Reservas vivas">
              {reservas.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {formatearCantidad(r.cantidad)} en {r.sucursalNombre}
                    {r.referenciaTipo === 'ORDER' && r.referenciaId ? (
                      <>
                        {' · '}
                        <Link href={`/admin/pedidos-membego/${r.referenciaId}`} className="underline underline-offset-2">
                          ver el pedido
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">vence {formatDateTime(r.expiresAt)}</span>
                </li>
              ))}
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">Las reservas las crean los pedidos del marketplace: se consumen al entregar con el QR, se liberan al cancelar y vencen solas si nadie las toca.</p>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="historial">
        <h2 id="historial" className="mb-3 text-lg font-semibold">
          Historial de movimientos
        </h2>
        {/* La clave remonta el historial cuando entra un movimiento nuevo: su estado local no se enteraría del refresh. */}
        <HistorialMovimientos key={historialSerializable.filas[0]?.id ?? 'vacio'} varianteId={detalle.varianteId} inicial={historialSerializable} />
      </section>
    </div>
  )
}
