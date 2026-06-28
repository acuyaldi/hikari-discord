import type { AIProvider, ChatRequest, ChatResponse } from './types';
import { AIProviderName } from './types';

export class ProviderManager {
  private readonly providers = new Map<AIProviderName, AIProvider>();

  registerProvider(_provider: AIProvider): void {
    throw new Error('Not implemented');
  }

  getProvider(_name: AIProviderName): AIProvider | undefined {
    throw new Error('Not implemented');
  }

  async generate(_request: ChatRequest): Promise<ChatResponse> {
    throw new Error('Not implemented');
  }
}

export const providerManager = new ProviderManager();
