// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  createExportDownload,
  inlineSvgImageSources,
  retainSvgCluster,
} from '../../frontend/src/lib/svgExport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('SVG export helpers', () => {
  it('inlines persisted image URLs before SVG rasterization', async () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', '/uploads/product.png');
    svg.appendChild(image);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    });

    await inlineSvgImageSources(svg, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('/uploads/product.png', { credentials: 'include' });
    expect(image.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
  });

  it('falls back to the authenticated image proxy when browser fetch is blocked', async () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', 'https://cdn.example.test/generated.png');
    svg.appendChild(image);
    const proxiedDataUrl = 'data:image/png;base64,UFJPWFlfSU1BR0U=';
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data_url: proxiedDataUrl }),
      });

    await inlineSvgImageSources(svg, { fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://cdn.example.test/generated.png', {
      credentials: 'include',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/assets/image-data', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://cdn.example.test/generated.png' }),
    }));
    expect(image.getAttribute('href')).toBe(proxiedDataUrl);
  });

  it('reports the exact failed image instead of a generic fetch error', async () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', '/uploads/missing-product.png');
    svg.appendChild(image);
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: '素材文件不存在' }),
      });

    await expect(inlineSvgImageSources(svg, { fetchImpl })).rejects.toThrow(
      '图片资源读取失败：missing-product.png（素材文件不存在）',
    );
  });

  it('keeps only element groups belonging to the exported cluster', () => {
    const world = document.createElementNS(SVG_NS, 'g');
    for (const id of ['first', 'second']) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'svg-element-group');
      group.setAttribute('data-element-id', id);
      world.appendChild(group);
    }

    retainSvgCluster(world, new Set(['second']));

    expect(world.querySelectorAll('.svg-element-group')).toHaveLength(1);
    expect(world.querySelector('.svg-element-group').getAttribute('data-element-id')).toBe('second');
  });

  it('returns one image directly for a single-file export', async () => {
    const image = new Blob(['one'], { type: 'image/png' });
    const download = await createExportDownload([{ name: 'one.png', blob: image }]);

    expect(download).toMatchObject({ filename: 'one.png', archived: false });
    expect(download.blob).toBe(image);
  });

  it('packages every image into one ZIP for a multi-image export', async () => {
    const files = Array.from({ length: 6 }, (_, index) => ({
      name: `canvas-export-${String(index + 1).padStart(2, '0')}.png`,
      blob: new Blob([`image-${index + 1}`], { type: 'image/png' }),
    }));
    const download = await createExportDownload(files, { timestamp: 12345 });
    const archive = new Uint8Array(await download.blob.arrayBuffer());
    const archiveText = new TextDecoder().decode(archive);

    expect(download).toMatchObject({
      filename: 'canvas-export-12345.zip',
      archived: true,
    });
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    files.forEach((file) => expect(archiveText).toContain(file.name));
    expect(archiveText).toContain('image-6');
  });
});
