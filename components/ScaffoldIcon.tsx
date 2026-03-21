export function ScaffoldIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
    >
      {/* Base/ground */}
      <rect x="4" y="28" width="24" height="2" rx="1" />
      {/* Left vertical pole */}
      <rect x="6" y="8" width="2.5" height="20" rx="1" />
      {/* Right vertical pole */}
      <rect x="23.5" y="8" width="2.5" height="20" rx="1" />
      {/* Cross bars (completed levels) */}
      <rect x="6" y="22" width="20" height="2" rx="0.5" />
      <rect x="6" y="16" width="20" height="2" rx="0.5" />
      {/* Top bar being placed (in motion) */}
      <rect x="6" y="10" width="14" height="2" rx="0.5" opacity="0.5" />
      {/* Diagonal brace */}
      <line x1="8.5" y1="22" x2="23.5" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      {/* Spark/building indicators */}
      <circle cx="22" cy="6" r="1.5" opacity="0.3" />
      <circle cx="25" cy="4" r="1" opacity="0.2" />
    </svg>
  )
}
