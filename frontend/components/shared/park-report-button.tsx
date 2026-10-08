'use client';

/**
 * One-click ecosystem report: the server computes the report for the selected
 * park (metrics, findings, recommendations) and the browser renders it as a
 * PDF. Shown to roles that may generate reports (ecologist and above).
 */

import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/providers/auth-provider';
import { useGenerateReport, usePublicSettings } from '@/lib/hooks/use-api';
import { fmt, NO_DATA } from '@/components/shared/score-badge';
import type { EcoReport } from '@/lib/types';

/** Reporting period, in days. */
const REPORT_DAYS = 90;

/** Read a nested value from a report's metrics without trusting its shape. */
function metricAt(metrics: unknown, path: string): unknown {
  let current: unknown = metrics;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** The headline figures of an ecosystem report. */
const KEY_METRICS: { label: string; path: string; decimals?: number; suffix?: string }[] = [
  { label: 'Ecosystem Health score', path: 'ecosystemHealth', decimals: 1, suffix: ' / 100' },
  { label: 'Species recorded', path: 'biodiversity.richness' },
  { label: 'Average AQI (CPCB)', path: 'sensors.aqi.mean', decimals: 0 },
  { label: 'Incidents in period', path: 'incidents.total' },
  { label: 'Work orders completed', path: 'maintenance.completionRate', decimals: 0, suffix: '%' },
];

const valueOf = (report: EcoReport, def: (typeof KEY_METRICS)[number]) => {
  const value = metricAt(report.metrics, def.path);
  if (typeof value !== 'number') return NO_DATA;
  const text = fmt(value, def.decimals ?? 0);
  return text === NO_DATA ? text : `${text}${def.suffix ?? ''}`;
};

const dateOnly = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export function ParkReportButton({ park, parkLabel }: { park?: string; parkLabel: string }) {
  const { can } = useAuth();
  const generate = useGenerateReport();
  const { data: publicSettings } = usePublicSettings();

  if (!can('ecologist')) return null;

  const download = async (report: EcoReport) => {
    const { jsPDF } = await import('jspdf'); // loaded only when a report is downloaded
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 48;
    const pageHeight = doc.internal.pageSize.getHeight();
    const width = doc.internal.pageSize.getWidth() - marginX * 2;
    let y = 60;

    /** Write wrapped text, starting a new page when the cursor runs out. */
    const write = (text: string, size: number, style: 'normal' | 'bold' = 'normal', gap = 6) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      for (const line of doc.splitTextToSize(text, width)) {
        if (y > pageHeight - 60) {
          doc.addPage();
          y = 60;
        }
        doc.text(line, marginX, y);
        y += size + 2;
      }
      y += gap;
    };

    const organisation = publicSettings?.organisationName?.trim();
    write(`GreenPulse — Ecosystem Report${organisation ? ` · ${organisation}` : ''}`, 10, 'normal', 2);
    write(parkLabel, 18, 'bold');
    write(`Period: ${dateOnly(report.periodStart)} — ${dateOnly(report.periodEnd)} · Generated ${dateOnly(new Date().toISOString())}`, 9);

    if (report.summary) {
      write('Summary', 13, 'bold', 3);
      write(report.summary, 10);
    }

    write('Key figures', 13, 'bold', 3);
    for (const def of KEY_METRICS) write(`• ${def.label}: ${valueOf(report, def)}`, 10, 'normal', 1);
    y += 5;

    if (report.findings.length) {
      write('Findings', 13, 'bold', 3);
      report.findings.forEach((finding, i) => write(`${i + 1}. ${finding}`, 10, 'normal', 3));
    }
    if (report.recommendations.length) {
      write('Recommendations', 13, 'bold', 3);
      report.recommendations.forEach((rec, i) => write(`${i + 1}. ${rec}`, 10, 'normal', 3));
    }

    write('Data: GBIF.org · Open-Meteo.com (CAMS) · © OpenStreetMap contributors.', 8);
    doc.save(`greenpulse-report-${parkLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  };

  const onClick = () => {
    generate.mutate(
      { type: 'ecosystem', park: park ?? null, days: REPORT_DAYS },
      {
        onSuccess: async (report) => {
          try {
            await download(report);
            toast.success('Report downloaded');
          } catch {
            toast.error('Could not create the PDF');
          }
        },
      }
    );
  };

  return (
    <Button variant="outline" onClick={onClick} disabled={generate.isPending}>
      {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
      {generate.isPending ? 'Preparing…' : 'Download report'}
    </Button>
  );
}
