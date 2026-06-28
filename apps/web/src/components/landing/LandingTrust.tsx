import type { KinIconName } from "@/components/icons";
import { KinIcon } from "@/components/icons";
import { OrbitCard } from "@/components/orbit";
import { Reveal } from "./Reveal";

export interface TrustItem {
  icon: string;
  title: string;
  desc: string;
}

const trustIconMap: Record<string, KinIconName> = {
  chart: "chart",
  check: "checkbox",
  clock: "clock",
  mic: "mic",
};

export function LandingTrust({ items }: { items: TrustItem[] }) {
  return (
    <section className="kin-landing-section kin-landing-section--no-top">
      <div className="kin-landing-wrap">
        <Reveal>
          <div className="kin-landing-strip">
            {items.map((item) => (
              <OrbitCard as="article" key={item.title} className="kin-landing-strip__item">
                <KinIcon className="kin-landing-strip__icon" name={trustIconMap[item.icon] ?? "info"} size={24} />
                <div className="kin-landing-strip__title">{item.title}</div>
                <div className="kin-landing-strip__desc">{item.desc}</div>
              </OrbitCard>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default LandingTrust;
