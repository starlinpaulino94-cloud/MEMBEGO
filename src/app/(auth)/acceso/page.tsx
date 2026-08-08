import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/LoginForm'

/**
 * Acceso separado para el equipo (administradores y empleados). Comparte el
 * mismo sistema de autenticación que el login de clientes, pero es una puerta
 * distinta: no se enlaza desde la web pública ni ofrece registro.
 */
export default function AccesoStaffPage() {
  return (
    <Suspense fallback={<div className="text-small text-muted-foreground">Cargando…</div>}>
      <LoginForm audience="staff" />
    </Suspense>
  )
}
