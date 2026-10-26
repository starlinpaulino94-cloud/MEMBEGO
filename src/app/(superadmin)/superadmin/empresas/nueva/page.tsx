import Link from 'next/link'
import { ArrowLeft, Inbox } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { getActiveCategories } from '@/modules/empresas/queries'
import { getAdminsVinculables } from '@/modules/empresas/accesos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmpresaCreateForm } from '@/components/superadmin/EmpresaCreateForm'
import { verticalesElegibles } from '@/modules/empresas/verticales'
import { precargaDeSolicitud, validarDatosSolicitud } from '@/modules/solicitudes/nucleo'

export const dynamic = 'force-dynamic'

/**
 * `?solicitud=<id>` precarga el formulario con lo que el solicitante ya escribió (04 · F-02, 7.3): el superadmin no vuelve a teclearlo.
 * Si el correo del dueño ya es una cuenta de la plataforma, el formulario arranca en «Cuenta existente» con ese administrador elegido.
 * Una solicitud que ya tiene su empresa, o que no existe o está incompleta, no precarga nada y la pantalla lo dice.
 */
export default async function NuevaEmpresaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const pedida = typeof sp.solicitud === 'string' ? sp.solicitud : ''

  const [categories, admins, verticales, solicitud] = await Promise.all([
    getActiveCategories(),
    getAdminsVinculables(),
    verticalesElegibles(),
    pedida
      ? sinEmpresa('superadmin: leer la solicitud que precarga el alta', (tx) =>
          tx.solicitudEmpresa.findUnique({ where: { id: pedida }, select: { id: true, estado: true, companyId: true, datos: true } })
        )
      : null,
  ])

  let inicial: React.ComponentProps<typeof EmpresaCreateForm>['inicial'] | undefined
  let aviso: { titulo: string; texto: string; tono: 'info' | 'warning' } | null = null
  if (pedida) {
    const v = solicitud ? validarDatosSolicitud(solicitud.datos) : null
    if (!solicitud) {
      aviso = { titulo: 'No encontré esa solicitud', texto: 'El formulario queda en blanco.', tono: 'warning' }
    } else if (solicitud.estado === 'CREADA' && solicitud.companyId) {
      aviso = { titulo: 'Esta solicitud ya tiene su empresa', texto: 'No se precarga nada para no crear una segunda.', tono: 'warning' }
    } else if (!v || !v.ok) {
      aviso = { titulo: 'La solicitud está incompleta', texto: 'No se pudo precargar; el formulario queda en blanco.', tono: 'warning' }
    } else {
      const p = precargaDeSolicitud(v.datos)
      const cuenta = admins.find((a) => a.email.toLowerCase() === p.adminEmail.toLowerCase())
      inicial = {
        ...p,
        // El vertical solo se precarga si de verdad está entre los que se pueden elegir.
        type: p.type && verticales.some((x) => x.codigo === p.type) ? p.type : null,
        solicitudId: solicitud.id,
        adminExistenteId: cuenta?.id ?? null,
      }
      aviso = {
        titulo: `Precargado desde la solicitud de «${p.name}»`,
        texto: cuenta
          ? `El correo del dueño (${p.adminEmail}) ya es una cuenta de la plataforma: queda elegida como administrador. Al crear, la solicitud pasa a «Creada».`
          : 'Revisa los datos y pon una contraseña para la cuenta del administrador. Al crear, la solicitud pasa a «Creada».',
        tono: 'info',
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-fade-up">
      <Link
        href={solicitud ? `/superadmin/solicitudes/${solicitud.id}` : '/superadmin/empresas'}
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {solicitud ? 'Volver a la solicitud' : 'Volver a empresas'}
      </Link>

      {aviso && (
        <StatusBanner variant={aviso.tono} title={aviso.titulo} icon={Inbox}>
          {aviso.texto}
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nueva empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <EmpresaCreateForm categories={categories} admins={admins} verticales={verticales} inicial={inicial} />
        </CardContent>
      </Card>
    </div>
  )
}
