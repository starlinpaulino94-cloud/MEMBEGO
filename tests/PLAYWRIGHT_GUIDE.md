# 🎭 Guía Integral de Pruebas E2E con Playwright · Módulo Excursiones (MEMBEGO)

Esta guía detalla el procedimiento para configurar, ejecutar y validar de extremo a extremo (**E2E**) todos los flujos de negocio del módulo de excursiones en los **4 roles del sistema**:
1. **Administrador** (`ADMIN` / `SUPERADMIN`)
2. **Personal Operativo / Staff** (`STAFF` / `OPERADOR`)
3. **Vendedor Normal con Tipo Empleado** (`VENDEDOR` - tipo `Empleado`)
4. **Cliente Final / Turista** (`CLIENTE`)

---

## 📋 1. Credenciales de Prueba por Rol

> **Instrucciones**: Completa los siguientes campos con los usuarios y contraseñas creados en tu entorno local o de staging para correr los tests interactivos.

```env
# ==============================================================================
# 1. ROL: ADMINISTRADOR / DUEÑO DE EMPRESA (Acceso a Configuración, Metas y Reportes)
# ==============================================================================
TEST_ADMIN_EMAIL="admin@membego.test"
TEST_ADMIN_PASSWORD="TuPasswordAdminAqui"
TEST_ADMIN_COMPANY_ID="test-tours"

# ==============================================================================
# 2. ROL: PERSONAL OPERATIVO / GUÍA / STAFF (Manifiestos y Check-in QR)
# ==============================================================================
TEST_STAFF_EMAIL="staff@membego.test"
TEST_STAFF_PASSWORD="TuPasswordStaffAqui"

# ==============================================================================
# 3. ROL: VENDEDOR NORMAL / TIPO EMPLEADO (Dashboard Vendedor, QR, Metas y Comisiones)
# ==============================================================================
TEST_VENDEDOR_EMAIL="vendedor.empleado@membego.test"
TEST_VENDEDOR_PASSWORD="RrW60YaiqQIa"
TEST_VENDEDOR_SLUG="5k5egwcxku"
TEST_VENDEDOR_TIPO="Empleado"

# ==============================================================================
# 4. ROL: CLIENTE FINAL / TURISTA (Exploración, Carrito, Reserva y Mis Excursiones)
# ==============================================================================
TEST_CLIENTE_EMAIL="turista@membego.test"
TEST_CLIENTE_PASSWORD="TuPasswordClienteAqui"
```

---

## 🚀 2. Preparación del Entorno

### 2.1 Requisitos Previos
1. Node.js >= 18.x
2. Base de datos PostgreSQL activa
3. Servidor de desarrollo Next.js levantado

### 2.2 Sincronización de Base de Datos
```powershell
# Sincronizar esquemas Prisma (Combos, Reglas Tipo Vendedor, Metas, etc.)
npx prisma db push --skip-generate
```

### 2.3 Iniciar el Servidor de Aplicación
```powershell
npm run dev
# La aplicación estará disponible en http://localhost:3000
```

### 2.4 Instalar Navegadores de Playwright (si es primera vez)
```powershell
npx playwright install --with-deps
```

---

## 🧪 3. Comandos de Ejecución de Playwright

| Modo | Comando | Descripción |
| :--- | :--- | :--- |
| **Interfaz Gráfica (UI)** | `npx playwright test --ui` | Abre el visualizador interactivo con time-travel, screenshots y network logs. |
| **Modo Headed (Navegador visible)** | `npx playwright test tests/e2e/reservas-excursiones.spec.ts --headed` | Corre los tests abriendo la ventana del navegador en tiempo real. |
| **Modo Headless (Consola)** | `npx playwright test tests/e2e/` | Ejecuta todos los tests en segundo plano para CI/CD. |
| **Modo Depuración paso a paso** | `npx playwright test --debug` | Pausa en cada paso y permite inspeccionar selectores en vivo. |

---

## 🗺️ 4. Matriz de Escenarios de Prueba por Rol

```mermaid
flowchart TD
    A[Admin: Crea Actividades y Combos] --> B[Admin: Define Reglas de Comisión y Metas]
    B --> C[Vendedor Normal (Tipo Empleado): Recibe QR / Enlace Personal]
    C --> D[Cliente: Accede por QR del Vendedor Empleado]
    D --> E[Cliente: Añade Combo al Carrito y Paga / Reserva]
    E --> F[Staff: Valida Manifiesto y Realiza Check-in QR]
    E --> G[Admin: Supervisa Metas, Clientes Captados y Reportes]
    G --> H[Admin: Liquida Comisiones del Vendedor]
```

---

## 📌 5. Guía Detallada de Escenarios Manuales y Automatizados

### 👑 Rol 1: Administrador (`/admin/excursiones`)

#### Escenario 1.1: Creación de Combo / Paquete Multiactividad
1. Inicia sesión con las credenciales de **Administrador**.
2. Navega a **Catálogo** $\rightarrow$ `/admin/excursiones/catalogo/nueva`.
3. Selecciona la opción **"Combo / Paquete"** en Tipo de Ítem.
4. Completa:
   - Nombre: `Super Combo Caribeño: Catamarán + Buggies`
   - Capacidad: `20`
   - Precio Adulto: `150`
   - Marca las actividades secundarias a incluir en el combo con sus checkboxes.
5. Haz clic en **"Crear excursión"**.
6. **Validación esperada**: La excursión aparece en el listado con el badge `[Combo]` y valida la disponibilidad cruzada de cupos con las actividades hijo sin solapamiento de horarios.

#### Escenario 1.2: Auditoría y Filtros de Clientes Captados por Vendedor
1. Navega a **Vendedores** $\rightarrow$ `/admin/excursiones/vendedores`.
2. Haz clic sobre un vendedor normal de tipo Empleado (ej: `Carlos Gómez`).
3. En la sección **"Clientes captados"**:
   - Ingresa un término en la barra de búsqueda (nombre, email o teléfono).
   - Filtra por etapa del embudo (`COMPRA`, `RESERVA`, `REGISTRO`, `VISITA`).
   - Filtra por canal (`📱 QR` vs `🔗 Enlace Directo`).
   - Usa los botones de paginación (`< Anterior`, `Siguiente >`).
4. **Validación esperada**: La tabla filtra en tiempo real sin recargar toda la página y la paginación conserva los parámetros en la URL.

#### Escenario 1.3: Asignación de Metas por Tipo de Vendedor o Producto
1. Navega a **Metas** $\rightarrow$ `/admin/excursiones/metas`.
2. En el formulario de **"Nueva meta"**:
   - Selecciona Ámbito: `Por tipo de vendedor` (ej: `Empleado`).
   - Selecciona Producto: `Super Combo Caribeño` (o todo el catálogo).
   - Periodo: `Mensual`.
   - Cifras meta: `100` Pasajeros / `$5,000` Ingresos.
3. Haz clic en **"Crear meta"**.
4. **Validación esperada**: La meta aparece en "Metas activas" mostrando el badge del producto y la barra de progreso en tiempo real.

#### Escenario 1.4: Reportes Multicriterio y Descarga CSV
1. Navega a **Reportes** $\rightarrow$ `/admin/excursiones/reportes`.
2. Selecciona:
   - Rango de fechas (desde / hasta).
   - Vendedor o Tipo de Vendedor (`Empleado`).
   - Excursión / Combo específica.
   - Canal y Estado de Venta.
3. Haz clic en **"Aplicar filtros al panel"** y luego en **"Descargar CSV con estos filtros"**.
4. **Validación esperada**: El archivo CSV descargado contiene exactamente los bloques filtrados con su resumen, ventas, comisiones y liquidaciones.

---

### 💼 Rol 2: Vendedor Normal / Tipo Empleado (`/vendedor`)

#### Escenario 2.1: Acceso a Enlace QR y Dashboard
1. Inicia sesión con la cuenta de **Vendedor Normal (Tipo Empleado)**.
2. Verifica en `/vendedor`:
   - El saldo **"Por cobrar"** y **"Ya cobrado"**.
   - El código QR personal descargable y su enlace `/e/{slug}` (ej: `/e/carlos-vendedor`).
   - El embudo de clientes captados (`Abrieron`, `Se registraron`, `Reservaron`, `Compraron`).

#### Escenario 2.2: Consulta de Metas Asignadas
1. En `/vendedor`, revisa el widget **"Tus metas activas"**.
2. Navega a `/vendedor/metas` para el desglose detallado.
3. **Validación esperada**: Muestra el progreso de metas individuales y metas asignadas a su categoría (ej: metas para vendedores tipo `Empleado`).

#### Escenario 2.3: Creación de Reserva Manual desde Mostrador / Ventas
1. Navega a `/vendedor/reservas/nueva`.
2. Ingresa los datos del cliente (nombre, email, teléfono).
3. Selecciona la excursión o combo, fecha interactiva y cantidad de adultos/niños.
4. Guarda la reserva.
5. **Validación esperada**: La reserva queda automáticamente atribuida al vendedor empleado y suma a sus comisiones y metas.

---

### 🛡️ Rol 3: Personal Operativo / Staff (`/admin/excursiones/operacion` y `/checkin`)

#### Escenario 3.1: Manifiesto Diario de Pasajeros
1. Inicia sesión como **Staff / Operador**.
2. Navega a **Operación / Manifiesto** $\rightarrow$ `/admin/excursiones/operacion`.
3. Selecciona la fecha de hoy y el tour/combo correspondiente.
4. **Validación esperada**: Lista completa de pasajeros confirmados con su estado de pago y notas de recogida.

#### Escenario 3.2: Escaneo y Validación de Check-in QR
1. Abre el lector de Check-in $\rightarrow$ `/admin/excursiones/checkin`.
2. Ingresa el token del boleto o escanea el QR emitido al cliente (formato `EXC:XXXXXX`).
3. **Validación esperada**: Marca inmediatamente al pasajero como `CHECK-IN REALIZADO` con timestamp y operador responsable.

---

### 🏖️ Rol 4: Cliente / Turista (`/cliente` y `/e/{slug}`)

#### Escenario 4.1: Flujo Completo con QR del Vendedor, Carrito y Pago
1. Abre en el navegador el enlace del vendedor empleado: `http://localhost:3000/e/carlos-vendedor`.
2. Regístrate o inicia sesión como **Cliente**.
3. El sistema deposita la cookie de atribución `membego_vendedor_slug`.
4. Navega al catálogo público y selecciona un **Combo** y una **Actividad Individual**.
5. Añade ambos al carrito con diferentes pasajeros y fechas.
6. Abre el carrito flotante $\rightarrow$ Elige **"Pagar con Tarjeta (Simulación)"** o **"Pagar en Destino"**.
7. Haz clic en **"Confirmar y Pagar Reservas"**.
8. **Validación esperada**:
   - El sistema crea las reservas con estado `PAGADA` o `PENDIENTE`.
   - Se genera el registro de cobro correspondiente.
   - Se calculan las comisiones para el vendedor de tipo empleado según las reglas configuradas.
   - El cliente es redirigido a `/cliente/mis-excursiones` con sus boletos QR listos.

---

## 🛠️ 6. Diagnóstico y Preguntas Frecuentes

- **¿Qué pasa si un combo no tiene disponibilidad en una de sus actividades hijas?**
  El motor `validarDisponibilidadCombo` bloqueará la reserva indicando exactamente qué actividad o cupo está agotado.
- **¿Cómo se calculan las comisiones cuando hay regla por tipo de vendedor?**
  El motor `calcularComision` busca primero si existe una regla activa para el `tipo` del vendedor antes de recurrir a la tasa general.
- **¿Cómo se borran los datos de prueba?**
  Puedes ejecutar `npx prisma db push --force-reset` en entornos de desarrollo aislados si requieres reiniciar la base desde cero.
