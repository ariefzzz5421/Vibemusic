type VibeLogoMarkProps = { size?: number; className?: string };

export default function VibeLogoMark({ size = 24, className = '' }: VibeLogoMarkProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="19" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5"/>
    <path d="M15 27v-6m6 12V15m6 13v-8m6 13V15m6 12v-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
    <circle cx="24" cy="24" r="2.3" fill="var(--color-signal)"/>
  </svg>;
}
