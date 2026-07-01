import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import { splitMessage } from '../utils/splitmessage';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { deepAnalysisInstruction } from '../prompt/deepPrompt';
import { providerManager } from '../services/ai/providerManager';
import { AIProviderName, TaskType } from '../services/ai/types';
import { estimateContextTokens } from '../services/context/contextBuilder';
import groq from '../ai/groq';
import type { CommandContext, UserRow } from '../types';

const ANALYZE_PROMPT_TOKEN_BUDGET = 4_000;
const ANALYZE_PROMPT_OVERHEAD_TOKENS = 250;
const MIN_SOURCE_TOKEN_BUDGET = 1_000;

export function describeAnalyzeEngine(
  mode: 'standar' | 'mendalam',
  provider: AIProviderName,
  isFallback = false,
): string {
  if (mode === 'mendalam' && !isFallback && provider === AIProviderName.GROQ) {
    return 'Groq GPT-OSS 120B 🔥 (Deep Analysis Mode)';
  }

  if (provider === AIProviderName.GEMINI) {
    return mode === 'mendalam'
      ? 'Gemini AI 🌟 (Deep Analysis Mode - Fallback)'
      : 'Gemini AI 🌟 (Standar Mode)';
  }

  if (provider === AIProviderName.OPENROUTER) {
    return mode === 'mendalam'
      ? 'OpenRouter 🌐 (Deep Analysis Mode - Fallback)'
      : 'OpenRouter 🌐 (Standar Mode - Fallback)';
  }

  return mode === 'mendalam'
    ? 'Groq GPT-OSS 20B 🚀 (Deep Analysis Mode - Fallback)'
    : 'Groq GPT-OSS 20B 🚀 (Standar Mode - Fallback)';
}

export function boundAnalysisSource(sourceText: string, customInstruction: string): string {
  const instructionTokens = estimateContextTokens(customInstruction);
  const sourceTokenBudget = Math.max(
    MIN_SOURCE_TOKEN_BUDGET,
    ANALYZE_PROMPT_TOKEN_BUDGET - instructionTokens - ANALYZE_PROMPT_OVERHEAD_TOKENS,
  );

  if (estimateContextTokens(sourceText) <= sourceTokenBudget) {
    return sourceText;
  }

  const maxChars = sourceTokenBudget * 4;
  const truncationMarker = '\n\n[... konten dipotong agar muat diproses model ...]\n\n';
  const headChars = Math.max(0, Math.floor((maxChars - truncationMarker.length) * 0.75));
  const tailChars = Math.max(0, maxChars - truncationMarker.length - headChars);
  const boundedSource = `${sourceText.slice(0, headChars)}${truncationMarker}${sourceText.slice(-tailChars)}`;

  console.log(
    `[Analyze] source truncated chars=${sourceText.length}->${boundedSource.length} tokens=${estimateContextTokens(sourceText)}->${estimateContextTokens(boundedSource)}`,
  );

  return boundedSource;
}

async function extractAttachmentText(url: string, fileName: string, contentType: string | null): Promise<string> {
  console.log(
    `[Analyze] downloading attachment name=${fileName} contentType=${contentType ?? 'unknown'} url=${url}`,
  );
  const fileResponse = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
  const dataBuffer = Buffer.from(fileResponse.data);
  const isPdf = contentType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    console.log(`[Analyze] parsing pdf name=${fileName} bytes=${dataBuffer.length}`);
    const parser = new PDFParse({ data: dataBuffer });
    try {
      const parsedPdf = await parser.getText();
      console.log(`[Analyze] parsed pdf name=${fileName} chars=${parsedPdf.text.length}`);
      return parsedPdf.text;
    } finally {
      await parser.destroy();
    }
  }

  console.log(`[Analyze] treating attachment as text name=${fileName} bytes=${dataBuffer.length}`);
  return dataBuffer.toString('utf-8');
}

export const data = new SlashCommandBuilder()
  .setName('analyze')
  .setDescription('Analisis file dokumen atau tautan URL secara cerdas! 📂🔗')
  .addAttachmentOption((option) =>
    option.setName('dokumen').setDescription('Unggah file (Opsional)').setRequired(false),
  )
  .addStringOption((option) =>
    option.setName('url').setDescription('Masukkan URL web/Github (Opsional)').setRequired(false),
  )
  .addStringOption((option) =>
    option.setName('perintah').setDescription('Pertanyaan khusus untuk dokumen (Opsional)').setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('mode')
      .setDescription('Pilih mode analisis')
      .setRequired(false)
      .addChoices(
        { name: '⚡ Standar (Cepat & Ringkas)', value: 'standar' },
        { name: '🧠 Analisis Mendalam (Kritis & Detail)', value: 'mendalam' },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  const userId = interaction.user.id;
  const fileAttachment = interaction.options.getAttachment('dokumen');
  const inputUrl = interaction.options.getString('url');
  const customInstruction =
    interaction.options.getString('perintah') ?? 'Rangkum dan jelaskan isi konten ini dengan detail.';
  const selectedMode = interaction.options.getString('mode') ?? 'standar';

  if (!fileAttachment && (!inputUrl || inputUrl.trim() === '')) {
    await interaction.reply({ content: 'Masukkan dokumen atau tautan dulu. Aku jago analisis, bukan jago cenayang.', ephemeral: true });
    return;
  }

  console.log(
    `[Analyze] start user=${userId} attachment=${fileAttachment?.name ?? 'none'} url=${inputUrl ?? 'none'} mode=${selectedMode}`,
  );
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }
  try {
    let finalContentToAnalyze = '';
    let sourceInfo = '';

    if (fileAttachment) {
      const attachmentText = await extractAttachmentText(
        fileAttachment.url,
        fileAttachment.name,
        fileAttachment.contentType,
      );
      console.log(`[Analyze] attachment extracted name=${fileAttachment.name} chars=${attachmentText.length}`);
      finalContentToAnalyze += `[FILE: ${fileAttachment.name}]\n${attachmentText}\n\n`;
      sourceInfo += `📄 File: \`${fileAttachment.name}\` `;
    }

    if (inputUrl && inputUrl.trim() !== '') {
      let targetUrl = inputUrl.trim();
      if (targetUrl.includes('github.com') && !targetUrl.includes('raw.githubusercontent.com')) {
        targetUrl = targetUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      } else if (!targetUrl.includes('raw.githubusercontent.com')) {
        targetUrl = `https://r.jina.ai/${targetUrl}`;
      }
      console.log(`[Analyze] fetching url source=${inputUrl} resolved=${targetUrl}`);
      const urlResponse = await axios.get<string>(targetUrl, { responseType: 'text', timeout: 15000 });
      console.log(`[Analyze] fetched url chars=${urlResponse.data.length}`);
      finalContentToAnalyze += `[KONTEN URL]:\n${urlResponse.data}\n\n`;
      sourceInfo += `🔗 Tautan URL: <${inputUrl}>`;
    }

    const userRow = db
      .prepare('SELECT feedback_notes FROM user_memories WHERE user_id = ?')
      .get(userId) as Pick<UserRow, 'feedback_notes'> | undefined;
    const dynamicSystemInstruction =
      baseSystemInstruction +
      (userRow?.feedback_notes ? `\n[ATURAN DARI USER YANG WAJIB DIPATUHI: ${userRow.feedback_notes}]` : '');

    const boundedContentToAnalyze = boundAnalysisSource(finalContentToAnalyze, customInstruction);
    const analysisPrompt = `${boundedContentToAnalyze}\n\n[PERINTAH USER]: ${customInstruction}`;
    let resultText = '';
    let engineUsed = '';

    if (selectedMode === 'mendalam') {
      engineUsed = describeAnalyzeEngine('mendalam', AIProviderName.GROQ);
      try {
        console.log('[Analyze] using deep analysis mode with Groq GPT-OSS 120B');
        const groqResponse = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: `${dynamicSystemInstruction}\n\n${deepAnalysisInstruction}` },
            { role: 'user', content: analysisPrompt },
          ],
          model: 'openai/gpt-oss-120b',
          temperature: 0.5,
        });
        resultText = groqResponse.choices[0].message.content ?? '';
      } catch {
        console.log('[Analyze] Groq deep analysis failed, falling back to OpenRouter then Gemini');
        const response = await providerManager.generate({
          userId,
          guildId: interaction.guildId,
          channelId: interaction.channelId ?? `interaction-${interaction.id}`,
          promptText: analysisPrompt,
          identityPrefix: '',
          finalPrompt: analysisPrompt,
          dynamicSystemInstruction: `${dynamicSystemInstruction}\n\n${deepAnalysisInstruction}`,
          hasImage: false,
          taskType: TaskType.GENERAL,
          preferredProviders: [AIProviderName.OPENROUTER, AIProviderName.GEMINI, AIProviderName.GROQ],
        });
        resultText = response.replyText;
        engineUsed = describeAnalyzeEngine('mendalam', response.providerUsed, true);
      }
    } else {
      console.log('[Analyze] using standard analysis mode via provider manager');
      const response = await providerManager.generate({
        userId,
        guildId: interaction.guildId,
        channelId: interaction.channelId ?? `interaction-${interaction.id}`,
        promptText: analysisPrompt,
        identityPrefix: '',
        finalPrompt: analysisPrompt,
        dynamicSystemInstruction,
        hasImage: false,
        taskType: TaskType.GENERAL,
        preferredProviders: [AIProviderName.GEMINI, AIProviderName.OPENROUTER, AIProviderName.GROQ],
      });
      resultText = response.replyText;
      engineUsed = describeAnalyzeEngine('standar', response.providerUsed, response.providerUsed !== AIProviderName.GEMINI);
    }

    const replyHeader = `📂 **Analisis beres.**\n> **Engine:** \`${engineUsed}\`\n${sourceInfo}\n> **Status:** Tidak meledak. Bagus.\n\n`;
    const replyChunks = splitMessage(`${replyHeader}${resultText}`);
    console.log(
      `[Analyze] success engine=${engineUsed} replyChars=${resultText.length} chunks=${replyChunks.length}`,
    );
    await interaction.editReply({ content: replyChunks[0] });
    for (let i = 1; i < replyChunks.length; i++) {
      await interaction.followUp({ content: replyChunks[i] });
    }
  } catch (error) {
    console.error('[Analyze] failed:', error);
    await interaction.editReply('Yah, analisisnya gagal. Ada yang nyangkut di belakang layar, seperti biasa pas lagi butuh-butuhnya. Coba lagi bentar lagi.');
  }
}
