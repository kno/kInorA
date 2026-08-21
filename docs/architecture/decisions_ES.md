# Catálogo de decisiones de arquitectura

> 🇬🇧 [English version](./decisions.md)

Destilado de los cuarenta y dos cambios archivados en `openspec/changes/archive/`. Los documentos de diseño suman 578 KB y contienen **más de ciento sesenta decisiones** con su contexto, sus alternativas y el motivo del descarte.

Este catálogo no las reproduce todas: recoge las que tienen consecuencia estructural y, sobre todo, extrae los patrones que se repiten. El registro completo, con su rastro de auditoría, sigue estando en el archivo de `openspec`.

---

## 1. Por qué existe este registro

El proyecto sigue un ciclo dirigido por especificación: proponer, especificar, diseñar, descomponer en tareas, aplicar, verificar y archivar. La fase de diseño exige documentar las decisiones con su razonamiento y la configuración lo dice explícitamente: *«Document architecture decisions with rationale»*.

El efecto secundario es que existe un registro de por qué el sistema es como es, escrito **antes** de escribir el código y no reconstruido después. Es la diferencia entre una justificación y una racionalización.

---

## 2. Cimientos

**El aislamiento de capas se verifica, no se declara.** La arquitectura limpia decía que el dominio no podía depender de infraestructura, pero nada lo impedía. Se incorporó `dependency-cruiser` con reglas prohibidas encadenadas al `build`. Se descartó ampliar el guarda propio porque *«hand-rolled scanning is brittle for TS aliases and relative imports»*, y `eslint-plugin-boundaries` por arrastrar toda la configuración de ESLint. Una violación de capa rompe la construcción con un error nombrado.

Se reforzó con una prueba ejecutable: un test que demuestra que un caso de uso corre sin framework, interfaz, red ni base de datos, escrito primero en rojo.

**Dominio y contratos son paquetes distintos.** Situar el dominio dentro de la API se descartó porque debe ser reutilizable *«by API, web, and future mobile shell without framework coupling»*. Y los contratos no pueden vivir dentro del dominio porque son más estables y los consume la interfaz sin arrastrar casos de uso. La regla `contracts-no-workspace-deps` los mantiene como hoja del grafo.

**Versiones exactas y runtime fijado.** Nada de rangos con circunflejo: *«exact versions ensure reproducible installs»*.

---

## 3. Multi-tenencia y autorización

**Membresía en lugar de columna de tenant.** Un `users.tenantId` obligatorio habría sido más corto, y se descartó porque *«membership avoids the single-tenant shortcut and supports future Trainer/B2B access»*. Dos versiones después, esa decisión es la que permite que un cliente pertenezca a la vez a su tenant personal y al de su entrenador.

**Contexto de tenant obligatorio en el repositorio.** Los métodos sobre entidades con tenant exigen un contexto que se valida antes de llegar al ORM, de modo que su ausencia falla **antes** de tocar la persistencia. La alternativa —parámetro opcional o convención global— se descartó porque no es demostrable en un test.

**404 y no 403 ante recurso ajeno.** Las lecturas exigen la tripleta tenant, usuario e identificador y devuelven ausencia, que las rutas traducen a *not found*. Se eligió sobre 403 porque *«avoids resource existence leaks»*. Una respuesta 403 confirma que el recurso existe.

**Un único punto de decisión para el acceso del entrenador.** Al permitir que un entrenador opere sobre datos de su cliente, la comprobación podría haberse repetido en cada método de repositorio. Se descartó porque dispersa el control entre unos ocho métodos con alto riesgo de olvido. En su lugar, un único resolutor en la capa de rutas: *«Single choke point = deny-by-default and provable»*. También se descartó un servicio de suplantación que intercambiara la identidad de sesión, por novedoso y difícil de revisar.

**El acceso inverso no reutiliza el mismo resolutor.** Cuando el cliente necesita leer el plan que su entrenador creó en otro tenant, se creó una primitiva distinta y una ruta propia, porque la relación no es simétrica. La alternativa era conmutar el tenant en el inicio de sesión, y se descartó con una frase que vale por todo el análisis de riesgo: *«changes the session tenant for ALL requests of EVERY dual-membership user — a broad blast radius on the core sign-in surface»*. Coste final: cero líneas modificadas en el flujo de autenticación.

**Revalidación de pertenencia en cada petición.** La sesión no basta: la membresía se relee siempre y se deniega si no está activa, cerrando la ventana en que alguien suspendido conservaría acceso hasta que caducase su token.

---

## 4. Identidad

**Sesiones opacas en base de datos frente a JWT.** Se descartó el token sin estado porque *«JWT makes revocation and stale tenant claims harder»*. Se paga una consulta por petición y se gana revocación inmediata y cambios de tenant efectivos al instante.

**scrypt en lugar de Argon2id.** Aquí la decisión es honesta y está anotada como tal: Argon2id es hoy el algoritmo preferente, y se rechazó por preocupaciones de mantenimiento de la librería. Queda `crypto.scrypt` del núcleo de Node, memory-hard y recomendado por OWASP.

**OIDC genérico desde el primer proveedor.** Google es la primera implementación, no la única prevista: el esquema `oauth_accounts` es genérico y añadir un proveedor debe ser *«a config entry + OIDC issuer metadata, not flow changes»*. El enlace de cuentas exige correo verificado, cerrando la apropiación de cuentas por correos no confirmados.

**La protección en el middleware de Next es solo de interfaz.** El propio documento lo advierte: es *«frontend only»* y no constituye un fallo cerrado frente a un 401 de la API. Reconocer el límite de una capa es más valioso que fingir que no lo tiene.

---

## 5. Datos

**Instantánea relacional al iniciar el entrenamiento.** El plan generado vive como JSON mutable. Guardar solo índices contra él se descartó porque copiar el contexto planificado a tablas propias *«preserve[s] workout history after regenerate/edit and keep[s] tracker reads relational instead of coupled to mutable JSON»*. Se duplica información a propósito para que el historial sobreviva a una regeneración.

**Nombres explícitos para evitar colisión semántica.** `sessions` ya significaba tokens de autenticación y `WorkoutSession` ya significaba un día del plan. De ahí `workout_sessions`, `session_exercises` y `set_records`. Verboso y sin ambigüedad.

**Invariantes en la base de datos.** Una sola sesión activa por usuario es un índice único parcial, no una validación de servicio. Cuando dos versiones después llega la sincronización offline y el cierre automático de sesiones caducadas, ese índice es lo que impide que una condición de carrera cree un estado imposible.

**Cambio incompatible en el sitio, sin campos aditivos.** Al modificar `PlanSpec` se descartó añadir un campo opcional o crear un tipo paralelo, porque el compilador del monorepo *«catches all consumers atomically; no permanent cruft»*. Es la decisión contraria a la habitual, y se justifica por tener un único repositorio con verificación de tipos global.

**Migraciones aditivas y reversibles.** Columnas anulables, sin relleno retroactivo, con la reversión definida como borrado de columna sin pérdida. Se repite en el nombre del plan, el día de la sesión, el grupo muscular, las métricas corporales y el archivado.

**Archivar en lugar de borrar, con el filtro en el repositorio.** Colocar el filtro en la ruta o en la página se descartó con una frase que merece citarse: *«a default that must be requested at every call site is not a default»*. Y la prohibición de borrado se refuerza con un test que nombra explícitamente `plan_specs`, porque su cascada llegaría hasta las series registradas y destruiría el historial sin tocar ninguna ruta de planes.

---

## 6. Inteligencia artificial

**Puerto antes que proveedor, desde el primer día.** El acceso al modelo se definió detrás de un puerto y la salida se valida con esquema en lugar de parsear JSON en bruto. Se descartó el SDK directo de un proveedor concreto para no comprometerse con un solo vendedor.

**Generación asíncrona sin infraestructura de colas, con el coste anotado.** Se descartó una cola real por ser la versión 1 de un solo nodo, y el documento reconoce el precio: un reinicio pierde las generaciones en curso y deja planes atascados. No se disfraza de decisión inocua.

**La recuperación de memoria vive en el servicio, no en el adaptador.** Mutar el prompt dentro de cada adaptador habría roto el puerto. Situarla antes permite además que falle en abierto sin llegar a las trazas.

**Memoria vectorial en el Postgres existente.** Una base de datos vectorial externa se descartó porque quedarse en Postgres conserva *«tenant/user predicates, cascade deletion, migrations, and rollback inside the existing Postgres/Drizzle model»*.

**Memorias solo por confirmación explícita.** La extracción automática desde la conversación se descartó por el riesgo de capturar transcripciones en bruto, secretos y datos de salud. Se pierde cobertura y se gana privacidad por diseño.

**El proveedor de embeddings se persiste con cada fila.** Fijar el modelo en código se descartó porque cambiarlo invalidaría silenciosamente el almacén. Guardando modelo, versión y dimensión en la fila, una cohorte incompatible se excluye explícitamente en lugar de devolver resultados sin sentido.

**Rechazar la plantilla remota entera, nunca repararla.** Al externalizar los prompts, una plantilla mal editada podía romper el producto. La validación en frontera rechaza y cae a la versión compilada; reparar una sección reubicada se descartó porque *«relocated closed-vocabulary section is rejected, not repaired»*: el orden es contrato. Una caída del gestor de prompts no puede detener la generación.

**Dialecto de plantilla reducido a sustitución literal.** Se descartaron Mustache, Handlebars y el motor de plantillas de LangChain, este último porque *«would also reinterpret the JSON braces in the output-format block»*. El renderizador cabe en quince líneas y es demostrablemente total.

**La redacción de trazas se hace en el hook del SDK.** Enmascarar antes de invocar es imposible para las métricas corporales, porque las quitaría también al modelo. Se descartó un registro por petición con contexto asíncrono con el argumento decisivo: *«fails open if context is ever lost, which is unacceptable for a privacy control»*. Se descartó además un manejador por petición por fragmentar el ciclo de vaciado.

**Y por si la regla falla, una comprobación de valor.** En el punto de invocación se verifica que la redacción ocultó de verdad el texto; si no, se omite la sección y se genera con el prompt anterior. Ante un fallo de privacidad el sistema degrada a un plan peor, nunca a una fuga.

**Los datos corporales entran en un solo prompt.** Llevarlos también a los de conversación y extracción se descartó porque la extracción convierte charla en borrador y la fisiología no le aporta: sería ampliar la exposición sin ganancia. Y no se añadieron marcadores obligatorios nuevos, porque hacerlo obligaría a fallar la validación de toda plantilla anterior al cambio, *«a self-inflicted outage for a purely additive variable»*.

---

## 7. Funcionamiento sin conexión

**El navegador nunca llama a la API directamente.** Encola en almacenamiento local y, al recuperar conexión, invoca las acciones de servidor ya existentes. Se descartaron tokens de cliente de vida corta por ampliar el modelo de seguridad. La excepción quedó redactada con precisión quirúrgica: el navegador puede persistir mutaciones y diferir la invocación, pero sigue sin hablar con la API.

**Orden por contador monótono, no por reloj.** Usar la marca temporal se descartó porque la resolución de milisegundo empata con pulsaciones rápidas. El vaciado es estrictamente secuencial y el despacho concurrente queda *«explicitly forbidden»*.

**Dos correcciones nacidas de ahí.** Sin exclusión mutua, los disparos solapados rompían la secuencialidad. Y sin asignación atómica del contador, dos pestañas calculaban el mismo número y una mutación se perdía en silencio.

**Taxonomía de fallos en lugar de un error genérico.** Se distinguen reintentable, mensaje venenoso y acción caducada por redespliegue. La versión anterior descartaba las mutaciones venenosas *«with zero UI feedback»*, haciendo desaparecer el cambio del usuario sin avisar. Era un defecto de integridad, no de presentación.

**La instantánea local es caché, no segunda fuente de verdad.** Se descartó deliberadamente cualquier lógica de fusión o CRDT: la cola sigue siendo la única autoridad sobre las escrituras pendientes.

**Espacio de nombres por identidad, no por token.** Derivar la clave del hash del token se calificó de defecto crítico por dos razones: el token rota en cada inicio de sesión, de modo que el usuario se autopurgaba la cola al volver a entrar; y ese hash es exactamente el correlador interno de la API, cuya exposición al cliente es una fuga innecesaria.

---

## 8. Facturación

**El estado se ancla al tenant, no al usuario.** El consumo no debe seguir a la persona cuando cambia de organización.

**Consumo en una única transacción.** Pertenencia, derecho, contador de tenant, contador de miembro y asiento en el libro mayor van juntos. Las comprobaciones separadas se descartaron porque permiten consumo parcial y sobreconsumo bajo concurrencia.

**Frontera explícita entre modelo de derechos e integración de pago.** El cambio que definió planes y cuotas **no** introdujo un solo campo de Stripe, para que la integración posterior mapeara los eventos del proveedor sin contaminar los contratos internos.

**El SDK de pago vive en un único fichero.** Puerto puro más un adaptador, con una regla de arquitectura que lo impone. La alternativa hacía el código no comprobable sin Stripe real.

**Cuerpo en bruto solo en el ámbito del webhook.** Un analizador global se descartó porque rompería todas las rutas JSON. La ruta no está autenticada porque *«the signature IS the auth»*.

**Idempotencia y tolerancia al desorden.** Tabla de eventos procesados con inserción que ignora duplicados, guarda de orden por marca temporal, y cualquier error devuelve 5xx **sin conceder nunca** el nivel de pago.

**Denegación con 403, no con 402.** Se descartó el código de pago requerido porque *«402 appears NOWHERE in this codebase»* y bifurcaría el manejo de denegaciones en la web sin ganancia.

---

## 9. Producto: no fabricar datos

Este es el hilo que más se repite y el que más dice sobre el criterio con que se construyó el sistema.

Las etiquetas de día del plan dicen «Día 1, Día 2» y no nombres de día de la semana, porque el modelo no tiene anclaje al calendario y *«fabricating weekday names would be misleading»*.

Un indicador del panel que no puede calcularse se deja visiblemente vacío en lugar de rellenarse con una estimación disfrazada de dato.

El tablero semanal no tiene estado de «día perdido». La adherencia se comunica como porcentaje y sugerencia, nunca como reproche, y un día de entrenamiento pasado sin sesión se muestra como descanso.

Cuando el sistema cierra automáticamente una sesión caducada, la marca de finalización se deja nula, porque escribirla sería *«the same falsehood as writing status='completed', one column over»*.

Y el trabajo reciente sigue la misma línea: se retiraron datos de disponibilidad fabricados de la interfaz de planes y se sustituyó texto de maqueta por datos reales.

Un producto que prefiere un hueco a un número inventado es un producto en el que se puede confiar.

---

## 10. Patrones recurrentes

Leídas juntas, las ciento sesenta y pico decisiones se agrupan en ocho criterios que se aplican una y otra vez.

**Puerto estrecho para cruzar una frontera sin acoplar.** Aparece en la puerta de facturación dentro de la capa de IA, en la pasarela de pago, en el almacenamiento de objetos, en la detección de conectividad y en el generador de embeddings. Siempre la interfaz mínima, siempre un solo adaptador que conoce el detalle.

**Fallar cerrado en seguridad y privacidad; fallar abierto en capacidades accesorias.** La autorización, el webhook de pago y la redacción de trazas fallan cerrado. La memoria vectorial, el trazado y la resolución remota de prompts fallan abierto. La distinción es deliberada y está argumentada caso por caso.

**El invariante se expresa en la base de datos.** Índice único parcial para la sesión activa, restricciones de comprobación para ventanas temporales, contadores y colores. Un error de servicio no puede dejar un estado imposible.

**Un único punto de decisión.** La validación de sesión está en una función que comparten HTTP y WebSocket. La autorización del entrenador está en un resolutor. La composición de dependencias está en un fichero. Repetir una comprobación es multiplicar la probabilidad de olvidarla.

**Rechazar en vez de reparar.** Ante una plantilla remota inválida, la respuesta no es arreglarla sino descartarla entera y usar la local.

**Re-derivar en el servidor lo que propone el cliente.** Al aceptar una adaptación, el servidor recalcula la recomendación desde el historial. Al editar un programa, descarta los identificadores de catálogo enviados y los resuelve él. Y preserva los avisos de seguridad ignorando lo que llegue, porque permitir editarlos dejaría borrar en silencio una advertencia clínica.

**Aditivo y reversible por defecto.** Columna anulable, campo opcional, sin relleno retroactivo, reversión por borrado de columna. Y cuando no puede serlo, como en el cambio incompatible del contrato, se argumenta por qué el compilador hace seguro romperlo.

**Distinguir la decisión de producto del fallo técnico.** Una denegación de facturación nunca se usa como recuperación ante error. Un plan archivado no devuelve el mismo *no encontrado* que un plan inexistente. Colapsar ambas cosas es el error natural, y se evita explícitamente.

---

## 11. Lo que este registro demuestra

Un tribunal que pregunte por qué el sistema es así tiene respuesta escrita para más de ciento sesenta preguntas, con la alternativa que se consideró y el motivo por el que se cerró.

Lo más difícil de fingir es la coherencia. Los ocho criterios de la sección anterior no están enunciados en ningún sitio del repositorio: emergen de decisiones tomadas en cuarenta y dos momentos distintos a lo largo de siete semanas. Que converjan es la evidencia de que hubo método, y no una sucesión de decisiones convenientes.
