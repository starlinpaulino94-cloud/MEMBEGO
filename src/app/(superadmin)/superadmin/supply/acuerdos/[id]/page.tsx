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
import { AccionesAcuerdo } from '@/components/supply/acciones-acuerdo'
import { saldoDeProveedor } from '@/modules/supply/finanzas'
import {
  SUPPLY_ACUERDO_ESTADO_LABELS,
  SUPPLY_MODALIDAD_PAGO_LABELS,
  SUPPLY_MODELO_EXPLICACION,
  SUPPLY_MODELO_LABELS,
  SUPPLY_ORDEN_ESTADO_LABELS,
  SUPPLY_POLITICA_SOBRANTE_LABELS,
  SUPPLY_TIPO_LABELS,
} from '@/modules/supply/catalogo'
import { TRANSICIONES_ACUERDO } from '@/modules/supply/estados'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY · ficha de un ACUERDO.
 *
 * Reúne las cuatro cosas que hay que mirar juntas para decidir algo sobre un
 * contrato: sus condiciones, sus órdenes de compra, sus enmiendas y el dinero
 * que se le debe al proveedor. Repartidas en cuatro pantallas, la decisión se
 * toma con tres de ellas.
 */
export default async function AcuerdoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const datos = await sinEmpresa('Membego Supply: ficha de un contrato', async (tx) => {
    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id },
      include: {
        proveedor: { select: { id: true, name: true } },
        creadoPor: { select: { name: true } },
        aprobadoPor: { select: { name: true } },
        ordenes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            numero: true,
            estado: true,
            total: true,
            createdAt: true,
            creadoPor: { select: { name: true } },
            aprobadoPor: { select: { name: true } },
            _count: { select: { lineas: true } },
          },
        },
        lotes: {
          orderBy: { venceAt: 'asc' },
          select: {
            id: true,
            codigo: true,
            estado: true,
            compradas: true,
            disponibles: true,
            emitidas: true,
            redimidas: true,
            venceAt: true,
          },
        },
        enmiendas: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            campo: true,
            antes: true,
            despues: true,
            motivo: true,
            createdAt: true,
            aprobadoPor: { select: { name: true } },
          },
        },
      },
    })
    if (!acuerdo) return null
    const saldo = await saldoDeProveedor(tx, acuerdo.proveedorId, acuerdo.id)
    return { acuerdo, saldo }
  })

  if (!datos) notFound()
  const { acuerdo, saldo } = datos
  const siguientes = TRANSICIONES_ACUERDO[acuerdo.estado]

  return (
    <div className="space-y-6">
      <PageHeader
        title={acuerdo.codigo}
        description={`${acuerdo.itemNombre} — ${acuerdo.proveedor.name}`}
        eyebrow={
          <Link href="/superadmin/supply/acuerdos" className="hover:underline">
            Acuerdos
          </Link>
        }
        nav={<NavSupply activa="acuerdos" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Condiciones contratadas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Dato label="Estado">
              <Badge variant={acuerdo.estado === 'ACTIVO' ? 'success' : 'secondary'}>
                {SUPPLY_ACUERDO_ESTADO_LABELS[acuerdo.estado]}
              </Badge>
            </Dato>
            <Dato label="Tipo">{SUPPLY_TIPO_LABELS[acuerdo.tipo]}</Dato>
            <Dato label="Modelo">{SUPPLY_MODELO_LABELS[acuerdo.modeloComercial]}</Dato>
            <Dato label="Pago">{SUPPLY_MODALIDAD_PAGO_LABELS[acuerdo.modalidadPago]}</Dato>
            <Dato label="Cantidad">{acuerdo.cantidad.toLocaleString('es-DO')}</Dato>
            <Dato label="Costo unitario">{formatMoneyRD(Number(acuerdo.costoUnitario))}</Dato>
            <Dato label="Inversión">
              {formatMoneyRD(acuerdo.cantidad * Number(acuerdo.costoUnitario))}
            </Dato>
            {acuerdo.precioReferencia && (
              <Dato label="Precio público">
                {formatMoneyRD(Number(acuerdo.precioReferencia))}
              </Dato>
            )}
            {acuerdo.aporteMembego && (
              <Dato label="Aporte Membego">{formatMoneyRD(Number(acuerdo.aporteMembego))}</Dato>
            )}
            <Dato label="Vigencia">
              {formatDate(acuerdo.inicioAt)} → {formatDate(acuerdo.finAt)}
            </Dato>
            <Dato label="Sobrantes">
              {SUPPLY_POLITICA_SOBRANTE_LABELS[acuerdo.politicaSobrante]}
            </Dato>
            {acuerdo.capacidadDiaria && (
              <Dato label="Máximo por día">{acuerdo.capacidadDiaria}</Dato>
            )}
            {acuerdo.capacidadHoraria && (
              <Dato label="Máximo por hora">{acuerdo.capacidadHoraria}</Dato>
            )}
            {acuerdo.horarioTexto && <Dato label="Horario">{acuerdo.horarioTexto}</Dato>}
            <Dato label="Creado por">{acuerdo.creadoPor?.name ?? '—'}</Dato>
            <Dato label="Aprobado por">{acuerdo.aprobadoPor?.name ?? 'Sin aprobar'}</Dato>

            <p className="pt-3 text-caption text-muted-foreground sm:col-span-2">
              {SUPPLY_MODELO_EXPLICACION[acuerdo.modeloComercial]}
            </p>
            {acuerdo.reglasRedencion && (
              <p className="text-caption text-muted-foreground sm:col-span-2">
                <strong>Redención:</strong> {acuerdo.reglasRedencion}
              </p>
            )}
            {acuerdo.reglasSustitucion && (
              <p className="text-caption text-muted-foreground sm:col-span-2">
                <strong>Sustituciones:</strong> {acuerdo.reglasSustitucion}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dinero con el proveedor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Contratado">{formatMoneyRD(saldo.contratado)}</Dato>
            <Dato label="Depositado">{formatMoneyRD(saldo.depositado)}</Dato>
            <Dato label="Devengado por redención">{formatMoneyRD(saldo.devengado)}</Dato>
            <Dato label="Pagado">{formatMoneyRD(saldo.pagado)}</Dato>
            <div className="border-t border-border pt-2">
              <Dato label="Saldo por pagar">
                <strong>{formatMoneyRD(saldo.saldoPorPagar)}</strong>
              </Dato>
            </div>
            <p className="pt-2 text-caption text-muted-foreground">
              El saldo es la suma de los asientos, no un número guardado. «Contratado» es un
              memorando y no entra en él: firmar no es deber.
            </p>
          </CardContent>
        </Card>
      </div>

      <AccionesAcuerdo
        acuerdoId={acuerdo.id}
        estadosPosibles={[...siguientes]}
        puedeComprar={acuerdo.estado === 'APROBADO' || acuerdo.estado === 'ACTIVO'}
        itemNombre={acuerdo.itemNombre}
        cantidadSugerida={acuerdo.cantidad}
        costoSugerido={Number(acuerdo.costoUnitario)}
        lotes={acuerdo.lotes.map((l) => ({ id: l.id, codigo: l.codigo }))}
        finAt={acuerdo.finAt.toISOString().slice(0, 10)}
      />

      <Card>
        <CardHeader>
          <CardTitle>Órdenes de compra</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Órdenes de este acuerdo"
            columnas={[
              { clave: 'numero', titulo: 'Número' },
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'lineas', titulo: 'Líneas', alinearDerecha: true },
              { clave: 'total', titulo: 'Total', alinearDerecha: true },
              { clave: 'creador', titulo: 'Creada por' },
              { clave: 'aprobador', titulo: 'Aprobada por' },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={acuerdo.ordenes.map((o) => ({
              __clave: o.id,
              numero: (
                <Link
                  href={`/superadmin/supply/ordenes/${o.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {o.numero}
                </Link>
              ),
              fecha: formatDate(o.createdAt),
              lineas: o._count.lineas,
              total: formatMoneyRD(Number(o.total)),
              creador: o.creadoPor?.name ?? '—',
              aprobador: o.aprobadoPor?.name ?? 'Sin aprobar',
              estado: (
                <Badge variant={o.estado === 'ACTIVA' ? 'success' : 'secondary'}>
                  {SUPPLY_ORDEN_ESTADO_LABELS[o.estado]}
                </Badge>
              ),
            }))}
            vacio="Sin órdenes todavía. El contrato define las condiciones; la orden es lo que compra."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lotes generados</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Lotes de este acuerdo"
            columnas={[
              { clave: 'codigo', titulo: 'Lote' },
              { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
              { clave: 'disponibles', titulo: 'Disponibles', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={acuerdo.lotes.map((l) => ({
              __clave: l.id,
              codigo: (
                <Link
                  href={`/superadmin/supply/lotes/${l.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {l.codigo}
                </Link>
              ),
              compradas: l.compradas.toLocaleString('es-DO'),
              disponibles: l.disponibles.toLocaleString('es-DO'),
              emitidas: l.emitidas.toLocaleString('es-DO'),
              redimidas: l.redimidas.toLocaleString('es-DO'),
              vence: formatDate(l.venceAt),
              estado: l.estado,
            }))}
            vacio="Sin lotes. Se crean al activar una orden de compra."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enmiendas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-caption text-muted-foreground">
            El comercio ve sus números y no los edita. Cambiar la cantidad, el costo o la vigencia
            de un contrato firmado solo ocurre por aquí, con antes, después, motivo y aprobador.
          </p>
          <TablaReporte
            titulo="Enmiendas del contrato"
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'campo', titulo: 'Qué cambió' },
              { clave: 'antes', titulo: 'Antes' },
              { clave: 'despues', titulo: 'Después' },
              { clave: 'motivo', titulo: 'Motivo' },
              { clave: 'aprobador', titulo: 'Aprobó' },
            ]}
            filas={acuerdo.enmiendas.map((e) => ({
              __clave: e.id,
              fecha: formatDateTime(e.createdAt),
              campo: e.campo,
              antes: <code className="text-caption">{JSON.stringify(e.antes)}</code>,
              despues: <code className="text-caption">{JSON.stringify(e.despues)}</code>,
              motivo: e.motivo,
              aprobador: e.aprobadoPor?.name ?? '—',
            }))}
            vacio="Sin enmiendas: el contrato sigue como se firmó."
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
