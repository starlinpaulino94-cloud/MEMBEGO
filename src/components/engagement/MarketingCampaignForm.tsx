'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Flame, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearCampanaMarketing,
  actualizarCampanaMarketing,
  type MarketingState,
} from '@/modules/admin/marketingActions'
import {
  MARKETING_TIPOS,
  MARKETING_CTA_DESTINOS,
  DIAS_SEMANA,
  minutosAHora,
} from '@/lib/marketing'
import { CampanaImagenUpload } from '@/components/invitaciones/CampanaImagenUpload'
import { FORMATOS } from '@/lib/imagen/formatos'
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

export interface MarketingExisting {
  id: string
  tipo: string
  dealId: string | null
  titulo: string
  descripcion: string
  bannerUrl: string | null
  imagenUrl: string | null
  ctaTexto: string | null
  ctaHref: string | null
  colorPrimario: string | null
  colorSecundario: string | null
  fechaInicio: string
  fechaFin: string
  horaInicioMin: number | null
  horaFinMin: number | null
  diasSemana: number[]
  prioridad: number
  destacada: boolean
  maxReclamos: number | null
}

export interface MarketingDealOption {
  id: string
  title: string
  promotion: { nombre: string } | null
}

const init: MarketingState = {}

/** ISO → valor de <input type="datetime-local"> en hora local del navegador. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export function MarketingCampaignForm({
  existing,
  companyId,
  deals = [],
}: {
  existing?: MarketingExisting
  /** Empresa dueña de las imágenes que se suban. Ver `storage-rutas.ts`. */
  companyId: string | null
  deals?: MarketingDealOption[]
}) {
  const router = useRouter()
  const action = existing ? actualizarCampanaMarketing : crearCampanaMarketing
  const [state, formAction, pending] = useActionState(action, init)

  // Estado para la vista previa en vivo.
  const [tipo, setTipo] = useState(existing?.tipo ?? 'FLASH_SALE')
  const [titulo, setTitulo] = useState(existing?.titulo ?? '')
  const [descripcion, setDescripcion] = useState(existing?.descripcion ?? '')
  const [ctaTexto, setCtaTexto] = useState(existing?.ctaTexto ?? '')
  const [primary, setPrimary] = useState(existing?.colorPrimario ?? '#e11d48')
  const [secondary, setSecondary] = useState(existing?.colorSecundario ?? '#9f1239')
  const [banner, setBanner] = useState(existing?.bannerUrl ?? '')

  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Campaña actualizada.' : 'Campaña creada.')
      router.push('/admin/marketing')
      router.refresh()
    }
  }, [state.success, existing, router])

  return (
    <form action={formAction} className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8">
        {existing && <input type="hidden" name="id" value={existing.id} />}

        {state.error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <FormSection apilada title="Información de la campaña" description="Qué se anuncia y con qué mensaje.">
          <Campo
            id="dealId"
            etiqueta="Deal que distribuirá"
            opcional
            ayuda="La campaña enlaza la oferta y su Promotion. Sus reglas se validan al reclamar; los cupones emitidos conservan su vigencia."
          >
            {(control) => (
              <Select name="dealId" defaultValue={existing?.dealId ?? 'ninguno'}>
                <SelectTrigger className="w-full" {...control}>
                  <SelectValue placeholder="Sin Deal vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguno">Sin Deal vinculado</SelectItem>
                  {deals.map((deal) => (
                    <SelectItem key={deal.id} value={deal.id}>
                      {deal.title}
                      {deal.promotion ? ` · Promotion: ${deal.promotion.nombre}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Campo>

          <Campo id="tipo" etiqueta="Tipo de campaña">
            {(control) => (
              <Select name="tipo" value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="w-full" {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_TIPOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label} — {t.desc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Campo>

          <Campo id="titulo" etiqueta="Título">
            {(control) => (
              <Input
                name="titulo"
                placeholder="Ej: ¡Lavado premium 2x1 solo hoy!"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={120}
                required
                {...control}
              />
            )}
          </Campo>

          <Campo id="descripcion" etiqueta="Descripción">
            {(control) => (
              <Textarea
                name="descripcion"
                placeholder="Describe la oferta de forma breve y atractiva…"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                maxLength={600}
                rows={3}
                required
                {...control}
              />
            )}
          </Campo>
        </FormSection>

        <FormSection apilada title="¿Cuándo se muestra?" description="La ventana de fechas y, si quieres, los días y las horas en que aparece.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="fechaInicio" etiqueta="Inicio">
              {(control) => <Input name="fechaInicio" type="datetime-local" defaultValue={toLocalInput(existing?.fechaInicio ?? null)} required {...control} />}
            </Campo>
            <Campo id="fechaFin" etiqueta="Fin">
              {(control) => <Input name="fechaFin" type="datetime-local" defaultValue={toLocalInput(existing?.fechaFin ?? null)} required {...control} />}
            </Campo>
          </div>

          <Campo id="diasSemana" etiqueta="Días de la semana" opcional como="grupo" ayuda="Déjalos sin marcar para mostrar todos los días. Útil para “Fin de semana”.">
            {() => (
              <div className="flex flex-wrap gap-2 pt-1">
                {DIAS_SEMANA.map((d) => (
                  <label
                    key={d.value}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                  >
                    <input
                      type="checkbox"
                      name="diasSemana"
                      value={d.value}
                      defaultChecked={existing?.diasSemana?.includes(d.value) ?? false}
                      className="accent-primary"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            )}
          </Campo>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="horaInicio" etiqueta="Hora inicio (Happy Hour)" opcional>
              {(control) => <Input name="horaInicio" type="time" defaultValue={minutosAHora(existing?.horaInicioMin)} {...control} />}
            </Campo>
            <Campo id="horaFin" etiqueta="Hora fin" opcional>
              {(control) => <Input name="horaFin" type="time" defaultValue={minutosAHora(existing?.horaFinMin)} {...control} />}
            </Campo>
          </div>
        </FormSection>

        <FormSection apilada title="Urgencia y acción" description="El cupo que se muestra y a dónde lleva el botón.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo
              id="maxReclamos"
              etiqueta="Cupos totales"
              opcional
              ayuda="Urgencia visual para campañas sin Deal. Al vincular una oferta, sus cupos y presupuesto gobiernan los reclamos."
            >
              {(control) => <Input name="maxReclamos" type="number" min={0} placeholder="Sin límite" defaultValue={existing?.maxReclamos ?? ''} {...control} />}
            </Campo>
            <Campo id="prioridad" etiqueta="Prioridad" ayuda="Mayor = se muestra primero.">
              {(control) => <Input name="prioridad" type="number" min={0} defaultValue={existing?.prioridad ?? 0} {...control} />}
            </Campo>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="ctaTexto" etiqueta="Texto del botón" opcional>
              {(control) => (
                <Input name="ctaTexto" placeholder="Aprovecha ahora" value={ctaTexto} onChange={(e) => setCtaTexto(e.target.value)} maxLength={40} {...control} />
              )}
            </Campo>
            <Campo id="ctaHref" etiqueta="Destino del botón" ayuda={existing?.dealId ? 'El CTA irá a la ficha del Deal vinculado.' : undefined}>
              {(control) => (
                <Select
                  name="ctaHref"
                  defaultValue={existing?.dealId ? MARKETING_CTA_DESTINOS[0].value : existing?.ctaHref ?? MARKETING_CTA_DESTINOS[0].value}
                >
                  <SelectTrigger className="w-full" {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETING_CTA_DESTINOS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Campo>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" name="destacada" defaultChecked={existing?.destacada ?? false} className="size-4 accent-primary" />
            <span className="text-sm text-foreground">Destacar (se muestra antes que otras campañas)</span>
          </label>
        </FormSection>

        <FormSection apilada title="Apariencia" description="Imagen de fondo y colores de la tarjeta. Todo es opcional.">
          <Campo id="bannerUrl" etiqueta="Imagen de fondo" opcional como="grupo">
            {() => <BannerUploadBridge value={banner} onChange={setBanner} companyId={companyId} campanaId={existing?.id ?? null} />}
          </Campo>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="colorPrimario" etiqueta="Color primario">
              {(control) => <Input name="colorPrimario" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} {...control} />}
            </Campo>
            <Campo id="colorSecundario" etiqueta="Color secundario">
              {(control) => <Input name="colorSecundario" type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} {...control} />}
            </Campo>
          </div>
        </FormSection>

        <FormActions>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending}>
            {existing ? 'Guardar cambios' : 'Crear campaña'}
          </Button>
        </FormActions>
      </div>

      {/* ── Vista previa en vivo ─────────────────────────────────── */}
      <aside className="lg:sticky lg:top-6 lg:h-fit">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Vista previa
        </p>
        <PreviewBanner
          titulo={titulo || 'Título de la campaña'}
          descripcion={descripcion || 'Aquí verás la descripción de tu oferta.'}
          ctaTexto={ctaTexto || 'Aprovecha ahora'}
          primary={primary}
          secondary={secondary}
          banner={banner}
        />
      </aside>
    </form>
  )
}

/** Puente: CampanaImagenUpload escribe un hidden `bannerUrl`; también reflejamos
 *  el valor al estado para la vista previa vía un onInput sobre ese hidden. */
function BannerUploadBridge({
  value,
  onChange,
  companyId,
  campanaId,
}: {
  value: string
  onChange: (v: string) => void
  companyId: string | null
  campanaId: string | null
}) {
  return (
    <div
      onInput={(e) => {
        const hidden = (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(
          'input[name="bannerUrl"]'
        )
        if (hidden && hidden.value !== value) onChange(hidden.value)
      }}
    >
      <CampanaImagenUpload
        name="bannerUrl"
        companyId={companyId}
        campanaId={campanaId}
        currentUrl={value || null}
        label="Subir imagen de fondo"
        formato={FORMATOS.fondo}
      />
    </div>
  )
}

function PreviewBanner({
  titulo,
  descripcion,
  ctaTexto,
  primary,
  secondary,
  banner,
}: {
  titulo: string
  descripcion: string
  ctaTexto: string
  primary: string
  secondary: string
  banner: string
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-premium"
      style={{ background: `linear-gradient(120deg, ${primary}, ${secondary})` }}
    >
      {banner && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(120deg, ${primary}ee, ${secondary}cc)` }}
          />
        </>
      )}
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
      <div className="relative space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider">
          <Flame className="h-3.5 w-3.5" /> Solo por tiempo limitado
        </span>
        <h2 className="text-2xl font-extrabold leading-tight tracking-tight">{titulo}</h2>
        <p className="text-sm text-white/85">{descripcion}</p>
        <div className="pt-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-sm font-bold shadow-md"
            style={{ color: primary }}
          >
            {ctaTexto}
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>
  )
}
