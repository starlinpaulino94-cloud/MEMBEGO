import { Campo } from '@/components/ui/campo'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { SelectorColor, type ColorDePaleta } from '@/components/ui/selector-color'
import { PlanImagenUpload } from '@/components/admin/PlanImagenUpload'
import {
  COLOR_MARCA_POR_DEFECTO,
  contrasteDeMarca,
  normalizeCompanyBrandColor,
  paletaDeMarca,
} from '@/lib/company-branding'
import { NOMBRE_PLAN_MAX, type ErroresPlan, type ValoresPlan } from '@/modules/planes/formulario'

/**
 * LOS CAMPOS DE UN PLAN (auditoría admin · fase 7, tarea 7.2; 04 · F-01, F-04, F-06, F-07).
 *
 * Es la PARTE QUE SE DIBUJA de `PlanForm`, sin ganchos ni acciones: recibe los valores y los errores y devuelve el formulario.
 * Se separó para poder probar el marcado real —etiqueta de cada campo, error enlazado, lo opcional marcado— sin navegador.
 *
 * Una sola lista de campos para crear y para editar (F-06: eran `NuevoPlanForm` y `EditarPlanForm`, y cada campo nuevo se
 * añadía dos veces). Lo que solo existe al editar —«Plan activo»— solo se pinta al editar.
 *
 * LO QUE CAMBIA DE LO QUE SE VEÍA:
 *  · Cada campo es un `Campo`: su mensaje de error está enlazado a él (`aria-describedby`, `aria-invalid`), no es un aviso arriba.
 *  · Se marca lo OPCIONAL, no lo obligatorio (regla del sistema de diseño). Nada lleva asterisco.
 *  · El color se elige de una paleta cerrada con su contraste (F-07), no con un `type="color"` libre cuyo valor por defecto era
 *    un azul que el sistema ya había retirado. Un plan que ya tiene un color fuera de la paleta lo conserva como «Color actual»:
 *    guardar sin tocarlo NO lo borra.
 *  · Lo menos usado (condiciones, orden) vive en «Más opciones», cerrado salvo que ya tenga contenido o un error.
 */

const AREA =
  'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive'

/** La paleta cerrada y, si el plan ya tenía un color que no está en ella, ese color primero, para que guardar no lo pierda. */
export function paletaDelPlan(actual: string): ColorDePaleta[] {
  const base = paletaDeMarca()
  const color = normalizeCompanyBrandColor(actual)
  if (color && !base.some((c) => c.valor === color)) {
    return [{ valor: color, nombre: 'Color actual', ...contrasteDeMarca(color) }, ...base]
  }
  return base
}

export interface EmpresaOpcion {
  id: string
  name: string
}

export function PlanCampos({
  modo,
  planId = null,
  valores,
  errores = {},
  companies,
  empresaElegida = '',
  onEmpresa,
  empresaDeLaImagen,
}: {
  modo: 'crear' | 'editar'
  /** Id del plan al EDITAR: la imagen se sube a `<empresa>/planes/<planId>/`. Al crear, `null` (ruta `nueva`). */
  planId?: string | null
  valores: ValoresPlan
  errores?: ErroresPlan
  /** Solo el superadmin al CREAR: elige a qué empresa pertenece el plan. */
  companies?: EmpresaOpcion[]
  empresaElegida?: string
  onEmpresa?: (id: string) => void
  /** Empresa dueña de la ruta donde se sube la imagen (la sube antes de guardar). `null` = todavía no se puede subir. */
  empresaDeLaImagen: string | null
}) {
  // Al crear, un plan sin color elegido arranca con el de la paleta; al editar, sin color sigue sin color.
  const colorElegido = normalizeCompanyBrandColor(valores.color) ?? (modo === 'crear' ? COLOR_MARCA_POR_DEFECTO : null)
  const hayAvanzadas =
    valores.condiciones.trim() !== '' || (valores.orden.trim() !== '' && valores.orden.trim() !== '0') || Boolean(errores.orden)

  return (
    <>
      <FormSection title="Lo esencial" description="Cómo se llama, cuánto cuesta, cuánto dura y qué incluye.">
        {companies && (
          <Campo id="companyId" etiqueta="Empresa" error={errores.companyId}>
            {(control) => (
              <select
                name="companyId"
                required
                value={empresaElegida}
                onChange={(e) => onEmpresa?.(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
                {...control}
              >
                <option value="">Seleccionar empresa…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Campo>
        )}

        <Campo id="nombre" etiqueta="Nombre del plan" error={errores.nombre}>
          {(control) => (
            <Input name="nombre" required maxLength={NOMBRE_PLAN_MAX} defaultValue={valores.nombre} placeholder="Ej: Silver, Gold, Premium, VIP" {...control} />
          )}
        </Campo>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="precio" etiqueta="Precio (RD$)" error={errores.precio}>
            {(control) => (
              <Input name="precio" type="number" min="0" step="0.01" required defaultValue={valores.precio} placeholder="0.00" {...control} />
            )}
          </Campo>
          <Campo id="vigenciaDias" etiqueta="Vigencia (días)" ayuda="Cuánto dura desde que se compra." error={errores.vigenciaDias}>
            {(control) => <Input name="vigenciaDias" type="number" min="1" defaultValue={valores.vigenciaDias} {...control} />}
          </Campo>
        </div>

        <div className="space-y-3">
          <Campo id="lavados" etiqueta="Usos incluidos" opcional ayuda="Cuántas veces se puede aprovechar. Se ignora si los usos son ilimitados." error={errores.lavados}>
            {(control) => <Input name="lavados" type="number" min="0" defaultValue={valores.lavados} placeholder="0" {...control} />}
          </Campo>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="esIlimitado" defaultChecked={valores.esIlimitado} className="size-4 rounded border-input" />
            <span className="text-small text-foreground">Usos ilimitados</span>
          </label>
        </div>

        <Campo id="beneficios" etiqueta="Beneficios" opcional ayuda="Lo que incluye, en palabras del cliente. Uno por línea.">
          {(control) => (
            <textarea
              name="beneficios"
              rows={4}
              defaultValue={valores.beneficios}
              className={AREA}
              placeholder={'Ej: Servicio completo incluido\nAtención preferencial\nDescuento en servicios extra'}
              {...control}
            />
          )}
        </Campo>
      </FormSection>

      <FormSection title="Cómo se ve" description="Lo que ven tus clientes en la vitrina y en su membresía.">
        <Campo id="descripcion" etiqueta="Descripción" opcional ayuda="Breve. Se ve en la tarjeta del plan.">
          {(control) => <Input name="descripcion" defaultValue={valores.descripcion} placeholder="Descripción breve del plan" {...control} />}
        </Campo>

        <Campo
          id="imagen"
          como="grupo"
          etiqueta="Imagen del plan"
          opcional
          ayuda="La verán tus clientes al mirar el plan y su membresía. Si no pones ninguna, se sigue usando el color."
          error={errores.imagenUrl}
        >
          {() => <PlanImagenUpload companyId={empresaDeLaImagen} planId={planId} currentUrl={valores.imagenUrl || null} />}
        </Campo>

        <Campo id="color" como="grupo" etiqueta="Color del plan" ayuda="Distingue este plan de los demás en la vitrina.">
          {(control) => <SelectorColor nombre="color" valor={colorElegido} paleta={paletaDelPlan(valores.color)} aria-describedby={control['aria-describedby']} />}
        </Campo>
      </FormSection>

      <FormSection title="Disponibilidad" description="Dónde aparece y qué conviene decir antes de que pregunten.">
        {modo === 'editar' && (
          <label className="flex items-start gap-2.5">
            <input type="checkbox" name="activo" defaultChecked={valores.activo} className="mt-0.5 size-4 rounded border-input" />
            <span className="text-small text-foreground">
              Plan activo
              <span className="block text-caption text-muted-foreground">Un plan inactivo no se ve en la vitrina; las membresías ya vendidas siguen vigentes.</span>
            </span>
          </label>
        )}
        <details open={hayAvanzadas} className="group rounded-xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-small font-medium text-foreground">Más opciones</summary>
          <div className="mt-4 space-y-4">
            <Campo id="condiciones" etiqueta="Condiciones" opcional ayuda="Restricciones que conviene decir antes de que pregunten.">
              {(control) => (
                <textarea
                  name="condiciones"
                  rows={2}
                  defaultValue={valores.condiciones}
                  className={AREA}
                  placeholder="Ej: No aplica con otras promociones. Válido solo en sucursal principal."
                  {...control}
                />
              )}
            </Campo>
            <Campo id="orden" etiqueta="Orden" opcional ayuda="Menor número = aparece primero." error={errores.orden} className="max-w-32">
              {(control) => <Input name="orden" type="number" defaultValue={valores.orden} {...control} />}
            </Campo>
          </div>
        </details>
      </FormSection>
    </>
  )
}
