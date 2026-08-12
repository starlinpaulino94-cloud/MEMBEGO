'use client'

/**
 * Centro de las empresas de DEMOSTRACIÓN.
 *
 * Tres cosas por empresa, y en este orden por una razón:
 *   1. EL ENLACE, arriba y copiable de un toque. Es lo que se usa cada vez que
 *      empieza un entrenamiento; todo lo demás se usa una vez al mes.
 *   2. Reiniciar, con confirmación escrita y el inventario de lo que se lleva
 *      por delante a la vista ANTES de escribirla.
 *   3. Convertir en real, la operación rara, la última y la que puede negarse.
 */

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Check, Copy, FlaskConical, Loader2, RotateCcw, ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { marcarComoDemo, reiniciarDemo, type DemoState } from '@/modules/demo/actions'
import {
  darAccesoAEmpresa,
  quitarAccesoAEmpresa,
  type AccesoState,
} from '@/modules/empresas/accesosActions'
import type { InventarioDemo } from '@/modules/demo'
import type { AccesoEmpresa, AdminVinculable } from '@/modules/empresas/accesos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { desdeHace, plural } from '@/lib/plural'

export interface EmpresaDemoUI {
  id: string
  name: string
  slug: string
  enlaceRegistro: string
  inventario: InventarioDemo
  /** Milisegundos desde el primer dato de práctica; `null` = está limpia. */
  desdePrimerDato: number | null
  /** Último reinicio: cuánto hace y quién. `null` = nunca se reinició. */
  ultimoReinicio: { hace: number; quien: string | null } | null
  /** Quién puede entrar hoy a esta empresa de práctica. */
  accesos: AccesoEmpresa[]
}

const init: DemoState = {}

function Enviar({ children, variant }: { children: React.ReactNode; variant?: 'destructive' | 'outline' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}

export function DemoPanel({
  empresas,
  admins,
}: {
  empresas: EmpresaDemoUI[]
  admins: AdminVinculable[]
}) {
  if (empresas.length === 0) {
    return (
      <Card className="border-border/60 shadow-card">
        <CardContent className="py-10 text-center">
          <FlaskConical className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">Todavía no hay empresas de práctica.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Crea una y compártele el enlace de registro a tu personal: podrán hacer el recorrido
            completo —registrar clientes, vender, cobrar, canjear— sin que nada de eso sea real.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {empresas.map((e) => (
        <TarjetaDemo key={e.id} e={e} admins={admins} />
      ))}
    </div>
  )
}

function TarjetaDemo({ e, admins }: { e: EmpresaDemoUI; admins: AdminVinculable[] }) {
  const [reinicio, accionReinicio] = useActionState(reiniciarDemo, init)
  const [marca, accionMarca] = useActionState(marcarComoDemo, init)

  useEffect(() => {
    if (reinicio.success) toast.success(reinicio.mensaje ?? 'Empresa reiniciada.')
    if (reinicio.error) toast.error(reinicio.error)
  }, [reinicio])

  useEffect(() => {
    if (marca.success) toast.success(marca.mensaje ?? 'Marca actualizada.')
    if (marca.error) toast.error(marca.error)
  }, [marca])

  const total = Object.values(e.inventario).reduce((s, n) => s + n, 0)

  return (
    <Card className="border-warning/30 shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical aria-hidden className="h-4 w-4 text-warning" />
          {e.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EnlaceRegistro url={e.enlaceRegistro} />

        <QuienEntra empresaId={e.id} accesos={e.accesos} admins={admins} />

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Datos de práctica acumulados
          </p>
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">Limpia — lista para el siguiente grupo.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {(
                [
                  ['clientes', ['cliente', 'clientes']],
                  ['membresias', ['membresía', 'membresías']],
                  ['compras', ['compra', 'compras']],
                  ['transacciones', ['cobro', 'cobros']],
                  ['colaVehiculos', ['vehículo en pista', 'vehículos en pista']],
                  ['incidencias', ['incidencia', 'incidencias']],
                  ['turnos', ['turno', 'turnos']],
                ] as [keyof InventarioDemo, [string, string]][]
              )
                .filter(([k]) => e.inventario[k] > 0)
                .map(([k, etiqueta]) => (
                  <li
                    key={k}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {plural(e.inventario[k], etiqueta[0], etiqueta[1])}
                  </li>
                ))}
            </ul>
          )}
          {/* CUÁNTO no es lo mismo que DESDE CUÁNDO: «1 cliente» no distingue el
              rastro de ayer del de hace tres meses, y de eso depende si hay que
              reiniciar antes del próximo grupo. */}
          {e.desdePrimerDato !== null && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Acumulando desde {desdeHace(e.desdePrimerDato)}.
            </p>
          )}
          {/* Una empresa de práctica la comparten varios instructores. Sin esto,
              «¿está limpia porque la reinicié yo o porque nadie la ha usado?» no
              se puede contestar — y el dato ya estaba en la bitácora. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {e.ultimoReinicio
              ? `Último reinicio ${desdeHace(e.ultimoReinicio.hace)}${
                  e.ultimoReinicio.quien ? ` · ${e.ultimoReinicio.quien}` : ''
                }.`
              : 'Nunca se ha reiniciado.'}
          </p>
        </div>

        {/* Reiniciar */}
        <form action={accionReinicio} className="space-y-2 rounded-xl border border-border/70 p-3">
          <input type="hidden" name="companyId" value={e.id} />
          <p className="text-sm font-medium text-foreground">Dejarla lista para el siguiente grupo</p>
          <p className="text-xs text-muted-foreground">
            Borra {plural(total, 'registro', 'registros')} de práctica de los de arriba. Conserva la
            configuración: planes, promociones, servicios, precios, empleados y capacidades se
            quedan como están.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              name="confirmacion"
              placeholder="Escribe REINICIAR"
              className="h-9 max-w-[190px]"
              autoComplete="off"
            />
            <Enviar variant="destructive">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reiniciar
            </Enviar>
          </div>
        </form>

        {/*
          CONVERTIR EN REAL — LA FRICCIÓN ESTABA EN LA ACCIÓN EQUIVOCADA.

          Reiniciar, que borra datos INVENTADOS, pedía escribir una palabra.
          Convertir en real —que saca la empresa del sandbox, la habilita para
          cobros de verdad y hace que sus números empiecen a contar— era un solo
          clic. La operación reversible pedía teclear; la irreversible, nada.

          Ahora pide el NOMBRE de la empresa, no una palabra genérica: con dos
          tarjetas abiertas, «CONVERTIR» sirve para cualquiera de las dos y el
          nombre solo para esta. Y el botón se DESHABILITA cuando todavía hay
          datos: antes se podía pulsar y siempre fallaba con un aviso, que hace
          dudar de si el error es tuyo.
        */}
        <form action={accionMarca} className="space-y-2 rounded-xl border border-border/70 p-3">
          <input type="hidden" name="companyId" value={e.id} />
          <input type="hidden" name="activar" value="0" />
          <p className="text-sm font-medium text-foreground">Convertirla en empresa real</p>
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? 'Dejará de ser de práctica: sus números pasarán a contar en las estadísticas de la plataforma y podrá publicarse y cobrar de verdad. No se deshace desde aquí.'
              : `Primero hay que reiniciarla: con ${plural(total, 'registro', 'registros')} de práctica dentro, esos datos inventados pasarían a contar como reales.`}
          </p>
          {total === 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                name="confirmacion"
                placeholder={`Escribe ${e.name}`}
                className="h-9 max-w-[240px]"
                autoComplete="off"
                aria-label={`Escribe ${e.name} para confirmar`}
              />
              <Enviar variant="outline">
                <ShieldCheck className="mr-1.5 h-4 w-4" /> Convertir en real
              </Enviar>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

const initAcceso: AccesoState = {}

/**
 * Quién puede entrar a la empresa de práctica.
 *
 * No se entra con una segunda cuenta: se le da acceso a la cuenta que la
 * persona YA usa, y el modo de prueba queda como una empresa más en el
 * selector de arriba de su panel. Entra, practica y vuelve a su negocio con
 * dos clics, sin cerrar sesión ni recordar otra contraseña.
 *
 * Se agrega y se quita de a uno. La pantalla de Usuarios permite reasignar
 * todas las empresas de una persona de golpe, pero ahí una casilla
 * desmarcada por accidente le quita el acceso a un negocio real.
 */
function QuienEntra({
  empresaId,
  accesos,
  admins,
}: {
  empresaId: string
  accesos: AccesoEmpresa[]
  admins: AdminVinculable[]
}) {
  const [dar, accionDar] = useActionState(darAccesoAEmpresa, initAcceso)
  const [quitar, accionQuitar] = useActionState(quitarAccesoAEmpresa, initAcceso)

  useEffect(() => {
    if (dar.success) toast.success(dar.mensaje ?? 'Acceso concedido.')
    if (dar.error) toast.error(dar.error)
  }, [dar])

  useEffect(() => {
    if (quitar.success) toast.success(quitar.mensaje ?? 'Acceso retirado.')
    if (quitar.error) toast.error(quitar.error)
  }, [quitar])

  const yaTienen = new Set(accesos.map((a) => a.userId))
  const disponibles = admins.filter((a) => !yaTienen.has(a.id))

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Quién puede entrar al modo de prueba
      </p>

      {accesos.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">
          Nadie todavía. Agrega abajo a un administrador que ya use la plataforma.
        </p>
      ) : (
        <ul className="mb-2 space-y-1">
          {accesos.map((a) => (
            <li
              key={a.userId}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {a.name}
                  {a.activaAhora && (
                    <span className="text-overline ml-2 rounded-full bg-warning/20 px-2 py-0.5 text-warning">
                      dentro ahora
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
              </span>
              <form action={accionQuitar} className="shrink-0">
                <input type="hidden" name="companyId" value={empresaId} />
                <input type="hidden" name="userId" value={a.userId} />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label={`Quitar el acceso de ${a.name}`}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {disponibles.length > 0 && (
        <form action={accionDar} className="flex gap-2">
          <input type="hidden" name="companyId" value={empresaId} />
          <select
            name="userId"
            required
            defaultValue=""
            aria-label="Administrador al que dar acceso"
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="" disabled>
              Agregar administrador…
            </option>
            {disponibles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.email}
                {a.empresa ? ` (${a.empresa})` : ''}
              </option>
            ))}
          </select>
          <Enviar variant="outline">
            <UserPlus className="mr-1.5 h-4 w-4" /> Dar acceso
          </Enviar>
        </form>
      )}
    </div>
  )
}

/**
 * El enlace, en grande y copiable.
 *
 * El texto se guarda en estado y el "Copiado" se apaga solo: sin la
 * confirmación visible, en un celular no hay forma de saber si el toque
 * funcionó, y la gente lo copia tres veces.
 */
function EnlaceRegistro({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar. Selecciona el enlace a mano.')
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Enlace de registro para el entrenamiento
      </p>
      <div className="flex gap-2">
        {/* `break-all` y no `truncate`: truncado, en un móvil no se ve a qué
            empresa apunta el enlace, que es justo lo que hay que comprobar antes
            de mandárselo a un grupo. Parte en dos líneas y se lee entero. */}
        <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
          {url}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copiar}
          className="h-9 shrink-0"
          aria-label={copiado ? 'Enlace copiado' : 'Copiar el enlace de registro'}
        >
          {copiado ? (
            <Check aria-hidden className="h-4 w-4 text-success" />
          ) : (
            <Copy aria-hidden className="h-4 w-4" />
          )}
        </Button>
      </div>
      {/* Para quien no ve la pantalla: el icono que cambia no dice nada. */}
      <span aria-live="polite" className="sr-only">
        {copiado ? 'Enlace copiado al portapapeles' : ''}
      </span>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Quien se registre por aquí es un cliente de práctica: sus datos y sus cobros existen solo
        dentro de esta empresa.
      </p>
    </div>
  )
}
