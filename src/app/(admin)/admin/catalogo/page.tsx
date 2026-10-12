import Link from 'next/link'
import { ImageIcon, Package, Plus, Search } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { paginarItemsEnTx, type PaginaItems } from '@/modules/catalog/queries'
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, formatearPrecio, urlPublicaCatalogo } from '@/modules/catalog/formato'
import { BADGE_ESTADO_STOCK, ETIQUETA_ESTADO_STOCK } from '@/modules/inventory/formato'
import { resumenDeStock } from '@/modules/comercio/stock'

export const dynamic = 'force-dynamic'

const ESTADOS = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const
const TIPOS = Object.keys(ETIQUETA_TIPO)

const VARIANTE_BADGE: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'outline'> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'outline',
}

function enlace(base: Record<string, string | undefined>, cambios: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...cambios })) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `/admin/catalogo?${s}` : '/admin/catalogo'
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const sp = await searchParams

  // Lo que llega por la URL es texto libre: solo se aceptan los valores conocidos.
  const estado = ESTADOS.find((e) => e === sp.estado)
  const tipo = TIPOS.includes(sp.tipo ?? '') ? (sp.tipo as keyof typeof ETIQUETA_TIPO) : undefined
  const q = sp.q?.slice(0, 80)
  const pagina = Math.max(1, Math.trunc(Number(sp.pagina)) || 1)

  let datos: PaginaItems | null = null
  try {
    datos = await conEmpresa(companyId, (tx) => paginarItemsEnTx(tx, companyId, { estado, tipo: tipo as never, q, pagina }))
  } catch (e) {
    console.error('[admin-catalogo]', e)
  }
  const filtrado = !!(estado || tipo || q)
  const base = { q, estado, tipo }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo"
        description="Lo que vende tu empresa: productos y servicios, con sus precios, variantes, existencias y ofertas. Aquí creas lo que vendes."
        action={
          <Link href="/admin/catalogo/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo producto o servicio
            </Button>
          </Link>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input name="q" defaultValue={q ?? ''} placeholder="Buscar por nombre" aria-label="Buscar por nombre" className="w-64 pl-8" />
        </div>
        <select name="estado" defaultValue={estado ?? ''} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Estado">
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO[e]}
            </option>
          ))}
        </select>
        <select name="tipo" defaultValue={tipo ?? ''} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO[t]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
        {filtrado && (
          <Link href="/admin/catalogo" className="text-sm text-muted-foreground underline">
            Quitar filtros
          </Link>
        )}
      </form>

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No se pudo cargar el catálogo. Intenta de nuevo en un momento.
          </CardContent>
        </Card>
      ) : datos.total === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            {filtrado ? (
              <p className="font-medium">Nada coincide con ese filtro</p>
            ) : (
              <>
                <p className="font-medium text-foreground">Todavía no tienes productos o servicios.</p>
                <p className="mx-auto mt-1 max-w-md text-sm">
                  Crea tu catálogo para comenzar a vender y promocionar en Membego. Después podrás llevar el inventario por sucursal y crear ofertas
                  sobre esos mismos productos.
                </p>
                <Link href="/admin/catalogo/nuevo" className="mt-5 inline-block">
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primer producto
                  </Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3" aria-label="Productos y servicios">
            {datos.items.map((i) => {
              const portada = i.imagenPath ? urlPublicaCatalogo(i.imagenPath) : null
              const stock = resumenDeStock(i.controlaInventario, i.niveles)
              return (
                <li key={i.id}>
                  <Link href={`/admin/catalogo/${i.id}`}>
                    <Card className="transition-colors hover:bg-muted/40">
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted" aria-hidden>
                            {portada ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={portada} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{i.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {ETIQUETA_TIPO[i.type]}
                              {i.tieneVariantes && ` · ${i.variantes} variantes`}
                              {stock ? ' · Stock gestionado' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                          {i.desde != null && (
                            <span className="font-semibold tabular-nums">
                              {i.tieneVariantes && <span className="mr-1 text-xs font-normal text-muted-foreground">desde</span>}
                              {formatearPrecio(i.desde, i.currency)}
                            </span>
                          )}
                          {stock && <Badge variant={BADGE_ESTADO_STOCK[stock.estado]}>{ETIQUETA_ESTADO_STOCK[stock.estado]}</Badge>}
                          {i.status === 'ACTIVE' && i.enMarketplace && <Badge variant="outline">Marketplace ✓</Badge>}
                          <Badge variant={VARIANTE_BADGE[i.status]}>{ETIQUETA_ESTADO[i.status]}</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
          {datos.paginas > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
              {datos.pagina > 1 ? (
                <Link href={enlace(base, { pagina: String(datos.pagina - 1) })} className="text-primary hover:underline">
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Página {datos.pagina} de {datos.paginas} · {datos.total} ítems
              </span>
              {datos.pagina < datos.paginas ? (
                <Link href={enlace(base, { pagina: String(datos.pagina + 1) })} className="text-primary hover:underline">
                  Siguiente →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
