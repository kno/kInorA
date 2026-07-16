import type * as React from "react";

type KinIconSize = number;

type IconRendererProps = Pick<React.SVGProps<SVGSVGElement>, "className">;

export type KinIconSource = "open-design" | "library";

interface KinIconRegistryEntryBase {
  label: string;
  render: (props: IconRendererProps) => React.ReactNode;
}

export interface OpenDesignIconRegistryEntry extends KinIconRegistryEntryBase {
  source: "open-design";
}

export interface LibraryIconRegistryEntry extends KinIconRegistryEntryBase {
  source: "library";
  library: string;
  icon: string;
}

export type KinIconRegistryEntry = OpenDesignIconRegistryEntry | LibraryIconRegistryEntry;

function createOpenDesignIcon(
  label: string,
  render: KinIconRegistryEntry["render"],
): OpenDesignIconRegistryEntry {
  return {
    label,
    source: "open-design",
    render,
  };
}

/**
 * Explicit registry contract for future approved library adapters.
 * This keeps screen code on the shared icon API without introducing a dependency
 * until the library is formally added to the workspace.
 */
export function createLibraryIconEntry(
  label: string,
  options: Pick<LibraryIconRegistryEntry, "library" | "icon" | "render">,
): LibraryIconRegistryEntry {
  return {
    label,
    source: "library",
    library: options.library,
    icon: options.icon,
    render: options.render,
  };
}

export const kinIconRegistry = {
  home: createOpenDesignIcon("Dashboard", ({ className }) => (
    <>
      <path className={className} d="M3 11L12 4L21 11" />
      <path className={className} d="M5 10V20H19V10" />
    </>
  )),
  plan: createOpenDesignIcon("Plan", ({ className }) => (
    <>
      <rect className={className} x="3" y="4" width="18" height="18" rx="2" />
      <path className={className} d="M16 2V6M8 2V6M3 10H21" />
    </>
  )),
  exercises: createOpenDesignIcon("Exercises", ({ className }) => (
    <>
      <path className={className} d="M3 9V15M21 9V15M6 7V17M18 7V17M6 12H18" />
    </>
  )),
  // OpenDesign `dumbbell` glyph (docs/open-design/kinora/icons.html) — reused
  // for the create-plan equipment options instead of introducing new imagery.
  dumbbell: createOpenDesignIcon("Equipment", ({ className }) => (
    <>
      <path className={className} d="M3 9V15M21 9V15M6 7V17M18 7V17M6 12H18" />
    </>
  )),
  stats: createOpenDesignIcon("Statistics", ({ className }) => (
    <>
      <path className={className} d="M4 20V13M10 20V8M16 20V4" />
    </>
  )),
  create: createOpenDesignIcon("Create Plan", ({ className }) => (
    <>
      <path className={className} d="M12 5V19M5 12H19" />
    </>
  )),
  check: createOpenDesignIcon("Complete", ({ className }) => (
    <path className={className} d="M4 12L9 17L20 6" />
  )),
  close: createOpenDesignIcon("Close", ({ className }) => (
    <path className={className} d="M6 6L18 18M18 6L6 18" />
  )),
  play: createOpenDesignIcon("Start", ({ className }) => (
    <path className={className} d="M7 5L19 12L7 19Z" fill="currentColor" stroke="none" />
  )),
  clock: createOpenDesignIcon("Time", ({ className }) => (
    <>
      <circle className={className} cx="12" cy="12" r="8.5" />
      <path className={className} d="M12 7V12L15.5 14" />
    </>
  )),
  mic: createOpenDesignIcon("Voice", ({ className }) => (
    <>
      <rect className={className} x="9" y="3" width="6" height="11" rx="3" />
      <path className={className} d="M5 11A7 7 0 0 0 19 11M12 18V21" />
    </>
  )),
  forward: createOpenDesignIcon("Continue", ({ className }) => (
    <path className={className} d="M9 5L16 12L9 19" />
  )),
  target: createOpenDesignIcon("Goal", ({ className }) => (
    <>
      <circle className={className} cx="12" cy="12" r="8" />
      <circle className={className} cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </>
  )),
  trend: createOpenDesignIcon("Volume", ({ className }) => (
    <>
      <path className={className} d="M3 17L9 11L13 15L21 7" />
      <path className={className} d="M21 7H15.5M21 7V12.5" />
    </>
  )),
  flame: createOpenDesignIcon("Streak", ({ className }) => (
    <path
      className={className}
      d="M12 3C14.5 6.5 17 8.5 17 12.5A5 5 0 0 1 7 12.5C7 10.7 7.8 9.5 9 8.5C9.6 10.3 10.8 10.5 12 9.7C11 7.9 11 5.7 12 3Z"
    />
  )),
  info: createOpenDesignIcon("Info", ({ className }) => (
    <>
      <circle className={className} cx="12" cy="12" r="8.5" />
      <path className={className} d="M12 11V16M12 8V8.2" />
    </>
  )),
  user: createOpenDesignIcon("Profile", ({ className }) => (
    <>
      <circle className={className} cx="12" cy="8" r="4" />
      <path className={className} d="M4.5 20C4.5 16 8 14 12 14S19.5 16 19.5 20" />
    </>
  )),
  instagram: createOpenDesignIcon("Instagram", ({ className }) => (
    <>
      <rect className={className} x="3" y="3" width="18" height="18" rx="5" />
      <circle className={className} cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </>
  )),
  x: createOpenDesignIcon("X", ({ className }) => (
    <path className={className} d="M4 4L20 20M20 4L4 20" />
  )),
  youtube: createOpenDesignIcon("YouTube", ({ className }) => (
    <>
      <rect className={className} x="3" y="5" width="18" height="14" rx="4" />
      <path d="M10 9L15 12L10 15Z" fill="currentColor" stroke="none" />
    </>
  )),
  chart: createOpenDesignIcon("Chart", ({ className }) => (
    <>
      <path className={className} d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" strokeLinecap="round"/>
      <circle className={className} cx="4" cy="12" r="2"/>
      <circle className={className} cx="12" cy="6" r="2"/>
      <circle className={className} cx="20" cy="14" r="2"/>
    </>
  )),
  checkbox: createOpenDesignIcon("Checkbox", ({ className }) => (
    <>
      <rect className={className} x="3" y="3" width="18" height="18" rx="4"/>
      <path className={className} d="M8 13l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round"/>
    </>
  )),
  orbitLogo: createOpenDesignIcon("Orbit logo", ({ className }) => (
    <>
      <circle className={className} cx="24" cy="24" r="15" strokeWidth="4" />
      <path className={className} d="M24 9A15 15 0 0 1 38 19" strokeWidth="4" />
      {/* Brand mark: the orbiting ball is always the lime accent, not currentColor. */}
      <circle cx="24" cy="9" r="5.5" fill="var(--accent)" stroke="none" />
    </>
  )),
  menu: createOpenDesignIcon("Menu", ({ className }) => (
    <path className={className} d="M4 7h16M4 12h16M4 17h16" />
  )),
  history: createOpenDesignIcon("History", ({ className }) => (
    <>
      <path className={className} d="M3 12A9 9 0 1 0 6 5.3" />
      <path className={className} d="M3 4V9H8" />
      <path className={className} d="M12 7V12L16 14.5" />
    </>
  )),
} as const;

export type KinIconName = keyof typeof kinIconRegistry;

export interface KinIconProps extends Omit<React.ComponentPropsWithoutRef<"svg">, "children"> {
  name: KinIconName;
  size?: KinIconSize;
  decorative?: boolean;
  title?: string;
}

export function KinIcon({
  name,
  size = 24,
  decorative = true,
  title,
  className,
  ...svgProps
}: KinIconProps) {
  const icon = kinIconRegistry[name];
  const accessibleLabel = title ? undefined : icon.label;
  const viewBox = name === "orbitLogo" ? "0 0 48 48" : "0 0 24 24";

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : accessibleLabel}
      role={decorative ? undefined : "img"}
      focusable="false"
      {...svgProps}
    >
      {title ? <title>{title}</title> : null}
      {icon.render({ className })}
    </svg>
  );
}

export const HomeIcon = (props: Omit<KinIconProps, "name">) => <KinIcon name="home" {...props} />;
export const PlanIcon = (props: Omit<KinIconProps, "name">) => <KinIcon name="plan" {...props} />;
export const StatsIcon = (props: Omit<KinIconProps, "name">) => <KinIcon name="stats" {...props} />;
export const CreateIcon = (props: Omit<KinIconProps, "name">) => <KinIcon name="create" {...props} />;
export const ExercisesIcon = (props: Omit<KinIconProps, "name">) => <KinIcon name="exercises" {...props} />;
export const HistoryIcon = (props: Omit<KinIconProps, "name">) => <KinIcon name="history" {...props} />;
export const OrbitLogoIcon = (props: Omit<KinIconProps, "name" | "size"> & { size?: 16 | 24 | 32 }) => (
  <KinIcon name="orbitLogo" size={props.size ?? 24} {...props} />
);
