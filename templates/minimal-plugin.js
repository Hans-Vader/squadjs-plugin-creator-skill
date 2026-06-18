import BasePlugin from './base-plugin.js';

/**
 * MINIMAL SQUADJS PLUGIN TEMPLATE — extends BasePlugin.
 *
 * Use for event-reactive plugins with no Discord output and no persistence.
 * Rename the class, set the three static getters, declare your options, and
 * register only the events you actually use.
 *
 * Place this file in <squadjs>/squad-server/plugins/ so the relative import
 * './base-plugin.js' resolves. Register it in config.json under "plugins" with
 * "plugin": "MyPlugin" (must equal the class name).
 */
export default class MyPlugin extends BasePlugin {
  static get description() {
    return 'One-sentence summary of what this plugin does (shown in the SquadJS docs).';
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      commandPrefix: {
        required: false,
        description: 'Chat command word, without the leading "!".',
        default: 'hello'
      }
      // A `required: true` option must be given a value in config that DIFFERS from
      // its `default`, otherwise BasePlugin throws at load.
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    // In-memory state. Clear it in unmount() (and on NEW_GAME if it is per-round).
    this.state = new Map();

    // Bind EVERY handler so `this` is the plugin instance when the event fires.
    this.onChatCommand = this.onChatCommand.bind(this);
    this.onNewGame = this.onNewGame.bind(this);
  }

  async mount() {
    // The events registered here MUST be removed 1:1 in unmount().
    this.server.on(`CHAT_COMMAND:${this.options.commandPrefix}`, this.onChatCommand);
    this.server.on('NEW_GAME', this.onNewGame);
    this.verbose(1, 'Mounted.');
  }

  async unmount() {
    // It is removeListener / off — NOT removeEventListener. The server is a Node
    // EventEmitter; removeEventListener does not exist on it and throws TypeError,
    // leaking the listener. (Many bundled SquadJS plugins get this wrong.)
    this.server.removeListener(`CHAT_COMMAND:${this.options.commandPrefix}`, this.onChatCommand);
    this.server.removeListener('NEW_GAME', this.onNewGame);
    this.state.clear();
    this.verbose(1, 'Unmounted.');
  }

  async onChatCommand(data) {
    // data = { player, message (text after the command), chat, steamID, eosID, time, ... }
    // Reply privately to the caller. eosID is the primary id; steamID is the fallback.
    await this.server.rcon.warn(data.player.eosID, 'Hello from MyPlugin!');
  }

  async onNewGame(data) {
    // data.layer is the resolved layer. teamID is null transiently (~30s) right now,
    // so do not trust team assignments here — see references/event-reliability.md.
    this.state.clear();
  }
}
