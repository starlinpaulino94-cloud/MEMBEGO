import Link from 'next/link'
import { Truck } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { ETIQUETA_ESTADO_TRASLADO } from '@/modules/inventory/traslados'
import { POR_PAGINA_TRASLADOS, sucursalesDeLaEmpresaEnTx, trasladosDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosTraslados, leerFiltrosTraslados } from '@/modules/inventory/filtros'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'

export default async function TransferenciasInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { filtros, cursor } = leerFiltrosTraslados(await searchParams)
  const puedeTransferir = await puedeFuncion('inventario', 'transferir')

  let datos: {
    zona: string
    sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>
    abiertas: Awaited<ReturnType<typeof trasladosDeLaEmpresaEnTx>>
    pagina: Awaited<ReturnType<typeof trasladosDeLaEmpresaEnTx>>
  } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...filtros, sucursalId: sucursales.find((s) => s.id === filtros.sucursalId)?.id }
      if (!f.sucursalId) delete f.sucursalId
      return {
        zona,
        sucursales,
        abiertas: await trasladosDeLaEmpresaEnTx(tx, companyId, {}, { zonaHoraria: zona, limite: 50, abiertas: true }),
        pagina: await trasladosDeLaEmpresaEnTx(tx, companyId, f, { zonaHoraria: zona, cursor }),
      }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-transferencias', e)
  }

  const f = { ...filtros, sucursalId: datos?.sucursales.find((s) => s.id === filtros.sucursalId)?.id }
  if (!f.sucursalId) delete f.sucursalId
  const hayFiltros = Object.keys(f).length > 0
  const consulta = consultaDeFiltrosTraslados(f)
  const hayDosActivas = (datos?.sucursales.filter((s) => s.activa).length ?? 0) >= 2

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transferencias entre sucursales"
        description="Mercancía que sale de una sucursal y llega a otra: en el camino no está disponible en ninguna, y el destino la recibe en una o varias partes."
        action={
          puedeTransferir && hayDosActivas ? (
            <Button asChild size="sm">
              <Link href="/admin/inventario/transferencias/nueva">
                <Truck className="mr-2 h-4 w-4" aria-hidden />
                Nueva transferencia
              </Link>
            </Button>
          ) : undefined
        }
      />
      <NavegacionInventario actual="transferencias" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          {datos.abiertas.filas.length > 0 && (
            <section aria-labelledby="en-camino" className="space-y-2">
              <h2 id="en-camino" className="text-lg font-semibold">
                En camino ahora
              </h2>
              <ul className="divide-y rounded-lg border" aria-label="Transferencias en camino">
                {datos.abiertas.filas.map((t) => (
                  <li key={t.id}>
                    <Link href={`/admin/inventario/transferencias/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                      <span className="font-medium">
                        {t.numero} <span className="font-normal text-muted-foreground">· {t.origenNombre} → {t.destinoNombre}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatearCantidad(t.enTransito)} unidad{t.enTransito === 1 ? '' : 'es'} por llegar · enviada {formatDateTimeExacto(t.creadoEn, { zonaHoraria: datos.zona })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form key={consulta} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar transferencias">
            <div className="space-y-1">
              <label htmlFor="tf-q" className="text-xs text-muted-foreground">
                Número o nota
              </label>
              <Input id="tf-q" name="q" defaultValue={f.q ?? ''} placeholder="TRF-2026-000003 o reposición" className="w-64" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="tf-sucursal" className="text-xs text-muted-foreground">
                  Sucursal (envía o recibe)
                </label>
                <select id="tf-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
                  <option value="">Todas</option>
                  {datos.sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.activa ? '' : ' (desactivada)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="tf-estado" className="text-xs text-muted-foreground">
                Estado
              </label>
              <select id="tf-estado" name="estado" defaultValue={f.estado ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                {(['SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'] as const).map((e) => (
                  <option key={e} value={e}>
                    {ETIQUETA_ESTADO_TRASLADO[e]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="tf-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="tf-desde" type="date" name="desde" defaultValue={f.desde ?? ''} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="tf-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="tf-hasta" type="date" name="hasta" defaultValue={f.hasta ?? ''} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/transferencias" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {datos.pagina.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay transferencias con envío'}</p>
                {!hayFiltros && <p className="text-sm">Cuando mandes mercancía a otra sucursal, queda aquí con su número, lo que va en camino y lo que ya llegó.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Transferencias">
              {datos.pagina.filas.map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/inventario/transferencias/${t.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {t.numero} <span className="font-normal text-muted-foreground">· {t.origenNombre} → {t.destinoNombre}</span>
                        <Badge variant={t.estado === 'SENT' || t.estado === 'PARTIAL' ? 'default' : 'outline'} className="ml-2 align-middle">
                          {ETIQUETA_ESTADO_TRASLADO[t.estado]}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeExacto(t.creadoEn, { zonaHoraria: datos.zona })} · {t.enviadoPorNombre ?? 'Sistema'}
                        {t.nota && ` · ${t.nota}`}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums">
                      <p>
                        {formatearCantidad(t.unidades)} unidad{t.unidades === 1 ? '' : 'es'} · {formatearCantidad(t.lineas)} producto{t.lineas === 1 ? '' : 's'}
                      </p>
                      <p>
                        {formatearCantidad(t.recibidas)} recibidas{t.enTransito > 0 && ` · ${formatearCantidad(t.enTransito)} en camino`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {(cursor || datos.pagina.siguiente) && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de transferencias">
              {cursor ? (
                <Link href={`/admin/inventario/transferencias${consulta ? `?${consulta}` : ''}`} className="underline">
                  ← Volver a lo más reciente
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">{POR_PAGINA_TRASLADOS} por página</span>
              {datos.pagina.siguiente ? (
                <Link href={`/admin/inventario/transferencias?${consultaDeFiltrosTraslados(f, datos.pagina.siguiente)}`} className="underline">
                  Más antiguas →
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
