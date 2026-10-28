'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  crearCampanaInvitacion,
  actualizarCampanaInvitacion,
  type CampanaState,
} from '@/modules/invitaciones/adminActions'
import { CampanaImagenUpload } from '@/components/invitaciones/CampanaImagenUpload'
import { FORMATOS } from '@/lib/imagen/formatos'
import {
  INVITA_COMPARTIR_CAMPOS,
  INVITA_CONTENIDO_CAMPOS,
  INVITA_CONTENIDO_DEFAULT,
  type InvitaContenido,
} from '@/lib/invitaContenido'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
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
    <form action={formAction} className="space-y-8">
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <FormSection title="Información básica" description="Cómo la llamas tú y lo que ven tus clientes al recibir la invitación.">
        <Campo id="nombre" etiqueta="Nombre interno" ayuda="Solo lo ves tú, para distinguir una campaña de otra.">
          {(control) => <Input name="nombre" placeholder="Ej: Campaña verano 2025" defaultValue={existing?.nombre ?? ''} required {...control} />}
        </Campo>
        <Campo id="titulo" etiqueta="Título público">
          {(control) => <Input name="titulo" placeholder="Ej: ¡Invita a un amigo y gana!" defaultValue={existing?.titulo ?? ''} required {...control} />}
        </Campo>
        <Campo id="descripcion" etiqueta="Descripción">
          {(control) => (
            <Textarea name="descripcion" placeholder="Describe la campaña a tus clientes..." defaultValue={existing?.descripcion ?? ''} required rows={3} {...control} />
          )}
        </Campo>
        <Campo id="textoLanding" etiqueta="Texto adicional del landing" opcional>
          {(control) => (
            <Textarea
              name="textoLanding"
              placeholder="Texto persuasivo que aparecerá en la página de invitación"
              defaultValue={existing?.textoLanding ?? ''}
              rows={2}
              {...control}
            />
          )}
        </Campo>
      </FormSection>

      <FormSection title="Meta y fechas" description="Cuántos registros trae cada invitante para ganar y cuándo corre la campaña.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo id="metaRegistros" etiqueta="Registros necesarios">
            {(control) => <Input name="metaRegistros" type="number" min={1} defaultValue={existing?.metaRegistros ?? 5} required {...control} />}
          </Campo>
          <Campo id="fechaInicio" etiqueta="Fecha inicio">
            {(control) => <Input name="fechaInicio" type="date" defaultValue={toDateInput(existing?.fechaInicio ?? null)} required {...control} />}
          </Campo>
          <Campo id="fechaFin" etiqueta="Fecha fin">
            {(control) => <Input name="fechaFin" type="date" defaultValue={toDateInput(existing?.fechaFin ?? null)} required {...control} />}
          </Campo>
        </div>
        <Campo id="maxPremios" etiqueta="Máximo de premios" opcional ayuda="Vacío = ilimitado." className="sm:max-w-xs">
          {(control) => <Input name="maxPremios" type="number" min={1} defaultValue={existing?.maxPremios ?? ''} {...control} />}
        </Campo>
      </FormSection>

      <FormSection title="Premio para quien invita" description="Lo que gana la persona que trae a sus amigos.">
        <BeneficioFields
          prefix="beneficioInvitante"
          tipo={invitanteTipo}
          onTipoChange={setInvitanteTipo}
          defaults={existing?.beneficioInvitante}
          promociones={promociones}
        />
      </FormSection>

      <FormSection title="Beneficio para el invitado" description="Lo que recibe el amigo que se registra con el enlace.">
        <BeneficioFields
          prefix="beneficioInvitado"
          tipo={invitadoTipo}
          onTipoChange={setInvitadoTipo}
          defaults={existing?.beneficioInvitado}
          promociones={promociones}
        />
      </FormSection>

      <FormSection title="Experiencia del enlace" description="Qué ve el cliente al abrir el enlace de invitación.">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
          <input type="checkbox" name="usarBanner" defaultChecked={existing?.usarBanner ?? true} className="mt-0.5 size-4 accent-primary" />
          <span className="text-sm">
            <span className="block font-medium text-foreground">Mostrar página de presentación (banner) antes del registro</span>
            <span className="mt-0.5 block text-muted-foreground">
              Si lo dejas desmarcado, el enlace lleva al cliente <strong>directo al formulario de registro</strong> (recomendado). Márcalo para
              mostrar primero el banner con la descripción de la promoción.
            </span>
          </span>
        </label>
      </FormSection>

      <FormSection title="Apariencia" description="Imágenes y colores del enlace. Todo es opcional.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="imagenUrl" etiqueta="Imagen (compartir / OG)" opcional como="grupo">
            {() => (
              <CampanaImagenUpload
                name="imagenUrl"
                companyId={companyId}
                campanaId={existing?.id ?? null}
                currentUrl={existing?.imagenUrl ?? null}
                label="Subir imagen"
                formato={FORMATOS.compartir}
              />
            )}
          </Campo>
          <Campo id="bannerUrl" etiqueta="Banner del landing" opcional como="grupo">
            {() => (
              <CampanaImagenUpload
                name="bannerUrl"
                companyId={companyId}
                campanaId={existing?.id ?? null}
                currentUrl={existing?.bannerUrl ?? null}
                label="Subir banner"
                formato={FORMATOS.fondo}
              />
            )}
          </Campo>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="colorPrimario" etiqueta="Color primario">
            {(control) => <Input name="colorPrimario" type="color" defaultValue={existing?.colorPrimario ?? '#6366f1'} {...control} />}
          </Campo>
          <Campo id="colorSecundario" etiqueta="Color secundario">
            {(control) => <Input name="colorSecundario" type="color" defaultValue={existing?.colorSecundario ?? '#8b5cf6'} {...control} />}
          </Campo>
        </div>
      </FormSection>

      <CompartirModulo defaults={existing?.contenido ?? null} />

      <ContenidoModulo defaults={existing?.contenido ?? null} />

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {existing ? 'Guardar cambios' : 'Crear campaña'}
        </Button>
      </FormActions>
    </form>
  )
}

/** Los campos de texto de un módulo opcional, cada uno con su valor por defecto como sugerencia. */
function CamposDeContenido({
  campos,
  defaults,
}: {
  campos: typeof INVITA_COMPARTIR_CAMPOS | typeof INVITA_CONTENIDO_CAMPOS
  defaults: Partial<InvitaContenido> | null
}) {
  return (
    <>
      {campos.map((campo) => {
        const name = `contenido_${campo.key}`
        const value = defaults?.[campo.key] ?? ''
        const placeholder = INVITA_CONTENIDO_DEFAULT[campo.key]
        return (
          <Campo key={campo.key} id={name} etiqueta={campo.label} opcional ayuda={campo.hint}>
            {(control) =>
              campo.multiline ? (
                <Textarea name={name} defaultValue={value} placeholder={placeholder} rows={2} {...control} />
              ) : (
                <Input name={name} defaultValue={value} placeholder={placeholder} {...control} />
              )
            }
          </Campo>
        )
      })}
    </>
  )
}

/**
 * Share Engine · sección "Compartir": controla la tarjeta enriquecida que
 * muestran WhatsApp/Facebook/Telegram/X al compartir el enlace de la campaña
 * (título y descripción Open Graph) y el CTA de la landing. La imagen de la
 * tarjeta es la "Imagen (compartir / OG)" de Apariencia.
 *
 * Plegada: casi nadie la toca, y son varios campos que alargaban el formulario.
 */
function CompartirModulo({ defaults }: { defaults: Partial<InvitaContenido> | null }) {
  const lleno = INVITA_COMPARTIR_CAMPOS.some((c) => Boolean(defaults?.[c.key]))
  return (
    <FormSection
      title="Compartir"
      description="Cómo se ve la tarjeta cuando alguien comparte el enlace por WhatsApp, Facebook, Telegram o X."
    >
      <details open={lleno} className="group rounded-xl border border-border px-4 py-3">
        <summary className="cursor-pointer text-small font-medium text-foreground">Personalizar la vista previa del enlace</summary>
        <div className="mt-4 space-y-4">
          <p className="text-caption text-muted-foreground">
            Deja un campo vacío para usar el título y la descripción de la campaña. La imagen es la “Imagen (compartir / OG)” de la sección Apariencia.
          </p>
          <CamposDeContenido campos={INVITA_COMPARTIR_CAMPOS} defaults={defaults} />
        </div>
      </details>
    </FormSection>
  )
}

/**
 * Textos del módulo "Invita y Gana" que ve el cliente. Cada campo trae su
 * valor por defecto como placeholder: si se deja vacío, el cliente ve el texto
 * por defecto. Permite editar TODO el contenido desde el panel (superadmin/admin).
 */
function ContenidoModulo({ defaults }: { defaults: Partial<InvitaContenido> | null }) {
  const lleno = INVITA_CONTENIDO_CAMPOS.some((c) => Boolean(defaults?.[c.key]))
  return (
    <FormSection title="Textos del módulo" description="Lo que el cliente lee en «Invita y Gana». Si no cambias nada, ve los textos por defecto.">
      <details open={lleno} className="group rounded-xl border border-border px-4 py-3">
        <summary className="cursor-pointer text-small font-medium text-foreground">Personalizar los textos</summary>
        <div className="mt-4 space-y-4">
          <p className="text-caption text-muted-foreground">Deja un campo vacío para usar el texto por defecto (se muestra como sugerencia).</p>
          <CamposDeContenido campos={INVITA_CONTENIDO_CAMPOS} defaults={defaults} />
        </div>
      </details>
    </FormSection>
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
    <>
      <Campo
        id={`${prefix}PromocionId`}
        etiqueta="Beneficio digital (recomendado)"
        ayuda="Al vincular una promoción, el premio se entrega automáticamente como beneficio digital: aparece en la wallet del cliente con su código QR, canjeable en el escáner."
      >
        {(control) => (
          <Select name={`${prefix}PromocionId`} defaultValue={defaults?.promocionId ?? 'none'}>
            <SelectTrigger className="w-full" {...control}>
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
        )}
      </Campo>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo id={`${prefix}Tipo`} etiqueta="Tipo de beneficio">
          {(control) => (
            <Select name={`${prefix}Tipo`} value={tipo} onValueChange={onTipoChange}>
              <SelectTrigger className="w-full" {...control}>
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
          )}
        </Campo>
        <Campo id={`${prefix}Valor`} etiqueta="Valor">
          {(control) => (
            <Input name={`${prefix}Valor`} placeholder={tipo === 'DESCUENTO' ? 'Ej: 20' : 'Ej: Lavado premium'} defaultValue={defaults?.valor ?? ''} {...control} />
          )}
        </Campo>
      </div>
      <Campo id={`${prefix}Descripcion`} etiqueta="Descripción del beneficio">
        {(control) => (
          <Input name={`${prefix}Descripcion`} placeholder="Ej: Un lavado completo gratis" defaultValue={defaults?.descripcion ?? ''} {...control} />
        )}
      </Campo>
      <Campo id={`${prefix}VigenciaDias`} etiqueta="Vigencia (días)" className="sm:max-w-xs">
        {(control) => <Input name={`${prefix}VigenciaDias`} type="number" min={1} defaultValue={defaults?.vigenciaDias ?? 30} {...control} />}
      </Campo>
    </>
  )
}
