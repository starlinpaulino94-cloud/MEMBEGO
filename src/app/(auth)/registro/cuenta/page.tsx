import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { isRegistroV2Enabled } from '@/lib/registroV2'
import { RegisterGeneralForm } from '@/components/auth/RegisterGeneralForm'
import { AsistenteRegistro } from '@/components/auth/AsistenteRegistro'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Crear cuenta - MembeGo',
  description:
    'Crea tu cuenta MembeGo sin compromiso: sin elegir empresa, sin seguirla y sin membresía. Únete a las que quieras después.',
}

/**
 * Registro general (sin empresa). La ruta estática /registro/cuenta tiene
 * prioridad sobre /registro/[companySlug], así que "cuenta" queda reservado
 * como slug.
 */
export default async function RegistroCuentaPage() {
  // Si ya hay sesión de cliente, no tiene sentido registrarse otra vez.
  // El chequeo es opcional: si la verificación de sesión falla (env de
  // Supabase ausente, outage), el formulario se muestra igual — la puerta
  // de entrada de clientes nunca puede caerse por esto.
  const user = await getUser().catch(() => null)
  if (user && user.metadata.role === 'CLIENTE') {
    redirect('/cliente/explorar')
  }

  // Registro general: solo el perfil (flujo declarativo sin vehículo). El
  // formulario clásico queda como salida de emergencia de la bandera.
  if (isRegistroV2Enabled()) {
    return <AsistenteRegistro modo="general" />
  }
  return <RegisterGeneralForm />
}
