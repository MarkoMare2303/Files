import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIosSafari, isStandalone } from './useInstallPrompt';
import { urlBase64ToUint8Array } from '../push/usePushSubscription';

/**
 * Tests der PWA-Erkennung.
 *
 * Diese Funktionen entscheiden, ob dem Nutzer eine Installations-Einladung
 * oder eine Anleitung gezeigt wird — und ob Push überhaupt angeboten wird.
 * Eine falsche Erkennung führt direkt zu einer toten Schaltfläche (§55).
 */
function setUserAgent(value: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

function setDisplayMode(standalone: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('standalone') ? standalone : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'standalone');
});

describe('isIosSafari', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1';
  const IPAD_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  const ANDROID_CHROME =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

  it('erkennt Safari auf dem iPhone', () => {
    setUserAgent(IPHONE_SAFARI);
    expect(isIosSafari()).toBe(true);
  });

  it('erkennt Chrome auf iOS NICHT als installierbar — dort fehlt „Zum Home-Bildschirm"', () => {
    setUserAgent(IPHONE_CHROME);
    expect(isIosSafari()).toBe(false);
  });

  it('erkennt iPadOS, das sich als Mac ausgibt (Touch-Punkte verraten es)', () => {
    setUserAgent(IPAD_SAFARI, 5);
    expect(isIosSafari()).toBe(true);
  });

  it('unterscheidet einen echten Mac vom iPad', () => {
    setUserAgent(MAC_SAFARI, 0);
    expect(isIosSafari()).toBe(false);
  });

  it('erkennt Android-Chrome nicht als iOS', () => {
    setUserAgent(ANDROID_CHROME);
    expect(isIosSafari()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('erkennt den Standalone-Modus über display-mode', () => {
    setDisplayMode(true);
    expect(isStandalone()).toBe(true);
  });

  it('erkennt den Browser-Tab als nicht installiert', () => {
    setDisplayMode(false);
    expect(isStandalone()).toBe(false);
  });

  it('erkennt iOS über navigator.standalone', () => {
    setDisplayMode(false);
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('dekodiert einen base64url-Schlüssel ohne Padding', () => {
    // "Hallo" in base64url ohne Padding.
    expect(Array.from(urlBase64ToUint8Array('SGFsbG8'))).toEqual([72, 97, 108, 108, 111]);
  });

  it('übersetzt die base64url-Sonderzeichen - und _', () => {
    // 0xFB 0xEF entspricht "++8" in Standard-Base64 bzw. "--8" in base64url.
    const decoded = urlBase64ToUint8Array('--8');
    expect(Array.from(decoded)).toEqual([251, 239]);
  });

  it('liefert die für PushManager nötige Länge eines VAPID-Schlüssels', () => {
    // Ein echter öffentlicher VAPID-Schlüssel ist ein unkomprimierter
    // P-256-Punkt: 65 Byte, base64url 87 Zeichen.
    const key = 'B'.repeat(87);
    expect(urlBase64ToUint8Array(key).byteLength).toBe(65);
  });

  it('gibt einen echten ArrayBuffer zurück (PushManager akzeptiert nichts anderes)', () => {
    expect(urlBase64ToUint8Array('SGFsbG8').buffer).toBeInstanceOf(ArrayBuffer);
  });
});
