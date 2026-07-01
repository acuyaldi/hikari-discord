import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { Type } from '@google/genai';
import type { CommandContext } from '../types';
import ai from '../ai/gemini';
import { providerManager } from '../services/ai/providerManager';
import { AIProviderName, TaskType } from '../services/ai/types';
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

const TRIVIA_SYSTEM_INSTRUCTION = [
  'You are an elite quiz master engine for a popular Indonesian TV show like "Ranking 1" or "Who Wants to Be a Millionaire".',
  'Your job is to generate exactly ONE high-quality, engaging trivia question in Indonesian (Bahasa Indonesia) adhering STRICTLY to the RPUL (Rangkuman Pengetahuan Umum Lengkap) curriculum.',
  '',
  '=== CORE THEMES (Pick one randomly per request) ===',
  '- Geography: National & international capitals, famous landmarks, natural wonders, province facts.',
  '- History: Indonesian national heroes, ancient kingdoms (Majapahit, Sriwijaya, etc.), crucial world war events.',
  '- Culture: Traditional fabrics (Batik/Ulos), regional houses, indigenous musical instruments, dances.',
  '- Basic Science & Space: Famous inventors, solar system, primary school level biology/physics/chemistry.',
  '- Civics & Global Agencies: ASEAN, United Nations, national state symbols, well-known acronyms.',
  '',
  '=== DIFFICULTY & STYLE CRITERIA ===',
  '- Target audience: General audience with school-level knowledge (SMP/SMA).',
  '- The question must be a verifiable fact, logical, and educational.',
  '- DO NOT ask about obscure pop-culture, minor local politicians, specific release dates of novels/movies, or overly niche statistics.',
  '',
  '=== STRICT OUTPUT FORMATTING ===',
  '- You must output raw JSON ONLY. No markdown wrappers (like ```json), no conversational text, no trailing explanations.',
  '- The "pilihan" array MUST consist of exactly 4 strings.',
  '- CRITICAL: Each item inside the "pilihan" array MUST strictly start with its respective uppercase letter prefix followed by a dot and a space. For example: "A. [Text]", "B. [Text]", "C. [Text]", "D. [Text]". Failure to include the "X. " prefix will crash the parsing engine.',
  '- The "jawaban_benar" field must contain exactly one uppercase letter: "A", "B", "C", or "D".',
  '',
  '=== JSON SCHEMA TEMPLATE ===',
  '{"kategori": "Nama Kategori", "soal": "Teks pertanyaan?", "pilihan": ["A. Opsi Satu", "B. Opsi Dua", "C. Opsi Tiga", "D. Opsi Empat"], "jawaban_benar": "A"}',
].join('\n');

export const data = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Mainkan sesi trivia cepat-cepatan (default 5 soal)')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('mulai')
      .setDescription('Mulai sesi trivia baru')
      .addIntegerOption((option) =>
        option
          .setName('soal')
          .setDescription('Jumlah soal untuk sesi ini (default 5)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(15),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reset')
      .setDescription('Reset skor trivia server ini (khusus admin/manager server)'),
  );

function sanitizeJsonResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
  }

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

function pickUnusedFallbackQuestion(usedQuestionKeys: Set<string>): TriviaQuestion {
  const candidates = localFallbackQuestions();
  const unused = candidates.filter((question) => !usedQuestionKeys.has(questionKey(question)));
  if (unused.length === 0) return pickFallbackQuestion();
  const index = Math.floor(Math.random() * unused.length);
  return unused[index]!;
}

function questionKey(question: TriviaQuestion): string {
  return question.soal
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function ensureTriviaRecentQuestionTable(db: CommandContext['db']): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS trivia_scores (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      points   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )`,
  ).run();

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
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const candidate = await resolveQuestion();
    const key = questionKey(candidate);

    if (!usedQuestionKeys.has(key)) {
      return candidate;
    }
  }

  // If repeated responses persist, force variation from local fallback pool.
  return pickUnusedFallbackQuestion(usedQuestionKeys);
}

async function generateTriviaQuestion(recentQuestionKeys: string[] = []): Promise<TriviaQuestion> {
  const avoidList = recentQuestionKeys
    .slice(0, 10)
    .map((key, index) => `${index + 1}. ${key}`)
    .join('\n');

  const prompt =
    avoidList.length > 0
      ? [
          'Buat 1 soal trivia sekarang.',
          'Hindari pertanyaan yang mirip dengan daftar berikut:',
          avoidList,
          'Pilih kategori/fakta lain yang berbeda.',
        ].join('\n')
      : 'Buat 1 soal trivia sekarang.';

  const response = await ai.models.generateContent({
    model: TRIVIA_MODEL,
    contents: prompt,
    config: {
      systemInstruction: TRIVIA_SYSTEM_INSTRUCTION,
      temperature: 1.2,
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

async function generateTriviaQuestionViaProviderRouter(
  recentQuestionKeys: string[] = [],
): Promise<TriviaQuestion> {
  const avoidList = recentQuestionKeys
    .slice(0, 10)
    .map((key, index) => `${index + 1}. ${key}`)
    .join('\n');

  const prompt = [
    'Buat 1 soal trivia unik berbahasa Indonesia.',
    avoidList.length > 0
      ? `Hindari pertanyaan yang mirip daftar ini:\n${avoidList}`
      : 'Pastikan pertanyaan tidak monoton.',
    'Wajib output JSON saja (tanpa penjelasan, tanpa markdown).',
    'Format wajib:',
    '{"kategori":"...","soal":"...","pilihan":["A. ...","B. ...","C. ...","D. ..."],"jawaban_benar":"A|B|C|D"}',
  ].join('\n\n');

  const response = await providerManager.generate({
    userId: 'trivia-system',
    guildId: null,
    channelId: 'trivia-system',
    promptText: prompt,
    identityPrefix: '',
    finalPrompt: prompt,
    dynamicSystemInstruction: TRIVIA_SYSTEM_INSTRUCTION,
    hasImage: false,
    taskType: TaskType.GENERAL,
    preferredProviders: [
      AIProviderName.OPENROUTER,
      AIProviderName.HUGGINGFACE,
      AIProviderName.GROQ,
    ],
  });

  return parseTriviaQuestion(response.replyText);
}

export async function generateTriviaQuestionWithRetry(
  generator: () => Promise<TriviaQuestion> = generateTriviaQuestion,
  providerFallback?: () => Promise<TriviaQuestion>,
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

  if (providerFallback) {
    try {
      return await providerFallback();
    } catch (error) {
      lastError = error;
      console.error('[Trivia] provider-router fallback also failed:', error);
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
  // Menggunakan garis vertikal pembatas dan spasi ganda agar renggang dan enak dibaca
  const optionsText = question.pilihan.map((choice) => `┃ **${choice}**`).join('\n\n');

  return new EmbedBuilder()
    .setColor(0x2f3136) // Warna Dark Theme minimalis ala bot premium
    .setAuthor({ name: `🧠 TRIVIA KILAT • RONDE ${roundLabel}` })
    .setDescription(
      `#️⃣ \`Kategori: ${question.kategori}\`\n\n` +
      `### ${question.soal}\n\n` + // Sub-header untuk memperbesar font soal
      `━─━─━─━─━─━─━─━─━─━─━─━─━─━─━─━\n\n` +
      `${optionsText}\n\n` +
      `━─━─━─━─━─━─━─━─━─━─━─━─━─━─━─━\n\n` +
      `${timeStatus}\n` +
      `👤 *Klik tombol di bawah untuk mengunci jawabanmu!*`
    )
    .setFooter({ text: 'Sistem Terkunci • Tercepat Dia Dapat • Pengetahuan Umum' });
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
      ? `\n\n➡️ *Ronde berikutnya mulai <t:${options.nextRoundStartSeconds}:R>. Bersiap!*`
      : '\n\n🏁 *Sesi kuis telah berakhir! Sila periksa papan peringkat.*';

  const participantSummary =
    options.answerSummaries.length > 0
      ? `\n\n📊 **Ringkasan Jawaban Pemain:**\n${options.answerSummaries.join('\n')}`
      : '\n\n💤 *Belum ada pemain yang mengunci jawaban di ronde ini.*';

  // Desain ulang konten rekap agar terstruktur rapi di dalam deskripsi
  embed.setDescription(
    `#️⃣ \`Kategori: ${question.kategori}\`\n\n` +
    `### ${question.soal}\n\n` +
    `━─━─━─━─━─━─━─━─━─━─━─━─━─━─━─━\n\n` +
    `💡 Jawaban Benar: **${question.jawaban_benar}**\n` +
    `✅ Benar: **${options.correctUserIds.length}** pemain (+${CORRECT_ANSWER_POINTS} Poin)\n` +
    `❌ Salah: **${options.wrongUserIds.length}** pemain (${WRONG_ANSWER_POINTS} Poin)` +
    `${participantSummary}` +
    `${nextRoundText}`
  );

  // Berikan warna hijau jika ada yang benar, merah jika waktu habis total tanpa jawaban
  if (options.correctUserIds.length > 0) {
    embed.setColor(0x57f287);
  } else if (options.timedOut && options.answerSummaries.length === 0) {
    embed.setColor(0xed4245);
  } else {
    embed.setColor(0xe67e22); // Orange jika ada yang ikut tapi salah semua
  }

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
     DO UPDATE SET points = MAX(0, points + excluded.points)`,
  ).run(guildId, userId, delta);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'reset') {
    await executeReset(interaction, context);
    return;
  }

  const questionCount = interaction.options.getInteger('soal') ?? DEFAULT_SESSION_QUESTION_COUNT;
  await executeTrivia(interaction, context, { questionCount });
}

export async function executeReset(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Reset skor trivia hanya bisa dipakai di server.',
      ephemeral: true,
    });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!hasPermission) {
    await interaction.reply({
      content: 'Kamu butuh permission Manage Server untuk reset skor trivia.',
      ephemeral: true,
    });
    return;
  }

  try {
    ensureTriviaRecentQuestionTable(db);
    db.prepare('DELETE FROM trivia_scores WHERE guild_id = ?').run(interaction.guildId);
    await interaction.reply({
      content: 'Skor trivia untuk server ini berhasil direset.',
      ephemeral: true,
    });
  } catch (error) {
    console.error('[Trivia] failed to reset scores:', error);
    await interaction.reply({
      content: 'Gagal reset skor trivia. Coba lagi sebentar.',
      ephemeral: true,
    });
  }
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
      question = await resolveUniqueRoundQuestion(async () => {
        if (dependencies.generateQuestion) {
          return dependencies.generateQuestion();
        }
        return generateTriviaQuestionWithRetry(
          () => generateTriviaQuestion(Array.from(usedQuestionKeys)),
          () => generateTriviaQuestionViaProviderRouter(Array.from(usedQuestionKeys)),
        );
      }, usedQuestionKeys);
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
