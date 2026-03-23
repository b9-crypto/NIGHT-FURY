const {
Client,
GatewayIntentBits,
ChannelType,
PermissionsBitField,
ActionRowBuilder,
StringSelectMenuBuilder,
EmbedBuilder
} = require("discord.js");

const fs = require("fs");
try {
require("dotenv").config();
} catch (error) {
if (error?.code !== "MODULE_NOT_FOUND") {
console.warn("dotenv load warning:", error);
}
}

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildVoiceStates,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
]
});

const PREFIX = ".v";

function requireEnv(name) {
const value = process.env[name];
if (!value) {
throw new Error(`Missing required environment variable: ${name}`);
}
return value;
}

const TOKEN = requireEnv("TOKEN");
const CREATE_CHANNEL_ID = requireEnv("CREATE_CHANNEL_ID");
const CATEGORY_ID = requireEnv("CATEGORY_ID");

const DATA_FILE = "./vcdata.json";

const HELP_ITEMS = [
{ icon: ":pencil2:", cmd: "name <new name>", desc: "changes the name of the VC" },
{ icon: ":busts_in_silhouette:", cmd: "limit <number>", desc: "sets the limit of the VC" },
{ icon: ":lock:", cmd: "lock", desc: "locks the VC" },
{ icon: ":unlock:", cmd: "unlock", desc: "unlocks the VC" },
{ icon: ":shield:", cmd: "permit @user", desc: "allow a user to join the VC" },
{ icon: ":shield:", cmd: "permall", desc: "allow current members to join later" },
{ icon: ":shield:", cmd: "permitall", desc: "allow current members to join later" },
{ icon: ":shield:", cmd: "rpermit @role", desc: "allow a role to join the VC" },
{ icon: ":no_entry:", cmd: "reject @user", desc: "remove a user's join permission" },
{ icon: ":see_no_evil:", cmd: "hide", desc: "hides the VC" },
{ icon: ":eyes:", cmd: "unhide", desc: "unhides the VC" },
{ icon: ":microphone2:", cmd: "mute @user", desc: "server-mute a user in VC" },
{ icon: ":microphone:", cmd: "unmute @user", desc: "remove server mute from user" },
{ icon: ":headphones:", cmd: "deaf @user", desc: "server-deafen a user in VC" },
{ icon: ":speaker:", cmd: "undeaf @user", desc: "remove server deafen from user" },
{ icon: ":boot:", cmd: "kick @user", desc: "kick user from VC" },
{ icon: ":crown:", cmd: "owner", desc: "shows the owner of the VC" },
{ icon: ":twisted_rightwards_arrows:", cmd: "transfer @user", desc: "transfer VC ownership" },
{ icon: ":handshake:", cmd: "claim", desc: "claim the VC if owner left" },
{ icon: ":musical_note:", cmd: "soundboard", desc: "toggle soundboard usage" },
{ icon: ":tools:", cmd: "reset", desc: "reset channel permissions" },
{ icon: ":bell:", cmd: "status <text>", desc: "set a status for your VC" },
{ icon: ":speech_balloon:", cmd: "slowmode <seconds>", desc: "set text channel slowmode" },
{ icon: ":loud_sound:", cmd: "bitrate <number>", desc: "set channel bitrate" },
{ icon: ":satellite:", cmd: "region <auto|value>", desc: "set voice region" },
{ icon: ":truck:", cmd: "move @user", desc: "move user to your VC" },
{ icon: ":envelope_with_arrow:", cmd: "invite", desc: "create VC invite link" },
{ icon: ":signal_strength:", cmd: "ping", desc: "show bot latency" },
{ icon: ":mute:", cmd: "tmute @user", desc: "mute user in text channel" },
{ icon: ":speaker:", cmd: "tunmute @user", desc: "unmute user in text channel" },
{ icon: ":lock:", cmd: "tlock", desc: "lock text channel" },
{ icon: ":unlock:", cmd: "tunlock", desc: "unlock text channel" },
{ icon: ":no_entry_sign:", cmd: "bl add/remove/clear/list", desc: "manage blacklist" },
{ icon: ":white_check_mark:", cmd: "wl add/remove/clear/list", desc: "manage whitelist" },
{ icon: ":information_source:", cmd: "info / stats", desc: "show VC information" },
{ icon: ":wastebasket:", cmd: "delete", desc: "delete your VC" },
{ icon: ":control_knobs:", cmd: "panel", desc: "show the dropdown control panel" },
{ icon: ":question:", cmd: "show / help", desc: "show this command list" }
];

/* ============================ */
/* PERSISTENT STORAGE */
/* ============================ */

let data = { channels: {} };

if (fs.existsSync(DATA_FILE)) {
try {
data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (error) {
console.error("Failed to read vcdata.json, using empty storage.", error);
}
}

if (!data.channels) {
data.channels = {};
}

for (const id of Object.keys(data.channels)) {
const entry = data.channels[id] || {};
entry.blacklist = Array.isArray(entry.blacklist) ? entry.blacklist : [];
entry.whitelist = Array.isArray(entry.whitelist) ? entry.whitelist : [];
entry.status = typeof entry.status === "string" ? entry.status : "";
entry.soundboard = Boolean(entry.soundboard);
data.channels[id] = entry;
}

function save() {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getBaseOverwrites(guild, ownerId) {
return [
{
id: guild.roles.everyone.id,
allow: [
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.Connect
],
deny: []
},
{
id: ownerId,
allow: [
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.Connect,
PermissionsBitField.Flags.Speak,
PermissionsBitField.Flags.ManageChannels
]
}
];
}

async function resetChannelPermissions(channel, ownerId) {
await channel.permissionOverwrites.set(
getBaseOverwrites(channel.guild, ownerId)
);
}

function normalizeId(value) {
return value?.replace(/[<@#&!>]/g, "")?.trim();
}

function getTextChannelFromMessage(message) {
if (!message.channel || !message.guild) return null;
if (message.channel.isThread && message.channel.isThread()) {
return message.channel.parent;
}
return message.channel;
}

function resolveManagedVcFromMessage(message) {
if (!message.guild) return null;

const member = message.member;
const voiceChannel = member?.voice?.channel || null;
if (voiceChannel && data.channels[voiceChannel.id]) {
return { channel: voiceChannel, vcData: data.channels[voiceChannel.id] };
}

const channel = message.channel;
if (channel && data.channels[channel.id]) {
return { channel, vcData: data.channels[channel.id] };
}

return null;
}

async function safeSendHelp(channel) {
try {
await sendHelp(channel);
} catch (error) {
const text = HELP_ITEMS.map(item => `| .v ${item.cmd} : ${item.desc}`).join("\n");
channel.send(`Commands:\n${text}`).catch(()=>{});
}
}

async function resolveTargetMember(message, rawArg) {
const mentioned = message.mentions.members.first();
if (mentioned) return mentioned;
const id = normalizeId(rawArg);
if (!id) return null;
try {
return await message.guild.members.fetch(id);
} catch {
return null;
}
}

/* ============================ */
/* READY */
/* ============================ */

client.once("ready", () => {
console.log(`Bot ready: ${client.user.tag}`);
});

/* ============================ */
/* CREATE TEMP VC */
/* ============================ */

client.on("voiceStateUpdate", async (oldState, newState) => {

if (!newState.channel) return;

if (newState.channel.id !== CREATE_CHANNEL_ID) return;

const member = newState.member;

const vc = await newState.guild.channels.create({
name: `${member.user.username}'s Room`,
type: ChannelType.GuildVoice,
parent: CATEGORY_ID
});

await vc.permissionOverwrites.set([
getBaseOverwrites(newState.guild, member.id)[0],
getBaseOverwrites(newState.guild, member.id)[1]
]);

data.channels[vc.id] = {
owner: member.id,
blacklist: [],
whitelist: [],
status: "",
soundboard: false
};

save();

await member.voice.setChannel(vc);

// Send the UI automatically when the room is created.
await safeSendHelp(vc);
await sendPanel(vc);

});

/* ============================ */
/* DELETE EMPTY VC */
/* ============================ */

client.on("voiceStateUpdate", async (oldState) => {

const ch = oldState.channel;

if (!ch) return;

if (!data.channels[ch.id]) return;

if (ch.members.size === 0) {

delete data.channels[ch.id];
save();

ch.delete().catch(()=>{});

}

});

/* ============================ */
/* ENFORCE BLACKLIST/WHITELIST */
/* ============================ */

client.on("voiceStateUpdate", async (oldState, newState) => {
if (!newState.channel) return;

const vcData = data.channels[newState.channel.id];
if (!vcData) return;

const member = newState.member;
if (!member) return;

if (vcData.owner === member.id) return;

const isBlacklisted = vcData.blacklist.includes(member.id);
const hasWhitelist = vcData.whitelist.length > 0;
const isWhitelisted = vcData.whitelist.includes(member.id);

if (isBlacklisted || (hasWhitelist && !isWhitelisted)) {
newState.setChannel(null).catch(()=>{});
}
});

/* ============================ */
/* DROPDOWN PANEL */
/* ============================ */

async function sendPanel(channel) {

const embed = new EmbedBuilder()
.setTitle("Voice Control Panel")
.setDescription("Use the dropdown below to control your voice channel.")
.setColor(0x2b2d31);

const menu = new StringSelectMenuBuilder()
.setCustomId("vc_panel")
.setPlaceholder("Select action")
.addOptions([
{label:"Lock VC", value:"lock"},
{label:"Unlock VC", value:"unlock"},
{label:"Hide VC", value:"hide"},
{label:"Unhide VC", value:"unhide"},
{label:"Claim VC", value:"claim"},
{label:"Reset VC", value:"reset"}
]);

const row = new ActionRowBuilder().addComponents(menu);

channel.send({embeds:[embed],components:[row]});

}

async function sendHelp(channel) {
const embed = new EmbedBuilder()
.setTitle("Voice Channel Commands")
.setDescription("Need help managing your voice channel? Use the commands below to customize, control, and secure your VC with ease.")
.setColor(0x2b2d31)
.addFields([
{
name: "Commands",
value: HELP_ITEMS.map(item => `${item.icon}  **| .v ${item.cmd}** : ${item.desc}`).join("\n")
}
])
.setFooter({ text: "Prefix: .v" });

await channel.send({ embeds: [embed] });
}

/* ============================ */
/* CLAIM ANIMATION */
/* ============================ */

async function claimAnimation(message) {

let seconds = 2;

const msg = await message.reply(`Claiming in ${seconds}...`);

return new Promise(resolve => {
const interval = setInterval(async () => {

seconds--;

if (seconds === 0) {

clearInterval(interval);

await msg.edit("You are now the owner.");

resolve();

return;

}

await msg.edit(`Claiming in ${seconds}...`);

},1000);
});

}

/* ============================ */
/* COMMAND SYSTEM */
/* ============================ */

client.on("messageCreate", async message => {

if (message.author.bot) return;

if (!message.content.startsWith(PREFIX)) return;

const args = message.content.slice(PREFIX.length).trim().split(/ +/);
const cmd = args.shift()?.toLowerCase();

if (!message.guild || !message.member) return;

const context = resolveManagedVcFromMessage(message);
if (!context) {
return message.reply("Join your VC first.");
}

const member = message.member;
const channel = context.channel;
const vcData = context.vcData;

if (message.channel.id !== channel.id) {
return message.reply("Use commands inside your room chat only.");
}

if (cmd === "show" || cmd === "help") {
await safeSendHelp(message.channel);
return;
}

const owner = vcData.owner;

const publicCommands = ["show","help","info","stats","owner"];

if (!publicCommands.includes(cmd) && cmd !== "claim" && member.id !== owner)
return message.reply("Only the owner can use this.");

const target = await resolveTargetMember(message, args[0]);

/* ===== NAME ===== */

if (cmd === "name") {

const name = args.join(" ");

if (!name) return message.reply("Usage: .v name <new name>");

await channel.setName(name);
return message.reply(`VC renamed to: ${name}`);

}

/* ===== LIMIT ===== */

if (cmd === "limit") {

const n = parseInt(args[0], 10);

if (Number.isNaN(n) || n < 0 || n > 99) {
return message.reply("Usage: .v limit <0-99>");
}

await channel.setUserLimit(n);
return message.reply(`User limit set to ${n}.`);

}

/* ===== PERMIT ===== */

if (cmd === "permit") {

if (!target) return message.reply("Mention a user to permit.");

vcData.blacklist = vcData.blacklist.filter(id => id !== target.id);
vcData.whitelist = Array.from(new Set([...vcData.whitelist, target.id]));
save();

await channel.permissionOverwrites.edit(target.id,{
Connect:true,
ViewChannel:true
});

return message.reply(`Permitted <@${target.id}>.`);

}

/* ===== PERMALL ===== */

if (cmd === "permall" || cmd === "permitall") {

const ids = channel.members.map(m => m.id);
vcData.whitelist = Array.from(new Set([...vcData.whitelist, ...ids]));
save();

for (const id of ids) {
await channel.permissionOverwrites.edit(id,{
Connect:true,
ViewChannel:true
}).catch(()=>{});
}

return message.reply("Permitted all current members.");

}

/* ===== ROLE PERMIT ===== */

if (cmd === "rpermit") {

const roleId = normalizeId(args[0]);
const role = roleId ? message.guild.roles.cache.get(roleId) : null;
if (!role) return message.reply("Mention a role to permit.");

await channel.permissionOverwrites.edit(role.id,{
Connect:true,
ViewChannel:true
});

return message.reply(`Permitted role <@&${role.id}>.`);

}

/* ===== REJECT ===== */

if (cmd === "reject") {

if (!target) return message.reply("Mention a user to reject.");

vcData.whitelist = vcData.whitelist.filter(id => id !== target.id);
vcData.blacklist = Array.from(new Set([...vcData.blacklist, target.id]));
save();

await channel.permissionOverwrites.edit(target.id,{
Connect:false
});

if (channel.members.has(target.id)) {
target.voice.setChannel(null).catch(()=>{});
}

return message.reply(`Rejected <@${target.id}>.`);

}

/* ===== LOCK ===== */

if (cmd === "lock") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
Connect:false
});

return message.reply("VC locked.");

}

/* ===== UNLOCK ===== */

if (cmd === "unlock") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
Connect:true
});

return message.reply("VC unlocked.");

}

/* ===== SOUNDBOARD ===== */

if (cmd === "soundboard") {

const everyoneId = channel.guild.roles.everyone.id;
const current = vcData.soundboard === true;
const next = !current;

vcData.soundboard = next;
save();

await channel.permissionOverwrites.edit(everyoneId,{
UseSoundboard: next,
UseExternalSounds: next
});

return message.reply(`Soundboard ${next ? "enabled" : "disabled"}.`);

}

/* ===== HIDE ===== */

if (cmd === "hide") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
ViewChannel:false
});

return message.reply("VC hidden.");

}

/* ===== UNHIDE ===== */

if (cmd === "unhide") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
ViewChannel:true
});

return message.reply("VC visible again.");

}

/* ===== MUTE ===== */

if (cmd === "mute") {

if (!target) return message.reply("Mention a user to mute.");
if (target.id === member.id) return message.reply("You cannot mute yourself.");
if (target.voice.channelId !== channel.id) {
return message.reply("Target user must be inside your VC.");
}

await target.voice.setMute(true).catch(()=>{});
return message.reply(`Muted <@${target.id}>.`);

}

if (cmd === "unmute") {

if (!target) return message.reply("Mention a user to unmute.");
if (target.voice.channelId !== channel.id) {
return message.reply("Target user must be inside your VC.");
}

await target.voice.setMute(false).catch(()=>{});
return message.reply(`Unmuted <@${target.id}>.`);

}

/* ===== DEAF ===== */

if (cmd === "deaf") {

if (!target) return message.reply("Mention a user to deafen.");
if (target.id === member.id) return message.reply("You cannot deafen yourself.");
if (target.voice.channelId !== channel.id) {
return message.reply("Target user must be inside your VC.");
}

await target.voice.setDeaf(true).catch(()=>{});
return message.reply(`Deafened <@${target.id}>.`);

}

if (cmd === "undeaf") {

if (!target) return message.reply("Mention a user to undeafen.");
if (target.voice.channelId !== channel.id) {
return message.reply("Target user must be inside your VC.");
}

await target.voice.setDeaf(false).catch(()=>{});
return message.reply(`Undeafened <@${target.id}>.`);

}

/* ===== KICK ===== */

if (cmd === "kick") {

if (!target) return message.reply("Mention a user to kick.");
if (target.id === member.id) return message.reply("You cannot kick yourself.");
if (target.voice.channelId !== channel.id) {
return message.reply("Target user must be inside your VC.");
}

await target.voice.disconnect().catch(()=>{});
return message.reply(`Kicked <@${target.id}> from VC.`);

}

/* ===== CLAIM ===== */

if (cmd === "claim") {

if (channel.members.has(owner))
return message.reply("Owner still inside.");

await claimAnimation(message);

vcData.owner = member.id;

await channel.permissionOverwrites.edit(member.id,{
ViewChannel:true,
Connect:true,
Speak:true,
ManageChannels:true
});

save();

return;

}

/* ===== TRANSFER ===== */

if (cmd === "transfer") {

if (!target) return;

vcData.owner = target.id;

await channel.permissionOverwrites.edit(target.id,{
ViewChannel:true,
Connect:true,
Speak:true,
ManageChannels:true
});

save();

return message.reply(`Ownership transferred to <@${target.id}>.`);

}

/* ===== OWNER ===== */

if (cmd === "owner") {

message.reply(`<@${owner}>`);

return;

}

/* ===== RESET ===== */

if (cmd === "reset") {

await resetChannelPermissions(channel, vcData.owner);
vcData.blacklist = [];
vcData.whitelist = [];
vcData.status = "";
vcData.soundboard = false;
save();

return message.reply("Voice channel permissions have been reset.");

}

/* ===== STATUS ===== */

if (cmd === "status") {

const text = args.join(" ");

vcData.status = text;

save();

return message.reply(`Status updated to: ${text || "none"}`);

}

/* ===== SLOWMODE ===== */

if (cmd === "slowmode") {

const seconds = parseInt(args[0], 10);
if (Number.isNaN(seconds) || seconds < 0) return message.reply("Provide slowmode seconds.");

const textChannel = getTextChannelFromMessage(message);
if (!textChannel || !textChannel.setRateLimitPerUser) {
return message.reply("This command must be used in a text channel.");
}

await textChannel.setRateLimitPerUser(seconds);
return message.reply(`Slowmode set to ${seconds}s.`);

}

/* ===== BITRATE ===== */

if (cmd === "bitrate") {

const b = parseInt(args[0], 10);

if (Number.isNaN(b) || b < 8000) {
return message.reply("Usage: .v bitrate <number>");
}

await channel.setBitrate(b);
return message.reply(`Bitrate set to ${b}.`);

}

/* ===== REGION ===== */

if (cmd === "region") {

const raw = args[0];
if (!raw) return message.reply("Usage: .v region <auto|region-id>");

const regionValue = raw.toLowerCase() === "auto" ? null : raw;
await channel.setRTCRegion(regionValue).catch(()=>{});

return message.reply(`Region set to ${regionValue || "auto"}.`);

}

/* ===== MOVE ===== */

if (cmd === "move") {

if (!target) return message.reply("Mention a user to move.");
if (!target.voice.channel) return message.reply("Target user is not in any VC.");

await target.voice.setChannel(channel).catch(()=>{});
return message.reply(`Moved <@${target.id}> to your VC.`);

}

/* ===== INVITE ===== */

if (cmd === "invite") {

const invite = await channel.createInvite({
maxAge: 0,
maxUses: 0,
unique: true
}).catch(()=>null);

if (!invite) return message.reply("I could not create an invite.");
return message.reply(`Invite link: ${invite.url}`);

}

/* ===== PING ===== */

if (cmd === "ping") {
return message.reply(`Pong: ${Math.round(client.ws.ping)}ms`);
}

/* ===== TEXT MUTE ===== */

if (cmd === "tmute") {

if (!target) return message.reply("Mention a user to mute in text.");
const textChannel = getTextChannelFromMessage(message);
if (!textChannel || !textChannel.permissionOverwrites) {
return message.reply("This command must be used in a text channel.");
}

await textChannel.permissionOverwrites.edit(target.id,{
SendMessages:false
});

return message.reply(`Text-muted <@${target.id}>.`);

}

if (cmd === "tunmute") {

if (!target) return message.reply("Mention a user to unmute in text.");
const textChannel = getTextChannelFromMessage(message);
if (!textChannel || !textChannel.permissionOverwrites) {
return message.reply("This command must be used in a text channel.");
}

await textChannel.permissionOverwrites.edit(target.id,{
SendMessages:true
});

return message.reply(`Text-unmuted <@${target.id}>.`);

}

/* ===== TEXT LOCK ===== */

if (cmd === "tlock") {

const textChannel = getTextChannelFromMessage(message);
if (!textChannel || !textChannel.permissionOverwrites) {
return message.reply("This command must be used in a text channel.");
}

await textChannel.permissionOverwrites.edit(message.guild.roles.everyone,{
SendMessages:false
});

return message.reply("Text channel locked.");

}

if (cmd === "tunlock") {

const textChannel = getTextChannelFromMessage(message);
if (!textChannel || !textChannel.permissionOverwrites) {
return message.reply("This command must be used in a text channel.");
}

await textChannel.permissionOverwrites.edit(message.guild.roles.everyone,{
SendMessages:true
});

return message.reply("Text channel unlocked.");

}

/* ===== INFO ===== */

if (cmd === "info" || cmd === "stats") {

message.reply(`
Owner: <@${owner}>
Members: ${channel.members.size}
Limit: ${channel.userLimit}
Bitrate: ${channel.bitrate}
Status: ${vcData.status || "none"}
Soundboard: ${vcData.soundboard ? "on" : "off"}
Blacklist: ${vcData.blacklist.length}
Whitelist: ${vcData.whitelist.length}
`);

return;

}

/* ===== BLACKLIST ===== */

if (cmd === "bl") {

const sub = (args.shift() || "").toLowerCase();
const id = normalizeId(args[0]);

if (sub === "add") {
if (!id) return message.reply("Provide a user ID or mention.");
vcData.blacklist = Array.from(new Set([...vcData.blacklist, id]));
vcData.whitelist = vcData.whitelist.filter(item => item !== id);
save();
return message.reply(`Blacklisted <@${id}>.`);
}

if (sub === "remove") {
if (!id) return message.reply("Provide a user ID or mention.");
vcData.blacklist = vcData.blacklist.filter(item => item !== id);
save();
return message.reply(`Removed <@${id}> from blacklist.`);
}

if (sub === "clear") {
vcData.blacklist = [];
save();
return message.reply("Blacklist cleared.");
}

if (sub === "list") {
const list = vcData.blacklist.map(idItem => `<@${idItem}>`).join(", ");
return message.reply(list ? `Blacklisted: ${list}` : "Blacklist is empty.");
}

return message.reply("Usage: .v bl add/remove/clear/list");

}

/* ===== WHITELIST ===== */

if (cmd === "wl") {

const sub = (args.shift() || "").toLowerCase();
const id = normalizeId(args[0]);

if (sub === "add") {
if (!id) return message.reply("Provide a user ID or mention.");
vcData.whitelist = Array.from(new Set([...vcData.whitelist, id]));
vcData.blacklist = vcData.blacklist.filter(item => item !== id);
save();
return message.reply(`Whitelisted <@${id}>.`);
}

if (sub === "remove") {
if (!id) return message.reply("Provide a user ID or mention.");
vcData.whitelist = vcData.whitelist.filter(item => item !== id);
save();
return message.reply(`Removed <@${id}> from whitelist.`);
}

if (sub === "clear") {
vcData.whitelist = [];
save();
return message.reply("Whitelist cleared.");
}

if (sub === "list") {
const list = vcData.whitelist.map(idItem => `<@${idItem}>`).join(", ");
return message.reply(list ? `Whitelisted: ${list}` : "Whitelist is empty.");
}

return message.reply("Usage: .v wl add/remove/clear/list");

}

/* ===== DELETE ===== */

if (cmd === "delete") {

delete data.channels[channel.id];
save();

await channel.delete().catch(()=>{});

return;

}

/* ===== PANEL ===== */

if (cmd === "panel") {

await sendPanel(message.channel);

return;

}

});

/* ============================ */
/* DROPDOWN INTERACTION */
/* ============================ */

client.on("interactionCreate", async interaction => {

if (!interaction.isStringSelectMenu()) return;

if (interaction.customId !== "vc_panel") return;

const member = interaction.member;

const channel = member.voice.channel;

if (!channel) {
return interaction.reply({content:"Join your VC first.",ephemeral:true});
}

const vcData = data.channels[channel.id];

if (!vcData) {
return interaction.reply({content:"This is not a managed voice channel.",ephemeral:true});
}

const action = interaction.values[0];

if (action !== "claim" && member.id !== vcData.owner) {
return interaction.reply({content:"Only the owner can use this panel.",ephemeral:true});
}

if (action === "lock") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
Connect:false
});

}

if (action === "unlock") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
Connect:true
});

}

if (action === "hide") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
ViewChannel:false
});

}

if (action === "unhide") {

await channel.permissionOverwrites.edit(channel.guild.roles.everyone,{
ViewChannel:true
});

}

if (action === "claim") {

if (channel.members.has(vcData.owner)) {
return interaction.reply({content:"Owner still inside.",ephemeral:true});
}

await channel.permissionOverwrites.edit(member.id,{
ViewChannel:true,
Connect:true,
Speak:true,
ManageChannels:true
});

vcData.owner = member.id;
save();

return interaction.reply({content:"You are now the owner.",ephemeral:true});

}

if (action === "reset") {

await resetChannelPermissions(channel, vcData.owner);
vcData.blacklist = [];
vcData.whitelist = [];
vcData.status = "";
vcData.soundboard = false;
save();

}

interaction.reply({content:"Action executed.",ephemeral:true});

});

client.login(TOKEN);
