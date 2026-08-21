'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CreditCard, Compass, Search, Ticket, Gauge, CalendarClock } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { } from '@/components/ui/input'
import { } from '@/lib/format'
import { EmptyState } from '@/components/system/EmptyState'
import { } from './ExcursionSearchCard'
import { ReservaCard } from './ReservaCard'
import { WalletStack , type WalletStackItem } from '@/components/wallet/WalletStack'
import { AnimatedCounter } from '@/components/system/AnimatedCounter'
import { StatCard } from '@/components/ui/stat-card'
import { membresiaEstadoUi } from '@/lib/estados'
import { differenceInDays } from 'date-fns'

type TabValue = 'membresias' | 'mis-excursiones' | 'buscar'

interface MembershipData {
  id: string
  clienteId: string
  companyId: string
  company: { name: string; logoUrl: string | null; colorPrimario: string | null }
  plan: { nombre: string; esIlimitado: boolean; lavadosIncluidos: number }
  estado: string
  fechaVencimiento: Date | null
  lavadosRestantes: number
  qrToken: { id: string; token: string } | null
}

interface ReservaData {
  id: string
  numero: string
  estado: string
  fecha: Date
  hora: string | null
  adultos: number
  ninos: number
  total: number
  moneda: string
  excursion: { id: string; nombre: string; slug: string; portadaUrl: string | null }
}

interface DashboardClientProps {
  initialTab: 'membresias' | 'mis-excursiones' | 'buscar'
  memberships: MembershipData[]
  proximas: ReservaData[]
  pasadas: ReservaData[]
  now: Date
}

export function DashboardClient({
  initialTab,
  memberships,
  proximas,
  pasadas,
  now }: DashboardClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabValue>(
    (searchParams.get('tab') as TabValue) ?? initialTab
  )

  const aItem = (m: MembershipData) => {
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
          colorPrimario: m.company.colorPrimario },
        planNombre: m.plan.nombre,
        estadoLabel: membresiaEstadoUi(m.estado).labelCliente,
        tone: activa ? ('active' as const) : vencida ? ('expired' as const) : ('pending' as const),
        expiryText,
        esIlimitado: m.plan.esIlimitado,
        usosRestantes: m.lavadosRestantes,
        usosTotales: m.plan.lavadosIncluidos ?? null },
      // `WalletStack` espera la CADENA del token, no el objeto. El tipo
      // `any` del mapeador tapaba la diferencia: la pila habría recibido
      // `{ id, token }` donde espera un string, y el QR no se pintaría.
      qrToken: m.qrToken?.token ?? null,
      isActive: activa }
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
            <MembresiasTab
              activas={activas}
              inactivas={inactivas}
              aItem={aItem}
              usosDisponibles={usosDisponibles}
              tieneIlimitado={tieneIlimitado}
              now={now}
              memberships={memberships}
            />
          </TabsContent>

          {/* Tab: Mis Excursiones */}
          <TabsContent value="mis-excursiones" className="mt-6">
            <MisExcursionesTab
              proximas={proximas}
              pasadas={pasadas}
              now={now}
            />
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

function MembresiasTab({
  activas,
  inactivas,
  aItem,
  usosDisponibles,
  tieneIlimitado,
  now,
  memberships }: {
  activas: MembershipData[]
  inactivas: MembershipData[]
  aItem: (m: MembershipData) => WalletStackItem
  usosDisponibles: number
  tieneIlimitado: boolean
  now: Date
  memberships: MembershipData[]
}) {
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

function MisExcursionesTab({
  proximas,
  pasadas,
  now }: {
  proximas: ReservaData[]
  pasadas: ReservaData[]
  now: Date
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h3 font-bold">Mis reservas</h2>
          <p className="text-sm text-muted-foreground">{proximas.length + pasadas.length} reserva{proximas.length + pasadas.length !== 1 ? 's' : ''} en total</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/cliente/explorar">
            <Compass className="mr-2 h-4 w-4" />
            Explorar más
          </Link>
        </Button>
      </div>

      {proximas.length === 0 && pasadas.length === 0 ? (
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
                  <ReservaCard key={r.id} reserva={r} ahora={now} />
                ))}
              </div>
            </section>
          )}

          {pasadas.length > 0 && (
            <section aria-labelledby="pasadas-heading" className="space-y-3 mt-6">
              <h3 id="pasadas-heading" className="text-h4 font-semibold">Pasadas ({pasadas.length})</h3>
              <div className="space-y-3">
                {pasadas.map((r) => (
                  <ReservaCard key={r.id} reserva={r} ahora={now} />
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