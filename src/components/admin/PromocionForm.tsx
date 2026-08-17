'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearPromocion,
  actualizarPromocion,
  type PromocionState,
} from '@/modules/admin/promocionActions'
import {
  PROMO_TIPOS,
  PROMO_VISIBILIDADES,
  TIPOS_CON_PORCENTAJE,
  TIPOS_CON_MONTO,
} from '@/lib/promociones'
import { PromoImagenUpload } from '@/components/admin/PromoImagenUpload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PROMO_IMG_DESCRIPCION } from '@/modules/promociones/formato-imagen'

interface Existing {
  id: string
  titulo: string
  descripcion: string
  imagenUrl: string | null
  tipo: string
  descuento: number | null
  codigo: string | null
  visibilidad: string
  vigenciaDesde: Date
  vigenciaHasta: Date | null
  maxCanjes: number | null
  prioridad: number
  campanaId: string | null
  activo: boolean
  // Fase E5: venta como producto comercial
  esComprable: boolean
  precio: number | null
  usosPorCompra: number
  limitePorCliente: number | null
  beneficioVigenciaDias: number | null
  beneficioVigenciaHasta: Date | null
  diasPermitidos: number[]
  horaDesde: string | null
  horaHasta: string | null
  // Share Engine: textos propios al compartir ({ ogTitulo?, ogDescripcion? }).
  shareConfig?: unknown
}

/** Textos de compartición guardados (tolerante a null/JSON ajeno). */
function shareDe(raw: unknown): { ogTitulo: string; ogDescripcion: string } {
  const cfg = (raw ?? {}) as { ogTitulo?: unknown; ogDescripcion?: unknown }
  return {
    ogTitulo: typeof cfg.ogTitulo === 'string' ? cfg.ogTitulo : '',
    ogDescripcion: typeof cfg.ogDescripcion === 'string' ? cfg.ogDescripcion : '',
  }
}

const DIAS_SEMANA = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

interface CampanaOption {
  id: string
  nombre: string
}

/**
 * Valores iniciales copiados de una plantilla (Fase E3). Solo aplica al crear:
 * el usuario puede editar todo antes de publicar y la plantilla nunca cambia.
 */
export interface PromocionPrefillValues {
  titulo: string
  descripcion: string
  tipo: string
  descuento: number | null
  vigenciaHasta: Date | null
}

const init: PromocionState = {}

function toDatetimeLocal(d: Date | null) {
  if (!d) return ''
  const date = new Date(d)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function PromocionForm({
  existing,
  prefill,
  campanas = [],
  companyId,
}: {
  existing?: Existing
  prefill?: PromocionPrefillValues
  campanas?: CampanaOption[]
  /**
   * Empresa dueña de las imágenes que se suban. Al editar es la de la propia
   * promoción —así funciona también cuando un superadmin edita la de otra
   * empresa—; al crear, la empresa activa de la sesión, que puede ser `null`.
   */
  companyId: string | null
}) {
  const router = useRouter()
  const action = existing ? actualizarPromocion : crearPromocion
  const [state, formAction, pending] = useActionState(action, init)
  const [tipo, setTipo] = useState(existing?.tipo ?? prefill?.tipo ?? 'descuento')
  const [esComprable, setEsComprable] = useState(existing?.esComprable ?? false)

  useEffect(() => {
    if (state.success) {
      toast.success(
        existing
          ? 'Promoción actualizada.'
          : 'Promoción publicada. Tus seguidores fueron notificados.'
      )
      router.push('/admin/promociones')
      router.refresh()
    }
  }, [state.success, existing, router])

  const pidePorcentaje = TIPOS_CON_PORCENTAJE.includes(tipo)
  const pideMonto = TIPOS_CON_MONTO.includes(tipo)

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Qué ofreces */}
      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Qué ofreces</h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo de promoción *</Label>
            <Select name="tipo" value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMO_TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(pidePorcentaje || pideMonto) && (
            <div className="space-y-2">
              <Label htmlFor="descuento">
                {pidePorcentaje ? 'Descuento (%)' : 'Monto de descuento (RD$)'}
              </Label>
              <Input
                id="descuento"
                name="descuento"
                type="number"
                min={0}
                max={pidePorcentaje ? 100 : undefined}
                defaultValue={existing?.descuento ?? prefill?.descuento ?? ''}
                placeholder={pidePorcentaje ? '25' : '500'}
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="titulo">Título *</Label>
          <Input
            id="titulo"
            name="titulo"
            defaultValue={existing?.titulo ?? prefill?.titulo}
            placeholder="Ej: 25% de descuento en tu primer mes"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="descripcion">Descripción *</Label>
          <Textarea
            id="descripcion"
            name="descripcion"
            defaultValue={existing?.descripcion ?? prefill?.descripcion}
            rows={4}
            placeholder="Condiciones y detalles para el cliente"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="codigo">Código promocional / cupón</Label>
          <Input
            id="codigo"
            name="codigo"
            defaultValue={existing?.codigo ?? ''}
            placeholder="Ej: BIENVENIDA25"
          />
        </div>

        <div className="space-y-2">
          <Label>Imagen de la promoción</Label>
          <PromoImagenUpload
            companyId={companyId}
            promocionId={existing?.id ?? null}
            currentUrl={existing?.imagenUrl ?? null}
          />
          <p className="text-xs text-muted-foreground">
            {PROMO_IMG_DESCRIPCION}. Al compartir el enlace (WhatsApp,
            Facebook…) se muestra ENTERA como vista previa.
          </p>
        </div>
      </div>

      {/* Share Engine: textos al compartir el enlace */}
      <div className="space-y-5 rounded-xl border border-border p-5">
        <div>
          <h3 className="font-semibold text-foreground">Al compartir</h3>
          <p className="text-sm text-muted-foreground">
            Texto que acompaña la vista previa del enlace en WhatsApp, Facebook y
            demás apps. Vacío = se usa el título y la descripción de arriba.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="shareTitulo">Título al compartir</Label>
          <Input
            id="shareTitulo"
            name="shareTitulo"
            maxLength={120}
            defaultValue={shareDe(existing?.shareConfig).ogTitulo}
            placeholder="Ej: 🚗 Tu primer lavado GRATIS en CARTOWN"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shareDescripcion">Descripción al compartir</Label>
          <Textarea
            id="shareDescripcion"
            name="shareDescripcion"
            rows={2}
            maxLength={200}
            defaultValue={shareDe(existing?.shareConfig).ogDescripcion}
            placeholder="Ej: Regístrate gratis y reclama tu lavado de bienvenida. Solo esta semana."
          />
        </div>
      </div>

      {/* Vigencia y límites */}
      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Vigencia y límites</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vigenciaDesde">Inicio (fecha y hora)</Label>
            <Input
              id="vigenciaDesde"
              name="vigenciaDesde"
              type="datetime-local"
              defaultValue={toDatetimeLocal(existing?.vigenciaDesde ?? new Date())}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vigenciaHasta">Fin (fecha y hora)</Label>
            <Input
              id="vigenciaHasta"
              name="vigenciaHasta"
              type="datetime-local"
              defaultValue={toDatetimeLocal(existing?.vigenciaHasta ?? prefill?.vigenciaHasta ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Vacío = sin fecha de expiración.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxCanjes">Límite de canjes (stock)</Label>
            <Input
              id="maxCanjes"
              name="maxCanjes"
              type="number"
              min={1}
              defaultValue={existing?.maxCanjes ?? ''}
              placeholder="Vacío = ilimitado"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prioridad">Prioridad</Label>
            <Input
              id="prioridad"
              name="prioridad"
              type="number"
              defaultValue={existing?.prioridad ?? 0}
            />
            <p className="text-xs text-muted-foreground">
              Mayor número = aparece primero.
            </p>
          </div>
        </div>
      </div>

      {/* Venta (Fase E5): la promoción como producto comercial */}
      <div className="space-y-5 rounded-xl border border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Venta directa</h3>
            <p className="text-xs text-muted-foreground">
              Permite que el cliente compre esta promoción (transferencia +
              validación) y reciba un QR para canjearla.
            </p>
          </div>
          <Switch
            id="esComprable"
            checked={esComprable}
            onCheckedChange={setEsComprable}
            aria-label="Habilitar venta directa"
          />
        </div>
        <input type="hidden" name="esComprable" value={String(esComprable)} />

        {esComprable && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="precio">Precio (RD$) *</Label>
                <Input
                  id="precio"
                  name="precio"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={existing?.precio ?? ''}
                  placeholder="0 = gratis (se activa sin pago)"
                  required={esComprable}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usosPorCompra">Usos por compra</Label>
                <Input
                  id="usosPorCompra"
                  name="usosPorCompra"
                  type="number"
                  min={1}
                  defaultValue={existing?.usosPorCompra ?? 1}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="limitePorCliente">Límite por cliente</Label>
                <Input
                  id="limitePorCliente"
                  name="limitePorCliente"
                  type="number"
                  min={1}
                  defaultValue={existing?.limitePorCliente ?? ''}
                  placeholder="Vacío = sin límite"
                />
                <p className="text-xs text-muted-foreground">
                  Cuántas veces puede adquirirla un mismo cliente. Escribe{' '}
                  <strong>1</strong> para un solo uso por cliente (ej: primer
                  lavado gratis): no podrá volver a adquirirla ni siquiera tras
                  usarla.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="beneficioVigenciaDias">Vigencia del beneficio (días)</Label>
                <Input
                  id="beneficioVigenciaDias"
                  name="beneficioVigenciaDias"
                  type="number"
                  min={1}
                  defaultValue={existing?.beneficioVigenciaDias ?? ''}
                  placeholder="Ej: 30, 60, 90"
                />
                <p className="text-xs text-muted-foreground">
                  Días para usarla desde la activación. Independiente de la
                  ventana de compra (Vigencia y límites).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="beneficioVigenciaHasta">…o hasta una fecha fija</Label>
                <Input
                  id="beneficioVigenciaHasta"
                  name="beneficioVigenciaHasta"
                  type="datetime-local"
                  defaultValue={toDatetimeLocal(existing?.beneficioVigenciaHasta ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  Ambos vacíos = sin vencimiento.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Días permitidos para el canje</Label>
              <div className="flex flex-wrap gap-2">
                {DIAS_SEMANA.map((d) => (
                  <label
                    key={d.value}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                  >
                    <input
                      type="checkbox"
                      name="diasPermitidos"
                      value={d.value}
                      defaultChecked={existing?.diasPermitidos?.includes(d.value) ?? false}
                      className="accent-[var(--primary)]"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Sin marcar ninguno = válida todos los días.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="horaDesde">Horario desde</Label>
                <Input
                  id="horaDesde"
                  name="horaDesde"
                  type="time"
                  defaultValue={existing?.horaDesde ?? ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="horaHasta">Horario hasta</Label>
                <Input
                  id="horaHasta"
                  name="horaHasta"
                  type="time"
                  defaultValue={existing?.horaHasta ?? ''}
                />
                <p className="text-xs text-muted-foreground">
                  Vacíos = válida a cualquier hora.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Alcance */}
      <div className="space-y-5 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Alcance</h3>
        <div className="space-y-2">
          <Label htmlFor="visibilidad">Visibilidad</Label>
          <Select name="visibilidad" defaultValue={existing?.visibilidad ?? 'publica'}>
            <SelectTrigger id="visibilidad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMO_VISIBILIDADES.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Las privadas solo las ven los miembros de tu empresa; no aparecen
            en el marketplace público.
          </p>
        </div>

        {campanas.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="campanaId">Campaña (opcional)</Label>
            <Select name="campanaId" defaultValue={existing?.campanaId ?? 'none'}>
              <SelectTrigger id="campanaId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin campaña</SelectItem>
                {campanas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Agrupa esta promoción bajo una campaña para medirla en conjunto.
            </p>
          </div>
        )}

        {existing && (
          <div className="flex items-center gap-3">
            <Switch
              id="activo"
              name="activo"
              defaultChecked={existing.activo}
              value="true"
              onCheckedChange={(checked) => {
                const el = document.querySelector<HTMLInputElement>('input[name="activo"]')
                if (el) el.value = String(checked)
              }}
            />
            <Label htmlFor="activo">Promoción activa</Label>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {existing ? 'Guardar cambios' : 'Publicar promoción'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
