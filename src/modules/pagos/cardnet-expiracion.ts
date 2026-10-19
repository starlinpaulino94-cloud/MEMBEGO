/**
 * CardNET considera válida una tarjeta hasta el último día de su mes de
 * vencimiento. Si CardNET no entregó ambos campos, la fecha es desconocida y
 * no se debe inferir un vencimiento.
 */
export function tarjetaCardnetVencida(
  vencMes: number | null | undefined,
  vencAnio: number | null | undefined,
  ahora = new Date()
): boolean {
  if (
    !Number.isInteger(vencMes) || vencMes! < 1 || vencMes! > 12 ||
    !Number.isInteger(vencAnio) || vencAnio! < 2000 || vencAnio! > 9999
  ) {
    return false
  }

  const anioActual = ahora.getFullYear()
  const mesActual = ahora.getMonth() + 1
  return vencAnio! < anioActual || (vencAnio === anioActual && vencMes! < mesActual)
}
