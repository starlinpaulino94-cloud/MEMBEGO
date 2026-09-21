import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'off',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Los scripts de terminal imprimen por diseño: su salida ES el producto.
    // Sin esta excepción, `npm run lint` acumulaba 77 avisos de no-console que
    // no había que corregir nunca, y eso entrena a ignorar la salida del lint.
    files: ['scripts/**/*.{ts,mjs,js}'],
    rules: { 'no-console': 'off' },
  },
  {
    // SERVIDOR: prohibido tragarse un error sin dejar rastro.
    //
    // `.catch(() => {})` ya nos costó caro: una migración sin correr dejó las
    // capacidades apagadas en silencio durante días, porque el código es
    // fail-open a propósito y no había un solo error en el log. Ignorar el
    // fallo sigue siendo válido — lo que no vale es hacerlo a ciegas.
    //
    // Solo aplica al servidor: en la UI, `navigator.share().catch(() => {})`
    // es legítimo (el usuario canceló y no hay nada que registrar).
    files: ['src/modules/**/*.ts', 'src/lib/**/*.ts', 'src/app/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.body.length=0]",
          message:
            "No te tragues el error en silencio. Usa .catch(anotarFallo('modulo:operacion')) de @/lib/prisma-errors: el flujo no se rompe, pero queda registrado.",
        },
      ],
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.claude/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'prisma/**',
      'src/components/ui/**',
      'src/hooks/use-mobile.ts',
      'supabase/.temp/**',
      // La app de Zapier es un PROYECTO APARTE: corre en la infraestructura de
      // Zapier, no en la nuestra, y su plataforma exige CommonJS. Aplicarle las
      // reglas de este proyecto —que prohíben `require`— la marcaría entera en
      // rojo por cumplir el contrato de otro. Tiene su propio `package.json` y
      // sus propias pruebas; lo que sí se vigila desde aquí es que su contrato
      // no se separe del nuestro (`tests/connect-zapier.test.ts`).
      'integrations/**',
    ],
  },
]

export default eslintConfig
