const { SlashCommandBuilder } = require("discord.js");

const commandData = [
  new SlashCommandBuilder().setName("join").setDescription("Join your current voice channel."),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or YouTube URL")
    .addStringOption(o => o.setName("query").setDescription("Song name or URL").setRequired(true)),
  new SlashCommandBuilder().setName("skip").setDescription("Skip current song"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop and clear queue"),
  new SlashCommandBuilder().setName("leave").setDescription("Disconnect bot"),
  new SlashCommandBuilder().setName("queue").setDescription("Show queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show current song")
].map(c => c.toJSON());

module.exports = { commandData };
