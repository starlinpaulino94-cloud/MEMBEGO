import { redirect } from 'next/navigation'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { entrantesDeEmpresa } from '@/modules/connect/entrantes'
import { nombreDeEvento } from '@/modules/connect/entrantesNucleo'
import { limiteDe } from '@/modules/connect/entitlements'
import { EntrantesPanel } from '@/components/connect/EntrantesPanel'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Webhooks entrantes' }

/**
 * WEBHOOKS ENTRANTES (hallazgo B-1).
 *
 * El nombre del evento se compone AQUÍ, en el servidor, a partir del slug de
 * cada fila. No se guarda como columna a propósito: sería el mismo dato dos
 * veces, y el día que uno de los dos cambiara sin el otro, la pantalla diría un
 * evento y el endpoint emitiría otro — un desajuste que no da error en ninguna
 * parte y que solo se nota porque «la automatización no salta».
 */
export default async function EntrantesPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [entrantes, limite, puedeCrear, puedeGestionar] = await Promise.all([
    entrantesDeEmpresa(companyId),
    limiteDe(companyId, 'entrantes.max'),
    puedeFuncion('integraciones', 'entrante_crear'),
    puedeFuncion('integraciones', 'entrante_gestionar'),
  ])

  return (
    <EntrantesPanel
      limite={limite}
      puedeCrear={puedeCrear}
      puedeGestionar={puedeGestionar}
      entrantes={entrantes.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        evento: nombreDeEvento(e.slug),
        estado: e.estado,
        recibidos: e.recibidos,
        ultimoAt: e.ultimoAt?.toISOString() ?? null,
      }))}
    />
  )
}
