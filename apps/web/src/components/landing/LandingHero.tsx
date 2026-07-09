import { getTranslations } from "next-intl/server";
import { KinIcon } from "@/components/icons";
import { OrbitProgress } from "@/components/orbit";
import { Reveal } from "./Reveal";

export async function LandingHero() {
  const t = await getTranslations();

  const days = [
    { key: "mon", label: t("phone.day.mon"), active: true },
    { key: "tue", label: t("phone.day.tue"), active: true },
    { key: "wed", label: t("phone.day.wed"), active: false },
    { key: "thu", label: t("phone.day.thu"), active: true },
    { key: "fri", label: t("phone.day.fri"), active: false, today: true },
    { key: "sat", label: t("phone.day.sat"), active: false },
    { key: "sun", label: t("phone.day.sun"), active: false },
  ];

  return (
    <section className="kin-landing-hero" id="producto">
      <div className="kin-landing-wrap kin-landing-hero__grid">
        <Reveal className="hero-copy">
          <span className="kin-landing-head__eyebrow">
            <KinIcon name="target" size={14} />
            {t("hero.eyebrow")}
          </span>
          <h1>
            {t("hero.title")}
            <em>{t("hero.titleAccent")}</em>
          </h1>
          <p className="kin-landing-hero__sub">{t("hero.subtitle")}</p>
          <div className="kin-landing-hero__cta">
            <a className="kin-btn kin-btn--accent" href="/sign-up">
              {t("hero.cta.primary")}
            </a>
            <a className="kin-btn kin-btn--ghost" href="#como">
              <KinIcon name="play" size={18} />
              {t("hero.cta.secondary")}
            </a>
          </div>
          <div className="kin-landing-hero__meta">
            <span>
              <KinIcon name="check" size={16} />
              {t("hero.meta.nocard")}
            </span>
            <span>
              <KinIcon name="check" size={16} />
              {t("hero.meta.homegym")}
            </span>
            <span>
              <KinIcon name="check" size={16} />
              {t("hero.meta.iosandroid")}
            </span>
          </div>
        </Reveal>

        <Reveal className="kin-landing-hero__visual">
          <div className="kin-landing-hero__glow" aria-hidden="true"></div>
          <div
            className="kin-landing-phone"
            role="img"
            aria-label={t("phone.ariaLabel")}
          >
            <div className="kin-landing-phone__screen">
              <div className="kin-landing-phone__top">
                <div className="kin-landing-phone__who">
                  <span className="kin-landing-phone__avatar">
                    <KinIcon name="target" size={18} />
                  </span>
                  <div>
                    <div className="kin-landing-phone__label">{t("phone.coachLabel")}</div>
                    <div className="kin-landing-phone__name">{t("phone.dayLabel")}</div>
                  </div>
                </div>
                <span className="kin-landing-pill kin-landing-pill--active">
                  {t("phone.pillActive")}
                </span>
              </div>

              <div className="kin-landing-phone__ring-card">
                <div className="kin-landing-phone__ring" aria-hidden="true">
                  <OrbitProgress value={72} max={100} size={76} showPercent />
                </div>
                <div className="kin-landing-phone__ring-meta">
                  <div className="kin-landing-phone__ring-h">{t("phone.ringGoalLabel")}</div>
                  <div className="kin-landing-phone__ring-v">{t("phone.ringGoalValue")}</div>
                </div>
              </div>

              <div className="kin-landing-phone__workout">
                <div className="kin-landing-phone__work-head">
                  <span className="kin-landing-phone__work-t">{t("phone.workoutToday")}</span>
                  <span className="kin-landing-phone__work-dur">{t("phone.workoutDuration")}</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <KinIcon name="check" size={13} />
                  </span>
                  <span className="kin-landing-phone__ex-name">{t("phone.ex1.name")}</span>
                  <span className="kin-landing-phone__ex-set">{t("phone.ex1.set")}</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <KinIcon name="check" size={13} />
                  </span>
                  <span className="kin-landing-phone__ex-name">{t("phone.ex2.name")}</span>
                  <span className="kin-landing-phone__ex-set">{t("phone.ex2.set")}</span>
                </div>
                <div className="kin-landing-phone__ex-row">
                  <span className="kin-landing-phone__ex-check"></span>
                  <span className="kin-landing-phone__ex-name">{t("phone.ex3.name")}</span>
                  <span className="kin-landing-phone__ex-set">{t("phone.ex3.set")}</span>
                </div>
              </div>

              <div className="kin-landing-streak">
                <span className="kin-landing-streak__label">{t("phone.streakLabel")}</span>
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
