# Presentación

Fuente del deck de defensa. El deck en sí es un artefacto de compilación y **no** se versiona: `.pptx` y `.pdf` son binarios que nadie puede revisar en un diff y harían crecer el repositorio en cada edición. Lo que vive aquí es lo que los produce.

| Fichero | Qué es |
|---|---|
| `build.js` | Generador. Emite las 16 diapositivas, la paleta, la maquetación y las notas del ponente. |
| `script_ES.md` | El guion cronometrado, extraído del generador. En español, porque la defensa se hace en español. |

## Cómo se construye

```bash
node presentation/build.js          # escribe kinora-defensa.pptx
soffice --headless --convert-to pdf kinora-defensa.pptx
```

`pptxgenjs` es la única dependencia.

## Convenciones

La paleta es la del propio proyecto: fondo `#09090C`, superficies `#16161B` y `#1F1F25`, acento `#A8F060` de la dirección de marca Orbit, en `docs/open-design/kinora/`.

Las tipografías son Arial y Calibri a propósito. Las de la marca —Space Grotesk y DM Sans— no están garantizadas en el equipo donde se reproduzca, y que PowerPoint sustituya una fuente que no encuentra produce saltos de línea impredecibles. Aquí pesa más la fiabilidad que la fidelidad.

El guion es la fuente de verdad del cronometraje. Editar una diapositiva sin editar su nota desincroniza el vídeo.

> 🇬🇧 [English version](./README.md)
