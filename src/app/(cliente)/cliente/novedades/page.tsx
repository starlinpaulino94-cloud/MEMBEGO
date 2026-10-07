import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { getNovedadesInicio } from '@/modules/social/queries'
import { FeedNovedades } from '@/components/cliente/FeedNovedades'
import { MisAvisos, type AvisoPropio } from '@/components/cliente/MisAvisos'
import { EmptyState } from '@/components/system/EmptyState'
import { Bell } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Novedades',
  description: 'Tus avisos y lo último de los negocios que sigues',
}

/**
 * NOVEDADES — pantalla propia (rediseño violeta, 2026-09-10).
 *
 * El feed de las empresas seguidas vivía al fondo del Inicio; el diseño
 * nuevo no lo trae ahí y la campana de la cabecera necesitaba un destino
 * real. Misma pieza (`FeedNovedades`, filas densas), misma consulta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SLICE 9 · BLOQUE 5: ARRIBA VAN LOS AVISOS QUE SON TUYOS
 *
 * Esta pantalla mostraba SOLO el muro de las empresas, y mientras tanto los
 * avisos personales —«tu compra está confirmada», «tu beneficio vence en tres
 * días»— se escribían en `notificaciones` y el área de cliente no los
 * enseñaba en ninguna parte. El desplegable que lee esa tabla vive en
 * `AppHeader`, la cabecera de admin y superadmin; un cliente nunca la ve.
 *
 * Lo encontró el recorrido G al buscar en pantalla un aviso que la base decía
 * ENTREGADO. El detalle está en `components/cliente/MisAvisos.tsx`.
 *
 * Van PRIMERO porque son de la persona: que un comercio que sigues haya
 * publicado una promoción nunca es más importante que que tu pago se haya
 * confirmado.
 */
export default async function NovedadesPage() {
  const user = await requireRole('CLIENTE')
  const id = user.metadata.dbUserId

  // `sinEmpresa` porque un aviso es de la PERSONA, no de una empresa: un
  // cliente de Membego compra en varios comercios y sus avisos vienen de todos.
  // Es el mismo contexto que usa el desplegable de la cabecera de admin.
  const [novedades, avisos] = await Promise.all([
    id ? getNovedadesInicio(id, 12).catch(() => []) : Promise.resolve([]),
    id
      ? sinEmpresa('cliente: sus avisos (cross-tenant)', (tx) =>
          tx.notificacion.findMany({
            where: { userId: id },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, tipo: true, titulo: true, mensaje: true, href: true, leida: true, createdAt: true },
          })
        ).catch((): AvisoPropio[] => [])
      : Promise.resolve([] as AvisoPropio[]),
  ])

  // Vacío solo cuando NO hay ninguna de las dos cosas. Antes bastaba con que
  // el muro estuviera vacío para que la pantalla dijera «sin novedades», y eso
  // habría escondido un aviso de pago.
  if (novedades.length === 0 && avisos.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="Sin novedades por ahora"
        description="Aquí verás tus avisos —compras, membresías y beneficios— y lo que publiquen los negocios que sigues."
        action={
          <Link
            href="/cliente/explorar"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-label-lg text-primary-foreground transition-colors duration-fast hover:bg-brand-primary-hover"
          >
            Explorar empresas
          </Link>
        }
      />
    )
  }

  return (
    <div className="animate-fade-up">
      <MisAvisos avisos={avisos} />
      {novedades.length > 0 && <FeedNovedades novedades={[...novedades]} />}
    </div>
  )
}
