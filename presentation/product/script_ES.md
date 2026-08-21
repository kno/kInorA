# Guion — Producto

## Diapositiva 1

Soy Aitor Ruiz de Samaniego y esto es kInorA: qué problema resuelve, qué hace y para quién. La parte de cómo está construido y cómo se construyó vive en una presentación aparte, para poder darle a cada una el tiempo que merece.

## Diapositiva 2

El problema no es que falte información sobre entrenamiento: sobra. El problema es el abandono. La mitad de las altas de gimnasio se dan de baja en seis meses. Solo el veintitrés por ciento de los socios estadounidenses usó entrenador personal en 2024, y no es raro: en Barcelona una sesión cuesta entre cuarenta y setenta euros. Y mil setecientos diez millones de personas conviven con alguna afección musculoesquelética. Quien más necesita un plan adaptado es quien menos puede pagarlo.

## Diapositiva 3

El segmento está poblado, así que conviene ser honesto. Por debajo hay aplicaciones baratas que ajustan volumen y material, como Fitbod o Freeletics. SensAI ya usa un modelo de lenguaje, pero para regular la carga según sueño y fatiga, no para adaptar el ejercicio a una lesión. Y por encima están los servicios con entrenador humano, a doscientos dólares al mes. Ninguno de los cinco documenta la adaptación a limitaciones físicas declaradas como capacidad de primer orden. Ese es el hueco.

## Diapositiva 4

kInorA genera y adapta planes al cuerpo real de cada persona. Cuatro capacidades lo definen: adaptación a lesiones, dos modos de definir el plan, memoria persistente que se puede ver y borrar, y entrenamiento offline. Y existe en tres niveles: una persona sola, un entrenador con sus clientes, y un gimnasio con su marca. Lo que viene ahora es enseñar cada una de esas piezas tal y como se ven en la aplicación.

## Diapositiva 5

Definir un plan tiene dos caminos. El asistente de tarjetas son seis pasos —objetivo, lugar, días, duración, material, limitaciones— dos minutos si uno sabe lo que quiere. El lugar va antes que el material, porque entrenar en casa o en un gimnasio cambia lo que tiene sentido ofrecer. El asistente conversacional es mejor cuando la situación tiene matices que ningún formulario recoge, que es el caso de quien arrastra una lesión: aquí lo extrae mientras hablas con el entrenador de kInorA, y en el móvil es una conversación por voz.

## Diapositiva 6

Este es el resultado. La persona declara una hernia lumbar. Lo que hace la sustitución no es el modelo: es un filtro determinista sobre la matriz de carga por zona corporal del catálogo. Donde un plan genérico pondría peso muerto con barra, con carga axial alta sobre la columna, kInorA propone hip thrust con mancuerna: mismo objetivo de cadera, menos carga axial. Y avisa de que lo ha hecho, con el motivo, y ofrece alternativas. Quiero decirlo con claridad: es una sustitución razonada sobre criterio biomecánico documentado, no una indicación clínica, y todavía no la ha revisado un profesional sanitario.

## Diapositiva 7

Este es el panel del día a día. En un vistazo: la sesión de hoy con sus ejercicios y el peso sugerido, la racha de días consecutivos, el objetivo semanal cumplido, y el volumen total entrenado. A la derecha, el check-in semanal y una gráfica de progreso que usa datos reales de las sesiones registradas, no una proyección.

## Diapositiva 8

La vista semanal muestra el plan completo: qué toca cada día, cuánto se ha cumplido y cuánto queda. El volumen objetivo, los días de descanso y la duración total están calculados a partir de las sesiones reales, no de una plantilla fija. Y cada sesión, al entrar, muestra el detalle exacto de series, repeticiones y peso sugerido por ejercicio.

## Diapositiva 9

Entrenar y medir. Anotar las series tiene tres estados —por debajo, cumplido, por encima— y funciona offline: se guarda en el móvil y se sincroniza al recuperar la conexión. Con esos datos el sistema calcula adherencia, volumen y récords, y propone ajustes que la persona confirma.

## Diapositiva 10

Durante el entreno, hablar es más rápido que tocar. «Sube el peso del press a cuarenta kilos» actualiza la sesión de hoy al momento, y el asistente confirma el cambio y puede preguntar si hay que ajustar también las repeticiones. La misma voz que ayuda a definir el plan al principio, ayuda a ajustarlo mientras se entrena.

## Diapositiva 11

Las mismas cuatro capacidades escalan a dos niveles más. El nivel Entrenador deja gestionar una cartera de clientes: se les invita, se crean y poseen planes en su nombre, y hay un panel de progreso por cliente con tendencia de esfuerzo percibido, cumplimiento y últimas sesiones. El cliente sigue siendo dueño de sus datos; el entrenador actúa sobre ellos, no los posee, y eso está resuelto a nivel de autorización, no solo de interfaz. El nivel Gimnasio añade marca blanca en subdominio propio, con logo y paleta reflejados desde el login. Y, con la misma honestidad de siempre, cuento también lo que está diseñado pero no implementado: la facturación por asiento y la administración multisede.

## Diapositiva 12

Un punto de gobierno, porque cambiar de modelo de IA con un clic solo da confianza si además se puede vigilar. Los prompts no viven en el código: residen en Langfuse, versionados, y si el gestor falla el sistema cae a la plantilla compilada y sigue generando. Cada llamada al modelo queda trazada con su proveedor, sus tokens y su latencia, lo que da la base para conocer el coste real de cada plan. Lo que todavía no existe es la métrica que diga si esa llamada produjo un buen plan: se puede ver cuánto cuesta y cuánto tarda, no si vale la pena. Es la pregunta abierta más importante del proyecto, y la cuento aquí en lugar de esconderla.

## Diapositiva 13

Si me quedo con una sola decisión de producto, es esta: el sistema no inventa datos. Días numerados, no lunes, porque el modelo no conoce el calendario. Lo que no se puede calcular se deja vacío. Y una sesión olvidada nunca se marca como completada. Prefiero un hueco a un número inventado.

## Diapositiva 14

Qué falta, con la misma honestidad con la que se ha contado el resto. Esto no lo ha usado nadie todavía, y ningún profesional sanitario ha revisado el catálogo de sustituciones: está verificado, no validado. Tampoco existe hoy una métrica de calidad del plan generado, ni el coste por usuario, ni el correo transaccional que hace falta para lanzar de verdad.

## Diapositiva 15

Vuelvo al principio. La persona con la hernia lumbar que abría esta presentación hoy tiene un plan que la tiene en cuenta. Esto es lo que hace kInorA y para quién lo hace. Cómo está construido, y cómo se construyó en cincuenta y dos días, es la segunda parte de esta entrega.

