/**
 * Helper mínimo de concatenación condicional de classNames para RN.
 * Replica la semántica de clsx + tailwind-merge sin dependencias externas.
 *
 * Acepta strings, arrays anidados, objetos (keys truthy = incluidas),
 * y valores falsy (false, null, undefined, 0, '') que se descartan.
 */
type ClassValue = string | number | boolean | null | undefined | ClassValue[] | Record<string, unknown>

function parseArg(arg: ClassValue): string[] {
  if (!arg && arg !== 0) return []
  if (typeof arg === 'string') return arg.trim() ? [arg.trim()] : []
  if (typeof arg === 'number') return [String(arg)]
  if (Array.isArray(arg)) return arg.flatMap(parseArg)
  if (typeof arg === 'object') {
    return Object.entries(arg)
      .filter(([, v]) => !!v)
      .map(([k]) => k.trim())
      .filter(Boolean)
  }
  return []
}

export function cn(...args: ClassValue[]): string {
  return args.flatMap(parseArg).join(' ')
}
