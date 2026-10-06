import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { economiaGlobal } from '@/modules/supply/tablero'
import { reporteCampanas } from '@/modules/supply/pool'
import { economiaUnidad, ltvVsCac, metricasAdquisicion } from '@/modules/supply/economia'
import { SUPPLY_DESTINO_LABELS, type SupplyDestino } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Economía de Membego Supply' }

/**
 * MEMBEGO SUPPLY · UNIT ECONOMICS y economía de campaña (Fases 35-38, 51).
 *
 * La pantalla que responde a «¿nos conviene regalar pizzas o venderlas a
 * RD$399?» con datos en vez de intuición.
 *
 * TRES COSTOS SEPARADOS EN CADA FILA, y no es redundancia:
 *
 *   consumido     lo redimido · el gasto real
 *   expuesto      emitido sin canjear · obligación viva
 *   comprometido  apartado sin emitir · todavía recuperable
 *
 * Colapsarlos en «costo de la campaña» daría una cifra que nadie sabe
 * defender: incluiría vouchers que quizá nadie canjee y unidades que se pueden
 * liberar mañana.
 */
export default async function EconomiaPage() {
  await requireRole('SUPERADMIN')

  const [campanas, gmv] = await Promise.all([
    reporteCampanas(),
    // GMV posterior a la adquisición: lo que esos clientes gastaron DESPUÉS.
    // Dato registrado, no proyección (Fase 38).
    sinEmpresa('Membego Supply: GMV posterior de clientes adquiridos', async (tx) => {
      const redimidos = await tx.supplyRedencion.findMany({
        where: { reversadaAt: null },
        select: { clienteId: true, createdAt: true },
        take: 5000,
      })
      if (redimidos.length === 0) return { clientes: 0, gmv: 0 }

      const primera = new Map<string, Date>()
      for (const r of redimidos) {
        const previa = primera.get(r.clienteId)
        if (!previa || r.createdAt < previa) primera.set(r.clienteId, r.createdAt)
      }

      const transacciones = await tx.transaction.findMany({
        // APPLIED es el estado en el que una transacción ya movió dinero de
        // verdad. Contar las pendientes o canceladas inflaría el LTV con
        // ingresos que todavía no existen.
        where: { clienteId: { in: [...primera.keys()] }, estado: 'APPLIED' },
        select: { clienteId: true, monto: true, createdAt: true },
        take: 20_000,
      })
      const gmv = transacciones.reduce((t, x) => {
        const desde = primera.get(x.clienteId ?? '')
        return desde && x.createdAt >= desde ? t + Number(x.monto ?? 0) : t
      }, 0)

      return { clientes: primera.size, gmv }
    }).catch(() => ({ clientes: 0, gmv: 0 })),
  ])

  const totales = campanas.reduce(
    (t, c) => ({
      consumido: t.consumido + c.costoConsumido,
      expuesto: t.expuesto + c.costoExpuesto,
      comprometido: t.comprometido + c.costoComprometido,
      ingresos: t.ingresos + c.ingresos,
      emitidas: t.emitidas + c.emitidas,
      redimidas: t.redimidas + c.redimidas,
    }),
    { consumido: 0, expuesto: 0, comprometido: 0, ingresos: 0, emitidas: 0, redimidas: 0 }
  )

  const adquisicion = metricasAdquisicion({
    clientesAlcanzados: totales.emitidas,
    clientesQueRedimieron: totales.redimidas,
    costoConsumido: totales.consumido,
  })
  const ltv = ltvVsCac({
    costoAdquisicionTotal: totales.consumido,
    clientes: gmv.clientes,
    gmvPosterior: gmv.gmv,
  })

  // Economía por unidad con DATOS REALES: el costo medio de lo comprado y el
  // precio medio al que se vendió. Sin unidades todavía, la tarjeta lo dice en
  // vez de enseñar un ejemplo (§35: nada ficticio mezclado con métricas).
  const eco = await economiaGlobal()
  const costoMedio = eco.vendido.unidades + eco.regalado.unidades > 0 ? (eco.vendido.valor + eco.regalado.valor) / (eco.vendido.unidades + eco.regalado.unidades) : 0
  const precioMedio = eco.vendido.unidades > 0 ? eco.vendido.ingresos / eco.vendido.unidades : 0
  const regalada = eco.regalado.unidades > 0 ? economiaUnidad(eco.regalado.valor / eco.regalado.unidades, 0, null) : null
  const vendida = eco.vendido.unidades > 0 ? economiaUnidad(costoMedio, precioMedio, null) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Economía"
        description="Cuánto cuesta cada unidad entregada, qué deja cada campaña y cuánto vale un cliente adquirido con supply."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="economia" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Capital invertido" value={formatMoneyRD(eco.capitalInvertido)} sub="lotes comprados + depósitos vivos" />
        <StatCard label="GMV" value={formatMoneyRD(eco.gmv)} sub={`${eco.ventasComision.ventas} ventas a comisión por ${formatMoneyRD(eco.ventasComision.bruto)}`} />
        <StatCard label="Ingresos" value={formatMoneyRD(eco.ingresos)} sub={`cobros ${formatMoneyRD(eco.vendido.ingresos)} + comisiones ${formatMoneyRD(eco.ventasComision.comision)}`} accent="brand" />
        <StatCard label="Margen bruto" value={formatMoneyRD(eco.margenBruto)} sub={`neto estimado ${formatMoneyRD(eco.margenNetoEstimado)} (tras regalos y vencidos)`} accent={eco.margenBruto >= 0 ? 'success' : 'danger'} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Supply regalado" value={eco.regalado.unidades.toLocaleString('es-DO')} sub={`${formatMoneyRD(eco.regalado.valor)} de costo (CAC)`} />
        <StatCard label="Supply vendido" value={eco.vendido.unidades.toLocaleString('es-DO')} sub={`${formatMoneyRD(eco.vendido.ingresos)} cobrados · costo ${formatMoneyRD(eco.vendido.valor)}`} />
        <StatCard label="Supply vencido" value={eco.vencido.unidades.toLocaleString('es-DO')} sub={`${formatMoneyRD(eco.vencido.valor)} perdidos`} accent={eco.vencido.unidades > 0 ? 'warning' : undefined} />
        <StatCard label="CAC real / LTV observado" value={`${formatMoneyRD(eco.cacReal)} / ${formatMoneyRD(eco.ltvObservado)}`} sub={`${eco.clientesAdquiridos} clientes que canjearon · subsidios ${formatMoneyRD(eco.subsidios)}`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Costo consumido"
          value={formatMoneyRD(totales.consumido)}
          sub={`${totales.redimidas.toLocaleString('es-DO')} unidades entregadas`}
          accent="brand"
        />
        <StatCard
          label="Exposición viva"
          value={formatMoneyRD(totales.expuesto)}
          sub="vouchers emitidos sin canjear"
          accent={totales.expuesto > 0 ? 'warning' : undefined}
        />
        <StatCard
          label="Ingresos de clientes"
          value={formatMoneyRD(totales.ingresos)}
          sub="supply vendido, no regalado"
        />
        <StatCard
          label="Costo por cliente activado"
          value={formatMoneyRD(adquisicion.costoPorClienteActivado)}
          sub={`${adquisicion.tasaActivacion}% de los que recibieron llegaron a usarlo`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Economía por unidad (promedios reales)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!regalada && !vendida ? (
              <p className="text-muted-foreground">Todavía no se ha entregado ninguna unidad: cuando haya redenciones, aquí sale el costo medio, el precio medio y el margen por unidad.</p>
            ) : (
              <>
                {regalada && (
                  <div>
                    <p className="font-medium">Unidad regalada ({eco.regalado.unidades.toLocaleString('es-DO')})</p>
                    <Linea label="Costo medio de adquisición" valor={formatMoneyRD(regalada.costoAdquisicion)} />
                    <Linea label="Ingreso del cliente" valor={formatMoneyRD(regalada.ingresoCliente)} />
                    <Linea label="CAC imputado" valor={formatMoneyRD(regalada.cac)} destacado />
                  </div>
                )}
                {vendida && (
                  <div>
                    <p className="font-medium">Unidad vendida ({eco.vendido.unidades.toLocaleString('es-DO')})</p>
                    <Linea label="Costo medio de adquisición" valor={formatMoneyRD(vendida.costoAdquisicion)} />
                    <Linea label="Precio medio al cliente" valor={formatMoneyRD(vendida.ingresoCliente)} />
                    <Linea label="Margen bruto por unidad" valor={formatMoneyRD(vendida.margenBruto)} destacado />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LTV frente a CAC</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Linea label="Clientes adquiridos con supply" valor={gmv.clientes.toLocaleString('es-DO')} />
            <Linea label="Costo de adquisición" valor={formatMoneyRD(ltv.cac)} />
            <Linea label="GMV generado después" valor={formatMoneyRD(ltv.gmvPosterior)} />
            <Linea label="Valor por cliente" valor={formatMoneyRD(ltv.ltvPorCliente)} />
            <Linea
              label="Múltiplo LTV/CAC"
              valor={ltv.multiplo == null ? '—' : `${ltv.multiplo}×`}
              destacado
            />
            <p className="pt-2 text-caption text-muted-foreground">
              Sin proyecciones: el LTV es lo que estos clientes han gastado de verdad desde que
              recibieron su primera unidad. Si llevan dos semanas, eso es lo que dice.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Economía por campaña</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Economía de las campañas"
            columnas={[
              { clave: 'etiqueta', titulo: 'Campaña' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'lote', titulo: 'Lote' },
              { clave: 'asignadas', titulo: 'Asignadas', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
              { clave: 'porEmitir', titulo: 'Por emitir', alinearDerecha: true },
              { clave: 'tasa', titulo: 'Tasa', alinearDerecha: true },
              { clave: 'consumido', titulo: 'Consumido', alinearDerecha: true },
              { clave: 'expuesto', titulo: 'Expuesto', alinearDerecha: true },
              { clave: 'comprometido', titulo: 'Comprometido', alinearDerecha: true },
              { clave: 'ingresos', titulo: 'Ingresos', alinearDerecha: true },
            ]}
            filas={campanas.map((c) => ({
              __clave: c.asignacionId,
              etiqueta: c.etiqueta,
              tipo: SUPPLY_DESTINO_LABELS[c.destinoTipo as SupplyDestino] ?? c.destinoTipo,
              lote: c.loteCodigo,
              asignadas: c.asignadas.toLocaleString('es-DO'),
              emitidas: c.emitidas.toLocaleString('es-DO'),
              redimidas: c.redimidas.toLocaleString('es-DO'),
              porEmitir: c.porEmitir.toLocaleString('es-DO'),
              tasa: (
                <Badge variant={c.tasaRedencion >= 60 ? 'success' : 'outline'}>
                  {c.tasaRedencion}%
                </Badge>
              ),
              consumido: formatMoneyRD(c.costoConsumido),
              expuesto: formatMoneyRD(c.costoExpuesto),
              comprometido: formatMoneyRD(c.costoComprometido),
              ingresos: c.ingresos > 0 ? formatMoneyRD(c.ingresos) : '—',
            }))}
            total={{
              etiqueta: 'Total',
              consumido: formatMoneyRD(totales.consumido),
              expuesto: formatMoneyRD(totales.expuesto),
              comprometido: formatMoneyRD(totales.comprometido),
              ingresos: formatMoneyRD(totales.ingresos),
            }}
            vacio="Todavía no hay campañas con supply asignado."
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Linea({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={destacado ? 'font-semibold tabular-nums' : 'tabular-nums'}>{valor}</span>
    </div>
  )
}
