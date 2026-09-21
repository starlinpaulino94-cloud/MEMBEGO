// Doble de prueba: reexporta el resolutor real y sustituye SOLO la función que
// toca la base de datos, para poder fijar la capacidad desde un test unitario.
export * from '../../src/modules/capacidades/resolver.ts'

export async function tieneCapacidad() {
  return globalThis.__t23cap === true
}
