import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { reporteProveedores } from '@/modules/supply/pool'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proveedores de supply' }

/**
 * MEMBEGO SUPPLY · SUPPLIER SCORECARD (Fases 31, 49).
 *
 * Existe para contestar una sola pregunta: ¿volvemos a comprarle 5.000
 * unidades a este comercio?
 *
 * El puntaje es una fórmula que se lee en una línea —cumplimiento menos
 * reversas por dos menos incumplimientos por tres— a propósito. Un proveedor
 * tiene derecho a entender por qué Membego dejó de comprarle, y una puntuación
 * que nadie sabe reproducir no sirve para esa conversación.
 */
export default async function ProveedoresPage() {
  await requireRole('SUPERADMIN')
  const filas = await reporteProveedores()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        description="Cuánto se le compró a cada empresa, cuánto ha cumplido y cómo se está portando."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="proveedores" />}
      />

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Proveedores de Membego Supply"
            columnas={[
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'acuerdos', titulo: 'Acuerdos', alinearDerecha: true },
              { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
              { clave: 'sinAsignar', titulo: 'Sin asignar', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
              { clave: 'pendientes', titulo: 'En clientes', alinearDerecha: true },
              { clave: 'cumplimiento', titulo: 'Cumplimiento', alinearDerecha: true },
              { clave: 'incidencias', titulo: 'Incidencias', alinearDerecha: true },
              { clave: 'costoTotal', titulo: 'Contratado', alinearDerecha: true },
              { clave: 'costoConsumido', titulo: 'Consumido', alinearDerecha: true },
              { clave: 'puntaje', titulo: 'Puntaje', alinearDerecha: true },
            ]}
            filas={filas.map((p) => ({
              __clave: p.proveedorId,
              proveedor: (
                <Link
                  href={`/superadmin/supply/proveedores/${p.proveedorId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {p.proveedor}
                </Link>
              ),
              acuerdos: p.acuerdos,
              compradas: p.compradas.toLocaleString('es-DO'),
              sinAsignar: p.sinAsignar.toLocaleString('es-DO'),
              emitidas: p.emitidas.toLocaleString('es-DO'),
              redimidas: p.redimidas.toLocaleString('es-DO'),
              pendientes: p.pendientesCliente.toLocaleString('es-DO'),
              cumplimiento: `${p.scorecard.tasaCumplimiento}%`,
              incidencias: p.scorecard.incidencias,
              costoTotal: formatMoneyRD(p.costoTotal),
              costoConsumido: formatMoneyRD(p.costoConsumido),
              puntaje: (
                <Badge
                  variant={
                    p.scorecard.puntaje >= 85
                      ? 'success'
                      : p.scorecard.puntaje >= 60
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {p.scorecard.puntaje}
                </Badge>
              ),
            }))}
            vacio="Ninguna empresa tiene supply comprado todavía."
          />
        </CardContent>
      </Card>
    </div>
  )
}
