import type { AIProvider, ChatRequest, ChatResponse } from './types';
import { AIProviderName, TaskType } from './types';
import { GeminiProvider } from './providers/geminiProvider';
import { GroqProvider } from './providers/groqProvider';
import { OpenRouterProvider } from './providers/openrouterProvider';

export class ProviderManager {
  private readonly providers = new Map<AIProviderName, AIProvider>();

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: AIProviderName): AIProvider | undefined {
    return this.providers.get(name);
  }

  private getProviderOrder(taskType: TaskType): AIProviderName[] {
    switch (taskType) {
      case TaskType.CODING:
        return [AIProviderName.GROQ, AIProviderName.GEMINI, AIProviderName.OPENROUTER];
      case TaskType.SEARCH:
      case TaskType.VISION:
        return [AIProviderName.GEMINI, AIProviderName.GROQ, AIProviderName.OPENROUTER];
      default:
        return [AIProviderName.GEMINI, AIProviderName.GROQ, AIProviderName.OPENROUTER];
    }
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const order = this.getProviderOrder(request.taskType);
    let lastError: unknown;

    for (const name of order) {
      const provider = this.providers.get(name);
      if (!provider) continue;

      try {
        return await provider.generate(request);
      } catch (err) {
        console.error(`${name} Error, trying next provider:`, err);
        lastError = err;

        // If the request has an image and no remaining provider supports vision, abort gracefully.
        const remaining = order.slice(order.indexOf(name) + 1);
        const hasNextVision = remaining.some((n) => this.providers.get(n)?.supportsVision);
        if (request.hasImage && !hasNextVision) {
          return {
            replyText: '',
            providerUsed: name,
            earlyReply: 'Gomennasai Senpai... Sirkuit pembaca gambar Gemini sedang kelelahan! 🥺💢',
          };
        }
      }
    }

    throw lastError ?? new Error('All providers failed');
  }
}

export const providerManager = new ProviderManager();
providerManager.registerProvider(new GeminiProvider());
providerManager.registerProvider(new GroqProvider());
providerManager.registerProvider(new OpenRouterProvider());
