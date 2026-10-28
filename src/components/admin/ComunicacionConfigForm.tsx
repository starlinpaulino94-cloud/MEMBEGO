'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ExternalLink, RotateCcw, Send, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarComunicacionConfig,
  enviarCorreoPrueba,
  type ActionState,
} from '@/modules/soporte/actions'
import {
  MENSAJE_DEFAULT,
  DIAS_SEMANA,
  buildWaLink,
  formatNumeroPreview,
  parseDias,
} from '@/lib/soporte'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { Badge } from '@/components/ui/badge'

interface Existing {
  codigoPais: string
  numero: string
  mensajePlantilla: string
  activo: boolean
  correoSoporte: string | null
  horaInicio: string | null
  horaCierre: string | null
  diasLaborales: string | null
}

const init: ActionState = {}
const VARIABLES = ['{cliente}', '{empresa}', '{membresia}', '{fecha}']

export function ComunicacionConfigForm({
  companyId,
  existing,
}: {
  companyId: string | null
  existing?: Existing
}) {
  const [state, formAction] = useActionState(guardarComunicacionConfig, init)

  const [codigoPais, setCodigoPais] = useState(existing?.codigoPais ?? '+1')
  const [numero, setNumero] = useState(existing?.numero ?? '')
  const [mensaje, setMensaje] = useState(existing?.mensajePlantilla ?? MENSAJE_DEFAULT)
  const [activo, setActivo] = useState(existing?.activo ?? true)
  const [correo, setCorreo] = useState(existing?.correoSoporte ?? '')
  const [dias, setDias] = useState<number[]>(parseDias(existing?.diasLaborales))

  useEffect(() => {
    if (state.success) toast.success('Configuración de Comunicación y Soporte guardada.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  const preview = formatNumeroPreview(codigoPais, numero)
  const waLink = buildWaLink(codigoPais, numero, mensaje)

  function toggleDia(v: number) {
    setDias((prev) =>
      prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v].sort((a, b) => a - b)
    )
  }

  function insertarVariable(variable: string) {
    setMensaje((m) => `${m}${m.endsWith(' ') || m === '' ? '' : ' '}${variable}`)
  }

  return (
    <form action={formAction} className="max-w-3xl space-y-8">
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <input type="hidden" name="activo" value={String(activo)} />
      <input type="hidden" name="diasLaborales" value={dias.join(',')} />

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <FormSection title="Datos de contacto" description="El número de WhatsApp al que te escriben tus clientes.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Campo id="codigoPais" etiqueta="Código de país">
            {(control) => (
              <Input name="codigoPais" value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} inputMode="tel" placeholder="+52" required {...control} />
            )}
          </Campo>
          <Campo id="numero" etiqueta="Número">
            {(control) => (
              <Input
                name="numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="5512345678"
                required
                {...control}
              />
            )}
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">Vista previa:</span>
          <span className="font-mono text-sm font-medium text-foreground">{preview}</span>
          <Button asChild type="button" variant="outline" size="sm" className="ml-auto">
            <a href={waLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Verificar enlace
            </a>
          </Button>
        </div>
      </FormSection>

      <FormSection title="Mensaje predeterminado" description="Lo que ya viene escrito cuando un cliente te abre el chat. Toca una variable para insertarla.">
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map((v) => (
            <Badge
              key={v}
              asChild
              variant="secondary"
              className="cursor-pointer hover:bg-secondary/80"
            >
              <button type="button" onClick={() => insertarVariable(v)}>
                {v}
              </button>
            </Badge>
          ))}
        </div>
        <Campo id="mensajePlantilla" etiqueta="Mensaje">
          {(control) => <Textarea name="mensajePlantilla" value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} placeholder={MENSAJE_DEFAULT} {...control} />}
        </Campo>
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMensaje(MENSAJE_DEFAULT)}>
            <RotateCcw className="mr-2 h-4 w-4" /> Restablecer mensaje
          </Button>
        </div>
      </FormSection>

      <FormSection title="Botón de WhatsApp" description="Si tus clientes lo ven en la aplicación.">
        <div className="flex items-start gap-3">
          <Switch id="activo" checked={activo} onCheckedChange={setActivo} className="mt-0.5" />
          <div>
            <Label htmlFor="activo" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-success" aria-hidden />
              Mostrar botón de WhatsApp en la aplicación
            </Label>
            <p className="mt-0.5 text-caption text-muted-foreground">
              Si está activo, los clientes verán “Contactar por WhatsApp” en el Centro de Ayuda.
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection title="Correo de soporte" description="A dónde llegan los mensajes de soporte. Envía uno de prueba para comprobarlo.">
        <Campo id="correoSoporte" etiqueta="Correo electrónico de soporte" opcional>
          {(control) => (
            <div className="flex flex-wrap gap-2">
              <Input
                name="correoSoporte"
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="soporte@empresa.com"
                className="max-w-sm"
                {...control}
              />
              <TestEmailButton />
            </div>
          )}
        </Campo>
      </FormSection>

      <FormSection title="Horario de atención" description="Cuándo atiendes. Se muestra al cliente en el Centro de Ayuda.">
        <div className="grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="horaInicio" etiqueta="Hora de inicio">
            {(control) => <Input name="horaInicio" type="time" defaultValue={existing?.horaInicio ?? '09:00'} {...control} />}
          </Campo>
          <Campo id="horaCierre" etiqueta="Hora de cierre">
            {(control) => <Input name="horaCierre" type="time" defaultValue={existing?.horaCierre ?? '18:00'} {...control} />}
          </Campo>
        </div>
        <Campo id="diasLaborales" etiqueta="Días laborales" como="grupo">
          {() => (
            <div className="flex flex-wrap gap-2">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={dias.includes(d.value)}
                  onClick={() => toggleDia(d.value)}
                  className={`h-10 w-12 rounded-lg border text-sm font-medium transition ${
                    dias.includes(d.value)
                      ? 'border-success/40 bg-success-soft text-success-ink'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </Campo>
      </FormSection>

      <FormActions>
        <GuardarBoton />
      </FormActions>
    </form>
  )
}

function GuardarBoton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending} className="bg-success hover:bg-success/90">
      Guardar configuración
    </Button>
  )
}

/**
 * «Enviar correo de prueba»: un botón del MISMO formulario con su propia acción (`formAction`), no un `<form>` anidado, que
 * HTML no permite. La acción lee el correo del campo «correoSoporte» del formulario.
 */
function TestEmailButton() {
  const [state, action, pending] = useActionState(enviarCorreoPrueba, init)
  useEffect(() => {
    if (state.success && state.message) toast.success(state.message)
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, state.message])

  return (
    <Button type="submit" formAction={action} variant="outline" loading={pending}>
      {!pending && <Send className="mr-2 h-4 w-4" aria-hidden />}
      Enviar correo de prueba
    </Button>
  )
}
