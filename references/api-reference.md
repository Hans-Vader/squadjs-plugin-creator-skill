# SquadJS API Reference

Authoritative capability surface, extracted from the SquadJS core
(`squad-server/index.js`, `rcon.js`, `log-parser/`). If a behaviour is not expressible with
something on this page, it is not possible without modifying the core — see
`event-reliability.md` for the hard limits and the reliable patterns.

> Read this list as exhaustive. There is **no** `ROUND_STARTED`, **no** `LAYER_CHANGED`, **no**
> staging-end / "game live" event, and **no** player position or health anywhere.

---

## 1. The plugin contract

Every plugin is a default-exported ES-module class. It MUST provide three static getters and
MAY override four lifecycle methods.

```js
import BasePlugin from './base-plugin.js';            // or DiscordBasePlugin

export default class MyPlugin extends BasePlugin {
  static get description() { return '…'; }            // REQUIRED — one-line summary
  static get defaultEnabled() { return false; }       // REQUIRED — boolean
  static get optionsSpecification() { return { … }; } // REQUIRED — config schema (§8)

  constructor(server, options, connectors) {          // always this signature; call super()
    super(server, options, connectors);
    // bind handlers, init state
  }

  async prepareToMount() {}  // before mount — async setup (fetch Discord channel, sync DB)
  async mount() {}           // register listeners + start timers
  async unmount() {}         // remove EXACTLY the listeners mount added; clear timers/state
  // verbose(level, ...args) is inherited (level 1 = important … 3 = spammy)
}
```

`super(server, options, connectors)` resolves every option (and injects connectors) into
`this.options`. A `required: true` option whose config value equals its `default` throws here.

---

## 2. Events — `this.server.on('NAME', handler)`

Register in `mount()`, remove with `this.server.removeListener('NAME', handler)` (or `.off`) in
`unmount()`. **Never `removeEventListener`** — the server is a Node `EventEmitter`; that method
does not exist and throws.

### Player combat / lifecycle

| Event | Fires when | Payload fields |
|---|---|---|
| `PLAYER_CONNECTED` | player join logged | `player`, `steamID`, `eosID`, `ip`, `playerSuffix` (race-prone — see reliability) |
| `PLAYER_DISCONNECTED` | player leaves cleanly | `player` — **clean disconnects only** (not kicks/bans, #287); can race to a **`null` player** (#289 — null-guard); for complete departure detection diff `server.players` on `UPDATED_PLAYER_INFORMATION` |
| `PLAYER_WOUNDED` | player downed | `victim`, `attacker`, `weapon`, `damage`, `teamkill` (bool), `time` |
| `TEAMKILL` | a wound where attacker & victim share a team | same payload as `PLAYER_WOUNDED` (both `attacker` & `victim` always non-null) |
| `PLAYER_DIED` | downed player gives up / bleeds out | `victim`, `attacker`, `weapon`, `damage`, `time` |
| `PLAYER_DAMAGED` | damage dealt | `victim`, `attacker`, `weapon`, `damage` |
| `PLAYER_REVIVED` | medic revive | `victim`, `attacker`, `reviver` |
| `PLAYER_POSSESS` | player possesses a vehicle/role | `player`, `possessClassname` |
| `PLAYER_UNPOSSESS` | player unpossesses | `player` |
| `PLAYER_WARNED` | an admin warn was issued | `player`, `name`, `reason` |
| `PLAYER_KICKED` | a kick occurred | `player`, `eosID` |
| `PLAYER_BANNED` | a ban occurred | `player`, `eosID` |
| `PLAYER_AUTO_KICKED` | SquadJS auto-kick fired | player info |
| `DEPLOYABLE_DAMAGED` | a FOB/HAB/deployable is damaged | `player` (attacker), `deployable`, `weapon`, `damage`, `damageType`, `healthRemaining` |
| `DEPLOYABLE_SPAWNED` | a deployable (FOB radio, HAB, emplacement, …) is placed — Squad 10.6+ | `player` (placer, resolved by eosID → name; may be `null`), `playerName`, `playerID`, `playerEOSID`, `playerSteamID`, `deployable` (`BP_FOBRadio_Woodland_C_2147`), `deployableClassname` (`BP_FOBRadio_Woodland`), `teamID` (**string**), `location` `{x, y, z}`, `time`, `raw` |

### Objectives (log-parsed, Squad 10.6+)

| Event | Fires when | Payload fields |
|---|---|---|
| `CAPTURE_ZONE_NEUTRALIZED` | a team neutralizes an owned flag | `flagName` (`03-Village`), `teamID` (neutralizing team, **string**), `previousOwnerTeamID` (**string**), `time`, `raw` |
| `CAPTURE_ZONE_CAPTURED` | a team fully captures a flag | `flagName`, `teamID` (**string**), `time`, `raw` |

`teamID` on these three log events is the raw regex capture (`"1"`/`"2"`), unlike the numeric
`player.teamID` — convert with `Number(data.teamID)` before comparing. No player is attached to the
capture events (who stood on the point is not logged).

### Team / squad (from the RCON poll diff — reliable, fire together)

| Event | Payload fields |
|---|---|
| `PLAYER_TEAM_CHANGE` | `player`, `oldTeamID`, `newTeamID` |
| `PLAYER_SQUAD_CHANGE` | `player`, `oldSquadID`, `newSquadID` |
| `SQUAD_CREATED` | `player` (with `.squadID` set), `squadID`, `squadName`, `teamID`, `time` |

### Round / layer lifecycle

| Event | Fires when | Payload fields |
|---|---|---|
| `NEW_GAME` | new map finishes loading, **staging begins** (~260 s before live) | `layer` (resolved Layer or `null`), `mapClassname`, `layerClassname`, `dlc`, `time`, `raw`, `winner` (previous round's winning faction name; `null` on a draw; missing if no round end was logged, e.g. right after a SquadJS start) |
| `ROUND_ENDED` | match state → post-match | `winner` `{team, faction, subfaction, action, tickets, layer, level}` or `null`; `loser` (same shape) or `null`; `time` |
| `UPDATED_LAYER_INFORMATION` | layer poll completed | *(none — read `server.currentLayer`)* |

### Chat / admin / diagnostics

| Event | Payload fields |
|---|---|
| `CHAT_MESSAGE` | `chat` (`ChatAll`\|`ChatTeam`\|`ChatSquad`\|`ChatAdmin`), `message`, `name`, `player`, `steamID`, `eosID`, `time`, `raw` |
| `CHAT_COMMAND:<name>` | same as `CHAT_MESSAGE`, but `message` = text after the command word (trimmed). See §3 |
| `ADMIN_BROADCAST` | `message`, `from`, `time`, `raw` |
| `POSSESSED_ADMIN_CAMERA` | `player`, `name`, `steamID`, `eosID`, `time`, `raw` |
| `UNPOSSESSED_ADMIN_CAMERA` | same + `duration` (ms in admin cam) |
| `TICK_RATE` | `tickRate`, `time` |
| `RCON_ERROR` | error data (RCON failure) |

### Periodic state refresh (no payload — read `server.*`)

| Event | Read after it |
|---|---|
| `UPDATED_PLAYER_INFORMATION` | `server.players` — **the source of truth** (see reliability) |
| `UPDATED_SERVER_INFORMATION` | `info` arg + `server` fields (`ShowServerInfo`, polled every **10 s**) |
| `UPDATED_A2S_INFORMATION` | `info.playerCount` (same poll, emitted together with the above) |

---

## 3. Chat commands — `CHAT_COMMAND:<name>`

When a chat message contains a `!word` — matched **anywhere** in the line by `/!([^ ]+) ?(.*)/`,
not only at the start (so `gg !bug` fires too) — SquadJS also emits `CHAT_COMMAND:<word>`, with
`word` **lowercased and stripped of the `!`**, same payload as `CHAT_MESSAGE` except `message` holds
only the text after `word`. Register the bare word: `` this.server.on(`CHAT_COMMAND:${this.options.command}`, h) ``.
Filter on `data.chat` (e.g. require `'ChatAdmin'` for admin-only commands). Reply privately with
`this.server.rcon.warn(data.player.eosID, '…')`.

### Multiple / configurable / aliased trigger commands

The core parses commands with a **fixed `!`**: `` data.message.match(/!([^ ]+) ?(.*)/) `` emits
`CHAT_COMMAND:<first-word-lowercased>` with `message` set to the rest — so `!set timer 30` fires
`CHAT_COMMAND:set` (message `"timer 30"`). One listener keys on **one** `!word`, but that word can
come from config and you may register as many listeners as you like.

**Idiomatic pattern — loop `CHAT_COMMAND:${cmd}` over the configured list.** For a configurable list
or aliases, normalize a string-or-array option to an array and register one listener per entry, using
a single bound handler mirrored in `unmount()`. This is what the real plugins do
(`discord-admin-request`, `rally-timer`):

```js
constructor(server, options, connectors) {
  super(server, options, connectors);
  this.onCommand = this.onCommand.bind(this);                    // bind ONCE — same ref for on & removeListener
  this.commands = Array.isArray(this.options.commands)          // accept a string OR an array
    ? this.options.commands : [this.options.commands];
}
mount()   { for (const c of this.commands) this.server.on(`CHAT_COMMAND:${c}`, this.onCommand); }
unmount() { for (const c of this.commands) this.server.removeListener(`CHAT_COMMAND:${c}`, this.onCommand); }
```

Declare the option as an array (§8); the emitted event name is **lowercased and has no `!`**, so
register the bare, lowercased word (`CHAT_COMMAND:admin`, never `CHAT_COMMAND:!Admin` — that never
fires). Bind the handler in the constructor and pass that **same reference** to every
`on`/`removeListener`; a fresh arrow per `CHAT_COMMAND` (as `timer.js` does — and it registers no
`unmount` at all) leaks one listener per alias on reload (see the `.on(arrow)` mistake in `SKILL.md`).

**Match `CHAT_MESSAGE` yourself only when `CHAT_COMMAND` can't express the trigger** — it only fires
on a `!`-prefixed word and keys on that one word alone. Drop to a plain `CHAT_MESSAGE` listener for: a
configurable **prefix you parse yourself** (a `commandPrefix` that may be a string **or** array,
possibly without a `!`, then your own subcommand/arg split — the `switch` plugin), a **multi-word**
trigger (`!set timer` — a `CHAT_COMMAND:"set timer"` listener never fires), or a match not keyed on
`!`. One handler then runs on **every** chat line, so match cheaply and `return` early:

```js
onChatMessage(info) {
  const message = info.message.toLowerCase();
  // exact-word aliases (no prefix, no arguments) — e.g. !bug / !stuck
  if (this.options.doubleSwitchCommands.some((c) => c.toLowerCase() === message))
    return this.doubleSwitch(info.player?.eosID);
  // prefix that may be a string OR an array of prefixes
  const prefix = typeof this.options.commandPrefix === 'string'
    ? (message.startsWith(this.options.commandPrefix.toLowerCase()) ? this.options.commandPrefix : null)
    : this.options.commandPrefix.find((c) => message.startsWith(c.toLowerCase()));
  if (!prefix) return;
  const args = message.slice(prefix.length).trim().split(' ').filter(Boolean); // args[0] = subcommand
  // …dispatch on args[0]…
}
```

---

## 4. RCON methods — `this.server.rcon.*`

| Method | Raw command sent | Notes |
|---|---|---|
| `broadcast(message)` | `AdminBroadcast` | server-wide message |
| `warn(anyID, message)` | `AdminWarn` | private to one player; `anyID` = eosID or steamID |
| `kick(anyID, reason)` | `AdminKick` | |
| `ban(anyID, length, message)` | `AdminBan` | `length`: `0`=perm, `1m`, `1d`, `1M`, … |
| `switchTeam(anyID)` / `forceTeamChange(anyID)` | `AdminForceTeamChange` | force a player to the other team (two names, same command) |
| `setFogOfWar(mode)` | `AdminSetFogOfWar` | |
| `getCurrentMap()` | `ShowCurrentMap` | → `{ level, layer }` |
| `getNextMap()` | `ShowNextMap` | → `{ level, layer, toBeVoted }` (`layer` is `null` when `toBeVoted`) |
| `getListPlayers()` | `ListPlayers` | → player array; usually read `server.players` instead |
| `getSquads()` | `ListSquads` | → **tuple `[squads, tickets]`** (since Oct 2026); usually read `server.squads` / `server.tickets` instead |
| `execute(rawCommand)` | *(verbatim)* | **escape hatch** → `Promise<string>` |

Every wrapper returns the `execute()` promise. A failed command (connection closed, or no response
within 10 s — SquadJS then drops and reopens the RCON connection) **rejects** for callers that
`await` it, so wrap awaited calls in `try/catch`; fire-and-forget calls are logged and no longer
crash the process.

### `execute()` escape hatch — anything without a wrapper

Pass any Squad admin command verbatim. Verified in use across plugins:
`AdminKick "<id>" <reason>`, `AdminDisbandSquad <teamID> <squadID>`,
`AdminRemovePlayerFromSquad`, `AdminChangeLayer <layer>`, `AdminSetNextLayer <layer>`,
`AdminEndMatch`, `AdminRestartMatch`, `AdminDemoteCommander`, `AdminRenameSquad`.
If Squad's admin console supports it, `execute()` can send it; if it doesn't, SquadJS can't do it.

### Double-switch — unstick a bugged player without a net team change

Call `switchTeam` **twice** with a short delay between: the player lands on the other team and
returns to their own, which re-spawns/unsticks a bugged pawn without actually changing sides. This
is the mechanism behind `!bug`/`!stuck`-style commands.

```js
await this.server.rcon.switchTeam(anyID);                              // → AdminForceTeamChange
await new Promise((r) => setTimeout(r, this.options.doubleSwitchDelaySeconds * 1000));
await this.server.rcon.switchTeam(anyID);                              // …and back
```

The awaited one-shot delay resolves on its own — nothing to clear in `unmount`. Make the gap
configurable (`doubleSwitchDelaySeconds`, default `1`).

---

## 5. Server methods — `this.server.*`

- `updatePlayerList()`, `updateSquadList()`, `updateLayerInformation()`, `updateServerInformation()`
  — force a refresh (each also emits its `UPDATED_*` event). `updatePlayerList`/`updateSquadList`
  coalesce parallel callers into one follow-up poll, so calling them often is cheap — but the
  awaited list is only guaranteed newer than your call, not fresh per caller.
- `getPlayerBySteamID(id)`, `getPlayerByEOSID(id)`, `getPlayerByAnyID(id)`, `getPlayerByName(name)`,
  `getPlayerByNameSuffix(suffix)`, `getPlayerByController(c)`, `getPlayerByCondition(fn)`.
- `getSquadByID(teamID, squadID)`, `getSquadByCondition(fn)`.
- `getAdminsWithPermission(permission, format)` → array of ids (e.g. `('canseeadminchat', 'eosID')`).

## 6. Server state properties — `this.server.*`

| Property | Shape |
|---|---|
| `players` | array of player objects (§7) — **truth**: present ⇒ on server |
| `squads` | array of squad objects (§7) |
| `tickets` | `[team1Tickets, team2Tickets]` from the `ListSquads` poll (~30 s; `[]` before the first poll) — index with `teamID - 1` |
| `currentLayer` | Layer object, or `null` when the layer is not in the layer list / not loaded yet |
| `nextLayer` | Layer object, or `null` (not set, unknown, or to be voted) |
| `nextLayerToBeVoted` | `true` when the next layer will be decided by vote |
| `layerHistory` | array of `{ layer, time }`, newest first |
| `a2sPlayerCount` | number (A2S query) |
| `admins` | object keyed by steamID → permissions |
| `plugins` | array of loaded plugin instances (for plugin-to-plugin lookup) |

---

## 7. Object shapes

**Player** (`server.players[i]`, and the `player`/`attacker`/`victim`/`reviver` on events):
`playerID` (number), `name`, `teamID` (number **or `null`**), `squadID` (number or `null`),
`isLeader` (bool), `role` (string), `steamID`, `eosID`, `playercontroller`, `squad` (squad object
or null), `possessClassname` (only after `PLAYER_POSSESS`).
**There is no position/x/y/z, no health, no kill/death counters, no vehicle** — SquadJS does not
track them (Squad 10.6's `ListPlayers` prints `Party ID`/`Vehicle`, but the parser discards both; for
"in a vehicle" use `PLAYER_POSSESS`'s `possessClassname`).
`eosID` is the stable primary id; `steamID` is the fallback and is `null` for Epic Games Store players.

**Faction / team short name → `teamID` (convention-based, NOT a real field).** SquadJS exposes
**no** faction identifier per team: `teamID` is only `1`/`2` and which faction each maps to flips
every round, and `Squad.teamName` is the *full* name ("United States Army"), not the short code
("USA"). But Squad names every kit `role` classname `<FACTION>_<role>` — `USA_Rifleman_01`,
`RGF_Medic_01`, `MEA_SL_01` — so you can resolve an admin-typed short name to the live numeric team
by finding the first player whose `role` starts with it and reading their `teamID`:

```js
getTeamIDFromShortName(shortName) {
  const p = this.server.players.find(
    (pl) => pl.role?.toLowerCase().startsWith(shortName.toLowerCase())); // role prefix = faction code
  return p ? p.teamID : null;   // null ⇒ that faction has no player currently on the server
}
```

This is a **naming-convention inference, not an API guarantee** — do not present it to a user as a
first-class faction field. It returns `null` (or misresolves) if no player of that faction is
connected, or if a faction's role classnames don't start with the token. (`role` is always a
non-empty string for a *listed* player — the `ListPlayers` parser drops rows with no role, so a
spectator is **absent** from `server.players`, not present with an empty `role`. The source safely
omits the `?.`; the guard above is harmless belt-and-suspenders, not protection against a throw
that can't happen.) Prefer this over hard-coding `teamID` 1/2 (not stable across rounds); the documented-but-clumsy
alternative is a config alias map onto `Squad.teamName`. Right after `NEW_GAME`, `teamID` is
transiently `null` — see `event-reliability.md`.

**Squad** (`server.squads[i]`): `squadID` (number), `squadName`, `size`, `locked`
(string `"True"`/`"False"` as parsed), `creatorName`, `teamID` (number), `teamName`,
`creatorSteamID`, `creatorEOSID`.

**Layer** (`server.currentLayer`, `NEW_GAME` `data.layer`; pulled from SquadLayerList `layers.json`
since Oct 2026): `name`, `classname`, `layerid`, `map.name`, `gamemode`, `numberOfCapturePoints`,
`lighting` `{name, classname, type}`, `commander`, `factions`, `tickets` (`[team1, team2]` starting
tickets), `teams[]` `{faction, name, tickets, commander, vehicles[], numberOfTanks,
numberOfHelicopters}`. Team values can be `null` (e.g. Automation layers). The whole Layer is
`null` when the layer is not in the list — always guard.

---

## 8. optionsSpecification schema

```js
static get optionsSpecification() {
  return {
    myOption: {
      required: false,          // if true, config MUST set a value ≠ default (else throws at load)
      description: '…',         // shown in docs
      default: 10,              // used when not provided
      example: '…',             // optional, shown in example configs
      type: 'number'            // optional hint: 'string'|'number'|'boolean'|'array'
    },
    database: {                 // CONNECTOR option — resolved to the live instance:
      required: true,
      connector: 'sequelize',   // 'sequelize' → Sequelize instance; 'discord' → Discord.js client
      description: '…',
      default: 'sqlite'         // names the connector in config.json's "connectors" block
    }
  };
}
```

A `connector` option's config value is a **connector name**; BasePlugin replaces it with the live
object (so `this.options.database` is the Sequelize instance, `this.options.discordClient` the
Discord client). `DiscordBasePlugin.optionsSpecification` already declares the `discordClient`
connector — spread it: `...DiscordBasePlugin.optionsSpecification`.

---

## 9. Connectors (declared in config.json's `connectors` block)

- `discord` — a Discord bot token → a `discord.js` client (`this.options.discordClient`).
- `sqlite` / `mysql` / `postgres` — a Sequelize dialect config → a Sequelize instance
  (referenced by a `connector: 'sequelize'` option).

## 10. Multi-file plugins (large plugins)

Give a large plugin its **own directory** under `squad-server/plugins/<plugin-name>/` and keep the
plugin's own modules there — database layer, command handlers, Discord helpers — self-contained,
rather than scattering them into the shared `squad-server/utils/` (that dir is for framework-wide
helpers). Keep the entry class where the loader picks it up: the stock `plugins/index.js` auto-loads
only top-level `.js` files in `plugins/`, so the entry stays a `.js` file the loader imports (e.g.
`plugins/<plugin-name>.js`) that pulls the rest in from `./<plugin-name>/`. No template is bundled
for this — start from one of the three templates and extract modules into the plugin's directory as
it grows.

