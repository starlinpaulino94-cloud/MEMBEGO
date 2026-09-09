import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Hilo } from '@/components/crm/bandeja/Hilo'
import { ListaConversaciones } from '@/components/crm/bandeja/ListaConversaciones'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import {
  esCanal,
  hiloDeConversacion,
  listarConversaciones,
  resumenPorCanal,
  type EstadoConversacion,
} from '@/modules/mensajeria/bandeja'
import { plantillasDeEmpresa } from '@/modules/mensajeria/plantillas'

export const metadata = { title: 'Conversaciones' }

/**
 * BANDEJA DE CONVERSACIONES (Meta · Fase 5).
 *
 * Lo que hay aquí sale de `modules/mensajeria`: las conversaciones REALES de
 * WhatsApp, Messenger e Instagram que el webhook de Meta fue guardando, y
 * las respuestas que salieron desde esta pantalla o desde una automatización.
 * Nada simulado: si no hay canales conectados o nadie ha escrito, se dice.
 *
 * Todo el estado vive en la URL (`canal`, `estado`, `q`, `c`): la página es
 * de servidor y cada cambio vuelve a leer la base.
 */
const ID_VALIDO = /^[a-z0-9]{10,40}$/i

export default async function ConversacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; canal?: string; estado?: string; q?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const sp = await searchParams
  const canal = esCanal(sp.canal) ? sp.canal : null
  const estado: EstadoConversacion = sp.estado === 'CERRADA' ? 'CERRADA' : 'ABIERTA'
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 80) : ''
  const seleccionadaId = typeof sp.c === 'string' && ID_VALIDO.test(sp.c) ? sp.c : null

  const [items, resumen, prefs, hilo] = await Promise.all([
    listarConversaciones(companyId, { canal, estado, busqueda: q || null }),
    resumenPorCanal(companyId),
    getRegionalPrefs(companyId),
    seleccionadaId ? hiloDeConversacion(companyId, seleccionadaId) : Promise.resolve(null),
  ])
  const plantillas = hilo?.conversacion.canal === 'WHATSAPP' ? await plantillasDeEmpresa(companyId) : []

  const totalAbiertas = Object.values(resumen).reduce((a, r) => a + r.abiertas, 0)
  const sinNada = totalAbiertas === 0 && items.length === 0 && !q && estado === 'ABIERTA' && !hilo

  if (sinNada) {
    return (
      <EmptyState
        variant="card"
        icon={<MessageSquare className="h-6 w-6" aria-hidden />}
        title="Todavía no hay conversaciones"
        description="Cuando conectes WhatsApp, Facebook o Instagram y alguien escriba a tu negocio, sus mensajes aparecerán aquí y podrás responder desde Membego."
        action={
          <Button asChild>
            <Link href="/admin/integraciones">Ver integraciones</Link>
          </Button>
        }
      />
    )
  }

  const filtro = { canal, estado, q: q || null }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <div className={hilo ? 'hidden lg:block' : ''}>
        <ListaConversaciones items={items} seleccionadaId={hilo?.conversacion.id ?? null} filtro={filtro} resumen={resumen} prefs={prefs} />
      </div>
      <div className={hilo ? '' : 'hidden lg:block'}>
        {hilo ? (
          <Hilo conversacion={hilo.conversacion} mensajes={hilo.mensajes} plantillas={plantillas} prefs={prefs} filtro={filtro} />
        ) : seleccionadaId ? (
          <EmptyState
            title="Esa conversación no existe"
            description="Puede que se haya retirado o que el enlace sea de otro negocio."
          />
        ) : (
          <EmptyState title="Elige una conversación" description="Selecciona un hilo de la lista para leerlo y responder." />
        )}
      </div>
    </div>
  )
}
