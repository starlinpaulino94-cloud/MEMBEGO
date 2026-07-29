# Runbook · Se borraron o corrompieron datos

**Síntoma:** faltan clientes, visitas, transacciones. Una empresa entera
desapareció. Un `delete` o un `update` salió sin `where`. Una purga del
superadmin se ejecutó sobre lo que no era.

Este es el runbook más peligroso del conjunto, porque **la reacción instintiva
empeora las cosas**.

---

## 0 · Los primeros 60 segundos

**PARA.** No intentes arreglarlo escribiendo. No reinsertes filas a mano, no
corras un script "de recuperación", no deshagas nada todavía.

Cada escritura que ocurra a partir de ahora:

- reduce lo que se puede recuperar con PITR sin perder también lo nuevo, y
- ensucia el estado, de forma que después nadie sabrá qué fila es original y
  cuál se reinsertó a mano.

**Cierra la aplicación ya:** [`modo-mantenimiento.md`](modo-mantenimiento.md).
Sí, aunque sean las 11 de la mañana de un sábado. El coste de veinte minutos
cerrado es conocido; el de una base mezclada, no.

**Anota la hora exacta** en que ocurrió el borrado, o la mejor estimación. Ese
dato es literalmente el parámetro de la restauración.

---

## 1 · Medir el daño antes de decidir

Con la aplicación cerrada, entra con el pase y mide. En el SQL Editor de
Supabase:

```sql
-- ¿Cuánto falta y desde cuándo?
select count(*) from clientes;
select max("createdAt") from visits;
select max("createdAt") from transactions;

-- El rastro de auditoría: quién hizo qué, justo antes
select "createdAt", accion, "userId", detalle
  from audit_logs
 order by "createdAt" desc
 limit 50;
```

`audit_logs` suele decir exactamente qué pasó. Míralo antes de suponer.

Ahora decide con dos preguntas:

| Pregunta | Si la respuesta es… |
|---|---|
| ¿Es una tabla acotada y se sabe exactamente qué filas? | → § 2 (restauración parcial) |
| ¿Es amplio, o no se sabe el alcance? | → § 3 (PITR) |

---

## 2 · Daño acotado: restauración parcial

Preferible siempre que se pueda, porque **no pierde nada de lo que vino
después**.

1. Restaura una copia **en otro sitio** — nunca encima de producción:

   ```bash
   RESPALDO_ORIGEN="<DIRECT_URL de producción>" \
   RESPALDO_DESTINO="<base desechable>" \
   npm run respaldo:verificar --conservar
   ```

   Si el borrado ya está en producción, esa copia también lo tendrá. En ese
   caso necesitas un respaldo **anterior**: descarga uno desde Supabase →
   Database → Backups y restáuralo en la base desechable con
   `node scripts/verificar-respaldo.mjs --archivo <ruta>`.

2. Extrae solo lo que falta de la copia y llévalo a producción con un `insert`
   explícito por identificadores. Nunca un `truncate` + recarga completa.

3. Verifica los conteos antes de reabrir.

---

## 3 · Daño amplio: Point In Time Recovery

**Requiere PITR activo.** Si no lo está, salta a § 4 — y esa es la respuesta
completa a por qué merece la pena (`docs/RECUPERACION.md` § 3.1).

1. Supabase → Settings → Database → **Point in Time Recovery**.
2. Elige el instante **anterior** al borrado. Si el `delete` fue a las 14:07,
   elige 14:05, no 14:07. Un minuto de margen cuesta un minuto de datos; cero
   margen puede costar la restauración entera.
3. Supabase restaura el proyecto a ese instante. **Todo lo escrito después se
   pierde** — por eso el paso 0 era cerrar: cuanto antes se cierra, menos hay
   que perder.
4. Al terminar:

   ```bash
   DATABASE_URL="<DIRECT_URL>" npx prisma migrate deploy
   npm run db:doctor
   ```

   La copia restaurada puede tener menos migraciones que el código desplegado.
   Sin este paso los módulos afectados aparecen **vacíos sin dar error** —
   la tolerancia *fail-open* del proyecto.

5. Recorre la verificación del paso 4 de `docs/RECUPERACION.md`: iniciar
   sesión, panel de empresa, escanear y canjear, abrir y cerrar caja, ver un
   comprobante.

6. Reabre y concilia lo que se perdió entre el instante restaurado y ahora:
   pagos de CardNET ([`pagos-cardnet.md`](pagos-cardnet.md)) y lavados
   cobrados a mano.

---

## 4 · Si no hay PITR y el respaldo diario no alcanza

Es el escenario que este proyecto **todavía no puede resolver bien**, y hay que
decirlo tal cual:

- El respaldo más reciente puede tener hasta 24 horas.
- Restaurarlo devuelve la operación de ayer y pierde la de hoy.
- No hay forma de recuperar lo de hoy salvo lo que exista en papel, en los
  correos enviados, en WhatsApp o en el panel de CardNET.

Qué hacer en la práctica:

1. Antes de restaurar nada, **exporta a CSV lo que sí queda** de las tablas
   afectadas. Es tu única copia del estado actual.
2. Restaura el respaldo.
3. Reconstruye a mano, con esos CSV y con lo que haya en papel, lo que se pueda.
4. Cuando pase el incidente, activa PITR. No como propósito: ese día.

---

## 5 · No hagas esto

- **No restaures encima de producción "para probar".** Por eso
  `scripts/verificar-respaldo.mjs` se niega a continuar si origen y destino son
  la misma base.
- **No borres el proyecto ni crees uno nuevo** mientras el original tenga
  respaldos: los respaldos viven con el proyecto.
- **No reabras antes de verificar el inicio de sesión.** Si el esquema `auth`
  no se restauró, tienes todos los datos y ninguna contraseña
  (`docs/RECUPERACION.md` § 2.1). Es mejor descubrirlo con la aplicación
  cerrada.
- **No inventes filas para "cuadrar".** Un hueco documentado es recuperable;
  un dato inventado contamina los reportes para siempre.

---

## 6 · Después

- Bitácora de `docs/RECUPERACION.md` § 7: qué se perdió, cuánto se tardó, qué
  faltó.
- ¿La causa fue una acción del panel? Mira si esa acción pide confirmación
  suficiente. Las purgas del superadmin exigen escribir una palabra a propósito;
  si el borrado vino por otra vía, esa vía necesita el mismo freno.
- ¿Te enteraste tarde? Ese retraso es el sumando más grande del RTO y no se
  arregla restaurando más rápido.
