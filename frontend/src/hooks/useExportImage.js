// src/hooks/useExportImage.js
import { useState, useCallback } from 'react';

/**
 * Custom hook for exporting the canvas/design as an image.
 *
 * Returns:
 *   - exportAsPNG(source, filename)
 *   - exportAsJPEG(source, filename, quality)
 *   - exportComposite(versionData, options)
 *   - isExporting
 *
 * The `source` argument can be:
 *   - A Konva Stage reference (from the InfiniteCanvas workspace)
 *   - A regular HTMLCanvasElement
 *
 * The composite export function creates a temporary canvas and draws:
 *   1. Background image
 *   2. Product cutout with transform (position, scale, rotation)
 *   3. Text layers with styles
 * then exports the result as PNG or JPEG.
 */
const useExportImage = () => {
  const [isExporting, setIsExporting] = useState(false);

  /**
   * Convert a source (Konva Stage or HTMLCanvasElement) to a Blob.
   */
  const getBlobFromSource = useCallback(async (source, mimeType, quality = 0.92) => {
    // Konva Stage
    if (source && typeof source.toDataURL === 'function' && typeof source.toBlob === 'function') {
      return new Promise((resolve, reject) => {
        source.toBlob(resolve, mimeType, quality);
      });
    }

    // Konva Stage alternative (only has toDataURL, no toBlob)
    if (source && typeof source.toDataURL === 'function' && source.attrs) {
      const dataURL = source.toDataURL({ mimeType, quality });
      const res = await fetch(dataURL);
      return res.blob();
    }

    // Regular HTMLCanvasElement
    if (source instanceof HTMLCanvasElement) {
      return new Promise((resolve, reject) => {
        source.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob returned null'));
          },
          mimeType,
          quality
        );
      });
    }

    throw new Error('Unsupported export source: must be a Konva Stage or HTMLCanvasElement');
  }, []);

  /**
   * Trigger a file download via a temporary <a> element.
   */
  const triggerDownload = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoking so the download actually starts
    setTimeout(() => URL.revokeObjectURL(url), 200);
  }, []);

  /**
   * Export the given source as a PNG file.
   */
  const exportAsPNG = useCallback(
    async (source, filename = 'design-export.png') => {
      setIsExporting(true);
      try {
        const blob = await getBlobFromSource(source, 'image/png');
        triggerDownload(blob, filename);
      } finally {
        setIsExporting(false);
      }
    },
    [getBlobFromSource, triggerDownload]
  );

  /**
   * Export the given source as a JPEG file.
   */
  const exportAsJPEG = useCallback(
    async (source, filename = 'design-export.jpg', quality = 0.92) => {
      setIsExporting(true);
      try {
        const blob = await getBlobFromSource(source, 'image/jpeg', quality);
        triggerDownload(blob, filename);
      } finally {
        setIsExporting(false);
      }
    },
    [getBlobFromSource, triggerDownload]
  );

  /**
   * Load an HTMLImageElement from a URL (handles both asset paths and data URIs).
   */
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image: ' + src));
      img.src = src;
    });
  };

  /**
   * Composite export: build a temporary canvas from version data and export it.
   *
   * versionData shape (matches the version snapshot in App.jsx):
   * {
   *   image: string (background image path),
   *   productCutout: string|null (data URI or path),
   *   productTransform: { x, y, scaleX, scaleY, rotation }|null,
   *   adText: { title, desc, tag },
   *   textPositions: { title: {x,y}, desc: {x,y}, tag: {x,y} },  // percentages
   *   textStyles: { title: {color,fontSize,bg,weight,align}, ... },
   *   aspect: '1:1'|'3:4'|'detail'
   * }
   *
   * options: { format: 'png'|'jpeg', quality: number, filename: string, scale: number }
   */
  const exportComposite = useCallback(
    async (versionData, options = {}) => {
      const { format = 'png', quality = 0.92, filename, scale = 1 } = options;
      setIsExporting(true);
      let tempCanvas = null;

      try {
        const aspect = versionData.aspect || '1:1';
        const isDetail = aspect === 'detail';
        const canvasWidth = (aspect === '1:1' ? 800 : 640) * scale;
        const canvasHeight = (aspect === '1:1' ? 800 : isDetail ? 1080 : 853) * scale;

        tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasWidth;
        tempCanvas.height = canvasHeight;
        const ctx = tempCanvas.getContext('2d');

        // White base
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // 1. Draw background image
        const bgSrc = versionData.image
          ? (versionData.image.startsWith('data:') || versionData.image.startsWith('http')
              ? versionData.image
              : 'assets/' + versionData.image)
          : null;

        if (bgSrc) {
          try {
            const bgImg = await loadImage(bgSrc);
            ctx.drawImage(bgImg, 0, 0, canvasWidth, canvasHeight);
          } catch (e) {
            // If background fails to load, draw a grey placeholder
            ctx.fillStyle = '#e5e7eb';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          }
        }

        // 2. Draw product cutout with transform
        if (versionData.productCutout) {
          try {
            const cutoutImg = await loadImage(versionData.productCutout);
            const transform = versionData.productTransform || {
              x: 206,
              y: 206,
              scaleX: 0.85,
              scaleY: 0.85,
              rotation: 0,
            };

            const prodBaseSize = 200;
            const cutoutW = prodBaseSize * transform.scaleX * (canvasWidth / 400);
            const cutoutH = prodBaseSize * transform.scaleY * (canvasHeight / 400);
            const cutoutX = (transform.x / 400) * canvasWidth - cutoutW / 2;
            const cutoutY = (transform.y / 400) * canvasHeight - cutoutH / 2;

            ctx.save();
            ctx.translate(cutoutX + cutoutW / 2, cutoutY + cutoutH / 2);
            if (transform.rotation) {
              ctx.rotate((transform.rotation * Math.PI) / 180);
            }
            ctx.drawImage(cutoutImg, -cutoutW / 2, -cutoutH / 2, cutoutW, cutoutH);
            ctx.restore();
          } catch (e) {
            // Skip product layer if image fails
          }
        }

        // 3. Draw text layers
        const drawTextLayer = (text, pos, style) => {
          if (!text) return;
          const x = (pos.x / 100) * canvasWidth;
          const y = (pos.y / 100) * canvasHeight;
          const fontSize = (style.fontSize || 16) * (canvasWidth / 400);

          ctx.font = `${style.weight || 'normal'} ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
          ctx.textAlign = style.align || 'left';
          ctx.textBaseline = 'top';

          // Measure text for background rectangle
          const metrics = ctx.measureText(text);
          const textHeight = fontSize * 1.3;
          const textWidth = metrics.width;

          let bgX = x;
          if (style.align === 'center') {
            bgX = x - textWidth / 2;
          } else if (style.align === 'right') {
            bgX = x - textWidth;
          }

          if (style.bg) {
            ctx.fillStyle = style.bg;
            ctx.fillRect(bgX - 4, y - 2, textWidth + 8, textHeight + 4);
          }

          ctx.fillStyle = style.color || '#ffffff';
          ctx.fillText(text, x, y);
        };

        if (versionData.adText?.title && versionData.textPositions?.title) {
          drawTextLayer(
            versionData.adText.title,
            versionData.textPositions.title,
            versionData.textStyles?.title || {}
          );
        }

        if (versionData.adText?.desc && versionData.textPositions?.desc) {
          drawTextLayer(
            versionData.adText.desc,
            versionData.textPositions.desc,
            versionData.textStyles?.desc || {}
          );
        }

        if (versionData.adText?.tag && versionData.textPositions?.tag) {
          drawTextLayer(
            versionData.adText.tag,
            versionData.textPositions.tag,
            versionData.textStyles?.tag || {}
          );
        }

        // 4. Export as PNG/JPEG blob
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const blob = await new Promise((resolve, reject) => {
          tempCanvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error('Composite canvas toBlob returned null'));
            },
            mimeType,
            quality
          );
        });

        // 5. Trigger download
        const defaultName =
          format === 'jpeg' ? 'design-export.jpg' : 'design-export.png';
        triggerDownload(blob, filename || defaultName);
      } finally {
        if (tempCanvas) {
          tempCanvas.width = 0;
          tempCanvas.height = 0;
        }
        setIsExporting(false);
      }
    },
    [triggerDownload]
  );

  return {
    exportAsPNG,
    exportAsJPEG,
    exportComposite,
    isExporting,
  };
};

export default useExportImage;
