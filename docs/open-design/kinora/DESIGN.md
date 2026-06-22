# DESIGN.md — kInorA

> Sistema de diseño extraído de la sesión v0 `kinora-eOTftpCTxTX`.
> kInorA es una app de fitness/gym con entrenador IA.
> Tema oscuro, acento verde lima.
> Stack reconstruido: **Next.js + Tailwind + shadcn/ui**.

---

## 1. Marca

| Campo | Valor |
|-------|-------|
| Nombre de marca | **kInorA** |
| Categoría | App de fitness con entrenador / asistente IA |
| Tono | Oscuro, atlético, energético, premium-tech |
| Modo | Dark-only |

---

## 2. Color

Paleta confirmada en la sesión: lienzo near-black con un único acento verde
lima de alta saturación. El resto de la escala se deriva en OKLch a partir de
esos dos anclas.

### Tokens base

| Token | Hex | OKLch (aprox.) | Uso |
|-------|-----|----------------|-----|
| `--bg`        | `#09090C` | `oklch(5% 0.006 270)`  | Fondo de la app (near-black) |
| `--surface`   | `#101014` | `oklch(11% 0.006 270)` | Cards, paneles |
| `--surface-2` | `#17171C` | `oklch(15% 0.006 270)` | Card elevado / hover |
| `--border`    | `#26262C` | `oklch(24% 0.006 270)` | Bordes hairline, divisores |
| `--fg`        | `#F4F4F5` | `oklch(96% 0.002 270)` | Texto principal |
| `--muted`     | `#9A9AA2` | `oklch(66% 0.006 270)` | Texto secundario, captions |
| `--accent`    | `#A8F060` | `oklch(89% 0.20 128)`  | Acento de marca (verde lima) |
| `--accent-fg` | `#09090C` | `oklch(5% 0.006 270)`  | Texto/icono sobre el acento |

### Estados

| Token | Hex | Uso |
|-------|-----|-----|
| `--success` | `#A8F060` | Reusa el acento (sesión completada, racha activa) |
| `--warning` | `#F0C95F` | Aviso, descanso pendiente |
| `--danger`  | `#F0605F` | Error, eliminación |
| `--info`    | `#60A8F0` | Información neutra |

### Reglas de uso del color

- **Un solo acento.** El verde lima `#A8F060` aparece como máximo 2 veces por
  pantalla (CTA principal + un dato/estado activo). No floodear con lima.
- Texto sobre lima siempre `--accent-fg` (near-black), nunca blanco.
- Sin gradientes morados/AI-slop. Si hay glow, que sea lima sutil sobre near-black.
- Jerarquía de superficie por elevación (`bg → surface → surface-2`), no por sombra dura.

```css
:root {
  --bg:        oklch(5% 0.006 270);
  --surface:   oklch(11% 0.006 270);
  --surface-2: oklch(15% 0.006 270);
  --border:    oklch(24% 0.006 270);
  --fg:        oklch(96% 0.002 270);
  --muted:     oklch(66% 0.006 270);
  --accent:    oklch(89% 0.20 128);
  --accent-fg: oklch(5% 0.006 270);

  --success: oklch(89% 0.20 128);
  --warning: oklch(84% 0.14 90);
  --danger:  oklch(68% 0.19 25);
  --info:    oklch(72% 0.13 250);
}
```

---

## 3. Tipografía

| Rol | Familia | Notas |
|-----|---------|-------|
| Display / titulares | **Space Grotesk** | Geométrica, técnica. H1–H3, números grandes, métricas |
| Cuerpo / UI | **DM Sans** | Legible, neutra. Párrafos, labels, botones, tablas |

```css
--font-display: 'Space Grotesk', system-ui, sans-serif;
--font-body:    'DM Sans', -apple-system, system-ui, sans-serif;
```

### Escala sugerida

| Token | Tamaño | Familia | Uso |
|-------|--------|---------|-----|
| `display` | 48–72px | Space Grotesk | Hero landing, métricas destacadas |
| `h1` | 32px | Space Grotesk | Título de pantalla |
| `h2` | 24px | Space Grotesk | Sección |
| `h3` | 18px | Space Grotesk | Card title |
| `body` | 16px | DM Sans | Texto base |
| `sm` | 14px | DM Sans | Captions, metadata |
| `mono-num` | tabular | Space Grotesk | Pesos, reps, tiempos, stats |

- Titulares con `letter-spacing: -0.02em`.
- Números de fitness (reps, kg, tiempo) con `font-variant-numeric: tabular-nums`.

---

## 4. Layout y forma

- **Radios:** cards 16–20px, botones/pills 12px, chips 999px (full).
- **Bordes:** hairline 1px con `--border`; sin row-striping en tablas.
- **Espaciado:** ritmo base 8px (8 / 12 / 16 / 24 / 32 / 48).
- **Elevación:** por superficie, no por sombra. Sombras solo en overlays (sheets, dropdowns, modals).
- **Densidad:** cómoda en mobile (hit targets ≥ 44px), más densa en stats web.

---

## 5. Arquitectura de la app

Reconstruida como app **Next.js** con shadcn/ui. App shell compartido:
**sidebar de escritorio + barra inferior en móvil**, envolviendo Dashboard, Plan y Stats.

### Superficies web

| Pantalla | Contenido |
|----------|-----------|
| **Landing** | Hero (con imagen generada) · Features · Cómo funciona · Pricing · CTA · Footer |
| **Dashboard** | Resumen del día, progreso, accesos rápidos |
| **Plan semanal** | Calendario/agenda de entrenamiento por días |
| **Estadísticas** | Analítica con gráficos (shadcn chart) |
| **Creación de plan** | Modo cards + modo conversacional (chat con panel de datos extraídos) |

### Superficies mobile

| Pantalla | Contenido |
|----------|-----------|
| **Dashboard** | Vista principal del día |
| **Creación de plan** | Flujo de armado de rutina |
| **Asistente de voz** | Interacción por voz con la IA |
| **Detalle de ejercicio** | Instrucciones, series, descanso |
| **Tracker de sesión** | Registro en vivo durante el entreno |

---

## 6. Componentes clave (módulos de producto)

- **App shell:** sidebar (desktop) / bottom bar (mobile) con navegación real.
- **Asistente conversacional:** chat de creación de plan + panel lateral de
  "datos extraídos" (objetivo, días, nivel, equipamiento).
- **Tarjetas de entreno:** ejercicio, series × reps, peso, estado de completado.
- **Módulo de racha / check-in:** progreso semanal con el acento lima como "activo".
- **Gráficos de estadísticas:** componente chart de shadcn, líneas/barras en lima sobre near-black.
- **Player / tracker de sesión:** controles de sesión en vivo (start, rest timer, set done).

---

## 7. Anti-patrones (de la sesión)

- ❌ No modo claro: el tema es dark-only (`--background` debe resolver a `#09090C`).
  - *Gotcha de la sesión:* shadcn/tailwind servía un `:root` blanco cacheado
    (`oklch(1 0 0)` → `lab(100% 0 0)`); requirió reiniciar el dev server para que
    el near-black se aplicara. Verificar que `--background` computa a `#09090c`.
- ❌ Sin gradientes AI-slop ni emojis genéricos como iconos.
- ❌ Acento lima usado con moderación, no como fondo de página.

---

*Fuente: chat v0 read-only `https://v0.app/kno2/chat/kinora-eOTftpCTxTX`.
Tokens `#09090C`, `#A8F060`, Space Grotesk y DM Sans confirmados literalmente
en la conversación; el resto de la escala está derivado en OKLch para completar
el sistema.*
