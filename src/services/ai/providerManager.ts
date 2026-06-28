import type { AIProvider, ChatRequest, ChatResponse } from './types';
import { AIProviderName } from './types';
import { AI_PROVIDER_ORDER } from '../../config/env';
import { GeminiProvider } from './providers/geminiProvider';
import { GroqProvider } from './providers/groqProvider';
import { OpenRouterProvider } from './providers/openrouterProvider';

const VALID_NAMES = new Set<string>(Object.values(AIProviderName));

function parseProviderOrder(raw: string): AIProviderName[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => VALID_NAMES.has(s)) as AIProviderName[];
}

const CONFIGURED_ORDER = parseProviderOrder(AI_PROVIDER_ORDER);

export class ProviderManager {
  private readonly providers = new Map<AIProviderName, AIProvider>();

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: AIProviderName): AIProvider | undefined {
    return this.providers.get(name);
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const order = CONFIGURED_ORDER.length > 0 ? CONFIGURED_ORDER : [AIProviderName.GEMINI];
    let lastError: unknown;

    for (const name of order) {
      const provider = this.providers.get(name);
      if (!provider) continue;

      try {
        return await provider.generate(request);
      } catch (err) {
        console.error(`${name} Error, trying next provider:`, err);
        lastError = err;

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
