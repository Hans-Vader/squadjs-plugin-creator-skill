# SquadJS Event Reliability & Hard Limits

Production-validated reality of which SquadJS signals you can trust. This is the feasibility
gate: check every requirement here before promising it. **Grepping the core is not enough** —
several events are *emitted* in source but have practical gaps — they fire only in some cases (clean
disconnects but not kicks/bans), can race, or can lag a Squad engine update until the regex is
patched — so source alone will mislead you (and a fresh agent that only reads the core will
confidently build on a signal that doesn't behave as its name implies).

---

## The two-system architecture (why ordering is never guaranteed)

SquadJS tracks state with two independent, unsynchronised systems:

| System | Mechanism | Events | Reliability |
|---|---|---|---|
| Reactive log parser | regex on the live `SquadGame.log` | `PLAYER_CONNECTED`, `PLAYER_DISCONNECTED`, `PLAYER_WOUNDED`, `NEW_GAME`, `ROUND_ENDED`, … | regex-based; can lag a Squad update |
| Periodic RCON poll (~30 s) | diff of `ListPlayers` / `ListSquads` | `UPDATED_PLAYER_INFORMATION`, `PLAYER_TEAM_CHANGE`, `PLAYER_SQUAD_CHANGE` | authoritative |

They do not synchronise. Events from one regularly arrive before, after, or instead of their
counterpart in the other. **`UPDATED_PLAYER_INFORMATION` is the one fully reliable signal — build
state tracking around it.**

Log-parser events are matched by regex against `SquadGame.log`, so a major Squad **engine** update
can temporarily break a given event until the regex is patched on `master`. This skill assumes an
up-to-date `master` checkout of SquadJS — keep it current rather than pinning an old release.

---

## Per-signal truth

### `UPDATED_PLAYER_INFORMATION` — the source of truth
Fires after every `updatePlayerList()`. `server.players` at that moment reflects current RCON
state: present ⇒ on the server; absent ⇒ gone. **Bursts of 3–6 within milliseconds are normal**
(periodic timer + cache-miss retries + explicit calls). Process idempotently — never assume once.

### `PLAYER_DISCONNECTED` — clean disconnects only; two caveats
Fires when a player disconnects *cleanly*, parsed by regex from the `SquadGame.log`
`LogNet: UChannel::Close: Sending CloseBunch …` line. Useful as a fast signal for clean leaves, but
two caveats make it insufficient on its own:

- **Misses kicks and bans.** Only a *clean* disconnect produces the matched log line, so a kicked or
  banned player never triggers it (#287).
- **Can fire with a `null` player.** An RCON/log-parser race (#289, open) means the player may
  already be gone from the RCON list when it fires — always null-guard the handler.

For *complete* departure detection (clean leaves, kicks, and bans alike) and to sidestep the race,
treat the RCON poll as the source of truth: infer a departure when an `eosID` disappears from
`server.players` between `UPDATED_PLAYER_INFORMATION` events. Use `PLAYER_DISCONNECTED` only as a
supplementary fast-path for clean leaves, never as your sole departure trigger.

### `PLAYER_CONNECTED` — race, not a sequence point
The RCON poll often shows a new player *before* `PLAYER_CONNECTED` fires. Register a player the
moment you first see them (from either source); treat `PLAYER_CONNECTED` as a redundant
confirmation, not the trigger.

### `PLAYER_TEAM_CHANGE` / `PLAYER_SQUAD_CHANGE` — reliable, but co-fire
Both come from the RCON diff, so they are in sync with `UPDATED_PLAYER_INFORMATION` — but all
three fire in the same poll cycle. Handlers must be idempotent.

### `NEW_GAME` — staging START, not "live"
Fires once per transition, when the map finishes loading and **staging begins**. Squad staging is
~260 s. There is **no event for staging end / round-live**. To act when the round is actually
live, set a `setTimeout(~280_000)` from `NEW_GAME` (or gate on `a2sPlayerCount`); accept it is an
approximation, never exact.

### `ROUND_ENDED` — reliable
`winner`/`loser` may both be `null` on a draw. Handle the null case.

---

## Hard limits (impossible without modifying the core)

| Requested capability | Why it's impossible |
|---|---|
| Detect *every* player departure (incl. kicks/bans) from one event | `PLAYER_DISCONNECTED` covers only clean disconnects (#287) and can race to a `null` player (#289); complete departure detection means diffing `server.players` on the ~30 s RCON poll. |
| Kick/penalise a player "on disconnect" | They are already gone — even if you detect it, `AdminKick` is a no-op on a closed connection. A temp-ban is the only durable penalty. |
| Player position / map grid / death coordinates | No log line or RCON command carries position. Player object has no x/y/z. |
| Player health / HP / stamina | Not exposed anywhere. |
| Exact "round went live" moment | No staging-end event exists (see `NEW_GAME`). |
| Trustworthy `teamID` right after `NEW_GAME` | `teamID` is `null` transiently (up to ~30 s, and at full-server scale nearly the whole roster) until the next polls resolve it. |
| Distinguish admin-forced vs voluntary team switch | `PLAYER_TEAM_CHANGE` has no source flag; only another plugin emitting its own marker can disambiguate. |
| A built-in "is AFK" flag | No such field — derive it yourself from activity events + a timer. |

## Other gotchas

- **Layer `"Unknown"` after a restart.** When SquadJS reconnects post server-restart,
  `server.currentLayer` can read `"Unknown"` through the whole recovery. Detect restart by
  `a2sPlayerCount === 0` **and** layer `"Unknown"` together; provide a fallback.
- **`teamID` is `number | null`.** Always guard for `null`, especially around `NEW_GAME`.

---

## The reliable pattern: delta-diff on `UPDATED_PLAYER_INFORMATION`

Keep your own `Map(eosID → state)` as the source of truth; reconcile it on every
`UPDATED_PLAYER_INFORMATION`. Treat explicit events (`PLAYER_CONNECTED`, `PLAYER_TEAM_CHANGE`) as
*supplements*, never as required triggers. Every handler idempotent.

```js
async onUpdatedPlayerInfo() {
  const current = new Set(this.server.players.map((p) => p.eosID));
  for (const p of this.server.players) {
    if (!this.playerMap.has(p.eosID)) this.onJoin(p);          // appeared (maybe before PLAYER_CONNECTED)
    this.playerMap.set(p.eosID, { teamID: p.teamID, squadID: p.squadID });
  }
  for (const eosID of [...this.playerMap.keys()]) {
    if (!current.has(eosID)) { this.onLeave(eosID); this.playerMap.delete(eosID); } // gone — no DISCONNECT event coming
  }
}
```

---

## Lifecycle correctness (verified bugs to avoid)

- **`removeListener` / `off`, never `removeEventListener`.** The server extends Node's
  `EventEmitter`, which has no `removeEventListener` — calling it throws `TypeError` and the
  listener leaks. Many bundled SquadJS plugins (and some examples) use the broken form; do not
  copy them. `mount()` and `unmount()` must register and remove exactly the same set.
- **Clear every timer in `unmount`.** Store each `setInterval`/`setTimeout` handle and
  `clearInterval`/`clearTimeout` it in `unmount`, or it leaks across reloads.
- **Bind handlers in the constructor** (`this.onX = this.onX.bind(this)`) — `server.on` does not
  preserve `this`.
