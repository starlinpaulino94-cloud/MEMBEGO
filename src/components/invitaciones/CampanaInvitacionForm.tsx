'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearCampanaInvitacion,
  actualizarCampanaInvitacion,
  type CampanaState,
} from '@/modules/invitaciones/adminActions'
import { CampanaImagenUpload } from '@/components/invitaciones/CampanaImagenUpload'
import {
  INVITA_COMPARTIR_CAMPOS,
  INVITA_CONTENIDO_CAMPOS,
  INVITA_CONTENIDO_DEFAULT,
  type InvitaContenido,
} from '@/lib/invitaContenido'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Beneficio {
  tipo: string
  valor: string
  descripcion: string
  vigenciaDias: number
  /** Promoción (Beneficio Digital E8) que materializa la recompensa. */
  promocionId?: string
}

export interface PromocionOption {
  id: string
  titulo: string
}

interface Existing {
  id: string
  nombre: string
  titulo: string
  descripcion: string
  textoLanding: string | null
  imagenUrl: string | null
  bannerUrl: string | null
  metaRegistros: number
  beneficioInvitante: Beneficio
  beneficioInvitado: Beneficio
  fechaInicio: string
  fechaFin: string
  maxPremios: number | null
  colorPrimario: string | null
  colorSecundario: string | null
  usarBanner: boolean
  contenido: Partial<InvitaContenido> | null
}

const BENEFICIO_TIPOS = [
  { value: 'SERVICIO_GRATIS', label: 'Servicio gratis' },
  { value: 'DESCUENTO', label: 'Descuento (%)' },
  { value: 'CREDITO', label: 'Crédito en cuenta' },
  { value: 'PRODUCTO', label: 'Producto gratis' },
  { value: 'UPGRADE', label: 'Upgrade de plan' },
]

const init: CampanaState = {}

function toDateInput(d: string | null) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

export function CampanaInvitacionForm({
  existing,
  promociones = [],
  companyId,
}: {
  existing?: Existing
  promociones?: PromocionOption[]
  /** Empresa dueña de las imágenes que se suban. Ver `storage-rutas.ts`. */
  companyId: string | null
}) {
  const router = useRouter()
  const action = existing ? actualizarCampanaInvitacion : crearCampanaInvitacion
  const [state, formAction, pending] = useActionState(action, init)
  const [invitanteTipo, setInvitanteTipo] = useState(
    existing?.beneficioInvitante?.tipo ?? 'SERVICIO_GRATIS'
  )
  const [invitadoTipo, setInvitadoTipo] = useState(
    existing?.beneficioInvitado?.tipo ?? 'SERVICIO_GRATIS'
  )

  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Campaña actualizada.' : 'Campaña creada.')
      router.push('/admin/invitaciones')
      router.refresh()
    }
  }, [state.success, existing, router])

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Información básica</h3>

        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre interno</Label>
          <Input
            id="nombre"
            name="nombre"
            placeholder="Ej: Campaña verano 2025"
            defaultValue={existing?.nombre ?? ''}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="titulo">Título público</Label>
          <Input
            id="titulo"
            name="titulo"
            placeholder="Ej: ¡Invita a un amigo y gana!"
            defaultValue={existing?.titulo ?? ''}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="descripcion">Descripción</Label>
          <Textarea
            id="descripcion"
            name="descripcion"
            placeholder="Describe la campaña a tus clientes..."
            defaultValue={existing?.descripcion ?? ''}
            required
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="textoLanding">Texto adicional del landing (opcional)</Label>
          <Textarea
            id="textoLanding"
            name="textoLanding"
            placeholder="Texto persuasivo que aparecerá en la página de invitación"
            defaultValue={existing?.textoLanding ?? ''}
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Meta y fechas</h3>

        <div className="grid gap-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="metaRegistros">Registros necesarios</Label>
            <Input
              id="metaRegistros"
              name="metaRegistros"
              type="number"
              min={1}
              defaultValue={existing?.metaRegistros ?? 5}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaInicio">Fecha inicio</Label>
            <Input
              id="fechaInicio"
              name="fechaInicio"
              type="date"
              defaultValue={toDateInput(existing?.fechaInicio ?? null)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaFin">Fecha fin</Label>
            <Input
              id="fechaFin"
              name="fechaFin"
              type="date"
              defaultValue={toDateInput(existing?.fechaFin ?? null)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxPremios">Máximo de premios (dejar vacío = ilimitado)</Label>
          <Input
            id="maxPremios"
            name="maxPremios"
            type="number"
            min={1}
            defaultValue={existing?.maxPremios ?? ''}
          />
        </div>
      </div>

      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Premio para quien invita</h3>
        <BeneficioFields
          prefix="beneficioInvitante"
          tipo={invitanteTipo}
          onTipoChange={setInvitanteTipo}
          defaults={existing?.beneficioInvitante}
          promociones={promociones}
        />
      </div>

      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Beneficio para el invitado</h3>
        <BeneficioFields
          prefix="beneficioInvitado"
          tipo={invitadoTipo}
          onTipoChange={setInvitadoTipo}
          defaults={existing?.beneficioInvitado}
          promociones={promociones}
        />
      </div>

      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Experiencia del enlace</h3>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
          <input
            type="checkbox"
            name="usarBanner"
            defaultChecked={existing?.usarBanner ?? true}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm">
            <span className="block font-medium text-foreground">
              Mostrar página de presentación (banner) antes del registro
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Si lo dejas desmarcado, el enlace lleva al cliente{' '}
              <strong>directo al formulario de registro</strong> (recomendado). Márcalo
              para mostrar primero el banner con la descripción de la promoción.
            </span>
          </span>
        </label>
      </div>

      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Apariencia (opcional)</h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Imagen (compartir / OG)</Label>
            <CampanaImagenUpload
              name="imagenUrl"
              companyId={companyId}
              campanaId={existing?.id ?? null}
              currentUrl={existing?.imagenUrl ?? null}
              label="Subir imagen"
            />
          </div>
          <div className="space-y-2">
            <Label>Banner del landing</Label>
            <CampanaImagenUpload
              name="bannerUrl"
              companyId={companyId}
              campanaId={existing?.id ?? null}
              currentUrl={existing?.bannerUrl ?? null}
              label="Subir banner"
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="colorPrimario">Color primario</Label>
            <Input
              id="colorPrimario"
              name="colorPrimario"
              type="color"
              defaultValue={existing?.colorPrimario ?? '#6366f1'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="colorSecundario">Color secundario</Label>
            <Input
              id="colorSecundario"
              name="colorSecundario"
              type="color"
              defaultValue={existing?.colorSecundario ?? '#8b5cf6'}
            />
          </div>
        </div>
      </div>

      <CompartirModulo defaults={existing?.contenido ?? null} />

      <ContenidoModulo defaults={existing?.contenido ?? null} />

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {existing ? 'Guardar cambios' : 'Crear campaña'}
        </Button>
      </div>
    </form>
  )
}

/**
 * Share Engine · sección "Compartir": controla la tarjeta enriquecida que
 * muestran WhatsApp/Facebook/Telegram/X al compartir el enlace de la campaña
 * (título y descripción Open Graph) y el CTA de la landing. La imagen de la
 * tarjeta es la "Imagen (compartir / OG)" de Apariencia.
 */
function CompartirModulo({ defaults }: { defaults: Partial<InvitaContenido> | null }) {
  return (
    <div className="space-y-5 rounded-xl border border-border p-5">
      <div>
        <h3 className="font-semibold text-foreground">Compartir · vista previa del enlace</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Así se ve la tarjeta cuando alguien comparte el enlace por WhatsApp, Facebook,
          Telegram o X. Deja un campo vacío para usar el título y la descripción de la
          campaña. La imagen es la “Imagen (compartir / OG)” de la sección Apariencia.
        </p>
      </div>

      <div className="space-y-4">
        {INVITA_COMPARTIR_CAMPOS.map((campo) => {
          const name = `contenido_${campo.key}`
          const value = defaults?.[campo.key] ?? ''
          const placeholder = INVITA_CONTENIDO_DEFAULT[campo.key]
          return (
            <div key={campo.key} className="space-y-2">
              <Label htmlFor={name}>{campo.label}</Label>
              {campo.multiline ? (
                <Textarea
                  id={name}
                  name={name}
                  defaultValue={value}
                  placeholder={placeholder}
                  rows={2}
                />
              ) : (
                <Input id={name} name={name} defaultValue={value} placeholder={placeholder} />
              )}
              {campo.hint && <p className="text-xs text-muted-foreground">{campo.hint}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Textos del módulo "Invita y Gana" que ve el cliente. Cada campo trae su
 * valor por defecto como placeholder: si se deja vacío, el cliente ve el texto
 * por defecto. Permite editar TODO el contenido desde el panel (superadmin/admin).
 */
function ContenidoModulo({ defaults }: { defaults: Partial<InvitaContenido> | null }) {
  return (
    <div className="space-y-5 rounded-xl border border-border p-5">
      <div>
        <h3 className="font-semibold text-foreground">Textos del módulo del cliente</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Personaliza lo que el cliente ve en “Invita y Gana”. Deja un campo vacío para
          usar el texto por defecto (se muestra como sugerencia).
        </p>
      </div>

      <div className="space-y-4">
        {INVITA_CONTENIDO_CAMPOS.map((campo) => {
          const name = `contenido_${campo.key}`
          const value = defaults?.[campo.key] ?? ''
          const placeholder = INVITA_CONTENIDO_DEFAULT[campo.key]
          return (
            <div key={campo.key} className="space-y-2">
              <Label htmlFor={name}>{campo.label}</Label>
              {campo.multiline ? (
                <Textarea
                  id={name}
                  name={name}
                  defaultValue={value}
                  placeholder={placeholder}
                  rows={2}
                />
              ) : (
                <Input
                  id={name}
                  name={name}
                  defaultValue={value}
                  placeholder={placeholder}
                />
              )}
              {campo.hint && (
                <p className="text-xs text-muted-foreground">{campo.hint}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BeneficioFields({
  prefix,
  tipo,
  onTipoChange,
  defaults,
  promociones,
}: {
  prefix: string
  tipo: string
  onTipoChange: (v: string) => void
  defaults?: Beneficio
  promociones: PromocionOption[]
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Beneficio digital (recomendado)</Label>
        <Select name={`${prefix}PromocionId`} defaultValue={defaults?.promocionId ?? 'none'}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona una promoción" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Sin beneficio digital —</SelectItem>
            {promociones.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.titulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Al vincular una promoción, el premio se entrega automáticamente como beneficio
          digital: aparece en la wallet del cliente con su código QR, canjeable en el
          escáner.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Tipo de beneficio</Label>
          <Select name={`${prefix}Tipo`} value={tipo} onValueChange={onTipoChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BENEFICIO_TIPOS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}Valor`}>Valor</Label>
          <Input
            id={`${prefix}Valor`}
            name={`${prefix}Valor`}
            placeholder={tipo === 'DESCUENTO' ? 'Ej: 20' : 'Ej: Lavado premium'}
            defaultValue={defaults?.valor ?? ''}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}Descripcion`}>Descripción del beneficio</Label>
        <Input
          id={`${prefix}Descripcion`}
          name={`${prefix}Descripcion`}
          placeholder="Ej: Un lavado completo gratis"
          defaultValue={defaults?.descripcion ?? ''}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}VigenciaDias`}>Vigencia (días)</Label>
        <Input
          id={`${prefix}VigenciaDias`}
          name={`${prefix}VigenciaDias`}
          type="number"
          min={1}
          defaultValue={defaults?.vigenciaDias ?? 30}
        />
      </div>
    </div>
  )
}
