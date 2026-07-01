export function splitMessage(text: string, maxLength = 2000): string[] {
  if (maxLength < 1) return [text];

  const chunks: string[] = [];
  let currentChunk = '';

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    let line = (lines[index] ?? '') + '\n';

    while (line.length > 0) {
      const remainingSpace = maxLength - currentChunk.length;

      if (remainingSpace === 0) {
        chunks.push(currentChunk);
        currentChunk = '';
        continue;
      }

      if (line.length <= remainingSpace) {
        currentChunk += line;
        line = '';
        continue;
      }

      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
        continue;
      }

      chunks.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}
