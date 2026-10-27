import Link from 'next/link'
import { CheckCircle2, FileText } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { TabsNav } from '@/components/ui/tabs-nav'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBanner } from '@/components/ui/status-banner'
import { PanelDs } from '@/components/layout/PanelDs'
import { ColaPagos } from '@/components/admin/pagos/ColaPagos'
import { contarColasDePago } from '@/modules/pagos/colasConteo'
import { leerCola } from '@/modules/pagos/colasLectura'
import { COLAS, colaInicial } from '@/modules/pagos/colasMezcla'

export const dynamic = 'force-dynamic'

/**
 * VALIDACIÓN DE PAGOS (auditoría admin · fase 5, tarea 5.2).
 *
 * Esta pantalla no lista pagos: lista COLAS DE TRABAJO (§53). Un pago confirmado ya no está aquí, y los cinco grupos que sí
 * están necesitan acciones distintas: confirmar un cobro en sucursal no se parece a validar una transferencia ni a aprobar un
 * cambio de plan. Las pestañas van sobre las colas reales y siempre están las cinco, con su recuento: ver «Cambios de plan 0»
 * es información, no ruido.
 *
 * LO QUE CAMBIÓ RESPECTO A LA PÁGINA DE 1 049 LÍNEAS, y lo que NO:
 *   · Las consultas viven en `modules/pagos/colasLectura.ts` (mismos `where` de `colas.ts`, mismos `select`, mismos topes) y
 *     la mezcla de las colas mixtas en `colasMezcla.ts`. Las tarjetas, en `components/admin/pagos/`. Las acciones (confirmar,
 *     rechazar, pedir evidencia, nota interna) son los botones de siempre, con su confirmación y su motivo.
 *   · Se lee SOLO la cola que se está mirando (antes, las ocho consultas siempre).
 *   · Sin `?cola=` abre en la primera cola con trabajo —transferencias, sucursal, compras, cambios— y no siempre en «En
 *     sucursal» (prototipo aprobado, decisión 3): el aviso del Resumen decía «5 por validar» y el usuario caía en una cola vacía.
 *   · Seguimiento usa la `Tabla` del sistema de diseño (con `caption` y `scope`).
 */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const sp = await searchParams

  // Cinco colas independientes en una misma pantalla: cada una lleva su propio prefijo para que avanzar en una no mueva a las
  // demás.
  const paginaciones = {
    tr: leerPaginacion(sp, 25, 'tr'),
    pr: leerPaginacion(sp, 25, 'pr'),
    cp: leerPaginacion(sp, 25, 'cp'),
    suc: leerPaginacion(sp, 25, 'suc'),
    seg: leerPaginacion(sp, 25, 'seg'),
  }
  const prefs = await getRegionalPrefs(companyId)
  const fmtMoney = (n: number) => formatMoney(n, prefs)

  // Los recuentos van APARTE: `contarColasDePago` abre su propia transacción con su contexto, y anidarla dentro de la de abajo
  // pediría una segunda conexión desde dentro de una abierta —que con el pooler por delante es como se agota el pool—. Es la
  // MISMA definición que consume el aviso del Resumen: el número de la pestaña y el del panel salen del mismo sitio.
  const conteos = await contarColasDePago(companyId)
  const cola = colaInicial(sp.cola, conteos)

  const datos = await conEmpresa(companyId, (tx) => leerCola(tx, companyId, cola, paginaciones))

  const totalPorValidar = conteos.porValidar
  const totalSeguimiento = conteos.seguimiento
  const etiquetaCola = COLAS.find((c) => c.clave === cola)?.label

  return (
    <PanelDs className="space-y-6">
      {datos.fallo && (
        <StatusBanner variant="destructive" title="No se pudieron cargar los pagos">
          Es un problema temporal; recarga la página en unos segundos. Si persiste, avisa al equipo técnico.
        </StatusBanner>
      )}
      <PageHeader
        title="Validación de pagos"
        description={`${totalPorValidar} pago${totalPorValidar !== 1 ? 's' : ''} por validar · ${totalSeguimiento} en seguimiento`}
        nav={
          <TabsNav
            aria-label="Colas de pago"
            items={COLAS.map((c) => ({
              label: c.label,
              badge: conteos[c.clave],
              active: cola === c.clave,
              render: ({ className, children, ...resto }) => (
                <Link href={`/admin/pagos?cola=${c.clave}`} className={className} {...resto}>
                  {children}
                </Link>
              ),
            }))}
          />
        }
      />

      {conteos[cola] === 0 && !datos.fallo && (
        <EmptyState
          icon={<CheckCircle2 />}
          title={`Nada pendiente en «${etiquetaCola}»`}
          description={
            totalPorValidar + totalSeguimiento > 0
              ? 'Otras colas sí tienen trabajo: cámbialas arriba.'
              : 'No hay pagos esperando acción en ninguna cola.'
          }
        />
      )}

      <ColaPagos
        datos={datos}
        conteos={conteos}
        paginaciones={paginaciones}
        params={sp}
        fmtMoney={fmtMoney}
        esSuperadmin={user.metadata.role === 'SUPERADMIN'}
      />

      {totalPorValidar === 0 && totalSeguimiento === 0 && (
        <Card>
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="Sin pagos pendientes"
            description="Todos los pagos han sido revisados y nadie tiene un pago a medio completar."
          />
        </Card>
      )}
    </PanelDs>
  )
}
