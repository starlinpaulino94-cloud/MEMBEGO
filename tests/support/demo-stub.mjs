// Doble de prueba: reexporta el módulo real de demo y sustituye SOLO la
// pregunta «¿es empresa demo?», que es la que consulta la base de datos.
export * from '../../src/modules/demo/index.ts'

export async function esEmpresaDemo() {
  return globalThis.__t23demo === true
}
