# Propuesta de valor y usuarios

> 🇬🇧 [English version](./value-proposition.md)

---

## 1. La frase

kInorA genera y adapta planes de entrenamiento al cuerpo real de cada persona —sus objetivos, su nivel, el material que tiene y las lesiones que arrastra— y los ajusta sesión a sesión según lo que de verdad hace.

Las tres palabras que importan son **cuerpo real**. Todo lo demás lo hace ya alguien.

---

## 2. Los cuatro diferenciales

### Adaptación a limitaciones físicas

La persona declara lesiones, patologías crónicas o limitaciones de movilidad, y el sistema filtra, sustituye o ajusta los ejercicios en consecuencia. Es la capacidad que ningún competidor documenta como propiedad de primer orden.

Tiene tres apoyos técnicos que la hacen posible y que no son evidentes desde fuera. El catálogo de ejercicios es un paquete versionado con taxonomía de patrones de movimiento y matriz de carga por zona corporal, de modo que sustituir un ejercicio no es buscar otro que trabaje el mismo músculo sino uno que respete la zona comprometida. El texto de la limitación llega al modelo pero se enmascara antes de cualquier traza de observabilidad, porque es un dato de salud. Y el sistema genera **avisos y sustituciones sugeridas, nunca diagnóstico ni bloqueo clínico**, una frontera que está escrita en el contrato de trabajo del proyecto y que no es solo prudencia legal: es lo que permite ofrecer la función sin pretender ser lo que no se es.

### Dos modos que alimentan la misma estructura

El plan se define con un asistente de tarjetas de siete pasos, rápido y visual, o conversando con voz. Ambos modos escriben la misma estructura de datos, así que se puede alternar sin perder lo avanzado.

Esto importa porque los dos modos sirven a dos momentos distintos. Las tarjetas son mejores cuando sabes lo que quieres. La conversación es mejor cuando tu situación tiene matices que ningún formulario recoge, que es justo el caso de quien tiene una lesión.

### Memoria persistente, visible y borrable

El sistema recuerda preferencias, material, contexto y patrones entre sesiones. La diferencia con la memoria de otros productos es que aquí **la persona puede consultarla, editarla y borrarla**, y que los recuerdos solo se crean con confirmación explícita: se descartó la extracción automática desde la conversación por el riesgo de capturar transcripciones en bruto y datos de salud.

Es menos cobertura automática a cambio de que nadie se lleve una sorpresa con lo que el sistema sabe de él.

### Registro que funciona sin cobertura

El registro de series está pensado para el gimnasio real, donde a menudo no hay señal: anotación en tres estados —por debajo, cumplido, por encima— con cola local y sincronización al recuperar conexión. La cola distingue fallos reintentables de mensajes que deben descartarse y avisa al usuario cuando descarta algo, en lugar de hacerlo desaparecer en silencio.

---

## 3. Contra qué se compite, honestamente

Frente a **Fitbod y Freeletics**, que cuestan menos o parecido, la ventaja es la adaptación por limitación y la definición conversacional. La desventaja es que son productos maduros con catálogos enormes y años de ajuste.

Frente a **SensAI**, que también usa un modelo de lenguaje y también conversa, la ventaja es la adaptación por limitación y el control del usuario sobre su memoria. La desventaja es que integra señales de sueño y variabilidad cardiaca que kInorA no lee.

Frente a **Future y Trainiac**, con entrenador humano, la ventaja es de precio y de latencia: la adaptación es inmediata y no depende de la agenda de nadie. La desventaja es evidente y no conviene disimularla: un algoritmo no sustituye el juicio clínico de un profesional que te ve moverte.

**kInorA no compite con el fisioterapeuta.** Compite con no hacer nada, o con hacer un plan genérico que ignora la lesión.

---

## 4. Personas usuarias

### Quien vuelve tras una lesión

Es el caso central. Tiene un objetivo, tiene material y tiene una zona que no puede cargar. Los planes genéricos le sirven a medias y el profesional le queda caro. Necesita que el plan reconozca la limitación sin tratarla como enfermedad.

**Recorrido:** define el plan por conversación porque su situación tiene matices, declara la limitación, recibe un plan con sustituciones y avisos, entrena y da realimentación por zona corporal después de los ejercicios adaptados.

### Quien entrena en casa con poco material

Tiene unas mancuernas, una banda y poco tiempo. La mayoría de los planes asumen un gimnasio completo.

**Recorrido:** define el plan con tarjetas en dos minutos, declara el material, y si un ejercicio resulta inviable el sistema lo sustituye por uno equivalente.

### Quien lleva tiempo entrenando y se ha estancado

Sabe lo que hace y quiere progresión, no motivación. Le interesan las estadísticas, los récords y la adaptación por RPE.

**Recorrido:** registra con precisión, consulta la progresión de carga por ejercicio, y el sistema le propone ajustar frecuencia por adherencia o intensidad por esfuerzo percibido, siempre con confirmación explícita.

### El entrenador con clientes

Gestiona varias personas y quiere entregar planes con su marca sin montar infraestructura.

**Recorrido:** invita al cliente, crea planes en su nombre, consulta su progreso. El cliente conserva su cuenta personal y solo comparte con el entrenador los datos de entrenamiento, nunca su facturación, sus credenciales ni su memoria del asistente.

### El gimnasio

Quiere ofrecer planificación con su identidad visual a sus socios. Se atiende con marca blanca: subdominio, logotipo y paleta propia.

---

## 5. Una propiedad que no se ve pero se nota

Hay un criterio que atraviesa el producto entero y que conviene enunciar como propuesta de valor, porque lo es: **el sistema no inventa datos**.

Los días del plan se numeran en lugar de asignarles nombres de día de la semana, porque el modelo no tiene anclaje al calendario y fabricarlos sería engañoso. Un indicador que no se puede calcular se deja vacío en lugar de estimarlo. El panel semanal no marca días perdidos ni reprocha ausencias. Y cuando el sistema cierra automáticamente una sesión olvidada, no la registra como completada.

En una categoría donde abundan las métricas infladas y los anillos que se cierran solos, un producto que prefiere un hueco a un número inventado es una posición defendible.

---

## 6. Lo que hoy no hace

No lee wearables, ni sueño, ni variabilidad cardiaca. No hace seguimiento nutricional. No corrige la técnica por vídeo. No sustituye a un profesional sanitario, y lo dice.

Y no envía ningún correo: los flujos de cuenta y facturación no tienen notificación por correo implementada, lo que es una carencia real de cara a un lanzamiento y está recogida en los [siguientes pasos](./next-steps_ES.md).
