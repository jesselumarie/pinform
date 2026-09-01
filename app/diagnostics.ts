export interface DiagnosticEntry {
  elapsedMs: number;
  message: string;
  details?: string;
}

interface DiagnosticReport {
  generatedAt: string;
  userAgent: string;
  secureContext: boolean;
  entries: DiagnosticEntry[];
}

export function formatDiagnostics({ generatedAt, userAgent, secureContext, entries }: DiagnosticReport) {
  const lines = [
    'PINFORM DIAGNOSTICS',
    `generated=${generatedAt}`,
    `user_agent=${userAgent}`,
    `secure_context=${secureContext}`,
    '---',
    ...entries.map(({ elapsedMs, message, details }) => {
      const timestamp = `[${(elapsedMs / 1000).toFixed(3)}s]`;
      return details ? `${timestamp} ${message} · ${details}` : `${timestamp} ${message}`;
    }),
  ];
  return lines.join('\n');
}
