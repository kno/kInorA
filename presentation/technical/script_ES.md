# Guion — Técnica

## Diapositiva 1

Soy Aitor Ruiz de Samaniego. Esta es la segunda parte de la entrega de kInorA: no qué hace el producto, sino cómo está construido y cómo se construyó. La parte de producto, con capturas de la aplicación, es una presentación aparte.

## Diapositiva 2

Por qué cuento cómo está hecho, y no solo qué hace. En una categoría donde el modelo de IA que uso hoy será peor y más caro dentro de seis meses, la ventaja no está en la funcionalidad: está en la velocidad de cambiarla. Cuarenta y dos cambios cerrados en cincuenta y dos días. Cambiar de proveedor de IA es un clic, y adelanto la objeción: hoy ese clic es barato y ciego a la calidad, y a eso vuelvo hacia el final.

## Diapositiva 3

Por debajo hay un monorepo con arquitectura limpia: web, móvil, API y PostgreSQL con pgvector. Las fronteras entre capas no son una recomendación: son nueve reglas que hacen fallar la compilación si se violan, y hay un test que comprueba que esas reglas fallan cuando deben fallar.

## Diapositiva 4

La capa de IA es la parte más difícil. Ningún proveedor está soldado al código: cinco adaptadores de generación conmutables, y voz elegible por separado. Los prompts viven fuera del código, versionados; si el gestor falla, el sistema cae a la plantilla compilada y sigue generando. Y hay dos mecanismos distintos de enmascarado, porque una lesión y un peso no admiten el mismo trato: la lesión no llega al modelo, y el peso sí llega al modelo pero no queda en la traza.

## Diapositiva 5

El ciclo no lo inventé yo, lo adopté; lo mío es cómo lo goberné. Nada se escribió sin pasar por siete fases donde el código es la sexta, y cada una deja un artefacto versionado. Un solo cambio dejó dos mil novecientas nueve líneas de exploración, propuesta, diseño, tareas, verificación y cierre. Y la exploración descubrió cuatro cosas que el issue original daba por buenas y no lo eran.

## Diapositiva 6

El volumen sale de delegar en agentes sobre un orquestador de terceros, gentle-ai, de Alan Buscaglia, que aporta las fases, la delegación y la revisión adversarial. Lo propio de este trabajo son el contrato de ciento cincuenta líneas que gobierna a los agentes, las siete comprobaciones automáticas y la calibración de la puerta de cobertura. Judgment Day encontró cuatro defectos en el trabajo offline que no rompían ninguna aserción: rompían garantías. Y lo digo porque es el contraejemplo de mi propia tesis: la guarda que no existe es la que decide qué se te escapa.

## Diapositiva 7

Los números. Cincuenta y dos días, una persona dirigiendo agentes, setecientos catorce commits y ciento setenta y tres pull requests. Me adelanto: los trescientos dieciocho mil son líneas versionadas e incluyen tests y documentación. El dato que importa es que hay cuatrocientos noventa y un ficheros de test para quinientos dos de código. Y el tamaño de cada pull request está calibrado por lo que yo podía revisar, no por lo que un agente podía escribir.

## Diapositiva 8

El roadmap real, tal y como quedó archivado en openspec. La v1 son las siete semanas de junio y julio: arquitectura, autenticación, el asistente de creación de plan, generación con IA y seguimiento offline. La v1.1 añade chat y voz conversacionales y adaptación por adherencia. Y aquí está lo que quiero señalar: v2, el nivel Entrenador, y v3, el nivel Gimnasio, no eran para después del máster. Se archivaron el treinta y uno de julio y el dos de agosto, dentro de la misma ventana de cincuenta y dos días.

## Diapositiva 9

El plan no se cumplió tal cual, y merece contarlo. La documentación iba por detrás de lo construido: el README seguía llamando «futuro» a v2 y v3 cuando ya estaban archivadas, y no mencionaba en absoluto la serie 17x, ya cerrada. El trabajo offline costó mucho más de lo previsto: parecía almacenamiento local y resultó ser un problema de sistemas distribuidos, con cuatro correcciones de revisión adversarial. Y una variable de entorno que el código lee y Compose no reenvía a producción se repitió cuatro veces con síntomas distintos, porque ninguna de las siete guardas la detecta.

## Diapositiva 10

Con esa experiencia, qué haría distinto. Instrumentar el coste desde el primer cambio, no desde el dieciséis: Langfuse llegó casi al final, cuando ya se habían tomado decisiones de proveedor sin ese dato. Definir antes la métrica de calidad del plan generado, que todavía no existe y es la pregunta más importante del proyecto. Elegir una sola ruta móvil. Y convertir en regla de contrato que añadir una variable de entorno son tres ediciones a la vez, no una — y mejor que escribir la regla, una guarda que la compruebe.

## Diapositiva 11

Qué falta, en clave técnica. La métrica de calidad del plan generado es la brecha más importante. El coste por usuario no está instrumentado por tenant, así que cualquier precio hoy es una hipótesis. Y hay deuda identificada y priorizada, no escondida: normalización de nombres de ejercicio, clasificador de grupo muscular, y la variable de entorno que Compose todavía no reenvía correctamente.

## Diapositiva 12

La conclusión de fondo es esta: cuando escribir código deja de ser lo caro, lo caro pasa a ser saber qué pedir y comprobar que lo que llega es correcto. El método no consiste en que la inteligencia artificial decida, sino en construir el andamiaje que permite a una persona decidir mucho más rápido sin decidir peor. Gracias por su atención.

