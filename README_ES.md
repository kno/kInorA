# kInorA

Entrenamiento personalizado con **I**nteligencia **A**rtificial.

> 🇬🇧 [English version](./README.md)

kInorA genera y adapta planes de entrenamiento a la medida de cada persona —objetivos, nivel, material disponible y limitaciones físicas— mediante dos modos de interacción: un asistente visual por tarjetas y un asistente conversacional por voz. El sistema aprende del progreso real sesión a sesión y ajusta el plan de forma continua.

---

## a. Visión general

kInorA es una plataforma formada por una **aplicación web**, una **aplicación móvil nativa** y una **API**, con un motor de IA en el centro del producto. Sus rasgos diferenciales:

- **Definición del plan en dos modos**: tarjetas (rápido y visual) o conversación con voz (natural y matizada). Ambos modos alimentan la misma estructura de datos, de modo que se puede alternar entre ellos sin perder lo avanzado.
- **Adaptación a limitaciones físicas**: la persona declara lesiones, patologías crónicas o limitaciones de movilidad, y la IA filtra, sustituye o ajusta los ejercicios en consecuencia, siempre como sugerencia y nunca como diagnóstico médico. El texto de las limitaciones se enmascara antes de llegar a cualquier traza de observabilidad.
- **Adaptación al material disponible**: el plan respeta a qué tiene acceso la persona (gimnasio completo, material limitado en casa o nada). Si un ejercicio resulta inviable después de generar el plan, se sustituye automáticamente por uno equivalente.
- **Memoria persistente del usuario**: memoria estructurada más memoria vectorial sobre pgvector. La IA recuerda preferencias, material, contexto y patrones de comportamiento entre sesiones. La persona puede consultar, editar y borrar esa memoria.
- **Registro de entrenamiento con enfoque offline-first**: anotación de series con un flujo de tres estados (por debajo / cumplido / por encima) pensado para usarse en el gimnasio, con sincronización automática al recuperar conectividad.
- **Proveedores de IA intercambiables**: la generación, la transcripción y la síntesis de voz están detrás de un puerto. Elegir proveedor es una decisión operativa, no un cambio de código.
- **Modelo freemium con prueba**: nivel gratuito funcional, prueba Pro de 30 días sin tarjeta y sistema de cupones para campañas y recomendaciones.

---

## b. Pila tecnológica

| Capa | Tecnología |
| --- | --- |
| Web | Next.js 16 (App Router) + React 19 + TypeScript |
| PWA y offline en web | Service worker con Serwist, IndexedDB mediante `idb` |
| Móvil | React Native 0.79 + Expo 53 (`apps/mobile`). Existe además un contenedor Android de Capacitor que envuelve la compilación web, configurado en la raíz. |
| API | Fastify 5 + Node.js 24 |
| Base de datos | PostgreSQL 17 con la extensión `pgvector` |
| ORM | Drizzle |
| Autenticación | Implementación propia en la API: email y contraseña con política y hash, OIDC de Google mediante `openid-client`, sesiones por cookie y vinculación automática de cuentas por correo |
| Orquestación del LLM | LangChain (`@langchain/core`) con salida estructurada por esquema JSON |
| Proveedor de LLM por defecto | OpenRouter (`OPENROUTER_MODEL`, por ejemplo `openai/gpt-4o-mini`) |
| Proveedores de LLM seleccionables | OpenAI, Anthropic, Google Generative AI y OpenCode-Go, conmutables en caliente desde `/admin/ai-config` |
| Gestión de prompts y observabilidad del LLM | Langfuse: prompts remotos versionados bajo la etiqueta `production`, trazas, redacción de datos sensibles y detección de deriva de plantillas |
| Reconocimiento de voz | OpenAI (por defecto), Gemini o Deepgram, según `VOICE_STT_PROVIDER` |
| Síntesis de voz | OpenAI (por defecto), Gemini o Deepgram, según `VOICE_TTS_PROVIDER` |
| Pagos y suscripciones | Stripe |
| Internacionalización | `next-intl` en web, `react-intl` en móvil, catálogos compartidos en `packages/i18n` |
| Almacenamiento de recursos | Puerto de almacenamiento de objetos con adaptador de sistema de ficheros local en el VPS |
| Repositorio | Monorepo con espacios de trabajo de pnpm |
| Infraestructura | Docker y Docker Compose sobre VPS; imágenes multiarquitectura publicadas en GHCR |
| CI/CD | GitHub Actions |

Todavía no hay proveedor de correo transaccional integrado. Véase [Próximos pasos](#g-próximos-pasos).

---

## c. Instalación y ejecución

### Requisitos previos

- Node.js ≥ 24.17.0 (véase `.node-version`)
- pnpm 10.17.1 (fijado en `packageManager`; basta con `corepack enable`)
- Docker y Docker Compose
- Una clave de API de OpenRouter para la generación de planes con IA (no hace falta para los tests unitarios, que usan `MockPlanGenerator`)
- Credenciales de OAuth de Google para el inicio de sesión
- Opcionales: claves de Langfuse para gestión de prompts y trazas, claves de Deepgram para voz y claves de prueba de Stripe para facturación

### Puesta en marcha

1. Clonar el repositorio:

   ```bash
   git clone git@github.com:kno/kInorA.git
   cd kInorA
   ```

2. Instalar las dependencias del monorepo:

   ```bash
   pnpm install
   ```

3. Copiar el fichero de entorno de ejemplo y rellenar los valores. Hay un **único** `.env` en la raíz del repositorio; las aplicaciones no tienen el suyo propio:

   ```bash
   cp .env.example .env
   ```

   La referencia completa de variables está en [`apps/api/README.md`](./apps/api/README.md), que documenta cuáles son obligatorias, cuáles dependen del proveedor elegido y cuáles se pueden omitir.

4. Arrancar la base de datos local:

   ```bash
   docker compose up -d postgres
   ```

   La imagen fijada es `pgvector/pgvector:pg17` porque la migración de memoria vectorial ejecuta `CREATE EXTENSION vector`. Una imagen `postgres:*` sin más hará fallar esa migración.

5. Ejecutar las migraciones:

   ```bash
   pnpm --filter api db:migrate
   ```

   Para la memoria vectorial, `VECTOR_MEMORY_EMBEDDING_MODEL` y `VECTOR_MEMORY_EMBEDDING_DIMENSION` deben coincidir con los embeddings ya almacenados en Postgres (`text-embedding-3-small` y `1536` por defecto en Compose). Cambiar esos valores sin volver a generar los embeddings crea una cohorte incompatible que la API omitirá deliberadamente al recuperar.

   Para desactivar la escritura y la recuperación de memoria vectorial sin parar la API, basta con dejar `OPENAI_API_KEY` sin valor: la frontera de embeddings falla de forma abierta y el resto de la generación de planes sigue funcionando. No se debe quitar `CREATE EXTENSION vector` de la migración ni cambiar la imagen de Postgres.

Con esto basta para una ejecución local. El catálogo de ejercicios viaja dentro de `packages/exercise-catalog` y sus miniaturas se sirven desde `apps/web/public/exercises/`, así que no hay ningún paso de siembra.

Para refrescar el catálogo desde el conjunto de datos original y volver a replicar sus recursos, existe un script de mantenimiento:

```bash
pnpm import:exercise-catalog
```

Reconstruye los datos y los recursos del catálogo a partir del conjunto de datos original fijado por versión. No toca la base de datos.

### Ejecución en desarrollo

Arrancar web y API en paralelo (los paquetes del espacio de trabajo se compilan antes):

```bash
pnpm dev
```

- Web disponible en `http://localhost:3000`
- API disponible en `http://localhost:4000`

Para arrancar un único espacio de trabajo:

```bash
pnpm --filter web dev
pnpm --filter api dev
```

La aplicación móvil se ejecuta con Expo:

```bash
pnpm --filter mobile start
```

### Puertas de calidad

Las mismas comprobaciones que ejecuta la integración continua, y las que impone el hook `pre-push` en local:

```bash
pnpm type-check
pnpm test
pnpm architecture     # dependency-cruiser + test negativo de arquitectura
pnpm deps-guard
pnpm ui-api-guard
pnpm build
pnpm test:e2e         # Playwright, levanta su propia pila
```

### Compilación de producción

```bash
pnpm build
```

### Despliegue

El despliegue está automatizado en `.github/workflows/ci-cd.yml` y se dispara al integrar en `main`. El pipeline tiene seis fases:

1. **CI**: verificación de tipos, tests unitarios y de integración, y las guardas de arquitectura, dependencias e interfaz contra API.
2. **Integración de facturación**: la suite que toca Stripe, contra una instancia real de PostgreSQL.
3. **Prueba de humo de Docker**: construye la imagen y comprueba que arranca.
4. **Construcción de imagen**: compilación multiarquitectura sobre una matriz de ejecutores.
5. **Fusión del manifiesto**: publica el manifiesto multiarquitectura combinado en GHCR.
6. **Despliegue**: se conecta al VPS por SSH y publica la nueva imagen con Docker Compose.

El paso de despliegue transmite su configuración como carga codificada en base64 para evitar la inyección por línea de órdenes en SSH, y fija la huella del host desde `VPS_KNOWN_HOSTS` en lugar de confiar en el primer uso. Las variables gestionadas por el pipeline —referencia de imagen, credenciales de OAuth y URL base de la API— tienen precedencia sobre el `.env` del operador, de modo que un valor obsoleto olvidado en el servidor nunca pueda hacer que un despliegue en verde ejecute una imagen antigua.

El `.env` del operador contiene los secretos de ejecución (`OPENROUTER_*`, `LANGFUSE_*`, `DEEPGRAM_*`, `STRIPE_*` y opcionalmente `POSTGRES_*`), reside únicamente en el VPS, no lo envía nunca la integración continua y sobrevive a los despliegues. Las credenciales del pipeline se gestionan como secretos de GitHub Actions: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` y, opcionalmente, `VPS_PORT`, `VPS_DEPLOY_DIR` y `PRODUCTION_BASE_URL`.

---

## d. Estructura del proyecto

```
kInorA/
├── apps/
│   ├── api/                     # Fastify — lógica de negocio y endpoints
│   │   └── src/
│   │       ├── routes/          # Endpoints REST
│   │       ├── ai/              # Puertos y adaptadores de LLM, STT y TTS, Langfuse
│   │       ├── auth/            # Sesiones, credenciales, OIDC de Google, selección de tenant
│   │       ├── billing/         # Stripe, niveles, cupones, asientos
│   │       ├── plan/            # Generación y gestión de planes
│   │       ├── user-memory/     # Memoria estructurada y vectorial
│   │       ├── tenant/          # Aislamiento multi-tenant
│   │       ├── branding/        # Marca blanca
│   │       ├── observability/   # Trazas y eventos operativos
│   │       ├── storage/         # Puerto de almacenamiento y adaptador local
│   │       ├── ws/              # WebSocket
│   │       └── db/              # Esquema Drizzle, migraciones y repositorios
│   │
│   ├── web/                     # Next.js — landing, área privada y panel de administración
│   └── mobile/                  # React Native + Expo
│
├── packages/
│   ├── contracts/               # Contratos de API compartidos y validación con Zod
│   ├── domain/                  # Reglas de negocio — sin framework, interfaz, BD ni red
│   ├── exercise-catalog/        # Catálogo de ejercicios
│   └── i18n/                    # Catálogos de mensajes compartidos
│
├── android/                     # Contenedor Android de Capacitor
├── docs/                        # Documentación del proyecto
├── openspec/                    # Especificaciones y cambios archivados — fuente de verdad
├── scripts/                     # Guardas, pila E2E, despliegue, importación del catálogo
├── tests/e2e/                   # Playwright
├── .github/workflows/           # Pipelines de CI/CD
├── capacitor.config.ts
├── docker-compose.yml
├── Dockerfile
├── pnpm-workspace.yaml
├── AGENTS.md                    # Contrato de trabajo para agentes de IA
└── README.md
```

### Modelo persistido

El esquema Drizzle de `apps/api/src/db/schema.ts` define 29 tablas y 20 tipos enumerados, agrupadas por área:

| Área | Tablas |
|---|---|
| Tenancy e identidad | `tenants`, `users`, `memberships`, `credentials`, `oauth_accounts`, `sessions` |
| Planificación | `plan_drafts`, `plan_specs`, `workout_plans` |
| Registro de entrenamiento | `workout_sessions`, `session_exercises`, `set_records` |
| Contexto del usuario | `user_profiles`, `user_weight_entries`, `user_preferences`, `user_memory_vectors`, `vector_memory_settings` |
| Facturación | `tenant_billing_states`, `tenant_billing_overrides`, `tenant_quota_counters`, `member_quota_allocations`, `member_quota_counters`, `billing_usage_ledger`, `billing_audit_events`, `stripe_processed_events` |
| Entrenador y marca blanca | `trainer_client_assignments`, `tenant_branding` |
| IA y observabilidad | `ai_provider_config`, `observability_events` |

Dos cosas viven deliberadamente fuera de la base de datos. El **catálogo de ejercicios** es un paquete versionado (`packages/exercise-catalog`) en lugar de una tabla, de modo que la taxonomía y la matriz de carga por zona corporal se revisan como código. Y las **limitaciones declaradas** forman parte de la carga útil del `PlanSpec` almacenada en `plan_specs.spec_json`, no una entidad aparte: describen una petición de plan, no un historial clínico. Los **cupones** son objetos de Stripe aplicados en el pago; la plataforma no guarda una tabla propia de cupones.

---

## e. Funcionalidades principales

### Definición del plan de entrenamiento

- Modo tarjetas: asistente de 7 pasos (objetivo, días, duración, lugar, material, limitaciones y confirmación)
- Modo conversacional: chat guiado por IA con extracción incremental de datos, con entrada y salida por voz
- Cambio fluido entre ambos modos sin perder lo avanzado

### Personalización con IA

- Generación del plan según objetivo, nivel, disponibilidad y material
- Adaptación a lesiones y limitaciones físicas con sustitución inteligente de ejercicios
- Ajuste dinámico del plan según adherencia, RPE y progreso real
- Memoria persistente, estructurada y vectorial, consultable y editable por la persona

### Operación del sistema de IA

- Selección de proveedor de generación, transcripción y síntesis sin volver a desplegar
- Prompts versionados en Langfuse y promocionados por etiqueta. Un fallo de descarga, un prompt inexistente o una plantilla que no supere la validación en frontera hacen caer el sistema a la plantilla compilada, de modo que una caída de Langfuse nunca rompe la generación
- Cada traza registra qué fuente de prompt sirvió la petición
- El texto relativo a la salud se redacta antes de llegar a ninguna traza

### Registro de entrenamiento

- Registro offline-first con anotación rápida de series (por debajo / cumplido / por encima)
- Realimentación por zona corporal tras los ejercicios adaptados a lesiones
- Revisión posterior a la sesión con RPE global y notas
- Recuperación de sesiones abandonadas con aviso de conflicto accionable e histórico de solo lectura

### Estadísticas y progreso

- Panel con adherencia, volumen semanal, racha y récords personales
- Vista de detalle por ejercicio con progresión de carga
- Volumen que incorpora el peso corporal a partir de las métricas del perfil
- Panel de memoria del asistente con gestión por parte del usuario

### Gestión de planes

- Listado de planes en web y móvil
- Renombrado, edición y archivado múltiple; los planes se archivan en lugar de borrarse

### Cuenta y autenticación

- Registro con correo y contraseña, y con OAuth de Google
- Vinculación automática de cuentas por correo entre proveedores
- Arquitectura extensible para añadir más proveedores sociales

### Modelo de suscripción

- Niveles Gratuito y Pro, con prueba Pro de 30 días sin tarjeta
- Sistema de cupones para campañas y programas de recomendación
- Nivel Entrenador con gestión de clientes y planes con marca propia
- Marca blanca B2B con personalización por gimnasio

---

## f. Estado de entrega

El proyecto se construye a partir de especificaciones versionadas en `openspec/specs/`, siguiendo el ciclo SDD definido en [`AGENTS.md`](./AGENTS.md). Cada cambio cerrado queda archivado con su rastro de auditoría completo en `openspec/changes/archive/`.

Principios de obligado cumplimiento durante toda la ejecución:

- La aplicación **debe instalarse, arrancar y superar las comprobaciones de humo desde la primera porción de trabajo**.
- **Arquitectura limpia**, con dependencias apuntando hacia dentro y contratos compartidos.
- **Multi-tenant desde el primer commit.**
- **Seguridad por diseño**: validación en las fronteras, aislamiento de tenant y fallo seguro por defecto.
- **TDD estricto**: RED → GREEN → Triangle para los casos límite.
- El trabajo de interfaz usa la instantánea local de Open Design en `docs/open-design/kinora/` y la dirección de marca **Orbit**.
- Las limitaciones físicas generan **avisos y sustituciones sugeridas**, nunca diagnóstico médico ni bloqueo clínico.

### v1 — MVP · entregado

| Especificación | Alcance | Archivada |
|---|---|---|
| `01a-v1-monorepo-setup` | Monorepo pnpm y base arrancable de web y API | 2026-06-20 |
| `01b-v1-clean-architecture-contracts` | Capas, contratos compartidos y reglas de dependencia | 2026-06-20 |
| `01c-v1-multi-tenant-schema` | Ámbito de tenant desde la primera migración | 2026-06-21 |
| `02-v1-infrastructure-ci-cd` | Docker, health checks, CI/CD y despliegue en VPS | 2026-06-21 |
| `03-v1-quality-tdd` | Pila de tests, cobertura y flujo RED-GREEN-Triangle | 2026-06-21 |
| `04-v1-ai-operation` | `AGENTS.md` y reglas de colaboración con IA | 2026-06-21 |
| `05b-v1-security-tenant-validation` | Aislamiento de tenant, autorización y validación de entrada | 2026-06-23 |
| `06-v1-mobile-foundation` | PWA, base responsiva y contenedor nativo | 2026-06-24 |
| `05a-v1-auth-core` | Credenciales, OAuth y vinculación de cuentas | 2026-06-26 |
| `06b-v1-orbit-ui-shell` | Sistema de diseño Orbit, landing y navegación | 2026-06-26 |
| `06c-v1-opendesign-component-foundation` | Iconos compartidos y componentes estándar | 2026-06-26 |
| `07-v1-plan-wizard` | Flujo de creación por tarjetas que produce `PlanSpec` | 2026-06-27 |
| `08-v1-ai-plan-generation` | Generación de planes con IA y sustituciones seguras | 2026-07-06 |
| `09-ai-provider-admin` | Selección de proveedor y modelo en caliente | 2026-07-06 |
| `09a-v1-workout-tracking-core` | Registro de entrenamiento en vivo | 2026-07-06 |
| `09b-plan-view` · `09c-plan-view-design` | Pantallas de plan | 2026-07-06 |
| `85-route-layer-boundaries` | Límites de la capa de rutas | 2026-07-07 |
| `93-plan-navigation-and-start` | Navegación del plan e inicio de sesión de entrenamiento | 2026-07-07 |
| `09b-v1-workout-offline-history` | Offline-first, sincronización e histórico | 2026-07-16 |
| `100-i18n-icu-adoption` | Catálogos ICU compartidos y runtimes de web y móvil | 2026-07-16 |
| `09c-v1-progress-dashboard-stats` | Panel, estadísticas y progreso por ejercicio | 2026-07-20 |
| `09d-v1-offline-flush-hardening` | Endurecimiento del volcado offline | 2026-07-21 |
| `09e-v1-e2e-resource-safety` | Seguridad de recursos en E2E | 2026-07-21 |
| `10-v1-sidebar-user-menu` | Menú de usuario en la barra lateral | 2026-07-21 |
| `10b-user-memory-vector` | Memoria vectorial con embeddings | 2026-07-23 |
| `11a-billing-plans-tiers` | Niveles Gratuito y Pro, prueba de 30 días y gating | 2026-07-23 |
| `10a-user-memory-structured` | Memoria estructurada editable | 2026-07-25 |
| `11b-v1-billing-stripe-integration` | Stripe, webhooks y cupones | 2026-07-25 |

### v1.1 — Interacción conversacional y adaptación · entregado

| Especificación | Alcance | Archivada |
|---|---|---|
| `12-v1.1-interactive-text-chat` | Flujo conversacional de creación de plan | 2026-07-25 |
| `13-v1.1-interactive-voice-chat` | Asistente de voz con STT y TTS | 2026-07-26 |
| `14a-v1.1-adaptation-adherence` | Adaptación según la adherencia real | 2026-07-26 |
| `14b-v1.1-adaptation-rpe-feedback` | Adaptación según RPE y realimentación | 2026-07-30 |

### v2 — Nivel Entrenador · entregado

| Especificación | Alcance | Archivada |
|---|---|---|
| `15a-v2-trainer-account-access` | Cuenta de entrenador, permisos y asignación de clientes | 2026-07-31 |
| `15b-v2-trainer-dashboard-branding` | Panel de clientes, progreso y planes con marca | 2026-08-01 |

### v3 — Gimnasios B2B · en curso

| Especificación | Alcance | Estado |
|---|---|---|
| `16a-v3-gym-white-label` | Marca blanca: identidad, dominio e imagen | Archivada 2026-08-02 |
| `16d-admin-tier-provisioning` | Aprovisionamiento administrativo de niveles | Archivada 2026-08-02 |
| `16e-langfuse-prompt-management` | Gestión remota de prompts y observabilidad del LLM | Archivada 2026-08-07 |
| `16c-v3-b2b-seat-billing` | Facturación por asiento | En curso |
| `16b-v3-gym-admin-multigym` | Administración de gimnasios, analítica agregada y multisede | Especificada, sin empezar |

### Incrementos de producto · entregados

| Especificación | Alcance | Archivada |
|---|---|---|
| `17b-stale-session-recovery` | Recuperación de sesiones abandonadas e histórico de solo lectura | 2026-08-07 |
| `17c-profile-body-metrics` | Perfil, métricas corporales y volumen con peso corporal | 2026-08-08 |
| `17d-plan-management` | Listado, archivado, renombrado y edición de planes | 2026-08-09 |

---

## g. Próximos pasos

- Cerrar `16c-v3-b2b-seat-billing` y arrancar `16b-v3-gym-admin-multigym`.
- Integrar un proveedor de correo transaccional. Los flujos de cuenta y facturación no envían hoy ningún correo.
- Realinear `.env.example` con `docker-compose.yml`: las variables de voz, Stripe, memoria vectorial y facturación por asiento las inyecta Compose pero no están documentadas en el fichero de ejemplo.
- Definir una métrica de calidad de los planes generados, para poder comparar cambios de proveedor y de modelo con algo más que latencia y coste.
- Medir el coste de LLM por usuario en cada proveedor, ahora que cambiar de proveedor es una decisión operativa.
