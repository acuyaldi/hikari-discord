import type { AIProvider, ChatRequest, ChatResponse } from './types';
import { AIProviderName } from './types';
import { GeminiProvider } from './providers/geminiProvider';
import { GroqProvider } from './providers/groqProvider';

export class ProviderManager {
  private readonly providers = new Map<AIProviderName, AIProvider>();

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: AIProviderName): AIProvider | undefined {
    return this.providers.get(name);
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const gemini = this.providers.get(AIProviderName.GEMINI);
    if (!gemini) throw new Error('Gemini provider not registered');
    return gemini.generate(request);
  }
}

export const providerManager = new ProviderManager();
providerManager.registerProvider(new GeminiProvider());
providerManager.registerProvider(new GroqProvider());
