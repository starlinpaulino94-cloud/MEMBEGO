import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { getUser } from '@/lib/auth'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { cargarFichaDeExcursion } from '@/modules/comercio/ficha-excursion'
import type { SalidaDisponible } from '@/modules/excursiones/catalogo/public-queries'
import { FichaDeExcursion } from '@/components/excursiones/FichaDeExcursion'
import { ReservaExcursionForm } from '@/components/excursiones/ReservaExcursionForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Excursión · ${SITE_NAME}`,
  // La app no se indexa: su ficha es la de la landing, que es la que se comparte.
  robots: { index: false, follow: false },
}

/**
 * La ficha de una excursión DENTRO DE LA APP: aquí se elige fecha y pasajeros, se agrega al carrito y se reserva. Lo
 * mismo que se ve en la landing (`FichaDeExcursion`), con el formulario de verdad en lugar del traspaso.
 *
 * La sesión de CLIENTE la exige el layout de `/cliente`. «No existe» y «no es pública» se ven igual que en la landing:
 * mismo cargador.
 */
export default async function FichaDeExcursionEnLaAppPage({ params }: { params: Promise<{ companySlug: string; excursionSlug: string }> }) {
  const { companySlug, excursionSlug } = await params
  const ficha = await cargarFichaDeExcursion(companySlug, excursionSlug)
  if (!ficha) notFound()
  const { company, companyId, exc, precioDesde } = ficha

  // ¿Ya sigue a la empresa? La reserva pide seguirla (se hace sola al enviar si aún no).
  const user = await getUser()
  let isFollowing = false
  if (user) {
    // `users` es una tabla del NÚCLEO, no de una empresa: la identidad del usuario autenticado existe antes que
    // cualquier tenant y se resuelve por su `supabaseId`. Por eso va con `sinEmpresa` y su motivo escrito.
    const usuario = await sinEmpresa('identidad del usuario autenticado (tabla del núcleo)', (tx) =>
      tx.user.findUnique({ where: { supabaseId: user.supabaseId }, select: { id: true } })
    )
    if (usuario) {
      // El seguimiento sí pertenece a una empresa concreta: va acotado a ella.
      const follow = await conEmpresa(company.id, (tx) =>
        tx.companyFollow.findUnique({ where: { userId_companyId: { userId: usuario.id, companyId: company.id } }, select: { id: true } })
      )
      isFollowing = !!follow
    }
  }

  return (
    <FichaDeExcursion
      ficha={ficha}
      espacio="app"
      ranuraReserva={
        <ReservaExcursionForm
          companyId={companyId}
          companySlug={companySlug}
          excursionId={exc.id}
          excursionSlug={excursionSlug}
          nombreExcursion={exc.nombre}
          portadaUrl={exc.portadaUrl}
          moneda={exc.moneda}
          variantes={exc.variantes.map((v) => ({
            id: v.id,
            nombre: v.nombre,
            precioAdulto: Number(v.precioAdulto),
            precioNino: v.precioNino != null ? Number(v.precioNino) : null,
            preciosDinamicos: v.preciosDinamicos,
          }))}
          horarios={exc.horarios.map((h) => ({ id: h.id, horaSalida: h.horaSalida, diasSemana: h.diasSemana }))}
          precioDesde={precioDesde != null ? Number(precioDesde) : null}
          isAuthenticated={!!user}
          isFollowing={isFollowing}
          proximasSalidas={exc.proximasSalidas as SalidaDisponible[]}
          agotadaGlobal={exc.agotadaGlobal}
          todasFechasPasadas={exc.todasFechasPasadas}
          capacidad={exc.capacidad}
          tipoItem={exc.tipoItem}
          comboItems={exc.comboItems?.map((ci) => ({
            actividad: {
              id: ci.actividad.id,
              nombre: ci.actividad.nombre,
              slug: ci.actividad.slug,
              tipoItem: ci.actividad.tipoItem,
              portadaUrl: ci.actividad.portadaUrl,
              duracionMin: ci.actividad.duracionMin,
              horaSalida: ci.actividad.horaSalida,
              horaRegreso: ci.actividad.horaRegreso,
              categoria: ci.actividad.categoria,
              horarios: ci.actividad.horarios?.map((h) => ({
                id: h.id,
                horaSalida: h.horaSalida,
                diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
                cupo: h.cupo,
              })),
            },
            horaSalida: ci.horaSalida,
            permitirSolapamiento: ci.permitirSolapamiento,
            horarioFijo: ci.horarioFijo,
          }))}
          esEmpresaDemo={company.esDemo}
        />
      }
    />
  )
}
