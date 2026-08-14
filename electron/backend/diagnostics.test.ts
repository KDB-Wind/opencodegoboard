import { describe, expect, it } from 'vitest';
import { redactDiagnosticValue, sanitizeFixtureText } from './diagnostics';

describe('diagnostic redaction', () => {
  it('removes secrets and fingerprints private identifiers', () => {
    const result = redactDiagnosticValue({
      auth_cookie: 'session=top-secret', workspace_id: 'wrk_personal123',
      nested: { session_id: 'ses_personal123', total_records: 42 },
    }) as Record<string, unknown>;
    expect(result.auth_cookie).toBe('[REDACTED]');
    expect(result.workspace_id).toMatch(/^\[HASH:/);
    expect(JSON.stringify(result)).not.toContain('personal123');
    expect((result.nested as Record<string, unknown>).total_records).toBe(42);
  });

  it('sanitizes captured HTTP fixtures', () => {
    const input = 'Authorization: Bearer sk-secret\nCookie: session=abc\n{"session_id":"ses_private999","email":"me@example.com"}';
    const output = sanitizeFixtureText(input);
    expect(output).not.toContain('sk-secret');
    expect(output).not.toContain('session=abc');
    expect(output).not.toContain('ses_private999');
    expect(output).not.toContain('me@example.com');
  });
});
