import Link from 'next/link'
import { BadgePercent, ExternalLink, History, ShoppingBag, Warehouse } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatearPrecio } from '@/modules/catalog/formato'
import { describirCambioDeCatalogo, ofertasVivas, type PanoramaDelItem } from '@/modules/comercio/panorama-item'
import { BADGE_ESTADO_STOCK, ETIQUETA_ESTADO_STOCK, formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { ETIQUETA_ESTADO_OFERTA } from '@/modules/deals/domain'
import { BADGE_ESTADO_OFERTA } from '@/modules/deals/formato'
import { formatearFechaHora } from '@/modules/orders/formato'

/**
 * Las secciones «Inventario», «Promociones», «Pedidos y ventas», «Marketplace»
 * e «Historial» de la ficha de un producto. Solo LEEN el panorama que arma
 * `panoramaDelItemEnTx`; cada acción enlaza al módulo dueño del dato.
 *
 * Es un componente de servidor: sin estado, sin Prisma (recibe los datos ya
 * leídos) y sin lógica de negocio.
 */
export function PanoramaComercial({
  itemNombre,
  itemSlug,
  moneda,
  publicado,
  enMarketplace,
  enPOS,
  panorama,
  puede,
}: {
  itemNombre: string
  itemSlug: string
  moneda: string
  publicado: boolean
  enMarketplace: boolean
  enPOS: boolean
  panorama: PanoramaDelItem
  puede: { inventario: boolean; ofertas: boolean; pedidos: boolean }
}) {
  const vivas = ofertasVivas(panorama.ofertas)
  const borradores = panorama.ofertas.filter((o) => o.status === 'DRAFT')
  const primeraVariante = panorama.stock[0]?.varianteId
  const urlPublica = `/empresas/${panorama.empresaSlug}/catalogo/${itemSlug}`
  const totalDisponible = panorama.stock.reduce((a, v) => a + v.totalDisponible, 0)
  const totalReservado = panorama.stock.reduce((a, v) => a + v.totalReservado, 0)

  return (
    <>
      {/* ── Inventario ─────────────────────────────────────────────────────── */}
      <Card id="inventario">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden />
            Inventario
          </CardTitle>
          {panorama.controlaInventario && puede.inventario && primeraVariante && (
            <Button asChild size="sm" variant="outline">
              <Link href={panorama.stock.length === 1 ? `/admin/inventario/${primeraVariante}` : `/admin/inventario?q=${encodeURIComponent(itemNombre)}`}>
                Administrar inventario
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!panorama.controlaInventario ? (
            <p className="text-sm text-muted-foreground">
              Este ítem no controla inventario: se vende sin contar existencias (lo normal en un servicio). Si es un producto físico con unidades,
              activa «Controla inventario» en «Cómo se comporta» y lleva las existencias por sucursal desde Inventario.
            </p>
          ) : panorama.stock.every((v) => v.sucursales.length === 0) ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Aún no tienes sucursales activas: el stock pertenece a una variante EN una sucursal.</p>
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/sucursales">Crear una sucursal</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(totalDisponible)}</p>
                  <p className="text-xs text-muted-foreground">disponible</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(totalReservado)}</p>
                  <p className="text-xs text-muted-foreground">apartado en pedidos</p>
                </div>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Existencias por sucursal">
                {panorama.stock.map((v) => (
                  <li key={v.varianteId} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{nombreCompleto(itemNombre, v.nombre, v.esDefault)}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant={BADGE_ESTADO_STOCK[v.estado]}>{ETIQUETA_ESTADO_STOCK[v.estado]}</Badge>
                        {puede.inventario && (
                          <Link href={`/admin/inventario/${v.varianteId}`} className="text-xs text-primary underline-offset-2 hover:underline">
                            Movimientos
                          </Link>
                        )}
                      </div>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                      {v.sucursales.map((s) => (
                        <div key={s.sucursalId} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1">
                          <dt className="truncate">{s.nombre}{!s.activa && ' (inactiva)'}</dt>
                          <dd className="tabular-nums font-medium text-foreground">
                            {formatearCantidad(s.disponible)}
                            {s.reserved > 0 && <span className="ml-1 font-normal text-muted-foreground">(+{formatearCantidad(s.reserved)} apart.)</span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Promociones ────────────────────────────────────────────────────── */}
      <Card id="promociones">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-muted-foreground" aria-hidden />
            Promociones
          </CardTitle>
          {puede.ofertas && primeraVariante && (
            <Button asChild size="sm" disabled={!publicado}>
              <Link href={`/admin/deals/nueva?variante=${encodeURIComponent(primeraVariante)}`}>Crear promoción</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {panorama.ofertas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin ofertas sobre este ítem. Una promoción referencia este mismo producto (no crea una copia) y el marketplace lo enseña con el precio de
              antes y el de ahora.{!publicado && ' Publícalo primero: solo se ofertan ítems publicados.'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Ofertas sobre este ítem">
              {[...vivas, ...borradores, ...panorama.ofertas.filter((o) => !vivas.includes(o) && !borradores.includes(o))].map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <Link href={`/admin/deals/${o.id}`} className="font-medium hover:underline">
                      {o.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {panorama.stock.length > 1 && `${o.variantName} · `}
                      {o.descuento} · <span className="line-through">{formatearPrecio(o.precioLista, moneda)}</span>{' '}
                      <span className="font-medium text-foreground">{formatearPrecio(o.precioOferta, moneda)}</span>
                      {' · '}
                      {o.claimsActive}/{o.maxClaims} obtenidas
                    </p>
                  </div>
                  <Badge variant={BADGE_ESTADO_OFERTA[o.status]}>{ETIQUETA_ESTADO_OFERTA[o.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Pedidos y ventas ───────────────────────────────────────────────── */}
      <Card id="pedidos">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-muted-foreground" aria-hidden />
            Pedidos y ventas
          </CardTitle>
          {puede.pedidos && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/pedidos-membego?q=${encodeURIComponent(itemNombre)}`}>Ver pedidos</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {panorama.ventas.pedidosEsperando > 0 && (
            <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-sm">
              <strong>{panorama.ventas.pedidosEsperando}</strong> pedido{panorama.ventas.pedidosEsperando === 1 ? '' : 's'} con este ítem espera{panorama.ventas.pedidosEsperando === 1 ? '' : 'n'} tu respuesta.
            </p>
          )}
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Pedidos (90 días)</dt>
              <dd className="text-xl font-semibold tabular-nums">{panorama.ventas.pedidos90d}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unidades vendidas</dt>
              <dd className="text-xl font-semibold tabular-nums">{panorama.ventas.unidadesVendidas90d}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ventas completadas</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatearPrecio(panorama.ventas.ventas90d, moneda)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Descuento concedido</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatearPrecio(panorama.ventas.descuentos90d, moneda)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* ── Marketplace ────────────────────────────────────────────────────── */}
      <Card id="marketplace">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
            Marketplace y canales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="flex flex-wrap gap-2" aria-label="Canales">
            <li>
              <Badge variant={publicado && enMarketplace ? 'success' : 'secondary'}>
                Marketplace {publicado && enMarketplace ? '✓' : '—'}
              </Badge>
            </li>
            <li>
              <Badge variant={publicado && enMarketplace ? 'success' : 'secondary'}>Perfil público {publicado && enMarketplace ? '✓' : '—'}</Badge>
            </li>
            <li>
              <Badge variant={publicado && enPOS ? 'success' : 'secondary'}>Caja (POS) {publicado && enPOS ? '✓' : '—'}</Badge>
            </li>
          </ul>
          {publicado && enMarketplace ? (
            <p className="text-muted-foreground">
              Los clientes lo ven en el marketplace y en tu perfil público.{' '}
              <Link href={urlPublica} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                Ver como cliente
              </Link>
              . El cliente nunca ve la cantidad exacta de stock, solo «Disponible», «Pocas unidades» o «Agotado».
            </p>
          ) : !publicado ? (
            <p className="text-muted-foreground">Está en borrador o pausado: no aparece en el marketplace hasta que lo publiques.</p>
          ) : (
            <p className="text-muted-foreground">Oculto del marketplace por «Cómo se comporta». Enciende «Visible en el marketplace» para publicarlo.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Historial ──────────────────────────────────────────────────────── */}
      <Card id="historial">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            Historial
          </CardTitle>
        </CardHeader>
        <CardContent>
          {panorama.historial.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>
          ) : (
            <ol className="divide-y divide-border text-sm" aria-label="Cambios del ítem">
              {panorama.historial.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>{describirCambioDeCatalogo(h)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatearFechaHora(h.fecha)}
                    {h.usuario && ` · ${h.usuario}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  )
}
