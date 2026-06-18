import DiscordBasePlugin from './discord-base-plugin.js';

/**
 * DISCORD SQUADJS PLUGIN TEMPLATE — extends DiscordBasePlugin.
 *
 * Use when the plugin posts to a Discord channel. DiscordBasePlugin:
 *   - adds the required `discordClient` connector option,
 *   - fetches `this.channel` from `channelID` in its inherited prepareToMount(),
 *   - provides sendDiscordMessage({ embed: {...} }) (it wraps `embed` into `embeds`
 *     and accepts a hex-string OR integer `color`).
 *
 * Place in <squadjs>/squad-server/plugins/. config.json needs a "discord" connector
 * (bot token) and this plugin block with "discordClient": "discord" and a "channelID".
 */
export default class MyDiscordPlugin extends DiscordBasePlugin {
  static get description() {
    return 'Posts a Discord embed to a configured channel when a teamkill occurs.';
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      ...DiscordBasePlugin.optionsSpecification, // provides the required `discordClient` connector
      channelID: {
        required: true,
        description: 'The ID of the Discord channel to post to.',
        default: '',
        example: '667741905228136459'
      },
      color: {
        required: false,
        description: 'Embed color (integer, or a hex string like "FF0000").',
        default: 16761867
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.onTeamkill = this.onTeamkill.bind(this);
  }

  // prepareToMount() is inherited — it sets this.channel from this.options.channelID.

  async mount() {
    this.server.on('TEAMKILL', this.onTeamkill);
    this.verbose(1, 'Mounted.');
  }

  async unmount() {
    // removeListener / off — never removeEventListener (does not exist, throws).
    this.server.removeListener('TEAMKILL', this.onTeamkill);
    this.verbose(1, 'Unmounted.');
  }

  async onTeamkill(info) {
    // TEAMKILL only fires when BOTH attacker and victim resolved, but guard anyway —
    // idiomatic and harmless (see references/event-reliability.md).
    if (!info.attacker || !info.victim) return;

    await this.sendDiscordMessage({
      embed: {
        title: 'Teamkill',
        color: this.options.color,
        fields: [
          { name: 'Attacker', value: `${info.attacker.name} (${info.attacker.eosID})` },
          { name: 'Victim', value: `${info.victim.name} (${info.victim.eosID})` },
          { name: 'Weapon', value: info.weapon || 'Unknown' }
        ],
        timestamp: (info.time instanceof Date ? info.time : new Date()).toISOString()
      }
    });
  }
}
