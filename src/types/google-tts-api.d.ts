declare module 'google-tts-api' {
  interface AudioUrlOptions {
    lang?: string;
    slow?: boolean;
    host?: string;
  }
  export function getAudioUrl(text: string, options?: AudioUrlOptions): string;
}
