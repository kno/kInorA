import { getTranslations } from "next-intl/server";
import type { KinIconName } from "@/components/icons";
import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";
import { Reveal } from "./Reveal";

export async function LandingFeatures() {
  const t = await getTranslations();

  const features = [
    {
      icon: "clock" as KinIconName,
      title: t("features.adaptive.title"),
      desc: t("features.adaptive.desc"),
    },
    {
      icon: "mic" as KinIconName,
      title: t("features.voice.title"),
      desc: t("features.voice.desc"),
    },
    {
      icon: "target" as KinIconName,
      title: t("features.tracking.title"),
      desc: t("features.tracking.desc"),
    },
    {
      icon: "stats" as KinIconName,
      title: t("features.stats.title"),
      desc: t("features.stats.desc"),
    },
  ];

  return (
    <section className="kin-landing-section kin-landing-section--no-top">
      <div className="kin-landing-wrap">
        <Reveal>
          <OrbitSectionHeader className="kin-landing-head" eyebrow={t("features.eyebrow")} title={t("features.title")} description={t("features.subtitle")} />
        </Reveal>
        <div className="kin-landing-features">
          {features.map((f) => (
            <Reveal key={f.icon}>
              <OrbitCard className="kin-landing-feature">
                <span className="kin-landing-feature__icon">
                  <KinIcon name={f.icon} size={21} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </OrbitCard>
            </Reveal>
          ))}
        </div>
        <Reveal className="kin-landing-strength-split">
          <div>
            <OrbitSectionHeader
              className="kin-landing-head"
              eyebrow={t("features.strength.eyebrow")}
              title={t("features.strength.title")}
              description={t("features.strength.desc")}
            />
          </div>
          <div className="kin-landing-strength-img">
            <picture>
              <source media="(min-width: 761px)" srcSet="/landing/strength-1120.webp" width={1120} height={1400} />
              <source media="(max-width: 760px)" srcSet="/landing/strength-640.webp" width={640} height={800} />
              <img
                src="/landing/strength-1120.webp"
                alt={t("marketing.strengthImgAlt")}
                loading="lazy"
                decoding="async"
                width={1120}
                height={1400}
              />
            </picture>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default LandingFeatures;
