// Stub CJS de `next/headers`, `next/navigation` y `next/cache` para las pruebas de dominio.
const noDisponible = (nombre) => () => {
  throw new Error(`${nombre} no está disponible fuera de Next.js (pruebas de dominio).`)
}
module.exports = {
  cookies: noDisponible('cookies'),
  headers: noDisponible('headers'),
  redirect: noDisponible('redirect'),
  notFound: noDisponible('notFound'),
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_noStore: () => {},
}
