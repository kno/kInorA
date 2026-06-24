export function LandingFeatures({ messages }: { messages: Record<string, string> }) {
  const features = [
    {
      icon: (
        <path d="M3 12a9 9 0 1 1 9 9M12 21l-3-3 3-3M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
      ),
      title: messages.features_adaptive_title,
      desc: messages.features_adaptive_desc,
    },
    {
      icon: (
        <path d="M12 3a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4ZM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" strokeLinecap="round" strokeLinejoin="round" />
      ),
      title: messages.features_voice_title,
      desc: messages.features_voice_desc,
    },
    {
      icon: (
        <circle cx="12" cy="12" r="9" />
      ),
      title: messages.features_tracking_title,
      desc: messages.features_tracking_desc,
    },
    {
      icon: (
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" strokeLinejoin="round" />
      ),
      title: messages.features_stats_title,
      desc: messages.features_stats_desc,
    },
  ];

  return (
    <section className="kin-landing-section">
      <div className="kin-landing-wrap">
        <div className="kin-landing-head">
          <span className="kin-landing-head__eyebrow">{messages.features_eyebrow}</span>
          <h2>{messages.features_title}</h2>
          <p>{messages.features_subtitle}</p>
        </div>
        <div className="kin-landing-features">
          {features.map((f) => (
            <article className="kin-card kin-landing-feature" key={f.title}>
              <span className="kin-landing-feature__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="21" height="21" aria-hidden="true">
                  {f.icon}
                </svg>
              </span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingFeatures;
