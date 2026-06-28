import type { KinIconName } from "@/components/icons";
import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";
import { Reveal } from "./Reveal";

export function LandingHowItWorks({ messages }: { messages: Record<string, string> }) {
  const steps = [
    {
      num: "01",
      title: messages.hiw_step1_title,
      desc: messages.hiw_step1_desc,
      icon: "info" as KinIconName,
    },
    {
      num: "02",
      title: messages.hiw_step2_title,
      desc: messages.hiw_step2_desc,
      icon: "plan" as KinIconName,
    },
    {
      num: "03",
      title: messages.hiw_step3_title,
      desc: messages.hiw_step3_desc,
      icon: "trend" as KinIconName,
    },
  ];

  return (
    <section className="kin-landing-section" id="como">
      <div className="kin-landing-wrap">
        <Reveal>
          <OrbitSectionHeader className="kin-landing-head" eyebrow={messages.hiw_eyebrow ?? ""} title={messages.hiw_title ?? ""} description={messages.hiw_subtitle ?? ""} />
        </Reveal>
        <div className="kin-landing-como-split">
          <Reveal className="kin-landing-como-img">
            <picture>
              <source media="(min-width: 761px)" srcSet="/landing/hero-squat-1120.webp" width={1120} height={1400} />
              <source media="(max-width: 760px)" srcSet="/landing/hero-squat-640.webp" width={640} height={800} />
              <img
                src="/landing/hero-squat-1120.webp"
                alt={messages.como_img_alt ?? "Mujer realizando una sentadilla con barra cargada en el gimnasio, con postura correcta y concentración total"}
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
