import { randomUUID } from 'crypto';
import { DEFAULT_USAGE_SERVER_ID, loadServiceConfig } from './config';
import { USER_AGENT, buildCookieHeader, resolveWorkspaceId } from './quota';

export const USAGE_PAGE_SIZE = 50;
const TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 4 << 20;

// Server-fn has emitted both `id:"..."` and `id: "..."` forms. Use record
// anchors instead of relying on one exact serializer layout.
const RECORD_ANCHOR_RE = /id\s*:\s*"(usg_[^"]+)"/g;

const PLAN_RE =
  /id\s*:\s*"(usg_[^"]+)"[^}]*?enrichment\s*:\s*\$R\[\d+\]\s*=\s*\{\s*plan\s*:\s*"([^"]+)"\s*\}/gs;

export interface ParsedUsageRecord {
  usg_id: string;
  created_at: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cost_raw: number;
  cost_usd: number;
  key_id: string;
  plan: string | null;
}

export interface UsageParseResult {
  records: ParsedUsageRecord[];
  anchor_count: number;
  skipped_count: number;
}

export class UsageResponseParseError extends Error {
  readonly parseErrorCount: number;

  constructor(anchorCount: number, skippedCount: number) {
    super(`用量响应包含 ${anchorCount} 条记录锚点，其中 ${skippedCount} 条无法解析`);
    this.name = 'UsageResponseParseError';
    this.parseErrorCount = skippedCount;
  }
}

export function toDbDict(r: ParsedUsageRecord): Record<string, unknown> {
  return {
    usg_id: r.usg_id,
    created_at: r.created_at,
    model: r.model,
    provider: r.provider,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_read_tokens: r.cache_read_tokens,
    cache_write_5m_tokens: r.cache_write_5m_tokens,
    cache_write_1h_tokens: r.cache_write_1h_tokens,
    cost_raw: r.cost_raw,
    cost_usd: r.cost_usd,
    key_id: r.key_id,
    plan: r.plan,
  };
}

export function parseUsageResponseDetailed(text: string): UsageParseResult {
  const plans = new Map<string, string>();
  PLAN_RE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PLAN_RE.exec(text)) !== null) {
    plans.set(pm[1], pm[2]);
  }

  RECORD_ANCHOR_RE.lastIndex = 0;
  const anchors = [...text.matchAll(RECORD_ANCHOR_RE)];
  const records: ParsedUsageRecord[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const start = (anchor.index ?? 0) + anchor[0].length;
    const end = i + 1 < anchors.length ? (anchors[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end);
    const readString = (name: string) =>
      body.match(new RegExp(`${name}\\s*:\\s*"([^"]*)"`))?.[1] ?? '';
    const readNumber = (name: string) =>
      body.match(new RegExp(`${name}\\s*:\\s*(\\d+|null)`))?.[1] ?? '0';
    const createdAt = body.match(
      /timeCreated\s*:\s*\$R\[\d+\]\s*=\s*new Date\("([^"]+)"\)/,
    )?.[1];
    if (!createdAt) continue;
    const costInt = parseOptionalToken(readNumber('cost'));
    const usgId = anchor[1];
    records.push({
      usg_id: usgId,
      created_at: createdAt,
      model: readString('model'),
      provider: readString('provider'),
      input_tokens: parseOptionalToken(readNumber('inputTokens')),
      output_tokens: parseOptionalToken(readNumber('outputTokens')),
      cache_read_tokens: parseOptionalToken(readNumber('cacheReadTokens')),
      cache_write_5m_tokens: parseOptionalToken(readNumber('cacheWrite5mTokens')),
      cache_write_1h_tokens: parseOptionalToken(readNumber('cacheWrite1hTokens')),
      cost_raw: costInt,
      cost_usd: costInt / 100_000_000,
      key_id: readString('keyID'),
      plan: plans.get(usgId) ?? null,
    });
  }
  return {
    records,
    anchor_count: anchors.length,
    skipped_count: anchors.length - records.length,
  };
}

export function parseUsageResponse(text: string): ParsedUsageRecord[] {
  return parseUsageResponseDetailed(text).records;
}

function usageServerId(): string {
  return loadServiceConfig().opencode.usage_server_id || DEFAULT_USAGE_SERVER_ID;
}

function parseOptionalToken(value: string): number {
  if (value === 'null' || value === '') return 0;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUsagePage(opts: {
  workspace_id: string;
  auth_cookie: string;
  page?: number;
  key_id?: string | null;
}): Promise<ParsedUsageRecord[]> {
  const cookieHeader = buildCookieHeader(opts.auth_cookie);
  if (!cookieHeader) throw new Error('OpenCode Go auth cookie 为空');

  const page = opts.page ?? 0;
  const args: unknown[] = [opts.workspace_id];
  if (opts.key_id) {
    if (page > 0) args.push(page, opts.key_id);
    else args.push(opts.key_id);
  } else if (page > 0) {
    args.push(page);
  }

  const serverId = usageServerId();
  const url = `https://opencode.ai/_server?id=${encodeURIComponent(serverId)}&args=${encodeURIComponent(JSON.stringify(args))}`;
  const referer = `https://opencode.ai/workspace/${opts.workspace_id}/usage`;
  const headers: Record<string, string> = {
    Cookie: cookieHeader,
    'X-Server-Id': serverId,
    'X-Server-Instance': `server-fn:${randomUUID()}`,
    'User-Agent': USER_AGENT,
    Origin: 'https://opencode.ai',
    Referer: referer,
    Accept: 'text/javascript, application/json;q=0.9, */*;q=0.8',
  };

  const resp = await fetchWithTimeout(url, { headers, redirect: 'manual' });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`认证失败 (HTTP ${resp.status})，请检查 auth cookie`);
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`使用记录查询返回 HTTP ${resp.status}`);
  }
  const text = (await resp.text()).slice(0, MAX_RESPONSE_BYTES);
  const parsed = parseUsageResponseDetailed(text);
  if (parsed.skipped_count > 0) {
    throw new UsageResponseParseError(parsed.anchor_count, parsed.skipped_count);
  }
  return parsed.records;
}

export async function resolveAccountWorkspaceId(
  workspaceHint: string,
  authCookie: string,
  resolved: string | null = null,
): Promise<string> {
  if (resolved && resolved.startsWith('wrk_')) return resolved;
  return resolveWorkspaceId(workspaceHint, authCookie);
}
