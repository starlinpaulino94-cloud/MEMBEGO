# Runbook · Hay que revertir un despliegue

> **Síntoma que ves:** algo se rompió justo después de desplegar y no está
> claro qué.

**Impacto:** depende de qué se rompió. Lo que este runbook decide es otra cosa:
**qué se puede deshacer y qué no**, porque no todo lo que se despliega se
revierte igual y confundirlo convierte un incidente de diez minutos en uno de
un día.

---

## 1 · Lo primero, antes de decidir nada

**Apaga lo que sobra antes de revertir lo que no se puede.** Membego tiene
interruptores que cortan el procesamiento sin tocar el código ni la base:

```
/superadmin/supply-v2/operaciones  →  capacidades
```

| Capacidad | Apágala si… | Qué sigue funcionando |
|---|---|---|
| Pagos externos | entran avisos y se procesan mal | el panel, la búsqueda, resolver incidentes a mano |
| Entrega del outbox | salen avisos equivocados | apuntar efectos: no se pierde ninguno |
| Barrido de conciliación | el barrido abre incidentes falsos | la conciliación del webhook y la manual |
| Automatizaciones | salen avisos de vencimiento indebidos | los avisos de una compra o un pago |

Apagar exige motivo y queda auditado. **Casi siempre esto es suficiente** y
evita revertir. Un interruptor se vuelve a encender en segundos; un revert hay
que volver a desplegarlo.

---

## 2 · Qué se puede revertir y qué no

### Se revierte sin pensarlo

- **El código de la aplicación.** Un despliegue anterior en Vercel se
  restaura desde el panel de despliegues. Es reversible porque no deja rastro.

### NO se revierte: se arregla hacia delante

- **Una migración aplicada.** Las migraciones de Membego son ADITIVAS a
  propósito —columnas y tablas nuevas, nada que se quite— justo para que el
  código viejo siga funcionando con el esquema nuevo. Volver el código atrás es
  seguro; volver la MIGRACIÓN atrás no, porque los datos escritos mientras
  tanto se quedan sin sitio. Si la migración es el problema →
  [`migracion-fallida.md`](migracion-fallida.md).
- **Un pago confirmado, un derecho emitido, una liquidación pagada.** Son
  hechos económicos. No se deshacen con un despliegue: se corrigen con el
  servicio que corresponde, dejando rastro.
- **Un incidente resuelto.** La resolución ya movió dinero por el servicio
  oficial. Se corrige con otro movimiento, no borrando el anterior.

### Requiere arreglo hacia delante

- **Un dato escrito mal por el código nuevo.** Revertir el código detiene la
  hemorragia pero no limpia lo escrito. Hace falta las dos cosas, en ese orden.

---

## 3 · El orden

1. **Apaga** la capacidad afectada (§ 1). El proveedor reintentará lo que no
   entre; nada se pierde.
2. **Comprueba** si el síntoma para. Si para, ya tienes el culpable acotado y
   tiempo para pensar.
3. **Restaura** el despliegue anterior si el problema es de código.
4. **NO toques las migraciones.** Si el esquema es el problema, ve a su runbook.
5. **Enciende** la capacidad y confirma con el Centro de Operaciones, no de
   memoria.

---

## 4 · Confirmar que la reversión funcionó

```bash
curl -s https://<dominio>/api/health/ready | head -c 300
```

Y en el panel: los seis componentes en `SANO`, o en un estado que sepas
explicar. **`APAGADO` no es un fallo** —es una decisión tuya— pero acuérdate de
deshacerla.

---

## 5 · Qué NO hacer

- **No revertir una migración** para «dejarlo como estaba». Es la forma más
  rápida de convertir un incidente en pérdida de datos.
- **No desplegar a ciegas encima.** Si no sabes qué se rompió, apagar es más
  seguro que añadir otra variable.
- **No dejar un interruptor apagado sin anotarlo.** El motivo es obligatorio
  justo para que quien llegue después no lo encienda sin saber por qué estaba
  apagado.

---

## 6 · Criterio de recuperación

- El síntoma desapareció y sabes POR QUÉ, no solo que desapareció.
- `/api/health/ready` responde y los componentes están explicados.
- Los interruptores que apagaste, encendidos otra vez —o apagados con un motivo
  que alguien más entendería—.
- Lo que se escribió mal durante el incidente, identificado: aunque se corrija
  después, tiene que estar acotado antes de cerrar.

## 7 · Escalamiento

Si hay que tocar datos financieros para recuperar, para y escala. Esa clase de
corrección no se improvisa durante un incidente.
