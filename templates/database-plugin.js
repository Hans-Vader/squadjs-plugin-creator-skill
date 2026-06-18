import BasePlugin from './base-plugin.js';
import Sequelize from 'sequelize';

const { DataTypes } = Sequelize;

/**
 * DATABASE-BACKED SQUADJS PLUGIN TEMPLATE — extends BasePlugin + Sequelize connector.
 *
 * Use when state must survive server/SquadJS restarts. The `database` option references
 * a Sequelize connector declared in config.json's "connectors" (sqlite / mysql / postgres);
 * BasePlugin injects the live Sequelize instance as this.options.database.
 *
 * Example feature: count how many times each player switches teams; let a player read
 * their own count with an in-game !switches command.
 */
export default class MyDbPlugin extends BasePlugin {
  static get description() {
    return 'Persistently counts per-player team switches; players check their own with a command.';
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      database: {
        required: true,
        connector: 'sequelize',
        description: 'Sequelize connector name (sqlite / mysql / postgres).',
        default: 'sqlite'
      },
      commandPrefix: {
        required: false,
        description: 'Chat command word, without the leading "!".',
        default: 'switches'
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.models = {};
    this.onTeamChange = this.onTeamChange.bind(this);
    this.onCommand = this.onCommand.bind(this);
  }

  // Prefix the table name so it cannot collide with another plugin sharing the DB.
  createModel(name, schema) {
    this.models[name] = this.options.database.define(`MyDbPlugin_${name}`, schema, {
      timestamps: false
    });
  }

  // SQLite locks under concurrent writes; retry transient lock errors.
  async safeTransaction(fn) {
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.options.database.transaction(fn);
      } catch (err) {
        const locked =
          err && err.message &&
          (err.message.includes('SQLITE_BUSY') || err.message.includes('database is locked'));
        if (locked && i < maxRetries - 1) continue;
        throw err;
      }
    }
  }

  // prepareToMount() runs before mount() — define + sync models here so they exist
  // before any event can arrive.
  async prepareToMount() {
    this.createModel('SwitchCount', {
      eosID: { type: DataTypes.STRING, primaryKey: true },
      steamID: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: true },
      count: { type: DataTypes.INTEGER, defaultValue: 0 }
    });
    await this.models.SwitchCount.sync();
  }

  async mount() {
    this.server.on('PLAYER_TEAM_CHANGE', this.onTeamChange);
    this.server.on(`CHAT_COMMAND:${this.options.commandPrefix}`, this.onCommand);
    this.verbose(1, 'Mounted.');
  }

  async unmount() {
    // removeListener / off — never removeEventListener.
    this.server.removeListener('PLAYER_TEAM_CHANGE', this.onTeamChange);
    this.server.removeListener(`CHAT_COMMAND:${this.options.commandPrefix}`, this.onCommand);
    this.verbose(1, 'Unmounted.');
  }

  async onTeamChange(info) {
    // info = { player, oldTeamID, newTeamID }. eosID is the stable primary key.
    const p = info.player;
    if (!p || !p.eosID) return;
    await this.safeTransaction(async (t) => {
      const [row] = await this.models.SwitchCount.findOrCreate({
        where: { eosID: p.eosID },
        defaults: { steamID: p.steamID, name: p.name, count: 0 },
        transaction: t
      });
      await row.increment('count', { by: 1, transaction: t });
    });
  }

  async onCommand(data) {
    const row = await this.models.SwitchCount.findByPk(data.player.eosID);
    const n = row ? row.count : 0;
    await this.server.rcon.warn(data.player.eosID, `You have switched teams ${n} time(s).`);
  }
}
