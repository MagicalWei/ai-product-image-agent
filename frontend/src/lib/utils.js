import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * 统一解析素材 URL，返回可直接用于 <img src> 或画布加载的路径。
 * - https://... / data:image/... → 原样返回
 * - /uploads/xxx.png / /assets/xxx.png → 原样返回
 * - uploads/xxx.png → /uploads/xxx.png（由 express.static(public/uploads) 提供）
 * - assets/xxx.png → /assets/xxx.png
 * - 裸文件名 abc.png → /uploads/abc.png
 * - null/undefined/非字符串 → null
 */
export function resolveAssetUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const normalized = url.trim();
  if (!normalized) return null;
  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('/')
  ) return normalized;
  if (normalized.startsWith('uploads/')) return '/' + normalized;
  if (normalized.startsWith('assets/')) return '/' + normalized;
  return '/uploads/' + normalized;
}
