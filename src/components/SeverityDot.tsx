import type { AlertSeverity } from '../types';

interface SeverityDotProps {
  severity: AlertSeverity;
}

/**
 * SeverityDot — colored dot indicating alert severity.
 * Critical: red with glow. Elevated: amber with glow. Normal: green.
 */
export default function SeverityDot({ severity }: SeverityDotProps) {
  return <span className={`severity-dot severity-dot--${severity}`} />;
}
