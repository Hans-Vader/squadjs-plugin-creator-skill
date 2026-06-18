# Installing & Verifying a SquadJS Plugin

## 1. File placement

A single-file plugin goes in the SquadJS install's plugin directory:

```
<squadjs>/squad-server/plugins/my-plugin.js      # relative import './base-plugin.js' resolves here
```

## 2. Register it in `config.json`

The `"plugin"` value **must equal the exported class name** (SquadJS loads by class name). Each
key in the block maps to an `optionsSpecification` option.

```jsonc
{
  "plugins": [
    {
      "plugin": "MyPlugin",        // === `export default class MyPlugin`
      "enabled": true,
      "commandPrefix": "hello"     // any non-connector option from optionsSpecification
    }
  ]
}
```

A `required: true` option must be given a value **different from its `default`**, or the plugin
throws at load.

## 3. Connectors (Discord / database)

Connector-typed options name an entry in the top-level `connectors` block; SquadJS injects the
live object.

```jsonc
{
  "connectors": {
    "discord": "OewBLABLA.YourBotToken",                // → this.options.discordClient
    "sqlite":  { "dialect": "sqlite", "storage": "squad-server.sqlite" },
    "mysql":   { "dialect": "mysql", "host": "…", "port": 3306, "username": "…",
                 "password": "…", "database": "…" }     // → this.options.database
  },
  "plugins": [
    {
      "plugin": "MyDiscordPlugin",
      "enabled": true,
      "discordClient": "discord",   // names the connector above
      "channelID": "667741905228136459"
    },
    {
      "plugin": "MyDbPlugin",
      "enabled": true,
      "database": "sqlite"          // or "mysql"
    }
  ]
}
```

## 4. Live-server verification

There is no bundled mock harness — verify against a running SquadJS instance:

0. **Static check (before loading).** `grep -n removeEventListener <your-plugin>.js` must return
   nothing — it throws at runtime and leaks the listener (use `removeListener`/`off`). Confirm
   `mount()`/`unmount()` register and remove the same listeners, and every timer is cleared.
1. **Load check.** Start SquadJS. A schema error (e.g. a required option left at its default, a
   bad connector name) throws at startup — fix before continuing.
2. **Mount check.** Confirm your `this.verbose(1, 'Mounted.')` line appears in the SquadJS log.
   Raise the SquadJS log verbosity for your plugin to see level 2–3 output.
3. **Exercise each path in-game / in Discord.** Trigger the real events: type the chat command,
   cause a teamkill, switch teams, etc. Watch the corresponding `verbose` output and the
   side effects (warn delivered in-game, embed posted, DB row written).
4. **Reload check.** Disable/enable (or restart) to confirm `unmount()` runs cleanly — no
   `removeEventListener` TypeError, no duplicated handlers, no leaked timers after a re-mount.
5. **DB plugins.** Confirm the table is created on first run and the data persists across a full
   SquadJS restart.

If a behaviour can't be verified because the underlying signal doesn't exist or is incomplete (e.g.
complete departure detection from `PLAYER_DISCONNECTED`, which misses kicks/bans), that's a
feasibility problem, not a config problem — revisit `event-reliability.md`.
