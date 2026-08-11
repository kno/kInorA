# Colaboración con agentes de IA

> 🇬🇧 [English version](./working-with-agents.md)

Este es el capítulo que explica cómo una persona escribió 318.000 líneas, 44 especificaciones y 491 ficheros de test en 52 días. No es una lista de herramientas: es un contrato, un catálogo de habilidades reutilizables y un proceso de revisión adversarial.

---

## 1. El contrato: `AGENTS.md`

En la raíz del repositorio hay un documento de 150 líneas que define cómo deben trabajar los agentes. No es una guía de estilo: es el contrato del proyecto, y está escrito en imperativo.

Sus reglas rápidas fijan el marco: seguir el ciclo dirigido por especificación para cualquier cambio de producto o código, seguir TDD estricto en la implementación, mantener intactas las fronteras de arquitectura porque *«dependency direction is not negotiable»*, preferir los patrones existentes a inventar abstracciones, mantener los cambios pequeños y revisables, y no abrir un pull request hasta que pasen tests, tipos, guardas de dependencias y de arquitectura.

Después desarrolla siete secciones: forma del repositorio, flujo del ciclo, contrato de TDD, reglas de arquitectura limpia, seguridad por diseño, reglas de frontal y sistema de diseño, política de dependencias, disciplina de ficheros y comportamiento del agente.

### Lo interesante son las reglas que corrigen un comportamiento concreto

Un contrato escrito a priori sería una lista de buenas intenciones. Este tiene marcas de haber sido escrito **después de ver a un agente equivocarse**.

Hay treinta líneas dedicadas a una sola condición de exportación de paquetes de TypeScript, explicando por qué debe llamarse `source` y nunca `development`: porque Turbopack activa `development` y resolvería el barril de código fuente, cuyos especificadores no puede mapear de vuelta, rompiendo cualquier componente de cliente que importe un valor en tiempo de ejecución. Nadie escribe eso por precaución; se escribe después de perder una tarde.

Hay una regla que obliga a actualizar los catálogos de inglés y español **en el mismo cambio**, con un test de paridad que lo comprueba. Existe porque la alternativa es una interfaz medio traducida.

Y hay tres reglas de comportamiento que valen por todo el documento: *«Never fabricate test results. If a command was not run, say so»*, *«Never commit without explicit user approval»* y *«Never add AI attribution or Co-Authored-By lines to commits»*.

La primera es la más importante. Un agente que afirma haber ejecutado una suite que no ejecutó es peor que un agente que no ejecuta nada, porque destruye la única señal fiable que tiene quien revisa.

### La lista de comprobación de cierre

El documento termina con nueve casillas que hay que confirmar antes de dar algo por terminado: artefactos del ciclo al día, tests escritos primero con sus casos límite, verificación de tipos, tests, arquitectura, guarda de dependencias, construcción, revisión de implicaciones de seguridad y aislamiento de tenant, y uso de primitivos del sistema de diseño.

Convertir el criterio de «terminado» en una lista explícita es lo que impide que se degrade con el cansancio.

---

## 2. El instrumental

| Herramienta | Función |
|---|---|
| **gentle-ai** | Orquestador de agentes: fases del ciclo, delegación en subagentes, registro de habilidades, memoria persistente y enrutado de modelos |
| OpenCode | Entorno de agentes sobre el que se ejecutó el desarrollo |
| `openspec` | Artefactos del ciclo dirigido por especificación y su archivo |
| Open Design vía MCP | Fuente de verdad visual: el diseño se sincroniza desde el servicio antes de tocar interfaz |
| `.codegraph` | Índice del código para navegación y consulta por parte de los agentes |
| `.atl/skill-registry.md` | Catálogo de habilidades reutilizables, generado por gentle-ai |

### gentle-ai, el orquestador

La pieza que sostiene todo lo demás es [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai), un configurador de ecosistema escrito en Go y publicado con licencia MIT que convierte un agente de código en un colaborador con memoria y flujo de trabajo, en lugar de dejarlo como un chat que escribe ficheros.

Aporta cuatro cosas que este proyecto usó de forma intensiva.

**Orquestación por fases con contexto aislado.** Cada fase del ciclo dirigido por especificación se ejecuta en su propia ventana de contexto mediante delegación en subagentes: el orquestador coordina y los subagentes ejecutan. Es exactamente el patrón que hace viable un ciclo de siete fases sin que el contexto se degrade a mitad de camino.

**Criterios explícitos de delegación.** La delegación no se decide por intuición: se dispara cuando el trabajo exige exploración amplia, implementación en varios ficheros, ejecución de tests o construcción, o revisión adversarial con contexto fresco. Esa última condición es la que da origen a Judgment Day.

**Registro de habilidades.** El fichero `.atl/skill-registry.md` de este repositorio lo genera gentle-ai escaneando los directorios de habilidades de los distintos entornos de agentes instalados. De ahí salen las doce habilidades catalogadas, incluidas `chained-pr`, `work-unit-commits` y `judgment-day`.

**Memoria persistente entre sesiones y entre agentes**, mediante Engram, su protocolo de memoria, de modo que las decisiones tomadas en una sesión siguen disponibles en la siguiente y a través de herramientas distintas.

### El registro de habilidades

Esta es la pieza menos evidente y una de las más interesantes. El repositorio mantiene un índice generado de las habilidades disponibles —doce en la última actualización, del 9 de agosto— escaneando ocho directorios distintos de herramientas de agentes.

Su contrato está escrito explícitamente y es sutil: *«Delegator use only. This registry is an index, not a summary»*. Un agente que va a lanzar subagentes lee el índice, selecciona las habilidades relevantes y **pasa las rutas exactas** para que el subagente lea el documento completo. La razón está enunciada: no inyectar resúmenes generados, para que el subagente cargue el contrato íntegro y se preserve la intención del autor.

Dicho de otro modo: se resiste la tentación de comprimir la instrucción, porque comprimir es interpretar y la interpretación se pierde en cada salto.

Entre las habilidades registradas hay varias que dicen mucho sobre el método: `chained-pr` se dispara con pull requests de más de cuatrocientas líneas y los parte en cadena para proteger el foco de la revisión; `work-unit-commits` planifica los commits como unidades revisables manteniendo tests y documentación junto al código; `cognitive-doc-design` escribe documentación pensada para reducir carga cognitiva.

---

## 3. Judgment Day: revisión adversarial ciega

La habilidad más distintiva se llama `judgment-day`, forma parte de los agentes de fase que instala gentle-ai, y se describe como revisión dual ciega adversarial con un máximo de dos rondas acotadas de corrección y re-juicio.

El funcionamiento es el que su nombre sugiere: varios jueces independientes revisan el mismo trabajo sin verse entre sí, buscando activamente el fallo. Lo que hace creíble el mecanismo es que **dejó rastro en el repositorio**, y ese rastro está en los documentos de cambio, no en un informe de marketing.

Cuatro correcciones documentadas del cambio de funcionamiento offline llevan la etiqueta «Judgment Day PR4 correction»:

La **guarda de reentrada en el vaciado de la cola**, porque `flush()` se invoca desde tres disparadores independientes y sin exclusión mutua los disparos solapados rompían la invariante de secuencialidad.

La exigencia de que **el descarte de un mensaje venenoso llegue al usuario**, porque la implementación original lo eliminaba exactamente igual que a una mutación sincronizada, sin ninguna señal en la interfaz. Era un defecto de integridad de datos disfrazado de detalle de presentación.

La derivación de **la clave de identidad del almacén local a partir del par tenant-usuario y no del token de sesión**, porque el token rota en cada inicio de sesión —de modo que el usuario se autopurgaba su propia cola— y porque el hash de ese token es el correlador interno de la API, cuya exposición al cliente es una fuga innecesaria.

Y la **separación de la sesión caducada del cubo genérico de errores 4xx**, porque estaba haciendo descartar mutaciones perfectamente válidas.

Hay además evidencia de dos rondas sobre la puerta de escritura de memoria y de un juicio transversal a toda una funcionalidad, con ronda de corrección aplicada y aprobación confirmada.

**Los cuatro defectos son de la clase que un test verde no detecta.** Ninguno rompía una aserción: rompían una garantía. Ese es exactamente el hueco que una revisión adversarial cubre y una suite de tests no.

---

## 4. El reparto real del trabajo

Conviene decirlo sin adornos, porque es la pregunta de fondo.

Los agentes escribieron la mayor parte del código, de los tests y de los documentos de cambio. La persona hizo cuatro cosas que los agentes no podían hacer: decidir qué construir y en qué orden, escribir y afinar el contrato que gobierna a los agentes, revisar y aprobar cada pull request, y arbitrar cuando la revisión adversarial encontraba algo.

El límite del método es esa cuarta actividad. Se puede delegar la escritura; no se puede delegar el criterio. Por eso el tamaño medio de un pull request es de doce ficheros y no de ciento veinte: porque el cuello de botella es la capacidad de una persona para revisar de verdad, y el método está diseñado alrededor de esa restricción en lugar de ignorarla.

---

## 5. Lo que hace que esto funcione

Tres condiciones, y las tres son necesarias.

**Un contrato explícito y mantenido.** `AGENTS.md` no se escribió una vez: creció con cada comportamiento indeseado que hubo que corregir. Un contrato que no se actualiza deja de gobernar.

**Guardas automáticas que no dependen de la atención.** Verificación de tipos, tests, arquitectura, dependencias, interfaz contra API, construcción y cobertura. Se detallan en [calidad y guardas](./quality-and-guards_ES.md). Delegar volumen sin red automática es delegar riesgo.

**Un proceso que busca el fallo activamente.** Los tests comprueban lo que se te ocurrió comprobar. La revisión adversarial busca lo que no se te ocurrió. Con volumen alto, la segunda importa más que la primera.

---

## 6. Agradecimiento

Este capítulo describe un método, y ese método se apoya en herramienta que no es de este proyecto.

**gentle-ai** es obra de **Alan Buscaglia**, conocido en la comunidad como *Gentleman Programming* y presente en GitHub como [@Alan-TheGentleman](https://github.com/Alan-TheGentleman) y a través de la organización [Gentleman-Programming](https://github.com/Gentleman-Programming). Junto a gentle-ai mantiene Engram, el sistema de memoria persistente para agentes de código, y un conjunto amplio de herramientas alrededor de la misma idea: que un agente de programación debería recordar, seguir un método y ser revisado, en lugar de improvisar en cada conversación.

Conviene ser explícito sobre la deuda. La orquestación por fases con contexto aislado, los criterios de delegación en subagentes, el registro de habilidades y la revisión adversarial ciega —los cuatro pilares sobre los que se sostiene lo descrito en este documento— no se diseñaron aquí: se adoptaron de su trabajo. Construirlos desde cero habría sido un proyecto en sí mismo, probablemente más grande que kInorA, y sin ellos este trabajo habría sido mucho más difícil de llevar a cabo en el tiempo disponible.

Que además esté publicado con licencia MIT y mantenido en abierto es lo que hace posible que un trabajo académico se apoye en él y pueda contarlo. Gracias por ese trabajo.

---

## Fuentes

- [gentle-ai — Gentleman-Programming](https://github.com/Gentleman-Programming/gentle-ai): orquestador, licencia MIT, escrito en Go.
- [gentle-ai · documentación de agentes](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/agents.md): fases del ciclo, delegación en subagentes, agentes de Judgment Day y protocolo de memoria Engram.
- [Alan Buscaglia — @Alan-TheGentleman](https://github.com/Alan-TheGentleman): autor y mantenedor.
