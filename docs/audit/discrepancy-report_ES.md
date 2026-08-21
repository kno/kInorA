# Informe de discrepancias documentales

> 🇬🇧 [English version](./discrepancy-report.md)

**Proyecto:** kInorA
**Fecha de la auditoría:** 10 de agosto de 2026
**Referencia auditada:** `origin/main` (714 commits, último `#446`)
**Documentos revisados:** `README.md`, `AGENTS.md`, `apps/api/README.md`, `docs/open-design-kinora.md`, `docs/billing/QA-CHECKLIST.md`, `docs/voice/stt-tts-abuse-meter-decision.md`
**Fuentes de verdad usadas para contrastar:** `package.json` de cada workspace, `.env.example`, `docker-compose.yml`, `.github/workflows/ci-cd.yml`, `scripts/`, `capacitor.config.ts`, `.node-version`, árbol de `apps/`, `packages/` y `openspec/`

---

## Resumen

Se han detectado **veinte discrepancias** entre la documentación y el código. Catorce afectan al `README.md` raíz, que es el documento de entrada del proyecto y el que leerá cualquier evaluador antes que ningún otro.

La conclusión relevante no es el número. Es que **el README describe un sistema que en buena parte no es el que está construido**: siete de las dieciséis filas de su tabla de tecnologías nombran librerías o servicios que no aparecen en ninguna dependencia del repositorio, y las instrucciones de instalación contienen dos comandos que fallan al ejecutarse.

En el extremo contrario, `apps/api/README.md` es un documento excelente y actualizado. Documenta con precisión OpenRouter, Langfuse, la selección de proveedor por panel de administración y el enmascarado de datos de salud en las trazas. Todo lo que falta arriba está bien escrito abajo. El problema es de propagación, no de conocimiento.

| # | Severidad | Ubicación | Discrepancia |
|---|---|---|---|
| 1 | Crítica | README §b | Declara Vercel AI SDK; el repositorio usa LangChain |
| 2 | Crítica | README §b | Declara GPT-4o como modelo; el modelo se resuelve vía OpenRouter y es configurable |
| 3 | Crítica | README §b | Declara Whisper para STT; el repositorio usa Deepgram o Google, seleccionables |
| 4 | Crítica | README §b | Declara OpenAI TTS; el repositorio usa Deepgram o Gemini, seleccionables |
| 5 | Crítica | README §b | Declara Auth.js / NextAuth v5; no existe esa dependencia |
| 6 | Crítica | README (todo) | Langfuse no se menciona ni una vez |
| 7 | Alta | README §c | `cp apps/web/.env.example …` y `cp apps/api/.env.example …`: esos ficheros no existen |
| 8 | Alta | README §c | `pnpm --filter api db:seed`: ese script no existe |
| 9 | Alta | README §c | Cita `AUTH_SECRET`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: ninguna existe |
| 10 | Alta | README §b | Declara Brevo para email transaccional; no hay ningún proveedor de email |
| 11 | Alta | README §e / Roadmap | El roadmap presenta v2 y v3 como futuro; están mayoritariamente cerrados |
| 12 | Alta | README §c | Exige pnpm ≥ 11; el repositorio fija pnpm 10.17.1 |
| 13 | Media | README §b, §d | Presenta el móvil como PWA en Capacitor; existe además una app React Native + Expo |
| 14 | Media | README §d | El árbol muestra `packages/shared` y `mobile-shell/`; ninguno existe |
| 15 | Media | README §d | Omite `packages/exercise-catalog` y `packages/i18n` |
| 16 | Media | README §c | Exige PostgreSQL 18; el Compose fija `pgvector/pgvector:pg17` |
| 17 | Media | README §c | Describe el despliegue como `git pull` + `docker build` + `docker run`; el pipeline real publica imagen multiarquitectura en GHCR |
| 18 | Baja | `.env.example` | No incluye las variables de voz, Stripe, memoria vectorial ni facturación por asiento que sí inyecta el Compose |
| 19 | Baja | `openspec/changes/` | `16d-admin-tier-provisioning` está a la vez activa y archivada |
| 20 | Media | README §d | Las entidades de dominio listadas no se corresponden con las 28 tablas del esquema |

---

## Detalle por hallazgo

### 1-4. La capa de IA documentada no es la construida

El README declara integración mediante Vercel AI SDK, modelo GPT-4o, transcripción con Whisper y síntesis con OpenAI TTS.

Ninguna de las cuatro afirmaciones se sostiene. `apps/api/package.json` no contiene Vercel AI SDK. Contiene `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai` y `langfuse-langchain`. La generación se resuelve a través de OpenRouter con el modelo indicado en `OPENROUTER_MODEL`, cuyo valor de ejemplo es `openai/gpt-4o-mini` y no `gpt-4o`, y con el requisito documentado de que el modelo elegido soporte salida estructurada por esquema JSON.

Además, la elección de proveedor es una función de producto: existe un panel en `/admin/ai-config` que permite conmutar entre OpenAI, Anthropic, Google Generative AI y OpenCode-Go, con las claves gestionadas por operador y nunca almacenadas en base de datos ni expuestas en la interfaz. El README no menciona esta capacidad.

Para voz, `apps/api/src/ai/` contiene `deepgram-speech-transcriber.ts`, `deepgram-speech-synthesizer.ts`, `google-speech-transcriber.ts`, `gemini-speech-synthesizer.ts` y una `voice-provider-factory.ts`. El Compose inyecta `VOICE_STT_PROVIDER` y `VOICE_TTS_PROVIDER`. Whisper no aparece.

**Impacto.** Es la discrepancia más costosa del informe. El proyecto tiene una arquitectura de proveedores intercambiables con puertos, adaptadores, errores tipados y reintento ante fallos transitorios, y el documento de entrada la presenta como una integración monoproveedor. Se está ocultando el trabajo técnico más difícil del repositorio.

### 5. Auth.js no está en el proyecto

El README atribuye la autenticación a Auth.js (NextAuth v5). No hay rastro de `next-auth` ni de `@auth/*` en ninguna dependencia, ni en el frontal ni en la API.

Lo que existe es una implementación propia en `apps/api/src/auth/`: política de contraseñas y hash en `service.ts`, cliente OIDC de Google mediante `openid-client`, sesiones sobre `@fastify/cookie`, vinculación de cuentas en `social-wiring.ts` y selección de tenant en `tenant-selection.ts`.

**Impacto.** Además de ser inexacto, se resta mérito: implementar autenticación propia con vinculación automática de cuentas y aislamiento multi-tenant es sustancialmente más trabajo que configurar una librería, y así documentado parece lo segundo.

### 6. Langfuse no aparece en el README

Cero apariciones. Es la pieza que convierte el sistema en IA operada: prompts remotos versionados bajo la etiqueta `production`, validación de plantilla en frontera con detección de deriva reportada como evento de observabilidad, caída al template compilado cuando Langfuse no responde, marcado de cada traza con `promptSource`, y enmascarado de `PlanSpec.limitations` con `[REDACTED]` para que el texto de salud nunca llegue a la traza.

Todo esto está correctamente documentado en `apps/api/README.md` y no ha subido al documento raíz.

### 7-9. Las instrucciones de instalación no se pueden seguir

El paso 3 indica copiar `apps/web/.env.example` y `apps/api/.env.example`. Ninguno de los dos ficheros existe: la configuración de ejemplo vive en un único `.env.example` en la raíz. Ambos comandos fallan.

El paso 5 ofrece `pnpm --filter api db:seed` como siembra opcional del catálogo. `apps/api/package.json` no define `db:seed`, y el concepto mismo es erróneo: **el catálogo de ejercicios no se siembra en base de datos**. Viaja como paquete versionado en `packages/exercise-catalog`, con las miniaturas autoalojadas en `apps/web/public/exercises/`. El script de raíz `pnpm import:exercise-catalog` es una herramienta de mantenimiento que reconstruye ese paquete y replica los recursos desde el conjunto de datos original fijado por versión, y no toca la base de datos en ningún momento.

La lista de variables a configurar cita `AUTH_SECRET`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`. Ninguna de las cuatro se lee en el código, aparece en el `.env.example` ni se inyecta en el Compose.

**Impacto.** Un evaluador que intente levantar el proyecto siguiendo el README se atasca en el tercer paso.

### 10. No hay proveedor de email

El README declara Brevo para correo transaccional y la lista de variables pide una clave de Resend, dos servicios distintos para la misma función. Una búsqueda en todo el repositorio de `brevo`, `resend`, `nodemailer` y `sendgrid` no devuelve ninguna integración: los únicos aciertos son literales de interfaz sobre campos de correo.

La funcionalidad no está construida. Debe salir de la tabla de tecnologías y, si sigue en el plan, aparecer en el apartado de próximos pasos.

### 11. El roadmap está desfasado

El README presenta cuatro hitos con v2 y v3 como trabajo futuro. El archivo SDD dice otra cosa: `15a` y `15b` (tier Trainer) están cerrados desde el 31 de julio y el 1 de agosto, y `16a` (marca blanca), `16d` (aprovisionamiento de tier) y `16e` (Langfuse) desde principios de agosto.

Falta además por completo la serie 17x, que es producto ya entregado: `17b` recuperación de sesiones abandonadas, `17c` perfil con métricas corporales y `17d` gestión de planes. Y falta el trabajo transversal archivado que no encaja en la numeración de versiones: adopción de i18n con ICU, endurecimiento del volcado offline, seguridad de recursos en E2E, límites de la capa de rutas y menú de usuario.

**Impacto.** El documento subestima el alcance real del proyecto. Es el único error del informe que perjudica directamente a la valoración del trabajo.

### 12. Versión de pnpm contradictoria

Los prerrequisitos piden pnpm ≥ 11. El `package.json` raíz fija `"packageManager": "pnpm@10.17.1"` y el `.env.example` documenta que el VPS dispone de pnpm 10.17.1. Seguir el README instala una versión mayor que la fijada por Corepack.

La exigencia de Node sí es correcta: `.node-version` marca 24.17.0 y `engines` exige `>=24.17.0`.

### 13-15. La estructura del proyecto no coincide

El árbol del README muestra `packages/shared/` como único paquete compartido y un directorio `mobile-shell/` para Capacitor. Los paquetes reales son cuatro —`contracts`, `domain`, `exercise-catalog` e `i18n`— y no existe `mobile-shell/`: la configuración de Capacitor está en `capacitor.config.ts` en la raíz, apuntando a `apps/web/.next`, con el proyecto nativo en `android/`.

Lo más importante es que el árbol omite `apps/mobile`, que no es un envoltorio de la web sino una **aplicación React Native 0.79 sobre Expo 53**, con navegación propia, almacenamiento seguro, detección de conectividad, audio y su propio runtime de internacionalización. El README describe la estrategia móvil como «PWA embebida en un contenedor nativo vía Capacitor» y eso solo cubre una de las dos vías existentes.

### 16. Versión de PostgreSQL

Los prerrequisitos piden PostgreSQL 18. El Compose fija `pgvector/pgvector:pg17`, y el propio README lo indica correctamente cuatro párrafos más abajo al explicar la migración de memoria vectorial. Basta con corregir el prerrequisito para que el documento deje de contradecirse.

### 17. El despliegue documentado no es el real

El README describe el despliegue como tres órdenes en el VPS: `git pull`, `docker build`, `docker run`.

El pipeline real de `ci-cd.yml` tiene seis fases: CI con verificación de tipos, tests y guardas; integración de facturación contra un Postgres real; prueba de construcción y arranque de la imagen Docker; construcción de imagen multiarquitectura en matriz; fusión del manifiesto multiarquitectura; y despliegue en el VPS. El despliegue se ejecuta por SSH con la configuración pasada como carga base64 para evitar inyección por línea de órdenes, con fijación de la huella del host en lugar de confianza al primer uso, y con precedencia explícita de las variables gestionadas por el pipeline sobre el `.env` persistente del operador, precisamente para que un valor obsoleto no pueda hacer que un despliegue verde ejecute una imagen antigua.

**Impacto.** Aquí la documentación no solo es inexacta: describe un proceso considerablemente más pobre que el implementado. El pipeline es material de memoria por sí solo.

### 18. El `.env.example` va por detrás del Compose

`docker-compose.yml` interpola cuarenta y una variables. El `.env.example` documenta veintiuna. Faltan las de voz (`DEEPGRAM_API_KEY`, `DEEPGRAM_STT_MODEL`, `DEEPGRAM_STT_LANGUAGE`, `DEEPGRAM_TTS_MODEL`, `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`), las de Stripe (ocho, incluidas las de asiento de entrenador), las seis de memoria vectorial, `SEAT_BILLING_ENABLED` y `LANGFUSE_PROMPT_CACHE_TTL_MS`.

El propio `apps/api/README.md` advierte de que un olvido de reenvío en el bloque `environment:` del Compose deja silenciosamente el contenedor con el valor por defecto, y cita un caso real de esa clase de fallo con Stripe. El riesgo inverso —variable en el Compose pero no documentada— es el que existe ahora.

### 20. Las entidades de dominio listadas no se corresponden con el modelo

La sección «Main Domain Entities» enumera `AuthIdentity`, `Organization`, `Limitation`, `Exercise`, `UserMemory`, `Coupon` y `Subscription`. Ninguna existe con ese nombre en el esquema.

El esquema real define veintiocho tablas. La identidad se reparte entre `users`, `credentials`, `memberships` y `sessions`; el ámbito de tenant es `tenants`; la memoria es `user_memory_vectors` más `vector_memory_settings`, `user_preferences` y `user_profiles`; y la facturación son ocho tablas, ninguna de ellas de cupones.

Y hay dos decisiones de diseño que la lista oculta y que merecen contarse: el catálogo de ejercicios **no es una tabla**, es un paquete versionado, de modo que la taxonomía de patrones y la matriz de carga por zona corporal se revisan como código; y las limitaciones declaradas **no son una entidad**, viven dentro de `plan_specs.spec_json` porque describen una petición de plan y no un historial clínico. Ambas son decisiones defendibles y ninguna estaba documentada.

### 19. Carpeta de cambio duplicada

`openspec/changes/16d-admin-tier-provisioning` sigue activa mientras `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning` ya existe. Es un resto de archivado. `16c-v3-b2b-seat-billing` sí está legítimamente activa.

---

## Correcciones aplicadas en esta rama

`README.md` reescrito en inglés con la tabla de tecnologías real, la estructura de directorios real, los prerrequisitos y comandos verificados uno a uno, el despliegue descrito según el pipeline y el estado de entrega actualizado contra el archivo SDD.

`README.es.md` creado como equivalente en español, con enlace cruzado desde el documento en inglés.

No se ha modificado ningún fichero de código ni de configuración. Los hallazgos 18 y 19 quedan documentados aquí pero **no corregidos**, por ser cambios sobre configuración y sobre el árbol de `openspec/` que exceden el alcance de una tarea documental y merecen su propia revisión.
