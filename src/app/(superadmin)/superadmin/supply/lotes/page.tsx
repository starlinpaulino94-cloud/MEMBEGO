import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { reporteLotes } from '@/modules/supply/pool'
import { SUPPLY_LOTE_ESTADO_LABELS } from '@/modules/supply/catalogo'
import Form from 'next/form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Lotes de supply' }

/**
 * MEMBEGO SUPPLY · reporte de LOTES (Fase 50).
 *
 * La columna que hace que esta pantalla sea útil y no decorativa es «Cuadra»:
 * compara la suma de las seis cubetas contra lo comprado, lote a lote. Un
 * "no" aquí significa que las cifras de ese lote —y todo lo que se calcule
 * con ellas— no se pueden creer, y lleva directo a la conciliación.
 */
export default async function LotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; proveedor?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { q, proveedor } = await searchParams

  const lotes = await reporteLotes({
    q: (q ?? '').trim().slice(0, 80) || undefined,
    proveedorId: proveedor || undefined,
  })

  const totales = lotes.reduce(
    (t, l) => ({
      compradas: t.compradas + l.compradas,
      disponibles: t.disponibles + l.disponibles,
      emitidas: t.emitidas + l.emitidas,
      redimidas: t.redimidas + l.redimidas,
      costoTotal: t.costoTotal + l.costoTotal,
      costoConsumido: t.costoConsumido + l.costoConsumido,
    }),
    { compradas: 0, disponibles: 0, emitidas: 0, redimidas: 0, costoTotal: 0, costoConsumido: 0 }
  )

  const descuadrados = lotes.filter((l) => !l.cuadra)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lotes de supply"
        description="Cada lote son derechos comprados con su economía congelada. Las seis cubetas tienen que sumar exactamente lo comprado."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="lotes" />}
      />

      <Form action="/superadmin/supply/lotes" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar por código de lote o producto…"
          className="max-w-sm"
          aria-label="Buscar lotes"
        />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </Form>

      {descuadrados.length > 0 && (
        <Card className="border-destructive/30">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-destructive">
              {descuadrados.length} lote(s) no cuadran contra su ledger.
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              Mientras no cuadren, los reportes y las liquidaciones que los incluyan no son
              fiables.{' '}
              <Link href="/superadmin/supply/conciliacion" className="underline underline-offset-4">
                Ir a conciliación
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Lotes de Membego Supply"
            columnas={[
              { clave: 'codigo', titulo: 'Lote' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'item', titulo: 'Producto' },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
              { clave: 'disponibles', titulo: 'Disp.', alinearDerecha: true },
              { clave: 'asignadas', titulo: 'Asign.', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'redimidas', titulo: 'Redim.', alinearDerecha: true },
              { clave: 'cerradas', titulo: 'Cerradas', alinearDerecha: true },
              { clave: 'cuadra', titulo: 'Cuadra' },
              { clave: 'costoTotal', titulo: 'Costo', alinearDerecha: true },
              { clave: 'costoConsumido', titulo: 'Consumido', alinearDerecha: true },
            ]}
            filas={lotes.map((l) => ({
              __clave: l.id,
              codigo: (
                <Link
                  href={`/superadmin/supply/lotes/${l.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {l.codigo}
                </Link>
              ),
              proveedor: l.proveedor,
              item: l.variante ? `${l.item} · ${l.variante}` : l.item,
              estado: (
                <Badge variant={l.estado === 'ACTIVO' ? 'success' : 'outline'}>
                  {SUPPLY_LOTE_ESTADO_LABELS[l.estado as keyof typeof SUPPLY_LOTE_ESTADO_LABELS] ??
                    l.estado}
                </Badge>
              ),
              vence: formatDate(l.venceAt),
              compradas: l.compradas.toLocaleString('es-DO'),
              disponibles: l.disponibles.toLocaleString('es-DO'),
              asignadas: (l.asignadas + l.retenidas).toLocaleString('es-DO'),
              emitidas: l.emitidas.toLocaleString('es-DO'),
              redimidas: l.redimidas.toLocaleString('es-DO'),
              cerradas: l.cerradas.toLocaleString('es-DO'),
              cuadra: l.cuadra ? (
                <Badge variant="success">Sí</Badge>
              ) : (
                <Badge variant="destructive">{l.suma - l.compradas}</Badge>
              ),
              costoTotal: formatMoneyRD(l.costoTotal),
              costoConsumido: formatMoneyRD(l.costoConsumido),
            }))}
            total={{
              codigo: 'Total',
              compradas: totales.compradas.toLocaleString('es-DO'),
              disponibles: totales.disponibles.toLocaleString('es-DO'),
              emitidas: totales.emitidas.toLocaleString('es-DO'),
              redimidas: totales.redimidas.toLocaleString('es-DO'),
              costoTotal: formatMoneyRD(totales.costoTotal),
              costoConsumido: formatMoneyRD(totales.costoConsumido),
            }}
            vacio="Todavía no hay lotes. Se crean al activar una orden de compra."
          />
        </CardContent>
      </Card>
    </div>
  )
}
