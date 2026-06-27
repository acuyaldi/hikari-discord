import axios from 'axios';

export async function downloadDiscordImage(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
  const data = Buffer.from(response.data).toString('base64');
  const mimeType = (response.headers['content-type'] as string).split(';')[0];
  return { data, mimeType };
}
