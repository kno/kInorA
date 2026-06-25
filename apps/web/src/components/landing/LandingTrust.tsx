export interface TrustItem {
  icon: string;
  title: string;
  desc: string;
}

export function LandingTrust({ items }: { items: TrustItem[] }) {
  return (
    <section className="kin-landing-section kin-landing-section--no-top">
      <div className="kin-landing-wrap">
        <div className="kin-landing-strip">
          {items.map((item) => (
            <div key={item.title}>
              <svg className="kin-landing-strip__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                {item.icon === "clock" && (
                  <path d="M12 3a9 9 0 1 0 9-9M12 7v5l3 3" strokeLinecap="round" />
                )}
                {item.icon === "chart" && (
                  <path d="M4 21v-7M12 21v-9M20 21v-5" strokeLinecap="round" />
                )}
                {item.icon === "check" && (
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                )}
                {item.icon === "mic" && (
                  <path d="M12 3a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Z" strokeLinecap="round" />
                )}
              </svg>
              <div className="kin-landing-strip__title">{item.title}</div>
              <div className="kin-landing-strip__desc">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingTrust;
