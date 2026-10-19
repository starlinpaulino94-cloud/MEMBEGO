import Link from 'next/link'
import { BookOpen, CalendarClock, PackageX, Percent, RefreshCw, ScanBarcode, TrendingDown } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { DIAS_EXCESO_COBERTURA, DIAS_POCA_COBERTURA } from '@/modules/inventory/reportes'
import { VENTANA_POR_DEFECTO } from '@/modules/inventory/vencimientos'

export const dynamic = 'force-dynamic'

/**
 * REPORTES DE EXISTENCIAS (INV-4a): la puerta a los informes que responden «qué pasó con este producto», «qué tengo parado», «qué se me va a acabar o me
 * sobra» (INV-4a), «cuánto perdí y por qué» (INV-4b), «qué se me vence» (INV-5b) y «cuánto gané» (INV-4c, el margen real: solo con la función `costos`, porque es costo contra precio). Cada informe es su propia pantalla (con su CSV) y todos respetan la función `costos`: quien
 * no la tiene ve unidades y días, nunca dinero.
 */
export default async function ReportesInventarioPage() {
  const user = await requireRole(ADMIN_ROLES)
  await requireCompanyContext(user)
  const verCostos = await puedeFuncion('inventario', 'costos')

  const informes: Array<{ href: string; icono: typeof BookOpen; titulo: string; texto: string; costos: string; soloCostos?: boolean }> = [
    {
      href: '/admin/inventario/reportes/kardex',
      icono: BookOpen,
      titulo: 'Kardex de un producto',
      texto: 'Cada entrada y salida de un producto en un periodo, con la existencia que dejó cada una. Empieza y termina con la existencia física de ese periodo.',
      costos: 'Con costos: lo que valió lo que entró y lo que salió.',
    },
    {
      href: '/admin/inventario/reportes/sin-ventas',
      icono: PackageX,
      titulo: 'Stock sin ventas',
      texto: 'Los productos con existencias que llevan 30, 60, 90 días o más sin venderse, de lo que más dinero tiene parado a lo que menos.',
      costos: 'Con costos: cuánto dinero tienen inmovilizado.',
    },
    {
      href: '/admin/inventario/reportes/mermas',
      icono: TrendingDown,
      titulo: 'Mermas por motivo',
      texto: 'Cuánto se perdió en un periodo y por qué: faltantes, bajas de lo dañado, sobrantes y lo dañado, cada uno por su motivo.',
      costos: 'Con costos: cuánto costó lo perdido, motivo por motivo.',
    },
    {
      href: '/admin/inventario/reportes/margen',
      icono: Percent,
      titulo: 'Margen real',
      texto: 'Lo que cobraste contra lo que costó lo que vendiste, producto por producto, con el costo que tenía cada uno el día que se vendió.',
      costos: 'Solo con costos: ingresos, costo, margen y porcentaje.',
      soloCostos: true,
    },
    {
      href: '/admin/inventario/reportes/vencimientos',
      icono: CalendarClock,
      titulo: 'Vence pronto',
      texto: `Los lotes con existencias que ya vencieron o vencen en los próximos días (${VENTANA_POR_DEFECTO} por defecto; de 7 a 90), por sucursal y de lo que antes vence a lo que después.`,
      costos: 'Con costos: cuánto dinero hay en riesgo.',
    },
    {
      href: '/admin/inventario/reportes/series',
      icono: ScanBarcode,
      titulo: 'Buscar una serie',
      texto: 'De qué producto es un número de serie, dónde está ahora y todo lo que le pasó: cuándo entró, si se transfirió, se vendió o se dio de baja.',
      costos: 'Sin dinero: solo la historia de la unidad.',
    },
    {
      href: '/admin/inventario/reportes/rotacion',
      icono: RefreshCw,
      titulo: 'Rotación y cobertura',
      texto: `Cuánto se vende de cada producto, cuántas veces rota y para cuántos días alcanza lo que hay: se agota pronto (${DIAS_POCA_COBERTURA} días o menos), normal o con exceso (más de ${DIAS_EXCESO_COBERTURA}).`,
      costos: 'Con costos: costo de ventas y días de inventario de toda la empresa.',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Reportes de existencias" description="Lo que pasó con cada producto, lo que tienes parado y lo que se te acaba o te sobra." />
      <NavegacionInventario actual="reportes" />

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Informes">
        {informes.filter((i) => !i.soloCostos || verCostos).map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="block h-full rounded-xl transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full">
                <CardContent className="space-y-2 p-5">
                  <i.icono className="h-6 w-6 text-muted-foreground" aria-hidden />
                  <p className="font-semibold">{i.titulo}</p>
                  <p className="text-sm text-muted-foreground">{i.texto}</p>
                  {verCostos && <p className="text-xs text-muted-foreground">{i.costos}</p>}
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Todos los informes se pueden descargar en CSV con los mismos filtros que ves, y dicen en el propio archivo si quedó cortado.
        {verCostos ? ' Lo que no tiene costo se cuenta aparte: nunca suma como cero.' : ' Los costos y el dinero solo los ve quien tiene la función «Ver y fijar costos».'}
      </p>
    </div>
  )
}
