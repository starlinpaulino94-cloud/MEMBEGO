import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { clavesDeEmpresa } from '@/modules/connect/clavesApi'
import { limiteDe } from '@/modules/connect/entitlements'
import { ClavesApiPanel } from '@/components/connect/ClavesApiPanel'
import { PlanNoIncluye } from '@/components/connect/EstadoPlanConnect'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Claves de API' }

/**
 * CLAVES DE API de la empresa.
 *
 * `api_keys.max` vale CERO por defecto y eso es deliberado: una clave abre los
 * datos de la empresa a programas de fuera. Cuando no está concedida, la
 * pantalla NO enseña un formulario que va a rechazar la operación — enseña qué
 * es y cómo se pide.
 *
 * Salvo que la empresa tenga claves de antes: entonces sí se enseña la lista,
 * aunque el límite haya bajado a cero, para que pueda revocarlas. Esconderle
 * credenciales vivas sería dejarle puertas abiertas que no puede cerrar.
 */
export default async function ClavesPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [claves, limite] = await Promise.all([
    clavesDeEmpresa(companyId),
    limiteDe(companyId, 'api_keys.max'),
  ])

  if (limite === 0 && claves.length === 0) return <PlanNoIncluye que="claves" />

  return (
    <ClavesApiPanel
      claves={claves.map((c) => ({
        ...c,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      }))}
      limite={limite}
    />
  )
}
