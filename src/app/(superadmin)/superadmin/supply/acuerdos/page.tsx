import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { FormAcuerdo } from '@/components/supply/form-acuerdo'
import {
  SUPPLY_ACUERDO_ESTADO_LABELS,
  SUPPLY_MODELO_LABELS,
  SUPPLY_TIPO_LABELS,
} from '@/modules/supply/catalogo'
import { proveedoresElegibles } from '@/modules/supply/proveedores'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Acuerdos de supply' }

/**
 * MEMBEGO SUPPLY · acuerdos con proveedores (Fase 2).
 *
 * El contrato define CÓMO funciona la relación: qué se compra, a qué costo,
 * con qué vigencia, en qué sucursales, con qué capacidad y qué pasa con lo que
 * sobre. La orden de compra viene después y dice cuánto se compra de verdad.
 *
 * Solo aparecen como proveedoras las empresas con la capacidad
 * MEMBEGO_SUPPLIER encendida: la misma organización que ya opera como comercio,
 * sin duplicar identidad, usuarios ni catálogo (Fase 1).
 */
export default async function AcuerdosPage() {
  await requireRole('SUPERADMIN')

  const [acuerdos, proveedores] = await Promise.all([
    sinEmpresa('Membego Supply: contratos de la plataforma con sus proveedores', (tx) =>
      tx.supplyAcuerdo.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          codigo: true,
          estado: true,
          tipo: true,
          modeloComercial: true,
          itemNombre: true,
          varianteEtiqueta: true,
          cantidad: true,
          costoUnitario: true,
          precioReferencia: true,
          inicioAt: true,
          finAt: true,
          proveedor: { select: { id: true, name: true } },
          _count: { select: { ordenes: true, lotes: true, enmiendas: true } },
        },
      })
    ),
    // Registradas Y externas: exigir `isActive` dejaba fuera al proveedor externo (H8).
    proveedoresElegibles(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acuerdos con proveedores"
        description="El contrato: qué compra Membego, a qué costo, con qué vigencia, dónde se canjea y qué pasa con lo que no se use."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="acuerdos" />}
        action={
          <a href="#nuevo" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            + Nuevo acuerdo
          </a>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Contratos</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Acuerdos de supply"
            columnas={[
              { clave: 'codigo', titulo: 'Código' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'item', titulo: 'Qué se compra' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'modelo', titulo: 'Modelo' },
              { clave: 'cantidad', titulo: 'Cantidad', alinearDerecha: true },
              { clave: 'costo', titulo: 'Costo unit.', alinearDerecha: true },
              { clave: 'inversion', titulo: 'Inversión', alinearDerecha: true },
              { clave: 'vigencia', titulo: 'Vigencia' },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'lotes', titulo: 'Lotes', alinearDerecha: true },
            ]}
            filas={acuerdos.map((a) => ({
              __clave: a.id,
              codigo: (
                <Link
                  href={`/superadmin/supply/acuerdos/${a.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {a.codigo}
                </Link>
              ),
              proveedor: a.proveedor.name,
              item: a.varianteEtiqueta ? `${a.itemNombre} · ${a.varianteEtiqueta}` : a.itemNombre,
              tipo: SUPPLY_TIPO_LABELS[a.tipo],
              modelo: SUPPLY_MODELO_LABELS[a.modeloComercial],
              cantidad: a.cantidad.toLocaleString('es-DO'),
              costo: formatMoneyRD(Number(a.costoUnitario)),
              inversion: formatMoneyRD(a.cantidad * Number(a.costoUnitario)),
              vigencia: `${formatDate(a.inicioAt)} → ${formatDate(a.finAt)}`,
              estado: (
                <Badge
                  variant={
                    a.estado === 'ACTIVO'
                      ? 'success'
                      : a.estado === 'CANCELADO' || a.estado === 'VENCIDO'
                        ? 'outline'
                        : 'secondary'
                  }
                >
                  {SUPPLY_ACUERDO_ESTADO_LABELS[a.estado]}
                </Badge>
              ),
              lotes: a._count.lotes,
            }))}
            vacio="Todavía no hay contratos. Crea el primero abajo."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo acuerdo</CardTitle>
        </CardHeader>
        <CardContent>
          <FormAcuerdo proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.origen === 'EXTERNA' ? `${p.nombre} (externo)` : p.nombre, sucursales: p.sucursales }))} />
        </CardContent>
      </Card>
    </div>
  )
}
