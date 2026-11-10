# Usage insights and T3 subscription limits

The Usage → Insights tab reports recorded input/output/cache tokens by authenticated API-key owner and explicit client session ID, filtered by date (UTC; at most 93 days per report) and upstream subscription. A cached token is already part of input, not an additional token. An API key shared by multiple people cannot identify an individual; create a named key per person in the existing Keys screen. Client user labels are unverified correlation only.

Subscription limits are independently observed every five minutes, including when no dashboard is open. No LLM requests or reset-credit redemptions are made by the collector. Provider percentages, totals and reset timestamps are retained across restarts; unsupported/unavailable quotas remain unknown. Observations cannot reconstruct limits from before collection started, and provider subscription consumption is not assumed to equal routed token volume. Claude cached observations retain their original observation timestamp. All existing request history remains unchanged.

The report returns the top 100 owners and sessions by input plus output tokens. Select a subscription to view its latest 2,000 quota observations within the date range (the report explicitly states when truncated). The underlying SQLite history is retained; there is no automatic deletion. If the ledger becomes too large for interactive aggregation, add indexed daily owner/session summaries rather than pruning historical evidence.

## Client session IDs

Explicit session IDs use the existing 9router session reader (for example `X-Session-Id`, Claude Code session metadata, or `session_id`). Generated routing/cache affinity is not treated as a known client session; requests without explicit IDs are shown as Unattributed. Request-scoped IDs such as `x-client-request-id` are not sessions.

Hermes supports conversation affinity without a T3 rebuild:

```yaml
providers:
  9router:
    session_affinity_header: X-Session-Id
```

Use `hermes config set providers.9router.session_affinity_header X-Session-Id`. Start a new session to apply the setting. The affinity can represent a conversation root (including its delegates), not necessarily a physical ACP thread. Existing records without IDs are not guessed or backfilled.

## T3 Code Usage providers

T3's configurable hubs populate **Usage → Limits**, not its historical Cost/Tokens charts. T3 currently recognizes only Codex and Claude accounts from a CLIProxyAPI hub. Other providers remain visible in 9router, but are not falsely mapped to either provider.

9router exposes the narrow read-only compatibility routes:

- `GET /v0/management/auth-files`: stable Codex/Claude subscription selectors, email, disabled status. No access/refresh tokens.
- `POST /v0/management/api-call`: accepts `auth_index`, `method: "GET"` and an exact supported provider usage URL; returns `{status_code, body}` with a JSON-string body. Uses 9router's real quota snapshots; observations older than 15 minutes fail unavailable instead of showing invented zeroes. Caller headers are never forwarded. Arbitrary URLs, mutations and reset-credit operations are rejected.

Configure a dedicated management credential with `NINEROUTER_USAGE_MANAGEMENT_KEY_FILE` (preferred; file readable only by the service owner) or `NINEROUTER_USAGE_MANAGEMENT_KEY`. The key is unrelated to inference/dashboard credentials. Missing configuration denies all hub requests, even on localhost. Do not expose this interface publicly without TLS and an appropriate network policy: it reveals account emails and pooled subscription limits.

Then in T3: **Settings → Providers → Usage providers → Add hub**. Use label `9router`, the 9router **base URL** (not `/v1`), and that management credential. T3 resolves localhost on its server environment, not the browser. Optional reset credits are intentionally unsupported; the integration cannot spend them.

## Verification boundary

Tests use isolated SQLite stores and synthetic account/session data. Browser evidence exercises the built dashboard with labeled fixture data; it is not production usage. Production deployment, management-key provisioning and adding the T3 hub are separate release actions. Never restart the inference gateway just to preview the UI while active agents are using it.
