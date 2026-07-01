export enum AIProviderName {
  GEMINI = 'gemini',
  GROQ = 'groq',
  OPENROUTER = 'openrouter',
}

export enum TaskType {
  GENERAL = 'general',
  CODING = 'coding',
  REASONING = 'reasoning',
  SEARCH = 'search',
  CREATIVE = 'creative',
  VISION = 'vision',
}

export interface ChatRequest {
  userId: string;
  guildId: string | null;
  channelId: string;
  /** Raw user message. */
  promptText: string;
  /** Nickname prefix, e.g. "[INFO USER: ...]\n\n" or "". Required by GeminiProvider for internet-search rebuild. */
  identityPrefix: string;
  /** identityPrefix + promptText (or overridden inside GeminiProvider for internet search). */
  finalPrompt: string;
  dynamicSystemInstruction: string;
  hasImage: boolean;
  imageUrl?: string;
  taskType: TaskType;
  preferredProviders?: AIProviderName[];
}

export interface ChatResponse {
  replyText: string;
  providerUsed: AIProviderName;
  /** When set, the caller must send this text directly and skip normal reply handling. */
  earlyReply?: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  readonly supportsVision: boolean;
  readonly supportsReasoning: boolean;
  readonly supportsCoding: boolean;
  generate(request: ChatRequest): Promise<ChatResponse>;
}
