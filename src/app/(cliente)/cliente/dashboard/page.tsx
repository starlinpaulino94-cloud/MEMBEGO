'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CreditCard, Compass, Search, Ticket, Users, CalendarDays } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/format'
import { EmptyState } from '@/components/system/EmptyState'
import { ExcursionSearchCard } from './ExcursionSearchCard'
import { ReservaCard } from './ReservaCard'

type TabValue = 'membresias' | 'mis-excursiones' | 'buscar'

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabValue>(
    (searchParams.get('tab') as TabValue) ?? 'membresias'
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-h2 font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu centro de control: membresías, excursiones y descubrimientos
          </p>
        </div>

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={(v) => {
          setActiveTab(v as TabValue)
          router.push(`/cliente/dashboard?tab=${v}`)
        }} className="w-full">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
            <TabsTrigger value="membresias">
              <CreditCard className="mr-2 h-4 w-4" />
              Membresías
            </TabsTrigger>
            <TabsTrigger value="mis-excursiones">
              <Ticket className="mr-2 h-4 w-4" />
              Mis excursiones
            </TabsTrigger>
            <TabsTrigger value="buscar">
              <Search className="mr-2 h-4 w-4" />
              Buscar
            </TabsTrigger>
          </TabsList>

          {/* Tab: Membresías */}
          <TabsContent value="membresias" className="mt-6">
            <MembresiasTab />
          </TabsContent>

          {/* Tab: Mis Excursiones */}
          <TabsContent value="mis-excursiones" className="mt-6">
            <MisExcursionesTab />
          </TabsContent>

          {/* Tab: Buscar Excursiones */}
          <TabsContent value="buscar" className="mt-6">
            <BuscarExcursionesTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

async function MembresiasTab() {
  const { getClienteAllMemberships } = await import('@/modules/cliente/queries')
  const { getUser } = await import('@/lib/auth')
  const { membresiaEstadoUi } = await import('@/lib/estados')
  const { WalletStack } = await import('@/components/wallet/WalletStack')
  const { AnimatedCounter } = await import('@/components/system/AnimatedCounter')
  const { StatCard } = await import('@/components/ui/stat-card')
  const { Gauge, CalendarClock } = await import('lucide-react')
  const { differenceInDays } = await import('date-fns')
  const { formatMoney } = await import('@/lib/format')

  const user = await getUser()
  if (!user?.supabaseId) return null

  const memberships = await getClienteAllMemberships(user.supabaseId)
  const now = new Date()

  const aItem = (m: typeof memberships[number]) => {
    const vencimiento = m.fechaVencimiento ? new Date(m.fechaVencimiento) : null
    const activa = m.estado === 'ACTIVA' && (!vencimiento || vencimiento > now)
    const vencida = m.estado === 'VENCIDA' || (vencimiento !== null && vencimiento <= now)
    let expiryText: string | null = null
    if (vencimiento) {
      const dias = differenceInDays(vencimiento, now)
      expiryText =
        dias > 0
          ? `Vence en ${dias} día${dias !== 1 ? 's' : ''}`
          : dias === 0
            ? 'Vence hoy'
            : `Venció hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`
    }
    return {
      id: m.id,
      card: {
        company: {
          name: m.company.name,
          logoUrl: m.company.logoUrl,
          colorPrimario: m.company.colorPrimario,
        },
        planNombre: m.plan.nombre,
        estadoLabel: membresiaEstadoUi(m.estado).labelCliente,
        tone: activa ? ('active' as const) : vencida ? ('expired' as const) : ('pending' as const),
        expiryText,
        esIlimitado: m.plan.esIlimitado,
        usosRestantes: m.lavadosRestantes,
        usosTotales: m.plan.lavadosIncluidos ?? null,
      },
      qrToken: m.qrToken?.token ?? null,
      isActive: activa,
    }
  }

  const activas = memberships.filter((m) => {
    const v = m.fechaVencimiento ? new Date(m.fechaVencimiento) : null
    return m.estado === 'ACTIVA' && (!v || v > now)
  })
  const inactivas = memberships.filter((m) => !activas.some((a) => a.id === m.id))

  const usosDisponibles = activas.reduce(
    (s, m) => s + (m.plan.esIlimitado ? 0 : m.lavadosRestantes),
    0
  )
  const tieneIlimitado = activas.some((m) => m.plan.esIlimitado)

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={CreditCard}
          accent="success"
          label={`Membresía${activas.length !== 1 ? 's' : ''} activa${activas.length !== 1 ? 's' : ''}`}
          value={<AnimatedCounter value={activas.length} />}
        />
        <StatCard
          icon={Gauge}
          accent="brand"
          label="Usos disponibles"
          value={tieneIlimitado ? 'Ilimitados' : <AnimatedCounter value={usosDisponibles} />}
        />
        <StatCard
          icon={CalendarClock}
          accent="brand"
          label="Próximo vencimiento"
          value={
            activas.length === 0 ? '—' : (
              <span>
                {Math.min(...activas.map(m => m.fechaVencimiento ? differenceInDays(new Date(m.fechaVencimiento), now) : 999))} días
              </span>
            )
          }
        />
      </div>

      {activas.length > 0 && (
        <section>
          <h2 className="text-h3 font-bold">Activas</h2>
          <WalletStack items={activas.map(aItem)} />
        </section>
      )}

      {inactivas.length > 0 && (
        <section className="mt-10">
          <h2 className="text-h3 font-bold">Vencidas / Inactivas</h2>
          <WalletStack items={inactivas.map(aItem)} />
        </section>
      )}

      {memberships.length === 0 && (
        <EmptyState
          icon={CreditCard}
          title="Sin membresías aún"
          description="Activa tu primera membresía para disfrutar beneficios con tu QR."
          action={
            <Button asChild size="lg">
              <Link href="/cliente/planes">Ver planes disponibles</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}

async function MisExcursionesTab() {
  const { getUser } = await import('@/lib/auth')
  const { prisma } = await import('@/lib/prisma')
  const { reservasCliente } = await import('@/modules/excursiones/reservas/queries')
  const { redirect } = await import('next/navigation')
  const { formatDate } = await import('@/lib/format')
  const { ESTADO_RESERVA_LABEL, TONO_RESERVA } = await import('@/modules/excursiones/reservas/nucleo')
  const { EmptyState } = await import('@/components/system/EmptyState')
  const { Ticket } = await import('lucide-react')

  const user = await getUser()
  if (!user) { redirect('/login'); return null }

  const clienteIds = await prisma.cliente.findMany({
    where: { supabaseId: user.supabaseId },
    select: { id: true, companyId: true },
  })
  if (clienteIds.length === 0) { redirect('/cliente/explorar'); return null }

  const allReservas = await Promise.all(
    clienteIds.map((c) => reservasCliente(c.companyId, c.id))
  )
  const reservas = allReservas.flat().sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  const ahora = new Date()

  const proximas = reservas.filter((r) => new Date(r.fecha) >= ahora)
  const pasadas = reservas.filter((r) => new Date(r.fecha) < ahora)

  const TONO_CLASE: Record<string, string> = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
    neutral: 'bg-muted text-muted-foreground',
    danger: 'bg-destructive/10 text-destructive',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h3 font-bold">Mis reservas</h2>
          <p className="text-sm text-muted-foreground">{reservas.length} reserva{reservas.length !== 1 ? 's' : ''} en total</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/cliente/explorar">
            <Compass className="mr-2 h-4 w-4" />
            Explorar más
          </Link>
        </Button>
      </div>

      {reservas.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Sin reservas todavía"
          description="Cuando reserves una excursión, aparecerá aquí."
          action={
            <Button asChild size="lg">
              <Link href="/cliente/explorar">Explorar excursiones</Link>
            </Button>
          }
        />
      ) : (
        <>
          {proximas.length > 0 && (
            <section aria-labelledby="proximas-heading" className="space-y-3">
              <h3 id="proximas-heading" className="text-h4 font-semibold">Próximas ({proximas.length})</h3>
              <div className="space-y-3">
                {proximas.map((r) => (
                  <ReservaCard key={r.id} reserva={r} ahora={ahora} />
                ))}
              </div>
            </section>
          )}

          {pasadas.length > 0 && (
            <section aria-labelledby="pasadas-heading" className="space-y-3 mt-6">
              <h3 id="pasadas-heading" className="text-h4 font-semibold">Pasadas ({pasadas.length})</h3>
              <div className="space-y-3">
                {pasadas.map((r) => (
                  <ReservaCard key={r.id} reserva={r} ahora={ahora} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

async function BuscarExcursionesTab() {
  const { SearchParams } = await import('./BuscarExcursionesSearchParams')
  return <SearchParams />
}