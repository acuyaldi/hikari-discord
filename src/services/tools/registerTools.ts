import { calculatorTool } from './implementations/calculatorTool';
import { registerTool } from './toolRegistry';

export function registerDefaultTools(): void {
  registerTool(calculatorTool);
}
