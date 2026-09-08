import { requireRole } from '@/lib/auth/guards'
import { getInicioPublicado } from '@/modules/home/lectura'
import { InicioComercial } from '@/components/cliente/inicio/InicioComercial'
import InicioPrevio from '@/components/cliente/inicio/InicioPrevio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inicio', description: 'Descubre beneficios cerca de ti y consulta tus membresías' }

export default async function InicioCliente() {
  const user = await requireRole('CLIENTE')
  const data = await getInicioPublicado(user)
  if (!data) return <InicioPrevio />
  return <InicioComercial data={data} />
}
