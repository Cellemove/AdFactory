import type { ReactNode } from "react";

function Icon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {children}
    </svg>
  );
}

export const CheckIcon = (p: { className?: string }) => <Icon {...p}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></Icon>;
export const CrossIcon = (p: { className?: string }) => <Icon {...p}><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></Icon>;
export const ClockIcon = (p: { className?: string }) => <Icon {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6.5V10l2.5 1.5" /></Icon>;
export const AlertIcon = (p: { className?: string }) => <Icon {...p}><path d="M10 3.5l7 12.5H3L10 3.5z" /><path d="M10 8.5v3M10 14h.01" /></Icon>;
export const PlayIcon = (p: { className?: string }) => <Icon {...p}><path d="M6.5 4.5l9 5.5-9 5.5v-11z" fill="currentColor" stroke="none" /></Icon>;
export const StopIcon = (p: { className?: string }) => <Icon {...p}><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /></Icon>;
export const ArrowIcon = (p: { className?: string }) => <Icon {...p}><path d="M5 10h10M11 6l4 4-4 4" /></Icon>;
export const SparkIcon = (p: { className?: string }) => <Icon {...p}><path d="M10 3.5l1.6 4.2 4.4 1.5-4.4 1.5L10 15l-1.6-4.3L4 9.2l4.4-1.5L10 3.5z" /></Icon>;

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`animate-spin motion-reduce:animate-none ${className}`}>
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
      <path d="M17 10a7 7 0 0 0-7-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
