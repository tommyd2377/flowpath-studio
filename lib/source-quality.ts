import { z } from 'zod';

// Host-owned coverage limits, not source claims or a detector for missing text.
export const sourceQualityWarningSchema = z.enum(['pdf-text-only']);
export type SourceQualityWarning = z.infer<typeof sourceQualityWarningSchema>;

export function sourceQualityWarnings(format: string): SourceQualityWarning[] {
  return format === 'pdf' ? ['pdf-text-only'] : [];
}

export function sourceQualityMessage(warning: SourceQualityWarning): string {
  switch (warning) {
    case 'pdf-text-only': return 'PDF text only: lettering in images or drawings may be missing, and columns or headings may read out of order. Compare names, prices and qualifications with the original; no OCR or visual coverage check was performed.';
  }
}
