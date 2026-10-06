import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ofertasDisponibles } from '@/modules/supply/distribucion'
import { TarjetaOferta } from '@/components/supply/tarjeta-oferta'
import { TarjetaVenta } from '@/components/supply/tarjeta-venta'
import { ofertasDeVenta } from '@/modules/supply/ventas'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Beneficios disponibles' }

/**
 * MEMBEGO SUPPLY · vitrina del cliente (Fase 56).
 *
 * Lo que Membego compró y todavía puede repartir. Resuelve el problema del
 * marketplace nuevo —«¿por qué se registraría el primer consumidor si hay poca
 * oferta?»— porque aquí la oferta la fabrica Membego, no depende de que
 * cincuenta empresas publiquen buenos descuentos por voluntad propia.
 *
 * El cliente ve qué se lleva, de quién, cuántas quedan y hasta cuándo. NO ve
 * el costo, el contrato ni la liquidación del proveedor.
 */
export default async function BeneficiosDisponiblesPage() {
  const user = await requireRole('CLIENTE')
  const [ofertas, clienteIds, ventas] = await Promise.all([
    ofertasDisponibles(60),
    misClienteIds(user.supabaseId),
    ofertasDeVenta(30).catch(() => []),
  ])

  // Lo que esta persona YA tiene de cada campaña: la tarjeta lo dice en vez de
  // dejarla pulsar «Obtener» para recibir un «ya lo tienes».
  const yaTiene = await sinEmpresa(
    'Membego Supply: qué campañas ya reclamó esta persona',
    (tx) =>
      clienteIds.length === 0
        ? Promise.resolve([])
        : tx.supplyDerecho.findMany({
            where: { clienteId: { in: clienteIds }, asignacionId: { not: null } },
            select: { asignacionId: true },
          })
  ).catch(() => [])
  const reclamadas = new Set(yaTiene.map((d) => d.asignacionId))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficios disponibles"
        description="Productos y servicios que Membego ya pagó por adelantado. Obtén el tuyo y recógelo en el negocio."
        eyebrow={
          <Link href="/cliente/beneficios" className="hover:underline">
            Beneficios Membego
          </Link>
        }
      />

      {ofertas.length === 0 && ventas.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Sparkles className="size-6" />}
          title="No hay beneficios disponibles ahora mismo"
          description="Membego está negociando con más negocios. Vuelve pronto: cuando haya beneficios nuevos aparecen aquí."
        />
      ) : (
        <>
          {ofertas.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ofertas.map((o) => (
                <TarjetaOferta
                  key={o.asignacionId}
                  oferta={{ ...o, venceAt: o.venceAt.toISOString() }}
                  clienteId={clienteIds[0] ?? ''}
                  yaLoTengo={reclamadas.has(o.asignacionId)}
                />
              ))}
            </div>
          )}
          {ventas.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-h3 font-semibold">Compra y recoge</h2>
              <p className="text-caption text-muted-foreground">
                Productos que Membego vende por cuenta del negocio: pagas a Membego y recoges con tu código.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ventas.map((v) => (
                  <TarjetaVenta
                    key={v.acuerdoId}
                    oferta={{ ...v, finAt: v.finAt.toISOString() }}
                    clienteId={clienteIds[0] ?? ''}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
