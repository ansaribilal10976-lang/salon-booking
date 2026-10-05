import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function ArrowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" {...props}>
      <path d="M5 19 19 5M5 5h14v14" />
    </svg>
  );
}

export function FlowerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" {...props}>
      <path d="M24 22C8 7 22-5 24 15c2-20 16-8 0 7Zm2 2C41 8 53 22 33 24c20 2 8 16-7 0Zm-2 2c16 15 2 27 0 7-2 20-16 8 0-7Zm-2-2C7 40-5 26 15 24-5 22 7 8 22 24Z" />
      <circle cx="24" cy="24" r="3" />
    </svg>
  );
}

export function ScissorsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="4" />
      <circle cx="8" cy="24" r="4" />
      <path d="m11 11 17 17M11 21 28 4M16 16l4 4" />
    </svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 25C-1 11 13 5 27 5c0 14-7 25-20 20Zm0 0L21 11M7 25l-3 4M13 19h7M16 16v-6" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
