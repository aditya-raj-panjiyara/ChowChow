import type { ReactNode } from 'react';

interface MonoTextProps {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}

/**
 * MonoText — wraps content in JetBrains Mono.
 * Used for every ID, timestamp, weight, lat/long, and confidence score
 * to create the "precision instrumentation" feel.
 */
export default function MonoText({ children, className = '', muted = false }: MonoTextProps) {
  return (
    <span className={`font-mono ${muted ? 'text-muted' : ''} ${className}`}>
      {children}
    </span>
  );
}
