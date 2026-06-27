import { AttachmentBuilder } from 'discord.js';
import axios from 'axios';
import { getAudioUrl } from 'google-tts-api';

export async function generateVoice(text: string): Promise<AttachmentBuilder | null> {
  try {
    const cleanText = text
      .replace(/[-]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[‑-⛿]|\uD83E[\uDD00-\uDFFF]/g, '')
      .replace(/[*_`~#]/g, '')
      .substring(0, 200);

    const ttsUrl = getAudioUrl(cleanText, {
      lang: 'ja',
      slow: false,
      host: 'https://translate.google.com',
    });

    const pcmResponse = await axios.get<ArrayBuffer>(ttsUrl, { responseType: 'arraybuffer' });
    return new AttachmentBuilder(Buffer.from(pcmResponse.data), { name: 'hikari-voice.mp3' });
  } catch {
    return null;
  }
}
