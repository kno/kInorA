# Modelo de negocio

> 🇬🇧 [English version](./business-model.md)

Los niveles, los límites y las reglas de este documento están tomados del código, no de un plan comercial. Los valores concretos salen de `apps/api/src/billing/pricing-config.ts` y `plan-limits.ts`; las reglas, de la especificación `11a-v1-billing-plans-tiers`.

---

## 1. Cuatro niveles

| Nivel | A quién sirve | Estado |
|---|---|---|
| `free` | Uso individual básico | Activo |
| `pro` | Uso individual completo | Activo |
| `trainer` | Entrenador con clientes | Implementado |
| `gym` | Gimnasio con marca blanca | Implementado |

El nivel efectivo se resuelve por precedencia: primero una anulación administrativa vigente, después el estado de facturación del tenant, y solo entonces el nivel base. Las columnas de Stripe son metadatos y **no participan** en esa resolución: es el webhook quien traduce la suscripción a estado y nivel. Esa separación evita tener dos fuentes de verdad sobre qué puede hacer un usuario.

---

## 2. Qué se mide

Se facturan cuatro características, y solo cuatro:

| Característica | Free | Pro | Trainer | Gym |
|---|---:|---:|---:|---:|
| Generación de plan | 1 | 500 | 1.000 | 500 |
| Regeneración de plan | 1 | 1.000 | 2.000 | 1.000 |
| Escritura de memoria | 0 | 50.000 | 100.000 | 50.000 |
| Recuperación de memoria | 0 | 200.000 | 400.000 | 200.000 |

Los límites son por mes natural, en UTC. Un cero no significa «ilimitado» sino **bloqueado por nivel**: la memoria vectorial es una capacidad de pago, y en el nivel gratuito la recuperación se omite entera antes de generar ningún embedding.

El nivel Trainer duplica los topes de Pro y además escala por número de asientos. El nivel Gym iguala a Pro. La razón de que Trainer nunca esté por debajo de Pro está escrita en la especificación: para que un tenant de entrenador no acabe tratado en silencio como gratuito.

El chat conversacional no consume cuota. Se controla por nivel: es una capacidad Pro y punto. Se decidió así en lugar de crear un medidor por turno, asumiendo conscientemente que el coste marginal de la conversación queda sin medir. Es una decisión revisable y aparece en los siguientes pasos.

---

## 3. La prueba

Cada tenant nuevo —personal o gestionado por un entrenador— arranca con **30 días de Pro**, sin tarjeta.

Lo interesante es qué pasa al expirar. La especificación lo fija explícitamente: la expiración **preserva** los datos del tenant, las asignaciones de sus miembros, los planes, las memorias y el historial, y lo único que hace es bloquear la generación premium por encima de los límites gratuitos y el uso premium de la memoria vectorial.

Nada se borra al caducar la prueba. Es una decisión de producto con consecuencia comercial directa: quien vuelve tres meses después encuentra su historial intacto, y recuperar a alguien que ya tiene datos dentro es mucho más barato que captar a alguien nuevo.

---

## 4. Cobro

Stripe, con ciclo mensual o anual y euro como divisa por defecto. Los importes de visualización viven en configuración y alimentan la página de precios y el distintivo de ahorro anual, pero **no cobran nada por sí mismos**: lo que factura es el identificador de precio de Stripe.

Los cupones son códigos de promoción de Stripe validados **en el servidor antes** de abrir la sesión de pago, de modo que un código inválido o caducado se rechaza sin generar una sesión huérfana. Sirven para campañas y para programas de recomendación.

Hay además una vía administrativa para conceder un nivel manualmente durante una ventana temporal, pensada para acuerdos comerciales y pruebas extendidas. Es auditable: conceder deja registro, revocar es una transición de estado y nunca un borrado, y solo puede haber una concesión activa por tenant, de modo que reconceder exige revocar primero en lugar de sustituir en silencio.

El webhook es idempotente y tolerante al desorden, y ante cualquier error devuelve 5xx **sin conceder nunca** el nivel de pago. Fallar hacia el lado que no regala producto.

---

## 5. La cuota es híbrida y esto es una decisión de producto

Podría haber una única bolsa por organización. Se eligió un modelo híbrido, con bolsa de tenant y tope por miembro, porque un entrenador necesita a la vez controlar el gasto total y repartirlo con equidad entre sus clientes.

El coste es tener dos contadores en lugar de uno. La contrapartida es que el titular puede administrar el reparto, y que los datos que ve al hacerlo son **solo agregados y recuentos**: la administración de cuota no revela prompts, memorias ni contenido privado de sus miembros. Gestionar el gasto de alguien no da derecho a leer lo que escribe.

---

## 6. Economía por unidad: lo que no se sabe todavía

Aquí conviene ser franco, porque es la pregunta que un tribunal hará.

El coste variable dominante es la llamada al modelo. Con la arquitectura actual el proveedor es conmutable en caliente entre OpenRouter, OpenAI, Anthropic, Google y OpenCode-Go, lo que convierte la elección en una palanca económica real y no en una migración.

Pero **el coste por usuario no está medido**. No hay instrumentación de coste por tenant ni por generación, y los topes de Pro —quinientas generaciones al mes— están dimensionados como techo de seguridad, no a partir de un consumo observado. Con el precio de un modelo pequeño esas quinientas generaciones son perfectamente sostenibles; con un modelo grande, no necesariamente.

Langfuse ya traza cada llamada con su modelo, sus tokens y su latencia, así que la instrumentación necesaria está a un paso. Es lo primero que habría que hacer antes de fijar un precio de verdad.

---

## 7. Palancas de conversión

La conversión natural es la caducidad de la prueba con los datos intactos: el usuario ya tiene su plan, su historial y su memoria dentro.

El límite gratuito de una generación y una regeneración al mes está deliberadamente ajustado. Permite probar el producto de verdad —se genera un plan completo y se puede rehacer una vez— y no permite vivir en gratuito indefinidamente si se entrena en serio, porque cambiar de objetivo o de material exige regenerar.

La memoria es la palanca menos evidente y quizá la más potente: es la capacidad que mejora con el uso. Cuanto más tiempo lleva alguien usando el producto, más contexto tiene el sistema y más caro le resulta empezar de cero en otro sitio.
