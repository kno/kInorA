import type { KinIconName } from "@/components/icons";
import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";

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
    <section className="kin-landing-section" id="how-it-works">
      <div className="kin-landing-wrap">
        <OrbitSectionHeader className="kin-landing-head" eyebrow={messages.hiw_eyebrow ?? ""} title={messages.hiw_title ?? ""} description={messages.hiw_subtitle ?? ""} />
        <div className="kin-landing-steps">
          {steps.map((step) => (
            <OrbitCard className="kin-landing-step" key={step.num}>
              <div className="kin-landing-step__num"><b>{step.num}</b></div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
              <KinIcon className="kin-landing-step__icon" name={step.icon} size={24} />
            </OrbitCard>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingHowItWorks;
