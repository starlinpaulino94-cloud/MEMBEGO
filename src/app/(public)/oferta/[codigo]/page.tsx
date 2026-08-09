import Link from 'next/link'
import { BadgeCheck, CalendarClock, Gift, Lock, Ticket } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { getOfertaParaCliente } from '@/modules/ofertas/queries'
import { PERIODO_LABEL } from '@/modules/ofertas/periodo'
import { ReclamarOferta } from '@/components/ofertas/ReclamarOferta'
import { shareMetadata } from '@/lib/share/metadata'

export const dynamic = 'force-dynamic'

/** OG genérica: el contenido del regalo NO se filtra a terceros por el link. */
export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  return shareMetadata({
    title: '🎁 Tienes un regalo',
    description: 'Fuiste seleccionado para un beneficio exclusivo. Ábrelo con tu cuenta para reclamarlo.',
    url: `/oferta/${codigo}`,
  })
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="container flex min-h-[70vh] max-w-lg items-center py-10">
      <div className="w-full rounded-2xl border border-border/70 bg-card p-8 text-center shadow-premium">
        {children}
      </div>
    </main>
  )
}

export default async function OfertaPage({
  params,
}: {
  params: Promise<{ codigo: string }>
}) {
  const { codigo } = await params
  const user = await getUser()
  const esCliente = user?.metadata.role === 'CLIENTE' && !!user.metadata.clienteId

  // Sin sesión de cliente: invitar a entrar (con retorno al regalo). No se
  // muestra el contenido: la elegibilidad se decide por CUENTA.
  if (!esCliente) {
    return (
      <Marco>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Gift className="h-8 w-8 text-primary" />
        </span>
        <h1 className="mt-4 text-h1 text-foreground">
          Tienes un regalo esperándote
        </h1>
        <p className="mt-2 text-muted-foreground">
          Inicia sesión con tu cuenta para ver si este beneficio exclusivo es
          para ti.
        </p>
        <div className="mt-6 space-y-2">
          <Link
            href={`/login?redirect=/oferta/${codigo}`}
            className="block rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:opacity-95"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/registro"
            className="block rounded-xl border border-border px-6 py-3 font-semibold text-foreground transition hover:bg-muted"
          >
            Aún no tengo cuenta
          </Link>
        </div>
      </Marco>
    )
  }

  const data = await getOfertaParaCliente(codigo, user!.metadata.clienteId!)

  if (!data) {
    return (
      <Marco>
        <Lock className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <h1 className="mt-4 text-h2 text-foreground">Esta oferta ya no existe</h1>
        <p className="mt-2 text-muted-foreground">El enlace no corresponde a un regalo vigente.</p>
      </Marco>
    )
  }

  const { oferta, estadoCliente, usosPeriodo } = data

  // Fuera de la lista: el mensaje pedido, sin revelar el contenido del regalo.
  if (estadoCliente === 'NO_INVITADO') {
    return (
      <Marco>
        <Lock className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <h1 className="mt-4 text-h2 text-foreground">
          Tu cuenta no aplica para esta promoción
        </h1>
        <p className="mt-2 text-muted-foreground">
          Este beneficio es exclusivo para una lista de clientes seleccionados
          por {oferta.company.name}. Sigue atento: pronto habrá ofertas para ti.
        </p>
        <Link
          href="/cliente/promociones"
          className="mt-6 inline-block rounded-xl border border-border px-6 py-3 font-semibold text-foreground transition hover:bg-muted"
        >
          Ver promociones disponibles
        </Link>
      </Marco>
    )
  }

  if (estadoCliente === 'NO_DISPONIBLE') {
    return (
      <Marco>
        <CalendarClock className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <h1 className="mt-4 text-h2 text-foreground">Este regalo ya no está disponible</h1>
        <p className="mt-2 text-muted-foreground">
          La oferta fue pausada o su vigencia terminó. Contacta a {oferta.company.name} si
          tienes dudas.
        </p>
      </Marco>
    )
  }

  const restantes = Math.max(0, oferta.usosPorPeriodo - usosPeriodo)

  return (
    <Marco>
      <span className="mx-auto flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-primary/10">
        <Gift className="h-8 w-8 text-primary" />
      </span>
      <p className="mt-4 text-overline tracking-[0.22em] text-primary">
        Regalo exclusivo · {oferta.company.name}
      </p>
      <h1 className="mt-2 text-h1 text-foreground">
        {oferta.titulo}
      </h1>
      {oferta.descripcion && (
        <p className="mt-2 whitespace-pre-line text-muted-foreground">{oferta.descripcion}</p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-muted/50 p-3">
          <p className="flex items-center justify-center gap-1.5 text-h3 text-foreground">
            <Ticket className="h-4 w-4 text-muted-foreground" />
            {oferta.usosPorPeriodo} {PERIODO_LABEL[oferta.periodo]}
          </p>
          <p className="text-caption text-muted-foreground">usos incluidos</p>
        </div>
        <div className="rounded-2xl bg-muted/50 p-3">
          <p className="flex items-center justify-center gap-1.5 text-h3 text-foreground">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            {oferta.vigenciaHasta
              ? new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(oferta.vigenciaHasta)
              : 'Sin fecha límite'}
          </p>
          <p className="text-caption text-muted-foreground">válido hasta</p>
        </div>
      </div>

      <div className="mt-6">
        {estadoCliente === 'INVITADO' ? (
          <ReclamarOferta codigo={codigo} />
        ) : (
          <div className="rounded-2xl border border-success/25 bg-success/10 p-4">
            <p className="flex items-center justify-center gap-2 font-semibold text-success">
              <BadgeCheck className="h-5 w-5" /> Regalo reclamado
            </p>
            <p className="mt-1 text-sm text-foreground">
              Te quedan <span className="font-bold">{restantes}</span> de{' '}
              {oferta.usosPorPeriodo} usos {PERIODO_LABEL[oferta.periodo]}. Preséntate en el
              local y el equipo registrará cada uso.
            </p>
          </div>
        )}
      </div>
    </Marco>
  )
}
