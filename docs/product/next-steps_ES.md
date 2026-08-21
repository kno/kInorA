# Mejoras y siguientes pasos

> 🇬🇧 [English version](./next-steps.md)

Ordenados por lo que primero impediría lanzar, no por lo que primero apetece construir.

---

## 1. Bloqueantes para un lanzamiento real

**No hay correo transaccional.** No existe ninguna integración de envío de correo en el repositorio. Sin ella no hay verificación de dirección, ni recuperación de contraseña, ni aviso de fin de prueba, ni recibo de pago. Es la carencia más grande entre el estado actual y un producto que se pueda poner delante de un usuario que pague.

**No se mide el coste por usuario.** Los topes del nivel Pro están fijados como techo de seguridad y no a partir de un consumo observado. Langfuse ya traza modelo, tokens y latencia de cada llamada, así que falta agregar esa traza por tenant y contrastarla con el precio. Sin ese dato, cualquier precio es una conjetura.

**El almacenamiento de objetos escribe en el sistema de ficheros del VPS.** El puerto está bien definido y el adaptador es intercambiable, pero en producción el directorio debe estar montado en un volumen fuera de la imagen para que los logotipos sobrevivan a un redespliegue. Es una condición operativa que hoy depende de que alguien la recuerde.

**La generación en curso se pierde en un reinicio.** La ejecución es en proceso y sin cola, decisión consciente para un despliegue de un solo nodo, con el coste anotado en su propio documento de diseño: un reinicio deja planes atascados en estado de generación. Con un usuario es una molestia; con mil es un incidente.

---

## 2. Producto: cerrar lo abierto

`16c-v3-b2b-seat-billing`, la facturación por asiento, está en curso. `16b-v3-gym-admin-multigym`, la administración de gimnasios con analítica agregada y multisede, está especificada y sin empezar. Son las dos piezas que faltan para que el nivel Gym sea un producto vendible y no una capacidad técnica.

Queda además una decisión de producto explícitamente aplazada: **el reparto de los días de entrenamiento en la semana**. Hoy el tablero coloca las sesiones planificadas en los primeros huecos desde el lunes como convención de visualización, porque el modelo no tiene anclaje al calendario. Resolverlo bien implica dejar que la persona elija sus días, y eso toca el modelo de datos.

En la misma línea, **todo el agrupamiento por día y semana se calcula en UTC**, sin zona horaria por usuario. Alguien que entrene de noche fuera de UTC puede ver un día desplazado en el tablero o un extremo de racha corrido. Las funciones puras ya aceptan la referencia horaria como parámetro, así que el cambio no es rompedor, pero requiere una columna de zona horaria y una migración.

---

## 3. Deuda técnica identificada

La **normalización de nombres de ejercicio no fusiona sinónimos**, de modo que dos formas de nombrar el mismo movimiento generan récords personales distintos y fragmentan el historial. Está documentado como limitación conocida en su propio diseño.

El **clasificador de grupo muscular** etiqueta a partir del título en texto libre. Los títulos que no reconoce quedan sin clasificar y se excluyen de la distribución, lo cual es correcto; el problema es que mejorar el clasificador no corrige las filas ya etiquetadas mal, porque el relleno retroactivo solo alcanza a las nulas. Hará falta una reclasificación versionada.

`GOOGLE_TTS_STYLE_DIRECTIVE` **no es configurable dentro de un contenedor**, porque el sintetizador la resuelve con un operador que trata la cadena vacía como valor válido y Compose interpola una variable no definida como cadena vacía. Hacerla configurable exige que el adaptador trate el vacío como ausencia.

Existe una **carpeta de cambio duplicada** en `openspec/changes/`, resto de un archivado incompleto. Es cosmético pero ensucia la fuente de verdad.

Y hay dos vías móviles conviviendo: la aplicación nativa con Expo y el envoltorio de Capacitor sobre la compilación web. Conviene decidir si el segundo sigue teniendo función o es herencia que retirar.

---

## 4. Las preguntas que un tribunal hará

Estas no son tareas, son líneas de investigación abiertas. Merecen estar en la memoria precisamente porque no tienen respuesta todavía.

**¿Cómo se mide si un plan generado es bueno?** Es la pregunta más importante del proyecto y hoy no tiene métrica. No existe forma automática de saber si cambiar de modelo mejora o empeora los planes: se puede medir latencia y coste, pero no calidad. Un camino razonable sería una rúbrica evaluada por profesionales sobre un conjunto fijo de casos, incluidos casos con limitación, que permitiera comparar proveedores sobre algo más que el precio. La arquitectura ya lo pone fácil: cambiar de proveedor es un clic, así que solo falta el criterio.

**¿La adaptación por limitación es segura?** El sistema genera avisos y sustituciones, nunca diagnóstico, y esa frontera está bien defendida en el código. Pero no ha sido validada por profesionales sanitarios sobre casos reales. Antes de vender esa función como diferencial habría que hacerlo.

**¿Qué proveedor conviene?** Ahora es una decisión operativa reversible, lo cual es una ventaja considerable. Falta el experimento que la informe: mismo conjunto de casos, varios proveedores, comparación de calidad, coste y latencia.

**¿Mejora la memoria los planes?** La memoria persistente es un diferencial declarado. Nadie ha comprobado todavía si un plan generado con memoria es mejor que uno generado sin ella. Es una pregunta contestable con un experimento A/B modesto y sería una de las contribuciones más interesantes del trabajo.

---

## 5. Si hubiera que elegir tres cosas

Instrumentar el coste por usuario, porque sin eso el modelo de negocio es una hipótesis.

Definir una métrica de calidad del plan generado, porque sin eso la arquitectura multiproveedor es una capacidad que no se puede aprovechar.

Integrar el correo transaccional, porque sin eso no hay producto que lanzar.

Las tres son pequeñas comparadas con lo ya construido, y las tres separan un trabajo académico terminado de un producto que puede recibir a su primer usuario de pago.
