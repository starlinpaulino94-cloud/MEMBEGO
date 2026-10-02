export function hasBrandColor(color: string | null | undefined): boolean {
  return Boolean(color && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color.trim()))
}

export function brandColor(color: string | null | undefined, fallback: string): string {
  const candidate = color?.trim().toLowerCase()
  if (!candidate || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(candidate)) return fallback
  if (candidate.length === 4) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`
  }
  return candidate
}

export function brandForeground(color: string | null | undefined, fallback: string): string {
  const resolved = brandColor(color, fallback)
  const red = Number.parseInt(resolved.slice(1, 3), 16) / 255
  const green = Number.parseInt(resolved.slice(3, 5), 16) / 255
  const blue = Number.parseInt(resolved.slice(5, 7), 16) / 255
  const linear = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  const darkContrast = (luminance + 0.05) / 0.059
  const lightContrast = 1.05 / (luminance + 0.05)
  return darkContrast >= lightContrast ? '#111827' : '#ffffff'
}
