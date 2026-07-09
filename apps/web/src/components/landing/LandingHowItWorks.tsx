import { getTranslations } from "next-intl/server";
import type { KinIconName } from "@/components/icons";
import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";
import { Reveal } from "./Reveal";

export async function LandingHowItWorks() {
  const t = await getTranslations();

  const steps = [
    {
      num: "01",
      title: t("hiw.step1.title"),
      desc: t("hiw.step1.desc"),
      icon: "info" as KinIconName,
    },
    {
      num: "02",
      title: t("hiw.step2.title"),
      desc: t("hiw.step2.desc"),
      icon: "plan" as KinIconName,
    },
    {
      num: "03",
      title: t("hiw.step3.title"),
      desc: t("hiw.step3.desc"),
      icon: "trend" as KinIconName,
    },
  ];

  return (
    <section className="kin-landing-section" id="como">
      <div className="kin-landing-wrap">
        <Reveal>
          <OrbitSectionHeader className="kin-landing-head" eyebrow={t("hiw.eyebrow")} title={t("hiw.title")} description={t("hiw.subtitle")} />
        </Reveal>
        <div className="kin-landing-como-split">
          <Reveal className="kin-landing-como-img">
            <picture>
              <source media="(min-width: 761px)" srcSet="/landing/hero-squat-1120.webp" width={1120} height={1400} />
              <source media="(max-width: 760px)" srcSet="/landing/hero-squat-640.webp" width={640} height={800} />
              <img
                src="/landing/hero-squat-1120.webp"
                alt={t("marketing.comoImgAlt")}
                loading="lazy"
                decoding="async"
                width={1120}
                height={1400}
              />
            </picture>
          </Reveal>
          <div className="kin-landing-steps">
            {steps.map((step) => (
              <Reveal key={step.num}>
                <OrbitCard className="kin-landing-step">
                  <div className="kin-landing-step__num"><b>{step.num}</b></div>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                  <KinIcon className="kin-landing-step__icon" name={step.icon} size={24} />
                </OrbitCard>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default LandingHowItWorks;
