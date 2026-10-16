import Link from 'next/link'
import { History } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import {
  POR_PAGINA_MOVIMIENTOS,
  movimientosEmpresaEnTx,
  sucursalesDeLaEmpresaEnTx,
  usuariosParaFiltroEnTx,
} from '@/modules/inventory/queries'
import { TIPOS_DE_MOVIMIENTO } from '@/modules/inventory/domain'
import { USUARIO_SISTEMA, consultaDeFiltros, cuantosFiltros, leerFiltrosMovimientos } from '@/modules/inventory/filtros'
import { ETIQUETA_MOVIMIENTO, describirReferencia, efectoLegible, formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { detalleDeMotivo, etiquetaDeMotivo } from '@/modules/inventory/motivos'
import { TOPE_FILAS_MOVIMIENTOS } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'

export default async function MovimientosInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { filtros, cursor } = leerFiltrosMovimientos(await searchParams)

  let datos: {
    zona: string
    sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>
    usuarios: Awaited<ReturnType<typeof usuariosParaFiltroEnTx>>
    pagina: Awaited<ReturnType<typeof movimientosEmpresaEnTx>>
  } | null = null
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const usuarios = await usuariosParaFiltroEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...filtros, sucursalId: sucursales.find((s) => s.id === filtros.sucursalId)?.id }
      if (!f.sucursalId) delete f.sucursalId
      return { zona, sucursales, usuarios, pagina: await movimientosEmpresaEnTx(tx, companyId, f, { zonaHoraria: zona, cursor }) }
    })
  } catch (e) {
    console.error('[admin-inventario-movimientos]', e)
  }

  const f = { ...filtros, sucursalId: datos?.sucursales.find((s) => s.id === filtros.sucursalId)?.id }
  if (!f.sucursalId) delete f.sucursalId
  const hayFiltros = cuantosFiltros(f) > 0
  const consulta = consultaDeFiltros(f)

  return (
    <div className="space-y-6">
      <PageHeader title="Movimientos de inventario" description="Todo lo que entró, salió o se movió, en todas las sucursales: el historial completo, del más reciente al más antiguo." />
      <NavegacionInventario actual="movimientos" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No se pudieron cargar los movimientos. Intenta de nuevo en un momento.</CardContent>
        </Card>
      ) : (
        <>
          <form key={consulta} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar movimientos">
            <div className="space-y-1">
              <label htmlFor="mv-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="mv-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-64" maxLength={80} />
            </div>
            <div className="space-y-1">
              <label htmlFor="mv-tipo" className="text-xs text-muted-foreground">
                Movimiento
              </label>
              <select id="mv-tipo" name="tipo" defaultValue={f.tipo ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                {TIPOS_DE_MOVIMIENTO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_MOVIMIENTO[t]}
                  </option>
                ))}
              </select>
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="mv-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="mv-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <label htmlFor="mv-usuario" className="text-xs text-muted-foreground">
                Hecho por
              </label>
              <select id="mv-usuario" name="usuario" defaultValue={f.usuario ?? ''} className={CAMPO}>
                <option value="">Cualquiera</option>
                <option value={USUARIO_SISTEMA}>Sistema (ventas, reservas, vencimientos)</option>
                {datos.usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="mv-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="mv-desde" type="date" name="desde" defaultValue={f.desde ?? ''} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="mv-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="mv-hasta" type="date" name="hasta" defaultValue={f.hasta ?? ''} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/movimientos" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>
              {datos.pagina.filas.length === 0
                ? 'Sin movimientos con estos filtros.'
                : `${datos.pagina.filas.length} movimiento${datos.pagina.filas.length === 1 ? '' : 's'} en esta página${datos.pagina.siguiente ? ' (hay más)' : ''}.`}
            </p>
            <BotonExportar href={`/admin/inventario/movimientos/exportar${consulta ? `?${consulta}` : ''}`} variant="outline" size="sm" />
          </div>
          <p className="-mt-4 text-xs text-muted-foreground">
            El archivo respeta estos filtros, usa la zona horaria de tu empresa ({datos.zona}) y trae hasta {formatearCantidad(TOPE_FILAS_MOVIMIENTOS)} movimientos; si se corta, el propio archivo lo dice.
          </p>

          {datos.pagina.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay movimientos'}</p>
                {!hayFiltros && <p className="text-sm">Aparecerán aquí las entradas, ventas, ajustes y transferencias en cuanto empiecen.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Movimientos de inventario">
              {datos.pagina.filas.map((m) => {
                const ref = describirReferencia(m.referenciaTipo, m.referenciaId)
                return (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {ETIQUETA_MOVIMIENTO[m.tipo]} <span className="font-normal text-muted-foreground">· {m.sucursalNombre}</span>
                      </p>
                      <p>
                        <Link href={`/admin/inventario/${m.varianteId}`} className="underline-offset-2 hover:underline">
                          {nombreCompleto(m.itemNombre, m.nombreVariante, m.esDefault)}
                        </Link>{' '}
                        <span className="text-xs text-muted-foreground">SKU {m.sku}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeExacto(m.creadoEn, { zonaHoraria: datos.zona })} · {m.usuarioNombre ?? 'Sistema'}
                        {ref &&
                          (m.referenciaTipo === 'ORDER' && m.referenciaId ? (
                            <>
                              {' · '}
                              <Link href={`/admin/pedidos-membego/${m.referenciaId}`} className="underline underline-offset-2">
                                {ref}
                              </Link>
                            </>
                          ) : (
                            ` · ${ref}`
                          ))}
                      </p>
                      {m.motivoCodigo && <p className="mt-0.5 text-xs font-medium">Motivo: {etiquetaDeMotivo(m.motivoCodigo)}</p>}
                      {detalleDeMotivo(m.motivoCodigo, m.motivo) && <p className="mt-0.5 break-words text-xs">{detalleDeMotivo(m.motivoCodigo, m.motivo)}</p>}
                    </div>
                    <div className="text-right tabular-nums">
                      <p className={m.efectoOnHand > 0 ? 'font-semibold text-success' : m.efectoOnHand < 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                        {efectoLegible(m.efectoOnHand)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatearCantidad(m.previousOnHand)} → {formatearCantidad(m.newOnHand)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {(cursor || datos.pagina.siguiente) && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de movimientos">
              {cursor ? (
                <Link href={`/admin/inventario/movimientos${consulta ? `?${consulta}` : ''}`} className="underline">
                  ← Volver a lo más reciente
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">{POR_PAGINA_MOVIMIENTOS} por página</span>
              {datos.pagina.siguiente ? (
                <Link href={`/admin/inventario/movimientos?${consultaDeFiltros(f, datos.pagina.siguiente)}`} className="underline">
                  Más antiguos →
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
