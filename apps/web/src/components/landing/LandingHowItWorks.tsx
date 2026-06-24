export function LandingHowItWorks({ messages }: { messages: Record<string, string> }) {
  const steps = [
    {
      num: "01",
      title: messages.hiw_step1_title,
      desc: messages.hiw_step1_desc,
      icon: (
        <path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" />
      ),
    },
    {
      num: "02",
      title: messages.hiw_step2_title,
      desc: messages.hiw_step2_desc,
      icon: (
        <rect x="3" y="4" width="18" height="16" rx="3" />
      ),
    },
    {
      num: "03",
      title: messages.hiw_step3_title,
      desc: messages.hiw_step3_desc,
      icon: (
        <path d="M4 17l5-5 4 4 7-8" strokeLinecap="round" strokeLinejoin="round" />
      ),
    },
  ];

  return (
    <section className="kin-landing-section" id="how-it-works">
      <div className="kin-landing-wrap">
        <div className="kin-landing-head">
          <span className="kin-landing-head__eyebrow">{messages.hiw_eyebrow}</span>
          <h2>{messages.hiw_title}</h2>
          <p>{messages.hiw_subtitle}</p>
        </div>
        <div className="kin-landing-steps">
          {steps.map((step) => (
            <article className="kin-card kin-landing-step" key={step.num}>
              <div className="kin-landing-step__num"><b>{step.num}</b></div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
              <svg className="kin-landing-step__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {step.icon}
              </svg>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingHowItWorks;
