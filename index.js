
require('dotenv').config();

const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ChannelType
} = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, BOT_NAME = 'Atlas' } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID in your .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

// 31 groups x 10 subcommands = 310 registered slash subcommands.
const catalog = {
  moderation: ['ban','unban','kick','timeout','untimeout','warn','warnings','clearwarnings','purge','slowmode'],
  automod: ['status','enable','disable','filterwords','unfilterwords','antiinvite','antispam','antilink','capsfilter','mentionlimit'],
  admin: ['announce','say','embed','lock','unlock','hide','unhide','renamechannel','settopic','serverinfo'],
  roles: ['add','remove','create','delete','info','list','color','hoist','mentionable','autorole'],
  tickets: ['panel','create','close','adduser','removeuser','rename','claim','transcript','setup','stats'],
  economy: ['balance','daily','weekly','work','beg','crime','deposit','withdraw','pay','leaderboard'],
  leveling: ['rank','level','xp','setxp','resetxp','leaderboard','rewards','setreward','announce','settings'],
  utility: ['ping','help','botinfo','userinfo','avatar','banner','server','channel','role','invite'],
  fun: ['8ball','coinflip','roll','choose','rate','ship','meme','joke','quote','rps'],
  social: ['rep','give_rep','profile','marry','divorce','hug','pat','slap','kiss','highfive'],
  welcome: ['setup','disable','test','setchannel','setmessage','setgoodbye','preview','autorole','settings','variables'],
  logging: ['setup','disable','setchannel','messages','members','roles','channels','voice','mod','settings'],
  giveaway: ['start','end','reroll','list','pause','resume','delete','edit','winners','settings'],
  suggestions: ['setup','disable','submit','approve','deny','consider','list','stats','setchannel','settings'],
  reactionroles: ['create','delete','list','add','remove','menu','button','verify','clear','settings'],
  starboard: ['setup','disable','setchannel','threshold','ignore','unignore','stats','settings','test','clear'],
  reminders: ['set','list','delete','clear','me','server','timezone','settings','snooze','help'],
  polls: ['create','quick','end','results','list','delete','settings','anonymous','multi','ranked'],
  music: ['play','skip','stop','pause','resume','queue','nowplaying','volume','loop','disconnect'],
  ai: ['ask','summarize','translate','rewrite','explain','code','clear','persona','settings','usage'],
  images: ['avatar','banner','servericon','emoji','sticker','meme','caption','pixelate','wanted','triggered'],
  games: ['trivia','hangman','blackjack','slots','dice','duel','tictactoe','connect4','wordle','leaderboard'],
  logs: ['latest','search','user','mod','export','clear','channel','message','settings','stats'],
  custom: ['create','delete','edit','list','run','variables','permissions','cooldown','import','export'],
  config: ['prefix','language','timezone','color','modules','permissions','autorole','welcome','goodbye','reset'],
  backup: ['create','list','restore','delete','schedule','cancel','export','import','status','settings'],
  stats: ['server','members','channels','roles','boosts','activity','messages','voice','growth','bot'],
  applications: ['panel','create','accept','deny','review','questions','list','close','setup','stats'],
  voice: ['tempchannel','rename','limit','bitrate','region','lock','unlock','claim','transfer','delete'],
  security: ['verification','raidmode','lockdown','unlockdown','antinuke','whitelist','blacklist','audit','status','settings'],
  utilityplus: ['calculator','permissions','timestamp','snowflake','poll','remind','shorten','decode','encode','userinfo']
};

const memory = {
  warnings: new Map(),
  xp: new Map(),
  coins: new Map(),
  settings: new Map()
};

const slug = s => s.toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');

function buildCommands() {
  return Object.entries(catalog).map(([group, names]) => {
    const command = new SlashCommandBuilder()
      .setName(group)
      .setDescription(`${group} commands`);

    for (const raw of names) {
      const name = slug(raw);

      command.addSubcommand(sub => {
        sub.setName(name)
          .setDescription(`${name.replaceAll('_',' ')} command`);

        if ([
          'ban','kick','timeout','untimeout','warn',
          'warnings','clearwarnings','pay','add','remove'
        ].includes(name)) {
          sub.addUserOption(o =>
            o.setName('user')
              .setDescription('Target user')
              .setRequired([
                'ban','kick','timeout','warn','pay','add','remove'
              ].includes(name))
          );
        }

        if ([
          'say','announce','embed','ask','translate',
          'rewrite','explain','code','choose','create','quick'
        ].includes(name)) {
          sub.addStringOption(o =>
            o.setName('text')
              .setDescription('Text or question')
              .setMaxLength(1500)
              .setRequired([
                'say','announce','ask','translate',
                'rewrite','explain','code','choose'
              ].includes(name))
          );
        }

        if ([
          'purge','slowmode','timeout','volume','limit',
          'setxp','deposit','withdraw','pay'
        ].includes(name)) {
          sub.addIntegerOption(o =>
            o.setName('amount')
              .setDescription('Amount or seconds')
              .setMinValue(1)
              .setMaxValue(10000)
          );
        }

        return sub;
      });
    }

    return command;
  });
}

const key = (guildId, userId) => `${guildId}:${userId}`;
const getCoins = (g,u) => memory.coins.get(key(g,u)) || 0;
const setCoins = (g,u,n) => memory.coins.set(key(g,u), Math.max(0,n));

const makeEmbed = (title, description) =>
  new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

const isMod = i =>
  i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
  i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

async function respond(i, content, ephemeral = true) {
  const payload = typeof content === 'string'
    ? { content, ephemeral }
    : { ...content, ephemeral };

  return i.replied || i.deferred
    ? i.followUp(payload)
    : i.reply(payload);
}

async function execute(i) {
  const group = i.commandName;
  const action = i.options.getSubcommand();
  const user = i.options.getUser('user');
  const text = i.options.getString('text') || '';
  const amount = i.options.getInteger('amount') || 1;
  const guild = i.guild;

  const targetMember = user && guild
    ? await guild.members.fetch(user.id).catch(() => null)
    : null;

  // UTILITY
  if (group === 'utility' || group === 'utilityplus') {
    if (action === 'ping')
      return respond(i, `Pong! Gateway latency: **${client.ws.ping}ms**.`);

    if (action === 'help')
      return respond(i, {
        embeds: [makeEmbed(
          `${BOT_NAME} Help`,
          `Available groups: ${Object.keys(catalog).map(x => `\`${x}\``).join(', ')}`
        )]
      });

    if (action === 'botinfo' || action === 'bot')
      return respond(i, {
        embeds: [makeEmbed(
          BOT_NAME,
          `Servers: ${client.guilds.cache.size}\nUsers cached: ${client.users.cache.size}\nDiscord.js: ${require('discord.js').version}`
        )]
      });

    if (action === 'server' || action === 'serverinfo')
      return respond(i, {
        embeds: [makeEmbed(
          guild.name,
          `Members: ${guild.memberCount}\nChannels: ${guild.channels.cache.size}\nRoles: ${guild.roles.cache.size}`
        )]
      });

    if (action === 'userinfo' || action === 'profile') {
      const u = user || i.user;
      return respond(i, {
        embeds: [makeEmbed(
          u.tag || u.username,
          `ID: ${u.id}\nCreated: <t:${Math.floor(u.createdTimestamp/1000)}:R>`
        ).setThumbnail(u.displayAvatarURL())]
      });
    }

    if (action === 'avatar') {
      const u = user || i.user;
      return respond(i, {
        embeds: [makeEmbed('Avatar', u.displayAvatarURL({ size: 1024 }))]
      });
    }

    if (action === 'channel')
      return respond(i, `Channel: ${i.channel} | ID: ${i.channelId}`);

    if (action === 'invite')
      return respond(i, `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`);

    if (action === 'timestamp')
      return respond(i, `Unix timestamp: ${Math.floor(Date.now()/1000)}`);

    if (action === 'snowflake')
      return respond(i, `Your ID: ${i.user.id}`);

    if (action === 'calculator')
      return respond(i, 'Calculator is registered but not implemented in this lightweight build.');
  }

  // MODERATION
  if (group === 'moderation') {
    if (!isMod(i))
      throw new Error('You need Moderate Members or Manage Server permission.');

    if ([
      'ban','kick','timeout','untimeout',
      'warn','warnings','clearwarnings'
    ].includes(action) && !user)
      throw new Error('Select a user.');

    if (action === 'ban') {
      if (!i.memberPermissions.has(PermissionFlagsBits.BanMembers))
        throw new Error('Ban Members permission required.');

      await targetMember.ban({ reason: 'Moderator action' });
      return respond(i, `Banned ${user.tag}.`);
    }

    if (action === 'kick') {
      if (!i.memberPermissions.has(PermissionFlagsBits.KickMembers))
        throw new Error('Kick Members permission required.');

      await targetMember.kick();
      return respond(i, `Kicked ${user.tag}.`);
    }

    if (action === 'timeout') {
      await targetMember.timeout(Math.min(amount*60000, 2419200000));
      return respond(i, `Timed out ${user.tag} for ${amount} minute(s).`);
    }

    if (action === 'untimeout') {
      await targetMember.timeout(null);
      return respond(i, `Removed timeout from ${user.tag}.`);
    }

    if (action === 'warn') {
      const k = key(guild.id,user.id);
      const a = memory.warnings.get(k) || [];
      a.push({ reason: text || 'No reason supplied', by: i.user.id, at: Date.now() });
      memory.warnings.set(k,a);
      return respond(i, `Warned ${user.tag}. Total warnings: ${a.length}.`);
    }

    if (action === 'warnings')
      return respond(i, `${user.tag} has ${(memory.warnings.get(key(guild.id,user.id))||[]).length} warning(s).`);

    if (action === 'clearwarnings') {
      memory.warnings.delete(key(guild.id,user.id));
      return respond(i, `Cleared warnings for ${user.tag}.`);
    }

    if (action === 'purge') {
      if (!i.memberPermissions.has(PermissionFlagsBits.ManageMessages))
        throw new Error('Manage Messages permission required.');

      const n = await i.channel.bulkDelete(Math.min(amount,100),true);
      return respond(i, `Deleted ${n.size} messages.`);
    }

    if (action === 'slowmode') {
      await i.channel.setRateLimitPerUser(Math.min(amount,21600));
      return respond(i, `Slowmode set to ${amount} seconds.`);
    }
  }

  // ADMIN
  if (group === 'admin') {
    if (!isMod(i))
      throw new Error('Manage Server permission required.');

    if (action === 'say')
      return respond(i, text, false);

    if (action === 'announce' || action === 'embed')
      return respond(i, {
        embeds: [makeEmbed(
          action === 'announce' ? 'Announcement' : 'Custom Embed',
          text
        )]
      }, false);

    if (action === 'lock' || action === 'unlock') {
      await i.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: action === 'unlock' ? null : false }
      );
      return respond(i, `Channel ${action}ed.`);
    }

    if (action === 'hide' || action === 'unhide') {
      await i.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { ViewChannel: action === 'unhide' ? null : false }
      );
      return respond(i, 'Channel visibility updated.');
    }

    if (action === 'renamechannel') {
      await i.channel.setName(text || `channel-${Date.now()}`);
      return respond(i, 'Channel renamed.');
    }

    if (action === 'settopic') {
      await i.channel.setTopic(text);
      return respond(i, 'Channel topic updated.');
    }
  }

  // ECONOMY
  if (group === 'economy') {
    const coins = getCoins(guild.id,i.user.id);

    if (action === 'balance')
      return respond(i, `Wallet: **${coins}** coins.`);

    if (action === 'daily' || action === 'weekly') {
      const reward = action === 'daily' ? 250 : 1500;
      setCoins(guild.id,i.user.id,coins+reward);
      return respond(i, `You collected **${reward}** coins.`);
    }

    if (['work','beg','crime'].includes(action)) {
      const reward = action === 'work'
        ? 100
        : action === 'beg'
          ? 20
          : Math.floor(Math.random()*301)-100;

      setCoins(guild.id,i.user.id,coins+reward);

      return respond(i, reward >= 0
        ? `You earned **${reward}** coins.`
        : `You lost **${-reward}** coins.`);
    }

    if (action === 'pay') {
      if (!user || user.bot || user.id === i.user.id)
        throw new Error('Choose another human user.');

      if (coins < amount)
        throw new Error('Insufficient balance.');

      setCoins(guild.id,i.user.id,coins-amount);
      setCoins(guild.id,user.id,getCoins(guild.id,user.id)+amount);

      return respond(i, `Paid ${amount} coins to ${user}.`);
    }
  }

  // LEVELING
  if (group === 'leveling' && ['rank','level','xp'].includes(action)) {
    const xp = memory.xp.get(key(guild.id,user?.id || i.user.id)) || 0;
    return respond(i, `XP: **${xp}** | Level: **${Math.floor(Math.sqrt(xp/100))}**`);
  }

  // FUN
  if (group === 'fun') {
    if (action === 'coinflip')
      return respond(i, Math.random() < .5 ? 'Heads' : 'Tails');

    if (action === 'roll')
      return respond(i, `You rolled **${Math.floor(Math.random()*6)+1}**.`);

    if (action === '8ball')
      return respond(i, ['Yes.','No.','Definitely.','Unlikely.','Ask again later.'][Math.floor(Math.random()*5)]);

    if (action === 'choose')
      return respond(i, `I choose: **${text.split(',').map(x=>x.trim()).filter(Boolean).sort(()=>Math.random()-.5)[0] || 'Nothing'}**`);

    if (action === 'joke')
      return respond(i, 'Why did the developer go broke? Because they used up all their cache.');
  }

  // POLLS
  if (group === 'polls' && ['create','quick'].includes(action)) {
    if (!text) throw new Error('Provide poll text.');

    const msg = await i.channel.send({
      embeds: [makeEmbed('Poll',text)]
    });

    await msg.react('👍');
    await msg.react('👎');

    return respond(i, `Poll created: ${msg.url}`);
  }

  // TICKETS
  if (group === 'tickets' && action === 'create') {
    const ch = await guild.channels.create({
      name: `ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,90),
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: i.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }
      ]
    });

    await ch.send(`${i.user} Support ticket created.`);
    return respond(i, `Ticket created: ${ch}`);
  }

  // FEATURES THAT NEED ADDITIONAL INTEGRATIONS
  const notes = {
    music: 'Music playback needs an audio node/service and a supported source.',
    ai: 'AI commands need an AI provider and API key.',
    images: 'Image tools need an image-processing library or service.',
    backup: 'Backup commands need a configured storage destination.',
    giveaway: 'Giveaway scheduling and winner selection need a scheduler.',
    reminders: 'Reminder delivery needs a persistent scheduler.',
    security: 'Security automation needs explicit rules and allowlists.',
    voice: 'Voice features need their dedicated voice-state implementation.'
  };

  return respond(i, notes[group] ||
    `/${group} ${action} is registered. This command needs its feature-specific implementation or configuration.`);
}

// REGISTER COMMANDS
client.once('ready', async () => {
  console.log(`${BOT_NAME} online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const commands = buildCommands().map(c => c.toJSON());

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log(
      `Registered ${commands.length} command groups and ${commands.reduce((n,c)=>n+c.options.length,0)} subcommands.`
    );
  } catch (error) {
    console.error('Command registration failed:', error);
  }
});

// INTERACTIONS
client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;

  try {
    await execute(i);
  } catch (error) {
    console.error(error);
    await respond(i, `Error: ${error.message || 'Unexpected error'}`).catch(()=>{});
  }
});

// XP SYSTEM (RAM ONLY)
client.on('messageCreate', message => {
  if (message.author.bot || !message.guild) return;

  const k = key(message.guild.id,message.author.id);
  const xp = (memory.xp.get(k)||0) + Math.floor(Math.random()*8) + 8;

  memory.xp.set(k,xp);
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error('Login failed:', error);
  process.exit(1);
});
