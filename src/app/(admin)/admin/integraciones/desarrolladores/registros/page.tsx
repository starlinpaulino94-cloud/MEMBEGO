import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { registrosDeEmpresa } from '@/modules/connect/bitacora'
import { ActividadConnect } from '@/components/connect/ActividadConnect'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Registros' }

/**
 * REGISTROS TÉCNICOS.
 *
 * Aquí se ve TODO y con su nombre exacto: el código del evento, el nivel y la
 * fecha. Es la vista de quien depura, y por eso no se suaviza nada.
 *
 * El mismo registro se cuenta de otra forma —sin códigos ni niveles— en la
 * página de cada integración, para quien solo quiere saber qué le pasó a su
 * cuenta. Un solo apunte, dos traducciones: `modules/connect/bitacoraNucleo.ts`.
 */
export default async function RegistrosPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')

  const registros = await registrosDeEmpresa(user.metadata.companyId, { limite: 100 })

  return (
    <ActividadConnect
      registros={registros.map((r) => ({
        id: r.id,
        nivel: r.nivel,
        evento: r.evento,
        origen: r.origen,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  )
}
