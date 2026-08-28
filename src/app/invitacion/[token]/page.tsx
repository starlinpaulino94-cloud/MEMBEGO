import { sinEmpresa } from '@/lib/tenant'
import { roleLabel } from '@/components/layout/nav-config'
import { AceptarInvitacionForm } from '@/components/onboarding/AceptarInvitacionForm'

export const dynamic = 'force-dynamic'

export default async function AceptarInvitacionPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // PÁGINA PÚBLICA, sin sesión: quien la abre viene de un correo y todavía no
  // pertenece a ninguna empresa — el token es justamente lo que va a decir a
  // cuál. No hay empresa que poner antes de resolverlo.
  //
  // Lo que protege es el propio token: es único, opaco y caduca, y las tres
  // comprobaciones de abajo (existe · PENDIENTE · sin expirar) son la barrera
  // real. Aquí solo se lee su fila y el nombre de la empresa que invita.
  const invitacion = await sinEmpresa(
    'invitación por token: página pública, la empresa se descubre AL resolver el token',
    (tx) =>
      tx.invitacion.findUnique({
        where: { token },
        include: { company: { select: { name: true } } },
      })
  ).catch(() => null)

  const invalida =
    !invitacion ||
    invitacion.estado !== 'PENDIENTE' ||
    invitacion.expiraEn <= new Date()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="MembeGo" width={32} height={32} />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Membe<span className="text-success">Go</span>
          </span>
        </div>

        {invalida || !invitacion ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <h1 className="text-lg font-bold text-foreground">Invitación no válida</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta invitación no existe, ya fue usada o expiró. Pide a la empresa
              que te envíe una nueva.
            </p>
            <a href="/login" className="mt-6 inline-block text-sm text-primary hover:underline">
              Ir a iniciar sesión
            </a>
          </div>
        ) : (
          <AceptarInvitacionForm
            token={token}
            email={invitacion.email}
            empresa={invitacion.company.name}
            rol={roleLabel(invitacion.rol)}
          />
        )}
      </div>
    </div>
  )
}
