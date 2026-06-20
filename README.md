# kInorA

Entrenamiento personalizado asistido por **I**nteligencia **A**rtificial.

kInorA genera y adapta planes de entrenamiento a medida de cada usuario — objetivos, nivel, equipamiento disponible y limitaciones físicas — a través de dos modos de interacción: un wizard visual de tarjetas y un asistente conversacional con voz. El sistema aprende del progreso real del usuario sesión a sesión y ajusta el plan de forma continua.

---

## a. Descripción general

kInorA es una plataforma compuesta por una **web** (landing pública + zona privada) y una **app mobile**, con un motor de IA como núcleo del producto. Sus características distintivas:

- **Definición de planes en dos modos**: tarjetas (rápido, visual) o conversacional con voz (natural, matizado). Ambos modos alimentan la misma estructura de datos (`plan_spec`), por lo que el usuario puede alternar entre ellos sin perder progreso.
- **Adaptación a limitaciones físicas**: el usuario declara lesiones, condiciones crónicas o limitaciones de movilidad, y la IA filtra, sustituye o ajusta ejercicios en consecuencia — siempre como sugerencia, nunca como diagnóstico médico.
- **Adaptación a equipamiento disponible**: el plan respeta lo que el usuario tiene accesible (gimnasio completo, equipamiento casero limitado, o nada). Si un ejercicio resulta no viable después de generado el plan, se sustituye automáticamente por un equivalente.
- **Memoria persistente del usuario**: la IA recuerda preferencias, equipamiento, contexto y patrones de comportamiento entre sesiones, enriqueciendo cada interacción futura. El usuario puede ver, editar y borrar esta memoria.
- **Seguimiento de entrenamiento offline-first**: registro de series con un flujo de tres estados (por debajo / cumplido / por encima) optimizado para uso en el gimnasio, con sincronización automática al recuperar conexión.
- **Modelo freemium con trial sin fricción**: tier gratuito funcional, 30 días de Pro sin necesidad de tarjeta, y sistema de cupones para campañas y referidos.

---

## b. Stack tecnológico

| Capa                        | Tecnología                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Frontend (web)              | Next.js + TypeScript                                                                              |
| Backend (API)               | Fastify + Node.js                                                                                 |
| Base de datos               | PostgreSQL                                                                                        |
| ORM                         | Drizzle                                                                                           |
| Autenticación               | Auth.js (NextAuth v5) — email/contraseña + Google OAuth, con account linking automático por email |
| Integración LLM             | Vercel AI SDK (agnóstico de proveedor)                                                            |
| Modelo LLM                  | OpenAI GPT-4o                                                                                     |
| Reconocimiento de voz (STT) | OpenAI Whisper                                                                                    |
| Síntesis de voz (TTS)       | OpenAI TTS                                                                                        |
| Pagos y suscripciones       | Stripe                                                                                            |
| Email transaccional         | Resend                                                                                            |
| Almacenamiento de assets    | Cloudflare R2 (S3-compatible)                                                                     |
| App mobile                  | PWA embebida en shell nativa vía Capacitor                                                        |
| Repositorio                 | Monorepo — pnpm workspaces                                                                        |
| Infraestructura             | VPS + Docker                                                                                      |
| CI/CD                       | GitHub Actions                                                                                    |

---

## c. Instalación y ejecución

### Requisitos previos

- Node.js ≥ 20
- pnpm ≥ 9
- Docker y Docker Compose
- PostgreSQL 16 (o usar el contenedor incluido)
- Cuenta de OpenAI con API key
- Cuenta de Stripe (modo test para desarrollo)
- Credenciales OAuth de Google

### Configuración

1. Clona el repositorio:

   ```bash
   git clone https://github.com/<org>/kinora.git
   cd kinora
   ```

2. Instala las dependencias del monorepo:

   ```bash
   pnpm install
   ```

3. Copia el archivo de variables de entorno de ejemplo en cada app y rellena los valores:

   ```bash
   cp apps/web/.env.example apps/web/.env
   cp apps/api/.env.example apps/api/.env
   ```

   Variables principales a configurar: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

4. Levanta la base de datos local:

   ```bash
   docker compose up -d postgres
   ```

5. Ejecuta las migraciones:

   ```bash
   pnpm --filter api db:migrate
   ```

   _(opcional)_ Pobla el catálogo de ejercicios con datos de partida:

   ```bash
   pnpm --filter api db:seed
   ```

### Ejecución en desarrollo

Arranca web y API en paralelo:

```bash
pnpm dev
```

- Web disponible en `http://localhost:3000`
- API disponible en `http://localhost:4000`

Para ejecutar solo un workspace:

```bash
pnpm --filter web dev
pnpm --filter api dev
```

### Build de producción

```bash
pnpm build
```

### Despliegue

El despliegue es automático vía GitHub Actions al hacer push a `main`. El pipeline ejecuta sobre el VPS:

```bash
git pull origin main
docker build -t kinora .
docker run -d --env-file .env -p 80:3000 kinora
```

El archivo `.env` de producción vive únicamente en el VPS y nunca se sube al repositorio. Las credenciales del pipeline (SSH, etc.) se gestionan como GitHub Actions Secrets.

---

## d. Estructura del proyecto

```
kinora/
├── apps/
│   ├── web/                    # Next.js — landing, zona privada, dashboard
│   │   ├── app/                # App Router de Next.js
│   │   ├── components/         # Componentes React
│   │   └── .env.example
│   │
│   └── api/                    # Fastify — lógica de negocio y endpoints
│       ├── src/
│       │   ├── routes/         # Endpoints REST
│       │   ├── modules/        # Dominio: plans, exercises, limitations, memory, tracking, billing
│       │   ├── db/             # Esquema Drizzle y migraciones
│       │   └── ai/             # Integraciones con Vercel AI SDK (LLM, STT, TTS)
│       └── .env.example
│
├── packages/
│   └── shared/                 # Tipos TypeScript y schemas Zod compartidos entre web y api
│
├── mobile-shell/                # Configuración de Capacitor — wraps la PWA en shell nativa
│
├── .github/
│   └── workflows/              # Pipelines de CI/CD
│
├── docker-compose.yml           # Entorno local (Postgres, etc.)
├── Dockerfile
├── pnpm-workspace.yaml
└── README.md
```

### Entidades principales del dominio

- `User` / `AuthIdentity` — usuarios y sus métodos de autenticación vinculados
- `Organization` — preparado para multi-tenant (tier Trainer y B2B en versiones futuras)
- `Limitation` — lesiones y limitaciones físicas declaradas
- `Exercise` — catálogo de ejercicios con taxonomía de patrones y matriz de carga por zona corporal
- `PlanSpec` — especificación de un plan, poblada desde modo tarjetas o conversacional
- `WorkoutSession` / `SessionExercise` / `SetRecord` — jerarquía de seguimiento de entrenamiento
- `UserMemory` — memoria persistente de contexto del usuario para personalización de la IA
- `Coupon` / `Subscription` — gestión de planes de pago, trials y promociones

---

## e. Funcionalidades principales

### Definición de planes de entrenamiento

- Modo tarjetas: wizard de 7 pasos (objetivo, días, duración, localización, equipamiento, limitaciones, confirmación)
- Modo conversacional: chat guiado por IA con extracción incremental de datos, con soporte de voz (entrada y salida)
- Cambio fluido entre ambos modos sin pérdida de progreso

### Personalización por IA

- Generación de planes según objetivo, nivel, disponibilidad y equipamiento
- Adaptación a lesiones y limitaciones físicas con sustitución inteligente de ejercicios
- Ajuste dinámico del plan según adherencia, RPE y progreso real
- Memoria persistente: la IA recuerda preferencias, equipamiento y contexto entre sesiones, visible y editable por el usuario

### Seguimiento de entrenamiento

- Tracker offline-first con registro rápido de series (por debajo / cumplido / por encima)
- Feedback de zona corporal tras ejercicios adaptados por lesión
- Check-in post-sesión con RPE global y notas

### Estadísticas y progreso

- Dashboard con adherencia, volumen semanal, racha y récords personales
- Vista de detalle por ejercicio con progresión de carga
- Panel de memoria del asistente con gestión por parte del usuario

### Cuenta y autenticación

- Registro con email/contraseña y Google OAuth
- Vinculación automática de cuentas por email entre proveedores
- Arquitectura extensible a nuevos proveedores sociales

### Modelo de suscripción

- Tiers Free y Pro
- Trial de 30 días de Pro sin necesidad de tarjeta de crédito
- Sistema de cupones para campañas y programas de referidos
- Arquitectura preparada (no activa en v1) para tier Trainer y B2B gimnasios

---

## Roadmap

- **v1** — MVP: modo tarjetas, generación de plan por IA, tracker, tiers Free/Pro
- **v1.1** — Modo conversacional con voz, adaptación dinámica del plan
- **v2** — Tier Trainer: gestión de clientes, planes con marca propia
- **v3** — B2B Gimnasios: white label, integración multi-tenant
