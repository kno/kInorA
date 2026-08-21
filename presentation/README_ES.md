# Presentación

Fuente de los decks de defensa. Los decks en sí son un artefacto de compilación y **no** se versionan: `.pptx` y `.pdf` son binarios que nadie puede revisar en un diff y harían crecer el repositorio en cada edición. Lo que vive aquí es lo que los produce.

Son dos, separados para que cada uno tenga el tiempo que necesita en lugar de competir por los mismos ocho minutos:

| Deck | Carpeta | Qué cubre |
|---|---|---|
| Producto | `product/` | El problema, el hueco competitivo, las cuatro capacidades, y un recorrido por las pantallas reales — alta del plan, el plan adaptado, el panel diario, el plan semanal, el seguimiento en el gimnasio, el asistente de voz. |
| Técnica | `technical/` | Por qué importa el método de construcción, la arquitectura, la capa de IA, el ciclo SDD, agentes/guardas/revisión adversarial, los resultados, el roadmap inicial, y una lectura honesta de qué se desvió del plan y qué se haría distinto. |

| Fichero | Qué es |
|---|---|
| `product/build.js` | Generador del deck de producto. Emite 13 diapositivas, incluidas capturas reales. |
| `product/screens/*.png` | Capturas de las pantallas realmente diseñadas bajo `docs/open-design/kinora/screens/`, tomadas de forma automática en un viewport fijo para que el deck no dependa de una aplicación en marcha ni de un navegador en tiempo de compilación. Son **referencias de diseño**, no capturas de la app en producción — las diapositivas lo indican así. |
| `product/script_ES.md` | Guion cronometrado del deck de producto, extraído de las notas del ponente del generador. |
| `technical/build.js` | Generador del deck técnico. Emite 12 diapositivas. |
| `technical/script_ES.md` | Guion cronometrado del deck técnico. |
| `package.json` | Declara `pptxgenjs`, la única dependencia que necesita cualquiera de los dos generadores. |

## Cómo se construye

```bash
pnpm install                                                          # una vez, para descargar pptxgenjs
node presentation/product/build.js                                   # escribe presentation/product/kinora-producto.pptx
node presentation/technical/build.js                                 # escribe presentation/technical/kinora-tecnica.pptx
soffice --headless --convert-to pdf --outdir presentation/product presentation/product/kinora-producto.pptx
soffice --headless --convert-to pdf --outdir presentation/technical presentation/technical/kinora-tecnica.pptx
```

Todos los comandos se ejecutan desde la raíz del repositorio. Cada generador escribe siempre junto a su propio `build.js`, sin importar el directorio de trabajo actual.

## Actualizar las capturas de producto

Las capturas en `product/screens/` son una foto fija de los mockups de Open Design. Para regenerarlas tras un cambio de diseño, renderiza cada `docs/open-design/kinora/screens/*.html` con un Chromium headless en el viewport documentado en el historial del script de captura (1440×960 para web, 390×844 a página completa para móvil) y sobrescribe el PNG correspondiente. Deliberadamente no hay una dependencia de navegador o de aplicación en marcha en tiempo de compilación: una imagen estática y versionada es más fiable que un paso de renderizado que puede fallar en una máquina sin Chromium.

## Convenciones

La paleta es la del propio proyecto: fondo `#09090C`, superficies `#16161B` y `#1F1F25`, acento `#A8F060` de la dirección de marca Orbit, en `docs/open-design/kinora/`.

Las tipografías son Arial y Calibri a propósito. Las de la marca —Space Grotesk y DM Sans— no están garantizadas en el equipo donde se reproduzca, y que PowerPoint sustituya una fuente que no encuentra produce saltos de línea impredecibles. Aquí pesa más la fiabilidad que la fidelidad.

Cada guion es la fuente de verdad del cronometraje de su deck. Editar una diapositiva sin editar su nota desincroniza la grabación.

> 🇬🇧 [English version](./README.md)
