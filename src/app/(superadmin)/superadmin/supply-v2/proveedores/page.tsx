import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipProveedor } from '@/components/supply-v2/chips'
import { DialogoFormulario } from '@/components/supply-v2/dialogo'
import { FormProveedor } from '@/components/supply-v2/form-proveedor'
import { SUPPLIER_SOURCE_LABELS } from '@/modules/supply-v2/core/catalogo'
import { listarProveedores } from '@/modules/supply-v2/suppliers/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proveedores · Supply 2.0' }

export default async function ProveedoresPage() {
  await requireRole('SUPERADMIN')
  const proveedores = await listarProveedores()
  /**
   * El mismo diálogo aparece en dos sitios: en la cabecera y, cuando todavía no
   * hay ninguno, dentro del estado vacío. Son dos botones distintos y por eso
   * llevan identificadores distintos.
   *
   * Antes compartían `testId`, y con la lista vacía el DOM acabó con dos
   * elementos `btn-nuevo-proveedor`. Con proveedores en la base no se notaba
   * —el estado vacío no se renderiza— y en una base limpia cualquier cosa que
   * busque ese botón por identificador encuentra dos: un lector de pantalla
   * anuncia dos acciones idénticas y la prueba de punta a punta no sabe cuál
   * pulsar.
   */
  const nuevo = (etiquetaDePrueba: string) => (
    <DialogoFormulario etiqueta="+ Nuevo proveedor" titulo="Nuevo proveedor" descripcion="Una empresa que ya está en Membego o un proveedor externo." testId={etiquetaDePrueba}>
      <FormProveedor />
    </DialogoFormulario>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        description="Con quién compra Membego: empresas de la plataforma o proveedores externos."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="proveedores" />}
        action={nuevo('btn-nuevo-proveedor')}
      />

      {proveedores.length === 0 ? (
        <EmptyState variant="card" title="No tienes proveedores" description="Registra el primero: una empresa de Membego o un proveedor externo." action={nuevo('btn-nuevo-proveedor-vacio')} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-proveedores">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Nombre</th>
                    <th className="px-4 py-2">Origen</th>
                    <th className="px-4 py-2">Contacto</th>
                    <th className="px-4 py-2">WhatsApp</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2 text-right">Productos</th>
                    <th className="px-4 py-2 text-right">Compras abiertas</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {proveedores.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/superadmin/supply-v2/proveedores/${p.id}`} className="underline-offset-4 hover:underline">
                          {p.commercialName}
                        </Link>
                        {p.city && <span className="block text-caption text-muted-foreground">{p.city}</span>}
                      </td>
                      <td className="px-4 py-2">{SUPPLIER_SOURCE_LABELS[p.source]}</td>
                      <td className="px-4 py-2">{p.contactName ?? p.email ?? '—'}</td>
                      <td className="px-4 py-2">{p.whatsapp ?? p.phone ?? '—'}</td>
                      <td className="px-4 py-2">
                        <ChipProveedor estado={p.status} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.productos}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.comprasAbiertas}</td>
                      <td className="px-4 py-2 text-right">
                        <Link href={`/superadmin/supply-v2/proveedores/${p.id}`} className="text-primary underline-offset-4 hover:underline">
                          Ver proveedor
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
