import { zipSync } from 'fflate';

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('图片转换失败'));
  reader.readAsDataURL(blob);
});

const readableSourceLabel = (source) => {
  const value = String(source || '未知图片');
  try {
    const pathname = new URL(value, globalThis.location?.origin || 'http://localhost').pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).pop() || pathname).slice(0, 100);
  } catch {
    return value.slice(0, 100);
  }
};

async function fetchImageDataUrl(rawSource, resolvedSource, fetchImpl) {
  let directError;
  try {
    const response = await fetchImpl(resolvedSource, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!String(blob.type || '').startsWith('image/')) {
      throw new Error('返回内容不是图片');
    }
    return await blobToDataUrl(blob);
  } catch (error) {
    directError = error;
  }

  if (String(rawSource).startsWith('blob:')) {
    throw new Error(`图片资源读取失败：${readableSourceLabel(rawSource)}（临时图片已失效，请重新上传）`);
  }

  try {
    const proxySource = /^(?:uploads|assets)\//.test(String(rawSource))
      ? `/${rawSource}`
      : rawSource;
    const proxyResponse = await fetchImpl('/api/assets/image-data', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: proxySource }),
    });
    const result = await proxyResponse.json().catch(() => ({}));
    if (!proxyResponse.ok || !String(result.data_url || '').startsWith('data:image/')) {
      throw new Error(result.error || result.message || `HTTP ${proxyResponse.status}`);
    }
    return result.data_url;
  } catch (proxyError) {
    const reason = proxyError?.message || directError?.message || '网络请求失败';
    throw new Error(`图片资源读取失败：${readableSourceLabel(rawSource)}（${reason}）`);
  }
}

/** Inline SVG image hrefs so a serialized blob remains self-contained. */
export async function inlineSvgImageSources(
  svgElement,
  { resolveUrl = (url) => url, fetchImpl = fetch } = {},
) {
  const imageNodes = Array.from(svgElement.querySelectorAll('image'));
  await Promise.all(imageNodes.map(async (node) => {
    const rawSource = node.getAttribute('href')
      || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      || '';
    if (!rawSource || rawSource.startsWith('data:image/')) return;

    const source = resolveUrl(rawSource);
    const dataUrl = await fetchImageDataUrl(rawSource, source, fetchImpl);
    node.setAttribute('href', dataUrl);
    node.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
  }));
  return svgElement;
}

/** Remove cloned SVG element groups that are outside the selected cluster. */
export function retainSvgCluster(worldGroup, clusterIds) {
  const allowed = clusterIds instanceof Set ? clusterIds : new Set(clusterIds || []);
  const groups = Array.from(worldGroup.querySelectorAll(':scope > .svg-element-group'));
  groups.forEach((group) => {
    const elementId = group.getAttribute('data-element-id');
    if (!elementId || !allowed.has(elementId)) group.remove();
  });
  return worldGroup;
}

/**
 * Use one browser download for a multi-image export. Browsers commonly block
 * the later clicks when an app tries to start several automatic downloads.
 */
export async function createExportDownload(files, { timestamp = Date.now() } = {}) {
  const validFiles = (Array.isArray(files) ? files : []).filter(
    (file) => file?.blob instanceof Blob && String(file?.name || '').trim(),
  );
  if (validFiles.length === 0) throw new Error('没有可下载的导出文件');
  if (validFiles.length === 1) {
    return { blob: validFiles[0].blob, filename: validFiles[0].name, archived: false };
  }

  const entries = {};
  for (const file of validFiles) {
    entries[file.name] = new Uint8Array(await file.blob.arrayBuffer());
  }
  // PNG/JPEG files are already compressed. Store mode avoids blocking the UI
  // with redundant recompression while still producing a standards-based ZIP.
  const archive = zipSync(entries, { level: 0 });
  return {
    blob: new Blob([archive], { type: 'application/zip' }),
    filename: `canvas-export-${timestamp}.zip`,
    archived: true,
  };
}
