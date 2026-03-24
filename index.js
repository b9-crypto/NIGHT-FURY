const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");
const play = require("play-dl");
const { commandData } = require("./src/commands");

try {
  require("dotenv").config();
} catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND") {
    console.warn("dotenv load warning:", error);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBool(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const TOKEN = requireEnv("TOKEN");
const CLIENT_ID = requireEnv("CLIENT_ID");
const GUILD_ID = process.env.GUILD_ID || "";
const AUTO_REGISTER_COMMANDS = parseBool(process.env.AUTO_REGISTER_COMMANDS, true);

const IDLE_DISCONNECT_MS = 3 * 60 * 1000;
const MAX_PLAYLIST_QUEUE = 50;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const sessions = new Map();

function parseDurationRaw(raw) {
  if (!raw || typeof raw !== "string") return 0;
  const parts = raw.split(":").map(part => Number(part));
  if (parts.some(part => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "live";
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  const totalMinutes = Math.floor(seconds / 60);
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  const h = Math.floor(totalMinutes / 60);
  if (h > 0) return `${h}:${m}:${s}`;
  return `${totalMinutes}:${s}`;
}

function buildProgressBar(elapsed, total, width = 16) {
  if (!Number.isFinite(total) || total <= 0) {
    return "`[ live stream ]`";
  }
  const ratio = Math.max(0, Math.min(1, elapsed / total));
  const fillCount = Math.min(width - 1, Math.floor(ratio * width));
  const bar = "=".repeat(fillCount) + "o" + "-".repeat(width - fillCount - 1);
  return `\`${bar}\``;
}

function mapVideoToTrack(video, requestedBy) {
  const url = video.url || `https://www.youtube.com/watch?v=${video.id}`;
  const durationFromSeconds = Number(video.durationInSec);
  const durationSec = Number.isFinite(durationFromSeconds)
    ? durationFromSeconds
    : parseDurationRaw(video.durationRaw);
  const thumbnails = Array.isArray(video.thumbnails) ? video.thumbnails : [];
  const thumbnail =
    thumbnails.length > 0 ? thumbnails[thumbnails.length - 1]?.url || null : null;

  return {
    title: video.title || "Unknown title",
    url,
    durationSec,
    requestedBy: `<@${requestedBy.id}>`,
    thumbnail
  };
}

async function resolveTracks(query, requestedBy) {
  const ytType = play.yt_validate(query);

  if (ytType === "video") {
    const info = await play.video_basic_info(query);
    return [mapVideoToTrack(info.video_details, requestedBy)];
  }

  if (ytType === "playlist") {
    const playlist = await play.playlist_info(query, { incomplete: true });
    const videos = await playlist.all_videos();
    const chosen = videos.slice(0, MAX_PLAYLIST_QUEUE);
    return chosen.map(video => mapVideoToTrack(video, requestedBy));
  }

  const results = await play.search(query, {
    limit: 1,
    source: { youtube: "video" }
  });

  if (!results.length) {
    throw new Error("No results found for that query.");
  }

  return [mapVideoToTrack(results[0], requestedBy)];
}

class GuildMusicSession {
  constructor(guildId, onDestroy) {
    this.guildId = guildId;
    this.onDestroy = onDestroy;
    this.connection = null;
    this.voiceChannelId = null;
    this.textChannelId = null;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });
    this.queue = [];
    this.currentTrack = null;
    this.volume = 80;
    this.loopMode = "off";
    this.trackStartedAt = 0;
    this.disconnectTimer = null;

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.handleTrackEnd(false).catch(error => {
        console.error(`[${this.guildId}] idle handler error`, error);
      });
    });

    this.player.on("error", error => {
      console.error(`[${this.guildId}] player error`, error);
      this.sendMessage("Playback failed for the current track, skipping.").catch(() => {});
      this.handleTrackEnd(true).catch(err => {
        console.error(`[${this.guildId}] recovery error`, err);
      });
    });
  }

  setTextChannel(channel) {
    if (!channel) return;
    this.textChannelId = channel.id;
  }

  async sendMessage(content) {
    if (!this.textChannelId || !client.isReady()) return;
    let channel = client.channels.cache.get(this.textChannelId);
    if (!channel) {
      try {
        channel = await client.channels.fetch(this.textChannelId);
      } catch {
        return;
      }
    }
    if (channel && channel.isTextBased()) {
      channel.send(content).catch(() => {});
    }
  }

  async sendNowPlaying(track) {
    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle("Now Playing")
      .setDescription(`[${track.title}](${track.url})`)
      .addFields(
        { name: "Duration", value: formatDuration(track.durationSec), inline: true },
        { name: "Volume", value: `${this.volume}%`, inline: true },
        { name: "Requested by", value: track.requestedBy, inline: true }
      );

    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    await this.sendMessage({ embeds: [embed] });
  }

  async connect(voiceChannel) {
    if (
      this.connection &&
      this.voiceChannelId === voiceChannel.id &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      return;
    }

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true
    });

    connection.subscribe(this.player);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      connection.destroy();
      throw new Error("I could not join that voice channel.");
    }

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        this.leave();
      }
    });

    this.connection = connection;
    this.voiceChannelId = voiceChannel.id;
  }

  async enqueue(track) {
    this.queue.push(track);
    if (!this.currentTrack) {
      await this.playNext();
    }
  }

  async enqueueMany(tracks) {
    this.queue.push(...tracks);
    if (!this.currentTrack) {
      await this.playNext();
    }
  }

  async playNext() {
    this.cancelIdleTimer();

    if (!this.queue.length) {
      this.currentTrack = null;
      this.trackStartedAt = 0;
      this.scheduleIdleDisconnect();
      return;
    }

    const next = this.queue.shift();
    this.currentTrack = next;

    let streamInfo;
    try {
      streamInfo = await play.stream(next.url, { discordPlayerCompatibility: true });
    } catch (error) {
      console.error(`[${this.guildId}] stream creation failed`, error);
      await this.sendMessage(`Failed to stream **${next.title}**, skipping.`);
      this.currentTrack = null;
      return this.playNext();
    }

    const resource = createAudioResource(streamInfo.stream, {
      inputType: streamInfo.type,
      inlineVolume: true
    });

    if (resource.volume) {
      resource.volume.setVolume(this.volume / 100);
    }

    this.player.play(resource);
    this.trackStartedAt = Date.now();
    await this.sendNowPlaying(next);
  }

  async handleTrackEnd(fromError) {
    if (this.currentTrack && !fromError) {
      if (this.loopMode === "song") {
        this.queue.unshift(this.currentTrack);
      } else if (this.loopMode === "queue") {
        this.queue.push(this.currentTrack);
      }
    }
    this.currentTrack = null;
    this.trackStartedAt = 0;
    await this.playNext();
  }

  pause() {
    return this.player.pause();
  }

  resume() {
    return this.player.unpause();
  }

  skip() {
    if (!this.currentTrack) return false;
    return this.player.stop();
  }

  stop() {
    this.queue = [];
    this.currentTrack = null;
    this.trackStartedAt = 0;
    this.player.stop();
    this.scheduleIdleDisconnect();
  }

  clearQueue() {
    this.queue = [];
  }

  removeAt(index) {
    if (index < 1 || index > this.queue.length) return null;
    const removed = this.queue.splice(index - 1, 1);
    return removed[0] || null;
  }

  leave() {
    this.queue = [];
    this.currentTrack = null;
    this.trackStartedAt = 0;
    this.cancelIdleTimer();
    this.player.stop();
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    this.voiceChannelId = null;
    if (typeof this.onDestroy === "function") {
      this.onDestroy(this.guildId);
    }
  }

  setVolume(value) {
    this.volume = value;
    const activeResource = this.player.state.resource;
    if (activeResource?.volume) {
      activeResource.volume.setVolume(value / 100);
    }
  }

  setLoopMode(mode) {
    this.loopMode = mode;
  }

  getQueueLines(limit = 10) {
    return this.queue.slice(0, limit).map((track, idx) => {
      return `${idx + 1}. ${track.title} (${formatDuration(track.durationSec)})`;
    });
  }

  getNowPlayingProgress() {
    if (!this.currentTrack) return null;
    const total = this.currentTrack.durationSec;
    const elapsed = this.trackStartedAt
      ? Math.floor((Date.now() - this.trackStartedAt) / 1000)
      : 0;
    return {
      elapsed,
      total,
      bar: buildProgressBar(elapsed, total)
    };
  }

  scheduleIdleDisconnect() {
    if (this.disconnectTimer || !this.connection) return;
    this.disconnectTimer = setTimeout(() => {
      if (this.currentTrack || this.queue.length > 0) return;
      this.sendMessage("Queue is empty. Leaving voice channel after idle timeout.").catch(
        () => {}
      );
      this.leave();
    }, IDLE_DISCONNECT_MS);
  }

  cancelIdleTimer() {
    if (!this.disconnectTimer) return;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }
}

function getSession(guildId) {
  let session = sessions.get(guildId);
  if (!session) {
    session = new GuildMusicSession(guildId, id => sessions.delete(id));
    sessions.set(guildId, session);
  }
  return session;
}

function getExistingSession(guildId) {
  return sessions.get(guildId) || null;
}

function getMemberVoiceChannel(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    throw new Error("Join a voice channel first.");
  }
  if (!voiceChannel.joinable || !voiceChannel.speakable) {
    throw new Error("I need Connect + Speak permissions in your voice channel.");
  }
  return voiceChannel;
}

function ensureSameVoiceChannel(interaction, session) {
  const memberChannelId = interaction.member?.voice?.channelId;
  if (!memberChannelId) {
    throw new Error("Join the bot voice channel first.");
  }
  if (session.voiceChannelId && memberChannelId !== session.voiceChannelId) {
    throw new Error("You must be in the same voice channel as the bot.");
  }
}

async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commandData
    });
    return "guild";
  }
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandData });
  return "global";
}

client.once("ready", async () => {
  console.log(`Music bot ready as ${client.user.tag}`);

  if (!AUTO_REGISTER_COMMANDS) {
    console.log("AUTO_REGISTER_COMMANDS=false, skipping command registration.");
    return;
  }

  try {
    const mode = await registerSlashCommands();
    if (mode === "guild") {
      console.log(`Slash commands registered for guild ${GUILD_ID}`);
    } else {
      console.log("Slash commands registered globally (can take up to 1 hour to appear).");
    }
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    return interaction.reply({
      content: "This bot only works inside servers.",
      ephemeral: true
    });
  }

  try {
    const { commandName } = interaction;

    if (commandName === "join") {
      const voiceChannel = getMemberVoiceChannel(interaction);
      const session = getSession(interaction.guild.id);
      session.setTextChannel(interaction.channel);
      await session.connect(voiceChannel);
      return interaction.reply(`Joined **${voiceChannel.name}**.`);
    }

    if (commandName === "play") {
      await interaction.deferReply();
      const query = interaction.options.getString("query", true);
      const voiceChannel = getMemberVoiceChannel(interaction);
      const session = getSession(interaction.guild.id);
      session.setTextChannel(interaction.channel);
      await session.connect(voiceChannel);

      const tracks = await resolveTracks(query, interaction.user);
      await session.enqueueMany(tracks);

      if (tracks.length === 1) {
        return interaction.editReply(
          `Queued: **${tracks[0].title}** (${formatDuration(tracks[0].durationSec)}).`
        );
      }

      return interaction.editReply(
        `Queued **${tracks.length}** tracks from playlist.`
      );
    }

    if (commandName === "leave") {
      const session = getExistingSession(interaction.guild.id);
      if (!session) {
        return interaction.reply("I am not connected.");
      }
      ensureSameVoiceChannel(interaction, session);
      session.leave();
      return interaction.reply("Disconnected and cleared queue.");
    }

    const session = getExistingSession(interaction.guild.id);
    if (!session) {
      return interaction.reply("No active music session. Use `/play` first.");
    }

    ensureSameVoiceChannel(interaction, session);
    session.setTextChannel(interaction.channel);

    if (commandName === "skip") {
      const ok = session.skip();
      return interaction.reply(ok ? "Skipped." : "Nothing is playing.");
    }

    if (commandName === "pause") {
      const ok = session.pause();
      return interaction.reply(ok ? "Paused." : "Nothing to pause.");
    }

    if (commandName === "resume") {
      const ok = session.resume();
      return interaction.reply(ok ? "Resumed." : "Nothing to resume.");
    }

    if (commandName === "stop") {
      session.stop();
      return interaction.reply("Stopped playback and cleared queue.");
    }

    if (commandName === "queue") {
      const now = session.currentTrack
        ? `**Now:** ${session.currentTrack.title} (${formatDuration(
            session.currentTrack.durationSec
          )})`
        : "**Now:** nothing";
      const lines = session.getQueueLines(10);
      const upNext = lines.length ? lines.join("\n") : "Queue is empty.";
      return interaction.reply(`${now}\n\n**Up next:**\n${upNext}`);
    }

    if (commandName === "nowplaying") {
      if (!session.currentTrack) {
        return interaction.reply("Nothing is playing right now.");
      }
      const progress = session.getNowPlayingProgress();
      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("Now Playing")
        .setDescription(`[${session.currentTrack.title}](${session.currentTrack.url})`)
        .addFields(
          {
            name: "Progress",
            value: `${progress.bar}\n${formatDuration(progress.elapsed)} / ${formatDuration(
              progress.total
            )}`
          },
          { name: "Loop", value: session.loopMode, inline: true },
          { name: "Volume", value: `${session.volume}%`, inline: true }
        );
      if (session.currentTrack.thumbnail) {
        embed.setThumbnail(session.currentTrack.thumbnail);
      }
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === "volume") {
      const value = interaction.options.getInteger("value", true);
      session.setVolume(value);
      return interaction.reply(`Volume set to **${value}%**.`);
    }

    if (commandName === "loop") {
      const mode = interaction.options.getString("mode", true);
      session.setLoopMode(mode);
      return interaction.reply(`Loop mode set to **${mode}**.`);
    }

    if (commandName === "remove") {
      const index = interaction.options.getInteger("index", true);
      const removed = session.removeAt(index);
      if (!removed) {
        return interaction.reply("Invalid queue index.");
      }
      return interaction.reply(`Removed **${removed.title}** from queue.`);
    }

    if (commandName === "clear") {
      session.clearQueue();
      return interaction.reply("Queue cleared.");
    }
  } catch (error) {
    console.error("Command error:", error);
    const payload = {
      content: error.message || "Unexpected error while executing command.",
      ephemeral: true
    };
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload).catch(() => {});
    }
    return interaction.reply(payload).catch(() => {});
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  if (!client.user) return;
  if (oldState.id !== client.user.id) return;
  if (oldState.channelId && !newState.channelId) {
    const session = getExistingSession(oldState.guild.id);
    if (session) {
      session.leave();
    }
  }
});

process.on("SIGINT", () => {
  for (const session of sessions.values()) {
    session.leave();
  }
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  for (const session of sessions.values()) {
    session.leave();
  }
  client.destroy();
  process.exit(0);
});

client.login(TOKEN);
