import Link from 'next/link'
import { Package, Plus, Search } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { listarItemsEnTx } from '@/modules/catalog/queries'
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, formatearPrecio } from '@/modules/catalog/formato'

export const dynamic = 'force-dynamic'

const ESTADOS = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const
const TIPOS = Object.keys(ETIQUETA_TIPO)

const VARIANTE_BADGE: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'outline'> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'outline',
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

  let items: Awaited<ReturnType<typeof listarItemsEnTx>> = []
  let fallo = false
  try {
    items = await conEmpresa(companyId, (tx) => listarItemsEnTx(tx, companyId, { estado, tipo: tipo as never, q }))
  } catch (e) {
    fallo = true
    console.error('[admin-catalogo]', e)
  }
  const filtrado = !!(estado || tipo || q)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo"
        description="Lo que vende tu empresa: productos y servicios, con sus precios y variantes."
        action={
          <Link href="/admin/catalogo/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo
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

      {fallo ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No se pudo cargar el catálogo. Intenta de nuevo en un momento.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">{filtrado ? 'Nada coincide con ese filtro' : 'Tu catálogo está vacío'}</p>
            {!filtrado && <p className="text-sm">Crea tu primer producto o servicio para empezar.</p>}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`/admin/catalogo/${i.id}`}>
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold text-foreground">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ETIQUETA_TIPO[i.type]}
                        {i.tieneVariantes && ` · ${i.variantes} variantes`}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {i.desde != null && (
                        <span className="font-semibold tabular-nums">
                          {i.tieneVariantes && <span className="mr-1 text-xs font-normal text-muted-foreground">desde</span>}
                          {formatearPrecio(i.desde, i.currency)}
                        </span>
                      )}
                      <Badge variant={VARIANTE_BADGE[i.status]}>{ETIQUETA_ESTADO[i.status]}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
