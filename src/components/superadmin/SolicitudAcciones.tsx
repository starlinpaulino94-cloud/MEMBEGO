'use client'

/**
 * Las palancas del expediente de una solicitud: mover el estado del embudo,
 * llevar la bitácora, y CREAR LA EMPRESA con un clic.
 *
 * La contraseña temporal del administrador se enseña UNA sola vez (no se
 * guarda en ningún sitio legible): el superadmin la copia y se la entrega al
 * dueño por WhatsApp. Si se pierde, se restablece desde Usuarios.
 */

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Building2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  cambiarEstadoSolicitud,
  guardarNotasSolicitud,
  crearEmpresaDesdeSolicitud,
  type SolicitudAccionState,
  type CrearDesdeSolicitudState,
} from '@/modules/solicitudes/actions'
import {
  ESTADOS_SOLICITUD,
  ESTADO_SOLICITUD_LABEL,
  type EstadoSolicitud,
} from '@/modules/solicitudes/nucleo'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const initAccion: SolicitudAccionState = {}
const initCrear: CrearDesdeSolicitudState = {}

export function SolicitudAcciones({
  id,
  estado,
  companyId,
  notas,
  listaParaCrear,
}: {
  id: string
  estado: EstadoSolicitud
  companyId: string | null
  notas: string | null
  listaParaCrear: boolean
}) {
  const router = useRouter()
  const [estadoState, estadoAction, estadoPending] = useActionState(cambiarEstadoSolicitud, initAccion)
  const [notasState, notasAction, notasPending] = useActionState(guardarNotasSolicitud, initAccion)
  const [crearState, crearAction, crearPending] = useActionState(crearEmpresaDesdeSolicitud, initCrear)

  useEffect(() => {
    if (estadoState.success) {
      toast.success(estadoState.success)
      router.refresh()
    }
    if (estadoState.error) toast.error(estadoState.error)
  }, [estadoState, router])
  useEffect(() => {
    if (notasState.success) toast.success(notasState.success)
    if (notasState.error) toast.error(notasState.error)
  }, [notasState])
  useEffect(() => {
    if (crearState.companySlug) {
      toast.success('Empresa creada.')
      router.refresh()
    }
    if (crearState.error) toast.error(crearState.error)
  }, [crearState, router])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Estado del embudo */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Estado</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {ESTADOS_SOLICITUD.filter((e) => e !== 'CREADA').map((e) => (
            <form key={e} action={estadoAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="estado" value={e} />
              <Button
                type="submit"
                size="sm"
                variant={estado === e ? 'default' : 'outline'}
                disabled={estadoPending || estado === e || estado === 'CREADA'}
              >
                {ESTADO_SOLICITUD_LABEL[e]}
              </Button>
            </form>
          ))}
        </div>
        {estado === 'CREADA' ? (
          <p className="mt-2 text-xs text-muted-foreground">
            La empresa ya se creó: el estado queda fijo como registro del embudo.
          </p>
        ) : null}
      </section>

      {/* Notas internas */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Notas internas
        </h2>
        <form action={notasAction} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={id} />
          <Textarea
            name="notas"
            defaultValue={notas ?? ''}
            placeholder="Bitácora: llamadas, acuerdos, pendientes… (solo la ve el superadmin)"
          />
          <Button type="submit" size="sm" variant="outline" disabled={notasPending} className="gap-1.5">
            {notasPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Guardar notas
          </Button>
        </form>
      </section>

      {/* Crear la empresa */}
      <section className="rounded-2xl border border-primary/40 bg-primary/5 p-5 lg:col-span-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
          <Building2 className="h-4 w-4" /> Crear la empresa
        </h2>
        {companyId ? (
          <p className="mt-3 text-sm text-foreground">
            ✅ Empresa creada a partir de esta solicitud.{' '}
            <Link href={`/superadmin/empresas/${companyId}`} className="font-semibold text-primary hover:underline">
              Ver la empresa
            </Link>
            . Siguiente paso: configurar sus planes y promociones en su panel y publicarla.
          </p>
        ) : crearState.credenciales ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="font-semibold text-foreground">
              ✅ Empresa creada{crearState.companySlug ? ` (${crearState.companySlug})` : ''}. Entrega estas
              credenciales al dueño — <strong>no se volverán a mostrar</strong>:
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 font-mono text-sm">
              <span>{crearState.credenciales.correo}</span>
              <span className="text-muted-foreground">·</span>
              <span>{crearState.credenciales.passwordTemporal}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  const c = crearState.credenciales
                  if (!c) return
                  navigator.clipboard
                    ?.writeText(`Acceso a MembeGo\nUsuario: ${c.correo}\nContraseña temporal: ${c.passwordTemporal}\nEntra en: https://membego.com/login y cámbiala al entrar.`)
                    .then(() => toast.success('Credenciales copiadas.'))
                    .catch(() => toast.error('No se pudo copiar; anótalas a mano.'))
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pídele que la cambie al entrar. Registro del embudo: esta solicitud quedó como «Empresa creada».
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              Crea la empresa con todo lo de la solicitud: perfil, vertical, marca, logo y portada,
              sucursal principal y la cuenta del administrador con contraseña temporal (se muestra una
              sola vez). Los planes y promociones quedan aquí como checklist para configurarlos en su
              panel antes de publicar.
            </p>
            <form action={crearAction}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" disabled={crearPending || !listaParaCrear} className="gap-2">
                {crearPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                {crearPending ? 'Creando…' : 'Crear empresa y cuenta del administrador'}
              </Button>
            </form>
            {!listaParaCrear ? (
              <p className="text-xs text-destructive">
                La solicitud está incompleta: no se puede crear en automático.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
