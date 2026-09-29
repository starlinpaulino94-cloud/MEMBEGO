import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavFinanzas } from '@/components/supply/nav'
import { FormRevisarPedido } from '@/components/supply/form-revisar-pedido'
import { FormReembolsarPedido } from '@/components/supply/form-reembolsar-pedido'
import { colaDeRevision, cuentasDeCobro } from '@/modules/supply/cobro'
import { urlComprobante } from '@/modules/storage/comprobantes'
import { TEXTO_ESTADO_PEDIDO, type EstadoPedido } from '@/modules/supply/cobro-nucleo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cobros a clientes' }

/**
 * MEMBEGO SUPPLY · el dinero que entra (Fases 22-23).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA PANTALLA ES EL OTRO LADO DE «PAGOS» Y «LIQUIDACIONES»
 *
 * En Pagos y Liquidaciones, Membego PAGA al proveedor. Aquí, el cliente PAGA a Membego
 * por una unidad que Membego ya compró. Son los dos lados del margen y se
 * miran por separado a propósito: mezclarlos en una sola pantalla de «pagos»
 * es la forma más rápida de que alguien lea un número creyendo que es el otro.
 *
 * LO PRIMERO QUE SE VE ES SI SE PUEDE COBRAR. Sin una cuenta activa, Membego no
 * publica ofertas de pago y esta pantalla lo dice arriba, en vez de dejar que
 * alguien se pregunte por qué la vitrina solo muestra regalos.
 */
export default async function CobrosPage() {
  await requireRole('SUPERADMIN')

  const [colaCruda, cuentas, resumen] = await Promise.all([
    colaDeRevision(100),
    cuentasDeCobro(),
    sinEmpresa('Membego Supply: resumen de cobros a clientes', async (tx) => {
      const [enRevision, cobrados, rechazados, expirados] = await Promise.all([
        tx.supplyPedido.aggregate({
          where: { estado: 'EN_REVISION' },
          _count: true,
          _sum: { monto: true },
        }),
        tx.supplyPedido.aggregate({
          where: { estado: 'PAGADO' },
          _count: true,
          _sum: { monto: true },
        }),
        tx.supplyPedido.count({ where: { estado: 'RECHAZADO' } }),
        tx.supplyPedido.count({ where: { estado: 'EXPIRADO' } }),
      ])

      const iniciados = await tx.supplyPedido.findMany({
        where: { estado: 'INICIADO', expiraAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: {
          id: true, numero: true, monto: true, expiraAt: true,
          cliente: { select: { nombre: true } },
          derecho: { select: { lote: { select: { snapshotItemNombre: true } } } },
          venta: { select: { itemNombre: true } },
        },
      })
      const ultimos = await tx.supplyPedido.findMany({
        where: { estado: { notIn: ['EN_REVISION', 'INICIADO'] } },
        orderBy: { updatedAt: 'desc' },
        take: 60,
        select: {
          id: true,
          numero: true,
          estado: true,
          monto: true,
          moneda: true,
          motivoRechazo: true,
          metodo: true,
          reembolsoMotivo: true,
          revisadoAt: true,
          createdAt: true,
          cliente: { select: { nombre: true } },
          revisor: { select: { name: true } },
          derecho: {
            select: { lote: { select: { snapshotItemNombre: true } } },
          },
          venta: { select: { itemNombre: true } },
        },
      })

      return { enRevision, cobrados, rechazados, expirados, ultimos, iniciados }
    }),
  ])

  // La URL de cada comprobante se firma aquí, una por una, y vive cinco
  // minutos. `urlComprobante` vuelve a comprobar QUIÉN pregunta antes de
  // firmar: la ruta sola no abre nada, así que esta página no puede filtrar un
  // comprobante ni por error ni si alguien copia el HTML.
  const cola = await Promise.all(
    colaCruda.map(async (p) => ({
      ...p,
      comprobanteUrl: await urlComprobante('pedido', p.id, p.comprobantePath),
    }))
  )

  const cobrado = Number(resumen.cobrados._sum.monto ?? 0)
  const enEspera = Number(resumen.enRevision._sum.monto ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cobros a clientes"
        description="Lo que los clientes le pagan a Membego por el supply que Membego ya compró. Cada confirmación lleva el nombre de quien la firmó."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavFinanzas activa="cobros-clientes" />}
      />

      {cuentas.length === 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-body">
              <strong>Membego no puede cobrar todavía.</strong> No hay ninguna cuenta de cobro de
              plataforma activa, así que la vitrina solo publica lo que es gratis. En cuanto exista
              una cuenta activa, las ofertas de pago se publican solas.
            </p>
            <p className="mt-2 text-body">
              <Link href="/superadmin/supply/finanzas/cobros-clientes/cuentas" className="underline">
                Dar de alta una cuenta de cobro
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Por revisar" value={String(resumen.enRevision._count)} />
        <StatCard label="En espera de verificación" value={formatMoneyRD(enEspera)} />
        <StatCard label="Cobrado" value={formatMoneyRD(cobrado)} />
        <StatCard
          label="Rechazados / expirados"
          value={`${resumen.rechazados} / ${resumen.expirados}`}
          sub="Estados: pendiente · en revisión · confirmado · rechazado · expirado · reembolsado"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Esperando verificación ({cola.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {cola.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Nada por revisar. Cuando un cliente suba su comprobante, aparece aquí.
            </p>
          ) : (
            <TablaReporte
              columnas={[
                { clave: 'pedido', titulo: 'Pedido' },
                { clave: 'cliente', titulo: 'Cliente' },
                { clave: 'producto', titulo: 'Producto' },
                { clave: 'proveedor', titulo: 'Proveedor' },
                { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
                { clave: 'comprobante', titulo: 'Comprobante' },
                { clave: 'expira', titulo: 'Expira' },
                { clave: 'decision', titulo: 'Decisión' },
              ]}
              filas={cola.map((p) => ({
                __clave: p.id,
                pedido: p.numero,
                cliente: p.cliente,
                producto: p.producto,
                proveedor: p.proveedor,
                monto: formatMoneyRD(p.monto),
                comprobante: p.comprobanteUrl ? (
                  <a href={p.comprobanteUrl} target="_blank" rel="noreferrer" className="underline">
                    Ver{p.comprobanteNota ? ' · con nota' : ''}
                  </a>
                ) : (
                  '—'
                ),
                expira: formatDate(p.expiraAt),
                decision: <FormRevisarPedido pedidoId={p.id} monto={p.monto} />,
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Esperando pago ({resumen.iniciados.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-caption text-muted-foreground">
            Pedidos abiertos sin comprobante todavía. Si el cliente pagó en efectivo o por un canal manual y Membego ya vio el dinero, confírmalo aquí con el monto recibido.
          </p>
          <TablaReporte
            columnas={[
              { clave: 'pedido', titulo: 'Pedido' },
              { clave: 'cliente', titulo: 'Cliente' },
              { clave: 'producto', titulo: 'Producto' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'expira', titulo: 'Expira' },
              { clave: 'decision', titulo: 'Cobro manual' },
            ]}
            filas={resumen.iniciados.map((p) => ({
              __clave: p.id,
              pedido: p.numero,
              cliente: p.cliente.nombre,
              producto: p.derecho?.lote.snapshotItemNombre ?? p.venta?.itemNombre ?? '—',
              monto: formatMoneyRD(Number(p.monto)),
              expira: formatDate(p.expiraAt),
              decision: <FormRevisarPedido pedidoId={p.id} monto={Number(p.monto)} manual />,
            }))}
            vacio="Ningún pedido esperando pago."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            columnas={[
              { clave: 'pedido', titulo: 'Pedido' },
              { clave: 'cliente', titulo: 'Cliente' },
              { clave: 'producto', titulo: 'Producto' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'reviso', titulo: 'Revisó' },
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'accion', titulo: '' },
            ]}
            filas={resumen.ultimos.map((p) => ({
              __clave: p.id,
              pedido: p.numero,
              cliente: p.cliente.nombre,
              producto: p.derecho?.lote.snapshotItemNombre ?? p.venta?.itemNombre ?? '—',
              monto: formatMoneyRD(Number(p.monto)),
              estado: (
                <span className="flex flex-col gap-1">
                  <Badge variant={p.estado === 'PAGADO' ? 'default' : 'secondary'}>
                    {TEXTO_ESTADO_PEDIDO[p.estado as EstadoPedido]}
                  </Badge>
                  {p.motivoRechazo && (
                    <span className="text-caption text-muted-foreground">{p.motivoRechazo}</span>
                  )}
                  {p.reembolsoMotivo && (
                    <span className="text-caption text-muted-foreground">{p.reembolsoMotivo}</span>
                  )}
                  {p.metodo && <span className="text-caption text-muted-foreground">{p.metodo}</span>}
                </span>
              ),
              reviso: p.revisor?.name ?? '—',
              fecha: formatDate(p.revisadoAt ?? p.createdAt),
              accion: p.estado === 'PAGADO' ? <FormReembolsarPedido pedidoId={p.id} /> : null,
            }))}
          />
        </CardContent>
      </Card>

      {cuentas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Link href="/superadmin/supply/finanzas/cobros-clientes/cuentas" className="hover:underline">
                Cuentas de cobro de Membego
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'cuenta', titulo: 'Cuenta' },
                { clave: 'titular', titulo: 'Titular' },
                { clave: 'numero', titulo: 'Número' },
                { clave: 'tipo', titulo: 'Tipo' },
              ]}
              filas={cuentas.map((c) => ({
                __clave: c.id,
                cuenta: c.nombre,
                titular: c.titular ?? '—',
                numero: c.numeroCuenta ?? '—',
                tipo: c.tipoCuenta ?? c.tipo,
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
