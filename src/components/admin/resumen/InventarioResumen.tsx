import { requireSection, usuarioPuedeFuncion } from '@/lib/auth/guards'
import { resumenInventarioEmpresa } from '@/modules/inventory/dashboard'
import { TarjetaInventario } from '@/components/admin/TarjetaInventario'

/**
 * La tarjeta de inventario del Resumen (INV-4c: existencias, margen del mes y lo perdido), como componente que carga solo
 * dentro de un `<Suspense>`: su consulta no frena los bloques de arriba (fase 5, tarea 5.1).
 *
 * Es de quien puede ver la sección Inventario; el dinero (valor, margen, lo que costó lo perdido), de quien además tiene la
 * función `costos`. Sin la sección no se lee nada; sin la función no se lee ni un costo.
 */
export async function InventarioResumen({
  companyId,
  zonaHoraria,
  company,
}: {
  companyId: string
  zonaHoraria: string
  company: { moneda: string; idioma: string; zonaHoraria: string }
}) {
  const user = await requireSection('inventario').catch(() => null)
  if (!user) return null
  const conCostos = await usuarioPuedeFuncion(user, 'inventario', 'costos')
  const resumen = await resumenInventarioEmpresa(companyId, zonaHoraria, { conCostos }).catch((e) => {
    console.error('[admin-dashboard] inventario', e instanceof Error ? e.message : e)
    return null
  })
  return resumen ? <TarjetaInventario resumen={resumen} company={company} /> : null
}
