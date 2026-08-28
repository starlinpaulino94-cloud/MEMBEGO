'use client'

/**
 * Plataforma modular · E4 — panel de capacidades de UNA empresa (superadmin).
 * Muestra cada capacidad con su estado efectivo; lo no tocado sigue al
 * paquete base de la categoría (solo se guardan las diferencias).
 */

import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  guardarCapacidades,
  type CapacidadesActionState,
} from '@/modules/capacidades/actions'
import {
  CAPACIDADES,
  CAPACIDAD_LABELS,
  CATEGORIAS,
  CATEGORIA_LABELS,
  MODULOS_CLIENTE,
  MODULO_CLIENTE_AUTO,
  MODULO_CLIENTE_LABELS,
  VISIBILIDADES,
  VISIBILIDAD_LABELS,
  seccionesQueApaga,
  type Capacidad,
  type CategoriaNegocio,
  type ModuloCliente,
  type VisibilidadModulo,
} from '@/modules/capacidades/catalogo'

const init: CapacidadesActionState = {}

export function CapacidadesPanel({
  companyId,
  categoria,
  activas,
  modulosCliente = {},
}: {
  companyId: string
  categoria: CategoriaNegocio
  /** Estado EFECTIVO actual (base + overrides) para precargar los toggles. */
  activas: Capacidad[]
  /** Forzados guardados; lo ausente es AUTO. */
  modulosCliente?: Partial<Record<ModuloCliente, VisibilidadModulo>>
}) {
  const [state, action, pending] = useActionState(guardarCapacidades, init)
  const activasSet = new Set(activas)
  const formRef = useRef<HTMLFormElement>(null)
  /** Secciones que se apagarían con lo que hay marcado ahora mismo. */
  const [porApagar, setPorApagar] = useState<string[] | null>(null)

  useEffect(() => {
    if (state.success) toast.success(state.success)
    if (state.error) toast.error(state.error)
  }, [state])

  /**
   * AVISAR ANTES DE DEJAR A UNA EMPRESA SIN UNA SECCIÓN DE SU PANEL.
   *
   * Los interruptores no tenían ninguna barrera: apagar la capacidad
   * equivocada le quita al negocio una sección entera de su administración, y
   * quien lo hace no se entera hasta que llaman.
   *
   * Solo se pregunta cuando de verdad se apaga algo que HOY está encendido y
   * que controla una sección. Preguntar siempre convertiría el aviso en un
   * paso que se despacha con Enter sin leerlo.
   */
  function alEnviar(e: React.FormEvent<HTMLFormElement>) {
    if (porApagar !== null) return // ya confirmado: dejar pasar
    const datos = new FormData(e.currentTarget)
    const secciones = CAPACIDADES.filter(
      (cap) => activasSet.has(cap) && datos.get(`cap_${cap}`) !== 'on'
    ).flatMap((cap) => seccionesQueApaga(cap))
    if (secciones.length === 0) return
    e.preventDefault()
    setPorApagar(secciones)
  }

  return (
    <form ref={formRef} action={action} onSubmit={alEnviar} className="space-y-5">
      <input type="hidden" name="companyId" value={companyId} />

      <label className="block max-w-xs space-y-1.5 text-sm font-medium text-foreground">
        Categoría del negocio
        <select
          name="categoria"
          defaultValue={categoria}
          className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
        >
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>
              {CATEGORIA_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="block text-xs font-normal text-muted-foreground">
          Define el paquete base de capacidades. Solo Car Wash está operativa.
        </span>
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {CAPACIDADES.map((cap) => (
          <label
            key={cap}
            className="flex items-start gap-3 rounded-xl border border-border/60 p-3 text-sm"
          >
            <input
              type="checkbox"
              name={`cap_${cap}`}
              defaultChecked={activasSet.has(cap)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <span className="font-medium text-foreground">{CAPACIDAD_LABELS[cap]}</span>
              {/* QUÉ APAGA. El mapa existía y no se enseñaba en ningún sitio:
                  quien mueve el interruptor tenía que saberse de memoria qué
                  controla. */}
              {seccionesQueApaga(cap).length > 0 && (
                <span className="mt-0.5 block text-caption text-muted-foreground">
                  Controla: {seccionesQueApaga(cap).join(', ')}
                </span>
              )}
              <span className="block text-caption uppercase tracking-wide text-muted-foreground/70">
                {cap}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl border border-border/60 p-4">
        <div>
          <h3 className="font-bold text-foreground">Qué ve el cliente de este negocio</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            En automático, un módulo aparece cuando tiene algo dentro y se esconde
            mientras esté vacío: así el cliente de un negocio que todavía no publicó
            planes no ve una sección de membresías propias que no lleva a ninguna
            parte. El catálogo de Planes queda disponible como ruta de compra y
            descubrimiento.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULOS_CLIENTE.map((modulo) => (
            <label
              key={modulo}
              className="space-y-1.5 rounded-xl border border-border/60 p-3 text-sm"
            >
              <span className="font-medium text-foreground">
                {MODULO_CLIENTE_LABELS[modulo]}
              </span>
              <select
                name={`mod_${modulo}`}
                defaultValue={modulosCliente[modulo] ?? 'AUTO'}
                className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                {VISIBILIDADES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILIDAD_LABELS[v]}
                  </option>
                ))}
              </select>
              <span className="text-caption block font-normal text-muted-foreground">
                {MODULO_CLIENTE_AUTO[modulo]}
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Los cambios aplican de inmediato (menús, launchpad y barreras de servidor).
        Apagar una capacidad bloquea también sus acciones en el servidor, no solo la
        esconde. La visibilidad de los módulos del cliente solo afecta al menú: las
        rutas siguen respondiendo por URL con su estado vacío.
      </p>

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Guardar capacidades
      </Button>

      {/* Las secciones se nombran UNA A UNA, no «se apagarán algunas»: el
          objetivo es que quien confirma reconozca lo que va a desaparecer del
          panel de ese negocio. */}
      <ConfirmDialog
        open={porApagar !== null && porApagar.length > 0}
        title="¿Apagar secciones del panel de esta empresa?"
        description={
          porApagar
            ? `Dejará de ver: ${porApagar.join(', ')}. Sus datos se conservan y vuelven al encenderla de nuevo.`
            : ''
        }
        confirmText="Apagar y guardar"
        isDangerous
        isLoading={pending}
        onConfirm={() => {
          // `porApagar` pasa a lista vacía: `alEnviar` deja pasar el siguiente
          // envío en vez de volver a preguntar en bucle.
          setPorApagar([])
          formRef.current?.requestSubmit()
        }}
        onCancel={() => setPorApagar(null)}
      />
    </form>
  )
}
