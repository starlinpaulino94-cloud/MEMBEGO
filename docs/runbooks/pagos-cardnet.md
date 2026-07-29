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
