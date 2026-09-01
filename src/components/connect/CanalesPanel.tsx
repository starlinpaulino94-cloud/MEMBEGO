import { CalendarCheck, CheckCircle2, CircleDashed } from 'lucide-react'
import type { CanalAutomatizacion, EstadoCanal } from '@/modules/connect/canales'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Qué canales funcionan de verdad en esta empresa (Connect · Fase 7).
 *
 * Va ARRIBA del todo en la página, antes que las aplicaciones y las claves.
 * Es lo primero que alguien necesita saber al llegar aquí: no «qué puedo
 * conectar» sino «qué de lo que ya configuré está llegando a mis clientes».
 *
 * Un canal no configurado NO se pinta en rojo. No es un error: es un canal
 * apagado, y muchas empresas no querrán encenderlo nunca. Lo que sí se dice,
 * siempre, es qué hacer para encenderlo — un estado sin salida es una queja,
 * no información.
 */

function Fila({
  nombre,
  estado,
  comoEncenderlo,
  icono,
}: {
  nombre: string
  estado: EstadoCanal
  comoEncenderlo: string
  icono?: React.ReactNode
}) {
  const listo = estado === 'listo'
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-border/60 px-3 py-2">
      <span className={listo ? 'text-success' : 'text-muted-foreground'} aria-hidden>
        {icono ??
          (listo ? <CheckCircle2 className="h-5 w-5" /> : <CircleDashed className="h-5 w-5" />)}
      </span>
      <span className="font-medium">{nombre}</span>
      <span className={`text-caption ${listo ? 'text-success' : 'text-muted-foreground'}`}>
        {listo ? 'Funcionando' : 'Sin configurar'}
      </span>
      {comoEncenderlo && (
        <span className="w-full text-caption text-muted-foreground">{comoEncenderlo}</span>
      )}
    </li>
  )
}

export function CanalesPanel({
  canales,
  calendario,
}: {
  canales: CanalAutomatizacion[]
  calendario: { estado: EstadoCanal; comoEncenderlo: string }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Qué está llegando a tus clientes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption text-muted-foreground">
          Tus automatizaciones usan estos canales. Si uno está sin configurar, las reglas que lo
          usen siguen ejecutándose pero <strong>no envían nada</strong> por ahí — y eso es
          justamente lo que no se ve hasta que alguien pregunta.
        </p>
        <ul className="space-y-2">
          {canales.map((c) => (
            <Fila
              key={c.clave}
              nombre={c.nombre}
              estado={c.estado}
              comoEncenderlo={c.comoEncenderlo}
            />
          ))}
          <Fila
            nombre="Citas en Google Calendar"
            estado={calendario.estado}
            comoEncenderlo={calendario.comoEncenderlo}
            icono={
              <CalendarCheck
                className={`h-5 w-5 ${calendario.estado === 'listo' ? 'text-success' : ''}`}
              />
            }
          />
        </ul>
      </CardContent>
    </Card>
  )
}
