import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CalendarDays, CheckCircle2, Clock, MapPin } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { safeInternalPath } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { getAgendaConfig } from '@/modules/citas/queries'
import { Button } from '@/components/ui/button'
import { misClienteIds } from '@/modules/cliente/afiliacion'

export const dynamic = 'force-dynamic'

export const metadata = { title: '¿Agendas tu cita?' }

/**
 * Paso OPCIONAL justo después de adquirir un beneficio.
 *
 * Se ofrece agendar la cita, nunca se exige: el beneficio YA es del cliente y
 * su QR ya está disponible en el detalle. Agendar solo le reserva el turno.
 * Por eso "Omitir" es un botón de primer nivel, no un enlace escondido.
 *
 * Si la empresa no tiene agenda activa (o el cliente ya agendó), esta pantalla
 * no tiene nada que ofrecer y manda directo al detalle — así el flujo nunca
 * gana un paso vacío.
 */
export default async function AgendarTrasAdquirirPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ retorno?: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { id } = await params
  const { retorno: retornoParam } = await searchParams
  // Fase 4 · contexto de ubicación: "Omitir" lleva al detalle de la compra con
  // el retorno encadenado (el back de ese detalle vuelve al mapa).
  const retorno = safeInternalPath(retornoParam, '/cliente/mis-promociones')
  const retornoQs = retornoParam ? `?retorno=${encodeURIComponent(retorno)}` : ''

  const compra = await prisma.productoCompra.findUnique({
    where: { id },
    select: {
      id: true,
      clienteId: true,
      companyId: true,
      estado: true,
      promocion: { select: { titulo: true } },
      company: { select: { name: true } },
    },
  })
  // Contra TODAS las fichas de la persona, no solo la de la empresa activa: una
  // recompensa reclamada en otro negocio queda bajo la ficha de ESE negocio, y
  // comparando con la activa esta pantalla daba 404 — justo aquí, que es adonde
  // el botón de adquirir redirige nada más adquirir. Ver `afiliacion.ts`.
  if (!compra || !(await misClienteIds(user.supabaseId)).includes(compra.clienteId)) notFound()

  const destino = `/cliente/mis-promociones/${compra.id}${retornoQs}`

  // Nada que ofrecer si la agenda está apagada para esta empresa.
  const { tieneCapacidad } = await import('@/modules/capacidades/resolver')
  const citasActivas = await tieneCapacidad(compra.companyId, 'CITAS').catch(() => false)
  const agenda = citasActivas ? await getAgendaConfig(compra.companyId).catch(() => null) : null
  if (!agenda?.activa) redirect(destino)

  // Ya agendó (por ejemplo, si recarga esta pantalla): no volver a preguntar.
  try {
    const yaTiene = await prisma.cita.findFirst({
      where: { compraId: compra.id, estado: { notIn: ['CANCELADA', 'NO_ASISTIO'] } },
      select: { id: true },
    })
    if (yaTiene) redirect(destino)
  } catch {
    // Columna citas.compraId sin migrar: seguimos ofreciendo, no es crítico.
  }

  const titulo = compra.promocion?.titulo ?? 'Tu beneficio'

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center space-y-7 py-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
        <CheckCircle2 className="h-9 w-9 text-success" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">¡Listo, ya es tuyo!</h1>
        <p className="text-muted-foreground">
          <strong className="text-foreground">{titulo}</strong> quedó guardado en tus
          beneficios de {compra.company.name}. Tu código QR ya está disponible.
        </p>
      </div>

      <div className="w-full space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 text-left">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h2 className="font-bold text-foreground">¿Quieres agendar tu cita ahora?</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Es <strong className="text-foreground">opcional</strong>. Si agendas, el local te
          reserva el turno y no haces fila. Si prefieres, puedes ir cuando quieras y
          agendar más tarde desde tus beneficios.
        </p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-primary" /> Eliges el día y la hora que
            te convenga.
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-primary" /> El negocio te espera
            preparado.
          </li>
        </ul>
      </div>

      <div className="w-full space-y-2.5">
        <Button asChild size="xl" className="w-full gap-2 font-bold shadow-glow">
          <Link href={`/cliente/citas?compra=${compra.id}${retornoParam ? `&retorno=${encodeURIComponent(retorno)}` : ''}`}>
            <CalendarDays className="h-5 w-5" /> Agendar mi cita
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full font-semibold">
          <Link href={destino}>Omitir por ahora</Link>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Omitir no afecta tu beneficio: sigue siendo tuyo y puedes usarlo cuando quieras.
      </p>
    </div>
  )
}
