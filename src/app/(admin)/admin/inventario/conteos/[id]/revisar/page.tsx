import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { PageHeader } from '@/components/ui/page-header'
import { AplicarConteoForm } from '@/components/inventario/AplicarConteoForm'
import { InformeDiferencias, type LineaInforme } from '@/components/inventario/InformeDiferencias'
import { diferenciaDeConteo, motivoDeConteo, planDeAjuste } from '@/modules/inventory/conteos'
import { conteoDetalleEnTx, porContarEnTx, saldosActualesDeConteoEnTx, type DetalleConteo } from '@/modules/inventory/queries'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function RevisarConteoInventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeAjustar = await puedeFuncion('inventario', 'ajustar')

  let datos: {
    conteo: DetalleConteo | null
    saldos: Awaited<ReturnType<typeof saldosActualesDeConteoEnTx>>
    porContar: Awaited<ReturnType<typeof porContarEnTx>> | null
  } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const conteo = await conteoDetalleEnTx(tx, companyId, id, { conEsperado: true })
      if (!conteo) return { conteo: null, saldos: new Map(), porContar: null }
      if (conteo.estado !== 'OPEN') return { conteo, saldos: new Map(), porContar: null }
      return {
        conteo,
        saldos: await saldosActualesDeConteoEnTx(tx, companyId, conteo.id, conteo.sucursalId),
        porContar: await porContarEnTx(tx, companyId, conteo.id, conteo.sucursalId),
      }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-conteo-revisar', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  if (!datos?.conteo) notFound()
  const { conteo, saldos, porContar } = datos
  // Ya aplicado o cancelado: no hay nada que revisar, el informe vive en la pantalla del conteo.
  if (conteo.estado !== 'OPEN') redirect(`/admin/inventario/conteos/${conteo.id}`)

  const lineas: LineaInforme[] = conteo.detalle.map((l) => {
    if (l.esperado === null) throw new Error('La revisión necesita lo esperado: la lectura fue a ciegas.')
    return { ...l, esperado: l.esperado }
  })
  // Qué líneas hoy NO se podrían aplicar (dejarían menos de lo apartado): se avisa de antemano; aplicar lo vuelve a comprobar bajo candado.
  const bloqueos = new Map<string, string>()
  let ajustes = 0
  for (const l of lineas) {
    const delta = diferenciaDeConteo(l.contado, l.esperado)
    if (delta === 0) continue
    ajustes++
    const plan = planDeAjuste(delta, saldos.get(l.varianteId) ?? { onHand: 0, reserved: 0, damaged: 0 }, motivoDeConteo(conteo.numero))
    if (plan.tipo === 'RECHAZADA') bloqueos.set(l.varianteId, plan.motivo)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={`/admin/inventario/conteos/${conteo.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Seguir contando · {conteo.numero}
          </Link>
        }
        title={`Revisar ${conteo.numero}`}
        description={`${conteo.sucursalNombre}. Estas son las diferencias entre lo que contaste y lo que decía el sistema al contar. Todavía no se ha movido nada.`}
        action={<BotonExportar href={`/admin/inventario/conteos/${conteo.id}/exportar`} label="Descargar diferencias" variant="outline" size="sm" />}
      />

      {bloqueos.size > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {bloqueos.size === 1 ? 'Una línea no se podría aplicar hoy' : `${formatearCantidad(bloqueos.size)} líneas no se podrían aplicar hoy`}: dejarían menos de lo apartado. Aplicar es todo o nada, así que hay que recontarlas o quitarlas
            antes.
          </AlertDescription>
        </Alert>
      )}

      <InformeDiferencias lineas={lineas} sinContar={porContar?.total ?? null} aplicado={false} bloqueos={bloqueos} />

      {porContar && porContar.total > 0 && (
        <Alert>
          <AlertDescription>
            Hay {formatearCantidad(porContar.total)} producto{porContar.total === 1 ? '' : 's'} con existencias que no contaste. No se tocan al aplicar. Si faltó contarlos,{' '}
            <Link href={`/admin/inventario/conteos/${conteo.id}`} className="underline">
              sigue contando
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {puedeAjustar ? (
        <AplicarConteoForm conteoId={conteo.id} numero={conteo.numero} productos={lineas.length} ajustes={ajustes} />
      ) : (
        <Alert>
          <AlertDescription>Aplicar un conteo requiere el permiso de ajustar existencias.</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
