import { redirect } from 'next/navigation'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { entrantesDeEmpresa } from '@/modules/connect/entrantes'
import { nombreDeEvento } from '@/modules/connect/entrantesNucleo'
import { eventosDisparadores } from '@/modules/connect/eventosSuscribibles'
import { reglasHttpDeEmpresa } from '@/modules/connect/reglasHttp'
import { ReglasHttpPanel } from '@/components/connect/ReglasHttpPanel'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reglas' }

/**
 * REGLAS «cuando pase X, llama a Y» (hallazgo B-1).
 *
 * La lista de disparadores junta las dos fuentes que una empresa puede
 * escuchar: los eventos de su propio negocio y los webhooks entrantes que haya
 * creado. Que estén juntos es el punto de toda la función — la regla no
 * distingue si el hecho ocurrió dentro o se lo mandó una herramienta de fuera.
 */
export default async function ReglasPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [reglas, entrantes, puedeGestionar] = await Promise.all([
    reglasHttpDeEmpresa(companyId),
    entrantesDeEmpresa(companyId),
    puedeFuncion('integraciones', 'regla_http'),
  ])

  const eventos = [
    ...eventosDisparadores(),
    // Los entrantes van DESPUÉS y con su nombre: quien acaba de crear uno viene
    // buscándolo por el nombre que le puso, no por su identificador.
    ...entrantes.map((e) => ({
      valor: nombreDeEvento(e.slug),
      label: `Me avisan por «${e.nombre}»`,
    })),
  ]

  return (
    <ReglasHttpPanel
      puedeGestionar={puedeGestionar}
      eventos={eventos}
      reglas={reglas.map((r) => ({
        id: r.id,
        nombre: r.nombre,
        evento: r.evento,
        estado: r.estado,
        host: r.host,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  )
}
