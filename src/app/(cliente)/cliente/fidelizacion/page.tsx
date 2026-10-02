import Link from 'next/link'
import { Award, Gift, Sparkles, Ticket, UserPlus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { resumenDeFidelizacion } from '@/modules/supply-v2/loyalty/queries'
import {
  RUTA_INVITAR_CLIENTE,
  RUTA_MEMBRESIAS_CLIENTE,
  RUTA_MEMBRESIAS_PUBLICAS,
  RUTA_PUNTOS_CLIENTE,
  RUTA_RECOMPENSAS_CLIENTE,
} from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelización' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · el centro de fidelización del cliente (§39).
 *
 * Cuatro puertas y un resumen honesto. Lo que NO sale de aquí, nunca: el
 * presupuesto de ningún programa, el costo de ninguna recompensa ni la
 * comisión de ninguna venta. No se oculta en la plantilla: no viene en los
 * datos.
 */
export default async function FidelizacionPage() {
  const user = await requireRole('CLIENTE')
  const id = user.metadata.dbUserId
  const resumen = id ? await resumenDeFidelizacion(id) : null
  const tieneAlgo = Boolean(resumen && (resumen.membresias.length > 0 || resumen.puntos.length > 0))

  const puertas = [
    { href: RUTA_MEMBRESIAS_CLIENTE, icono: <Award className="h-5 w-5" aria-hidden />, titulo: 'Mis membresías', pie: resumen ? `${resumen.membresiasActivas} activa(s)` : '—', testid: 'puerta-membresias' },
    { href: RUTA_PUNTOS_CLIENTE, icono: <Sparkles className="h-5 w-5" aria-hidden />, titulo: 'Mis puntos', pie: resumen ? `${resumen.puntosTotales} disponibles` : '—', testid: 'puerta-puntos' },
    { href: RUTA_RECOMPENSAS_CLIENTE, icono: <Gift className="h-5 w-5" aria-hidden />, titulo: 'Mis recompensas', pie: 'Canjea tus puntos', testid: 'puerta-recompensas' },
    { href: RUTA_INVITAR_CLIENTE, icono: <UserPlus className="h-5 w-5" aria-hidden />, titulo: 'Invitar amigos', pie: 'Gana cuando compren', testid: 'puerta-invitar' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelización"
        description="Tus membresías, tus puntos y tus recompensas de Membego, en un solo sitio."
        eyebrow="Membego"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {puertas.map((p) => (
          <Link key={p.href} href={p.href} data-testid={p.testid} className="block">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex items-center gap-4 pt-6">
                <span className="rounded-full bg-primary/10 p-3 text-primary">{p.icono}</span>
                <span>
                  <span className="block text-h4">{p.titulo}</span>
                  <span className="block text-sm text-muted-foreground tabular-nums">{p.pie}</span>
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {!tieneAlgo && (
        <EmptyState
          variant="card"
          icon={<Ticket className="h-6 w-6" aria-hidden />}
          title="Todavía no tienes nada aquí"
          description="Cuando te hagas miembro de un negocio o ganes puntos con tus compras, lo verás en esta pantalla."
          action={
            <Button asChild>
              <Link href={RUTA_MEMBRESIAS_PUBLICAS}>Ver membresías disponibles</Link>
            </Button>
          }
        />
      )}

      {resumen?.proximoVencimiento && (
        <Card data-testid="aviso-vencimiento">
          <CardContent className="pt-6">
            <p className="text-sm">
              Tu membresía <strong>{resumen.proximoVencimiento.plan}</strong> de {resumen.proximoVencimiento.negocio} vence en{' '}
              <strong className="tabular-nums">{resumen.proximoVencimiento.diasRestantes}</strong> día(s).{' '}
              <Link className="underline" href={RUTA_MEMBRESIAS_CLIENTE}>Renovarla</Link>.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
