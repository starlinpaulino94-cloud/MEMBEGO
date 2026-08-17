'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Flame, ArrowRight } from 'lucide-react'
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

export interface MarketingExisting {
  id: string
  tipo: string
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
}: {
  existing?: MarketingExisting
  /** Empresa dueña de las imágenes que se suban. Ver `storage-rutas.ts`. */
  companyId: string | null
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
    <form action={formAction} className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="max-w-2xl space-y-6">
        {existing && <input type="hidden" name="id" value={existing.id} />}

        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        {/* ── Básico ─────────────────────────────────────────────── */}
        <div className="space-y-5 rounded-xl border border-border p-5">
          <h3 className="font-semibold text-foreground">Información de la campaña</h3>

          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo de campaña</Label>
            <Select name="tipo" value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="tipo">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="titulo">Título</Label>
            <Input
              id="titulo"
              name="titulo"
              placeholder="Ej: ¡Lavado premium 2x1 solo hoy!"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={120}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              name="descripcion"
              placeholder="Describe la oferta de forma breve y atractiva…"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={600}
              rows={3}
              required
            />
          </div>
        </div>

        {/* ── Ventana de tiempo ──────────────────────────────────── */}
        <div className="space-y-5 rounded-xl border border-border p-5">
          <h3 className="font-semibold text-foreground">¿Cuándo se muestra?</h3>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fechaInicio">Inicio</Label>
              <Input
                id="fechaInicio"
                name="fechaInicio"
                type="datetime-local"
                defaultValue={toLocalInput(existing?.fechaInicio ?? null)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fechaFin">Fin</Label>
              <Input
                id="fechaFin"
                name="fechaFin"
                type="datetime-local"
                defaultValue={toLocalInput(existing?.fechaFin ?? null)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Días de la semana (opcional)</Label>
            <p className="text-xs text-muted-foreground">
              Déjalos sin marcar para mostrar todos los días. Útil para “Fin de semana”.
            </p>
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
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="horaInicio">Hora inicio (Happy Hour, opcional)</Label>
              <Input
                id="horaInicio"
                name="horaInicio"
                type="time"
                defaultValue={minutosAHora(existing?.horaInicioMin)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="horaFin">Hora fin</Label>
              <Input
                id="horaFin"
                name="horaFin"
                type="time"
                defaultValue={minutosAHora(existing?.horaFinMin)}
              />
            </div>
          </div>
        </div>

        {/* ── Urgencia + destino ─────────────────────────────────── */}
        <div className="space-y-5 rounded-xl border border-border p-5">
          <h3 className="font-semibold text-foreground">Urgencia y acción</h3>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxReclamos">Cupos totales (opcional)</Label>
              <Input
                id="maxReclamos"
                name="maxReclamos"
                type="number"
                min={0}
                placeholder="Sin límite"
                defaultValue={existing?.maxReclamos ?? ''}
              />
              <p className="text-xs text-muted-foreground">
                Muestra “¡Solo quedan X!” cuando el stock baja.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prioridad">Prioridad</Label>
              <Input
                id="prioridad"
                name="prioridad"
                type="number"
                min={0}
                defaultValue={existing?.prioridad ?? 0}
              />
              <p className="text-xs text-muted-foreground">Mayor = se muestra primero.</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ctaTexto">Texto del botón</Label>
              <Input
                id="ctaTexto"
                name="ctaTexto"
                placeholder="Aprovecha ahora"
                value={ctaTexto}
                onChange={(e) => setCtaTexto(e.target.value)}
                maxLength={40}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ctaHref">Destino del botón</Label>
              <Select name="ctaHref" defaultValue={existing?.ctaHref ?? MARKETING_CTA_DESTINOS[0].value}>
                <SelectTrigger id="ctaHref">
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
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 pt-1">
            <input
              type="checkbox"
              name="destacada"
              defaultChecked={existing?.destacada ?? false}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm text-foreground">
              Destacar (se muestra antes que otras campañas)
            </span>
          </label>
        </div>

        {/* ── Apariencia ─────────────────────────────────────────── */}
        <div className="space-y-5 rounded-xl border border-border p-5">
          <h3 className="font-semibold text-foreground">Apariencia</h3>

          <div className="space-y-2">
            <Label>Imagen de fondo (opcional)</Label>
            <BannerUploadBridge
              value={banner}
              onChange={setBanner}
              companyId={companyId}
              campanaId={existing?.id ?? null}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="colorPrimario">Color primario</Label>
              <Input
                id="colorPrimario"
                name="colorPrimario"
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="colorSecundario">Color secundario</Label>
              <Input
                id="colorSecundario"
                name="colorSecundario"
                type="color"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? 'Guardar cambios' : 'Crear campaña'}
          </Button>
        </div>
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
      className="relative overflow-hidden rounded-3xl p-5 text-white shadow-premium"
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
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
