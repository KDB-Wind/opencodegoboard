import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseUsageResponse, parseUsageResponseDetailed } from './opencode-usage';

describe('parseUsageResponse', () => {
  it('accepts compact and whitespace serializer layouts', () => {
    const fixture = fs.readFileSync(
      path.join(__dirname, '__fixtures__', 'usage-response.txt'),
      'utf8',
    );

    const records = parseUsageResponse(fixture);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      usg_id: 'usg_compact',
      input_tokens: 100,
      cache_read_tokens: 30,
      cache_write_1h_tokens: 0,
      reasoning_tokens: 9,
      session_id: 'ses_alpha',
      cost_usd: 0.00123456,
    });
    expect(records[1]).toMatchObject({
      usg_id: 'usg_spaced',
      model: 'deepseek-v4-pro',
      input_tokens: 200,
      cache_write_1h_tokens: 2,
      reasoning_tokens: 15,
      session_id: 'ses_beta',
      cost_usd: 0.0025,
    });
  });

  it('skips a usage anchor that has no creation timestamp', () => {
    expect(parseUsageResponse('id: "usg_incomplete", model: "x"')).toEqual([]);
    expect(
      parseUsageResponseDetailed('id: "usg_incomplete", model: "x"'),
    ).toMatchObject({ anchor_count: 1, skipped_count: 1 });
  });
});
