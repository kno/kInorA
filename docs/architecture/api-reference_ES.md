# Referencia de API

> 🇬🇧 [English version](./api-reference.md)

API REST sobre Fastify 5, más un canal WebSocket. Los endpoints se registran en `apps/api/src/routes/` y se componen en `app.ts`, que es la única raíz de composición del sistema.

---

## 1. Autenticación

Las rutas protegidas usan el `preHandler` `requireAuth()`. El cliente presenta un token de sesión como credencial `Bearer`; en base de datos solo se guarda su hash.

La cadena de validación es una y está en un único sitio, `apps/api/src/auth/plugin.ts`: comprobación de formato, hash, búsqueda de la sesión, comprobación de expiración, resolución de tenant y usuario, y revalidación de la pertenencia.

Esa última comprobación es una decisión de seguridad explícita. La pertenencia se relee en **cada** petición y el acceso se deniega salvo que su estado sea activo, lo que cierra la ventana en la que alguien suspendido después de emitir su sesión conservaría acceso hasta que el token caducara. La revalidación está acotada por tenant: busca por el par tenant-usuario, no solo por usuario.

El canal WebSocket recibe el token por parámetro de consulta y **usa exactamente la misma función**, de modo que no existe una segunda cadena de validación que pueda divergir.

Del contexto de autenticación salen `tenantId` y `userId`. Ninguno de los dos se lee nunca del cuerpo de la petición; las firmas de los servicios lo documentan.

Las rutas de administración añaden `requireAdmin`, que se apoya en la marca `is_admin` del usuario. No hay interfaz para concederla: se hace por SQL directo, como documenta `apps/api/README.md`.

---

## 2. Registro condicional

Muchas rutas **solo se registran si su puerto ha sido inyectado**. Si `app.ts` no construye el extractor conversacional, la ruta de chat sencillamente no existe, y las del asistente por tarjetas siguen funcionando igual.

Esto cumple dos funciones a la vez. Es un punto de sutura para los tests, que pueden levantar la aplicación sin doblar dependencias que no van a usar. Y es un mecanismo de activación progresiva: una capacidad a medio construir no expone una ruta que devuelva error, simplemente no aparece.

---

## 3. Autenticación y cuenta

| Método | Ruta | Notas |
|---|---|---|
| POST | `/auth/register` | Alta con correo y contraseña, sujeta a política de contraseña |
| POST | `/auth/login` | Devuelve token de sesión |
| POST | `/auth/logout` | Invalida la sesión |
| GET | `/auth/identity` | Identidad y tenant de la sesión |
| GET | `/auth/profile` | Perfil de la persona autenticada |
| GET | `/auth/social/login` | Inicio del flujo OIDC de Google |
| POST | `/auth/social/callback` | Retorno del flujo; vincula por correo si la cuenta ya existe |

## 4. Planificación

| Método | Ruta | Notas |
|---|---|---|
| POST | `/plan-specs/drafts` | Guarda el borrador del asistente, con testigo de versión |
| GET | `/plan-specs/drafts/current` | Borrador vigente del usuario |
| POST | `/plan-specs` | Promociona el borrador a especificación |
| POST | `/plan-specs/:id/confirm` | Confirma e inicia la generación |
| POST | `/plan-specs/:id/regenerate` | Regenera a partir de la misma especificación |
| POST | `/plan-specs/:id/adapt` | Adaptación por adherencia y RPE |
| GET | `/plan-specs/:id/workout-plan` | Plan generado desde su especificación |
| POST | `/plan-specs/chat` | Turno del asistente conversacional |
| POST | `/plan-specs/transcribe` | Audio a texto |
| POST | `/plan-specs/speech` | Texto a audio |
| GET | `/workout-plans` | Listado de planes |
| GET | `/workout-plans/:id` | Detalle |
| PUT | `/workout-plans/:id/program` | Edición del programa |
| POST | `/workout-plans/:id/archive` | Archivado |
| POST | `/workout-plans/:id/unarchive` | Recuperación |
| POST | `/clients/:clientUserId/plan-specs` | Crear plan para un cliente, nivel Entrenador |
| GET | `/clients/:clientUserId/workout-plans/:id` | Plan de un cliente |

No hay borrado de planes: se archivan. La edición usa un testigo de versión entero y monótono, lo que permite detectar escrituras concurrentes.

## 5. Entrenamiento

| Método | Ruta | Notas |
|---|---|---|
| POST | `/workout-sessions` | Inicia sesión de entrenamiento |
| GET | `/workout-sessions/:id` | Detalle |
| GET | `/workout-sessions/history` | Histórico, incluidas las abandonadas en solo lectura |
| PATCH | `/workout-sessions/:id/sets/:setId` | Registro de una serie |
| POST | `/workout-sessions/:id/complete` | Cierre con RPE global y notas |
| POST | `/workout-sessions/:id/abandon` | Abandono explícito |
| DELETE | `/workout-sessions/:id` | Descarte |
| DELETE | `/workout-sessions` | Descarte de la sesión activa |

La base de datos garantiza mediante índice único que una persona no tenga dos sesiones activas a la vez, así que la sincronización de un cliente offline no puede crear un estado imposible.

## 6. Progreso

| Método | Ruta |
|---|---|
| GET | `/progress/dashboard` |
| GET | `/progress/stats` |
| GET | `/progress/weekly-overview` |
| GET | `/progress/exercise-detail` |

## 7. Contexto del usuario

| Método | Ruta | Notas |
|---|---|---|
| GET · PUT | `/user-profile` | Objetivo, nivel, sexo autodeclarado, altura |
| GET · POST | `/weight-entries` | Serie temporal de peso |
| GET · PUT | `/user-preferences` | Valores por defecto y voz |
| GET · POST | `/user-memories` | Memoria del asistente |
| DELETE | `/user-memories/:id` | Borrado de un recuerdo |
| PATCH | `/user-memories/settings` | Activación de la memoria |

La persona puede leer, añadir y borrar su propia memoria. No es una caja negra.

## 8. Catálogo de ejercicios

| Método | Ruta |
|---|---|
| GET | `/exercises/catalog` |
| GET | `/exercises/catalog/facets` |
| GET | `/exercises/catalog/:id` |

## 9. Facturación

| Método | Ruta | Notas |
|---|---|---|
| GET | `/billing/pricing` | Precios de la página pública |
| GET | `/billing/visibility` | Qué debe mostrarse a este tenant |
| GET | `/billing/usage` | Consumo frente a límites |
| PUT | `/billing/allocations` | Reparto de cuota entre miembros |
| POST | `/billing/checkout` | Sesión de pago en Stripe |
| POST | `/billing/portal` | Portal de cliente |
| GET | `/billing/invoices` | Facturas |
| POST | `/billing/webhook` | Entrada de eventos de Stripe |

El webhook se registra **dos veces**, sin prefijo y bajo `/api`. El motivo está anotado en `app.ts`: solo la variante prefijada es alcanzable desde fuera a través del proxy, y sin ese segundo registro Stripe no podía entregar los eventos.

La idempotencia se resuelve en la tabla `stripe_processed_events`, indexada por identificador de evento, y el orden con la marca temporal del evento guardada en el estado del tenant.

## 10. Entrenador y marca blanca

| Método | Ruta | Notas |
|---|---|---|
| GET | `/trainer/clients` | Clientes asignados |
| POST | `/trainer/clients/invite` | Invitación |
| POST | `/trainer/clients/accept` | Aceptación por parte del cliente |
| POST | `/trainer/clients/:clientUserId/revoke` | Revocación |
| GET | `/trainer/clients/:clientUserId/dashboard` | Progreso del cliente |
| GET | `/me/trainer-plan` | Plan asignado, desde la vista del cliente |
| GET · PUT | `/branding` | Marca del tenant |
| GET | `/media/branding/:key` | Logotipo servido desde el almacenamiento |
| GET | `/public/branding/by-slug/:slug` | Marca pública por subdominio, sin autenticar |

## 11. Administración

| Método | Ruta | Notas |
|---|---|---|
| GET · PUT | `/admin/ai-config` | Proveedor y modelo de IA activos |
| GET | `/admin/tenants` | Listado de tenants |
| GET | `/admin/tenants/:tenantId/tier-override` | Anulación vigente |
| POST | `/admin/tenants/:tenantId/tier-override` | Conceder nivel manualmente |
| POST | `/admin/tenants/:tenantId/tier-override/revoke` | Revocar |
| GET | `/admin/stats` | Métricas de plataforma |
| GET | `/admin/logs` | Eventos de observabilidad |

## 12. Salud y tiempo real

| Método | Ruta | Notas |
|---|---|---|
| GET | `/health` · `/api/health` | Sonda usada por Compose y por el pipeline |
| GET | `/ws/plans` | WebSocket: aviso de plan listo o fallido |

El canal WebSocket es lo que permite responder de inmediato a la petición de generación y avisar después, sin que el cliente tenga que sondear.
