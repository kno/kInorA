export function LandingCinemaBand({ alt }: { alt: string }) {
  return (
    <div className="kin-landing-cinema-band" role="presentation">
      <picture>
        <source media="(min-width: 801px)" srcSet="/landing/rest-set-1600.webp" width={1600} height={894} />
        <source media="(max-width: 800px)" srcSet="/landing/rest-set-800.webp" width={800} height={447} />
        <img
          src="/landing/rest-set-1600.webp"
          alt={alt}
          loading="lazy"
          decoding="async"
          width={1600}
          height={894}
        />
      </picture>
    </div>
  );
}

export default LandingCinemaBand;
