import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { Type } from '@google/genai';
import type { CommandContext } from '../types';
import ai from '../ai/gemini';
import triviaQuestions from '../../trivia_questions.json';

interface TriviaQuestion {
  kategori: string;
  soal: string;
  pilihan: [string, string, string, string];
  jawaban_benar: 'A' | 'B' | 'C' | 'D';
}

interface TriviaRuntimeDependencies {
  generateQuestion?: () => Promise<TriviaQuestion>;
  nowMs?: () => number;
  questionCount?: number;
}

const ROUND_TIMEOUT_MS = 15_000;
const DEFAULT_SESSION_QUESTION_COUNT = 5;
const CORRECT_ANSWER_POINTS = 10;
const WRONG_ANSWER_POINTS = -5;
const RECENT_QUESTION_LIMIT = 50;
const INTER_ROUND_READY_DELAY_MS = 4_000;

const ANSWER_KEYS = ['A', 'B', 'C', 'D'] as const;

type AnswerKey = (typeof ANSWER_KEYS)[number];
const activeTriviaChannels = new Set<string>();

const DEFAULT_FALLBACK_QUESTION: TriviaQuestion = {
  kategori: 'Umum',
  soal: 'Monumen Nasional (Monas) yang ikonik terletak di kota mana?',
  pilihan: ['A. Bandung', 'B. Surabaya', 'C. Yogyakarta', 'D. Jakarta'],
  jawaban_benar: 'D',
};

const TRIVIA_MODEL = 'gemini-1.5-flash';

const TRIVIA_SYSTEM_INSTRUCTION =
  'Generate a single, interesting general knowledge trivia question in Indonesian. Provide 4 multiple-choice options labeled A, B, C, and D. You must output the result strictly in this JSON format:\n{\n  "kategori": "Nama Kategori",\n  "soal": "Teks pertanyaan di sini?",\n  "pilihan": ["A. Pilihan satu", "B. Pilihan dua", "C. Pilihan tiga", "D. Pilihan empat"],\n  "jawaban_benar": "A" (Must be only \'A\', \'B\', \'C\', or \'D\')\n}';

export const data = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Mainkan sesi trivia cepat-cepatan (default 5 soal)');

function sanitizeJsonResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return withoutFence;
}

function parseTriviaQuestionObject(parsed: Record<string, unknown>): TriviaQuestion {
  const kategori = parsed.kategori;
  const soal = parsed.soal;
  const pilihan = parsed.pilihan;
  const jawabanBenar = parsed.jawaban_benar;

  if (typeof kategori !== 'string' || kategori.trim().length === 0) {
    throw new Error('Invalid trivia response: kategori');
  }
  if (typeof soal !== 'string' || soal.trim().length === 0) {
    throw new Error('Invalid trivia response: soal');
  }
  if (!isValidChoiceFormat(pilihan)) {
    throw new Error('Invalid trivia response: pilihan');
  }
  if (typeof jawabanBenar !== 'string' || !ANSWER_KEYS.includes(jawabanBenar as AnswerKey)) {
    throw new Error('Invalid trivia response: jawaban_benar');
  }

  return {
    kategori: kategori.trim(),
    soal: soal.trim(),
    pilihan,
    jawaban_benar: jawabanBenar as AnswerKey,
  };
}

function isValidChoiceFormat(choices: unknown): choices is [string, string, string, string] {
  if (!Array.isArray(choices) || choices.length !== 4) return false;
  return choices.every((choice, index) => {
    if (typeof choice !== 'string') return false;
    const label = ANSWER_KEYS[index];
    return choice.startsWith(`${label}. `);
  });
}

function parseTriviaQuestion(rawJson: string): TriviaQuestion {
  const parsed = JSON.parse(sanitizeJsonResponse(rawJson)) as Record<string, unknown>;
  return parseTriviaQuestionObject(parsed);
}

function localFallbackQuestions(): TriviaQuestion[] {
  const localRows = triviaQuestions as Array<Record<string, unknown>>;
  const validQuestions = localRows
    .map((row) => {
      try {
        return parseTriviaQuestionObject(row);
      } catch {
        return null;
      }
    })
    .filter((row): row is TriviaQuestion => row !== null);

  return validQuestions.length > 0 ? validQuestions : [DEFAULT_FALLBACK_QUESTION];
}

function pickFallbackQuestion(): TriviaQuestion {
  const candidates = localFallbackQuestions();
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index]!;
}

function questionKey(question: TriviaQuestion): string {
  return question.soal
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function ensureTriviaRecentQuestionTable(db: CommandContext['db']): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS trivia_recent_questions (
      guild_id TEXT NOT NULL,
      question_key TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, question_key)
    )`,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_trivia_recent_questions_guild_updated
     ON trivia_recent_questions(guild_id, updated_at DESC)`,
  ).run();
}

function loadRecentQuestionKeys(db: CommandContext['db'], guildId: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT question_key
       FROM trivia_recent_questions
       WHERE guild_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(guildId, RECENT_QUESTION_LIMIT) as Array<{ question_key: string }>;

  return new Set(rows.map((row) => row.question_key));
}

function rememberQuestionKey(
  db: CommandContext['db'],
  guildId: string,
  key: string,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO trivia_recent_questions (guild_id, question_key, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, question_key)
     DO UPDATE SET updated_at = excluded.updated_at`,
  ).run(guildId, key, nowMs);

  db.prepare(
    `DELETE FROM trivia_recent_questions
     WHERE guild_id = ?
       AND question_key NOT IN (
         SELECT question_key
         FROM trivia_recent_questions
         WHERE guild_id = ?
         ORDER BY updated_at DESC
         LIMIT ?
       )`,
  ).run(guildId, guildId, RECENT_QUESTION_LIMIT);
}

async function resolveUniqueRoundQuestion(
  resolveQuestion: () => Promise<TriviaQuestion>,
  usedQuestionKeys: Set<string>,
): Promise<TriviaQuestion> {
  let fallbackCandidate: TriviaQuestion | null = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const candidate = await resolveQuestion();
    const key = questionKey(candidate);

    if (!usedQuestionKeys.has(key)) {
      return candidate;
    }

    fallbackCandidate = candidate;
  }

  // If every attempt repeats, continue with the latest candidate to avoid blocking gameplay.
  return fallbackCandidate ?? pickFallbackQuestion();
}

async function generateTriviaQuestion(): Promise<TriviaQuestion> {
  const response = await ai.models.generateContent({
    model: TRIVIA_MODEL,
    contents: 'Buat 1 soal trivia sekarang.',
    config: {
      systemInstruction: TRIVIA_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: Type.OBJECT,
        properties: {
          kategori: { type: Type.STRING },
          soal: { type: Type.STRING },
          pilihan: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            minItems: 4,
            maxItems: 4,
          },
          jawaban_benar: {
            type: Type.STRING,
            enum: ['A', 'B', 'C', 'D'],
          },
        },
        required: ['kategori', 'soal', 'pilihan', 'jawaban_benar'],
        propertyOrdering: ['kategori', 'soal', 'pilihan', 'jawaban_benar'],
      },
    },
  });

  const text = response.text;
  if (!text || text.trim().length === 0) {
    throw new Error('Trivia AI returned empty response');
  }

  return parseTriviaQuestion(text);
}

export async function generateTriviaQuestionWithRetry(
  generator: () => Promise<TriviaQuestion> = generateTriviaQuestion,
): Promise<TriviaQuestion> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await generator();
    } catch (error) {
      lastError = error;
      console.error(`[Trivia] generate question failed (attempt ${attempt}/2):`, error);
    }
  }

  console.error('[Trivia] using local fallback question after AI failure:', lastError);
  return pickFallbackQuestion();
}

function answerButtons(disabled: boolean): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...ANSWER_KEYS.map((key) =>
        new ButtonBuilder()
          .setCustomId(`trivia_${key}`)
          .setLabel(key)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      ),
    ),
  ];
}

function buildQuestionEmbed(
  question: TriviaQuestion,
  timeStatus: string,
  roundLabel: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🧠 Trivia Kilat')
    .setDescription(question.soal)
    .addFields(
      { name: 'Ronde', value: roundLabel, inline: true },
      { name: 'Kategori', value: question.kategori, inline: true },
      { name: 'Waktu', value: timeStatus, inline: true },
      { name: 'Pilihan A', value: question.pilihan[0], inline: false },
      { name: 'Pilihan B', value: question.pilihan[1], inline: false },
      { name: 'Pilihan C', value: question.pilihan[2], inline: false },
      { name: 'Pilihan D', value: question.pilihan[3], inline: false },
    )
    .setFooter({ text: 'Fastest Finger First • Klik 1x, tidak bisa ganti jawaban' });
}

function buildResultEmbed(
  question: TriviaQuestion,
  options: {
    timedOut: boolean;
    roundLabel: string;
    correctUserIds: string[];
    wrongUserIds: string[];
    answerSummaries: string[];
    nextRoundStartSeconds?: number;
  },
): EmbedBuilder {
  const endTimeStatus = options.timedOut ? '⏱️ **Waktu Habis!**' : '⏱️ **Ronde Selesai**';
  const embed = buildQuestionEmbed(question, endTimeStatus, options.roundLabel);
  const nextRoundText =
    options.nextRoundStartSeconds !== undefined
      ? `\n\n➡️ Ronde berikutnya mulai <t:${options.nextRoundStartSeconds}:R>. Bersiap!`
      : '';
  const participantSummary =
    options.answerSummaries.length > 0
      ? `\n\n**Ringkasan Jawaban Pemain**\n${options.answerSummaries.join('\n')}`
      : '\n\nBelum ada pemain yang mengunci jawaban di ronde ini.';

  if (options.correctUserIds.length > 0) {
    embed
      .setColor(0x57f287)
      .setTitle('🏁 Trivia Selesai')
      .setDescription(
        [
          `Jawaban benar: **${question.jawaban_benar}**`,
          `Benar: ${options.correctUserIds.length} pemain (+${CORRECT_ANSWER_POINTS} poin)`,
          `Salah: ${options.wrongUserIds.length} pemain (${WRONG_ANSWER_POINTS} poin)`,
          participantSummary,
          nextRoundText,
        ]
          .filter((line) => line.length > 0)
          .join('\n'),
      );
    return embed;
  }

  if (options.timedOut) {
    embed
      .setColor(0xed4245)
      .setTitle('⏰ Waktu Habis')
      .setDescription(
        `Tidak ada yang benar kali ini. Jawaban benar: **${question.jawaban_benar}**${participantSummary}${nextRoundText}`,
      );
    return embed;
  }

  embed.setDescription(`Jawaban benar: **${question.jawaban_benar}**${participantSummary}${nextRoundText}`);
  return embed;
}

function parseAnswer(customId: string): AnswerKey | null {
  const [, raw] = customId.split('_');
  if (!raw) return null;
  return ANSWER_KEYS.includes(raw as AnswerKey) ? (raw as AnswerKey) : null;
}

function addPoints(db: CommandContext['db'], guildId: string, userId: string, delta: number): void {
  db.prepare(
    `INSERT INTO trivia_scores (guild_id, user_id, points)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id)
     DO UPDATE SET points = points + excluded.points`,
  ).run(guildId, userId, delta);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  await executeTrivia(interaction, { db });
}

export async function executeTrivia(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
  dependencies: TriviaRuntimeDependencies = {},
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Trivia hanya bisa dimainkan di server.',
      ephemeral: true,
    });
    return;
  }

  const channelKey = interaction.channelId ?? `guild:${interaction.guildId}`;
  if (activeTriviaChannels.has(channelKey)) {
    await interaction.reply({
      content: 'Masih ada ronde trivia aktif di channel ini. Tunggu ronde itu selesai dulu ya.',
      ephemeral: true,
    });
    return;
  }

  activeTriviaChannels.add(channelKey);

  const resolveQuestion = dependencies.generateQuestion ?? (() => generateTriviaQuestionWithRetry());
  const nowMs = dependencies.nowMs ?? Date.now;
  const sessionQuestionCount = Math.max(1, dependencies.questionCount ?? DEFAULT_SESSION_QUESTION_COUNT);
  let usedQuestionKeys = new Set<string>();

  try {
    ensureTriviaRecentQuestionTable(db);
    usedQuestionKeys = loadRecentQuestionKeys(db, interaction.guildId);
  } catch (error) {
    console.error('[Trivia] failed to load recent question history:', error);
  }

  await interaction.deferReply();
  await interaction.editReply(`Hikari sedang memikirkan soal... Sesi dimulai (${sessionQuestionCount} soal).`);

  const playRound = async (roundNumber: number): Promise<void> => {
    const roundLabel = `${roundNumber}/${sessionQuestionCount}`;
    await interaction
      .editReply({
        content: `⏳ Menyiapkan ronde ${roundLabel}... soal baru lagi dimasak, siap-siap ya!`,
        embeds: [],
        components: [],
      })
      .catch(() => undefined);

    let question: TriviaQuestion;
    try {
      question = await resolveUniqueRoundQuestion(resolveQuestion, usedQuestionKeys);
      const key = questionKey(question);
      usedQuestionKeys.add(key);

      try {
        rememberQuestionKey(db, interaction.guildId!, key, nowMs());
      } catch (error) {
        console.error('[Trivia] failed to persist question history:', error);
      }
    } catch (error) {
      console.error('[Trivia] failed to generate question:', error);
      await interaction.editReply(
        'Lagi gagal bikin soal trivia sekarang. Coba lagi sebentar ya.',
      );
      activeTriviaChannels.delete(channelKey);
      return;
    }

    const lockedUsers = new Set<string>();
    const answersByUser = new Map<string, AnswerKey>();
    const endSeconds = Math.floor((nowMs() + ROUND_TIMEOUT_MS) / 1000);
    const countdownText = `⏱️ **Sisa Waktu:** <t:${endSeconds}:R>`;

    await interaction.editReply({
      embeds: [buildQuestionEmbed(question, countdownText, roundLabel)],
      components: answerButtons(false),
    });

    const replyMessage = await interaction.fetchReply();
    if (!('createMessageComponentCollector' in replyMessage)) {
      activeTriviaChannels.delete(channelKey);
      return;
    }

    const collector = (replyMessage as Message).createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: ROUND_TIMEOUT_MS,
      filter: (buttonInteraction) =>
        parseAnswer(buttonInteraction.customId) !== null &&
        buttonInteraction.message.id === replyMessage.id,
    });

    collector.on('collect', async (buttonInteraction) => {
      if (!buttonInteraction.customId.startsWith('trivia_')) return;

      const answer = parseAnswer(buttonInteraction.customId);
      if (!answer) return;

      if (lockedUsers.has(buttonInteraction.user.id)) {
        await buttonInteraction.deferUpdate().catch(() => undefined);
        return;
      }

      lockedUsers.add(buttonInteraction.user.id);
      answersByUser.set(buttonInteraction.user.id, answer);
      await buttonInteraction.deferUpdate().catch(() => undefined);
    });

    collector.on('end', async (_collected, reason) => {
      const timedOut = reason === 'time';
      const correctUserIds: string[] = [];
      const wrongUserIds: string[] = [];
      const answerSummaries: string[] = [];
      const isLastRound = roundNumber >= sessionQuestionCount;
      const nextRoundStartSeconds = isLastRound
        ? undefined
        : Math.floor((nowMs() + INTER_ROUND_READY_DELAY_MS) / 1000);

      for (const [userId, answer] of answersByUser.entries()) {
        if (answer === question.jawaban_benar) {
          correctUserIds.push(userId);
          answerSummaries.push(`• <@${userId}> pilih **${answer}** -> ✅ +${CORRECT_ANSWER_POINTS}`);
        } else {
          wrongUserIds.push(userId);
          answerSummaries.push(`• <@${userId}> pilih **${answer}** -> ❌ ${WRONG_ANSWER_POINTS}`);
        }
      }

      try {
        for (const userId of correctUserIds) {
          addPoints(db, interaction.guildId!, userId, CORRECT_ANSWER_POINTS);
        }
        for (const userId of wrongUserIds) {
          addPoints(db, interaction.guildId!, userId, WRONG_ANSWER_POINTS);
        }
      } catch (error) {
        console.error('[Trivia] failed to update score:', error);
      }

      await interaction
        .editReply({
          embeds: [
            buildResultEmbed(question, {
              timedOut,
              roundLabel,
              correctUserIds,
              wrongUserIds,
              answerSummaries,
              nextRoundStartSeconds,
            }),
          ],
          components: answerButtons(true),
        })
        .catch(() => undefined);

      if (timedOut) {
        // Result already shown in the updated embed; avoid extra follow-up noise.
      }

      if (isLastRound) {
        activeTriviaChannels.delete(channelKey);
        return;
      }
      await delay(INTER_ROUND_READY_DELAY_MS);
      void playRound(roundNumber + 1);
    });
  };

  void playRound(1);
}

export function resetTriviaRuntimeStateForTest(): void {
  activeTriviaChannels.clear();
}
