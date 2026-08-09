'use client'

import { useActionState, useState } from 'react'
import { Check, MapPin } from 'lucide-react'
import {
  SelectorUbicacionVivienda,
  UBICACION_SELECCIONADA_VACIA,
  type UbicacionSeleccionada,
} from '@/components/geo/SelectorUbicacionVivienda'
import {
  guardarUbicacionVivienda,
  type UbicacionActionState,
} from '@/modules/geo/ubicaciones/actions'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * Cambiar la vivienda desde el perfil.
 *
 * Reutiliza EL MISMO selector del registro, no una versión reducida: si la
 * división territorial se comporta distinto según dónde la abras, aprender a
 * usarla una vez no sirve para la otra. Y arreglar un fallo obligaría a
 * arreglarlo dos veces.
 *
 * Arranca plegado: cambiar de casa es raro, y un selector de cuatro pasos
 * desplegado permanentemente empujaría hacia abajo todo lo demás del perfil.
 */
export function UbicacionViviendaForm({ zonaActual }: { zonaActual: string | null }) {
  const [abierto, setAbierto] = useState(false)
  const [ubicacion, setUbicacion] = useState<UbicacionSeleccionada>(UBICACION_SELECCIONADA_VACIA)
  const [estado, enviar, pendiente] = useActionState<UbicacionActionState, FormData>(
    guardarUbicacionVivienda,
    {}
  )

  // Confirmación EN SITIO en vez de cerrar solo. Cerrar el formulario desde un
  // efecto al recibir la respuesta obliga a escribir estado dentro de un
  // efecto —cascada de renders— y además hace desaparecer lo que la persona
  // estaba mirando justo cuando confirma. Aquí ve el resultado y decide.
  if (estado.ok) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-small">
          <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
          <span className="text-foreground">Guardamos tu ubicación.</span>
        </p>
        <Button variant="outline" onClick={() => setAbierto(false)}>
          Listo
        </Button>
      </div>
    )
  }

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-small">
          <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          {zonaActual ? (
            <span className="truncate text-foreground">{zonaActual}</span>
          ) : (
            <span className="text-muted-foreground">Todavía no has guardado tu vivienda.</span>
          )}
        </p>
        <Button variant="outline" onClick={() => setAbierto(true)}>
          {zonaActual ? 'Cambiar' : 'Añadir vivienda'}
        </Button>
      </div>
    )
  }

  return (
    <form action={enviar} className="space-y-4">
      {estado.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{estado.error}</AlertDescription>
        </Alert>
      )}

      <SelectorUbicacionVivienda
        value={ubicacion}
        onChange={setUbicacion}
        onDone={() => {}}
      />

      {/* El selector es controlado y no emite campos: los serializa quien lo
          usa. Van ocultos aquí con los MISMOS nombres que espera
          `leerUbicacionDeForm`, el parser que ya valida el registro. */}
      <input type="hidden" name="geoCountryId" value={ubicacion.countryId} />
      <input type="hidden" name="geoRegionId" value={ubicacion.regionId} />
      <input type="hidden" name="geoRegionName" value={ubicacion.regionNameRaw} />
      <input type="hidden" name="geoCityId" value={ubicacion.cityId} />
      <input type="hidden" name="geoCityName" value={ubicacion.cityNameRaw} />
      <input type="hidden" name="geoSectorId" value={ubicacion.sectorId} />
      <input type="hidden" name="geoSectorName" value={ubicacion.sectorNameRaw} />
      <input type="hidden" name="geoLat" value={ubicacion.latitud} />
      <input type="hidden" name="geoLng" value={ubicacion.longitud} />
      <input type="hidden" name="geoSource" value={ubicacion.geoSource} />
      <input
        type="hidden"
        name="geoConsentHome"
        value={ubicacion.consentHome ? 'on' : 'off'}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pendiente}>
          Guardar ubicación
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
