import { all, create } from 'mathjs';
import type { ToolDefinition, ToolResult } from '../types';

const math = create(all);
const evaluate = math.evaluate;

math.import({
  import: () => {
    throw new Error('Function import is disabled');
  },
  createUnit: () => {
    throw new Error('Function createUnit is disabled');
  },
  reviver: () => {
    throw new Error('Function reviver is disabled');
  },
  evaluate: () => {
    throw new Error('Function evaluate is disabled');
  },
  parse: () => {
    throw new Error('Function parse is disabled');
  },
  simplify: () => {
    throw new Error('Function simplify is disabled');
  },
  derivative: () => {
    throw new Error('Function derivative is disabled');
  },
  resolve: () => {
    throw new Error('Function resolve is disabled');
  },
}, { override: true });

function fail(error: string): ToolResult {
  return { success: false, error };
}

function getExpression(args: unknown): string | null {
  if (typeof args !== 'object' || args === null || !('expression' in args)) return null;
  const expression = (args as { expression?: unknown }).expression;
  return typeof expression === 'string' ? expression : null;
}

function formatResult(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Calculation result is not finite');
    }
    return math.format(value, { precision: 14 });
  }

  return math.format(value as never, { precision: 14 });
}

export const calculatorTool: ToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression and return the result.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The mathematical expression to evaluate, for example "sqrt(16) + 2^3".',
      },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  execute: async (args: unknown): Promise<ToolResult> => {
    const expression = getExpression(args);
    if (!expression?.trim()) {
      return fail('A non-empty string expression is required.');
    }

    try {
      const value = evaluate(expression);
      return { success: true, data: formatResult(value) };
    } catch (error) {
      return fail(`Unable to calculate expression: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
