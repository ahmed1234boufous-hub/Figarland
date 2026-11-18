async function getSettings(guildId) {
  return (await settings.findOne({guildId})) || {guildId};
}

async function patchSettings(guildId, patch) {
  await settings.updateOne({guildId},{$set:{guildId,...patch}},{upsert:true});
}

function embed(title, description, color=0x5865F2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || "—")
    .setTimestamp();
}

async function reply(i, content, ephemeral=true) {
  const payload = typeof content === "string"
    ? {content,ephemeral}
    : {...content,ephemeral};

  if (i.deferred || i.replied) return i.followUp(payload);
  return i.reply(payload);
}

function isMod(i) {
  return i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
    i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function needMod(i) {
  if (!isMod(i)) {
    throw new Error("You need Moderate Members or Manage Server permission.");
  }
}

function optText(i) {
  return i.options.getString("text") || "";
}

function optAmount(i) {
  return i.options.getInteger("amount");
}

function target(i) {
  return i.options.getUser("user");
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function runCommand(i) {
  const group = i.commandName;
  const action = i.options.getSubcommand();
  const guild = i.guild;
  const user = i.user;
  const textValue = optText(i);
  const amount = optAmount(i);
  const memberUser = target(i);

  const s = guild ? await getSettings(guild.id) : {};
  const member = memberUser
    ? await guild.members.fetch(memberUser.id).catch(() => null)
    : null;

  // GENERAL UTILITIES
  if (group === "utility" || group === "utilityplus") {
    if (action === "ping") {
      return reply(i, `Pong! **${client.ws.ping}ms** gateway latency.`);
    }

    if (action === "help") {
      return reply(i, {
        embeds: [
          embed(
            `${BRAND} commands`,
            "31 command groups and 300+ subcommands. Try /moderation, /economy, /tickets, or /utility."
          )
        ]
      });
    }

    if (action === "botinfo") {
      return reply(i, {
        embeds: [
          embed(
            BRAND,
            `Servers: ${client.guilds.cache.size}
Users cached: ${client.users.cache.size}
Node: ${process.version}
Discord.js: ${require("discord.js").version}`
          )
        ]
      });
    }

    if (action === "server" || action === "serverinfo") {
      return reply(i, {
        embeds: [
          embed(
            guild.name,
            `Members: ${guild.memberCount}
Channels: ${guild.channels.cache.size}
Roles: ${guild.roles.cache.size}
Created: <t:${Math.floor(guild.createdTimestamp / 1000)}:D>`
          )
        ]
      });
    }

    if (action === "userinfo" || action === "profile") {
      const u = memberUser || user;
      return reply(i, {
        embeds: [
          embed(
            u.tag || u.username,
            `ID: ${u.id}
Created: <t:${Math.floor(u.createdTimestamp / 1000)}:R>`
          ).setThumbnail(u.displayAvatarURL())
        ]
      });
    }

    if (action === "avatar") {
      const u = memberUser || user;
      return reply(i, {
        embeds: [
          embed("Avatar", u.displayAvatarURL({size: 1024}))
        ]
      });
    }

    if (action === "channel") {
      return reply(i, `Channel: ${i.channel} • ID: \`${i.channelId}\``);
    }

    if (action === "role") {
      return reply(i, `Roles in this server: ${guild.roles.cache.size}`);
    }

    if (action === "invite") {
      return reply(i,
        `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`
      );
    }

    if (action === "timestamp") {
      return reply(i, `Unix timestamp: \`${Math.floor(Date.now() / 1000)}\``);
    }

    if (action === "snowflake") {
      return reply(i, `Your Discord ID: \`${user.id}\``);
    }

    if (action === "calculator") {
      const m = textValue.match(/^\s*[\d+\-*/(). %]+\s*$/);
      if (!m) {
        return reply(i, "Provide a basic arithmetic expression in the text option.");
      }

      const tokens = textValue.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];

      if (tokens.join("") !== textValue.replace(/\s/g, "")) {
        return reply(i, "Invalid expression.");
      }

      const nums = [];
      const ops = [];
      const prec = {"+":1, "-":1, "*":2, "/":2, "%":2};

      const apply = () => {
        const op = ops.pop();
        const b = nums.pop();
        const a = nums.pop();

        if (op === "+") nums.push(a + b);
        if (op === "-") nums.push(a - b);
        if (op === "*") nums.push(a * b);
        if (op === "/") nums.push(a / b);
        if (op === "%") nums.push(a % b);
      };

      let prev = true;

      for (const t of tokens) {
        if (/^\d/.test(t)) {
          nums.push(Number(t));
          prev = false;
        } else if (t === "(") {
          ops.push(t);
          prev = true;
        } else if (t === ")") {
          while (ops.length && ops.at(-1) !== "(") apply();
          ops.pop();
          prev = false;
        } else {
          if (t === "-" && prev) nums.push(0);
          while (ops.length && prec[ops.at(-1)] >= prec[t]) apply();
          ops.push(t);
          prev = true;
        }
      }

      while (ops.length) apply();
      return reply(i, `Result: **${nums[0]}**`);
    }
  }

  // MODERATION
  if (group === "moderation") {
    needMod(i);

    if (action === "purge") {
      if (!i.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
        throw new Error("Manage Messages permission required.");
      }

      const n = Math.min(Math.max(amount || 10, 1), 100);
      const deleted = await i.channel.bulkDelete(n, true);
      return reply(i, `Deleted **${deleted.size}** messages.`);
    }

    if (["ban","kick","timeout","untimeout","warn","clearwarnings"].includes(action) && !memberUser) {
      throw new Error("Select a user.");
    }

    if (action === "ban") {
      if (!i.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
        throw new Error("Ban Members permission required.");
      }

      await member.ban({reason: "Moderator action"});
      return reply(i, `Banned ${memberUser.tag}.`);
    }

    if (action === "kick") {
      if (!i.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
        throw new Error("Kick Members permission required.");
      }

      await member.kick();
      return reply(i, `Kicked ${memberUser.tag}.`);
    }

    if (action === "timeout") {
      const ms = Math.min(Math.max((amount || 10) * 60000, 60000), 2419200000);
      await member.timeout(ms);
      return reply(i, `Timed out ${memberUser.tag}.`);
    }

    if (action === "untimeout") {
      await member.timeout(null);
      return reply(i, `Removed timeout from ${memberUser.tag}.`);
    }

    if (action === "warn") {
      const list = (await warnings.findOne({
        guildId: guild.id,
        userId: memberUser.id
      }))?.items || [];

      list.push({
        by: user.id,
        at: Date.now(),
        reason: textValue || "No reason supplied"
      });

      await warnings.updateOne(
        {guildId: guild.id, userId: memberUser.id},
        {$set: {items: list}},
        {upsert: true}
      );

      return reply(i, `Warned ${memberUser.tag}. Total warnings: **${list.length}**.`);
    }

    if (action === "warnings") {
      const u = memberUser || user;
      const list = (await warnings.findOne({
        guildId: guild.id,
        userId: u.id
      }))?.items || [];

      return reply(i, `**${u.tag}** has ${list.length} warning(s).`);
    }

    if (action === "clearwarnings") {
      await warnings.deleteOne({
        guildId: guild.id,
        userId: memberUser.id
      });

      return reply(i, `Cleared warnings for ${memberUser.tag}.`);
    }

    if (action === "slowmode") {
      const seconds = Math.min(amount || 5, 21600);
      await i.channel.setRateLimitPerUser(seconds);
      return reply(i, `Slowmode set to ${seconds} seconds.`);
    }

    return reply(i,
      `Moderation action **${action}** requires its specific configuration or target options.`
    );
  }

  // ADMINISTRATION
  if (group === "admin") {
    needMod(i);

    if (action === "say") {
      return reply(i, textValue, false);
    }

    if (action === "announce") {
      return reply(i, {
        embeds: [embed("Announcement", textValue)]
      }, false);
    }

    if (action === "lock" || action === "unlock") {
      await i.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        {SendMessages: action === "unlock" ? null : false}
      );

      return reply(i, `Channel ${action}ed.`);
    }

    if (action === "hide" || action === "unhide") {
      await i.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        {ViewChannel: action === "unhide" ? null : false}
      );

      return reply(i, "Channel visibility updated.");
    }

    if (action === "renamechannel") {
      await i.channel.setName(
        textValue.slice(0, 100) || `channel-${Date.now()}`
      );

      return reply(i, "Channel renamed.");
    }

    if (action === "settopic") {
      await i.channel.setTopic(textValue.slice(0, 1024));
      return reply(i, "Channel topic updated.");
    }

    if (action === "embed") {
      return reply(i, {
        embeds: [embed("Custom embed", textValue)]
      }, false);
    }
  }

  // ECONOMY
  if (group === "economy") {
    const p = await getProfile(guild.id, user.id);
    const now = Date.now();

    if (action === "balance") {
      return reply(i,
        `Wallet: **${p.coins || 0}** coins
Bank: **${p.bank || 0}** coins`
      );
    }

    if (action === "daily" || action === "weekly") {
      const key = action === "daily" ? "lastDaily" : "lastWeekly";
      const cooldown = action === "daily" ? 86400000 : 604800000;

      if (now - (p[key] || 0) < cooldown) {
        return reply(i,
          `Available <t:${Math.floor((p[key] + cooldown) / 1000)}:R>.`
        );
      }

      const reward = action === "daily" ? 250 : 1500;

      await patchProfile(guild.id, user.id, {
        [key]: now,
        coins: (p.coins || 0) + reward
      });

      return reply(i, `You collected **${reward}** coins.`);
    }

    if (["work","beg","crime"].includes(action)) {
      const reward = action === "work" ? [80,180] :
        action === "beg" ? [5,45] : [-100,350];

      const n = Math.floor(
        Math.random() * (reward[1] - reward[0] + 1)
      ) + reward[0];

      await patchProfile(guild.id, user.id, {
        coins: Math.max(0, (p.coins || 0) + n)
      });

      return reply(i,
        n >= 0 ? `You earned **${n}** coins.` : `You lost **${-n}** coins.`
      );
    }

    if (action === "deposit" || action === "withdraw") {
      const n = Math.max(1, amount || 0);

      if (action === "deposit" && (p.coins || 0) < n) {
        throw new Error("Not enough wallet coins.");
      }

      if (action === "withdraw" && (p.bank || 0) < n) {
        throw new Error("Not enough bank coins.");
      }

      await patchProfile(guild.id, user.id, {
        coins: (p.coins || 0) + (action === "withdraw" ? n : -n),
        bank: (p.bank || 0) + (action === "deposit" ? n : -n)
      });

      return reply(i, `${action}ed **${n}** coins.`);
    }

    if (action === "pay") {
      if (!memberUser || memberUser.bot || memberUser.id === user.id) {
        throw new Error("Choose another human user.");
      }

      const n = Math.max(1, amount || 0);

      if ((p.coins || 0) < n) {
        throw new Error("Insufficient balance.");
      }

      const q = await getProfile(guild.id, memberUser.id);

      await patchProfile(guild.id, user.id, {coins: p.coins - n});
      await patchProfile(guild.id, memberUser.id, {
        coins: (q.coins || 0) + n
      });

      return reply(i, `Paid **${n}** coins to ${memberUser}.`);
    }
  }
