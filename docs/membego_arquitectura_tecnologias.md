# MembeGo — Documento Técnico de Arquitectura, Tecnologías y Configuración

> **MembeGo** es un **Customer Growth Operating System** (Sistema Operativo para el Crecimiento de Clientes): una plataforma universal multi-tenant diseñada para que las empresas gestionen de manera inteligente la adquisición, conversión, retención y fidelización de sus usuarios mediante membresías, beneficios, promociones, programas de referidos, automatización de marketing y analíticas detalladas.
>
> Aunque la primera industria vertical de implementación es **Car Wash**, el núcleo (Core) de la plataforma está construido de forma abstracta y desacoplada para admitir cualquier sector comercial (restaurantes, gimnasios, salones de belleza, etc.) sin reescribir las reglas fundamentales de negocio.

---

## 1. Stack Tecnológico Core

La plataforma MembeGo utiliza un stack de desarrollo moderno orientado al rendimiento, tipado estricto y despliegue serverless rápido:

| Capa / Función | Tecnología Utilizada | Detalle / Versión |
| :--- | :--- | :--- |
| **Runtime & Package Manager** | [Bun](https://bun.sh) | `^1.0` — Reemplaza a Node.js para ejecutar tareas de desarrollo, dependencias y scripts de base de datos con máxima velocidad. |
| **Framework Web Principal** | [Next.js](https://nextjs.org/) | `v16.1.1` (App Router + React Server Components) |
| **Biblioteca de UI** | [React](https://react.dev/) | `v19.0.0` |
| **Lenguaje de Programación** | [TypeScript](https://www.typescriptlang.org/) | `v5.x` con verificación estricta de tipos. |
| **Estilos y Maquetación** | [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) | Tailwind v4 (PostCSS) + componentes primitivos de Radix UI estilizados con shadcn. |
| **Base de Datos Relacional** | [PostgreSQL (Supabase)](https://supabase.com/) | Alojado en Supabase, con soporte multi-tenant mediante esquema compartido y políticas RLS (Row-Level Security) aplicadas en base al `companyId`. |
| **Mapeador Objeto-Relacional (ORM)** | [Prisma](https://www.prisma.io/) | `v6.11.1` — Utiliza la nueva característica de Prisma 6 para dividir el esquema en múltiples archivos (`prisma/schema/*.prisma`). |
| **Autenticación y Sesión** | [Supabase Auth](https://supabase.com/docs/guides/auth) | Integración del lado del servidor mediante `@supabase/ssr` con cookies HttpOnly seguras y validación en `middleware.ts`. |
| **Almacenamiento de Archivos** | [Supabase Storage](https://supabase.com/docs/guides/storage) | Almacenamiento persistente de imágenes de establecimientos, avatares y comprobantes de pago (restringido a firmas privadas temporales de 5 min). |
| **Monitoreo y Observabilidad** | [Sentry](https://sentry.io/) | Integración nativa a nivel de Edge, Servidor y Cliente para captura de excepciones y telemetría de rendimiento. |
| **Plataforma de Despliegue** | [Vercel](https://vercel.com/) | Infraestructura Serverless con optimizaciones para Next.js. |
| **Generación y Escaneo de QR** | `qrcode` + `html5-qrcode` | Generación de códigos QR únicos UUID en el cliente y escaneo en tiempo real mediante la cámara del dispositivo por parte de los empleados. |
| **Pruebas y QA** | [Playwright](https://playwright.dev/) | Automatización de pruebas End-to-End (E2E) y pruebas de interfaz de usuario. |

---

## 2. Arquitectura de Software: Monolito Modular Evolutivo

MembeGo sigue el principio de **Monolito Modular**. La lógica comercial de negocio y los cálculos se estructuran en **motores universales desacoplados** (`src/lib/*`), manteniendo la capa de presentación (`src/app/` y Server Actions en `src/modules/`) lo más delgada y declarativa posible.

### Flujo de Evaluación de Motores

```
        Business Data Dictionary (F6)      ← catálogo oficial de variables de negocio
                 │ define
                 ▼
        Universal Context Model (F5)       ← providers construyen el contexto de ejecución
                 │ provee
                 ▼
   ┌─────────────────────────────────────┐
   │  BEL / Expression Engine (F7)        │ ← fórmulas y expresiones matemáticas y lógicas
   └─────────────────────────────────────┘
                 │ evalúa dentro de
                 ▼
        Rule Engine + Condition Engine (F1–F2)
                 │ cuando una regla se cumple →
                 ▼
        Action Engine (F3)                 ← ejecuta efectos secundarios (auditoría/rollback)
                 ▲ orquestado como configuración por
                 │
        Promotion Framework (F4)  … y los motores de membresías, referidos y automatizaciones.
```

### Catálogo de Motores y Módulos Core

1. **Rule Engine & Condition Engine (`src/lib/rule-engine`)**: Evaluación de reglas configurables complejas (AND/OR/NOT/XOR). Las condiciones evalúan tipos de operadores estrictos basándose en las variables del cliente y del contexto.
2. **Action Engine (`src/lib/rule-engine/actions`)**: Catálogo de efectos de negocio automatizados (ej: otorgar beneficio, enviar correo, aplicar descuento). Cuenta con manejo de prioridades, reintentos y lógica de rollback en caso de fallo.
3. **Universal Context Model (`src/lib/context`)**: Construye namespaces de datos dinámicos a partir de la solicitud actual (ej: datos del cliente, del vehículo, de la transacción) para alimentar los motores sin consultar la base de datos repetidamente.
4. **Business Data Dictionary (`src/lib/dictionary`)**: Diccionario central que define los tipos y descripciones de las variables disponibles en toda la plataforma.
5. **Expression Engine - BEL (`src/lib/bel`)**: Intérprete propio y seguro para evaluar fórmulas lógicas y matemáticas escritas por administradores, evitando vulnerabilidades al no usar `eval()`.
6. **Benefit Engine & Transformation Engine (`src/lib/benefits` & `src/lib/benefit-transformation`)**: Administra los beneficios otorgados a los clientes. Permite transformaciones lógicas (upgrades, downgrades, intercambios, reemplazos y splits) basándose en políticas dinámicas de la empresa.
7. **Referral Engine (`src/lib/referral`)**: Motor universal de recomendación "Invita y gana" configurable con toggles antifraude, límites y flujos de recompensa encadenados mediante el Benefit Engine.
8. **Automation Engine & Playbooks (`src/lib/automation`)**: Orquestador universal que escucha eventos de la aplicación (`emitirEventoEstrategia`) y desencadena playbooks configurados (180 recetas comerciales prediseñadas para captación, retención, frecuencia, recuperación, etc.).

---

## 3. Arquitectura y Modelo de Datos (Prisma Multi-file)

Para evitar un archivo `schema.prisma` gigante e inmanejable, MembeGo divide sus modelos en múltiples archivos agrupados en la carpeta `prisma/schema/`.

### Estructura de Schemas en Prisma

*   **[base.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/base.prisma)**: Configuración del cliente Prisma, generadores, y bases compartidas.
*   **[identidad.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/identidad.prisma)**: Modelado de usuarios (`User`), perfiles, roles del sistema (`SUPERADMIN`, `ADMIN_EMPRESA`, `EMPLEADO`, `CLIENTE`) y credenciales.
*   **[clientes.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/clientes.prisma)**: Información del cliente asociado a una empresa (`Cliente`), vehículos asociados, registros e historial de visitas.
*   **[membresias.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/membresias.prisma)**: Configuración de planes de membresía, estados de suscripción, límites de crédito y facturación.
*   **[motores.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/motores.prisma)**: Tablas del Rule Engine, Action Engine, Automation Engine y variables del Diccionario.
*   **[carwash.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/carwash.prisma)**: Estructuras comerciales heredadas del primer vertical de Car Wash (especificaciones de lavado, flotas, bahías, etc.).
*   **[referidos.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/referidos.prisma)**: Códigos de referidos, referidos activos, hitos y auditoría de fraudes.
*   **[campanas.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/campanas.prisma)**: Campañas de marketing masivas y segmentación.
*   **[citas.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/citas.prisma)**: Gestión de turnos y agendas.
*   **[caja.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/caja.prisma)**: Transacciones de caja, puntos de venta (POS) y arqueos.
*   **[pagos.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/pagos.prisma)**: Integraciones de pasarelas de pago y registro de transacciones.
*   **[integraciones.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/integraciones.prisma)**: Conexiones de API de terceros y webhooks.
*   **[marketplace.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/marketplace.prisma)**: Listados de empresas públicas, reviews y configuraciones de SEO.
*   **[soporte.prisma](file:///home/gbria/work/MEMBEGO/prisma/schema/soporte.prisma)**: Tickets de soporte al cliente y logs del sistema.

### Seguridad y Aislamiento de Datos (Multi-Tenant RLS)

El aislamiento multi-tenant se maneja en dos capas sobre PostgreSQL de Supabase:
1.  **Capa de Aplicación (Filtros en Queries)**: El backend inyecta de forma obligatoria el `companyId` recuperado de la sesión del usuario en todas las consultas Prisma.
2.  **Capa de Base de Datos (Row-Level Security - RLS)**: Supabase restringe los accesos utilizando RLS en las tablas correspondientes. La clave anónima (`anon_key`) tiene denegado el acceso directo a los datos críticos, protegiendo contra filtraciones si se exponen credenciales del lado del cliente.

---

## 4. Infraestructura, DevOps y Pipeline de CI/CD

El entorno de producción y desarrollo se apoya en despliegues automatizados y pruebas de integración continuas:

### 1. Servidor y Alojamiento (Vercel + Supabase)
*   **Vercel** compila la aplicación Next.js y expone Serverless Functions para las Server Actions y endpoints del API.
*   **Supabase** actúa como la infraestructura de persistencia (PostgreSQL + Auth + Storage).
*   Se divide el tráfico de base de datos en dos URL:
    *   `DATABASE_URL`: Apunta al pooler de conexiones (pgBouncer en puerto 6543) con persistencia de transacciones para la aplicación activa.
    *   `DIRECT_URL`: Conexión directa a PostgreSQL (puerto 5432) necesaria para ejecutar migraciones DDL de Prisma (ya que pgBouncer no soporta cambios de esquema en el modo pooler).

### 2. Flujo de Trabajo en GitHub Actions
El repositorio cuenta con pipelines automatizados en `.github/workflows/`:
*   **Integración Continua (`ci.yml`)**: Se activa con cada push y Pull Request. Realiza validaciones estrictas:
    *   Verificación de tipos de TypeScript (`tsc --noEmit`).
    *   Linter del proyecto (`eslint`).
    *   Pruebas unitarias de los motores (`npm test`).
    *   Compilación de producción Next.js (`next build`).
    *   Auditoría de dependencias críticas de npm.
    *   Validación del esquema de Prisma contra la base de datos (`prisma validate`).
*   **Despliegue Automatizado (`deploy-migraciones.yml`)**: Al fusionar en `main`, ejecuta la tarea `prisma migrate deploy` utilizando la `DIRECT_URL`. Si las migraciones de base de datos fallan, el deploy en Vercel se detiene inmediatamente para evitar inconsistencias de esquema.
*   **Simulacro Semanal de Restauración (`respaldo-verificacion.yml`)**: Se ejecuta de forma programada los lunes a las 08:00 (hora Santo Domingo). Realiza un dump de producción, lo restaura en una base de datos PostgreSQL de prueba aislada y verifica la integridad de datos e identidades de Supabase Auth (RPO/RTO).

---

## 5. Estructura del Proyecto en el Sistema de Archivos

```
membego-platform/
├── .github/
│   └── workflows/            # Pipelines CI/CD (ci, deploy, respaldos)
├── prisma/
│   ├── schema/               # Schemas de Prisma divididos por dominio
│   ├── migrations/           # Historial de migraciones SQL generadas por Prisma
│   ├── migrations_manual/    # Sentencias SQL para políticas de Storage y RLS
│   └── seed.ts               # Semilla para poblar datos de prueba iniciales
├── public/                   # Archivos estáticos públicos
├── src/
│   ├── app/                  # Next.js App Router agrupado por roles / audiencias
│   │   ├── (public)/         # Landing page pública y catálogo de empresas
│   │   ├── (auth)/           # Pantallas de Login, Registro y Recuperación
│   │   ├── (cliente)/        # Dashboard del Cliente (Códigos QR y membresía)
│   │   ├── (admin)/          # Panel de la Empresa (Membresías, empleados, planes)
│   │   ├── (empleado)/       # Escáner de códigos QR para validar visitas
│   │   └── (superadmin)/     # Panel administrativo global de MembeGo
│   ├── components/           # Componentes UI reutilizables (shadcn/ui + específicos de dominio)
│   ├── lib/                  # Motores universales (Rule Engine, BEL, Context, Playbooks)
│   ├── modules/              # Next.js Server Actions agrupadas por submódulos de negocio
│   ├── types/                # Interfaces y tipos compartidos de TypeScript
│   ├── middleware.ts         # Protección de rutas por roles y manejo de redirecciones
│   └── proxy.ts              # Reglas de enrutamiento y proxy de autenticación
└── Caddyfile                 # Configuración del servidor Caddy para proxificación local
```

---

## 6. Variables de Entorno y Configuración (`.env`)

Para levantar el proyecto localmente, debes configurar un archivo `.env` en la raíz basado en el archivo [.env.example](file:///home/gbria/work/MEMBEGO/.env.example):

### Variables Clave Obligatorias

```env
# 1. Configuración de Supabase Auth (Público en Frontend)
NEXT_PUBLIC_SUPABASE_URL="https://TU-PROYECTO.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbG..."

# 2. Clave Administrativa de Supabase (Privada para Backend)
SUPABASE_SERVICE_ROLE_KEY="eyJhbG..."

# 3. Conexiones a Base de Datos PostgreSQL (Prisma)
# URL de conexión con pgBouncer para la ejecución de la app
DATABASE_URL="postgresql://postgres.XXXX:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true"
# URL de conexión directa para migraciones y scripts administrativos
DIRECT_URL="postgresql://postgres.XXXX:PASSWORD@aws-0-REGION.supabase.com:5432/postgres"

# 4. URLs de la Aplicación y Correos
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EMAIL_FROM="MembeGo <no-reply@membego.com>"
RESEND_API_KEY="re_..." # Proveedor de envío de correos (opcional en desarrollo)
```

---

## 7. Guía de Arranque Rápido para Desarrolladores

Si vas a empezar a desarrollar en el proyecto MembeGo, sigue estos pasos para levantar tu entorno local de forma correcta:

```bash
# 1. Instalar dependencias del proyecto usando Bun
bun install

# 2. Configurar variables de entorno locales
cp .env.example .env
# Abre el archivo .env y completa las credenciales de tu proyecto de Supabase local/desarrollo

# 3. Generar el cliente de Prisma en base a los archivos de schema
bun run db:generate

# 4. Sincronizar el esquema de base de datos con tu base de desarrollo
bun run db:push

# 5. Ejecutar la semilla para crear empresas, planes y cuentas de prueba predeterminadas
bun run db:seed

# 6. Levantar el servidor de desarrollo local
bun run dev
```

### Cuentas de Prueba Creadas por el Seed

Una vez ejecutado el comando `bun run db:seed`, puedes iniciar sesión en [http://localhost:3000/login](http://localhost:3000/login) con cualquiera de las siguientes cuentas:

| Rol de Usuario | Correo Electrónico | Contraseña | Propósito de Prueba |
| :--- | :--- | :--- | :--- |
| **Superadmin** | `superadmin@membego.com` | `admin123` | Control global de empresas, reportes consolidados. |
| **Admin de Empresa** | `admin.cartown@membego.com` | `admin123` | Administración de clientes, planes y empleados del Car Wash "Car Town". |
| **Empleado de Empresa** | `empleado.cartown@membego.com` | `admin123` | Uso del escáner de códigos QR para registrar lavados y visitas de clientes. |
| **Cliente Final** | `cliente@membego.com` | `cliente123` | Vista de código QR único, historial de visitas y estado de membresía activa. |
