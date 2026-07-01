import { TOOL_EXECUTION_TIMEOUT_MS } from '../../config/env';
import type { ToolDefinition, ToolResult } from './types';

const registry = new Map<string, ToolDefinition>();

function fail(error: string): ToolResult {
  return { success: false, error };
}

function timeoutResult(name: string, timeoutMs: number): Promise<ToolResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(fail(`Tool "${name}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

export function registerTool(definition: ToolDefinition): void {
  registry.set(definition.name, definition);
}

export function getRegisteredTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function clearRegisteredTools(): void {
  registry.clear();
}

export async function executeTool(name: string, args: unknown): Promise<ToolResult> {
  const definition = registry.get(name);
  if (!definition) return fail(`Tool "${name}" is not registered`);

  try {
    const result = await Promise.race([
      definition.execute(args),
      timeoutResult(name, TOOL_EXECUTION_TIMEOUT_MS),
    ]);

    if (!result.success) {
      return fail(result.error ?? `Tool "${name}" failed`);
    }

    return result;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
