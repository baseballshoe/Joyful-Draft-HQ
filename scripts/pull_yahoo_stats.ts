// scripts/pull_yahoo_stats.ts
// ─────────────────────────────────────────────────────────────────────
// Nightly Yahoo stats pull — orchestrator script.
//
// Runs via `npx tsx scripts/pull_yahoo_stats.ts` in GitHub Actions.
// Imports server/external/yahoo-stats.ts which does the actual work
// (and that module reuses server/yahoo.ts for OAuth + token refresh).
//
// Failure modes:
//   - Yahoo OAuth token revoked / refresh fails: log warning, exit 0
//     (silent degradation — Coach falls back to other sources)
//   - Yahoo API returns 5xx: retried inside fetchPlayersPage
//   - DB connection fails: exit 1 (loud, this should never happen
//     silently)
//   - No league connected: log warning, exit 0
// ─────────────────────────────────────────────────────────────────────
import { pullAllYahooStatsForCurrentLeague } from '../server/external/yahoo-stats';

function log(level: 'info' | 'warn' | 'error', msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${level.toUpperCase()}] ${msg}`);
}

async function main() {
  log('info', 'Starting Yahoo stats pull');

  if (!process.env.DATABASE_URL) {
    log('error', 'DATABASE_URL not set');
    process.exit(1);
  }
  if (!process.env.YAHOO_CLIENT_ID || !process.env.YAHOO_CLIENT_SECRET) {
    log('error', 'YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET not set');
    process.exit(1);
  }

  let result;
  try {
    result = await pullAllYahooStatsForCurrentLeague();
  } catch (err: any) {
    const msg = err?.message ?? String(err);

    // Detect token failures specifically — those are NOT a script-level
    // failure, they're a user-visible "please re-auth" condition. Don't
    // fail the GitHub Action; just log and exit cleanly.
    if (
      msg.includes('Yahoo token refresh failed') ||
      msg.includes('Not connected to Yahoo')   ||
      msg.includes('401')
    ) {
      log('warn', `Yahoo auth issue (silent degradation): ${msg}`);
      log('warn', 'Exiting cleanly — Coach will use other data sources tonight.');
      log('warn', 'User should re-auth via /yahoo page when convenient.');
      process.exit(0);
    }

    // Unknown error — fail loudly so we see it in Actions.
    log('error', `Yahoo pull failed: ${msg}`);
    process.exit(1);
  }

  if (result.errorMessage) {
    log('warn', result.errorMessage);
    process.exit(0);
  }

  log('info', '━'.repeat(60));
  log('info', 'Yahoo stats pull complete');
  log('info', `  Total players seen:      ${result.totalPlayers}`);
  log('info', `  Matched to our DB:       ${result.matchedPlayers}`);
  log('info', `  Unmatched (skipped):     ${result.unmatchedPlayers}`);
  log('info', `  Pitcher rows written:    ${result.pitchersWritten}`);
  log('info', `  Batter rows written:     ${result.battersWritten}`);
  log('info', `  QS total across league:  ${result.qualityStartsTotal}`);
  log('info', `  Elapsed:                 ${(result.elapsedMs / 1000).toFixed(1)}s`);
  log('info', '━'.repeat(60));

  // Sanity warning if too many unmatched
  if (result.totalPlayers > 0) {
    const matchRate = result.matchedPlayers / result.totalPlayers;
    if (matchRate < 0.9) {
      log('warn', `Match rate ${(matchRate * 100).toFixed(1)}% is low — investigate name normalization`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  log('error', `Unexpected error: ${err?.message ?? err}`);
  process.exit(1);
});
