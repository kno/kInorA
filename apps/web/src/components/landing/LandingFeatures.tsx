import type { KinIconName } from "@/components/icons";
import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";

export function LandingFeatures({ messages }: { messages: Record<string, string> }) {
  const features = [
    {
      icon: "clock" as KinIconName,
      title: messages.features_adaptive_title,
      desc: messages.features_adaptive_desc,
    },
    {
      icon: "mic" as KinIconName,
      title: messages.features_voice_title,
      desc: messages.features_voice_desc,
    },
    {
      icon: "target" as KinIconName,
      title: messages.features_tracking_title,
      desc: messages.features_tracking_desc,
    },
    {
      icon: "stats" as KinIconName,
      title: messages.features_stats_title,
      desc: messages.features_stats_desc,
    },
  ];

  return (
    <section className="kin-landing-section">
      <div className="kin-landing-wrap">
        <OrbitSectionHeader className="kin-landing-head" eyebrow={messages.features_eyebrow ?? ""} title={messages.features_title ?? ""} description={messages.features_subtitle ?? ""} />
        <div className="kin-landing-features">
          {features.map((f) => (
            <OrbitCard className="kin-landing-feature" key={f.icon}>
              <span className="kin-landing-feature__icon">
                <KinIcon name={f.icon} size={21} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </OrbitCard>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingFeatures;
