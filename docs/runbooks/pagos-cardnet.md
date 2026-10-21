# Runbook · Un pago no se reflejó

**Síntoma:** un cliente dice que pagó y su membresía sigue inactiva, o su
promoción comprada no aparece. El cobro sí salió de su tarjeta.

También aplica después de un mantenimiento o una caída: **CardNET no reintenta**
los avisos que no pudo entregar, así que toda ventana de indisponibilidad deja
pagos por conciliar.

---

## 1 · Entender el flujo antes de tocar nada

El cobro ocurre **fuera** de MembeGo. El cliente se va a la pantalla de CardNET
y vuelve. Por eso existe `PagoIntento`: una fila creada **antes** de irse, con
el monto tomado de nuestra base — nunca del retorno, que viaja por el navegador
del cliente y es manipulable.

Los estados (`src/modules/pagos/intentos.ts`):

| Estado | Qué significa |
|---|---|
| `CREADO` | Se preparó el cobro y el cliente aún no salió |
| `REDIRIGIDO` | Se fue a CardNET. **Aquí es donde se quedan atascados los pagos huérfanos** |
| `APROBADO` | La pasarela confirmó, verificado servidor contra servidor |
| `RECHAZADO` | La pasarela rechazó. `motivoRechazo` lo explica |
| `EXPIRADO` / `ERROR` | No hubo respuesta, o falló el proceso |

`activadoAt` es el guardia de idempotencia: si tiene fecha, el producto ya se
entregó y un aviso repetido no hace nada. Es lo que impide que un cliente que
refresca la página de retorno se lleve dos membresías por un pago.

---

## 2 · Diagnosticar el caso concreto

En el SQL Editor de Supabase, con el correo o el teléfono del cliente:

```sql
select pi.id, pi.estado, pi.monto, pi.moneda, pi."referenciaExterna",
       pi.autorizacion, pi."motivoRechazo", pi."activadoAt", pi."createdAt",
       pi."membershipId", pi."compraId"
  from pago_intentos pi
  join clientes c on c.id = pi."clienteId"
 where c.email = '<correo del cliente>'
 order by pi."createdAt" desc
 limit 10;
```

| Lo que ves | Qué pasó | Qué hacer |
|---|---|---|
| `APROBADO` con `activadoAt` | El pago se aplicó | El problema es otro: mira la membresía o la compra directamente |
| `APROBADO` sin `activadoAt` | Se cobró y **falló la entrega** | § 3 |
| `REDIRIGIDO` y ya pasó rato | El aviso nunca llegó | § 3, verificando primero en CardNET |
| `RECHAZADO` | No se cobró | Enséñale `motivoRechazo`. No hay nada que reparar |
| No hay ninguna fila | El cliente no llegó a iniciar el cobro por aquí | ¿Pagó por transferencia? ¿Otra empresa? |

**Antes de entregar nada**, confirma en el panel de comercio de CardNET que el
cobro existe, con ese monto y esa fecha. La palabra del cliente no es evidencia
—no por mala fe, sino porque un cargo pendiente y un cargo liquidado se ven
igual en la app del banco—.

---

## 3 · Conciliar

### Caso puntual (uno o dos clientes)

1. Confirma el cobro en el panel de CardNET y anota la **autorización**.
2. Entrega el producto desde el panel de administración de la empresa: activar
   la membresía o la compra, como cualquier alta manual.
3. Deja rastro en el intento para que nadie lo entregue dos veces:

   ```sql
   update pago_intentos
      set estado = 'APROBADO',
          autorizacion = '<código de autorización de CardNET>',
          "activadoAt" = now()
    where id = '<id del intento>'
      and "activadoAt" is null;   -- el AND importa: si ya se activó, no toca nada
   ```

   Ese `and "activadoAt" is null` es el mismo guardia que usa el código. No lo
   quites: es lo que hace segura esta consulta si alguien la ejecuta dos veces.

### Después de una caída o un mantenimiento

Barrido de todo lo que quedó en el aire durante la ventana:

```sql
select id, "clienteId", monto, estado, "createdAt", "referenciaExterna"
  from pago_intentos
 where "activadoAt" is null
   and estado in ('REDIRIGIDO','CREADO')
   and "createdAt" between '<inicio de la ventana>' and '<fin de la ventana>'
 order by "createdAt";
```

Cada fila se contrasta **una por una** contra el panel de CardNET. Las que
tengan cobro real se resuelven como el caso puntual; las que no, se marcan
`EXPIRADO`.

---

## 4 · Si fallan TODOS los pagos, no uno

Ya no es conciliación: es una caída de la integración.

- ¿Están `CARDNET_MERCHANT_ID`, `CARDNET_TERMINAL_ID` y `CARDNET_AUTH_KEY` en
  Vercel? Sin ellas la pasarela **no se ofrece** aunque la capacidad
  `PAGO_CARDNET` esté encendida — a propósito, para que una capacidad activada
  por error no deje al cliente en una pantalla rota.
- ¿`CARDNET_AMBIENTE` dice `produccion`? Si quedó en `pruebas`, los cobros van
  al entorno de pruebas y no existen.
- ¿Se rotaron las credenciales de comercio? Llama a CardNET.
- Vercel → Logs, filtra por `cardnet`.

Mientras tanto: **desactiva la capacidad `PAGO_CARDNET`** para esa empresa
desde el superadmin. Es mejor que el cliente vea "paga por transferencia" que
una pasarela que falla en el último paso.

---

## 5 · No hagas esto

- **No entregues el producto sin confirmar el cobro en CardNET.** Es el fraude
  más fácil que existe contra este negocio: "pagué y no me llegó".
- **No pongas `CARDNET_AUTH_KEY` en la base de datos ni la imprimas en un log.**
  Es un secreto y vive solo en variables de entorno.
- **No borres filas de `pago_intentos`.** Son la evidencia ante una disputa,
  incluidas las de los intentos fallidos. `respuesta` guarda el payload crudo
  justo para eso.
- **No reproceses en masa** con un script. Estas conciliaciones se hacen una a
  una porque cada una es dinero real de una persona concreta.

---

## 6 · Después

- Si el hueco lo causó una ventana de mantenimiento, anótalo en
  `docs/RECUPERACION.md` § 7: es el coste real de cerrar, y sirve para decidir
  la próxima vez si se cierra en sábado o se espera al martes.
- Si el aviso se perdió sin que hubiera caída, el problema es la entrega del
  webhook. Merece revisarse con CardNET: un aviso perdido de vez en cuando es
  operativa; uno de cada diez es un defecto.

---

## 7 · Renovación automática con tarjeta guardada

**Síntoma:** «la renovación no corrió», «el cliente recibió un aviso de rechazo»,
«desactivamos la renovación» (y el cliente pregunta por qué), o un cobro
automático que **no se sabe si salió**.

Qué hace el sistema (detalle en `docs/PAGOS-CARDNET.md` § 6):

1. **7 días antes** del vencimiento avisa al cliente («se renovará automáticamente»).
2. **Desde 3 días antes** el cron (a diario, 12:00 UTC) intenta cobrar la tarjeta guardada.
3. Un **rechazo real** avisa al cliente y se reintenta al día siguiente, hasta
   **3 rechazos** y siempre antes del vencimiento. Al agotarse apaga
   `autoRenovar`, retira el consentimiento de renovar y **conserva la tarjeta**.
4. Un cobro **sin respuesta** (o que la pasarela dice que «ya se procesó») **no
   es un rechazo**: no se avisa al cliente y **no se repite solo**, porque pudo
   haber salido. Es el caso que se concilia a mano (abajo).

### Si la renovación no corrió

Mira, **en orden**: `autoRenovar` encendido · **consentimiento de renovar vigente**
(`consentimientos_pago`, `revocadoAt` vacío) · tarjeta `activa` y **del mismo
cliente** · la tarjeta tiene `paymentProfileId` o un token · la membresía está
`ACTIVA` y vence entre hace 3 días y **dentro de 3** · no se pagó hace menos de 20
horas · el ciclo no está **bloqueado** (abajo) · si el cliente aceptó un texto que
promete aviso, **consta el aviso previo** · la tarjeta no está vencida · la
capacidad `PAGO_CARDNET` sigue encendida.

El cron responde `{candidatas, renovadas, rechazadas, desactivadas, omitidas,
sinAviso, bloqueadas, errores, inciertas, avisos}`. Una `omitida` no es un fallo,
es una de las razones de arriba. **`bloqueadas` e `inciertas` son las que hay que
mirar a diario**: cada una es un cobro que pudo haber salido y que nadie va a
repetir solo.

### Qué significa lo que se ve

| Síntoma | Qué significa | Qué hacer |
|---|---|---|
| Renovación `RECHAZADO` | El banco o la pasarela dijeron que no. El motivo está en `motivoRechazo`, la respuesta cruda en `respuesta` y el asiento en la auditoría (`PAGO_RECHAZADO`, con el número de rechazo). **Al cliente se le avisó.** | Nada si es normal (fondos, límite). Un patrón repetido sin motivo claro se revisa con CardNET |
| «Desactivamos la renovación automática» (el cliente lo recibió y pregunta) | El sistema apagó `autoRenovar` tras un rechazo definitivo (14, 41, 43, 54), tres rechazos, o por no quedar tiempo antes del vencimiento (el asiento dice cuál: `causa`). El consentimiento quedó retirado y **la tarjeta sigue guardada** | Que renueve a mano. **No** enciendas `autoRenovar` a mano |
| Omitida por «Un intento anterior no tiene resultado confirmado» (`razon: incierta`) | Un cobro se cayó sin respuesta, o la pasarela dio 500, o el código 94, o un intento quedó `CREADO` sin cerrar. **Puede haberse cobrado.** No se avisó al cliente | **Concilia a mano** (abajo). Aparece en la Conciliación como «Renovaciones automáticas con resultado dudoso» y en Observabilidad como *Renovaciones por conciliar* |
| Omitida por «Hay un cobro aprobado sin entregar» (`razon: cobrada`) | El cobro **sí salió** y la extensión falló. Cobrar otra vez sería el doble cargo | Es un caso de la Conciliación («Pagos cobrados con entrega pendiente»): **«Reintentar entrega»** extiende la membresía sin recobrar |
| Omitida por «Falta el aviso previo al cliente» (`sinAviso`) | Quien aceptó un texto que promete aviso antes de cada cobro no se cobra sin él. Pasa si el cliente no tiene cuenta donde dejarlo, o si el paso de avisos del cron falló ese día | Mira el campo `avisos` de la respuesta del cron. Sin cuenta, la renovación no puede ser automática: que renueve a mano |
| Omitida por tarjeta vencida | CardNET entregó el vencimiento y ya pasó: no se intentó el cobro, se apagó la renovación y se avisó | Que registre una tarjeta vigente al pagar |

### Conciliar una renovación dudosa

Los cobros automáticos cuyo resultado se desconoce (la cifra es *Renovaciones por
conciliar* en Observabilidad; también salen en la Conciliación):

```sql
select pi.id, pi."membershipId", pi.estado, pi.monto, pi."createdAt",
       pi.respuesta->>'_clasificacion' as clasificacion,
       pi."motivoRechazo",
       right(regexp_replace(pi.id, '[^A-Za-z0-9]', '', 'g'), 12) as referencia_cardnet
  from pago_intentos pi
 where pi.canal = 'RENOVACION_AUTOMATICA'
   and pi."createdAt" > now() - interval '14 days'
   and (
        (pi.estado = 'ERROR' and pi.respuesta->>'_clasificacion' = 'incierto')
     or (pi.estado = 'CREADO' and pi."createdAt" < now() - interval '15 minutes')
   )
 order by pi."createdAt";
```

Para cada fila, busca en el panel de CardNET la transacción con la **referencia**
(`referencia_cardnet`: son los últimos 12 caracteres del id del intento, que es
el `Order` y el `UniqueID` que se le mandó). Hay dos desenlaces:

- **CardNET SÍ cobró.** Registra el cobro como aprobado. Desde ese momento entra
  por el camino de siempre: aparece en «Pagos cobrados con entrega pendiente» y
  su botón **«Reintentar entrega»** extiende la membresía y deja la venta, **sin
  volver a cobrar**. (El `and` evita tocar lo que ya se entregó.)

  ```sql
  update pago_intentos
     set estado = 'APROBADO',
         autorizacion = '<código de autorización de CardNET>',
         "activadoAt" = coalesce("activadoAt", now())
   where id = '<id del intento>'
     and "fulfillmentEstado" <> 'COMPLETADA';
  ```

- **CardNET NO cobró.** Quita el bloqueo para que el siguiente cobro automático
  lo reintente (si todavía cae dentro de la ventana). Un intento que quedó
  `CREADO` primero se pasa a `ERROR`:

  ```sql
  update pago_intentos
     set estado = 'ERROR',
         respuesta = coalesce(respuesta, '{}'::jsonb) || '{"_clasificacion":"conciliado_no_cobrado"}'::jsonb
   where id = '<id del intento>'
     and estado in ('ERROR', 'CREADO');
  ```

Si la ventana ya pasó, no hace falta nada más: la membresía vence y el cliente
renueva a mano. **No repitas el cobro desde el panel de CardNET** sin haber mirado
antes los dos desenlaces.

### Consultas útiles

Las tarjetas guardadas del cliente (sin el token, que no se copia a ningún sitio):

```sql
select t.id, t.marca, t.ultimos4, t."vencMes", t."vencAnio", t.activa,
       t.predeterminada, t."eliminacionPendiente", t."createdAt"
  from tarjetas_tokenizadas t
  join clientes c on c.id = t."clienteId"
 where c.email = '<correo del cliente>'
 order by t."createdAt" desc;
```

Qué aceptó el cliente sobre su tarjeta y membresía (la evidencia ante una
disputa). `HEREDADO` = existía antes de que hubiera este registro: no hay texto
exacto.

```sql
select c.tipo, c.origen, c."textoVersion", c."otorgadoAt", c."revocadoAt",
       c."tarjetaId", c."membershipId", c."ipAddress"
  from consentimientos_pago c
  join clientes cl on cl.id = c."clienteId"
 where cl.email = '<correo del cliente>'
 order by c."otorgadoAt" desc;
```

Los cobros de renovación de una membresía (`canal` dice si lo inició el cron):

```sql
select pi.id, pi.estado, pi.monto, pi."motivoRechazo", pi."createdAt",
       pi."activadoAt", pi."fulfillmentEstado", pi.canal,
       pi.respuesta->>'_clasificacion' as clasificacion
  from pago_intentos pi
 where pi."membershipId" = '<id de la membresía>'
   and pi.proveedor = 'CARDNET'
 order by pi."createdAt" desc
 limit 10;
```

No hagas esto:

- **No enciendas `autoRenovar` a mano** en la base: sin tarjeta activa y sin un
  consentimiento vigente no cobra, y no se debe fabricar un consentimiento para
  que cobre. Si el cliente lo pidió por otro canal, que lo active él.
- **No edites ni borres filas de `consentimientos_pago`.** Solo se inserta, y lo
  único que cambia de una fila es `revocadoAt`, una vez.
- **No copies el token de una tarjeta** a un ticket, un chat o una hoja: es una
  referencia con la que se puede cobrar.
