'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DestacarEnInicio } from '@/components/admin/DestacarEnInicio'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { crearPromocion, actualizarPromocion, type PromocionState } from '@/modules/admin/promocionActions'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PromocionCampos, type CampanaOpcion } from '@/components/admin/PromocionCampos'
import type { ValoresPromocion } from '@/modules/promociones/formulario'

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

/** `datetime-local` pide la hora LOCAL del navegador, sin zona: por eso se calcula aquí, en el cliente, y no en el servidor. */
function toDatetimeLocal(d: Date | null) {
  if (!d) return ''
  const date = new Date(d)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const numero = (n: number | null | undefined) => (n == null ? '' : String(n))

/** Lo que se pinta al abrir: una promoción que existe, una plantilla copiada o una nueva. */
function valoresIniciales(existing: Existing | undefined, prefill: PromocionPrefillValues | undefined): ValoresPromocion {
  const share = shareDe(existing?.shareConfig)
  return {
    tipo: existing?.tipo ?? prefill?.tipo ?? 'descuento',
    descuento: numero(existing?.descuento ?? prefill?.descuento),
    titulo: existing?.titulo ?? prefill?.titulo ?? '',
    descripcion: existing?.descripcion ?? prefill?.descripcion ?? '',
    codigo: existing?.codigo ?? '',
    imagenUrl: existing?.imagenUrl ?? '',
    shareTitulo: share.ogTitulo,
    shareDescripcion: share.ogDescripcion,
    vigenciaDesde: toDatetimeLocal(existing?.vigenciaDesde ?? new Date()),
    vigenciaHasta: toDatetimeLocal(existing?.vigenciaHasta ?? prefill?.vigenciaHasta ?? null),
    maxCanjes: numero(existing?.maxCanjes),
    prioridad: String(existing?.prioridad ?? 0),
    esComprable: existing?.esComprable ?? false,
    precio: numero(existing?.precio),
    usosPorCompra: String(existing?.usosPorCompra ?? 1),
    limitePorCliente: numero(existing?.limitePorCliente),
    beneficioVigenciaDias: numero(existing?.beneficioVigenciaDias),
    beneficioVigenciaHasta: toDatetimeLocal(existing?.beneficioVigenciaHasta ?? null),
    diasPermitidos: existing?.diasPermitidos ?? [],
    horaDesde: existing?.horaDesde ?? '',
    horaHasta: existing?.horaHasta ?? '',
    visibilidad: existing?.visibilidad ?? 'publica',
    campanaId: existing?.campanaId ?? 'none',
    activo: existing?.activo ?? true,
  }
}

/**
 * EL FORMULARIO DE UNA PROMOCIÓN (auditoría admin · fase 7, tarea 7.2; 04 · F-05).
 *
 * Los campos viven en `PromocionCampos` (tres secciones a la vista y el resto en «Opciones avanzadas»); esto pone alrededor lo
 * que necesita un formulario vivo: la acción, el aviso, el foco y el regreso.
 *
 * SI ALGO FALLA, NO SE PIERDE LO ESCRITO. React 19 vacía los campos no controlados cuando termina la acción, también si falló.
 * La acción devuelve lo enviado (`state.valores`) y los campos se vuelven a montar con eso como valor inicial: un error en el
 * precio ya no borra el título, la descripción ni la imagen recién subida. Y el foco va al primer campo con error.
 *
 * Lo que antes se resolvía tocando el DOM (`document.querySelector('input[name="activo"]')`) es estado controlado: el interruptor
 * y el campo oculto leen la misma variable.
 */
export function PromocionForm({
  existing,
  prefill,
  campanas = [],
  companyId,
}: {
  existing?: Existing
  prefill?: PromocionPrefillValues
  campanas?: CampanaOpcion[]
  /**
   * Empresa dueña de las imágenes que se suban. Al editar es la de la propia
   * promoción —así funciona también cuando un superadmin edita la de otra
   * empresa—; al crear, la empresa activa de la sesión, que puede ser `null`.
   */
  companyId: string | null
}) {
  const router = useRouter()
  const modo = existing ? 'editar' : 'crear'
  const [state, formAction, pending] = useActionState<PromocionState, FormData>(existing ? actualizarPromocion : crearPromocion, {})
  const formulario = useRef<HTMLFormElement>(null)
  const inicial = valoresIniciales(existing, prefill)
  const valores = state.valores ?? inicial

  // Lo que decide qué se muestra mientras se escribe vive aquí y NO se pierde al volver a montar los campos tras un error.
  const [tipo, setTipo] = useState(inicial.tipo)
  const [esComprable, setEsComprable] = useState(inicial.esComprable)
  const [activo, setActivo] = useState(inicial.activo)

  // Al CREAR, antes de volver a la lista se pregunta si se destaca en el inicio.
  const [destacar, setDestacar] = useState<string | null>(null)
  useEffect(() => {
    if (state.success) {
      toast.success(existing ? 'Promoción actualizada.' : 'Promoción publicada. Tus seguidores fueron notificados.')
      if (!existing && state.promocionId) {
        setDestacar(state.promocionId)
        return
      }
      router.push('/admin/promociones')
      router.refresh()
    }
  }, [state.success, state.promocionId, existing, router])

  // Foco al primer error: quien navega con teclado o lector de pantalla cae donde tiene que corregir.
  useEffect(() => {
    if (!state.campos || Object.keys(state.campos).length === 0) return
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [state])

  return (
    <form ref={formulario} action={formAction} className="max-w-2xl space-y-6">
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* La llave vuelve a montar los campos con lo que se había escrito (ver la cabecera). */}
      <div key={state.valores ? JSON.stringify(state.valores) : 'inicial'} className="space-y-6">
        <PromocionCampos
          modo={modo}
          promocionId={existing?.id ?? null}
          companyId={companyId}
          valores={valores}
          errores={state.campos}
          campanas={campanas}
          tipo={tipo}
          onTipo={setTipo}
          esComprable={esComprable}
          onEsComprable={setEsComprable}
          activo={activo}
          onActivo={setActivo}
        />
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
      <DestacarEnInicio
        origen="PROMOCION"
        id={destacar ?? ''}
        abierto={destacar !== null}
        alCerrar={() => {
          setDestacar(null)
          router.push('/admin/promociones')
          router.refresh()
        }}
      />
    </form>
  )
}
