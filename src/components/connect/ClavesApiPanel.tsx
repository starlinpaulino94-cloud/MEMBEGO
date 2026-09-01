'use client'

import { useActionState, useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import {
  crearClaveAction,
  revocarClaveAction,
  type AccionState,
} from '@/modules/connect/adminActions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { StatusBanner } from '@/components/ui/status-banner'
import { CandadoPlan, LimiteAlcanzado } from '@/components/connect/EstadoPlanConnect'

/**
 * Claves de API de la empresa.
 *
 * LA DECISIÓN QUE MANDA EN ESTA PANTALLA: la clave se enseña UNA vez, y la
 * pantalla lo dice antes y después de crearla. No es una limitación técnica
 * que haya que disculpar — es lo que hace que un volcado de nuestra base no
 * sirva para entrar. Por eso el recuadro de la clave nueva es lo más visible
 * del bloque y trae su botón de copiar al lado.
 */

const INIT: AccionState = {}

/** Permisos que se pueden conceder, en lenguaje de negocio. */
const SCOPES: { valor: string; label: string }[] = [
  { valor: 'customers:read', label: 'Ver clientes' },
  { valor: 'memberships:read', label: 'Ver membresías' },
  { valor: 'benefits:read', label: 'Ver beneficios y su disponibilidad' },
  { valor: 'promotions:read', label: 'Ver promociones' },
  { valor: 'appointments:read', label: 'Ver citas' },
  { valor: 'branches:read', label: 'Ver sucursales' },
]

export interface ClaveVista {
  id: string
  nombre: string
  prefijo: string
  scopes: string[]
  estado: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

function ClaveNueva({ clave }: { clave: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <StatusBanner variant="success" title="Copia la clave ahora: no se puede volver a ver">
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-caption">
          {clave}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            // `writeText` falla en contextos sin permiso (o sin https). Si no
            // se puede copiar, la clave sigue a la vista para seleccionarla a
            // mano: perder el botón no puede significar perder la clave.
            navigator.clipboard
              ?.writeText(clave)
              .then(() => setCopiado(true))
              .catch(() => setCopiado(false))
          }}
        >
          {copiado ? (
            <Check className="mr-2 h-4 w-4" aria-hidden />
          ) : (
            <Copy className="mr-2 h-4 w-4" aria-hidden />
          )}
          {copiado ? 'Copiada' : 'Copiar'}
        </Button>
      </div>
    </StatusBanner>
  )
}

export function ClavesApiPanel({
  claves,
  limite,
}: {
  claves: ClaveVista[]
  /** Null = sin límite. Cero = la empresa no tiene la función concedida. */
  limite: number | null
}) {
  const [estado, crear, creando] = useActionState(crearClaveAction, INIT)
  const [abierto, setAbierto] = useState(false)

  const activas = claves.filter((c) => c.estado === 'ACTIVE').length
  const puedeCrear = limite === null || activas < limite
  // DOS situaciones distintas que antes decían lo mismo, y una de las dos
  // frases era falsa: «tu plan no incluye claves» aparecía también cuando sí
  // las incluía y simplemente estaban todas usadas.
  const sinConcesion = limite === 0
  const lleno = !puedeCrear && !sinConcesion && limite !== null

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Claves de API</CardTitle>
        {puedeCrear ? (
          <Button type="button" size="sm" onClick={() => setAbierto((v) => !v)}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            {abierto ? 'Cancelar' : 'Crear clave'}
          </Button>
        ) : (
          sinConcesion && <CandadoPlan titulo="Las claves de API no están activadas para tu negocio" />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-caption text-muted-foreground">
          Con una clave, herramientas como Zapier o tu propio sistema pueden consultar tus datos.
          Cada clave solo alcanza a esta empresa y solo lo que le concedas.
        </p>

        {estado.claveNueva && <ClaveNueva clave={estado.claveNueva} />}
        {estado.error && (
          <StatusBanner variant="destructive" title="No se pudo crear">
            {estado.error}
          </StatusBanner>
        )}

        {lleno && limite !== null && <LimiteAlcanzado que="claves" limite={limite} />}

        {sinConcesion && claves.length > 0 && (
          <StatusBanner variant="info" title="Las claves de API ya no están activadas">
            Estas claves siguen funcionando y puedes revocarlas, pero no se pueden crear nuevas.
          </StatusBanner>
        )}

        {abierto && puedeCrear && (
          <form action={crear} className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <Label htmlFor="clave-nombre">Nombre</Label>
              <Input
                id="clave-nombre"
                name="nombre"
                placeholder="Zapier de recepción"
                maxLength={120}
                required
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Qué puede consultar</legend>
              {SCOPES.map((s) => (
                <label key={s.valor} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="scopes" value={s.valor} className="h-4 w-4" />
                  {s.label}
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={creando}>
              {creando ? 'Creando…' : 'Crear clave'}
            </Button>
          </form>
        )}

        {claves.length === 0 ? (
          <p className="text-caption text-muted-foreground">Todavía no has creado ninguna clave.</p>
        ) : (
          <ul className="space-y-2">
            {claves.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-xl border border-border/60 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3"
              >
                <span className="font-medium">{c.nombre}</span>
                <code className="break-all font-mono text-caption text-muted-foreground">
                  {c.prefijo}…
                </code>
                <Badge variant={c.estado === 'ACTIVE' ? 'default' : 'outline'}>
                  {c.estado === 'ACTIVE' ? 'Activa' : 'Revocada'}
                </Badge>
                <span className="text-caption text-muted-foreground">
                  {c.lastUsedAt
                    ? `Último uso: ${formatDateTime(new Date(c.lastUsedAt))}`
                    : 'Sin usar todavía'}
                </span>
                {c.estado === 'ACTIVE' && (
                  <span className="sm:ml-auto">
                    <BotonConfirmado
                      accion={revocarClaveAction}
                      estadoInicial={INIT}
                      campos={{ id: c.id }}
                      variant="ghost"
                      size="sm"
                      confirmacion={{
                        titulo: '¿Revocar esta clave?',
                        descripcion:
                          'Lo que la esté usando dejará de funcionar en su próxima llamada. No se puede deshacer: habría que crear una clave nueva.',
                        textoConfirmar: 'Revocar',
                        peligrosa: true,
                      }}
                      mensajeExito="Clave revocada."
                    >
                      Revocar
                    </BotonConfirmado>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
