import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.dirname(fileURLToPath(import.meta.url))

export default {
  plugins: {
    '@tailwindcss/postcss': { base: appRoot },
  },
}
