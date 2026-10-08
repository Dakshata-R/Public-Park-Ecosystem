import Link from 'next/link';
import { Leaf, MapPin, Bird, Wind } from 'lucide-react';

/**
 * Layout for the sign-in and registration screens.
 *
 * Deliberately outside the dashboard shell: there is no sidebar to show
 * before a role is known. The left panel is a short, quiet introduction.
 */
const HIGHLIGHTS = [
  { icon: MapPin, text: 'Bengaluru parks mapped from OpenStreetMap' },
  { icon: Bird, text: 'Species records and biodiversity indices from GBIF' },
  { icon: Wind, text: 'Live air quality and weather from Open-Meteo' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: a short introduction. Hidden on small screens, where the form
          is all there is room for. */}
      <div className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <Leaf className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-bold">GreenPulse</span>
        </Link>

        <div className="max-w-sm space-y-6">
          <div className="space-y-3">
            <h1 className="font-display text-3xl font-bold leading-tight">
              Healthier parks, one record at a time.
            </h1>
            <p className="text-sm leading-relaxed text-primary-foreground/75">
              Monitor ecosystem health and biodiversity across Bengaluru&apos;s public parks.
            </p>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-primary-foreground/90">
                <Icon className="h-4 w-4 shrink-0 text-primary-foreground/70" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-primary-foreground/50">Ecosystem &amp; Biodiversity Portal</p>
      </div>

      {/* Right: the form. */}
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
