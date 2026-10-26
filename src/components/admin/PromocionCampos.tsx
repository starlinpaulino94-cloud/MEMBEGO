import { Campo } from '@/components/ui/campo'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PromoImagenUpload } from '@/components/admin/PromoImagenUpload'
import { PROMO_TIPOS, PROMO_VISIBILIDADES, TIPOS_CON_MONTO, TIPOS_CON_PORCENTAJE } from '@/lib/promociones'
import { FORMATOS } from '@/lib/imagen/formatos'
import type { ErroresPromocion, ValoresPromocion } from '@/modules/promociones/formulario'

/**
 * LOS CAMPOS DE UNA PROMOCIÓN (auditoría admin · fase 7, tarea 7.2; 04 · F-01, F-04, F-05).
 *
 * Es la PARTE QUE SE DIBUJA de `PromocionForm`, sin ganchos ni acciones: recibe valores y errores y devuelve el formulario. Se
 * separó para poder probar el marcado real sin navegador.
 *
 * F-05: el formulario mezclaba seis intenciones en una columna de 25 controles y se rellenaba a ciegas. Ahora hay TRES secciones
 * a la vista —Qué ofreces, Cuándo y Cuánto— y todo lo demás, que casi nadie toca en la primera promoción, en «Opciones avanzadas»
 * (cerrada, salvo que ya tenga contenido o un error: un campo con un valor que no se ve es un valor que nadie revisa).
 *
 * Cada campo es un `Campo`: su error está enlazado a él (`aria-describedby`, `aria-invalid`). Se marca lo OPCIONAL, no lo
 * obligatorio. Lo que se enviaba tocando el DOM (`document.querySelector('input[name="activo"]')`) ahora es estado controlado
 * que viaja en un campo oculto.
 */

const DIAS_SEMANA = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

export interface CampanaOpcion {
  id: string
  nombre: string
}

/** ¿Hay algo en «Opciones avanzadas» que no sea el valor por defecto, o un error ahí dentro? Entonces se abre sola. */
export function avanzadasConContenido(v: ValoresPromocion, errores: ErroresPromocion): boolean {
  const avanzadas =
    v.codigo.trim() !== '' ||
    v.maxCanjes.trim() !== '' ||
    (v.prioridad.trim() !== '' && v.prioridad.trim() !== '0') ||
    v.shareTitulo.trim() !== '' ||
    v.shareDescripcion.trim() !== '' ||
    v.visibilidad !== 'publica' ||
    v.campanaId !== 'none' ||
    (v.esComprable &&
      (v.limitePorCliente.trim() !== '' ||
        v.beneficioVigenciaDias.trim() !== '' ||
        v.beneficioVigenciaHasta.trim() !== '' ||
        v.diasPermitidos.length > 0 ||
        v.horaDesde.trim() !== '' ||
        v.horaHasta.trim() !== ''))
  const claves = [
    'maxCanjes', 'prioridad', 'visibilidad', 'campanaId',
    'limitePorCliente', 'beneficioVigenciaDias', 'beneficioVigenciaHasta', 'horaHasta',
  ] as const
  return avanzadas || claves.some((k) => Boolean(errores[k]))
}

export function PromocionCampos({
  modo,
  promocionId = null,
  companyId,
  valores,
  errores = {},
  campanas,
  tipo,
  onTipo,
  esComprable,
  onEsComprable,
  activo,
  onActivo,
}: {
  modo: 'crear' | 'editar'
  promocionId?: string | null
  /** Empresa dueña de las imágenes que se suban. */
  companyId: string | null
  valores: ValoresPromocion
  errores?: ErroresPromocion
  campanas: CampanaOpcion[]
  /** El tipo elegido (decide si se pide porcentaje o monto) y su cambio. */
  tipo: string
  onTipo?: (tipo: string) => void
  esComprable: boolean
  onEsComprable?: (v: boolean) => void
  activo: boolean
  onActivo?: (v: boolean) => void
}) {
  const pidePorcentaje = TIPOS_CON_PORCENTAJE.includes(tipo)
  const pideMonto = TIPOS_CON_MONTO.includes(tipo)
  const v = { ...valores, esComprable }

  return (
    <>
      {/* Lo que viaja al servidor desde un interruptor: estado controlado en un campo oculto, no un DOM manipulado a mano. */}
      <input type="hidden" name="esComprable" value={String(esComprable)} />
      {modo === 'editar' && <input type="hidden" name="activo" value={String(activo)} />}

      <FormSection title="Qué ofreces" description="El tipo, el título y lo que verá el cliente.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="tipo" etiqueta="Tipo de promoción" error={errores.tipo}>
            {(control) => (
              <Select name="tipo" value={tipo} onValueChange={(t) => onTipo?.(t)}>
                <SelectTrigger {...control}>
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
            )}
          </Campo>

          {(pidePorcentaje || pideMonto) && (
            <Campo id="descuento" etiqueta={pidePorcentaje ? 'Descuento (%)' : 'Monto de descuento (RD$)'} opcional error={errores.descuento}>
              {(control) => (
                <Input
                  name="descuento"
                  type="number"
                  min={0}
                  max={pidePorcentaje ? 100 : undefined}
                  defaultValue={valores.descuento}
                  placeholder={pidePorcentaje ? '25' : '500'}
                  {...control}
                />
              )}
            </Campo>
          )}
        </div>

        <Campo id="titulo" etiqueta="Título" error={errores.titulo}>
          {(control) => <Input name="titulo" defaultValue={valores.titulo} placeholder="Ej: 25% de descuento en tu primer mes" required {...control} />}
        </Campo>

        <Campo id="descripcion" etiqueta="Descripción" ayuda="Las condiciones y los detalles para el cliente." error={errores.descripcion}>
          {(control) => <Textarea name="descripcion" defaultValue={valores.descripcion} rows={4} required {...control} />}
        </Campo>

        <Campo
          id="imagen"
          como="grupo"
          etiqueta="Imagen de la promoción"
          opcional
          ayuda={`Se encuadra al subirla: ${FORMATOS.promocion.descripcion.toLowerCase()}. Al compartir el enlace (WhatsApp, Facebook…) se muestra ENTERA como vista previa.`}
        >
          {() => <PromoImagenUpload companyId={companyId} promocionId={promocionId} currentUrl={valores.imagenUrl || null} />}
        </Campo>
      </FormSection>

      <FormSection title="Cuándo" description="La ventana en que se puede aprovechar.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="vigenciaDesde" etiqueta="Inicio (fecha y hora)" ayuda="Vacío = desde ahora." error={errores.vigenciaDesde}>
            {(control) => <Input name="vigenciaDesde" type="datetime-local" defaultValue={valores.vigenciaDesde} {...control} />}
          </Campo>
          <Campo id="vigenciaHasta" etiqueta="Fin (fecha y hora)" opcional ayuda="Vacío = sin fecha de expiración." error={errores.vigenciaHasta}>
            {(control) => <Input name="vigenciaHasta" type="datetime-local" defaultValue={valores.vigenciaHasta} {...control} />}
          </Campo>
        </div>

        {modo === 'editar' && (
          <div className="flex items-center gap-3">
            <Switch id="activo" checked={activo} onCheckedChange={(c) => onActivo?.(c)} />
            <Label htmlFor="activo">Promoción activa</Label>
          </div>
        )}
      </FormSection>

      <FormSection title="Cuánto" description="Si la vendes, a qué precio.">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="esComprableSwitch" className="font-medium">
              Venta directa
            </Label>
            <p className="text-caption text-muted-foreground">
              Permite que el cliente compre esta promoción (transferencia + validación) y reciba un QR para canjearla.
            </p>
          </div>
          <Switch id="esComprableSwitch" checked={esComprable} onCheckedChange={(c) => onEsComprable?.(c)} />
        </div>

        {esComprable && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id="precio" etiqueta="Precio (RD$)" ayuda="0 = gratis (se activa sin pago)." error={errores.precio}>
              {(control) => <Input name="precio" type="number" min={0} step="0.01" defaultValue={valores.precio} required {...control} />}
            </Campo>
            <Campo id="usosPorCompra" etiqueta="Usos por compra" opcional error={errores.usosPorCompra}>
              {(control) => <Input name="usosPorCompra" type="number" min={1} defaultValue={valores.usosPorCompra} {...control} />}
            </Campo>
          </div>
        )}
      </FormSection>

      <details open={avanzadasConContenido(v, errores)} className="rounded-xl border border-border px-5 py-4">
        <summary className="cursor-pointer text-small font-medium text-foreground">
          Opciones avanzadas
          <span className="ml-2 font-normal text-muted-foreground">Código, límites, texto al compartir, visibilidad y campaña</span>
        </summary>

        <div className="mt-5 space-y-8">
          <FormSection title="Límites" description="Cuántas veces, y con qué prioridad.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo id="codigo" etiqueta="Código promocional / cupón" opcional>
                {(control) => <Input name="codigo" defaultValue={valores.codigo} placeholder="Ej: BIENVENIDA25" {...control} />}
              </Campo>
              <Campo id="maxCanjes" etiqueta="Límite de canjes (stock)" opcional ayuda="Vacío = ilimitado." error={errores.maxCanjes}>
                {(control) => <Input name="maxCanjes" type="number" min={1} defaultValue={valores.maxCanjes} {...control} />}
              </Campo>
              <Campo id="prioridad" etiqueta="Prioridad" opcional ayuda="Mayor número = aparece primero." error={errores.prioridad}>
                {(control) => <Input name="prioridad" type="number" defaultValue={valores.prioridad} {...control} />}
              </Campo>
            </div>
          </FormSection>

          {esComprable && (
            <FormSection title="Condiciones de la venta" description="Quién puede adquirirla, cuánto dura y cuándo se canjea.">
              <div className="grid gap-5 sm:grid-cols-2">
                <Campo
                  id="limitePorCliente"
                  etiqueta="Límite por cliente"
                  opcional
                  ayuda="Cuántas veces puede adquirirla un mismo cliente. Escribe 1 para un solo uso por cliente (ej: primer lavado gratis): no podrá volver a adquirirla ni siquiera tras usarla."
                  error={errores.limitePorCliente}
                >
                  {(control) => <Input name="limitePorCliente" type="number" min={1} defaultValue={valores.limitePorCliente} placeholder="Vacío = sin límite" {...control} />}
                </Campo>
                <Campo
                  id="beneficioVigenciaDias"
                  etiqueta="Vigencia del beneficio (días)"
                  opcional
                  ayuda="Días para usarla desde la activación. Independiente de la ventana de compra."
                  error={errores.beneficioVigenciaDias}
                >
                  {(control) => <Input name="beneficioVigenciaDias" type="number" min={1} defaultValue={valores.beneficioVigenciaDias} placeholder="Ej: 30, 60, 90" {...control} />}
                </Campo>
                <Campo id="beneficioVigenciaHasta" etiqueta="…o hasta una fecha fija" opcional ayuda="Ambos vacíos = sin vencimiento." error={errores.beneficioVigenciaHasta}>
                  {(control) => <Input name="beneficioVigenciaHasta" type="datetime-local" defaultValue={valores.beneficioVigenciaHasta} {...control} />}
                </Campo>
              </div>

              <Campo id="diasPermitidos" como="grupo" etiqueta="Días permitidos para el canje" opcional ayuda="Sin marcar ninguno = válida todos los días.">
                {() => (
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
                          defaultChecked={valores.diasPermitidos.includes(d.value)}
                          className="accent-[var(--primary)]"
                        />
                        {d.label}
                      </label>
                    ))}
                  </div>
                )}
              </Campo>

              <div className="grid gap-5 sm:grid-cols-2">
                <Campo id="horaDesde" etiqueta="Horario desde" opcional>
                  {(control) => <Input name="horaDesde" type="time" defaultValue={valores.horaDesde} {...control} />}
                </Campo>
                <Campo id="horaHasta" etiqueta="Horario hasta" opcional ayuda="Vacíos = válida a cualquier hora." error={errores.horaHasta}>
                  {(control) => <Input name="horaHasta" type="time" defaultValue={valores.horaHasta} {...control} />}
                </Campo>
              </div>
            </FormSection>
          )}

          <FormSection title="Al compartir" description="Texto que acompaña la vista previa del enlace en WhatsApp, Facebook y demás apps. Vacío = se usa el título y la descripción.">
            <Campo id="shareTitulo" etiqueta="Título al compartir" opcional>
              {(control) => <Input name="shareTitulo" maxLength={120} defaultValue={valores.shareTitulo} placeholder="Ej: Tu primer lavado GRATIS en CARTOWN" {...control} />}
            </Campo>
            <Campo id="shareDescripcion" etiqueta="Descripción al compartir" opcional>
              {(control) => (
                <Textarea
                  name="shareDescripcion"
                  rows={2}
                  maxLength={200}
                  defaultValue={valores.shareDescripcion}
                  placeholder="Ej: Regístrate gratis y reclama tu lavado de bienvenida. Solo esta semana."
                  {...control}
                />
              )}
            </Campo>
          </FormSection>

          <FormSection title="Alcance" description="Quién la ve y a qué campaña pertenece.">
            <Campo
              id="visibilidad"
              etiqueta="Visibilidad"
              ayuda="Las privadas solo las ven los miembros de tu empresa; no aparecen en el marketplace público."
              error={errores.visibilidad}
            >
              {(control) => (
                <Select name="visibilidad" defaultValue={valores.visibilidad}>
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMO_VISIBILIDADES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Campo>

            {campanas.length > 0 && (
              <Campo id="campanaId" etiqueta="Campaña" opcional ayuda="Agrupa esta promoción bajo una campaña para medirla en conjunto." error={errores.campanaId}>
                {(control) => (
                  <Select name="campanaId" defaultValue={valores.campanaId}>
                    <SelectTrigger {...control}>
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
                )}
              </Campo>
            )}
          </FormSection>
        </div>
      </details>
    </>
  )
}
