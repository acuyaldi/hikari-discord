import type { AIProvider, ChatRequest, ChatResponse } from './types';
import { AIProviderName, TaskType } from './types';
import { AI_PROVIDER_ORDER, DEBUG_AI } from '../../config/env';
import { recordSuccess, recordFailure } from './providerMetrics';
import { GeminiProvider } from './providers/geminiProvider';
import { GroqProvider } from './providers/groqProvider';
import { HuggingFaceProvider } from './providers/huggingFaceProvider';
import { OpenRouterProvider } from './providers/openrouterProvider';
import {
  circuitBreaker as defaultCircuitBreaker,
  isTransientAIError,
  type CircuitBreaker,
} from './circuitBreaker';
import { markCooldown, recordHealthFailure, recordHealthSuccess } from './healthCache';
import { rankTargets } from './providerRanking';
import { resolveProviderOverride } from './providerOverride';

const DEBUG = DEBUG_AI;

const VALID_NAMES = new Set<string>(Object.values(AIProviderName));

function parseProviderOrder(raw: string): AIProviderName[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => VALID_NAMES.has(s)) as AIProviderName[];
}

const CONFIGURED_ORDER = parseProviderOrder(AI_PROVIDER_ORDER);

function applyProviderOverride(
  order: AIProviderName[],
  override: ReturnType<typeof resolveProviderOverride>,
  providers: Map<AIProviderName, AIProvider>,
  requiresVision: boolean,
): AIProviderName[] {
  if (override === 'auto') return order;
  if (requiresVision && !providers.get(override)?.supportsVision) return order;
  return [override, ...order.filter((name) => name !== override)];
}

export class ProviderManager {
  private readonly providers = new Map<AIProviderName, AIProvider>();
  private readonly circuitBreaker: CircuitBreaker;

  constructor(options: { circuitBreaker?: CircuitBreaker } = {}) {
    this.circuitBreaker = options.circuitBreaker ?? defaultCircuitBreaker;
  }

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: AIProviderName): AIProvider | undefined {
    return this.providers.get(name);
  }

  private capabilityFor(taskType: TaskType): ((p: AIProvider) => boolean) | null {
    switch (taskType) {
      case TaskType.CODING:
        return (p) => p.supportsCoding;
      case TaskType.VISION:
        return (p) => p.supportsVision;
      case TaskType.REASONING:
        return (p) => p.supportsReasoning;
      case TaskType.SEARCH:
        return (p) => p.supportsVision; // Gemini is the only provider with Google Search
      default:
        return null;
    }
  }

  private orderByCapability(base: AIProviderName[], taskType: TaskType): AIProviderName[] {
    const filter = this.capabilityFor(taskType);
    if (!filter) return base;
    const matching = base.filter((n) => { const p = this.providers.get(n); return p && filter(p); });
    const rest = base.filter((n) => !matching.includes(n));
    return [...matching, ...rest];
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const base =
      request.preferredProviders !== undefined && request.preferredProviders.length > 0
        ? request.preferredProviders
        : CONFIGURED_ORDER.length > 0
          ? CONFIGURED_ORDER
          : [AIProviderName.GEMINI];
    const capabilityOrder = request.hasImage
      ? base.filter((name) => this.providers.get(name)?.supportsVision)
      : this.orderByCapability(base, request.taskType);
    const rankedOrder = rankTargets(capabilityOrder) as AIProviderName[];
    const override = resolveProviderOverride(request.userId);
    const order = applyProviderOverride(rankedOrder, override, this.providers, request.hasImage);
    let lastError: unknown;

    if (DEBUG) {
      console.log(
        [
          '[Provider Ranking]',
          `task=${request.taskType.toUpperCase()}`,
          `order before: ${capabilityOrder.join(',')}`,
          `order after: ${rankedOrder.join(',')}`,
        ].join('\n'),
      );

      if (override !== 'auto') {
        console.log(
          [
            '[Provider Override]',
            `user=${request.userId}`,
            `override=${override}`,
            `forced first provider=${override}`,
          ].join('\n'),
        );
      }
    }

    for (const name of order) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      if (!this.circuitBreaker.isAvailable(name)) {
        const state = this.circuitBreaker.getState(name);
        if (state.openedUntil) markCooldown(name, state.openedUntil, state.lastError);
        continue;
      }

      const start = Date.now();
      try {
        const response = await provider.generate(request);
        const latencyMs = Date.now() - start;
        recordSuccess(name, latencyMs);
        recordHealthSuccess(name, latencyMs);
        this.circuitBreaker.recordSuccess(name);
        return response;
      } catch (err) {
        recordFailure(name);
        recordHealthFailure(name, err, isTransientAIError(err));
        this.circuitBreaker.recordFailure(name, err);
        const state = this.circuitBreaker.getState(name);
        if (state.isOpen && state.openedUntil) markCooldown(name, state.openedUntil, err);
        console.error(`${name} Error, trying next provider:`, err);
        lastError = err;

        const remaining = order.slice(order.indexOf(name) + 1);
        const hasNextVision = remaining.some((n) => this.providers.get(n)?.supportsVision);
        if (request.hasImage && !hasNextVision) {
          return {
            replyText: '',
            providerUsed: name,
            earlyReply: 'Pembaca gambarku lagi rewel. Coba lagi sebentar atau kirim gambar lain.',
          };
        }
      }
    }

    if (!lastError && order.some((name) => this.providers.has(name))) {
      throw new Error('All providers are temporarily unavailable due to circuit breaker cooldown');
    }

    throw lastError ?? new Error('All providers failed');
  }
}

export const providerManager = new ProviderManager();
providerManager.registerProvider(new GeminiProvider());
providerManager.registerProvider(new GroqProvider());
providerManager.registerProvider(new OpenRouterProvider());
providerManager.registerProvider(new HuggingFaceProvider());
