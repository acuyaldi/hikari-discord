import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import { splitMessage } from '../utils/splitmessage';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { deepAnalysisInstruction } from '../prompt/deepPrompt';
import groq from '../ai/groq';
import ai from '../ai/gemini';
import type { CommandContext, UserRow } from '../types';

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
    await interaction.reply({ content: '💢 **Nani?!** Masukkan dokumen atau tautan dulu dong, Senpai!', ephemeral: true });
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

    const analysisPrompt = `${finalContentToAnalyze}\n\n[PERINTAH USER]: ${customInstruction}`;
    let resultText = '';
    let engineUsed = '';

    if (selectedMode === 'mendalam') {
      engineUsed = 'Groq GPT-OSS 120B 🔥 (Deep Analysis Mode)';
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
    } else {
      engineUsed = 'Gemini AI 🌟 (Standar Mode)';
      try {
        console.log('[Analyze] using standard analysis mode with Gemini 2.5 Flash');
        const aiResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: analysisPrompt,
          config: { systemInstruction: dynamicSystemInstruction },
        });
        resultText = aiResponse.text ?? '';
      } catch {
        engineUsed = 'Groq GPT-OSS 20B 🚀 (Standar Mode - Fallback)';
        console.log('[Analyze] Gemini standard analysis failed, falling back to Groq GPT-OSS 20B');
        const groqResponse = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: dynamicSystemInstruction },
            { role: 'user', content: analysisPrompt },
          ],
          model: 'openai/gpt-oss-20b',
          temperature: 0.7,
        });
        resultText = groqResponse.choices[0].message.content ?? '';
      }
    }

    const replyHeader = `📂 **Sirkuit Analisis Sukses!**\n> **Engine:** \`${engineUsed}\`\n${sourceInfo}\n\n`;
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
    await interaction.editReply('Gomennasai Senpai... Sirkuit otak Hikari gagal menganalisis data tersebut. 🥺💢');
  }
}
