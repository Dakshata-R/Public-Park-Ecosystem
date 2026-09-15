import Link from 'next/link';
import { Leaf } from 'lucide-react';

/**
 * Layout for the sign-in and registration screens.
 *
 * Deliberately outside the dashboard shell: there is no sidebar to show
 * before a role is known, and the split panel gives the project's purpose a
 * moment of explanation before asking for credentials.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: the pitch. Hidden on small screens, where the form is all
          there is room for. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-accent p-10 text-primary-foreground lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white blur-3xl" />
          <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white blur-3xl" />
        </div>

        <Link href="/dashboard" className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Leaf className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="font-display text-lg font-bold">GreenPulse</p>
            <p className="text-xs text-primary-foreground/70">Ecosystem &amp; Biodiversity Portal</p>
          </div>
        </Link>

        <div className="relative max-w-md space-y-5">
          <h1 className="font-display text-3xl font-bold leading-tight">
            Bengaluru&apos;s parks, read from open data.
          </h1>
          <p className="text-sm leading-relaxed text-primary-foreground/80">
            Cubbon Park, Lalbagh Botanical Gardens and other Bengaluru parks, mapped from
            OpenStreetMap, with species records from GBIF, air quality and weather from
            Open-Meteo, and photograph analysis by a MobileNetV2 image model — alongside an
            incident, maintenance and citizen-reporting workflow shown with demonstration records.
          </p>

          <div className="grid grid-cols-2 gap-3 pt-2">
            {[
              ['GBIF species records', 'Shannon and Simpson indices from occurrence records since 2023'],
              ['CPCB AQI', 'Computed from Open-Meteo (CAMS) pollutant concentrations'],
              ['OpenStreetMap', 'Park boundaries, facilities and asset positions'],
              ['MobileNetV2', 'ImageNet classifier run on the server, with staff review of its findings'],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-primary-foreground/70">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-primary-foreground/60">
          Academic prototype · Incidents, work orders and citizen reports are labelled demo records;
          water, soil and noise sensors are simulated.
        </p>
      </div>

      {/* Right: the form. */}
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
