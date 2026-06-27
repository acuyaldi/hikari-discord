import ai from '../ai/gemini';
import type { GroqMessage } from '../types';

const botMemories = new Map<string, any>();
const groqMemories = new Map<string, GroqMessage[]>();

export function getGeminiChat(channelId: string, systemInstruction: string): any {
  if (!botMemories.has(channelId)) {
    botMemories.set(
      channelId,
      ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction },
      }),
    );
  }
  return botMemories.get(channelId);
}

export function getGroqHistory(channelId: string, systemInstruction: string): GroqMessage[] {
  if (!groqMemories.has(channelId)) {
    groqMemories.set(channelId, [{ role: 'system', content: systemInstruction }]);
  }
  const history = groqMemories.get(channelId)!;
  history[0].content = systemInstruction;
  return history;
}

export function clearMemory(channelId: string): void {
  botMemories.delete(channelId);
  groqMemories.delete(channelId);
}
