# Guion de la defensa

Guion cronometrado de las 16 diapositivas. Genera este mismo texto como notas del ponente `build.js`; si se edita aquí, hay que editarlo allí.

Duración: 7:43 de narración más 60 segundos repartidos en tres demostraciones, total **8:43**. Los bloques `[DEMO]` marcan dónde entra el metraje de la aplicación y cuánto dura.

---

## 1. kInorA

`0:00–0:18`

Soy Aitor Ruiz de Samaniego y esto es kInorA, mi trabajo de fin de máster: una plataforma que genera y adapta planes de entrenamiento con inteligencia artificial. En los próximos ocho minutos quiero contar tres cosas: qué problema resuelve, cómo está construido y, sobre todo, cómo se construyó. 1

## 2. El abandono es la norma

`0:18–0:52`

El problema no es que falte información sobre entrenamiento: sobra. El problema es el abandono. La mitad de las altas de gimnasio se dan de baja en seis meses. Solo el veintitrés por ciento de los socios estadounidenses usó entrenador personal en 2024, y no es raro: en Barcelona una sesión cuesta entre cuarenta y setenta euros. Y mil setecientos diez millones de personas conviven con alguna afección musculoesquelética. Quien más necesita un plan adaptado es quien menos puede pagarlo. 2

## 3. Dónde está el hueco

`0:52–1:28`

El segmento está poblado, así que conviene ser honesto. Por debajo hay aplicaciones baratas que ajustan volumen y material, como Fitbod o Freeletics. SensAI ya usa un modelo de lenguaje, pero para regular la carga según sueño y fatiga, no para adaptar el ejercicio a una lesión. Y por encima están los servicios con entrenador humano, a doscientos dólares al mes. Ninguno de los cinco documenta la adaptación a limitaciones físicas declaradas como capacidad de primer orden. Ese es el hueco. 3

## 4. Planes para el cuerpo real

`1:28–2:02`

kInorA genera y adapta planes al cuerpo real de cada persona. Cuatro capacidades lo definen: adaptación a lesiones, dos modos de definir el plan, memoria persistente que se puede ver y borrar, y entrenamiento offline. Y existe en tres niveles: una persona sola, un entrenador con sus clientes, y un gimnasio con su marca. 4

## 5. Definir el plan

`2:02–2:47`

Vamos a verlo. Definir un plan tiene dos caminos. El asistente de tarjetas son seis pasos, dos minutos si uno sabe lo que quiere. El asistente por voz es una conversación, mejor cuando la situación tiene matices que ningún formulario recoge, que es el caso de quien arrastra una lesión. 

> **DEMO 20 s: recorrer el asistente de tarjetas y después el modo conversación.** 5

## 6. El plan adaptado

`2:47–3:40`

Este es el resultado. La persona declara una hernia lumbar. Lo que hace la sustitución no es el modelo: es un filtro determinista sobre la matriz de carga por zona corporal del catálogo. Donde un plan genérico pondría peso muerto con barra, con carga axial alta sobre la columna, kInorA propone hip thrust con mancuerna: mismo objetivo de cadera, menos carga axial. Y avisa de que lo ha hecho. Quiero decirlo con claridad: es una sustitución razonada sobre criterio biomecánico documentado, no una indicación clínica, y todavía no la ha revisado un profesional sanitario. 

> **DEMO 25 s: plan generado, aviso y sustitución.** 6

## 7. Entrenar y medir

`3:40–4:15`

Entrenar y medir. Anotar las series tiene tres estados —por debajo, cumplido, por encima— y funciona offline: se guarda en el móvil y se sincroniza al recuperar la conexión. Con esos datos el sistema calcula adherencia, volumen y récords, y propone ajustes que la persona confirma. Y todo lo que el sistema aprende vive en una memoria que se puede abrir, editar y borrar entera. 

> **DEMO 15 s: registrar una serie y mostrar el panel.** 7

## 8. No fabricar datos

`4:15–4:40`

Si me quedo con una sola decisión de producto, es esta: el sistema no inventa datos. Días numerados, no lunes, porque el modelo no conoce el calendario. Lo que no se puede calcular se deja vacío. Y una sesión olvidada nunca se marca como completada. Prefiero un hueco a un número inventado. 8

## 9. Por qué importa cómo está hecho

`4:40–5:08`

Eso es el producto. Ahora, por qué cuento cómo está hecho. En una categoría donde el modelo que uso hoy será peor y más caro dentro de seis meses, la ventaja no está en la funcionalidad: está en la velocidad de cambiarla. Cuarenta y dos cambios cerrados en cincuenta y dos días. Cambiar de proveedor es un clic, y adelanto la objeción: hoy ese clic es barato y ciego, y a eso vuelvo al final. 9

## 10. Arquitectura

`5:08–5:34`

Por debajo hay un monorepo con arquitectura limpia: web, móvil, API y PostgreSQL con pgvector. Las fronteras entre capas no son una recomendación: son nueve reglas que hacen fallar la compilación si se violan, y hay un test que comprueba que esas reglas fallan cuando deben fallar. 10

## 11. La capa de IA

`5:34–6:06`

La capa de IA es la parte más difícil. Ningún proveedor está soldado al código: cinco adaptadores de generación conmutables, y voz elegible por separado. Los prompts viven fuera del código, versionados; si el gestor falla, el sistema cae a la plantilla compilada y sigue generando. Y hay dos mecanismos distintos de enmascarado, porque una lesión y un peso no admiten el mismo trato: la lesión no llega al modelo, y el peso sí llega al modelo pero no queda en la traza. 11

## 12. Cómo se construyó

`6:06–6:39`

El ciclo no lo inventé yo, lo adopté; lo mío es cómo lo goberné. Nada se escribió sin pasar por siete fases donde el código es la sexta, y cada una deja un artefacto versionado. Un solo cambio dejó dos mil novecientas nueve líneas de exploración, propuesta, diseño, tareas, verificación y cierre. Y la exploración descubrió cuatro cosas que el issue original daba por buenas y no lo eran. 12

## 13. Delegar sin perder el control

`6:39–7:15`

El volumen sale de delegar en agentes sobre un orquestador de terceros, gentle-ai, de Alan Buscaglia, que aporta las fases, la delegación y la revisión adversarial. Lo propio de este trabajo son el contrato de ciento cincuenta líneas que gobierna a los agentes, las siete comprobaciones automáticas y la calibración de la puerta de cobertura. Judgment Day encontró cuatro defectos en el trabajo offline que no rompían ninguna aserción: rompían garantías. Y lo digo porque es el contraejemplo de mi propia tesis: la guarda que no existe es la que decide qué se te escapa. 13

## 14. Resultados

`7:15–7:47`

Los números. Cincuenta y dos días, una persona dirigiendo agentes, setecientos catorce commits y ciento setenta y tres pull requests. Me adelanto: los trescientos dieciocho mil son líneas versionadas e incluyen tests y documentación. El dato que importa es que hay cuatrocientos noventa y un ficheros de test para quinientos dos de código. Y el tamaño de cada pull request está calibrado por lo que yo podía revisar, no por lo que un agente podía escribir. 14

## 15. Qué falta

`7:47–8:15`

Qué falta, empezando por lo mayor: esto no lo ha usado nadie, y ningún profesional sanitario ha revisado el catálogo de sustituciones. Está verificado, no validado. Falta una métrica de calidad del plan generado, que es la pregunta abierta más importante: tengo una arquitectura que permite cambiar de modelo con un clic y ninguna forma de saber si el cambio mejora el producto. Y falta el coste por usuario y el encaje legal de los datos de salud. 15

## 16. El cuello de botella ya no es escribir.

`8:15–8:45`

Vuelvo al principio. La persona con la hernia lumbar que abría esta presentación hoy tiene un plan que la tiene en cuenta, y construirlo ha costado cincuenta y dos días de una sola persona. La conclusión de fondo es esta: cuando escribir código deja de ser lo caro, lo caro pasa a ser saber qué pedir y comprobar que lo que llega es correcto. El método no consiste en que la inteligencia artificial decida, sino en construir el andamiaje que permite a una persona decidir mucho más rápido sin decidir peor. Gracias por su atención. 16
