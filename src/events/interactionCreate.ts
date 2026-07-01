import { Client } from 'discord.js';
import db from '../database/sqlite';
import { checkCooldown } from '../utils/cooldown';
import { handleWerewolfComponentInteraction } from '../services/werewolf/game';
import type { Command } from '../types';

const AI_COOLDOWN_COMMANDS = new Set(['analyze', 'draw']);
const COOLDOWN_REPLY = 'Tunggu sebentar. Aku masih ngerjain permintaanmu yang tadi, dan sayangnya aku belum bisa clone diri.';
const COMMAND_ERROR_REPLY = 'Yah, perintah itu gagal diproses barusan. Agak nyebelin, iya. Coba lagi ya.';

function isUnknownInteractionError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: number }).code === 10062;
}

function isAlreadyAcknowledgedError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: number }).code === 40060;
}

async function safeInteractionErrorReply(interaction: {
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: { content: string; ephemeral: boolean }) => Promise<unknown>;
  editReply?: (payload: { content: string }) => Promise<unknown>;
  followUp?: (payload: { content: string; ephemeral: boolean }) => Promise<unknown>;
}): Promise<void> {
  console.error(
    `[InteractionCreate] fallback reply state deferred=${interaction.deferred === true} replied=${interaction.replied === true}`,
  );
  try {
    if (interaction.deferred && interaction.editReply) {
      console.error('[InteractionCreate] sending fallback via editReply');
      await interaction.editReply({ content: COMMAND_ERROR_REPLY });
      return;
    }
    if (interaction.replied && interaction.followUp) {
      console.error('[InteractionCreate] sending fallback via followUp');
      await interaction.followUp({ content: COMMAND_ERROR_REPLY, ephemeral: true });
      return;
    }
    if (interaction.reply) {
      console.error('[InteractionCreate] sending fallback via reply');
      try {
        await interaction.reply({ content: COMMAND_ERROR_REPLY, ephemeral: true });
      } catch (replyError) {
        if (isAlreadyAcknowledgedError(replyError) && interaction.editReply) {
          console.error('[InteractionCreate] reply was already acknowledged, retrying fallback via editReply');
          await interaction.editReply({ content: COMMAND_ERROR_REPLY });
          return;
        }
        throw replyError;
      }
    }
  } catch (replyError) {
    console.error('[InteractionCreate] failed to send error reply:', replyError);
  }
}

export function registerInteractionCreate(client: Client, allCommands: Command[]): void {
  client.on('interactionCreate', async (interaction) => {
    const isButtonInteraction = typeof interaction.isButton === 'function' && interaction.isButton();
    const isStringSelectInteraction =
      typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu();

    if (isButtonInteraction || isStringSelectInteraction) {
      try {
        const handled = await handleWerewolfComponentInteraction(interaction, db);
        if (handled) return;
      } catch (error) {
        console.error('[InteractionCreate] component failed:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: COMMAND_ERROR_REPLY, ephemeral: true }).catch(() => undefined);
        }
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const interactionAgeMs = Date.now() - interaction.createdTimestamp;
    const interactionMeta = `user=${interaction.user.id} guild=${interaction.guildId ?? 'dm'} channel=${interaction.channelId ?? 'unknown'} ageMs=${interactionAgeMs} pid=${process.pid}`;

    try {
      const cmd = allCommands.find((c) => c.data.name === interaction.commandName);
      if (!cmd) return;
      if (AI_COOLDOWN_COMMANDS.has(interaction.commandName) && checkCooldown(interaction.user.id)) {
        await interaction.reply({ content: COOLDOWN_REPLY, ephemeral: true });
        return;
      }
      if (AI_COOLDOWN_COMMANDS.has(interaction.commandName) && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }
      await cmd.execute(interaction, { db });
    } catch (error) {
      console.error(
        `[InteractionCreate] command failed: ${interaction.commandName} deferred=${interaction.deferred === true} replied=${interaction.replied === true} ${interactionMeta}`,
        error,
      );
      if (isUnknownInteractionError(error)) {
        console.error(`[InteractionCreate] interaction expired before a response could be sent ${interactionMeta}`);
        return;
      }
      await safeInteractionErrorReply(interaction);
    }
  });
}
