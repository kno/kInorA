# Problema y oportunidad

> 🇬🇧 [English version](./problem-and-market.md)

Todas las cifras de este documento llevan fuente y año. Las que describen el producto salen del código; las que describen el mercado, de fuentes públicas citadas al final.

---

## 1. El problema

Entrenar con criterio exige tres cosas que la mayoría de la gente no tiene a la vez: saber qué hacer, adaptarlo a su cuerpo y sostenerlo en el tiempo.

**El abandono es la norma, no la excepción.** La mitad de las altas de gimnasio se dan de baja en los primeros seis meses, la retención anual media es del 66,4 % —es decir, uno de cada tres socios se va cada año— y el 80 % de quienes se apuntan en enero lo dejan antes de cinco meses. Entre los motivos declarados, el 41 % cita el precio y un 25 % cambios vitales, entre ellos las lesiones.

**El acompañamiento profesional es minoritario y caro.** Solo el 23 % de los socios estadounidenses usó un entrenador personal en 2024, con una media de 21 sesiones al año, por debajo de las 28 de 2019. En Barcelona una sesión cuesta entre 40 y 70 euros, y los paquetes mensuales de un estudio típico van de 200 a 515 euros. Para la inmensa mayoría, el entrenador es inasumible.

**El cuerpo real tiene limitaciones.** Alrededor de 1.710 millones de personas conviven con alguna afección musculoesquelética, 570 millones con dolor lumbar, y estas afecciones son la principal causa de discapacidad en el mundo, con el dolor lumbar a la cabeza en 160 países. Un plan de entrenamiento genérico ignora exactamente aquello que más condiciona a quien lo necesita.

La conclusión es incómoda de lo evidente: hay una brecha enorme entre el plan genérico que cualquiera puede descargarse gratis y el entrenador personal que casi nadie puede pagar. Y esa brecha se ensancha precisamente para quien tiene una lesión, una patología o una limitación de movilidad, porque es quien menos puede permitirse seguir un plan genérico.

---

## 2. El mercado

Las aplicaciones de fitness generaron 3.400 millones de dólares en 2025, un 24,5 % más que el año anterior, con 540 millones de usuarios y 888 millones de descargas.

El dato relevante no es el tamaño sino su composición: mucho volumen de descarga, mucho usuario, y una retención que se parece sospechosamente a la del gimnasio físico. El sector es bueno captando y malo reteniendo, que es la otra cara del mismo problema.

---

## 3. La competencia y su punto ciego

El segmento de entrenamiento asistido por IA está poblado, y conviene ser honesto sobre ello.

| Producto | Precio | Qué hace su IA | Debilidad declarada |
|---|---|---|---|
| Fitbod | 12,99–15,99 $/mes · 79,99–95,99 $/año | Rotación algorítmica de grupos musculares, sustituciones según material | Las señales de recuperación son menos explícitas que en sistemas dedicados |
| Freeletics | 34,99–79,99 $/periodo | Peso corporal primero; se adapta al esfuerzo percibido | Se adapta al esfuerzo declarado, no a datos de recuperación |
| SensAI | 6,99 $/mes · 69,99 $/año | Modelo de lenguaje que razona sobre sueño, variabilidad cardiaca y carga; cambios conversacionales durante el entrenamiento | Sus métricas son autodeclaradas, sin verificación independiente |
| Future | 199 $/mes | Entrenador humano que edita el plan | Coste alto; la velocidad de ajuste depende de la agenda del entrenador |
| Trainiac | Incluido en Wellhub | Entrenador humano asíncrono por texto, audio y vídeo | El ajuste depende del tiempo de respuesta del entrenador |

Hay dos extremos bien cubiertos. Por debajo, aplicaciones algorítmicas baratas que ajustan volumen y material. Por encima, servicios con entrenador humano que cuestan entre veinte y treinta veces más y cuya latencia de respuesta depende de una persona.

Lo que ninguna de las cinco documenta como capacidad de primer orden es la **adaptación a limitaciones físicas declaradas**. Fitbod sustituye por material disponible pero no documenta protocolos por lesión. Freeletics adapta por esfuerzo. Los servicios con humano pueden adaptar por lesión, pero al ritmo de una persona y al precio de una persona.

Ese es el hueco.

---

## 4. La oportunidad

Un sistema que trate la limitación física como entrada de primera clase —no como una nota que el usuario escribe y nadie lee— puede ofrecer algo intermedio: la adaptación que hoy solo da un profesional, al coste marginal de un modelo de lenguaje.

La oportunidad tiene tres apoyos.

El primero es que el dato ya existe y nadie lo usa: la persona sabe qué le duele y está dispuesta a decirlo si sirve para algo.

El segundo es que la adaptación por limitación es exactamente el tipo de problema en el que un modelo de lenguaje aporta valor real, porque exige combinar un catálogo de ejercicios, una taxonomía de patrones de movimiento, una matriz de carga por zona corporal y una descripción en lenguaje natural que ninguna interfaz de formulario captura bien.

El tercero es la retención. Si el motivo de abandono es que el plan no encaja con el cuerpo de quien lo sigue, un plan que sí encaja es una palanca de permanencia, no solo una función más.

---

## 5. Lo que este documento no afirma

kInorA es un trabajo de fin de máster. No tiene usuarios, ni ingresos, ni datos de retención propios. Todo lo anterior describe una oportunidad razonada a partir de fuentes públicas, no un mercado conquistado.

La validación pendiente está en el [documento de siguientes pasos](./next-steps_ES.md), y su primera pregunta es la más importante: si la adaptación a limitaciones produce planes que un profesional consideraría correctos.

---

## Fuentes

- [Fitness App Revenue and Usage Statistics (2026) — Business of Apps](https://www.businessofapps.com/data/fitness-app-market/): ingresos, usuarios y descargas de 2025.
- [Gym Membership Statistics — Gymdesk](https://gymdesk.com/blog/gym-membership-statistics): retención y abandono, recopilando el HFA 2025 Benchmarking Report, el HFA 2025 Consumer Report y una encuesta de YouGov de 2024.
- [Musculoskeletal conditions — Organización Mundial de la Salud](https://www.who.int/news-room/fact-sheets/detail/musculoskeletal-conditions): prevalencia mundial, datos de 2019.
- [How Much Does a Personal Trainer in Barcelona Cost? — Roei's Studio](https://roeis.es/personal-trainer-cost-barcelona.html): precios de entrenamiento personal en España.
- [Best AI Fitness Apps in 2026 — SensAI](https://www.sensai.fit/blog/best-ai-fitness-apps-2026-fitbod-freeletics-future-trainiac-alternatives): precios y capacidades de la competencia. Conviene señalar que la fuente pertenece a uno de los productos comparados, por lo que sus valoraciones no son neutrales; se han tomado de ella los precios y las capacidades declaradas, no los juicios.
