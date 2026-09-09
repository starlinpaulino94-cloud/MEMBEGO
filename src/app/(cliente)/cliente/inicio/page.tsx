import { requireRole } from '@/lib/auth/guards'
import { cargarPanelPersonal } from '@/modules/cliente/panelPersonal'
import { getInicioVista } from '@/modules/home/lectura'
import { InicioRetail } from '@/components/cliente/inicio/InicioRetail'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Inicio',
  description: 'Descubre beneficios cerca de ti y consulta tus membresías',
}

export default async function InicioCliente() {
  const user = await requireRole('CLIENTE')
  // Las dos mitades se piden a la vez. La comercial SIEMPRE existe: sin
  // composición publicada se arma con los datos del marketplace, así que el
  // diseño no depende de ningún acto administrativo para verse.
  const [comercial, personal] = await Promise.all([
    getInicioVista(user),
    cargarPanelPersonal(user),
  ])
  return <InicioRetail comercial={comercial} personal={personal} />
}
