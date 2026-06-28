import { KinIcon } from "@/components/icons";
import { OrbitProgress } from "@/components/orbit";
import { Reveal } from "./Reveal";

export function LandingHero({ messages }: { messages: Record<string, string> }) {
  const days = [
    { key: "mon", label: messages.phone_day_mon ?? "L", active: true },
    { key: "tue", label: messages.phone_day_tue ?? "M", active: true },
    { key: "wed", label: messages.phone_day_wed ?? "X", active: false },
    { key: "thu", label: messages.phone_day_thu ?? "J", active: true },
    { key: "fri", label: messages.phone_day_fri ?? "V", active: false, today: true },
    { key: "sat", label: messages.phone_day_sat ?? "S", active: false },
    { key: "sun", label: messages.phone_day_sun ?? "D", active: false },
  ];

  return (
    <section className="kin-landing-hero" id="producto">
      <div className="kin-landing-wrap kin-landing-hero__grid">
        <Reveal className="hero-copy">
          <span className="kin-landing-head__eyebrow">
            <KinIcon name="target" size={14} />
            {messages.hero_eyebrow}
          </span>
          <h1>
            {messages.hero_title}
            <em>{messages.hero_title_accent}</em>
          </h1>
          <p className="kin-landing-hero__sub">{messages.hero_subtitle}</p>
          <div className="kin-landing-hero__cta">
            <a className="kin-btn kin-btn--accent" href="/sign-up">
              {messages.hero_cta_primary}
            </a>
            <a className="kin-btn kin-btn--ghost" href="#como">
              <KinIcon name="play" size={18} />
              {messages.hero_cta_secondary}
            </a>
          </div>
          <div className="kin-landing-hero__meta">
            <span>
              <KinIcon name="check" size={16} />
              {messages.hero_meta_nocard}
            </span>
            <span>
              <KinIcon name="check" size={16} />
              {messages.hero_meta_homegym}
            </span>
            <span>
              <KinIcon name="check" size={16} />
              {messages.hero_meta_iosandroid}
            </span>
          </div>
        </Reveal>

        <Reveal className="kin-landing-hero__visual">
          <div className="kin-landing-hero__glow" aria-hidden="true"></div>
          <div
            className="kin-landing-phone"
            role="img"
            aria-label={messages.phone_aria_label ?? "Vista previa de la app kInorA mostrando el entreno del día, la racha semanal y el progreso"}
          >
            <div className="kin-landing-phone__screen">
              <div className="kin-landing-phone__top">
                <div className="kin-landing-phone__who">
                  <span className="kin-landing-phone__avatar">
                    <KinIcon name="target" size={18} />
                  </span>
                  <div>
                    <div className="kin-landing-phone__label">{messages.phone_coach_label ?? "Coach kInorA"}</div>
                    <div className="kin-landing-phone__name">{messages.phone_day_label ?? "Día 4 · Fuerza"}</div>
                  </div>
                </div>
                <span className="kin-landing-pill kin-landing-pill--active">
                  {messages.phone_pill_active ?? "En curso"}
                </span>
              </div>

              <div className="kin-landing-phone__ring-card">
                <div className="kin-landing-phone__ring" aria-hidden="true">
                  <OrbitProgress value={72} max={100} size={76} showPercent />
                </div>
                <div className="kin-landing-phone__ring-meta">
                  <div className="kin-landing-phone__ring-h">{messages.phone_ring_goal_label ?? "Objetivo semanal"}</div>
                  <div className="kin-landing-phone__ring-v">{messages.phone_ring_goal_value ?? "3 de 4 sesiones"}</div>
                </div>
              </div>

              <div className="kin-landing-phone__workout">
                <div className="kin-landing-phone__work-head">
                  <span className="kin-landing-phone__work-t">{messages.phone_workout_today ?? "Entreno de hoy"}</span>
                  <span className="kin-landing-phone__work-dur">{messages.phone_workout_duration ?? "42 min"}</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <KinIcon name="check" size={13} />
                  </span>
                  <span className="kin-landing-phone__ex-name">{messages.phone_ex1_name ?? "Sentadilla con barra"}</span>
                  <span className="kin-landing-phone__ex-set">{messages.phone_ex1_set ?? "4 × 8"}</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <KinIcon name="check" size={13} />
                  </span>
                  <span className="kin-landing-phone__ex-name">{messages.phone_ex2_name ?? "Press de banca"}</span>
                  <span className="kin-landing-phone__ex-set">{messages.phone_ex2_set ?? "4 × 10"}</span>
                </div>
                <div className="kin-landing-phone__ex-row">
                  <span className="kin-landing-phone__ex-check"></span>
                  <span className="kin-landing-phone__ex-name">{messages.phone_ex3_name ?? "Remo con mancuerna"}</span>
                  <span className="kin-landing-phone__ex-set">{messages.phone_ex3_set ?? "3 × 12"}</span>
                </div>
              </div>

              <div className="kin-landing-streak">
                <span className="kin-landing-streak__label">{messages.phone_streak_label ?? "Racha"}</span>
                {days.map((d) => (
                  <span
                    key={d.key}
                    className={`kin-landing-day${d.today ? " kin-landing-day--today" : d.active ? " kin-landing-day--active" : ""}`}
                  >
                    {d.active && !d.today ? <KinIcon name="check" size={10} /> : d.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default LandingHero;
