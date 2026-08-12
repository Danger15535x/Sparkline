export function detectDevice() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const isAndroid = /android/i.test(ua) || platform.toLowerCase().includes('android');
  const isIPhone = /iphone|ipod/i.test(ua);
  const isIPad = /ipad/i.test(ua) || (navigator.maxTouchPoints > 1 && /macintosh|Mac/.test(platform));
  const isIOS = isIPhone || isIPad;
  const isWindows = /win/i.test(platform) || /windows/i.test(ua);
  const isMacOS = /mac/i.test(platform) && !isIPhone && !isIPad;
  const isLinux = /linux/i.test(platform) && !isAndroid;
  const browser = (() => {
    if (/edg\//i.test(ua)) return 'edge';
    if (/opr\//i.test(ua)) return 'opera';
    if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
    if (/firefox|fxios/i.test(ua)) return 'firefox';
    if (/safari/i.test(ua)) return 'safari';
    return 'unknown';
  })();

  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const small = window.innerWidth < 768;

  return { ua, isAndroid, isIOS, isIPhone, isIPad, isWindows, isMacOS, isLinux, browser, touch, small };
}

export function isPwaInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function supportsPwaInstall() {
  return 'serviceWorker' in navigator && 'beforeinstallprompt' in window;
}

export async function checkNotificationSupport() {
  if (!('Notification' in window)) return 'unsupported';
  const perms = await Notification.requestPermission();
  return perms === 'granted' ? 'granted' : 'denied';
}

export function showNotification(title, body, icon) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const n = new Notification(title, {
      body,
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: title + body,
      renotify: false,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* older browsers */
  }
}

export async function qrScanSupported() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

export function vibrate(pattern = [20, 40, 20]) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}