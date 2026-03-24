const { SlashCommandBuilder } = require("discord.js");

const commandData = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your current voice channel."),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist from YouTube.")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("Song name, YouTube URL, or playlist URL")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song."),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause playback."),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume playback."),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue."),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Disconnect the bot from voice."),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current queue."),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the currently playing song."),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume (1-200).")
    .addIntegerOption(option =>
      option
        .setName("value")
        .setDescription("Volume percent from 1 to 200")
        .setMinValue(1)
        .setMaxValue(200)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode.")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "song", value: "song" },
          { name: "queue", value: "queue" }
        )
    ),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove one song from queue by position.")
    .addIntegerOption(option =>
      option
        .setName("index")
        .setDescription("Queue index, starting from 1")
        .setMinValue(1)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear queued songs (keeps current song).")
].map(command => command.toJSON());

module.exports = { commandData };
