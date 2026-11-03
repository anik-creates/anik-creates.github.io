// Client-side image handling for the admin portal: resize, compress, optional background removal.

const supportsWebpEncode = (() => {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }
})();

const loadImage = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image')); };
  img.src = url;
});

/** Resize to fit maxSize and re-encode. Keeps transparency when keepAlpha is set. */
export async function processImage(file, { maxSize = 1600, keepAlpha = false, quality = 0.85 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > 25 * 1024 * 1024) throw new Error('Image is larger than 25 MB');
  const img = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const type = supportsWebpEncode ? 'image/webp' : keepAlpha ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((r) => canvas.toBlob(r, type, quality));
  return { blob, ext: type.split('/')[1].replace('jpeg', 'jpg'), width: w, height: h };
}

/** Builds a unique repo path for an upload. */
export function uploadPath(name, ext, dir = 'assets/uploads') {
  const slug = String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  const y = new Date().getFullYear();
  return `${dir}/${y}/${slug}-${rand}.${ext}`;
}

/**
 * Removes the background from a photo in the browser (model downloads once, ~40 MB).
 * Runs @imgly/background-removal inside a sandboxed iframe (opaque origin) so the library
 * never shares a context with the GitHub token. Returns a transparent PNG blob.
 */
let frame = null, frameReady = null, seq = 0;
function bgFrame() {
  if (frameReady) return frameReady;
  frameReady = new Promise((resolve, reject) => {
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    frame.src = new URL('bg-remove.html', import.meta.url).href;
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow || e.data?.type !== 'ready') return;
      removeEventListener('message', onMsg);
      resolve(frame.contentWindow);
    };
    addEventListener('message', onMsg);
    setTimeout(() => reject(new Error('Background removal helper did not start')), 20000);
    document.body.appendChild(frame);
  });
  frameReady.catch(() => { frameReady = null; frame?.remove(); });
  return frameReady;
}

export async function removeBackground(blob, onProgress = () => {}) {
  const win = await bgFrame();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.source !== win || e.data?.id !== id) return;
      if (e.data.type === 'progress') return onProgress(e.data.key, e.data.value);
      removeEventListener('message', onMsg);
      if (e.data.type === 'done') resolve(e.data.blob);
      else reject(new Error(e.data.message || 'Background removal failed'));
    };
    addEventListener('message', onMsg);
    win.postMessage({ type: 'remove', id, blob }, '*');
  });
}
