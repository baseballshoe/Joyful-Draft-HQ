// ── ADD THESE ROUTES TO server/routes.ts ─────────────────────────────────
//
// 1. Add this import at the top of server/routes.ts:
//
//    import * as yahoo from './yahoo';
//    import { yahooLeague } from '@shared/schema';
//
// 2. Paste the route handlers below inside your registerRoutes() function,
//    just before the final `return httpServer;` line.
//
// ─────────────────────────────────────────────────────────────────────────

// ── Yahoo Auth: Step 1 — redirect user to Yahoo login ────────────────────
app.get('/api/auth/yahoo', (_req, res) => {
  const authUrl = yahoo.getAuthUrl();
  res.redirect(authUrl);
});

// ── Yahoo Auth: Step 2 — handle callback from Yahoo ──────────────────────
app.get('/api/auth/yahoo/callback', async (req, res) => {
  const { code, error } = req.query as Record<string, string>;

  if (error || !code) {
    return res.redirect('/?yahoo_error=access_denied');
  }

  try {
    await yahoo.exchangeCode(code);
    // Redirect to the Yahoo setup page in the frontend
    res.redirect('/?yahoo_connected=1');
  } catch (err: any) {
    console.error('Yahoo OAuth callback error:', err);
    res.redirect(`/?yahoo_error=${encodeURIComponent(err.message)}`);
  }
});

// ── Yahoo Auth: disconnect ────────────────────────────────────────────────
app.delete('/api/auth/yahoo', async (_req, res) => {
  await yahoo.clearTokens();
  res.json({ ok: true });
});

// ── Yahoo: connection status ──────────────────────────────────────────────
app.get('/api/yahoo/status', async (_req, res) => {
  try {
    const tokens = await yahoo.getTokens();
    if (!tokens) return res.json({ connected: false });

    const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));

    res.json({
      connected:    true,
      yahooGuid:    tokens.yahooGuid,
      expiresAt:    tokens.expiresAt,
      league:       leagueRow ?? null,
    });
  } catch {
    res.json({ connected: false });
  }
});

// ── Yahoo: get user's leagues ─────────────────────────────────────────────
app.get('/api/yahoo/leagues', async (_req, res) => {
  try {
    const leagues = await yahoo.getLeagues();
    res.json(leagues);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// ── Yahoo: select/save a league ───────────────────────────────────────────
app.post('/api/yahoo/league', async (req, res) => {
  const { leagueKey, leagueId, name, season, numTeams, scoringType } = req.body;
  if (!leagueKey) return res.status(400).json({ message: 'leagueKey required' });

  try {
    // Find my team in this league
    const teams = await yahoo.getLeagueTeams(leagueKey);
    const myTeam = teams.find(t => t.isOwnedByCurrentLogin);

    await db
      .insert(yahooLeague)
      .values({
        id: 1, leagueKey, leagueId, name, season,
        numTeams, scoringType,
        myTeamKey:  myTeam?.teamKey  ?? null,
        myTeamName: myTeam?.name     ?? null,
      })
      .onConflictDoUpdate({
        target: yahooLeague.id,
        set: {
          leagueKey, leagueId, name, season,
          numTeams, scoringType,
          myTeamKey:  myTeam?.teamKey  ?? null,
          myTeamName: myTeam?.name     ?? null,
          updatedAt:  new Date(),
        },
      });

    broadcast({ type: 'yahoo_league_saved', data: { leagueKey, name } });
    res.json({ ok: true, myTeam: myTeam ?? null });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// ── Yahoo: sync my roster → mark players as mine in DB ───────────────────
app.post('/api/yahoo/sync-roster', async (_req, res) => {
  try {
    const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
    if (!leagueRow?.myTeamKey) {
      return res.status(400).json({ message: 'No league selected. Please connect a league first.' });
    }

    const rosterPlayers = await yahoo.getMyRoster(leagueRow.myTeamKey);

    // Match Yahoo players to our DB players by name (fuzzy)
    const allPlayers = await storage.getPlayers();
    const results = { synced: 0, unmatched: [] as string[] };

    for (const yp of rosterPlayers) {
      // Normalize names for matching
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = allPlayers.find(p =>
        normalize(p.name) === normalize(yp.name)
      );

      if (match) {
        await storage.updatePlayer(match.id, { status: 'mine' });
        results.synced++;
      } else {
        results.unmatched.push(yp.name);
      }
    }

    // Update lastSyncedAt
    await db
      .update(yahooLeague)
      .set({ lastSyncedAt: new Date() })
      .where(eq(yahooLeague.id, 1));

    broadcast({ type: 'yahoo_roster_synced', data: results });
    res.json(results);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// ── Yahoo: get waiver wire ────────────────────────────────────────────────
app.get('/api/yahoo/waiver-wire', async (req, res) => {
  try {
    const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
    if (!leagueRow?.leagueKey) {
      return res.status(400).json({ message: 'No league connected' });
    }

    const pos = (req.query.pos as string) || 'B';
    const players = await yahoo.getWaiverWire(leagueRow.leagueKey, pos, 25);
    res.json(players);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// ── Yahoo: get standings ──────────────────────────────────────────────────
app.get('/api/yahoo/standings', async (_req, res) => {
  try {
    const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
    if (!leagueRow?.leagueKey) {
      return res.status(400).json({ message: 'No league connected' });
    }

    const standings = await yahoo.getStandings(leagueRow.leagueKey);
    res.json(standings);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// ── Yahoo: get scoreboard / matchups ─────────────────────────────────────
app.get('/api/yahoo/scoreboard', async (_req, res) => {
  try {
    const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
    if (!leagueRow?.leagueKey) {
      return res.status(400).json({ message: 'No league connected' });
    }

    const scoreboard = await yahoo.getScoreboard(leagueRow.leagueKey);
    res.json(scoreboard);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
