/**
 * 일본어 음성 해설 — 브라우저 SpeechSynthesis (ja-JP 보이스).
 * Chrome: 'Google 日本語', macOS: 'Kyoko' 등. 없으면 조용히 무시.
 */
export class VoiceManager {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  private lastMajorAt = 0;

  constructor() {
    if (!this.supported) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      // 자연스러운 순: Google 日本語 > Kyoko/O-ren(macOS) > 아무 ja
      const ja = voices.filter((v) => v.lang.toLowerCase().startsWith('ja'));
      this.voice =
        ja.find((v) => /google/i.test(v.name)) ??
        ja.find((v) => /kyoko|o-?ren|otoya/i.test(v.name)) ??
        ja[0] ??
        null;
    };
    pick();
    window.speechSynthesis.addEventListener('voiceschanged', pick);
  }

  get available(): boolean {
    return this.supported && this.voice !== null;
  }

  speak(text: string, major: boolean): void {
    if (!this.enabled || !this.supported) return;
    const synth = window.speechSynthesis;
    const now = performance.now();
    // 큰 사건은 현재 발화를 끊고 즉시, 일반 멘트는 말하는 중이면 건너뜀
    if (major) {
      synth.cancel();
      this.lastMajorAt = now;
    } else if (synth.speaking || synth.pending || now - this.lastMajorAt < 800) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[!！]{2,}/g, '！').replace(/\.\.\./g, '…'));
    u.lang = 'ja-JP';
    if (this.voice) u.voice = this.voice;
    // 흥분한 경마 실황 톤: 빠르고 약간 높게
    u.rate = major ? 1.45 : 1.3;
    u.pitch = major ? 1.2 : 1.05;
    u.volume = 1;
    synth.speak(u);
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
