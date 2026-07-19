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

### Team / squad (from the RCON poll diff — reliable, fire together)

| Event | Payload fields |
|---|---|
| `PLAYER_TEAM_CHANGE` | `player`, `oldTeamID`, `newTeamID` |
| `PLAYER_SQUAD_CHANGE` | `player`, `oldSquadID`, `newSquadID` |
| `SQUAD_CREATED` | `player` (with `.squadID` set), `squadID`, `squadName`, `teamID`, `time` |

### Round / layer lifecycle

| Event | Fires when | Payload fields |
|---|---|---|
| `NEW_GAME` | new map finishes loading, **staging begins** (~260 s before live) | `layer` (resolved Layer), `mapClassname`, `layerClassname`, `dlc`, `time`, `raw` |
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
| `UPDATED_SERVER_INFORMATION` | `info` arg + `server` fields |
| `UPDATED_A2S_INFORMATION` | `info.playerCount` |

---

## 3. Chat commands — `CHAT_COMMAND:<name>`

When a chat message starts with `!`, SquadJS also emits `CHAT_COMMAND:<word>` (lowercased)
with the same payload as `CHAT_MESSAGE`, except `message` holds only the arguments after the
command word. Register `` this.server.on(`CHAT_COMMAND:${this.options.commandPrefix}`, h) ``.
Filter on `data.chat` (e.g. require `'ChatAdmin'` for admin-only commands). Reply privately with
`this.server.rcon.warn(data.player.eosID, '…')`.

### Multiple / configurable trigger commands (`CHAT_COMMAND` is single-word only)

`CHAT_COMMAND:<name>` fires for exactly **one fixed, hard-coded** command word. It cannot cover a
*config-driven array* of triggers, command aliases, or a prefix that may be a string **or** an
array. When admins should configure a list — e.g. `commandPrefix: ["!switch","!change"]` or
`doubleSwitchCommands: ["!bug","!stuck","!doubleswitch"]` — listen to plain `CHAT_MESSAGE` (one
listener, bound once) and match `info.message` yourself:

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

Declare each such option as an array with `default: []` (§8). One `CHAT_MESSAGE` handler runs on
every chat line — match cheaply and `return` early — versus N `CHAT_COMMAND:<alias>` listeners you
would have to register in `mount()` and mirror exactly in `unmount()`.

---

## 4. RCON methods — `this.server.rcon.*`

| Method | Raw command sent | Notes |
|---|---|---|
| `broadcast(message)` | `AdminBroadcast` | server-wide message |
| `warn(anyID, message)` | `AdminWarn` | private to one player; `anyID` = eosID or steamID |
| `ban(anyID, length, message)` | `AdminBan` | `length`: `0`=perm, `1m`, `1d`, `1M`, … |
| `switchTeam(anyID)` | `AdminForceTeamChange` | force a player to the other team |
| `setFogOfWar(mode)` | `AdminSetFogOfWar` | |
| `getCurrentMap()` | `ShowCurrentMap` | → `{ level, layer }` |
| `getNextMap()` | `ShowNextMap` | → `{ level, layer }` |
| `getListPlayers()` / `getSquads()` | `ListPlayers` / `ListSquads` | usually use `server.players`/`server.squads` instead |
| `execute(rawCommand)` | *(verbatim)* | **escape hatch** → `Promise<string>` |

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
  — force a refresh (each also emits its `UPDATED_*` event).
- `getPlayerBySteamID(id)`, `getPlayerByEOSID(id)`, `getPlayerByAnyID(id)`, `getPlayerByName(name)`,
  `getPlayerByNameSuffix(suffix)`, `getPlayerByController(c)`, `getPlayerByCondition(fn)`.
- `getSquadByID(teamID, squadID)`, `getSquadByCondition(fn)`.
- `getAdminsWithPermission(permission, format)` → array of ids (e.g. `('canseeadminchat', 'eosID')`).

## 6. Server state properties — `this.server.*`

| Property | Shape |
|---|---|
| `players` | array of player objects (§7) — **truth**: present ⇒ on server |
| `squads` | array of squad objects (§7) |
| `currentLayer` | Layer object (may be unavailable / `"Unknown"` after a restart) |
| `nextLayer` | Layer object (may be a Promise) |
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
**There is no position/x/y/z, no health, no kill/death counters** — SquadJS does not track them.
`eosID` is the stable primary id; `steamID` is the fallback.

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

**Layer** (`server.currentLayer`, `NEW_GAME` `data.layer`): fields such as `name`, `classname`,
`gamemode`, `layerid`. May read as `"Unknown"` during/after a server restart.

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

