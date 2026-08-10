// AdFactory monogram: geometric "A" in orchid + blush on the brand plum.
export function LogoMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#4B164C" />
      <path
        d="M7 17.5 12 6.5l5 11"
        stroke="#DD88CF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M9.4 13.5h5.2" stroke="#F8E7F6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
