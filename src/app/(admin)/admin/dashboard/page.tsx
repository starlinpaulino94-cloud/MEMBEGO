import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ADMIN_ROLES, FULL_ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { requireRole, seccionesAbribles, usuarioPuedeFuncion } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { ADMIN_SECTIONS, adminSectionForPath } from '@/lib/auth/permissions'
import { destinoSiSoloProveedora } from '@/modules/supply-v2/permisos'
import { getOnboardingEmpresa } from '@/modules/empresas/onboarding'
import { bloquesDelResumen } from '@/modules/admin/resumen/bloques'
import { getResumen } from '@/modules/admin/resumen/consultas'
import { PanelDs } from '@/components/layout/PanelDs'
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist'
import { ResumenPanel } from '@/components/admin/resumen/ResumenPanel'
import { ComercioResumen } from '@/components/admin/resumen/ComercioResumen'
import { InventarioResumen } from '@/components/admin/resumen/InventarioResumen'

export const dynamic = 'force-dynamic'

const TZ_DEFECTO = 'America/Santo_Domingo'

/**
 * EL RESUMEN (auditoría admin · fase 5, tarea 5.1).
 *
 * Es la primera pantalla de todo el que entra al panel, así que se compone POR LO QUE LA PERSONA PUEDE VER y no por una lista
 * de roles: cada bloque declara su sección y su función (`modules/admin/resumen/bloques.ts`), el motor consulta solo lo que
 * se concede (`consultas.ts`, una transacción) y los enlaces solo existen si la sección se puede abrir. El resumen de
 * Comercio y la tarjeta de Inventario, que son de otros módulos, cargan aparte dentro de `<Suspense>`.
 *
 * Qué NO está aquí, a propósito (decisión 1 del prototipo aprobado): seguidores, referidos históricos, «Pico», la actividad
 * en vivo y «Estado en App Móvil». Lo que cada uno aportaba vive en su pantalla (Registros, Personalización, Audiencia).
 */
export default async function AdminDashboard() {
  const user = await requireRole(ADMIN_ROLES)
  // ÁMBITO EMPRESA: sin empresa activa no hay vista global aquí — el superadmin elige empresa en plataforma y el staff ve
  // /admin/sin-empresa.
  const companyId = await requireCompanyContext(user)
  // Supplier Lite (§6): una empresa SOLO proveedora de Membego vive en su portal.
  const portal = await destinoSiSoloProveedora(companyId)
  if (portal) redirect(portal)

  // Onboarding PRIMERO: mientras la empresa no esté publicada, el asistente es su «home». Se resuelve antes de cargar el
  // Resumen para no desperdiciarlo cuando se va a redirigir igual.
  const onboarding = await getOnboardingEmpresa(companyId).catch(() => null)
  if (onboarding && !onboarding.publicado && FULL_ADMIN_ROLES.includes(user.metadata.role)) {
    redirect('/onboarding')
  }

  // QUÉ PUEDE VER QUIEN MIRA, resuelto UNA vez (D-01 y D-07): dinero con `reportes › ver_financieros`, desglose por persona con
  // `reportes › ver_empleados`, y cada enlace solo si su sección se puede abrir. Es cosmético a propósito: la barrera de
  // verdad sigue en la guardia de cada sección.
  const [conFinanzas, conEmpleados, abribles] = await Promise.all([
    usuarioPuedeFuncion(user, 'reportes', 'ver_financieros'),
    usuarioPuedeFuncion(user, 'reportes', 'ver_empleados'),
    seccionesAbribles(user, ADMIN_SECTIONS),
  ])
  const ve = (href: string) => {
    const seccion = adminSectionForPath(href.split('?')[0])
    return seccion === null || abribles.has(seccion)
  }
  const bloques = bloquesDelResumen({ puede: (s) => abribles.has(s), conFinanzas, conEmpleados })

  // La empresa se lee ANTES: su zona horaria decide dónde empieza «hoy».
  const company = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { name: true, moneda: true, idioma: true, zonaHoraria: true } })
  ).catch(() => null)
  const tz = company?.zonaHoraria || TZ_DEFECTO
  const regional = { moneda: company?.moneda ?? 'DOP', idioma: company?.idioma || 'es-DO', zonaHoraria: tz }

  const datos = await getResumen(companyId, tz, bloques, { conFinanzas, conEmpleados }).catch((e) => {
    console.error('[admin-dashboard]', e)
    return null
  })
  if (!datos) {
    return <p className="text-muted-foreground">No pudimos cargar el panel en este momento. Intenta de nuevo.</p>
  }

  const fecha = new Intl.DateTimeFormat(regional.idioma, { dateStyle: 'full', timeZone: tz }).format(new Date())

  return (
    <PanelDs>
      <ResumenPanel
        datos={datos}
        bloques={bloques}
        ve={ve}
        company={regional}
        fecha={fecha}
        // El asistente lleva a configurar la empresa: solo a quien puede abrir su perfil (D-07).
        trasCabecera={onboarding && ve('/admin/perfil') ? <OnboardingChecklist onboarding={onboarding} /> : null}
        alFinal={
          <>
            <Suspense fallback={null}>
              <ComercioResumen companyId={companyId} zonaHoraria={tz} company={regional} ve={ve} conFinanzas={conFinanzas} />
            </Suspense>
            {ve('/admin/inventario') ? (
              <Suspense fallback={null}>
                <InventarioResumen companyId={companyId} zonaHoraria={tz} company={regional} />
              </Suspense>
            ) : null}
          </>
        }
      />
    </PanelDs>
  )
}
