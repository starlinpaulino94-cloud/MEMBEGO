'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { actualizarPlan, crearPlan, type PlanActionState } from '@/modules/admin/planActions'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FormActions } from '@/components/ui/form-section'
import { PlanCampos, type EmpresaOpcion } from '@/components/admin/PlanCampos'
import type { ValoresPlan } from '@/modules/planes/formulario'

/**
 * EL FORMULARIO DE UN PLAN, UNO SOLO PARA CREAR Y PARA EDITAR (auditoría admin · fase 7, tarea 7.2; 04 · F-06).
 *
 * Eran dos (`NuevoPlanForm`, 238 líneas, y `EditarPlanForm`, 143) y cada campo nuevo se añadía dos veces. Los campos viven en
 * `PlanCampos`; esto pone alrededor lo que necesita un formulario vivo: la acción, el aviso, el foco y el regreso.
 *
 * Con `companies` (superadmin, al crear) muestra el selector de empresa; sin él, la acción usa la empresa de la sesión.
 *
 * SI ALGO FALLA, NO SE PIERDE LO ESCRITO. React 19 vacía los campos no controlados cuando termina la acción, también si falló.
 * La acción devuelve lo enviado (`state.valores`) y el formulario se vuelve a montar con eso como valor inicial: un error en el
 * precio ya no borra el nombre, los beneficios ni la imagen que se acababa de subir. Y el foco va al primer campo con error.
 */
export function PlanForm({
  modo,
  inicial,
  planId,
  companies,
  companyId,
  redirectTo = '/superadmin/planes',
}: {
  modo: 'crear' | 'editar'
  /** Los valores con que arranca: un plan nuevo, una plantilla copiada o el plan que se edita. */
  inicial: ValoresPlan
  /** Al editar. */
  planId?: string
  companies?: EmpresaOpcion[]
  /**
   * Empresa del panel. La necesita la subida de la imagen, que ocurre ANTES de guardar: el archivo se escribe en
   * `<companyId>/planes/nueva/` y sin ese prefijo quedaría fuera del alcance de la política del bucket.
   */
  companyId?: string | null
  redirectTo?: string
}) {
  const [state, action, pending] = useActionState<PlanActionState, FormData>(modo === 'crear' ? crearPlan : actualizarPlan, {})
  const router = useRouter()
  const formulario = useRef<HTMLFormElement>(null)
  const valores = state.valores ?? inicial

  // Con selector de empresa (superadmin) la ruta de la imagen depende de lo que se elija ahí, así que hay que seguirlo: subir
  // antes de elegir dejaría el archivo en la carpeta de otra empresa.
  const [empresaElegida, setEmpresaElegida] = useState(inicial.companyId)
  const empresaDeLaImagen = companies ? empresaElegida || null : modo === 'editar' ? inicial.companyId : (companyId ?? null)

  useEffect(() => {
    if (state.success) router.push(redirectTo)
  }, [state.success, router, redirectTo])

  // Foco al primer error: quien navega con teclado o lector de pantalla cae donde tiene que corregir.
  useEffect(() => {
    if (!state.campos || Object.keys(state.campos).length === 0) return
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [state])

  return (
    <form ref={formulario} action={action} className="space-y-8">
      {modo === 'editar' && planId && <input type="hidden" name="planId" value={planId} />}

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* La llave vuelve a montar los campos con lo que se había escrito (ver la cabecera). */}
      <div key={state.valores ? JSON.stringify(state.valores) : 'inicial'} className="space-y-8">
        <PlanCampos
          modo={modo}
          planId={planId ?? null}
          valores={valores}
          errores={state.campos}
          companies={companies}
          empresaElegida={empresaElegida}
          onEmpresa={setEmpresaElegida}
          empresaDeLaImagen={empresaDeLaImagen}
        />
      </div>

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {modo === 'crear' ? 'Crear plan' : 'Guardar cambios'}
        </Button>
      </FormActions>
    </form>
  )
}
