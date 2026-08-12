import { Badge } from '@/components/ui/badge'
import type { EmpresaDeUsuario } from '@/modules/usuarios/lista'

/** Cuántas se enseñan antes de resumir. */
const TOPE = 3

/**
 * LAS EMPRESAS DE UN USUARIO, CON TOPE Y CON LAS DE PRÁCTICA MARCADAS.
 *
 * Dos problemas de la misma fila de insignias:
 *
 *  · SIN TOPE. Un usuario con acceso a veinte empresas convertía su tarjeta en
 *    un muro; en un móvil de 360 px, cuatro ya ocupaban tres líneas y empujaban
 *    todo lo demás fuera de la vista. Se enseñan tres y el resto se resume.
 *
 *  · LAS DE PRÁCTICA SE VEÍAN COMO NEGOCIOS REALES. «Car wash prueba» llevaba
 *    exactamente la misma insignia que una empresa que factura. En la pantalla
 *    que decide quién accede a qué, no distinguir un entorno de entrenamiento
 *    de un negocio de verdad es justo lo contrario de lo que hace falta: se
 *    concede un acceso creyendo que es inofensivo, o se teme uno que lo era.
 */
export function EmpresasDeUsuario({ empresas }: { empresas: EmpresaDeUsuario[] }) {
  if (empresas.length === 0) {
    return <span className="text-caption text-muted-foreground">Sin empresa asignada</span>
  }

  const visibles = empresas.slice(0, TOPE)
  const resto = empresas.slice(TOPE)

  return (
    <>
      {visibles.map((e) => (
        <Badge
          key={e.id}
          variant="outline"
          className={
            e.activa
              ? 'border-info/30 bg-info/10 text-caption text-info'
              : 'text-caption text-muted-foreground'
          }
        >
          {e.name}
          {e.esDemo && (
            // El sufijo va DENTRO de la insignia y no en otra aparte: separado,
            // en una fila de cuatro no se sabe a cuál se refiere.
            <span className="ml-1 font-medium text-warning">· práctica</span>
          )}
          {e.activa && empresas.length > 1 ? ' · activa' : ''}
        </Badge>
      ))}

      {resto.length > 0 && (
        // El resumen dice CUÁLES son al posarse encima; un «+3 más» que no se
        // puede abrir obliga a entrar en la ficha para responder «¿cuáles?».
        <Badge
          variant="outline"
          className="text-caption text-muted-foreground"
          title={resto.map((e) => (e.esDemo ? `${e.name} (práctica)` : e.name)).join(', ')}
        >
          +{resto.length} más
        </Badge>
      )}
    </>
  )
}
