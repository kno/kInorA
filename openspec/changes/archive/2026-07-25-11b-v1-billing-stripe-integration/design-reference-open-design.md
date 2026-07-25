# Design reference — Open Design `web-billing.html`

The 11b web work MUST respect the existing Open Design billing screen:
**OD project `kiNorA` (id ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad), file `screens/web-billing.html`.**

## Structure (what the design shows)

- **Sidebar** with account entry at the bottom linking to billing (`account-link active`, "Cuenta · Plan Gratis").
- **Topbar**: title "Facturación" + subtitle + a "Descargar recibos" icon action.
- **Main column** (`billing-grid` left, `minmax(0,1.5fr)`):
  - **Plan hero** (`current-plan`): current plan name/status chip, description, meta tiles (Precio, Renovación, Periodo actual, Método de pago), actions "Mejorar a Pro" + "Comparar planes", muscle visual.
  - **Usage card** (`usage`): per-feature meters with `used / limit`, period label, note per feature, footer "Ampliar límites con Pro".
  - **History card** (`history`): "Facturas y cargos" — invoice list, empty state "Aún no hay cargos".
- **Aside** (right, `minmax(320px,.9fr)`):
  - **Pro upgrade card** (`pro-upgrade`): eyebrow "Recomendado", **Monthly/Annual billing-cycle toggle**, price, save badge, feature list, "Mejorar a Pro" CTA, "Sin permanencia · Cancela en un clic".
  - **Payment method card** (`payment-method`): "Método de pago" + "Añadir tarjeta".
  - **Support card** (`support`): billing FAQ link.
- Responsive: desktop sidebar 248px; ≤760px sidebar becomes a bottom tab bar.
- Tokens: dark theme, oklch palette, accent `oklch(89% 0.20 128)` (lime), Space Grotesk (display) + DM Sans (body), card radius 22px.

## Product facts the design encodes (RESOLVE against 11a decisions)

| Design says | 11a code / earlier 11b decision | Conflict? |
|---|---|---|
| Pro **9,99 €/mes** monthly + **7,99 €/mes** annual (save 20%), monthly/annual toggle | Earlier: "config-driven price"; single price assumed | **Two billing cycles** not yet in scope — needs adding |
| Pro = **unlimited** ("ilimitadas / sin límite") | Earlier answer: "high finite metered caps" | **Direct conflict** — unlimited vs metered |
| Free: 3 plan generations, 20 memory notes, 30 voice min | 11a code Free: plan_generation=1, memory_write=0; no voice feature yet (voice = 13) | Design numbers differ from shipped 11a; voice is a later feature |
| **Payment method** management ("Añadir tarjeta") | Decision: Stripe-hosted checkout, no card data on our servers | Implies Stripe Customer Portal / saved-method display — added scope |
| **Invoice history** ("Facturas y cargos", downloadable) | Not in current 11b scope | Added scope (Stripe invoices) |
| Server "Descargar recibos" action | — | Ties to invoices |

## Consequence for 11b

- The web slice must reproduce this layout/tokens (or wire the existing `/billing` page toward it), not invent a new one.
- The **Pro-unlimited vs metered-caps** conflict and the **monthly+annual**, **payment-method management**, and **invoice-history** elements materially change scope — pending maintainer resolution (see proposal open questions).
