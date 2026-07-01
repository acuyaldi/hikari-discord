import { TTS_TRIGGER_KEYWORDS } from '../config/env';

export function hasVoiceIntent(
  messageText: string,
  keywords: readonly string[] = TTS_TRIGGER_KEYWORDS,
): boolean {
  try {
    const normalizedMessage = messageText.toLocaleLowerCase();
    return keywords.some((keyword) =>
      normalizedMessage.includes(keyword.toLocaleLowerCase()),
    );
  } catch {
    return false;
  }
}
