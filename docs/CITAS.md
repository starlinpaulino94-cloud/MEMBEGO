# Módulo de Citas — Investigación y arquitectura

## 1 · Qué problema resuelve

El cliente hoy llega al local sin avisar; el negocio no puede planificar su
capacidad. Este módulo permite que el **cliente reserve un turno** desde la app
y que el **negocio controle la agenda**: cuántas citas acepta **por hora**
(turno) y **por día**, en qué horario atiende y con cuánta anticipación se
puede reservar.

## 2 · Decisiones de diseño (investigación sobre la base real)

| Tema | Decisión | Por qué |
| --- | --- | --- |
| Multi-tenant | Todo cuelga de `companyId`, como el resto de la plataforma | Cada empresa configura su propia agenda |
| El "slot" | Los horarios del día se dividen en turnos de `duracionMin` minutos (15/30/45/60) | El límite "por hora" del negocio se expresa como **cupo por turno** (`maxPorSlot`), que es más flexible: con turnos de 30 min y cupo 2, son 4 citas/hora |
| Límite diario | `maxPorDia` (0 = sin límite) | Control de capacidad global del día, independiente del cupo por turno |
| Zona horaria | Los turnos se calculan en `company.zonaHoraria` (IANA) y `Cita.inicio` se guarda en UTC | Mismo criterio regional que facturación y formatos (lib/format) |
| Horario semanal | JSON `{"1":[{"desde":"08:00","hasta":"18:00"}], …}` (0=domingo…6=sábado) en `AgendaConfig.horarios` | Editable con una fila por día en el panel; días ausentes = cerrado; validado en `src/modules/citas/disponibilidad.ts` |
| Confirmación | `autoConfirmar` decide si la cita nace `CONFIRMADA` o `PENDIENTE` (el panel aprueba) | Negocios chicos quieren cero fricción; otros quieren filtrar |
| Anticipación y ventana | `anticipacionHoras` (mínimo para reservar) y `ventanaDias` (máximo hacia adelante) | Evita reservas "para dentro de 5 minutos" y agendas infinitas |
| Anti-abuso | 1 cita activa por cliente y por día en la misma empresa + rate limit de formularios | Evita acaparar turnos |
| Cupos | El servidor **recalcula** la disponibilidad al reservar (no confía en la UI) dentro de una transacción | La UI puede quedar desactualizada entre carga y clic |
| Estados | `PENDIENTE → CONFIRMADA → COMPLETADA` · `CANCELADA` (cliente o negocio, con motivo) · `NO_ASISTIO` | El historial de no-shows queda en la ficha para decisiones del negocio |
| Notificaciones | Reusa el servicio existente: `CITA_NUEVA` (al panel), `CITA_CONFIRMADA` / `CITA_CANCELADA` (al cliente) | Mismos canales que pagos y tickets |
| Permisos | Nueva sección `citas` en `ADMIN_SECTIONS`; SUPERVISOR la incluye; mutaciones con `requireSection('citas')` | Mismo modelo fail-closed del panel |
| Borrado de clientes | `Cita.clienteId` con `onDelete: Cascade` | La purga del superadmin no necesita pasos extra |
| Vehículo/sucursal | Opcionales en la cita (útil en car wash y multi-sucursal) | La agenda es una sola por empresa en esta fase; por-sucursal queda como evolución |

## 3 · Modelo de datos

- **`AgendaConfig`** (1 por empresa): `activa`, `duracionMin`, `maxPorSlot`
  (límite por turno/hora), `maxPorDia` (límite diario), `anticipacionHoras`,
  `ventanaDias`, `autoConfirmar`, `notas`, `horarios` (JSON semanal).
- **`Cita`**: empresa, cliente, sucursal?, vehículo?, `inicio` (UTC),
  `duracionMin`, `servicio`, notas de cliente e internas, `estado`,
  cancelación (quién y por qué), `atendidaPor` (staff que la completó).

Migración: `prisma/migrations/20260749_agenda_citas/migration.sql`
(crea `CitaEstado`, `agenda_configs`, `citas` y agrega los valores
`CITA_*` a `NotifTipo`).

## 4 · Flujo del cliente (`/cliente/citas`)

1. Si la empresa no activó la agenda → estado vacío explicativo.
2. Selector de día (los próximos `ventanaDias`; los días cerrados no aparecen).
3. Grid de turnos del día: cada turno muestra su hora; los llenos o pasados se
   deshabilitan. La disponibilidad viene del servidor.
4. Al elegir turno: diálogo con vehículo (opcional), qué necesita (texto) y
   confirmación. La reserva valida TODO de nuevo en el servidor.
5. "Mis citas": próximas e historial, con cancelación (hasta que empiece).

## 5 · Flujo del negocio (`/admin/citas`)

- **Agenda del día**: navegación por fecha, resumen (total/confirmadas/
  pendientes/canceladas), lista ordenada por hora con cliente (enlace a su
  ficha), vehículo y notas.
- **Acciones por cita**: Confirmar (si PENDIENTE) · Completar · No asistió ·
  Cancelar con motivo (notifica al cliente).
- **Configuración** (`/admin/citas/configuracion`): encender/apagar módulo,
  duración del turno, **límite por turno**, **límite por día**, anticipación,
  ventana, autoconfirmación, instrucciones y horario semanal (una franja por
  día).

## 6 · Piezas del módulo

```
src/modules/citas/
├── disponibilidad.ts   # lógica pura: TZ, turnos del día, validación de horario
├── queries.ts          # config, disponibilidad con cupos, citas por día/cliente
└── actions.ts          # reservar/cancelar (cliente) · confirmar/completar/
                        #   no-asistió/cancelar + guardar config (admin)
src/app/(cliente)/cliente/citas/page.tsx
src/app/(admin)/admin/citas/page.tsx
src/app/(admin)/admin/citas/configuracion/page.tsx
src/components/citas/*   # ReservarCita (grid+diálogo), acciones, config form
```

## 7 · Evolución prevista (no incluida en esta fase)

- Agenda por sucursal y por empleado (barberías con varios sillones).
- Recordatorio automático 24 h antes vía el motor de automatizaciones.
- Reagendar en un paso (hoy: cancelar + reservar).
- Bloqueos de fecha puntuales (feriados) además del horario semanal.

## Agenda del panel: toda la agenda, no solo hoy

`/admin/citas` abre en **Próximas** (de ahora en adelante) porque es lo que el
negocio necesita para prepararse. Desde ahí se filtra sin perder el contexto:

- **Rango**: Próximas · Hoy · Próximos 7 días · Pasadas · Todas.
- **Estado**: por confirmar, confirmadas, completadas, canceladas, no asistió.
  Cada chip muestra su conteo real dentro del rango elegido.
- **Búsqueda** por nombre o teléfono del cliente.

Las citas se **agrupan por día** con encabezado fijo, para que la lista se lea
como una agenda y no como un volcado de filas. Pagina de 25 en 25; las
"pasadas" se ordenan de la más reciente hacia atrás, el resto cronológicamente.

Implementación: `getAgenda()` en `src/modules/citas/queries.ts` (una consulta
de página + un `count` + un `groupBy` para los conteos por estado).
`leerFiltrosAgenda()` normaliza los parámetros de la URL, así que un parámetro
manipulado nunca rompe la pantalla.
