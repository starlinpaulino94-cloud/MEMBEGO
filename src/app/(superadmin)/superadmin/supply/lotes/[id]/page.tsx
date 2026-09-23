import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { asignacionesDeLote } from '@/modules/supply/asignaciones'
import { costosDeLote } from '@/modules/supply/economia'
import {
  SUPPLY_CUBETA_LABELS,
  SUPPLY_DESTINO_LABELS,
  SUPPLY_LOTE_ESTADO_LABELS,
  SUPPLY_MODELO_EXPLICACION,
  SUPPLY_MOVIMIENTO_LABELS,
  SUPPLY_TIPO_LABELS,
  type SupplyDestino,
} from '@/modules/supply/catalogo'
import { FormAsignar } from '@/components/supply/form-asignar'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY · ficha de un LOTE.
 *
 * Es la pantalla donde se demuestra que el módulo no miente: arriba las seis
 * cubetas, en medio a qué campañas está prometido, y abajo EL LEDGER ENTERO —
 * cada asiento con su fecha, su motivo y quién lo hizo.
 *
 * El ledger se enseña completo a propósito. Un panel que resume los
 * movimientos obliga a pedirle a alguien que consulte la base cuando algo no
 * cuadra, que es justo el momento en que la pantalla tendría que servir.
 */
export default async function LoteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const datos = await sinEmpresa('Membego Supply: ficha de un lote', async (tx) => {
    const lote = await tx.supplyLote.findUnique({
      where: { id },
      select: {
        id: true,
        codigo: true,
        estado: true,
        inicioAt: true,
        venceAt: true,
        compradas: true,
        disponibles: true,
        asignadas: true,
        retenidas: true,
        emitidas: true,
        redimidas: true,
        cerradas: true,
        version: true,
        snapshotItemNombre: true,
        snapshotVariante: true,
        snapshotCostoUnitario: true,
        snapshotPrecioReferencia: true,
        snapshotModelo: true,
        snapshotTipo: true,
        snapshotMoneda: true,
        snapshotCapacidadDiaria: true,
        snapshotCapacidadHoraria: true,
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true, modalidadPago: true, politicaSobrante: true } },
        orden: { select: { id: true, numero: true } },
      },
    })
    if (!lote) return null

    const [asignaciones, movimientos] = await Promise.all([
      asignacionesDeLote(tx, id),
      tx.supplyMovimiento.findMany({
        where: { loteId: id },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          tipo: true,
          origen: true,
          destino: true,
          cantidad: true,
          motivo: true,
          referencia: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      }),
    ])
    return { lote, asignaciones, movimientos }
  })

  if (!datos) notFound()
  const { lote, asignaciones, movimientos } = datos

  const costoUnitario = Number(lote.snapshotCostoUnitario)
  const costos = costosDeLote(
    {
      DISPONIBLE: lote.disponibles,
      ASIGNADO: lote.asignadas,
      RETENIDO: lote.retenidas,
      EMITIDO: lote.emitidas,
      REDIMIDO: lote.redimidas,
      CERRADO: lote.cerradas,
    },
    costoUnitario
  )
  const suma =
    lote.disponibles + lote.asignadas + lote.retenidas + lote.emitidas + lote.redimidas + lote.cerradas

  return (
    <div className="space-y-6">
      <PageHeader
        title={lote.codigo}
        description={`${lote.snapshotItemNombre}${lote.snapshotVariante ? ` · ${lote.snapshotVariante}` : ''} — ${lote.proveedor.name}`}
        eyebrow={
          <Link href="/superadmin/supply/lotes" className="hover:underline">
            Lotes de supply
          </Link>
        }
        nav={<NavSupply activa="lotes" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cuadre del lote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(
                [
                  ['DISPONIBLE', lote.disponibles],
                  ['ASIGNADO', lote.asignadas],
                  ['RETENIDO', lote.retenidas],
                  ['EMITIDO', lote.emitidas],
                  ['REDIMIDO', lote.redimidas],
                  ['CERRADO', lote.cerradas],
                ] as const
              ).map(([cubeta, valor]) => (
                <div key={cubeta} className="rounded-lg border border-border p-3">
                  <p className="text-caption text-muted-foreground">
                    {SUPPLY_CUBETA_LABELS[cubeta]}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {valor.toLocaleString('es-DO')}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {formatMoneyRD(valor * costoUnitario)}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-3 text-sm">
              <span className="font-medium">Compradas: {lote.compradas.toLocaleString('es-DO')}</span>
              <span className="text-muted-foreground">
                Suma de cubetas: {suma.toLocaleString('es-DO')}
              </span>
              {suma === lote.compradas ? (
                <Badge variant="success">Cuadra</Badge>
              ) : (
                <Badge variant="destructive">Descuadre de {suma - lote.compradas}</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contrato congelado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Acuerdo">
              <Link
                href={`/superadmin/supply/acuerdos/${lote.acuerdo.id}`}
                className="underline-offset-4 hover:underline"
              >
                {lote.acuerdo.codigo}
              </Link>
            </Dato>
            {lote.orden && <Dato label="Orden">{lote.orden.numero}</Dato>}
            <Dato label="Tipo">{SUPPLY_TIPO_LABELS[lote.snapshotTipo]}</Dato>
            <Dato label="Estado">
              <Badge variant={lote.estado === 'ACTIVO' ? 'success' : 'outline'}>
                {SUPPLY_LOTE_ESTADO_LABELS[lote.estado]}
              </Badge>
            </Dato>
            <Dato label="Costo unitario">{formatMoneyRD(costoUnitario)}</Dato>
            {lote.snapshotPrecioReferencia && (
              <Dato label="Precio público de referencia">
                {formatMoneyRD(Number(lote.snapshotPrecioReferencia))}
              </Dato>
            )}
            <Dato label="Inversión total">{formatMoneyRD(costos.contratado)}</Dato>
            <Dato label="Vigencia">
              {formatDate(lote.inicioAt)} → {formatDate(lote.venceAt)}
            </Dato>
            {lote.snapshotCapacidadDiaria && (
              <Dato label="Capacidad diaria">{lote.snapshotCapacidadDiaria} unidades</Dato>
            )}
            {lote.snapshotCapacidadHoraria && (
              <Dato label="Capacidad por hora">{lote.snapshotCapacidadHoraria} unidades</Dato>
            )}
            <p className="pt-2 text-caption text-muted-foreground">
              {SUPPLY_MODELO_EXPLICACION[lote.snapshotModelo]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Asignaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TablaReporte
            titulo="A qué campañas está prometido este lote"
            columnas={[
              { clave: 'etiqueta', titulo: 'Destino' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'asignadas', titulo: 'Asignadas', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'porEmitir', titulo: 'Por emitir', alinearDerecha: true },
              { clave: 'liberadas', titulo: 'Liberadas', alinearDerecha: true },
              { clave: 'costo', titulo: 'Comprometido', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={asignaciones.map((a) => ({
              __clave: a.id,
              etiqueta: a.etiqueta,
              tipo: SUPPLY_DESTINO_LABELS[a.destinoTipo as SupplyDestino] ?? a.destinoTipo,
              asignadas: a.asignadas.toLocaleString('es-DO'),
              emitidas: a.emitidas.toLocaleString('es-DO'),
              porEmitir: a.porEmitir.toLocaleString('es-DO'),
              liberadas: a.liberadas.toLocaleString('es-DO'),
              costo: formatMoneyRD(a.porEmitir * costoUnitario),
              estado: a.activa ? <Badge variant="success">Activa</Badge> : <Badge variant="outline">Cerrada</Badge>,
            }))}
            vacio="Este lote todavía no está apartado para ninguna campaña: sus unidades están disponibles."
          />

          {lote.estado === 'ACTIVO' && lote.disponibles > 0 && (
            <FormAsignar loteId={lote.id} disponibles={lote.disponibles} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger de derechos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-caption text-muted-foreground">
            Todo movimiento de este lote, sin resumir. Nada se borra: un error se corrige con una
            reversa o un ajuste, y los dos quedan aquí. Versión del lote: {lote.version}.
          </p>
          <TablaReporte
            titulo="Movimientos del lote"
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'tipo', titulo: 'Movimiento' },
              { clave: 'traslado', titulo: 'De → a' },
              { clave: 'cantidad', titulo: 'Cantidad', alinearDerecha: true },
              { clave: 'motivo', titulo: 'Motivo' },
              { clave: 'actor', titulo: 'Quién' },
            ]}
            filas={movimientos.map((m) => ({
              __clave: m.id,
              fecha: formatDateTime(m.createdAt),
              tipo: SUPPLY_MOVIMIENTO_LABELS[m.tipo],
              traslado: `${m.origen ? SUPPLY_CUBETA_LABELS[m.origen] : 'Fuera'} → ${m.destino ? SUPPLY_CUBETA_LABELS[m.destino] : 'Fuera'}`,
              cantidad: m.cantidad.toLocaleString('es-DO'),
              motivo: m.motivo ?? m.referencia ?? '—',
              actor: m.actor?.name ?? 'Sistema',
            }))}
            vacio="Sin movimientos."
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}
