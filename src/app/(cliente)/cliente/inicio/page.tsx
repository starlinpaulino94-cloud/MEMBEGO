import { requireRole } from '@/lib/auth/guards'
import { cargarPanelPersonal } from '@/modules/cliente/panelPersonal'
import { getInicioPublicado } from '@/modules/home/lectura'
import { InicioRetail } from '@/components/cliente/inicio/InicioRetail'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Inicio',
  description: 'Descubre beneficios cerca de ti y consulta tus membresías',
}

export default async function InicioCliente() {
  const user = await requireRole('CLIENTE')
  // Las dos mitades se piden a la vez: la comercial puede no existir y la
  // personal nunca depende de ella.
  const [comercial, personal] = await Promise.all([
    getInicioPublicado(user).catch(() => null),
    cargarPanelPersonal(user),
  ])
  return <InicioRetail comercial={comercial} personal={personal} />
}
