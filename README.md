# Creating SquadJS Plugins — an agent skill

> An [agent skill](https://code.claude.com/docs/en/skills) that teaches your AI coding assistant to build **correct** [SquadJS](https://github.com/Team-Silver-Sphere/SquadJS) plugins — mapping every feature to a real event, RCON method, and field *before* writing code, and refusing to invent capabilities that don't exist.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

---

## What is this?

This repository is **not a SquadJS plugin**. It's a *skill* — a `SKILL.md` plus reference docs and
code templates that any skill-aware AI coding assistant loads to gain hard-won expertise in building
SquadJS plugins.

**SquadJS** is a Node.js framework that extends a [Squad](https://joinsquad.com/) game server. It
watches the live `SquadGame.log`, polls the server over RCON every ~30 s, emits a **fixed set** of
events, and lets plugins act back through RCON (broadcast, warn, ban, switch team, …). A plugin is an
ES-module class that reacts to those events and nothing else.

The skill's guiding principle:

> **Never fabricate a capability.** Map every requirement onto a real SquadJS event, method, and field
> first. If a requirement maps to nothing — or to something unreliable — the assistant tells you, and
> proposes the closest reliable alternative, instead of shipping a dead code branch that reads a field
> which doesn't exist.

So when you ask your assistant to "build a plugin that does X," with this skill loaded it will first
check whether SquadJS can actually do X — and save you from discovering at runtime that it can't.

## Why use it

Without this skill, an assistant will confidently write plugins that look right and fail in production.
The skill encodes the reality:

- **The real capability surface.** Every event (~28 of them), every RCON/server method, and every
  object field — extracted from the SquadJS core, not guessed. See [`references/api-reference.md`](references/api-reference.md).
- **Which signals you can trust.** `UPDATED_PLAYER_INFORMATION` is the source of truth;
  `PLAYER_DISCONNECTED` catches **clean disconnects only** (not kicks/bans) and can race to a `null` player — for complete departure detection diff `server.players` on `UPDATED_PLAYER_INFORMATION`; `NEW_GAME` marks staging *start* (~260 s before the round is
  live), not "go live"; there is **no** player position, health, or kill counter anywhere. See
  [`references/event-reliability.md`](references/event-reliability.md).
- **The lifecycle traps that bite everyone.** Use `removeListener`/`off`, never `removeEventListener`
  (it throws and leaks the listener — many bundled core plugins get this wrong); clear every timer in
  `unmount()`; bind handlers in the constructor; `eosID` is the primary id, `steamID` is the fallback.
- **Ready-made templates** that already bake in the correct lifecycle, so the assistant scaffolds from
  a known-good base instead of from a buggy example.

## What's in the box

```
squadjs-plugin-creator-skill/
├── .claude-plugin/marketplace.json # lets Claude Code install this repo as a plugin
├── SKILL.md                        # the skill: workflow, hard limits, common mistakes
├── references/
│   ├── api-reference.md            # full event / RCON / server / object-shape catalog
│   ├── event-reliability.md        # which signals fire, which lie, and the reliable patterns
│   └── installation.md             # placing the plugin in SquadJS + config.json + verification
└── templates/
    ├── minimal-plugin.js           # BasePlugin, event-reactive (no Discord, no DB)
    ├── discord-plugin.js           # DiscordBasePlugin, posts embeds to a channel
    └── database-plugin.js          # BasePlugin + Sequelize connector (state survives restarts)
```

---

## Install — pick your AI tool

A skill is just a **folder containing a `SKILL.md`**. Each tool scans one or more *skills directories*
for these folders and activates a skill automatically when your request matches its description. To
install this one, drop the repo into your tool's skills directory under a folder named
**`creating-squadjs-plugins`** (the skill's `name`, so it matches across tools).

> **Note — two different "installs."** This section installs the **skill** (the knowledge) into your AI
> tool. Later, the assistant produces a **plugin** that you install into your *SquadJS server* — that's a
> separate step covered in [`references/installation.md`](references/installation.md) and recapped
> [below](#installing-the-generated-plugin-into-your-squadjs-server). Don't confuse the two: the `.js`
> templates belong on your SquadJS server, not in the skills directory.

### Quick reference

| Tool | Personal skills directory | How it activates | Project instructions file |
|---|---|---|---|
| **Claude Code** | `~/.claude/skills/` (or `claude plugin install`, see below) | `Skill` tool / auto by description; or `/creating-squadjs-plugins` | `CLAUDE.md` |
| **OpenAI Codex** | shared `~/.agents/skills/` (legacy `~/.codex/skills/` is deprecated) | auto by description; or `$creating-squadjs-plugins` | `AGENTS.md` |
| **GitHub Copilot CLI** | `~/.copilot/skills/` *or* shared `~/.agents/skills/` | auto by description; or `/creating-squadjs-plugins` | `AGENTS.md` |
| **Gemini CLI** | `~/.gemini/skills/` *or* shared `~/.agents/skills/` | `activate_skill` tool | `GEMINI.md` |

Two things worth knowing before you start:

- **`~/.agents/skills/` is a shared, cross-runtime path** read by **Codex, Copilot CLI, and Gemini CLI**.
  Clone the skill there once and all three pick it up.
- **Claude Code is the exception** — it reads `~/.claude/skills/` and does **not** read
  `~/.agents/skills/`, so it needs its own copy.

In every tool you activate the skill the same way: **just describe what you want** (e.g. *"Create a
SquadJS plugin that …"* or *"Can SquadJS detect …?"*). The skill's description triggers it; you rarely
need to name it explicitly.

### Claude Code

**Recommended — install as a plugin.** Paste this into Claude Code:

```text
Install the creating-squadjs-plugins skill for me:
run `claude plugin marketplace add Hans-Vader/squadjs-plugin-creator-skill`
and then `claude plugin install creating-squadjs-plugins@squadjs-plugin-creator-skill`.
When both succeed, tell me to run /reload-plugins.
```

Or run the two commands yourself:

```bash
claude plugin marketplace add Hans-Vader/squadjs-plugin-creator-skill
claude plugin install creating-squadjs-plugins@squadjs-plugin-creator-skill
```

Then run `/reload-plugins` (or restart Claude Code). Installed as a plugin, the explicit command is
namespaced: `/creating-squadjs-plugins:creating-squadjs-plugins`. Update later with:

```bash
claude plugin marketplace update squadjs-plugin-creator-skill
claude plugin update creating-squadjs-plugins@squadjs-plugin-creator-skill
```

then `/reload-plugins`.

**Alternative — clone into the skills directory:**

```bash
git clone https://github.com/Hans-Vader/squadjs-plugin-creator-skill.git \
  ~/.claude/skills/creating-squadjs-plugins
```

Then start (or restart) Claude Code and say *"Create a SquadJS plugin that …"*. You can also invoke it
explicitly with `/creating-squadjs-plugins`. For a **project-scoped** install (shared with your team via
the repo), clone into `.claude/skills/creating-squadjs-plugins/` inside your project instead.

### OpenAI Codex

Codex reads personal skills from the shared cross-runtime path, so this one clone also covers Copilot
CLI and Gemini CLI:

```bash
git clone https://github.com/Hans-Vader/squadjs-plugin-creator-skill.git \
  ~/.agents/skills/creating-squadjs-plugins
```

(The older `~/.codex/skills/` still loads but is deprecated — don't install into both, or the skill
shows up twice.) Codex picks the skill automatically when your request matches; invoke it explicitly
with `$creating-squadjs-plugins` or via `/skills`.

### GitHub Copilot CLI

```bash
git clone https://github.com/Hans-Vader/squadjs-plugin-creator-skill.git \
  ~/.copilot/skills/creating-squadjs-plugins
```

(Or use the shared `~/.agents/skills/` path shown above.) Copilot CLI picks the skill automatically when
your request matches; invoke it explicitly with `/creating-squadjs-plugins`, and manage skills with
`/skills`.

### Gemini CLI

```bash
git clone https://github.com/Hans-Vader/squadjs-plugin-creator-skill.git \
  ~/.gemini/skills/creating-squadjs-plugins
```

(Or the shared `~/.agents/skills/` path — when both exist, the `~/.agents/skills/` copy takes
precedence.) Gemini CLI loads skill metadata at session start and activates the full skill via its
`activate_skill` tool (after you confirm) when your request matches.

> For Claude Code, this GitHub repo doubles as its own plugin marketplace (see
> [Claude Code](#claude-code) above). It isn't in any official marketplace, and for Codex, Copilot
> CLI, and Gemini CLI the clone is the install.

---

## Usage — try it

With the skill installed, talk to your assistant in plain language. Some examples:

**Build something:**

> "Create a SquadJS plugin that warns a player in chat when they teamkill, and posts the teamkill to a
> Discord channel."

The assistant will: brainstorm the exact behaviour → map it to the real events
(`TEAMKILL`, optionally `CHAT_COMMAND:<name>`) and actions (`rcon.warn`, a Discord embed) → pick the
`DiscordBasePlugin` base class → scaffold from [`templates/discord-plugin.js`](templates/discord-plugin.js)
→ implement with symmetric `mount()`/`unmount()` and idempotent handlers → and walk you through
installing it on your server.

**Ask whether something is even possible:**

> "Can SquadJS kick a player the instant they disconnect?"

It will tell you **no** and explain why: `PLAYER_DISCONNECTED` fires only for clean disconnects (not
kicks/bans) and can race to a `null` player, complete departure detection comes from the ~30 s RCON
poll, and even then `AdminKick` is a no-op on an already-closed connection — then suggest the closest reliable alternative (e.g. a temp-ban, or poll-based inference).

**Persist state:**

> "Track how many times each player switches teams and let them check their own count with `!switches`."

It will reach for [`templates/database-plugin.js`](templates/database-plugin.js) (the Sequelize
connector), keyed on `eosID`.

## Capabilities & hard limits at a glance

| SquadJS **can** | SquadJS **cannot** |
|---|---|
| React to wounds, deaths, teamkills, revives, possess/unpossess | Give you player **position / grid / death coordinates** |
| Track players, squads, teams via `UPDATED_PLAYER_INFORMATION` (the reliable source of truth) | Give you player **health / HP / stamina** |
| Handle chat commands (`CHAT_COMMAND:<name>`) and chat messages | Get one reliable event for **every** departure (`PLAYER_DISCONNECTED` is clean-disconnects-only; misses kicks/bans) |
| Broadcast, warn, ban, switch teams; run any admin command via `rcon.execute(...)` | Fire an event when the round goes **live** (`NEW_GAME` = staging start, ~260 s early) |
| Post to Discord (`DiscordBasePlugin`) and persist to a DB (Sequelize connector) | Trust `teamID` right after `NEW_GAME` (it's `null` transiently) |

The two-column view is the gist — the authoritative, exhaustive surface lives in
[`references/api-reference.md`](references/api-reference.md), and the reliability rules and reliable
patterns in [`references/event-reliability.md`](references/event-reliability.md).

## The templates

The assistant scaffolds from these. They `import './base-plugin.js'` (etc.), so they're written to live
in your **SquadJS** install at `<squadjs>/squad-server/plugins/` — not in the skills directory.

| Template | Extends | Use when |
|---|---|---|
| [`minimal-plugin.js`](templates/minimal-plugin.js) | `BasePlugin` | Event-reactive logic with no Discord output and no persistence. |
| [`discord-plugin.js`](templates/discord-plugin.js) | `DiscordBasePlugin` | The plugin posts embeds to a Discord channel. |
| [`database-plugin.js`](templates/database-plugin.js) | `BasePlugin` + `sequelize` connector | State must survive server/SquadJS restarts. |

## Installing the generated plugin into your SquadJS server

Once the assistant gives you a plugin file, install it on your server:

1. **Place the file** in `<squadjs>/squad-server/plugins/your-plugin.js` (so its relative imports
   resolve).
2. **Register it** in `config.json` under `"plugins"`, where `"plugin"` **must equal the exported class
   name**. A `required: true` option must be given a value that differs from its `default`.
3. **Wire up connectors** (a Discord bot token, or a `sqlite`/`mysql`/`postgres` Sequelize config) in the
   top-level `connectors` block if the plugin needs Discord or a database.
4. **Verify on a live server** — there's no mock harness. Start SquadJS, confirm the mount log line,
   exercise each path in-game/Discord, and reload to confirm a clean `unmount()`.

Full details, config examples, and the verification checklist are in
[`references/installation.md`](references/installation.md).

## Compatibility

This skill uses the open `SKILL.md` format and works in any assistant that supports it — currently Claude
Code, OpenAI Codex, GitHub Copilot CLI, and Gemini CLI documented above, plus the other clients listed
at [agentskills.io/clients](https://agentskills.io/clients) (each with its own skills path). Tools without native skill support can still
benefit: point them at [`SKILL.md`](SKILL.md) and the `references/` files directly as context.

## License

Licensed under the **GNU General Public License v3.0** — see [`LICENSE`](LICENSE).

Source: [github.com/Hans-Vader/squadjs-plugin-creator-skill](https://github.com/Hans-Vader/squadjs-plugin-creator-skill)
