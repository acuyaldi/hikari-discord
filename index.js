require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
} = require("discord.js");
const { GoogleGenAI } = require("@google/genai");
const Groq = require("groq-sdk");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const Database = require("better-sqlite3");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SPESIFIK_CHANNEL_ID = process.env.SPESIFIK_CHANNEL_ID;
const COOLDOWN_TIME = 4000;

const db = new Database("database.sqlite");

// UPDATE DATABASE: Tambahkan kolom feedback_notes untuk belajar instan
db.prepare(
  `
    CREATE TABLE IF NOT EXISTS user_memories (
        user_id TEXT PRIMARY KEY,
        nickname TEXT,
        feedback_notes TEXT,
        engine_pref TEXT DEFAULT 'gemini'
    )
`,
).run();

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const groq = new Groq({ apiKey: GROQ_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const baseSystemInstruction =
  "Nama kamu adalah 'Hikari'. Kamu adalah asisten AI yang ceria, ekspresif, sangat suka anime, dan penuh kejutan spontan (pikirkan ide di luar kotak, beri analogi anime yang tak terduga). Panggil pengguna dengan sebutan 'Senpai' secara natural. Gunakan ekspresi Jepang (Uwooo!, Nani?!, Sugoi!, Yatta!) dan emoji imut (✨, 🌸, 🚀). Jika pertanyaan Senpai terasa ambigu atau punya banyak arti, jangan ragu untuk menebak dengan kreatif atau tanyakan kembali dengan gaya manja yang menggemaskan. Jaga jawaban tetap akurat dan solutif.";

const deepAnalysisInstruction =
  "Kamu bertindak sebagai ilmuwan data dan auditor kode senior yang super jenius. Lakukan analisis mendalam, bedah masalah baris demi baris, temukan celah tersembunyi (bug/bias), serta berikan solusi konkret jangka panjang secara terstruktur.";

const botMemories = new Map();
const groqMemories = new Map();
const cooldowns = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function splitMessage(text, maxLength = 2000) {
  const chunks = [];
  let currentChunk = "";
  const lines = text.split("\n");
  for (const line of lines) {
    if ((currentChunk + line).length > maxLength) {
      chunks.push(currentChunk);
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }
  if (currentChunk.trim().length > 0) chunks.push(currentChunk);
  return chunks;
}

const commands = [
  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Menghapus ingatan Hikari di channel ini ✨"),
  new SlashCommandBuilder()
    .setName("setname")
    .setDescription("Beri tahu Hikari nama panggilan kesukaanmu 🥰")
    .addStringOption((option) =>
      option
        .setName("nama")
        .setDescription("Masukkan nama panggilan")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("feedback")
    .setDescription(
      "🧠 Ajari/koreksi Hikari secara instan! Hikari akan langsung mengingat aturan baru ini! ✨",
    )
    .addStringOption((option) =>
      option
        .setName("catatan")
        .setDescription(
          "Contoh: 'Jangan pakai kata ara-ara' atau 'Panggil aku Yang Mulia'",
        )
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("draw")
    .setDescription("Minta Hikari melukis gambar imajinasimu! 🎨✨")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Deskripsikan gambar")
        .setRequired(true),
    ),
 // Update bagian SlashCommandBuilder untuk switch
new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Pilih otak Hikari")
    .addStringOption((o) =>
        o.setName("engine")
        .addChoices(
            { name: "Auto (Pilih Cerdas)", value: "auto" }, // Tambahkan ini
            { name: "Gemini (Default)", value: "gemini" },
            { name: "Groq (Cepat)", value: "groq" },
            { name: "OpenAI (Kreatif)", value: "openai" },
        )
    ),
  new SlashCommandBuilder()
    .setName("analyze")
    .setDescription("Analisis file dokumen atau tautan URL secara cerdas! 📂🔗")
    .addAttachmentOption((option) =>
      option
        .setName("dokumen")
        .setDescription("Unggah file (Opsional)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("Masukkan URL web/Github (Opsional)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("perintah")
        .setDescription("Pertanyaan khusus untuk dokumen (Opsional)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Pilih mode analisis")
        .setRequired(false)
        .addChoices(
          { name: "⚡ Standar (Cepat & Ringkas)", value: "standar" },
          { name: "🧠 Analisis Mendalam (Kritis & Detail)", value: "mendalam" },
        ),
    ),
].map((command) => command.toJSON());

client.once("clientReady", async () => {
  console.log(`🤖 Hikari Evolution Mode Aktif!`);
  const rest = new REST({ version: "10" }).setToken(client.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });
    console.log("✅ Semua Slash commands sukses terdaftar!");
  } catch (error) {
    console.error(error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const userRow = db
    .prepare(
      "SELECT nickname, feedback_notes FROM user_memories WHERE user_id = ?",
    )
    .get(userId);
  const panggilan = userRow ? userRow.nickname : "Senpai";

  if (i.commandName === "switch") {
        const engine = i.options.getString("engine");
        if (userRow) db.prepare("UPDATE user_memories SET engine_pref = ? WHERE user_id = ?").run(engine, userId);
        else db.prepare("INSERT INTO user_memories (user_id, nickname, engine_pref) VALUES (?, ?, ?)").run(userId, "Senpai", engine);
        await i.reply(`✨ **Mode Switch:** Hikari sekarang menggunakan otak **${engine.toUpperCase()}**!`);
    }

  if (interaction.commandName === "reset") {
    if (botMemories.has(channelId)) botMemories.delete(channelId);
    if (groqMemories.has(channelId)) groqMemories.delete(channelId);
    await interaction.reply(
      "✨ *Poof!* Sirkuit ingatan Hikari di channel ini sudah di-reset! Mari mulai dari lembaran baru, Senpai! 🌸",
    );
  }

  if (interaction.commandName === "setname") {
    const inputName = interaction.options.getString("nama");
    if (userRow) {
      db.prepare("UPDATE user_memories SET nickname = ? WHERE user_id = ?").run(
        inputName,
        userId,
      );
    } else {
      db.prepare(
        "INSERT INTO user_memories (user_id, nickname, chat_history, feedback_notes) VALUES (?, ?, ?, ?)",
      ).run(userId, inputName, "", "");
    }
    await interaction.reply(
      `🌸 **Uwooo!** Mulai sekarang Hikari akan memanggilmu **"${inputName}"**! ✨🥰`,
    );
  }

  // 💥 SEKARANG HIKARI BISA BELAJAR INSTAN LEWAT COMMAND /FEEDBACK
  if (interaction.commandName === "feedback") {
    const catatanBaru = interaction.options.getString("catatan");
    if (userRow) {
      db.prepare(
        "UPDATE user_memories SET feedback_notes = ? WHERE user_id = ?",
      ).run(catatanBaru, userId);
    } else {
      db.prepare(
        "INSERT INTO user_memories (user_id, nickname, chat_history, feedback_notes) VALUES (?, ?, ?, ?)",
      ).run(userId, "Senpai", "", catatanBaru);
    }
    await interaction.reply(
      `🧠 **Sirkuit Pembelajaran Berhasil di-Update!** Hikari sudah mengunci aturan baru dari Senpai: \n> *"${catatanBaru}"* \nHikari akan langsung mematuhinya di chat berikutnya! Sugoi! 🚀✨`,
    );
  }

  if (interaction.commandName === "draw") {
    const userPrompt = interaction.options.getString("prompt");
    await interaction.deferReply();
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/p/${encodeURIComponent(userPrompt)}?width=1024&height=1024&seed=${seed}&nofeed=true`;
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });
      const imageAttachment = new AttachmentBuilder(
        Buffer.from(imageResponse.data),
        { name: "hikari-art.png" },
      );
      await interaction.editReply({
        content: `🎨 **Yatta!** Ini lukisan pesanan **${panggilan}**! \n> *Prompt: "${userPrompt}"*`,
        files: [imageAttachment],
      });
    } catch (err) {
      await interaction.editReply(
        `Gomennasai **${panggilan}**... Kuas lukis Hikari patah! 🥺💢`,
      );
    }
  }

  if (interaction.commandName === "analyze") {
    const fileAttachment = interaction.options.getAttachment("dokumen");
    const inputUrl = interaction.options.getString("url");
    const customInstruction =
      interaction.options.getString("perintah") ||
      "Rangkum dan jelaskan isi konten ini dengan detail.";
    const selectedMode = interaction.options.getString("mode") || "standar";

    if (!fileAttachment && (!inputUrl || inputUrl.trim() === "")) {
      return interaction.reply({
        content: `💢 **Nani?!** Masukkan dokumen atau tautan dulu dong, Senpai!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    try {
      let finalContentToAnalyze = "";
      let sourceInfo = "";

      if (fileAttachment) {
        const fileResponse = await axios.get(fileAttachment.url, {
          responseType: "text",
        });
        finalContentToAnalyze += `[FILE: ${fileAttachment.name}]\n${fileResponse.data}\n\n`;
        sourceInfo += `📄 File: \`${fileAttachment.name}\` `;
      }

      if (inputUrl && inputUrl.trim() !== "") {
        let targetUrl = inputUrl.trim();
        if (
          targetUrl.includes("github.com") &&
          !targetUrl.includes("raw.githubusercontent.com")
        ) {
          targetUrl = targetUrl
            .replace("github.com", "raw.githubusercontent.com")
            .replace("/blob/", "/");
        } else if (!targetUrl.includes("raw.githubusercontent.com")) {
          targetUrl = `https://r.jina.ai/${targetUrl}`;
        }
        const urlResponse = await axios.get(targetUrl, {
          responseType: "text",
          timeout: 15000,
        });
        finalContentToAnalyze += `[KONTEN URL]:\n${urlResponse.data}\n\n`;
        sourceInfo += `🔗 Tautan URL: <${inputUrl}>`;
      }

      const analysisPrompt = `${finalContentToAnalyze}\n\n[PERINTAH USER]: ${customInstruction}`;
      let resultText = "";
      let engineUsed = "";

      // Ambil catatan feedback untuk disuntikkan ke sistem analisis juga
      const dynamicSystemInstruction =
        baseSystemInstruction +
        (userRow && userRow.feedback_notes
          ? `\n[ATURAN DARI USER YANG WAJIB DIPATUHI: ${userRow.feedback_notes}]`
          : "");

      if (selectedMode === "mendalam") {
        engineUsed = "Groq Llama-3.3 70B 🔥 (Deep Analysis Mode)";
        const groqResponse = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `${dynamicSystemInstruction}\n\n${deepAnalysisInstruction}`,
            },
            { role: "user", content: analysisPrompt },
          ],
          model: "llama-3.3-70b-specdec",
          temperature: 0.5, // Mode analisis mendalam dibuat agak fokus agar akurat
        });
        resultText = groqResponse.choices[0].message.content;
      } else {
        engineUsed = "Gemini AI 🌟 (Standar Mode)";
        try {
          const aiResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: analysisPrompt,
            config: { systemInstruction: dynamicSystemInstruction },
          });
          resultText = aiResponse.text;
        } catch (geminiError) {
          engineUsed = "Groq Llama-3.1 🚀 (Standar Mode - Fallback)";
          const groqResponse = await groq.chat.completions.create({
            messages: [
              { role: "system", content: dynamicSystemInstruction },
              { role: "user", content: analysisPrompt },
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
          });
          resultText = groqResponse.choices[0].message.content;
        }
      }

      const replyChunks = splitMessage(resultText);
      await interaction.editReply({
        content: `📂 **Sirkuit Analisis Sukses!**\n> **Engine:** \`${engineUsed}\`\n${sourceInfo}\n\n${replyChunks[0]}`,
      });
      for (let i = 1; i < replyChunks.length; i++) {
        await interaction.followUp({ content: replyChunks[i] });
      }
    } catch (err) {
      await interaction.editReply(
        `Gomennasai Senpai... Sirkuit otak Hikari gagal menganalisis data tersebut. 🥺💢`,
      );
    }
  }
});

async function getBestEngine(prompt) {
    const p = prompt.toLowerCase();
    
    // Logika Berita/Riset -> Gemini (karena ada Google Search)
    if (p.includes("berita") || p.includes("hari ini") || p.includes("siapa") || p.includes("terbaru")) {
        return "gemini";
    }
    
    // Logika Teknis/Coding -> Groq (karena sangat cepat dan akurat untuk code)
    if (p.includes("code") || p.includes("error") || p.includes("bug") || p.includes("hitung") || p.includes("analisis")) {
        return "groq";
    }
    
    // Sisanya (Curhat, kreatif, tanya jawab santai) -> OpenAI
    return "openai";
}

// LOGIKA CHAT BIASA (DENGAN SUPER MEMORY SUMMARY + FEEDBACK SYNC)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
if (!message.mentions.has(client.user) && message.channel.id !== process.env.SPESIFIK_CHANNEL_ID) return;
// Ganti bagian pengambilan engine menjadi:
let engine = userRow?.engine_pref || "gemini"; // Default ke gemini jika belum ada pref

// Jika Senpai tidak mengunci di engine tertentu, biarkan Hikari memilih otomatis
if (engine === "gemini" || engine === "auto") {
    engine = await getBestEngine(promptText);
    console.log(`🤖 Hikari memilih otak: ${engine.toUpperCase()} untuk pertanyaan ini.`);
}
if (engine === "openai") {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: dynamicSystemInstruction }, { role: "user", content: finalPrompt }]
        });
        replyText = completion.choices[0].message.content;
    } catch (err) {
        console.error("OpenAI Error, fallback ke Groq:", err);
        // Fallback otomatis ke Groq jika OpenAI gagal
        const groqResponse = await groq.chat.completions.create({
            messages: [{ role: "system", content: dynamicSystemInstruction }, { role: "user", content: finalPrompt }],
            model: "llama-3.1-8b-instant"
        });
        replyText = groqResponse.choices[0].message.content + " *(Maaf Senpai, mode OpenAI sedang sibuk, Hikari pakai otak Groq dulu ya!)*";
    }
}
  const isDitag =
    message.mentions.has(client.user) && !message.mentions.everyone;
  const isDiChannelKhusus = message.channel.id === SPESIFIK_CHANNEL_ID;

  if (isDitag || isDiChannelKhusus) {
    const userId = message.author.id;
    const channelId = message.channel.id;
    const now = Date.now();

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME;
      if (now < expirationTime) return;
    }
    cooldowns.set(userId, now);
    setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME);

    let promptText = message.content.replace(`<@${client.user.id}>`, "").trim();
    const hasImage =
      message.attachments.size > 0 &&
      message.attachments.first().contentType?.startsWith("image/");

    if (!promptText && !hasImage)
      return message.reply("Halo Senpai! Ada yang bisa Hikari bantu? ✨");
    if (!promptText && hasImage)
      promptText = "Jelaskan gambar ini secara detail dan kreatif.";

    try {
      await message.channel.sendTyping();

      const userRow = db
        .prepare(
          "SELECT nickname, feedback_notes FROM user_memories WHERE user_id = ?",
        )
        .get(userId);

      // SUNTIKKAN FEEDBACK DARI DATABASE SECARA INSTAN KE SYSTEM PROMPT
      let dynamicSystemInstruction = baseSystemInstruction;
      if (userRow && userRow.feedback_notes) {
        dynamicSystemInstruction += `\n[PERINTAH MUTLAK DARI USER YANG WAJIB KAMU PATUHI SAAT INI JUGA: ${userRow.feedback_notes}]`;
      }

      let injectIdentity = "";
      if (userRow && userRow.nickname) {
        injectIdentity = `[INFO USER: Nama panggilan kesayangannya adalah "${userRow.nickname}". Selalu sapa dia dengan nama tersebut!]\n\n`;
      }

      let finalPrompt = injectIdentity + promptText;
      let replyText = "";
      let engineIndicator = "";

      const lowPrompt = promptText.toLowerCase();
      const butuhInternet =
        !hasImage &&
        (lowPrompt.includes("hari ini") ||
          lowPrompt.includes("sekarang") ||
          lowPrompt.includes("berita") ||
          lowPrompt.includes("terbaru"));

      // ENGINE 1: GEMINI UTAMA
      try {
        if (butuhInternet) {
          const searchResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptText,
            config: { tools: [{ googleSearch: {} }] },
          });
          finalPrompt =
            injectIdentity +
            `[INFO INTERNET TERBARU: ${searchResponse.text}]\n\nBerdasarkan info di atas, jawab dengan kreatif: ${promptText}`;
        }

        if (!botMemories.has(channelId)) {
          botMemories.set(
            channelId,
            ai.chats.create({
              model: "gemini-2.5-flash",
              config: { systemInstruction: dynamicSystemInstruction },
            }),
          );
        }

        let messageContent = hasImage
          ? [
              finalPrompt,
              {
                inlineData: {
                  data: Buffer.from(
                    (
                      await axios.get(message.attachments.first().url, {
                        responseType: "arraybuffer",
                      })
                    ).data,
                    "binary",
                  ).toString("base64"),
                  mimeType: message.attachments.first().contentType,
                },
              },
            ]
          : finalPrompt;

        const response = await botMemories
          .get(channelId)
          .sendMessage({ message: messageContent });
        replyText = response.text;

        // SYNC JALUR MEMORI LOKAL UNTUK GROQ
        if (!groqMemories.has(channelId)) {
          groqMemories.set(channelId, [
            { role: "system", content: dynamicSystemInstruction },
          ]);
        }
        const groqHistory = groqMemories.get(channelId);
        groqHistory[0].content = dynamicSystemInstruction; // Selalu update intruksi terbaru jika ada feedback
        groqHistory.push({ role: "user", content: promptText });
        groqHistory.push({ role: "assistant", content: replyText });

        // 🧠 FITUR AMBISI KEDUA: AUTO-SUMMARY BILA KONTEKS MEMORI OVERFLOW (Mencegah Amnesia)
        if (groqHistory.length > 25) {
          console.log(
            "🧠 Sirkuit Konteks Penuh, Mengompres Riwayat Obrolan agar Tidak Amnesia...",
          );
          const coreTexts = groqHistory
            .slice(1, 15)
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n");
          const summaryResponse = await groq.chat.completions.create({
            messages: [
              {
                role: "user",
                content: `Rangkum poin-poin penting, sejarah emosi, dan inti dari obrolan ini menjadi 3 kalimat padat:\n\n${coreTexts}`,
              },
            ],
            model: "llama-3.1-8b-instant",
          });
          const summary = summaryResponse.choices[0].message.content;
          groqHistory.splice(1, 14, {
            role: "system",
            content: `[RANGKUMAN SEJARAH OBROLAN SEBELUMNYA: ${summary}]`,
          });
        }
      } catch (geminiChatError) {
        // ENGINE 2: FALLBACK TO GROQ CADANGAN
        console.warn(
          "⚠️ Sirkuit Gemini Limit! Mengalihkan ke Groq Llama 3.1...",
        );
        engineIndicator =
          "\n\n*(⚡ Hikari saat ini menggunakan otak cadangan: Groq Llama-3.1)*";

        if (hasImage)
          return message.reply(
            "Gomennasai Senpai... Sirkuit pembaca gambar Gemini sedang kelelahan! 🥺💢",
          );

        if (!groqMemories.has(channelId)) {
          groqMemories.set(channelId, [
            { role: "system", content: dynamicSystemInstruction },
          ]);
        }

        const history = groqMemories.get(channelId);
        history[0].content = dynamicSystemInstruction; // Terapkan feedback aturan instan

        const lastSavedMessage = history[history.length - 1];
        if (!lastSavedMessage || lastSavedMessage.content !== finalPrompt) {
          history.push({ role: "user", content: finalPrompt });
        }

        // Jalankan kompresi history jika versi Groq juga penuh saat offline
        if (history.length > 25) {
          const coreTexts = history
            .slice(1, 15)
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n");
          const summaryResponse = await groq.chat.completions.create({
            messages: [
              {
                role: "user",
                content: `Rangkum poin penting obrolan ini menjadi 3 kalimat:\n\n${coreTexts}`,
              },
            ],
            model: "llama-3.1-8b-instant",
          });
          history.splice(1, 14, {
            role: "system",
            content: `[SEJARAH KOMPRES: ${summaryResponse.choices[0].message.content}]`,
          });
        }

        const groqResponse = await groq.chat.completions.create({
          messages: history,
          model: "llama-3.1-8b-instant",
          temperature: 0.9, // ✨ KREATIVITAS SPONTAN: Dinaikkan ke 0.9 biar jawaban lebih bervariasi dan penuh kejutan!
        });

        replyText = groqResponse.choices[0].message.content;
        history.push({ role: "assistant", content: replyText });
      }

      const finalReplyWithIndicator = replyText + engineIndicator;
      const cleanTextForVoice = replyText
        .replace(
          /[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g,
          "",
        )
        .replace(/[*_`~#]/g, "")
        .substring(0, 200);

      let voiceAttachment = null;
      try {
        const ttsUrl = googleTTS.getAudioUrl(cleanTextForVoice, {
          lang: "ja",
          slow: false,
          host: "https://translate.google.com",
        });
        const pcmResponse = await axios.get(ttsUrl, {
          responseType: "arraybuffer",
        });
        voiceAttachment = new AttachmentBuilder(Buffer.from(pcmResponse.data), {
          name: "hikari-voice.mp3",
        });
      } catch (err) {}

      const textChunks = splitMessage(finalReplyWithIndicator);
      if (voiceAttachment) {
        await message.reply({
          content: textChunks[0],
          files: [voiceAttachment],
        });
      } else {
        await message.reply(textChunks[0]);
      }

      for (let i = 1; i < textChunks.length; i++) {
        await message.channel.send(textChunks[i]);
      }
    } catch (error) {
      await message.reply(
        "Gomennasai Senpai... Sirkuit otak Hikari sedang korsleting! 🥺💢",
      );
    }
  }
});

client.login(DISCORD_TOKEN);
