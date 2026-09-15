import './globals.css';
// Bundled rather than loaded from a CDN, so the map is styled offline too.
import 'leaflet/dist/leaflet.css';
import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'GreenPulse — Park Ecosystem Health & Biodiversity Portal',
  description:
    'Monitoring the ecological health of Bengaluru parks: live air quality and weather, biodiversity from GBIF records, OpenStreetMap asset mapping, image analysis and citizen reporting.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(inter.variable, display.variable, 'font-sans')}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {/*
            QueryProvider wraps AuthProvider because the session is resolved
            through the same API client the queries use, and AuthProvider's
            logout needs to be able to clear the query cache.
          */}
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster position="top-right" richColors closeButton />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
