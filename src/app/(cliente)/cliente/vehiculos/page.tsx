import Link from 'next/link'
import { Car, Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getVehiculosCliente } from '@/modules/cliente/queries'
import { VehicleCard } from '@/components/cliente/VehicleCard'
import { EmptyState } from '@/components/system/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Mis vehículos',
  description: 'Los vehículos asociados a tu cuenta y a tus membresías',
}

/**
 * Mis vehículos (§41).
 *
 * Esta pantalla NO existía: solo había `/cliente/vehiculos/nuevo`, al que se
 * llegaba desde la compra de un plan. Se podía añadir un vehículo pero no ver
 * los que ya tenías salvo bajando hasta el final del perfil, donde salían como
 * filas de una lista sin categoría, sin cuál es el principal y sin decir a qué
 * membresías estaban asociados.
 */
/**
 * El texto anterior —"El principal se aplica por defecto al comprar"— insinuaba
 * que la etiqueta decide lo que pagas, y no es así: solo viene marcado de
 * entrada. El precio sigue al vehículo que se elige en el selector de compra,
 * porque un camión no puede pagar tarifa de moto por haberse registrado
 * segundo. Decirlo en la cabecera evita la pregunta a soporte.
 */
const DESCRIPCION =
  'Los que usas en tus visitas. El principal viene preseleccionado al comprar; ' +
  'el precio siempre sigue al vehículo que elijas.'

export default async function VehiculosPage() {
  const user = await requireRole('CLIENTE')
  // Los de TODAS sus fichas: un vehículo pertenece a la ficha de un negocio
  // —cada uno le asigna su categoría y su tarifa—, así que el mismo coche
  // aparecía y desaparecía según la empresa abierta. Ahora salen todos y cada
  // tarjeta dice de qué negocio es.
  const vehiculos = user.metadata.clienteId
    ? await getVehiculosCliente(user.supabaseId)
    : []

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href="/cliente/perfil" className="hover:underline">
            Perfil
          </Link>
        }
        title="Mis vehículos"
        description={DESCRIPCION}
        action={
          vehiculos.length > 0 ? (
            <Button asChild>
              <Link href="/cliente/vehiculos/nuevo?next=/cliente/vehiculos">
                <Plus aria-hidden />
                Añadir vehículo
              </Link>
            </Button>
          ) : undefined
        }
      />

      {vehiculos.length === 0 ? (
        <EmptyState
          icon={Car}
          title="Todavía no tienes vehículos"
          description="Añade el tuyo para que el mostrador lo reconozca al llegar y para asociarlo a tus membresías."
          action={
            <Button asChild size="lg">
              <Link href="/cliente/vehiculos/nuevo?next=/cliente/vehiculos">Añadir vehículo</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {vehiculos.map((v) => (
            <VehicleCard key={v.id} vehiculo={v} />
          ))}
        </ul>
      )}
    </div>
  )
}
