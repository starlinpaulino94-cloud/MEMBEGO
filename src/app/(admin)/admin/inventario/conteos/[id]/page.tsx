import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ClipboardCheck, Upload } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { CapturaConteo } from '@/components/inventario/CapturaConteo'
import { FilaConteoEditable } from '@/components/inventario/FilaConteoEditable'
import { InformeDiferencias, type LineaInforme } from '@/components/inventario/InformeDiferencias'
import { ETIQUETA_ESTADO_CONTEO } from '@/modules/inventory/conteos'
import { conteoDetalleEnTx, porContarEnTx, type DetalleConteo } from '@/modules/inventory/queries'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

/** Las líneas de un conteo leído CON lo esperado. Si alguna viene a ciegas es un fallo de quien llama, no un dato a inventar. */
function lineasDeInforme(c: DetalleConteo): LineaInforme[] {
  return c.detalle.map((l) => {
    if (l.esperado === null) throw new Error('El informe necesita lo esperado: la lectura fue a ciegas.')
    return { ...l, esperado: l.esperado }
  })
}

export default async function ConteoInventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeAjustar = await puedeFuncion('inventario', 'ajustar')

  let datos: { zona: string; conteo: DetalleConteo | null; porContar: Awaited<ReturnType<typeof porContarEnTx>> | null } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      // Se lee A CIEGAS primero: lo que decía el sistema solo se lee si el conteo ya no está abierto.
      const ciego = await conteoDetalleEnTx(tx, companyId, id, { conEsperado: false })
      if (!ciego) return { zona, conteo: null, porContar: null }
      if (ciego.estado !== 'OPEN') return { zona, conteo: await conteoDetalleEnTx(tx, companyId, id, { conEsperado: true }), porContar: null }
      return { zona, conteo: ciego, porContar: await porContarEnTx(tx, companyId, ciego.id, ciego.sucursalId) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-conteo', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos?.conteo) notFound()
  const { conteo, zona, porContar } = datos
  const abierto = conteo.estado === 'OPEN'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/conteos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Conteos
          </Link>
        }
        title={conteo.numero}
        description={`${conteo.sucursalNombre} · abierto ${formatDateTimeExacto(conteo.creadoEn, { zonaHoraria: zona })}${conteo.abiertoPorNombre ? ` por ${conteo.abiertoPorNombre}` : ''}`}
        action={
          abierto ? (
            puedeAjustar ? (
              <Button asChild size="sm">
                <Link href={`/admin/inventario/conteos/${conteo.id}/revisar`}>
                  <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden />
                  Revisar y aplicar
                </Link>
              </Button>
            ) : undefined
          ) : (
            <BotonExportar href={`/admin/inventario/conteos/${conteo.id}/exportar`} label="Descargar diferencias" variant="outline" size="sm" />
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={abierto ? 'default' : 'outline'}>{ETIQUETA_ESTADO_CONTEO[conteo.estado]}</Badge>
        {conteo.nota && <span className="text-sm text-muted-foreground">{conteo.nota}</span>}
      </div>

      {abierto ? (
        <>
          <Alert>
            <AlertDescription>
              <strong>Conteo a ciegas.</strong> Aquí no ves lo que dice el sistema: cuenta lo que hay en el estante. Cuando termines, «Revisar y aplicar» te enseña las diferencias; solo al aplicar se ajustan las existencias. Lo que no cuentes no se
              toca.
            </AlertDescription>
          </Alert>

          {puedeAjustar ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <BotonExportar href={`/admin/inventario/conteos/${conteo.id}/hoja`} label="Descargar hoja en blanco" variant="outline" size="sm" />
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/inventario/conteos/${conteo.id}/importar`}>
                    <Upload className="mr-2 h-4 w-4" aria-hidden />
                    Importar hoja contada
                  </Link>
                </Button>
              </div>
              <CapturaConteo conteoId={conteo.id} />
            </>
          ) : (
            <Alert>
              <AlertDescription>Puedes ver este conteo, pero contar y aplicar requiere el permiso de ajustar existencias.</AlertDescription>
            </Alert>
          )}

          <section aria-labelledby="contados" className="space-y-2">
            <h2 id="contados" className="text-lg font-semibold">
              Productos contados ({formatearCantidad(conteo.lineas)})
            </h2>
            {conteo.detalle.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">Todavía no has contado nada. Escanea el primer producto.</CardContent>
              </Card>
            ) : (
              <ul className="divide-y rounded-lg border" aria-label="Productos contados">
                {conteo.detalle.map((l) =>
                  puedeAjustar ? (
                    <FilaConteoEditable
                      key={`${l.varianteId}-${l.contado}`}
                      conteoId={conteo.id}
                      varianteId={l.varianteId}
                      nombre={nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}
                      sku={l.sku}
                      barcode={l.barcode}
                      contado={l.contado}
                    />
                  ) : (
                    <li key={l.varianteId} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <span className="font-medium">{nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}</span>
                      <span className="tabular-nums">{formatearCantidad(l.contado)}</span>
                    </li>
                  )
                )}
              </ul>
            )}
          </section>

          {porContar && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Con existencias y todavía sin contar ({formatearCantidad(porContar.total)})
              </summary>
              {porContar.total === 0 ? (
                <p className="mt-2 text-muted-foreground">Ya contaste todo lo que tiene existencias en esta sucursal.</p>
              ) : (
                <>
                  <ul className="mt-2 max-h-72 list-disc space-y-1 overflow-auto pl-5" aria-label="Productos por contar">
                    {porContar.items.map((p) => (
                      <li key={p.varianteId}>
                        {p.nombre} <span className="text-xs text-muted-foreground">SKU {p.sku}</span>
                      </li>
                    ))}
                  </ul>
                  {porContar.total > porContar.items.length && <p className="mt-2 text-xs text-muted-foreground">Y {formatearCantidad(porContar.total - porContar.items.length)} más. No se enseñan cantidades: se cuenta a ciegas.</p>}
                </>
              )}
            </details>
          )}
        </>
      ) : (
        <>
          {conteo.estado === 'CANCELLED' ? (
            <Alert>
              <AlertDescription>
                Cancelado {conteo.canceladoEn ? formatDateTimeExacto(conteo.canceladoEn, { zonaHoraria: zona }) : ''}
                {conteo.canceladoPorNombre ? ` por ${conteo.canceladoPorNombre}` : ''}
                {conteo.motivoCancelacion ? `: ${conteo.motivoCancelacion}` : '.'} No se movió ninguna existencia.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                Aplicado {conteo.aplicadoEn ? formatDateTimeExacto(conteo.aplicadoEn, { zonaHoraria: zona }) : ''}
                {conteo.aplicadoPorNombre ? ` por ${conteo.aplicadoPorNombre}` : ''}. Un conteo aplicado no se edita; un error se corrige con un ajuste en la ficha del producto.
              </AlertDescription>
            </Alert>
          )}
          <InformeDiferencias lineas={lineasDeInforme(conteo)} sinContar={conteo.sinContar} aplicado={conteo.estado === 'APPLIED'} />
        </>
      )}
    </div>
  )
}
