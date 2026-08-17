import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import {
  vendedorDeUsuario,
  miEmbudo,
  misComisiones,
} from '@/modules/excursiones/panel/queries'
import { urlDeEnlace, urlDeQr } from '@/modules/excursiones/vendedores/nucleo'
import { VendedorQrCard } from '@/components/excursiones/VendedorQrCard'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi QR' }

const ETAPAS = [
  { clave: 'visitas', label: 'Abrieron', detalle: 'tu enlace' },
  { clave: 'registros', label: 'Se registraron', detalle: 'por tu QR' },
  { clave: 'reservas', label: 'Reservaron', detalle: 'una excursión' },
  { clave: 'compras', label: 'Compraron', detalle: 'y pagaron' },
] as const

export default async function VendedorInicioPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const [embudo, comisiones] = await Promise.all([
    miEmbudo(vendedor.companyId, vendedor.id),
    misComisiones(vendedor.companyId, vendedor.id),
  ])

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-caption text-muted-foreground">Por cobrar</p>
        <p className="text-h1 text-foreground">
          {formatMoney(comisiones.porCobrar, { moneda: comisiones.moneda }, 2)}
        </p>
        <p className="text-caption text-muted-foreground">
          Ya cobrado: {formatMoney(comisiones.cobrado, { moneda: comisiones.moneda }, 2)}
        </p>
      </section>

      {vendedor.slug ? (
        <VendedorQrCard
          codigo={vendedor.codigo}
          enlaceUrl={urlDeEnlace(vendedor.slug)}
          qrUrl={urlDeQr(vendedor.slug)}
          nombre={vendedor.primerNombre}
        />
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-h3 text-foreground">Tus clientes</h2>
        <p className="mt-1 text-caption text-muted-foreground">
          Todo el que entra por tu QR queda contado aquí.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {ETAPAS.map((e) => (
            <div key={e.clave} className="rounded-xl bg-muted/50 p-3 text-center">
              <dd className="text-h2 font-bold text-foreground">{embudo[e.clave]}</dd>
              <dt className="text-sm font-medium text-foreground">{e.label}</dt>
              <p className="text-caption text-muted-foreground">{e.detalle}</p>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
