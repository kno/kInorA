# Métricas y retrospectiva

> 🇬🇧 [English version](./metrics-and-retrospective.md)

Todas las cifras están medidas sobre `origin/main` el 10 de agosto de 2026 y son reproducibles con las órdenes de git correspondientes.

---

## 1. Las cifras

| Métrica | Valor |
|---|---|
| Ventana de desarrollo | 20 jun → 10 ago 2026, 52 días |
| Autoría | una persona |
| Commits | 714 |
| Pull requests integrados | 173 |
| Líneas versionadas | 318.732 |
| Ficheros de código | 502 |
| Ficheros de test | 491 |
| Suites de integración | 26 |
| Escenarios extremo a extremo | 13 |
| Cobertura de funciones de la API | 94,35 % con base de datos, 91,51 % sin ella |
| Especificaciones vigentes | 44 |
| Cambios archivados | 42 |
| Documentos markdown | 337 |
| Migraciones de base de datos | 31 |
| Tablas | 29 |

Ritmo medio: **13,7 commits y 3,3 pull requests por día de calendario**. Tamaño medio de pull request: **12,5 ficheros**.

## 2. Ritmo real

| Semana | Commits |
|---|---:|
| W25 (20-22 jun) | 39 |
| W26 | 130 |
| W27 | 104 |
| W28 | 66 |
| W29 | 41 |
| W30 | 182 |
| W31 | 71 |
| W32 | 70 |
| W33 (hasta el 10 ago) | 11 |

No es un ritmo constante, y eso también es un dato. La semana 26 arranca fuerte con los cimientos, hay un valle en las semanas 28 y 29 —que coincide con el trabajo de generación con IA y seguimiento, donde el diseño pesa más que el código—, y un pico en la semana 30 con la memoria de usuario, la facturación y el chat conversacional.

El reparto por día de la semana dice algo más:

| Lun | Mar | Mié | Jue | Vie | Sáb | Dom |
|---:|---:|---:|---:|---:|---:|---:|
| 85 | 119 | 79 | 114 | 33 | 142 | 142 |

**El 40 % de los commits caen en fin de semana** y el viernes es con diferencia el día más flojo. Esto no es un proyecto a jornada completa: es un proyecto hecho en los huecos, y las cifras de volumen hay que leerlas con ese contexto delante. Hace el resultado más notable, no menos.

## 3. Densidad documental

De los 337 documentos markdown, 286 están en `openspec/`. Es decir, **el 85 % de la documentación del proyecto es documentación de proceso**: propuestas, diseños, tareas, informes de verificación e informes de archivo.

Esa proporción es la firma del método. En un proyecto convencional la relación sería la inversa.

---

## 4. Qué funcionó

**El ciclo dirigido por especificación fue el multiplicador.** No por burocracia, sino porque la fase de exploración evitó repetidamente construir sobre premisas falsas. En un solo cambio, la exploración descubrió que la aplicación móvil no tenía pantalla de perfil, que la serie de pesos tenía otra forma, que el cambio reescribiría el historial y que había un canal de fuga de privacidad que el issue no mencionaba. Descubrir eso antes de escribir código vale más que cualquier ganancia de velocidad al escribirlo.

**El contrato con los agentes funcionó porque se mantuvo.** `AGENTS.md` no es un documento inicial: acumula reglas escritas después de ver fallar algo concreto, desde una condición de exportación de paquetes hasta la prohibición de fabricar resultados de tests.

**Las guardas automáticas hicieron viable el volumen.** Siete comprobaciones que liberan al revisor de sostener la corrección mecánica en la cabeza, y una puerta de cobertura diseñada para no ser saltada.

**La revisión adversarial encontró lo que los tests no.** Los cuatro defectos que Judgment Day corrigió en el trabajo offline —reentrancia del vaciado, descarte silencioso al usuario, derivación de la clave de identidad y clasificación del error de sesión caducada— no rompían ninguna aserción. Rompían garantías. Con volumen alto, ese es el tipo de fallo que más cuesta.

**Los puertos pagaron pronto.** La arquitectura multiproveedor de IA parecía sobreingeniería en el cambio 08. Cuatro cambios después había cinco proveedores de generación, tres de voz por dirección y un panel para conmutarlos en caliente, sin tocar el dominio.

---

## 5. Qué costó más de lo previsto

**El funcionamiento offline.** Es, con diferencia, el área más difícil. Requirió su propio cambio de endurecimiento después del principal, cuatro correcciones de revisión adversarial, una taxonomía de errores completa y decisiones nada evidentes sobre ordenación, idempotencia y espacio de nombres por identidad. Un problema que parece de almacenamiento local y resulta ser de sistemas distribuidos.

**La sincronización con el sistema de diseño.** Se decidió refrescar desde la fuente viva antes de tocar interfaz, rechazando el uso de una instantánea obsoleta. Es la decisión correcta y también una dependencia en el camino crítico. Varios cambios posteriores siguen siendo alineaciones con el diseño.

**Las variables de entorno que no llegan al contenedor.** Docker Compose solo inyecta en un servicio las variables que aparecen listadas en su bloque `environment:`. Una variable que el código lee, que está bien definida en el fichero `.env` del servidor y que no figura en ese bloque **se ignora en silencio**: el contenedor arranca sin error y el código usa su valor por defecto compilado, así que la configuración parece aplicada y no lo está.

Ese fallo se repitió tres veces. Primero con las claves de Stripe, lo que dejó la facturación sin configurar en producción. Después con las variables de selección de proveedor de voz, que hacían que el contenedor ignorase la elección del operador y volviera siempre a OpenAI. Y luego con las de Deepgram. La documentación escrita durante este trabajo encontró una cuarta ocurrencia todavía pendiente, en las variables de ajuste de la voz de Gemini.

Es una clase de fallo especialmente cara porque **ninguna de las siete guardas lo detecta**: los tipos compilan, los tests pasan, la arquitectura es correcta y la aplicación arranca. Solo se manifiesta en producción, y como síntoma da un comportamiento por defecto plausible en lugar de un error.

**La calibración de la puerta de cobertura.** Necesitó dos iteraciones: primero medirla contra una base de datos real, después hacerla consciente del modo. Es el precio de haber querido una puerta honesta en lugar de una cómoda.

---

## 6. Qué haría distinto

**Instrumentar el coste desde el primer día.** Langfuse llegó en el cambio 16e, casi al final. Tener el coste por generación desde el 08 habría informado el dimensionado de los planes con datos en lugar de con estimaciones, y habría convertido la elección de proveedor en una decisión medida.

**Definir antes la métrica de calidad del plan generado.** Sigue sin existir. Es la carencia más importante del proyecto: hay una arquitectura que permite cambiar de modelo con un clic y ninguna forma de saber si el cambio mejora el producto. Debería haberse abordado junto con la generación, no después.

**Elegir una sola vía móvil.** Conviven la aplicación con Expo y el envoltorio de Capacitor. La segunda es herencia de una estrategia anterior y hoy es ambigüedad sin uso claro.

**Convertir en regla del contrato que añadir una variable de entorno son tres ediciones, no una.** Quien añade una variable que el código lee debe, en el mismo cambio, declararla en `.env.example`, documentarla en la referencia de variables y **añadir su línea de reenvío en el bloque `environment:` de `docker-compose.yml`**. Esa tercera edición es la que se olvidó cuatro veces, y es la única que decide si la configuración llega de verdad al contenedor.

Hoy la regla existe y está escrita en los tres sitios, pero llegó después de los cuatro incidentes. Debería haber estado en `AGENTS.md` desde la primera variable de entorno, junto al resto de reglas de completitud, en lugar de aprenderse a base de fallos en producción. Y mejor aún que documentarla habría sido comprobarla: una guarda que compare las variables que el código lee con las que Compose reenvía convertiría un olvido silencioso en una construcción rota.

---

## 7. Lo que este proyecto sugiere sobre construir con agentes

Tres conclusiones, ofrecidas como hipótesis razonadas y no como resultados demostrados, porque este es un caso, no un estudio.

**El cuello de botella se desplaza de escribir a decidir y verificar.** Cuando escribir código deja de ser lo caro, lo caro pasa a ser saber qué pedir y comprobar que lo que llega es correcto. Las cinco fases que rodean a la implementación en este ciclo son exactamente esa respuesta, y el tamaño de pull request está calibrado no por lo que un agente puede escribir sino por lo que una persona puede revisar.

**Las guardas automáticas son la condición de posibilidad, no una buena práctica.** Sin verificación de tipos, tests, arquitectura, dependencias y cobertura ejecutándose solas, el volumen produce deuda a la misma velocidad que produce funcionalidad.

**Los tests comprueban lo que se te ocurrió; la revisión adversarial busca lo que no.** Los defectos más caros que aparecieron aquí no rompían ninguna aserción. A este ritmo, un proceso que busca activamente el fallo importa más que uno que confirma el acierto.

Y una advertencia. Nada de esto elimina el juicio. El método no consiste en que la IA decida: consiste en construir el andamiaje que permite a una persona decidir mucho más rápido sin decidir peor. Cuando el andamiaje falla —una variable no reenviada, una premisa falsa no explorada— el error entra igual, y entra más rápido que antes.
