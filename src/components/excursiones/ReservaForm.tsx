'use client'

/**
 * EXCURSIONES · Formulario de alta de reserva (panel de administración).
 *
 * Auditoría admin · fase 7 (7.2): eran 1 371 líneas en un solo componente. Esto es el contenedor: guarda lo que se va llenando,
 * ajusta lo derivado (variante, turno y hora cuando cambia la excursión), manda el formulario y lleva el foco al primer campo con
 * error. Cada paso es un componente en `./reserva/`, y lo que se decide sin navegador (fechas, itinerario del combo, importes,
 * lectura del formulario, búsqueda de cliente) vive en `modules/excursiones/reservas/formulario.ts`, con sus pruebas.
 *
 * Una regla que sale de un defecto real: lo que la acción lee tiene que viajar con un `name`. La fecha no viajaba y no se podía
 * crear ninguna reserva desde aquí; ahora cada control lleva su nombre y una prueba compara lo que lee la acción con lo que
 * manda el formulario.
 */

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { buscarClientes, crearReserva, type ReservaActionState } from '@/modules/excursiones/reservas/actions'
import {
  claveItinerario,
  combinacionesDeCombo,
  hoyISO,
  itinerarioInicial,
  resumenDeReserva,
  serializarItinerarioCombo,
  type ExcursionOpcion,
  type VendedorOpcion,
} from '@/modules/excursiones/reservas/formulario'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PasoExcursion } from './reserva/PasoExcursion'
import { PasoModalidad } from './reserva/PasoModalidad'
import { PasoFechaPasajeros } from './reserva/PasoFechaPasajeros'
import { PasoCliente } from './reserva/PasoCliente'
import { PasoComercial } from './reserva/PasoComercial'
import { PasoLogistica } from './reserva/PasoLogistica'
import { ResumenReserva } from './reserva/ResumenReserva'
import type { ValoresReserva } from './reserva/tipos'

// `ReservaVendedorForm` (portal del vendedor) importa estos tipos de aquí.
export type { ClienteOpcion, ExcursionOpcion, VendedorOpcion } from '@/modules/excursiones/reservas/formulario'

const init: ReservaActionState = {}

function valoresIniciales(excursiones: ExcursionOpcion[], hayClientes: boolean): ValoresReserva {
  const primera = excursiones[0]
  return {
    busquedaExcursion: '',
    excursionId: primera?.id ?? '',
    varianteId: primera?.variantes[0]?.id ?? '',
    hora: primera?.horarios?.[0]?.horaSalida ?? '',
    fecha: hoyISO(),
    adultos: 2,
    ninos: 0,
    descuento: '',
    vendedorId: '',
    canal: 'MOSTRADOR',
    modoCombo: 'MISMO_DIA',
    turnoCombo: '',
    itinerario: {},
    // Con clientes en la empresa se arranca BUSCANDO uno; sin ninguno, pidiendo los datos del primero.
    modoCliente: hayClientes ? 'EXISTENTE' : 'NUEVO',
    cliente: null,
    clienteNombre: '',
    clienteEmail: '',
    clienteTelefono: '',
    mostrarLogistica: false,
    voucherAgencia: '',
    hotelRecogida: '',
    lobbyRecogida: '',
    horaRecogida: '',
    habitacion: '',
    notas: '',
  }
}

export function ReservaForm({
  excursiones,
  vendedores = [],
  hayClientes = true,
}: {
  excursiones: ExcursionOpcion[]
  vendedores?: VendedorOpcion[]
  /** ¿La empresa tiene clientes? Decide si arranca buscando uno o pidiendo los datos de uno nuevo. */
  hayClientes?: boolean
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState(crearReserva, init)
  const [v, setV] = useState<ValoresReserva>(() => valoresIniciales(excursiones, hayClientes))
  const poner = (cambios: Partial<ValoresReserva>) => setV((previo) => ({ ...previo, ...cambios }))

  const excursion = useMemo(() => excursiones.find((e) => e.id === v.excursionId) ?? excursiones[0], [excursiones, v.excursionId])
  const variante = useMemo(() => excursion?.variantes.find((x) => x.id === v.varianteId) ?? excursion?.variantes[0], [excursion, v.varianteId])
  const esCombo = excursion?.tipoItem === 'COMBO' && Boolean(excursion?.comboItems && excursion.comboItems.length > 0)
  const combinaciones = useMemo(() => (esCombo ? combinacionesDeCombo(excursion?.comboItems) : []), [esCombo, excursion])

  /**
   * AJUSTES EN RENDER, NO EN EFECTOS. Cuando la excursión cambia y la variante, el turno o la hora elegidos ya no existen en la
   * nueva, se cae al primero disponible. Un efecto pintaba antes un render con un valor inválido (el precio de una variante que
   * ya no está); React documenta el ajuste durante el render para esto y converge solo: en cuanto el valor pertenece a la lista,
   * la condición es falsa. Son las mismas condiciones que tenían los efectos.
   */
  if (esCombo && combinaciones.length > 0 && (!v.turnoCombo || !combinaciones.some((c) => c.id === v.turnoCombo))) {
    poner({ turnoCombo: combinaciones[0].id, hora: combinaciones[0].horaInicio })
  }
  if (excursion && !excursion.variantes.find((x) => x.id === v.varianteId)) {
    poner({ varianteId: excursion.variantes[0]?.id ?? '' })
  }
  if (excursion && !excursion.horarios?.find((h) => h.horaSalida === v.hora)) {
    poner({ hora: excursion.horarios?.[0]?.horaSalida ?? '' })
  }

  // El itinerario por días se rearma cuando cambia la fecha o el combo (por identidad, no por referencia: ver `claveItinerario`).
  const clave = claveItinerario(esCombo, excursion?.comboItems, v.fecha)
  const [armadoPara, setArmadoPara] = useState<string | null>(null)
  if (clave && clave !== armadoPara && excursion?.comboItems) {
    setArmadoPara(clave)
    poner({ itinerario: itinerarioInicial(excursion.comboItems, v.fecha) })
  }

  const porDias = esCombo && v.modoCombo === 'DIAS_DIFERENTES'
  // Un combo por días separados no tiene UNA fecha: la reserva se fecha con la primera actividad.
  const fechaReserva = useMemo(() => {
    if (!porDias || !excursion?.comboItems) return v.fecha
    const fechas = excursion.comboItems.map((ci) => v.itinerario[ci.id]?.fecha ?? v.fecha).sort()
    return fechas[0] ?? v.fecha
  }, [porDias, excursion, v.itinerario, v.fecha])

  const comboItinerarioJson = useMemo(
    () =>
      serializarItinerarioCombo({
        comboItems: excursion?.comboItems,
        esCombo,
        modo: v.modoCombo,
        itinerario: v.itinerario,
        fecha: v.fecha,
        combinaciones,
        turnoId: v.turnoCombo,
      }),
    [excursion, esCombo, v.modoCombo, v.itinerario, v.fecha, combinaciones, v.turnoCombo]
  )

  const importes = useMemo(
    () =>
      resumenDeReserva({
        variante,
        impuestoPct: excursion?.impuestoPct,
        fecha: fechaReserva,
        hora: v.hora,
        adultos: v.adultos,
        ninos: v.ninos,
        descuento: v.descuento,
      }),
    [variante, excursion, fechaReserva, v.hora, v.adultos, v.ninos, v.descuento]
  )

  // Reserva creada: aviso y a su ficha.
  useEffect(() => {
    if (state.creada) {
      toast.success(state.success ?? 'Reserva creada con éxito.')
      router.push(`/admin/excursiones/reservas/${state.creada.reservaId}`)
      router.refresh()
    }
  }, [state, router])

  // Con errores por campo, el foco va al primero: el campo con `aria-invalid` o, en un grupo de opciones, su primer botón.
  useEffect(() => {
    if (!state.campos || Object.keys(state.campos).length === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalido="true"] button, [data-invalido="true"] input')?.focus()
  }, [state])

  if (excursiones.length === 0 || !excursion) {
    return (
      <Alert>
        <AlertDescription>
          Para crear una reserva hace falta al menos una excursión activa con una variante con precio. Créala en el catálogo de excursiones y vuelve aquí.
        </AlertDescription>
      </Alert>
    )
  }

  const errores = state.campos ?? {}
  // Si hay errores por campo, el resumen dice cuántos; si el error no es de un campo (cupos, precios…), dice cuál es.
  const errorGeneral = state.error

  return (
    <form ref={formRef} action={formAction} className="w-full min-w-0 max-w-full space-y-6">
      {/* Lo que no tiene un control propio: lo elegido con botones o calculado. Lo demás lleva su `name` en su campo. */}
      <input type="hidden" name="excursionId" value={v.excursionId} />
      <input type="hidden" name="varianteId" value={v.varianteId} />
      <input type="hidden" name="hora" value={v.hora} />
      <input type="hidden" name="adultos" value={v.adultos} />
      <input type="hidden" name="ninos" value={v.ninos} />
      <input type="hidden" name="comboItinerarioJson" value={comboItinerarioJson} />
      {/* El campo de fecha se muestra salvo en un combo por días separados: ahí la fecha es la de la primera actividad. */}
      {porDias && <input type="hidden" name="fecha" value={fechaReserva} />}

      <div className="grid w-full min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="w-full min-w-0 space-y-6 lg:col-span-2">
          <PasoExcursion v={v} poner={poner} errores={errores} excursiones={excursiones} />
          <PasoModalidad v={v} poner={poner} errores={errores} excursion={excursion} esCombo={esCombo} combinaciones={combinaciones} />
          <PasoFechaPasajeros v={v} poner={poner} errores={errores} excursion={excursion} variante={variante} porDias={porDias} />
          <PasoCliente v={v} poner={poner} errores={errores} buscar={buscarClientes} />
          <PasoComercial v={v} poner={poner} errores={errores} vendedores={vendedores} moneda={excursion.moneda} />
          <PasoLogistica v={v} poner={poner} />
        </div>

        <ResumenReserva
          excursion={excursion}
          variante={variante}
          fecha={fechaReserva}
          hora={v.hora}
          adultos={v.adultos}
          ninos={v.ninos}
          importes={importes}
          error={errorGeneral}
          enviando={pending}
        />
      </div>
    </form>
  )
}
