# Satélite de restaurante

Sistema aparte, con su propia base de datos, que habla con MembeGo **solo por
HTTP**. Es la demostración de *Shared Data Contracts, not Shared Database*.

La explicación completa —y por qué cada decisión es como es— está en
[`docs/platform/restaurante.md`](../../docs/platform/restaurante.md).

## Puesta en marcha

```bash
# 1 · Su base de datos. NO es la de MembeGo.
export RESTAURANT_DATABASE_URL="postgresql://usuario@host:5432/restaurante"
npx prisma db push --schema prisma/schema.prisma

# 2 · Las tres variables que imprime el registro del sistema en MembeGo
#     (scripts/registrar-sistema.ts).
export MEMBEGO_BASE_URL="https://membego.com"
export MEMBEGO_CLIENT_ID="..."
export MEMBEGO_CLIENT_SECRET="..."
export MEMBEGO_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."
```

## Verificación contra base y HTTP reales

```bash
npx tsx ../../scripts/verificar-satelite-restaurante.mts
```

Levanta el servidor, firma eventos con la función del propio Core y comprueba
firma, inbox, orden de llegada y aislamiento de la base.

## Reconciliación

`reconciliar()` refresca las copias más viejas contra el Core, con presupuesto
por pasada. Es lo que arregla un webhook que **no llegó nunca** — el inbox y el
orden por `occurredAt` no hacen nada en ese caso.

```ts
const resumen = await reconciliar(membego, almacen, { presupuesto: 50 })
if (seEstaQuedandoAtras(resumen)) {
  // La tarea no da la vuelta: hay copias más viejas que la tolerancia.
  // Subir el presupuesto o correrla más a menudo.
}
```

Se dispara por HTTP, para que lo llame cualquier programador:

```bash
# En el cron, cada hora:
curl -X POST https://restaurante.midominio.com/tareas/reconciliar \
  -H "Authorization: Bearer $RECONCILIACION_SECRET"
```

El cerrojo entre pasadas es un **arrendamiento en una fila**, no un advisory
lock: esos son de la sesión de PostgreSQL y Prisma habla por un pool, así que
tomar y soltar pueden caer en conexiones distintas.

## La regla

> **La copia local muestra. No decide.**

`clientes_proyectados` sirve para pintar una pantalla al instante y para
aguantar cuando MembeGo no responde. Un beneficio se consume **siempre** contra
el Core.

Por eso esa tabla no tiene saldos ni usos restantes, y hay una prueba que falla
si alguien se los añade.
