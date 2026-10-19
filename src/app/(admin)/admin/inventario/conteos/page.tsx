import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { IniciarConteoForm } from '@/components/inventario/IniciarConteoForm'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { ETIQUETA_ESTADO_CONTEO } from '@/modules/inventory/conteos'
import { POR_PAGINA_CONTEOS, conteosDeLaEmpresaEnTx, sucursalesActivasEnTx, sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosConteos, leerFiltrosConteos } from '@/modules/inventory/filtros'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'

export default async function ConteosInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { filtros, cursor } = leerFiltrosConteos(await searchParams)
  const puedeAjustar = await puedeFuncion('inventario', 'ajustar')

  let datos: {
    zona: string
    sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>
    activas: Awaited<ReturnType<typeof sucursalesActivasEnTx>>
    abiertos: Awaited<ReturnType<typeof conteosDeLaEmpresaEnTx>>
    pagina: Awaited<ReturnType<typeof conteosDeLaEmpresaEnTx>>
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
        activas: await sucursalesActivasEnTx(tx, companyId),
        abiertos: await conteosDeLaEmpresaEnTx(tx, companyId, { estado: 'OPEN' }, { zonaHoraria: zona, limite: 50 }),
        pagina: await conteosDeLaEmpresaEnTx(tx, companyId, f, { zonaHoraria: zona, cursor }),
      }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-conteos', e)
  }

  const f = { ...filtros, sucursalId: datos?.sucursales.find((s) => s.id === filtros.sucursalId)?.id }
  if (!f.sucursalId) delete f.sucursalId
  const hayFiltros = Object.keys(f).length > 0
  const consulta = consultaDeFiltrosConteos(f)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conteos físicos"
        description="El inventario físico de cada sucursal: se cuenta a ciegas, se revisan las diferencias y, solo entonces, se ajustan las existencias."
      />
      <NavegacionInventario actual="conteos" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          {puedeAjustar && datos.activas.length > 0 && <IniciarConteoForm sucursales={datos.activas} />}

          {datos.abiertos.filas.length > 0 && (
            <section aria-labelledby="conteos-abiertos" className="space-y-2">
              <h2 id="conteos-abiertos" className="text-lg font-semibold">
                Conteos abiertos
              </h2>
              <ul className="divide-y rounded-lg border" aria-label="Conteos abiertos">
                {datos.abiertos.filas.map((c) => (
                  <li key={c.id}>
                    <Link href={`/admin/inventario/conteos/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                      <span className="font-medium">
                        {c.numero} <span className="font-normal text-muted-foreground">· {c.sucursalNombre}</span>
                        {c.nota && <span className="font-normal text-muted-foreground"> · {c.nota}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatearCantidad(c.lineas)} producto{c.lineas === 1 ? '' : 's'} contado{c.lineas === 1 ? '' : 's'} · desde {formatDateTimeExacto(c.creadoEn, { zonaHoraria: datos.zona })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar conteos">
            <div className="space-y-1">
              <label htmlFor="co-q" className="text-xs text-muted-foreground">
                Número o nota
              </label>
              <Input id="co-q" name="q" defaultValue={f.q ?? ''} placeholder="CNT-2026-000003 o cierre de mes" className="w-64" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="co-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="co-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <label htmlFor="co-estado" className="text-xs text-muted-foreground">
                Estado
              </label>
              <select id="co-estado" name="estado" defaultValue={f.estado ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                {(['OPEN', 'APPLIED', 'CANCELLED'] as const).map((e) => (
                  <option key={e} value={e}>
                    {ETIQUETA_ESTADO_CONTEO[e]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="co-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="co-desde" type="date" name="desde" defaultValue={f.desde ?? ''} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="co-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="co-hasta" type="date" name="hasta" defaultValue={f.hasta ?? ''} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/conteos" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {datos.pagina.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay conteos'}</p>
                {!hayFiltros && <p className="text-sm">Abre el primero arriba: quedan guardados con su número, sus diferencias y quién los aplicó.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Conteos físicos">
              {datos.pagina.filas.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/inventario/conteos/${c.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {c.numero} <span className="font-normal text-muted-foreground">· {c.sucursalNombre}</span>
                        <Badge variant={c.estado === 'OPEN' ? 'default' : 'outline'} className="ml-2 align-middle">
                          {ETIQUETA_ESTADO_CONTEO[c.estado]}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeExacto(c.creadoEn, { zonaHoraria: datos.zona })} · {c.abiertoPorNombre ?? 'Sistema'}
                        {c.nota && ` · ${c.nota}`}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums">
                      <p>
                        {formatearCantidad(c.lineas)} producto{c.lineas === 1 ? '' : 's'}
                      </p>
                      {c.estado === 'APPLIED' && (
                        <p>
                          <span className="text-success">+{formatearCantidad(c.unidadesSobrantes ?? 0)}</span> · <span className="text-destructive">−{formatearCantidad(c.unidadesFaltantes ?? 0)}</span> en {formatearCantidad(c.ajustadas ?? 0)} ajuste
                          {c.ajustadas === 1 ? '' : 's'}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {(cursor || datos.pagina.siguiente) && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de conteos">
              {cursor ? (
                <Link href={`/admin/inventario/conteos${consulta ? `?${consulta}` : ''}`} className="underline">
                  ← Volver a lo más reciente
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">{POR_PAGINA_CONTEOS} por página</span>
              {datos.pagina.siguiente ? (
                <Link href={`/admin/inventario/conteos?${consultaDeFiltrosConteos(f, datos.pagina.siguiente)}`} className="underline">
                  Más antiguos →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
          {!puedeAjustar && (
            <Alert>
              <AlertDescription>Puedes ver los conteos, pero abrir y aplicar uno requiere el permiso de ajustar existencias.</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  )
}
