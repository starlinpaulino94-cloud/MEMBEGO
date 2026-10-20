import 'server-only'

import { cache } from 'react'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { inicioDeHoyEn } from '@/modules/reportes/rango'

/**
 * La zona horaria de la empresa, UNA LECTURA POR PETICIÓN.
 *
 * `cache` de React deduplica dentro de una petición: el menú, el escáner y el
 * Resumen pueden pedirla en el mismo render sin pagar tres consultas. Si la
 * columna no sirve, `zonaSegura` degrada a la de la plataforma en vez de tumbar
 * la pantalla.
 */
const zonaDeEmpresa = cache(async (companyId: string): Promise<string> => {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  ).catch(() => null)
  return zonaSegura(fila?.zonaHoraria)
})

/**
 * Cuándo empieza «hoy» para esta empresa (auditoría admin · D-03).
 *
 * Es la misma definición que usa el Resumen (`inicioDeHoyEn` con la zona de la
 * empresa), para el sitio que solo conoce el `companyId`: «Visitas de hoy» del
 * escáner y el contador de canjes del menú. Nadie debería volver a escribir
 * `setHours(0, 0, 0, 0)` ni un UTC-4 a mano para esto — una prueba lo vigila.
 */
export async function inicioDeHoy(companyId: string, ahora: Date = new Date()): Promise<Date> {
  return inicioDeHoyEn(await zonaDeEmpresa(companyId), ahora)
}
