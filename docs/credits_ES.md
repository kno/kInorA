# Créditos y atribución de terceros

> 🇬🇧 [English version](./credits.md)

kInorA se apoya en trabajo que no es suyo. Este documento deja constancia de qué se reutilizó, bajo qué condiciones y dónde está la frontera de la autoría.

---

## 1. El método y su instrumental

**[gentle-ai](https://github.com/Gentleman-Programming/gentle-ai)**, obra de **Alan Buscaglia**, conocido en la comunidad como *Gentleman Programming*, en GitHub como [@Alan-TheGentleman](https://github.com/Alan-TheGentleman) y a través de la organización [Gentleman-Programming](https://github.com/Gentleman-Programming). Escrito en Go y publicado con licencia MIT.

Cuatro de las piezas que describe el capítulo de método de este proyecto se **adoptaron, no se diseñaron aquí**: la orquestación por fases con ventana de contexto aislada, los criterios explícitos para delegar en un subagente, el registro de habilidades que genera `.atl/skill-registry.md`, y los agentes de revisión adversarial ciega Judgment Day. **Engram**, el protocolo de memoria entre sesiones del mismo autor, aporta la persistencia que permite que las decisiones sobrevivan de una sesión a otra y entre herramientas distintas.

Construir esos cuatro pilares desde cero habría sido un proyecto en sí mismo, probablemente más grande que kInorA. Sin ellos, este trabajo habría sido bastante más difícil de completar en el tiempo disponible. Que esté publicado con licencia MIT y mantenido en abierto es lo que hace posible que un trabajo académico se apoye en él y pueda contarlo.

Lo que sí pertenece a este proyecto es cómo se gobernó ese andamiaje: el contrato `AGENTS.md`, las siete comprobaciones automáticas, la puerta de cobertura consciente del modo, y cada decisión de producto y de arquitectura registrada en `openspec/`.

**OpenCode** fue el entorno de agentes sobre el que se ejecutó el trabajo. **Open Design** actuó como fuente de verdad visual, consumida por MCP.

---

## 2. Recursos del catálogo de ejercicios

Las miniaturas y animaciones del catálogo de ejercicios son propiedad de **[Gym visual](https://gymvisual.com/)** y se redistribuyen bajo sus condiciones. **No están cubiertas por la licencia de este proyecto.**

Llegan al producto a través del conjunto de datos [`hasaneyldrm/exercises-dataset`](https://github.com/hasaneyldrm/exercises-dataset), fijado a una revisión inmutable para que los bytes servidos no puedan cambiar sin una actualización revisada. Las miniaturas se alojan en `apps/web/public/exercises/`; las animaciones se sirven desde una CDN, fijadas a la misma revisión, únicamente para mantener unos 123 MB fuera de la imagen de Docker.

Las condiciones completas, la tabla de entrega por tipo de recurso y el aviso original se reproducen en [`apps/web/public/exercises/ATTRIBUTION.md`](../apps/web/public/exercises/ATTRIBUTION.md), que genera el script de importación y no debe editarse a mano.

---

## 3. Principales proyectos de código abierto

| Área | Proyectos |
|---|---|
| Web | Next.js, React, Serwist, `idb`, `next-intl` |
| Móvil | React Native, Expo, `react-intl` |
| API | Fastify, `openid-client`, Zod |
| Datos | PostgreSQL, `pgvector`, Drizzle ORM |
| IA | LangChain, Langfuse |
| Pagos | Stripe |
| Calidad | Vitest, Playwright, dependency-cruiser |

Cada uno se usa bajo su propia licencia. El fichero de bloqueo de dependencias es el registro autorizado de versiones y dependencias transitivas.

---

## 4. Fuentes citadas en la documentación

Las cifras de mercado del capítulo de producto proceden de fuentes públicas, cada una citada con su año en el punto donde se usa: los informes HFA 2025 de benchmarking y de consumo y una encuesta de YouGov de 2024, recopilados por Gymdesk; Business of Apps para ingresos y uso de aplicaciones de fitness; la Organización Mundial de la Salud para la prevalencia musculoesquelética; y una comparativa publicada por SensAI —una de las aplicaciones comparadas— de la que se tomaron precios y capacidades declaradas, pero no sus juicios.

---

## 5. Situación de licencia de este repositorio

**Este repositorio todavía no tiene fichero `LICENSE`.** Es una decisión pendiente, no un descuido que convenga dejar como está: sin licencia explícita, lo que rige por defecto es «todos los derechos reservados», que es una opción legítima pero debería ser deliberada, y encaja mal junto a un proyecto que redistribuye recursos de terceros y se apoya en herramienta publicada con licencia MIT.

Sea cual sea la licencia elegida, debe preservar las condiciones de Gym visual para los recursos del catálogo, que en cualquier caso quedan fuera de su alcance.
