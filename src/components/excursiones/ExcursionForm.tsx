'use client'

/**
 * Formulario de excursión (crear y editar). Al CREAR pide además el precio base (que nace como variante «Estándar»); al editar,
 * los precios viven en el editor de variantes. El servidor revalida todo (`leerExcursionDeFormulario` y `validarExcursion`).
 *
 * Auditoría admin · fase 7 (7.2): eran 1 641 líneas en un solo componente. Esto es el contenedor: guarda lo que se va llenando,
 * deriva lo de un combo, manda el formulario y lleva el foco al primer campo con error. Cada sección es un componente en
 * `./excursion/`; el estado y las cuentas del combo, un hook; y lo que se decide sin navegador, `catalogo/formulario.ts`.
 * Los campos de texto ahora son CONTROLADOS: antes eran de valor inicial, y React los reiniciaba al fallar la acción, así que un
 * error del servidor borraba lo escrito.
 */

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { crearExcursion, actualizarExcursion, type CatalogoActionState } from '@/modules/excursiones/catalogo/actions'
import { calcularHoraRegreso } from '@/modules/excursiones/catalogo/nucleo'
import {
  agregarHoraSalida,
  ahorroDeCombo,
  alternarDia,
  claveDeCombo,
  derivarDeCombo,
  diasDePreset,
  duracionEnMinutos,
  horariosDataJson,
  quitarHoraSalida,
  sumaDePrecios,
  TODOS_LOS_DIAS,
  type ActividadParaComboItem,
  type TipoItem,
} from '@/modules/excursiones/catalogo/formulario'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExcursionImagenUpload } from './ExcursionImagenUpload'
import { ComboActividades } from './excursion/ComboActividades'
import { SeccionGeneral } from './excursion/SeccionGeneral'
import { SeccionHorarios } from './excursion/SeccionHorarios'
import { SeccionPrecios } from './excursion/SeccionPrecios'
import { SeccionIncluye, SeccionUbicacion } from './excursion/SeccionTextos'
import { useCombo } from './excursion/useCombo'
import type { ExcursionEditable, ValoresExcursion } from './excursion/tipos'

export type { ExcursionEditable } from './excursion/tipos'
export type { ActividadParaComboItem } from '@/modules/excursiones/catalogo/formulario'

const init: CatalogoActionState = {}

function valoresIniciales(excursion: ExcursionEditable | undefined, monedaDefecto: string): ValoresExcursion {
  return {
    nombre: excursion?.nombre ?? '',
    descripcion: excursion?.descripcion ?? '',
    categoria: excursion?.categoria ?? '',
    // Al crear arranca en 30; al editar, lo que tenga (si no tiene capacidad declarada se queda vacía, no se inventa una).
    capacidad: excursion ? String(excursion.capacidad ?? '') : '30',
    ubicacion: excursion?.ubicacion ?? '',
    puntoSalida: excursion?.puntoSalida ?? '',
    incluye: excursion?.incluye ?? '',
    noIncluye: excursion?.noIncluye ?? '',
    politicas: excursion?.politicas ?? '',
    moneda: excursion ? excursion.moneda : monedaDefecto || 'DOP',
    impuestoPct: excursion?.impuestoPct != null ? String(excursion.impuestoPct) : '',
    precioAdulto: '',
    precioNino: '',
    precioResidente: '',
    precioNinoResidente: '',
  }
}

export function ExcursionForm({
  companyId,
  excursion,
  actividadesDisponibles = [],
  monedaDefecto = 'DOP',
}: {
  companyId: string
  excursion?: ExcursionEditable
  actividadesDisponibles?: ActividadParaComboItem[]
  monedaDefecto?: string
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState(excursion ? actualizarExcursion : crearExcursion, init)

  const [tipoItem, setTipoItem] = useState<TipoItem>(() =>
    excursion?.tipoItem === 'COMBO' ? 'COMBO' : excursion?.tipoItem === 'PASE_DIA' ? 'PASE_DIA' : 'ACTIVIDAD'
  )
  const [v, setV] = useState<ValoresExcursion>(() => valoresIniciales(excursion, monedaDefecto))
  const poner = (cambios: Partial<ValoresExcursion>) => setV((previo) => ({ ...previo, ...cambios }))

  const combo = useCombo({ excursion, actividadesDisponibles, tipoItem })

  const [duracionHoras, setDuracionHoras] = useState<number>(() => (excursion?.duracionMin ? Number((excursion.duracionMin / 60).toFixed(1)) : 3))
  const [horasSalida, setHorasSalida] = useState<string[]>(() => {
    if (excursion?.horarios && excursion.horarios.length > 0) {
      return Array.from(new Set(excursion.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort()
    }
    if (excursion?.horaSalida) return [excursion.horaSalida.trim().slice(0, 5)]
    return ['09:00']
  })
  const [diasSeleccionados, setDiasSeleccionados] = useState<number[]>(() => {
    if (excursion?.horarios && excursion.horarios.length > 0) {
      const todos = new Set<number>()
      for (const h of excursion.horarios) if (Array.isArray(h.diasSemana)) h.diasSemana.forEach((d) => todos.add(Number(d)))
      if (todos.size > 0) return Array.from(todos).sort()
    }
    return [...TODOS_LOS_DIAS]
  })
  const [nuevaHora, setNuevaHora] = useState('14:00')

  /**
   * Días, horas y duración de un COMBO se derivan de sus actividades. La clave se arma con el CONTENIDO, no con la referencia:
   * mientras el contenido no cambie, no se rederiva nada (antes un efecto con arreglos nuevos en cada render PISABA lo que el
   * administrador acababa de escribir). Y el ajuste va en el render, que es donde React quiere el estado derivado.
   */
  const clave = claveDeCombo({
    tipoItem,
    actividadIds: combo.actividadesSeleccionadas.map((a) => a.id),
    diasComunes: combo.diasComunes,
    combinaciones: combo.combinaciones,
    bloques: combo.itinerario.itinerario,
  })
  const [derivadoDe, setDerivadoDe] = useState<string | null>(null)
  if (clave && clave !== derivadoDe) {
    setDerivadoDe(clave)
    if (combo.diasComunes.length > 0) setDiasSeleccionados(combo.diasComunes)
    const derivado = derivarDeCombo(combo.actividadesSeleccionadas, combo.horarioFijo)
    if (derivado.duracionHoras !== null) setDuracionHoras(derivado.duracionHoras)
    if (derivado.primeraHora !== null) setHorasSalida([derivado.primeraHora])
  }

  const duracionMin = duracionEnMinutos(duracionHoras)
  const primeraHoraSalida = horasSalida[0] || '09:00'
  const primeraHoraRegreso = calcularHoraRegreso(primeraHoraSalida, duracionMin) || ''
  const horariosJson = useMemo(() => horariosDataJson(horasSalida, diasSeleccionados), [horasSalida, diasSeleccionados])

  // Lo que ofrece el combo al fijar su precio: la suma de sus actividades y cuánto ahorra el cliente.
  const resumenCombo = useMemo(() => {
    if (tipoItem !== 'COMBO') return null
    const suma = sumaDePrecios(combo.actividadesSeleccionadas)
    return suma ? { ...suma, ahorro: ahorroDeCombo(suma, v.precioAdulto) } : null
  }, [tipoItem, combo.actividadesSeleccionadas, v.precioAdulto])

  const agregarHora = (hora: string) => setHorasSalida((previas) => agregarHoraSalida(previas, hora))
  const quitarHora = (hora: string) => {
    const r = quitarHoraSalida(horasSalida, hora)
    if (r.error) toast.error(r.error)
    else setHorasSalida(r.horas)
  }
  const alternarDiaSemana = (dia: number) => {
    const r = alternarDia(diasSeleccionados, dia)
    if (r.error) toast.error(r.error)
    else setDiasSeleccionados(r.dias)
  }

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      if (state.excursionId) router.replace(`/admin/excursiones/catalogo/${state.excursionId}`)
      else router.refresh()
    }
  }, [state, router])

  // Con errores por campo, el foco va al primero: el campo con `aria-invalid` o, en un grupo, su primer botón o casilla.
  useEffect(() => {
    if (!state.campos || Object.keys(state.campos).length === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalido="true"] button, [data-invalido="true"] input')?.focus()
  }, [state])

  const errores = state.campos ?? {}
  const comboInvalido = tipoItem === 'COMBO' && (!combo.itinerario.ok || combo.seleccionadas.length < 2 || combo.diasComunes.length === 0)

  return (
    <form ref={formRef} action={formAction} className="space-y-8">
      {excursion ? <input type="hidden" name="excursionId" value={excursion.id} /> : null}

      {/* Lo calculado o elegido con botones. Lo demás lleva su `name` en su campo. */}
      <input type="hidden" name="duracionMin" value={tipoItem === 'PASE_DIA' ? '' : duracionMin} />
      <input type="hidden" name="horaSalida" value={tipoItem === 'PASE_DIA' ? '' : primeraHoraSalida} />
      <input type="hidden" name="horaRegreso" value={tipoItem === 'PASE_DIA' ? '' : primeraHoraRegreso} />
      <input type="hidden" name="horariosData" value={horariosJson} />
      {tipoItem === 'PASE_DIA' && diasSeleccionados.map((d) => <input key={d} type="hidden" name="diasSemanaPaseDia" value={d} />)}
      <input type="hidden" name="comboActividadesHorarios" value={JSON.stringify(combo.horariosPorActividad)} />
      <input type="hidden" name="comboPermitirSolapamiento" value={JSON.stringify(combo.permitirSolapamiento)} />
      <input type="hidden" name="comboHorarioFijo" value={JSON.stringify(combo.horarioFijo)} />

      <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h3 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <ImageIcon className="h-5 w-5 text-primary" aria-hidden />
          Imágenes de la excursión
        </h3>
        <ExcursionImagenUpload
          companyId={companyId}
          excursionId={excursion?.id ?? null}
          currentPortadaUrl={excursion?.portadaUrl ?? null}
          currentGaleria={excursion?.galeria ?? null}
        />
      </div>

      <SeccionGeneral
        v={v}
        poner={poner}
        errores={errores}
        tipoItem={tipoItem}
        alCambiarTipo={setTipoItem}
        combo={<ComboActividades combo={combo} actividadesDisponibles={actividadesDisponibles} duracionHoras={duracionHoras} error={errores.actividadesComboIds} />}
      />

      <SeccionHorarios
        tipoItem={tipoItem}
        duracionHoras={duracionHoras}
        alCambiarDuracion={setDuracionHoras}
        horasSalida={horasSalida}
        alAgregarHora={agregarHora}
        alQuitarHora={quitarHora}
        nuevaHora={nuevaHora}
        alCambiarNuevaHora={setNuevaHora}
        dias={diasSeleccionados}
        alAlternarDia={alternarDiaSemana}
        alElegirPreset={(tipo) => setDiasSeleccionados(diasDePreset(tipo))}
        error={errores.horasSalida}
      />

      <SeccionPrecios v={v} poner={poner} errores={errores} editando={Boolean(excursion)} resumenCombo={resumenCombo} />
      <SeccionUbicacion v={v} poner={poner} errores={errores} />
      <SeccionIncluye v={v} poner={poner} errores={errores} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {tipoItem === 'COMBO' && !combo.itinerario.ok ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">⚠️ No se puede guardar el combo: {combo.itinerario.error}</AlertDescription>
        </Alert>
      ) : null}

      {tipoItem === 'COMBO' && combo.seleccionadas.length >= 2 && combo.diasComunes.length === 0 ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">
            ⚠️ No se puede guardar el combo: Las actividades seleccionadas no comparten ningún día operativo en común.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col items-center justify-end gap-3 pt-2 sm:flex-row">
        <Button type="submit" disabled={pending || comboInvalido} className="h-12 w-full gap-2 rounded-xl px-8 text-sm font-bold shadow-sm sm:w-auto sm:text-base">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
          {excursion ? 'Guardar cambios' : 'Crear y publicar excursión'}
        </Button>
      </div>
    </form>
  )
}
