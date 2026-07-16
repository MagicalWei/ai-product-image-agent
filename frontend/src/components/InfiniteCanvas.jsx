import React, { useState, useEffect, useRef, useImperativeHandle } from 'react';
import { Move, Hand, Pencil, Square, Circle, ArrowUpRight, Type, StickyNote, Trash2, Sun, Moon, Plus, Minus, Maximize2, RotateCcw, Cpu, MessageSquare, Layers, Undo, Redo, Send, Image as ImageIcon, Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Grid, Copy, ChevronDownIcon, User, Lightbulb, ShieldAlert, Zap, X } from 'lucide-react';
import * as Accordion from '@radix-ui/react-accordion';
import './InfiniteCanvas.css';
import ProductAnalysisCard from './ProductAnalysisCard';
import { composeImageWithRegions, createImageEditRegion } from '../lib/regionEdit';
import { isReferenceCanvasImage } from '../lib/canvasImages';

const AGENT_CONFIGS = {
  orchestrator: { name: '编排助手', color: 'var(--primary)' },
  coordinator: { name: '创意协调员', color: 'var(--primary)' },
  competitor_analyst: { name: '竞品分析', color: '#f59e0b' },
  requirement_collector: { name: '需求分析', color: '#3b82f6' },
  copywriter: { name: '文案策划', color: '#8b5cf6' },
  prompt_writer: { name: 'Prompt 工程师', color: '#8b5cf6' },
  designer: { name: '视觉设计师', color: '#ff6b35' },
  image_generator: { name: '视觉设计师', color: '#ff6b35' },
  evaluator: { name: '流量分析师', color: '#10b981' },
  reviewer: { name: '质量审查', color: '#10b981' }
};

// Stitch 颜色框色板（6 色轮转）
const STITCH_COLORS = [
  { color: '#3B82F6', colorName: '蓝色', emoji: '🔵' },
  { color: '#22C55E', colorName: '绿色', emoji: '🟢' },
  { color: '#EF4444', colorName: '红色', emoji: '🔴' },
  { color: '#EAB308', colorName: '黄色', emoji: '🟡' },
  { color: '#F97316', colorName: '橙色', emoji: '🟠' },
  { color: '#8B5CF6', colorName: '紫色', emoji: '🟣' },
];

const getStitchColor = (index) => STITCH_COLORS[index % STITCH_COLORS.length];

const InfiniteCanvas = React.forwardRef(({ theme = 'light', currentUser, fidelity, isGenerating, setIsGenerating, onImportImageAsset, autoCutout = true, setAutoCutout, processCutout, chatMessages = [], isTyping = false, onRecommendationAction, evalModel = 'eval_standard', onSendMessage, chatInputValue, onInputValueChange, currentSessionId, saveCanvasState, initialCanvasState, onAttachImageToChat, attachedImages = [], onRemoveAttachedImage, onAddStyleReference, onImageAdded, onConfirmProductAnalysis, onRetryProductAnalysis, isConfirmingProductAnalysis = false }, ref) => {
  const [camera, setCamera] = useState(() => {
    try {
      const saved = localStorage.getItem('infinite_canvas_camera');
      return saved ? JSON.parse(saved) : { x: 100, y: 80, zoom: 1.0 };
    } catch (e) {
      console.warn('Failed to parse infinite_canvas_camera:', e);
      return { x: 100, y: 80, zoom: 1.0 };
    }
  });

  const [elements, setElements] = useState(() => {
    try {
      const saved = localStorage.getItem('infinite_canvas_elements');
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed === null) {
        return [];
      }
      return parsed;
    } catch (e) {
      console.warn('Failed to parse infinite_canvas_elements:', e);
      return [];
    }
  });

  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'hand' | 'pen' | 'rect' | 'circle' | 'arrow' | 'text' | 'note' | 'stitch'
  const [loadingImages, setLoadingImages] = useState({}); // { [imageId]: true }
  const [strokeColor, setStrokeColor] = useState('#ff6b35'); // Default primary orange
  const [selectedId, setSelectedId] = useState(null);
  const [resizeInfo, setResizeInfo] = useState(null);
  
  const [leftPanelTab, setLeftPanelTab] = useState('comments'); // 'comments' | 'layers'
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [gridSnapping, setGridSnapping] = useState(false);
  const copiedElementRef = useRef(null);
  const fileInputRef = useRef(null);
  const prevSessionIdRef = useRef(currentSessionId);

  // Restore / clear canvas when switching sessions
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = currentSessionId;

    // Only act if sessionId actually changed (not initial mount with empty)
    if (currentSessionId && prev !== currentSessionId) {
      if (initialCanvasState && initialCanvasState.elements && initialCanvasState.elements.length > 0) {
        // Restore saved canvas state from server
        setElements(initialCanvasState.elements);
        if (initialCanvasState.camera) {
          setCamera(initialCanvasState.camera);
        }
      } else {
        // New or empty session — clear canvas
        setElements([]);
        setCamera({ x: 100, y: 80, zoom: 1.0 });
      }
    }
  }, [currentSessionId, initialCanvasState]);

  const getElementBounds = (el) => {
    switch (el.type) {
      case 'image':
      case 'rect':
        return { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height };
      case 'circle':
        return { x1: el.cx - el.r, y1: el.cy - el.r, x2: el.cx + el.r, y2: el.cy + el.r };
      case 'pen': {
        if (!el.points || el.points.length === 0) return null;
        const xs = el.points.map(p => p.x);
        const ys = el.points.map(p => p.y);
        return {
          x1: Math.min(...xs),
          y1: Math.min(...ys),
          x2: Math.max(...xs),
          y2: Math.max(...ys)
        };
      }
      case 'arrow':
        return {
          x1: Math.min(el.startX, el.endX),
          y1: Math.min(el.startY, el.endY),
          x2: Math.max(el.startX, el.endX),
          y2: Math.max(el.startY, el.endY)
        };
      case 'text': {
        const textLen = el.text ? el.text.length : 0;
        const fs = el.fontSize || 16;
        const estWidth = textLen * fs * 0.6;
        const estHeight = fs * 1.2;
        return { x1: el.x, y1: el.y - estHeight, x2: el.x + estWidth, y2: el.y };
      }
      case 'note':
      case 'stitch':
        return { x1: el.x, y1: el.y, x2: el.x + (el.width || 150), y2: el.y + (el.height || 100) };
      default:
        return null;
    }
  };

  const doBoundsIntersect = (b1, b2) => {
    if (!b1 || !b2) return false;
    return !(b1.x2 < b2.x1 || b2.x2 < b1.x1 || b1.y2 < b2.y1 || b2.y2 < b1.y1);
  };

  const getClusters = () => {
    const validElements = elements.filter(el => {
      if (el.type === 'connection') return false;
      return true;
    });

    const boundsMap = new Map();
    validElements.forEach(el => {
      const b = getElementBounds(el);
      if (b) boundsMap.set(el.id, b);
    });

    const parent = {};
    const find = (i) => {
      if (parent[i] === undefined) return i;
      let curr = i;
      while (parent[curr] !== undefined) {
        curr = parent[curr];
      }
      parent[i] = curr;
      return curr;
    };
    
    const union = (i, j) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) {
        parent[rootI] = rootJ;
      }
    };

    // 1. Union intersecting image elements
    const images = validElements.filter(el => el.type === 'image');
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        const b1 = boundsMap.get(images[i].id);
        const b2 = boundsMap.get(images[j].id);
        if (doBoundsIntersect(b1, b2)) {
          union(images[i].id, images[j].id);
        }
      }
    }

    // 2. Union non-image elements to the images they overlap
    const nonImages = validElements.filter(el => el.type !== 'image');
    nonImages.forEach(el => {
      const b = boundsMap.get(el.id);
      if (!b) return;
      
      images.forEach(img => {
        const imgBounds = boundsMap.get(img.id);
        if (doBoundsIntersect(b, imgBounds)) {
          union(el.id, img.id);
        }
      });
    });

    // 3. Union non-image elements intersecting each other
    for (let i = 0; i < nonImages.length; i++) {
      for (let j = i + 1; j < nonImages.length; j++) {
        const b1 = boundsMap.get(nonImages[i].id);
        const b2 = boundsMap.get(nonImages[j].id);
        if (doBoundsIntersect(b1, b2)) {
          union(nonImages[i].id, nonImages[j].id);
        }
      }
    }

    const clustersMap = new Map();
    validElements.forEach(el => {
      const root = find(el.id);
      if (!clustersMap.has(root)) {
        clustersMap.set(root, []);
      }
      clustersMap.get(root).push(el);
    });

    return Array.from(clustersMap.values());
  };

  const getExportClustersInfo = () => {
    const clusters = getClusters();
    return clusters.map(cluster => {
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      
      cluster.forEach(el => {
        const b = getElementBounds(el);
        if (b) {
          minX = Math.min(minX, b.x1);
          minY = Math.min(minY, b.y1);
          maxX = Math.max(maxX, b.x2);
          maxY = Math.max(maxY, b.y2);
        }
      });

      const padding = 15;
      const w = minX === Infinity ? 800 : (maxX - minX) + padding * 2;
      const h = minY === Infinity ? 800 : (maxY - minY) + padding * 2;
      return { width: w, height: h };
    });
  };

  const exportCanvas = async (format = 'png', scale = 1) => {
    if (!svgRef.current) return;

    const clusters = getClusters();
    if (clusters.length === 0) {
      alert('画布上没有任何元素可以导出！');
      return;
    }

    // Process each cluster and trigger a download for each
    for (let i = 0; i < clusters.length; i++) {
      const clusterElements = clusters[i];
      
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      
      clusterElements.forEach(el => {
        const b = getElementBounds(el);
        if (b) {
          minX = Math.min(minX, b.x1);
          minY = Math.min(minY, b.y1);
          maxX = Math.max(maxX, b.x2);
          maxY = Math.max(maxY, b.y2);
        }
      });
      
      if (minX === Infinity || minY === Infinity) continue;
      
      const padding = 15;
      const cropX = minX - padding;
      const cropY = minY - padding;
      const cropW = (maxX - minX) + padding * 2;
      const cropH = (maxY - minY) + padding * 2;

      // Clone SVG
      const svgElement = svgRef.current.cloneNode(true);
      
      // Get the world space container <g>
      const worldGroup = svgElement.querySelector('g[transform]');
      if (!worldGroup) continue;

      // Clear camera transform so elements render at absolute coordinates
      worldGroup.setAttribute('transform', 'translate(0, 0) scale(1)');

      // Remove the grid rect
      const gridBg = worldGroup.querySelector('.grid-background');
      if (gridBg) gridBg.remove();

      // Remove any selection handles
      const handles = svgElement.querySelector('.resize-handles-group');
      if (handles) handles.remove();

      // Remove SVG elements that do not belong to the current cluster
      const childGroups = Array.from(worldGroup.querySelectorAll('.svg-element-group'));
      const clusterIds = new Set(clusterElements.map(el => el.id));

      childGroups.forEach(group => {
        const id = group.getAttribute('id');
        if (id && !clusterIds.has(id)) {
          group.remove();
        }
      });

      // Set viewBox and size matching the cropped area
      svgElement.setAttribute('viewBox', `${cropX} ${cropY} ${cropW} ${cropH}`);
      svgElement.setAttribute('width', cropW);
      svgElement.setAttribute('height', cropH);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgElement);
      
      const canvas = document.createElement('canvas');
      canvas.width = cropW * scale;
      canvas.height = cropH * scale;
      const ctx = canvas.getContext('2d');
      
      // Draw background color (transparency for PNG, white for JPEG)
      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      // We wrap in a promise to wait sequentially or execute immediately
      await new Promise((resolve) => {
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          
          try {
            const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
            const ext = format === 'jpeg' ? 'jpg' : 'png';
            const link = document.createElement('a');
            link.download = `canvas-export-${i + 1}-${Date.now()}.${ext}`;
            link.href = canvas.toDataURL(mimeType, 0.95);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } catch (err) {
            console.error("Failed to generate download URL for cluster " + i, err);
          }
          resolve();
        };
        img.onerror = (e) => {
          console.error("Failed to load SVG image for cluster " + i, e);
          URL.revokeObjectURL(url);
          resolve();
        };
        img.src = url;
      });
    }
  };

  const bringToFront = (id) => {
    pushToHistory();
    setElements(prev => {
      const idx = prev.findIndex(el => el.id === id);
      if (idx === -1) return prev;
      const newElements = [...prev];
      const [element] = newElements.splice(idx, 1);
      newElements.push(element);
      return newElements;
    });
  };

  const sendToBack = (id) => {
    pushToHistory();
    setElements(prev => {
      const idx = prev.findIndex(el => el.id === id);
      if (idx === -1) return prev;
      const newElements = [...prev];
      const [element] = newElements.splice(idx, 1);
      newElements.unshift(element);
      return newElements;
    });
  };

  const moveForward = (id) => {
    pushToHistory();
    setElements(prev => {
      const idx = prev.findIndex(el => el.id === id);
      if (idx === -1 || idx === prev.length - 1) return prev;
      const newElements = [...prev];
      const temp = newElements[idx];
      newElements[idx] = newElements[idx + 1];
      newElements[idx + 1] = temp;
      return newElements;
    });
  };

  const moveBackward = (id) => {
    pushToHistory();
    setElements(prev => {
      const idx = prev.findIndex(el => el.id === id);
      if (idx === -1 || idx === 0) return prev;
      const newElements = [...prev];
      const temp = newElements[idx];
      newElements[idx] = newElements[idx - 1];
      newElements[idx - 1] = temp;
      return newElements;
    });
  };

  const calculateAestheticGap = (h1, h2) => {
    const base = Math.min(h1, h2);
    const calculated = base * 0.18; // 18% of height as visual spacing
    return Math.round(Math.max(50, Math.min(calculated, 120))); // Limit to comfortable visual range (50px to 120px)
  };

  const insertImageLayer = (url, name, onError, options = {}) => {
    if (!url || pendingImageUrlsRef.current.has(url) || elementsRef.current.some(el => el.type === 'image' && el.url === url)) {
      return;
    }
    pendingImageUrlsRef.current.add(url);
    const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : { width: 800, height: 600 };

    const img = new Image();
    img.onload = () => {
      pendingImageUrlsRef.current.delete(url);
      const width = img.naturalWidth || 300;
      const height = img.naturalHeight || 400;

      const currentElements = elementsRef.current;
      const imageElements = currentElements.filter(el => el.type === 'image');
      const isFirstElement = imageElements.length === 0;

      let elementX, elementY;
      if (isFirstElement) {
        elementX = -width / 2;
        elementY = -height / 2;
      } else {
        let maxBottomY = -Infinity;
        let bottomImage = null;
        imageElements.forEach(el => {
          const bottom = el.y + el.height;
          if (bottom > maxBottomY) {
            maxBottomY = bottom;
            bottomImage = el;
          }
        });

        const lowestY = bottomImage ? maxBottomY : 0;
        const lastImageHeight = bottomImage ? bottomImage.height : height;
        const gap = calculateAestheticGap(lastImageHeight, height);

        elementX = -width / 2;
        elementY = lowestY + gap;
      }

      const newImageElement = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: 'image',
        x: elementX,
        y: elementY,
        width: width,
        height: height,
        url: url,
        name: name || '导入图层',
        source: options.source || 'user_uploaded',
        isGenerated: options.source === 'ai_generated'
      };

      pushToHistory();
      elementsRef.current = [...elementsRef.current, newImageElement];
      setElements(elementsRef.current);

      if (isFirstElement) {
        setCamera({
          x: rect.width / 2,
          y: rect.height / 2,
          zoom: 1.0
        });
      }
    };
    img.onerror = () => {
      pendingImageUrlsRef.current.delete(url);
      console.warn('[InfiniteCanvas] Image load failed for:', url);
      if (onError) {
        onError(url);
        return;
      }
      // Fallback: still insert a placeholder element
      const width = 300;
      const height = 400;

      const currentElements = elementsRef.current;
      const imageElements = currentElements.filter(el => el.type === 'image');
      const isFirstElement = imageElements.length === 0;

      let elementX, elementY;
      if (isFirstElement) {
        elementX = -width / 2;
        elementY = -height / 2;
      } else {
        let maxBottomY = -Infinity;
        let bottomImage = null;
        imageElements.forEach(el => {
          const bottom = el.y + el.height;
          if (bottom > maxBottomY) {
            maxBottomY = bottom;
            bottomImage = el;
          }
        });

        const lowestY = bottomImage ? maxBottomY : 0;
        const lastImageHeight = bottomImage ? bottomImage.height : height;
        const gap = calculateAestheticGap(lastImageHeight, height);

        elementX = -width / 2;
        elementY = lowestY + gap;
      }

      const newImageElement = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: 'image',
        x: elementX,
        y: elementY,
        width: width,
        height: height,
        url: url,
        name: name || '导入图层',
        source: options.source || 'user_uploaded',
        isGenerated: options.source === 'ai_generated'
      };
      pushToHistory();
      elementsRef.current = [...elementsRef.current, newImageElement];
      setElements(elementsRef.current);

      if (isFirstElement) {
        setCamera({
          x: rect.width / 2,
          y: rect.height / 2,
          zoom: 1.0
        });
      }
    };
    img.src = url;
  };

  const handleFileImport = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : { width: 800, height: 600 };

    const readAndInsertFiles = async () => {
      const newElements = [];
      const gap = 50;
      
      const imageElements = elements.filter(el => el.type === 'image');
      const isFirstElement = imageElements.length === 0;

      const loadedFiles = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64Url = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (re) => resolve(re.target.result);
          reader.readAsDataURL(file);
        });

        // Product analysis should start as soon as the original image is
        // decoded. Cloud sync and optional cutout can continue in parallel.
        if (onImageAdded) onImageAdded(base64Url, file.name);

        if (onImportImageAsset) {
          Promise.resolve(onImportImageAsset(file.name, base64Url)).catch((err) => {
            console.error("onImportImageAsset failed:", err);
          });
        }

        let finalUrl = base64Url;
        if (autoCutout && processCutout) {
          if (setIsGenerating) setIsGenerating(true);
          try {
            finalUrl = await processCutout(base64Url);
          } catch (err) {
            console.error("processCutout imported image failed:", err);
          } finally {
            if (setIsGenerating) setIsGenerating(false);
          }
        }

        const dimensions = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve({
              width: img.naturalWidth || 300,
              height: img.naturalHeight || 400
            });
          };
          img.onerror = () => {
            resolve({ width: 300, height: 400 });
          };
          img.src = finalUrl;
        });

        loadedFiles.push({ file, base64Url: finalUrl, originalBase64Url: base64Url, ...dimensions });
      }

      const totalWidth = loadedFiles.reduce((sum, f) => sum + f.width, 0) + (loadedFiles.length - 1) * gap;

      let startX;
      let startY;
      if (isFirstElement) {
        startX = -totalWidth / 2;
        startY = 0;
      } else {
        let maxBottomY = -Infinity;
        let bottomImage = null;
        imageElements.forEach(el => {
          const bottom = el.y + el.height;
          if (bottom > maxBottomY) {
            maxBottomY = bottom;
            bottomImage = el;
          }
        });

        const lowestY = bottomImage ? maxBottomY : 0;
        const lastImageHeight = bottomImage ? bottomImage.height : 300;
        const newRowMaxHeight = Math.max(...loadedFiles.map(f => f.height));
        const dynamicGap = calculateAestheticGap(lastImageHeight, newRowMaxHeight);

        startX = -totalWidth / 2;
        startY = lowestY + dynamicGap + newRowMaxHeight / 2;
      }

      let currentX = startX;
      for (let i = 0; i < loadedFiles.length; i++) {
        const lf = loadedFiles[i];
        newElements.push({
          id: 'image-' + Date.now() + '-' + i,
          type: 'image',
          x: currentX,
          y: startY - lf.height / 2,
          width: lf.width,
          height: lf.height,
          url: lf.base64Url,
          name: lf.file.name || `图片图层-${i+1}`,
          source: 'user_uploaded',
          isGenerated: false
        });
        currentX += lf.width + gap;
      }

      pushToHistory();
      setElements(prev => [...prev, ...newElements]);

      if (isFirstElement) {
        setCamera({
          x: rect.width / 2,
          y: rect.height / 2,
          zoom: 1.0
        });
      }
    };

    try {
      await readAndInsertFiles();
    } catch (err) {
      console.error("Failed to import multiple files:", err);
    }
    
    // Clear input value so same files can be uploaded again
    e.target.value = '';
  };

  useImperativeHandle(ref, () => ({
    exportCanvas,
    insertImageLayer,
    getExportClustersInfo,
    getClusters,
    getDimensions: () => ({
      width: svgRef.current ? svgRef.current.clientWidth : 1200,
      height: svgRef.current ? svgRef.current.clientHeight : 800
    }),
    // === 读取能力 ===
    getElements: () => elementsRef.current,
    getElementById: (id) => elementsRef.current.find(el => el.id === id),
    getSelectedElements: () => {
      if (!selectedId) return [];
      const el = elementsRef.current.find(e => e.id === selectedId);
      return el ? [el] : [];
    },
    getStitchRegions: () => {
      return elementsRef.current
        .filter(el => el.type === 'stitch')
        .map(el => {
          const colorInfo = STITCH_COLORS.find(c => c.color === el.color) || { color: '#3B82F6', colorName: '蓝色', emoji: '🔵' };
          return {
            id: el.id,
            color: el.color,
            colorName: el.colorName,
            emoji: el.emoji || colorInfo.emoji,
            relX: el.relX,
            relY: el.relY,
            width: el.width,
            height: el.height,
            imageId: el.imageId,
            label: el.label
          };
        });
    },
    getCanvasSnapshot: () => ({
      elements: elementsRef.current,
      camera: { ...camera },
      dimensions: {
        width: svgRef.current ? svgRef.current.clientWidth : 1200,
        height: svgRef.current ? svgRef.current.clientHeight : 800
      }
    }),
    // === 写入能力 ===
    updateElement: (id, props) => {
      pushToHistory();
      setElements(prev => prev.map(el => el.id === id ? { ...el, ...props } : el));
    },
    deleteElement: (id) => {
      pushToHistory();
      setElements(prev => prev.filter(el =>
        el.id !== id &&
        !(el.type === 'connection' && el.sourceStitchId === id)
      ));
      if (selectedId === id) setSelectedId(null);
    },
    deleteElements: (ids) => {
      const idSet = new Set(ids);
      pushToHistory();
      setElements(prev => prev.filter(el =>
        !idSet.has(el.id) &&
        !(el.type === 'connection' && idSet.has(el.sourceStitchId))
      ));
      if (selectedId && idSet.has(selectedId)) setSelectedId(null);
    },
    addTextElement: (text, x, y, style = {}) => {
      const id = 'text-' + Date.now();
      pushToHistory();
      setElements(prev => [...prev, {
        id,
        type: 'text',
        x: x ?? 0,
        y: y ?? 0,
        text,
        color: style.color || strokeColor,
        fontSize: style.fontSize || 16
      }]);
      return id;
    },
    addShapeElement: (type, x, y, w, h, style = {}) => {
      const id = type + '-' + Date.now();
      pushToHistory();
      if (type === 'circle') {
        setElements(prev => [...prev, {
          id, type: 'circle',
          cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2,
          color: style.color || strokeColor
        }]);
      } else {
        setElements(prev => [...prev, {
          id, type: type === 'arrow' ? 'arrow' : 'rect',
          ...(type === 'arrow'
            ? { startX: x, startY: y, endX: x + w, endY: y + h, color: style.color || strokeColor }
            : { x, y, width: w, height: h, color: style.color || strokeColor }
          )
        }]);
      }
      return id;
    },
    replaceImage: (imageId, newUrl) => {
      pushToHistory();
      setElements(prev => prev.map(el => {
        if (el.id === imageId && el.type === 'image') {
          return { ...el, url: newUrl };
        }
        return el;
      }));
    },
    replaceImageUrl: (oldUrl, newUrl) => {
      // Replace all image elements matching oldUrl with newUrl
      const hasMatch = elementsRef.current.some(el => el.type === 'image' && el.url === oldUrl);
      if (!hasMatch) return;
      pushToHistory();
      setElements(prev => prev.map(el => {
        if (el.type === 'image' && el.url === oldUrl) {
          return { ...el, url: newUrl };
        }
        return el;
      }));
    },
    getCamera: () => ({ ...camera }),
    clearCanvas: () => {
      if (window.confirm("确定要清空无限画布上的所有元素吗？")) {
        pushToHistory();
        setElements([]);
        setSelectedId(null);
      }
    },
    loadElements: (newElements, newCamera) => {
      pushToHistory();
      setElements(newElements || []);
      if (newCamera) setCamera(newCamera);
      setSelectedId(null);
    },
    // === 布局能力 ===
    arrangeElements: (ids, layout) => {
      const targetEls = elementsRef.current.filter(el => ids.includes(el.id));
      if (targetEls.length < 2) return;
      pushToHistory();
      const sorted = [...targetEls].sort((a, b) => (a.x || 0) - (b.x || 0));
      const gap = 40;
      let cursorX = sorted[0].x || 0;
      let cursorY = sorted[0].y || 0;
      const updates = {};
      if (layout === 'horizontal') {
        sorted.forEach(el => {
          updates[el.id] = { x: cursorX };
          cursorX += (el.width || 0) + gap;
        });
      } else if (layout === 'vertical') {
        sorted.forEach(el => {
          updates[el.id] = { y: cursorY };
          cursorY += (el.height || 0) + gap;
        });
      }
      setElements(prev => prev.map(el => updates[el.id] ? { ...el, ...updates[el.id] } : el));
    },
    fitToBounds: (ids, bounds) => {
      pushToHistory();
      setElements(prev => prev.map(el => {
        if (!ids.includes(el.id) || el.type !== 'image') return el;
        const scaleX = bounds.width / el.width;
        const scaleY = bounds.height / el.height;
        const scale = Math.min(scaleX, scaleY);
        return {
          ...el,
          width: el.width * scale,
          height: el.height * scale,
          x: bounds.x + (bounds.width - el.width * scale) / 2,
          y: bounds.y + (bounds.height - el.height * scale) / 2
        };
      }));
    },
    autoDistribute: (ids, direction) => {
      const targetEls = elementsRef.current.filter(el => ids.includes(el.id));
      if (targetEls.length < 3) return;
      pushToHistory();
      const sorted = [...targetEls].sort((a, b) =>
        direction === 'horizontal' ? ((a.x || 0) - (b.x || 0)) : ((a.y || 0) - (b.y || 0))
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const updates = {};
      for (let i = 1; i < sorted.length - 1; i++) {
        const ratio = i / (sorted.length - 1);
        if (direction === 'horizontal') {
          updates[sorted[i].id] = { x: (first.x || 0) + ((last.x || 0) - (first.x || 0)) * ratio };
        } else {
          updates[sorted[i].id] = { y: (first.y || 0) + ((last.y || 0) - (first.y || 0)) * ratio };
        }
      }
      setElements(prev => prev.map(el => updates[el.id] ? { ...el, ...updates[el.id] } : el));
    },
    // === 历史记录 ===
    getHistory: () => ({
      past: pastRef.current,
      future: futureRef.current
    }),
    // === 内部辅助 ===
    getImageWithColorBoxes,
    handleTriggerAI,
    getStitchColor
  }));

  const startResizing = (e, elementId, dir) => {
    const canvasPt = getCanvasPoint(e);
    const element = elements.find(el => el.id === elementId);
    if (!element) return;
    
    setIsPointerDown(true);
    setResizeInfo({
      elementId,
      dir,
      startX: canvasPt.x,
      startY: canvasPt.y,
      startEl: { ...element }
    });
    dragStartElementsRef.current = elements;
    hasDraggedRef.current = false;
  };

  const duplicateElement = (el) => {
    if (!el) return;
    const newEl = {
      ...el,
      id: el.type + '-' + Date.now(),
    };
    if (newEl.type === 'circle') {
      newEl.cx += 20;
      newEl.cy += 20;
    } else if (newEl.type === 'pen') {
      newEl.points = newEl.points.map(p => ({ x: p.x + 20, y: p.y + 20 }));
    } else if (newEl.type === 'arrow') {
      newEl.startX += 20;
      newEl.startY += 20;
      newEl.endX += 20;
      newEl.endY += 20;
    } else {
      if (newEl.x !== undefined) newEl.x += 20;
      if (newEl.y !== undefined) newEl.y += 20;
    }
    if (newEl.name) {
      newEl.name = `${newEl.name} (复制)`;
    }
    pushToHistory();
    setElements(prev => [...prev, newEl]);
    setSelectedId(newEl.id);
  };
  
  // Drawing states
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // Screen space for panning, canvas space for drawing
  const [cameraStart, setCameraStart] = useState({ x: 0, y: 0 });
  const [currentPenPath, setCurrentPenPath] = useState(null);
  const [tempShape, setTempShape] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 }); // Offset between pointer and selected shape origin
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Text input state
  const [textEditor, setTextEditor] = useState(null); // { id, x, y, text, type: 'text' | 'note' }

  // History / Undo-Redo State
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const elementsRef = useRef(elements);
  const pendingImageUrlsRef = useRef(new Set());
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const dragStartElementsRef = useRef(null);
  const hasDraggedRef = useRef(false);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    pastRef.current = past;
    futureRef.current = future;
  }, [past, future]);

  const pushToHistory = (customState) => {
    const stateToPush = customState || elementsRef.current;
    setPast(prev => {
      const updated = [...prev, stateToPush];
      if (updated.length > 55) {
        updated.shift();
      }
      return updated;
    });
    setFuture([]);
  };

  const handleUndo = () => {
    const currentPast = pastRef.current;
    if (currentPast.length === 0) return;
    const previous = currentPast[currentPast.length - 1];
    const newPast = currentPast.slice(0, currentPast.length - 1);

    setFuture(prev => [...prev, elementsRef.current]);
    setPast(newPast);
    setElements(previous);
    setSelectedId(null);
  };

  const handleRedo = () => {
    const currentFuture = futureRef.current;
    if (currentFuture.length === 0) return;
    const next = currentFuture[currentFuture.length - 1];
    const newFuture = currentFuture.slice(0, currentFuture.length - 1);

    setPast(prev => [...prev, elementsRef.current]);
    setFuture(newFuture);
    setElements(next);
    setSelectedId(null);
  };

  const svgRef = useRef(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // Auto-save to localStorage + server
  useEffect(() => {
    try {
      localStorage.setItem('infinite_canvas_camera', JSON.stringify(camera));
    } catch (err) {
      console.warn('Failed to save infinite_canvas_camera to localStorage:', err);
    }
  }, [camera]);

  useEffect(() => {
    try {
      localStorage.setItem('infinite_canvas_elements', JSON.stringify(elements));
    } catch (err) {
      console.warn('Failed to save infinite_canvas_elements to localStorage (quota exceeded?):', err);
    }
    // Debounced server-side save (elements + camera together)
    const timer = setTimeout(() => {
      if (currentSessionId && saveCanvasState) {
        saveCanvasState(currentSessionId, { elements, camera: cameraRef.current });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [elements]);

  // Prevent default browser zoom/scroll for wheel events on the canvas
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const preventWheel = (e) => e.preventDefault();
    svg.addEventListener('wheel', preventWheel, { passive: false });
    return () => svg.removeEventListener('wheel', preventWheel);
  }, []);

  // Spacebar tracking for Hand Tool override
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
      const isRedo = ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
                     ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'));

      if (isUndo) {
        e.preventDefault();
        handleUndo();
      } else if (isRedo) {
        e.preventDefault();
        handleRedo();
      } else if (e.code === 'Space') {
        setIsSpacePressed(true);
        e.preventDefault();
      } else if (e.code === 'KeyV') {
        setActiveTool('select');
      } else if (e.code === 'KeyH') {
        setActiveTool('hand');
      } else if (e.code === 'KeyB' || e.code === 'KeyP') {
        setActiveTool('pen');
      } else if (e.code === 'KeyR') {
        setActiveTool('rect');
      } else if (e.code === 'KeyO') {
        setActiveTool('circle');
      } else if (e.code === 'KeyT') {
        setActiveTool('text');
      } else if (e.code === 'KeyN') {
        setActiveTool('note');
      } else if (e.code === 'KeyS') {
        setActiveTool('stitch');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          pushToHistory();
          setElements(prev => prev.filter(el => el.id !== selectedId));
          setSelectedId(null);
        }
      } else if (e.key === 'Escape') {
        setSelectedId(null);
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (selectedId) {
          const el = elementsRef.current.find(item => item.id === selectedId);
          if (el) {
            copiedElementRef.current = el;
            e.preventDefault();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (copiedElementRef.current) {
          duplicateElement(copiedElementRef.current);
          e.preventDefault();
        }
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selectedId) {
          const el = elementsRef.current.find(item => item.id === selectedId);
          if (el && !el.locked) {
            e.preventDefault();
            const amount = e.shiftKey ? 10 : 1;
            let dx = 0;
            let dy = 0;
            if (e.key === 'ArrowUp') dy = -amount;
            if (e.key === 'ArrowDown') dy = amount;
            if (e.key === 'ArrowLeft') dx = -amount;
            if (e.key === 'ArrowRight') dx = amount;
            
            pushToHistory();
            setElements(prev => prev.map(item => {
              if (item.id === selectedId) {
                if (item.type === 'circle') {
                  return { ...item, cx: item.cx + dx, cy: item.cy + dy };
                } else if (item.type === 'pen') {
                  return { ...item, points: item.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                } else if (item.type === 'arrow') {
                  return { ...item, startX: item.startX + dx, startY: item.startY + dy, endX: item.endX + dx, endY: item.endY + dy };
                } else {
                  return { ...item, x: item.x + dx, y: item.y + dy };
                }
              }
              if (item.type === 'stitch' && item.imageId === selectedId) {
                return { ...item, x: item.x + dx, y: item.y + dy };
              }
              return item;
            }));
          }
        }
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedId]);

  // Get SVG coordinate from screen coordinate
  const getCanvasPoint = (e) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      x: (x - camera.x) / camera.zoom,
      y: (y - camera.y) / camera.zoom
    };
  };

  const handlePointerDown = (e) => {
    if (textEditor) {
      commitTextEditor();
      return;
    }
    
    const isMiddleClick = e.button === 1;
    const isRightClick = e.button === 2;
    const isPanAction = activeTool === 'hand' || isSpacePressed || isMiddleClick || isRightClick;
    
    setIsPointerDown(true);
    const canvasPt = getCanvasPoint(e);
    
    if (isPanAction) {
      setDragStart({ x: e.clientX, y: e.clientY });
      setCameraStart({ x: camera.x, y: camera.y });
      e.preventDefault();
      return;
    }

    if (activeTool === 'select') {
      // Find clicked element (traverse backwards to select frontmost item first)
      const clickedEl = [...elements].reverse().find(el => {
        if (el.type === 'stitch') {
          const inMainBox = canvasPt.x >= el.x && canvasPt.x <= el.x + el.width &&
                            canvasPt.y >= el.y && canvasPt.y <= el.y + el.height;
          const inBadgeBox = canvasPt.x >= el.x && canvasPt.x <= el.x + 82 &&
                             canvasPt.y >= el.y - 18 && canvasPt.y <= el.y;
          return inMainBox || inBadgeBox;
        }
        if (el.type === 'rect' || el.type === 'note' || el.type === 'image') {
          return canvasPt.x >= el.x && canvasPt.x <= el.x + el.width &&
                 canvasPt.y >= el.y && canvasPt.y <= el.y + el.height;
        }
        if (el.type === 'circle') {
          const dx = canvasPt.x - el.cx;
          const dy = canvasPt.y - el.cy;
          return Math.sqrt(dx * dx + dy * dy) <= el.r;
        }
        if (el.type === 'text') {
          // Approximate hit testing for text
          return canvasPt.x >= el.x && canvasPt.x <= el.x + 100 &&
                 canvasPt.y >= el.y - 14 && canvasPt.y <= el.y + 6;
        }
        if (el.type === 'pen') {
          // Bounding box approximation for path
          const xs = el.points.map(p => p.x);
          const ys = el.points.map(p => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return canvasPt.x >= minX - 10 && canvasPt.x <= maxX + 10 &&
                 canvasPt.y >= minY - 10 && canvasPt.y <= maxY + 10;
        }
        return false;
      });

      if (clickedEl) {
        setSelectedId(clickedEl.id);
        setDragStart(canvasPt);
        dragStartElementsRef.current = elements;
        hasDraggedRef.current = false;
        if (clickedEl.type === 'circle') {
          setDragOffset({ x: canvasPt.x - clickedEl.cx, y: canvasPt.y - clickedEl.cy });
        } else {
          setDragOffset({ x: canvasPt.x - clickedEl.x, y: canvasPt.y - clickedEl.y });
        }

        // Click on stitch to select it (no editor popup)
        if (clickedEl.type === 'stitch') {
          // Just select - no text editor
        }
      } else {
        setSelectedId(null);
      }
    } else if (activeTool === 'pen') {
      setCurrentPenPath({
        id: 'pen-' + Date.now(),
        type: 'pen',
        points: [canvasPt],
        color: strokeColor,
        strokeWidth: 3
      });
    } else if (activeTool === 'rect') {
      setDragStart(canvasPt);
      setTempShape({
        id: 'rect-' + Date.now(),
        type: 'rect',
        x: canvasPt.x,
        y: canvasPt.y,
        width: 0,
        height: 0,
        color: strokeColor
      });
    } else if (activeTool === 'circle') {
      setDragStart(canvasPt);
      setTempShape({
        id: 'circle-' + Date.now(),
        type: 'circle',
        cx: canvasPt.x,
        cy: canvasPt.y,
        r: 0,
        color: strokeColor
      });
    } else if (activeTool === 'arrow') {
      setDragStart(canvasPt);
      setTempShape({
        id: 'arrow-' + Date.now(),
        type: 'arrow',
        startX: canvasPt.x,
        startY: canvasPt.y,
        endX: canvasPt.x,
        endY: canvasPt.y,
        color: strokeColor
      });
    } else if (activeTool === 'text') {
      const id = 'text-' + Date.now();
      setTextEditor({
        id,
        x: canvasPt.x,
        y: canvasPt.y,
        text: '',
        type: 'text'
      });
    } else if (activeTool === 'note') {
      const id = 'note-' + Date.now();
      setTextEditor({
        id,
        x: canvasPt.x,
        y: canvasPt.y,
        text: '',
        type: 'note'
      });
    } else if (activeTool === 'stitch') {
      setDragStart(canvasPt);
      setTempShape({
        id: 'temp-stitch',
        type: 'stitch',
        x: canvasPt.x,
        y: canvasPt.y,
        width: 0,
        height: 0
      });
    }
  };

  const handlePointerMove = (e) => {
    if (!isPointerDown) return;

    const isMiddleClick = e.buttons === 4;
    const isRightClick = e.buttons === 2;
    const isPanAction = activeTool === 'hand' || isSpacePressed || isMiddleClick || isRightClick;
    
    if (isPanAction) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setCamera({
        x: cameraStart.x + dx,
        y: cameraStart.y + dy,
        zoom: camera.zoom
      });
      return;
    }

    const canvasPt = getCanvasPoint(e);

    if (resizeInfo) {
      hasDraggedRef.current = true;
      const dx = canvasPt.x - resizeInfo.startX;
      const dy = canvasPt.y - resizeInfo.startY;

      setElements(prev => {
        return prev.map(el => {
          if (el.id === resizeInfo.elementId) {
            const start = resizeInfo.startEl;
            
            if (start.type === 'circle') {
              let newR = start.r;
              let newCx = start.cx;
              let newCy = start.cy;
              
              if (resizeInfo.dir === 'se') {
                const newWidth = start.r * 2 + dx;
                newR = Math.max(5, newWidth / 2);
                newCx = start.cx + dx / 2;
                newCy = start.cy + dy / 2;
              } else if (resizeInfo.dir === 'nw') {
                const newWidth = start.r * 2 - dx;
                newR = Math.max(5, newWidth / 2);
                newCx = start.cx + dx / 2;
                newCy = start.cy + dy / 2;
              }
              return { ...el, cx: newCx, cy: newCy, r: newR };
            }

            let newX = start.x;
            let newY = start.y;
            let newW = start.width;
            let newH = start.height;

            const keepRatio = start.type === 'image';
            const originalRatio = start.width / start.height;

            if (resizeInfo.dir === 'se') {
              newW = Math.max(10, start.width + dx);
              newH = Math.max(10, start.height + dy);
              if (keepRatio) {
                if (newW / originalRatio < newH) {
                  newH = newW / originalRatio;
                } else {
                  newW = newH * originalRatio;
                }
              }
            } else if (resizeInfo.dir === 'sw') {
              newW = Math.max(10, start.width - dx);
              newH = Math.max(10, start.height + dy);
              if (keepRatio) {
                if (newW / originalRatio < newH) {
                  newH = newW / originalRatio;
                } else {
                  newW = newH * originalRatio;
                }
              }
              newX = start.x + (start.width - newW);
            } else if (resizeInfo.dir === 'ne') {
              newW = Math.max(10, start.width + dx);
              newH = Math.max(10, start.height - dy);
              if (keepRatio) {
                if (newW / originalRatio < newH) {
                  newH = newW / originalRatio;
                } else {
                  newW = newH * originalRatio;
                }
              }
              newY = start.y + (start.height - newH);
            } else if (resizeInfo.dir === 'nw') {
              newW = Math.max(10, start.width - dx);
              newH = Math.max(10, start.height - dy);
              if (keepRatio) {
                if (newW / originalRatio < newH) {
                  newH = newW / originalRatio;
                } else {
                  newW = newH * originalRatio;
                }
              }
              newX = start.x + (start.width - newW);
              newY = start.y + (start.height - newH);
            }

            return {
              ...el,
              x: newX,
              y: newY,
              width: newW,
              height: newH
            };
          }
          return el;
        });
      });
      return;
    }

    if (activeTool === 'select' && selectedId) {
      hasDraggedRef.current = true;
      // Dragging selected shape
      setElements(prev => {
        const dragged = prev.find(el => el.id === selectedId);
        if (!dragged) return prev;
        
        let dx = 0;
        let dy = 0;
        if (dragged.type === 'circle') {
          dx = (canvasPt.x - dragOffset.x) - dragged.cx;
          dy = (canvasPt.y - dragOffset.y) - dragged.cy;
        } else {
          dx = (canvasPt.x - dragOffset.x) - dragged.x;
          dy = (canvasPt.y - dragOffset.y) - dragged.y;
        }

        return prev.map(el => {
          if (el.id === selectedId) {
            if (el.type === 'circle') {
              return {
                ...el,
                cx: canvasPt.x - dragOffset.x,
                cy: canvasPt.y - dragOffset.y
              };
            } else {
              return {
                ...el,
                x: canvasPt.x - dragOffset.x,
                y: canvasPt.y - dragOffset.y
              };
            }
          }
          // Linked dragging: sync stitch comment boxes with their parent image
          if (el.type === 'stitch' && el.imageId === selectedId) {
            return {
              ...el,
              x: el.x + dx,
              y: el.y + dy
            };
          }
          return el;
        });
      });
      // Reset drag start for pen path delta increments
      if (elements.find(el => el.id === selectedId)?.type === 'pen') {
        setDragStart(canvasPt);
      }
    } else if (activeTool === 'pen' && currentPenPath) {
      setCurrentPenPath(prev => ({
        ...prev,
        points: [...prev.points, canvasPt]
      }));
    } else if (activeTool === 'rect' && tempShape) {
      const x = Math.min(dragStart.x, canvasPt.x);
      const y = Math.min(dragStart.y, canvasPt.y);
      const width = Math.abs(dragStart.x - canvasPt.x);
      const height = Math.abs(dragStart.y - canvasPt.y);
      setTempShape(prev => ({ ...prev, x, y, width, height }));
    } else if (activeTool === 'circle' && tempShape) {
      const dx = canvasPt.x - dragStart.x;
      const dy = canvasPt.y - dragStart.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      setTempShape(prev => ({ ...prev, r }));
    } else if (activeTool === 'arrow' && tempShape) {
      setTempShape(prev => ({
        ...prev,
        endX: canvasPt.x,
        endY: canvasPt.y
      }));
    } else if (activeTool === 'stitch' && tempShape) {
      const targetImage = [...elements].reverse().find(el => 
        el.type === 'image' && 
        dragStart.x >= el.x && dragStart.x <= el.x + el.width &&
        dragStart.y >= el.y && dragStart.y <= el.y + el.height
      );
      
      let x = Math.min(dragStart.x, canvasPt.x);
      let y = Math.min(dragStart.y, canvasPt.y);
      let maxX = Math.max(dragStart.x, canvasPt.x);
      let maxY = Math.max(dragStart.y, canvasPt.y);
      
      if (targetImage) {
        x = Math.max(x, targetImage.x);
        y = Math.max(y, targetImage.y);
        maxX = Math.min(maxX, targetImage.x + targetImage.width);
        maxY = Math.min(maxY, targetImage.y + targetImage.height);
      }
      
      const width = Math.max(0, maxX - x);
      const height = Math.max(0, maxY - y);
      setTempShape(prev => ({ ...prev, x, y, width, height }));
    }
  };

  const handlePointerUp = async () => {
    setIsPointerDown(false);

    if (resizeInfo) {
      if (hasDraggedRef.current && dragStartElementsRef.current) {
        pushToHistory(dragStartElementsRef.current);
      }
      setResizeInfo(null);
      return;
    }

    if (activeTool === 'pen' && currentPenPath) {
      if (currentPenPath.points.length > 1) {
        pushToHistory();
        setElements(prev => [...prev, currentPenPath]);
      }
      setCurrentPenPath(null);
    } else if ((activeTool === 'rect' || activeTool === 'circle' || activeTool === 'arrow') && tempShape) {
      // Validate bounds before creating
      let isValid = false;
      if (tempShape.type === 'rect' && tempShape.width > 4 && tempShape.height > 4) isValid = true;
      if (tempShape.type === 'circle' && tempShape.r > 2) isValid = true;
      if (tempShape.type === 'arrow') {
        const dx = tempShape.endX - tempShape.startX;
        const dy = tempShape.endY - tempShape.startY;
        if (Math.sqrt(dx * dx + dy * dy) > 5) isValid = true;
      }

      if (isValid) {
        let shapeToAdd = tempShape;

        // A rectangle drawn over an image is an edit-region selection. Clip it
        // to the image, compose source+frame, and place that composite directly
        // above the chat input as the next image-Agent attachment.
        if (tempShape.type === 'rect') {
          const editSelection = createImageEditRegion(tempShape, elements);
          if (editSelection) {
              const { targetImage, region } = editSelection;
              shapeToAdd = region;
              try {
                const previousRegions = elements.filter(el =>
                  el.type === 'rect' && el.isEditRegion && el.imageId === targetImage.id
                );
                const annotatedUrl = await composeImageWithRegions(
                  targetImage,
                  [...previousRegions, shapeToAdd],
                  getImageUrl(targetImage.url),
                );
                onAttachImageToChat?.({
                  id: `region-edit-${Date.now()}`,
                  url: annotatedUrl,
                  name: `框选编辑·${targetImage.name || '图片'}`,
                  kind: 'region_edit',
                  sourceImageId: targetImage.id,
                  sourceImageUrl: targetImage.url,
                  regions: [...previousRegions, shapeToAdd].map(region => ({
                    relX: region.relX,
                    relY: region.relY,
                    width: region.width,
                    height: region.height,
                    color: region.color,
                  })),
                });
                setActiveTool('select');
              } catch (error) {
                console.error('[Canvas] Failed to compose region attachment:', error);
                alert('框选图片合成失败，请确认原图可正常加载后重试。');
              }
          }
        }

        pushToHistory();
        setElements(prev => [...prev, shapeToAdd]);
      }
      setTempShape(null);
    } else if (activeTool === 'stitch' && tempShape) {
      if (tempShape.width > 10 && tempShape.height > 10) {
        const targetImage = [...elements].reverse().find(el =>
          el.type === 'image' &&
          dragStart.x >= el.x && dragStart.x <= el.x + el.width &&
          dragStart.y >= el.y && dragStart.y <= el.y + el.height
        );

        let finalX = tempShape.x;
        let finalY = tempShape.y;
        let finalW = tempShape.width;
        let finalH = tempShape.height;

        if (targetImage) {
          const x = Math.max(finalX, targetImage.x);
          const y = Math.max(finalY, targetImage.y);
          const maxX = Math.min(finalX + finalW, targetImage.x + targetImage.width);
          const maxY = Math.min(finalY + finalH, targetImage.y + targetImage.height);
          finalX = x;
          finalY = y;
          finalW = Math.max(0, maxX - x);
          finalH = Math.max(0, maxY - y);
        }

        if (finalW > 10 && finalH > 10) {
          const relX = targetImage ? finalX - targetImage.x : 0;
          const relY = targetImage ? finalY - targetImage.y : 0;

          // Auto-assign color from palette (round-robin, based on existing stitch count)
          const existingStitches = elements.filter(el => el.type === 'stitch');
          const colorIndex = existingStitches.length;
          const colorInfo = getStitchColor(colorIndex);
          const label = `#${existingStitches.length + 1}`;

          pushToHistory();
          setElements(prev => [
            ...prev,
            {
              id: 'stitch-' + Date.now(),
              type: 'stitch',
              x: finalX,
              y: finalY,
              width: finalW,
              height: finalH,
              text: '', // No text editor - instructions come from chat
              imageId: targetImage ? targetImage.id : null,
              relX,
              relY,
              color: colorInfo.color,
              colorName: colorInfo.colorName,
              emoji: colorInfo.emoji,
              label
            }
          ]);
          setActiveTool('select');
        }
      }
      setTempShape(null);
    } else if (activeTool === 'select') {
      if (hasDraggedRef.current && dragStartElementsRef.current) {
        pushToHistory(dragStartElementsRef.current);
      }
      dragStartElementsRef.current = null;
      hasDraggedRef.current = false;
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomIntensity = 0.05;
    
    // Alt + Pinch gesture scales selected element
    if ((e.ctrlKey || e.metaKey) && e.altKey && selectedId) {
      const el = elements.find(item => item.id === selectedId);
      if (el && !el.locked) {
        const scaleFactor = e.deltaY < 0 ? 1.05 : 0.95;
        
        pushToHistory();
        setElements(prev => {
          return prev.map(item => {
            if (item.id === selectedId) {
              if (item.type === 'circle') {
                return {
                  ...item,
                  r: Math.max(5, item.r * scaleFactor)
                };
              }
              if (item.x !== undefined && item.width !== undefined) {
                const newW = Math.max(10, item.width * scaleFactor);
                const newH = Math.max(10, item.height * scaleFactor);
                const dx = newW - item.width;
                const dy = newH - item.height;
                return {
                  ...item,
                  x: item.x - dx / 2,
                  y: item.y - dy / 2,
                  width: newW,
                  height: newH
                };
              }
            }
            return item;
          });
        });
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      // Zoom centered on pointer coordinates
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      const canvasX = (pointerX - camera.x) / camera.zoom;
      const canvasY = (pointerY - camera.y) / camera.zoom;

      let newZoom = camera.zoom;
      if (e.deltaY < 0) {
        newZoom = Math.min(camera.zoom + zoomIntensity * camera.zoom, 8.0);
      } else {
        newZoom = Math.max(camera.zoom - zoomIntensity * camera.zoom, 0.1);
      }

      setCamera({
        x: pointerX - canvasX * newZoom,
        y: pointerY - canvasY * newZoom,
        zoom: newZoom
      });
    } else {
      // Normal panning scroll
      setCamera(prev => ({
        ...prev,
        x: prev.x - e.deltaX * 0.85,
        y: prev.y - e.deltaY * 0.85
      }));
    }
  };

  const commitTextEditor = () => {
    if (!textEditor) return;
    const trimmed = textEditor.text.trim();
    
    // Check if we are updating an existing element
    const exists = elements.some(el => el.id === textEditor.id);

    if (exists) {
      pushToHistory();
      if (!trimmed) {
        // If text is cleared, delete the element (and any connections referencing it)
        setElements(prev => prev.filter(el => 
          el.id !== textEditor.id && 
          !(el.type === 'connection' && el.sourceStitchId === textEditor.id)
        ));
      } else {
        // Otherwise, update the text property
        setElements(prev => prev.map(el => {
          if (el.id === textEditor.id) {
            return { ...el, text: trimmed };
          }
          return el;
        }));
      }
    } else if (trimmed) {
      pushToHistory();
      if (textEditor.type === 'text') {
        setElements(prev => [
          ...prev,
          {
            id: textEditor.id,
            type: 'text',
            x: textEditor.x,
            y: textEditor.y,
            text: trimmed,
            color: strokeColor,
            fontSize: 16
          }
        ]);
      } else if (textEditor.type === 'note') {
        setElements(prev => [
          ...prev,
          {
            id: textEditor.id,
            type: 'note',
            x: textEditor.x,
            y: textEditor.y,
            width: 140,
            height: 140,
            text: trimmed,
            color: strokeColor
          }
        ]);
      } else if (textEditor.type === 'stitch') {
        setElements(prev => [
          ...prev,
          {
            id: textEditor.id,
            type: 'stitch',
            x: textEditor.boxX,
            y: textEditor.boxY,
            width: textEditor.boxW,
            height: textEditor.boxH,
            text: trimmed,
            imageId: textEditor.imageId,
            relX: textEditor.relX,
            relY: textEditor.relY
          }
        ]);
      }
    }
    setTextEditor(null);
    setActiveTool('select');
  };

  const handleResetCamera = () => {
    const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : { width: 800, height: 600 };
    setCamera({ x: rect.width / 2, y: rect.height / 2, zoom: 1.0 });
  };

  const handleClearAll = () => {
    if (window.confirm("确定要清空无限画布上的所有元素吗？")) {
      pushToHistory();
      setElements([]);
      setSelectedId(null);
    }
  };

  // SVG Adaptive Dot Grid settings
  const getGridConfig = () => {
    const z = camera.zoom;
    if (z > 0.45) {
      return { size: 24, opacity: Math.min(1, (z - 0.45) * 4) * 0.12 + 0.04, radius: 0.9 };
    } else {
      // Render wider grid anchors when zoomed out
      return { size: 120, opacity: 0.1, radius: 1.3 };
    }
  };
  const grid = getGridConfig();

  // Convert points array into SVG smooth path
  const getSvgPathString = (points) => {
    if (points.length === 0) return '';
    const d = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length; i++) {
      d.push(`L ${points[i].x} ${points[i].y}`);
    }
    return d.join(' ');
  };

  // Convert arrow start and end into path + arrowhead path
  const getArrowPaths = (el) => {
    const dx = el.endX - el.startX;
    const dy = el.endY - el.startY;
    const angle = Math.atan2(dy, dx);
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 2) return { line: '', head: '' };

    // Bending arrow or standard line
    const linePath = `M ${el.startX} ${el.startY} L ${el.endX} ${el.endY}`;
    
    // Arrowhead calculations
    const headSize = Math.max(8, 12 / camera.zoom);
    const arrowX1 = el.endX - headSize * Math.cos(angle - Math.PI / 6);
    const arrowY1 = el.endY - headSize * Math.sin(angle - Math.PI / 6);
    const arrowX2 = el.endX - headSize * Math.cos(angle + Math.PI / 6);
    const arrowY2 = el.endY - headSize * Math.sin(angle + Math.PI / 6);

    const headPath = `M ${arrowX1} ${arrowY1} L ${el.endX} ${el.endY} L ${arrowX2} ${arrowY2} Z`;
    return { line: linePath, head: headPath };
  };

  const getImageUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('data:image') || url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/uploads/') || url.startsWith('/assets/')) return url;
    if (url.startsWith('uploads/') || url.startsWith('assets/')) return url;
    return `assets/${url}`;
  };



  // 在原图上绘制颜色矩形框，返回 base64 data URL
  const getImageWithColorBoxes = async (imageId) => {
    const targetImage = elements.find(el => el.id === imageId);
    if (!targetImage || targetImage.type !== 'image') return null;

    const stitchBoxes = elements.filter(el => el.type === 'stitch' && el.imageId === imageId);
    if (stitchBoxes.length === 0) return null;
    return composeImageWithRegions(targetImage, stitchBoxes, getImageUrl(targetImage.url));
  };

  // drawColorBoxOnCanvas — 在给定 canvas context 上画单个颜色框
  const drawColorBoxOnCanvas = (ctx, region) => {
    ctx.fillStyle = region.color + '1A';
    ctx.fillRect(region.relX, region.relY, region.width, region.height);
    ctx.strokeStyle = region.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(region.relX, region.relY, region.width, region.height);
    const label = `${region.emoji || ''} ${region.label || ''}`;
    const fontSize = Math.max(14, Math.min(region.width, region.height) * 0.18);
    ctx.font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const textHeight = fontSize;
    const padding = 6;
    ctx.fillStyle = region.color;
    const labelY = region.relY - textHeight - padding * 2;
    ctx.beginPath();
    ctx.roundRect(region.relX, labelY > 0 ? labelY : region.relY, textWidth + padding * 2, textHeight + padding * 2, 4);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, region.relX + padding, (labelY > 0 ? labelY : region.relY) + textHeight + padding * 0.5);
  };

  const handleTriggerAI = async (params) => {
    // Support old-style (stitchBox) and new-style ({ imageId, regions, prompt }) calls
    let imageId, regions, prompt;
    if (params && typeof params === 'object' && !params.type) {
      // New-style call: { imageId, regions, prompt }
      imageId = params.imageId;
      regions = params.regions;
      prompt = params.prompt;
    } else {
      // Old-style call with stitchBox element
      const stitchBox = params;
      const targetImage = elements.find(el => el.id === stitchBox.imageId);
      if (!targetImage) {
        alert("未找到该批注对应的商品原图图层！");
        return;
      }
      imageId = targetImage.id;
      regions = [{
        id: stitchBox.id,
        color: stitchBox.color || '#3B82F6',
        colorName: stitchBox.colorName || '蓝色',
        emoji: STITCH_COLORS.find(c => c.color === stitchBox.color)?.emoji || '🔵',
        relX: stitchBox.relX,
        relY: stitchBox.relY,
        width: stitchBox.width,
        height: stitchBox.height,
        label: stitchBox.label
      }];
      prompt = stitchBox.text || '';
    }

    const targetImage = elements.find(el => el.id === imageId);
    if (!targetImage) {
      alert("未找到对应的商品原图图层！");
      return;
    }

    setLoadingImages(prev => ({ ...prev, [targetImage.id]: true }));
    if (setIsGenerating) setIsGenerating(true);

    try {
      const annotatedImage = await getImageWithColorBoxes(imageId);

      const response = await fetch('/api/generate/inpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser?.uid || 'anonymous-user',
          image: targetImage.url.replace('assets/', ''),
          annotated_image: annotatedImage,
          prompt: prompt,
          regions: regions.map(r => ({
            color: r.colorName || r.color,
            relX: r.relX,
            relY: r.relY,
            width: r.width,
            height: r.height
          })),
          fidelity: fidelity || 85
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'AI 局部重绘生图失败');
      }

      // Replace the image with the inpainted result
      pushToHistory();
      setElements(prev => prev.map(el => {
        if (el.id === imageId) {
          return { ...el, url: data.image };
        }
        return el;
      }));

      // Remove the processed stitch boxes and their connections
      const regionIds = new Set(regions.map(r => r.id).filter(Boolean));
      if (regionIds.size > 0) {
        setElements(prev => prev.filter(el =>
          !regionIds.has(el.id) &&
          !(el.type === 'connection' && regionIds.has(el.sourceStitchId))
        ));
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'AI 重绘错误');
    } finally {
      setLoadingImages(prev => ({ ...prev, [targetImage.id]: false }));
      if (setIsGenerating) setIsGenerating(false);
    }
  };

  return (
    <div 
      className={`infinite-canvas-container ${theme}-theme`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        files.forEach((file) => {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = async (readerEvent) => {
              const base64Url = readerEvent.target.result;
              if (onImageAdded) onImageAdded(base64Url, file.name);
              if (onImportImageAsset) {
                Promise.resolve(onImportImageAsset(file.name, base64Url)).catch((err) => {
                  console.error("onImportImageAsset failed:", err);
                });
              }
              
              let finalUrl = base64Url;
              if (autoCutout && processCutout) {
                if (setIsGenerating) setIsGenerating(true);
                try {
                  finalUrl = await processCutout(base64Url);
                } catch (err) {
                  console.error("processCutout dropped image failed:", err);
                } finally {
                  if (setIsGenerating) setIsGenerating(false);
                }
              }
              insertImageLayer(finalUrl, file.name);
            };
            reader.readAsDataURL(file);
          }
        });
      }}
    >
      {/* 1. Main SVG Infinite Viewport */}
      <svg
        ref={svgRef}
        className="infinite-canvas-svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          {/* Grid pattern mapping dynamically based on pan & zoom */}
          <pattern
            id="dot-grid-pattern"
            width={grid.size * camera.zoom}
            height={grid.size * camera.zoom}
            patternUnits="userSpaceOnUse"
            x={camera.x % (grid.size * camera.zoom)}
            y={camera.y % (grid.size * camera.zoom)}
          >
            <circle
              cx={(grid.size * camera.zoom) / 2}
              cy={(grid.size * camera.zoom) / 2}
              r={grid.radius * camera.zoom}
              className="grid-dot"
              style={{ opacity: grid.opacity }}
            />
          </pattern>

          {/* Markers */}
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
          </marker>
          <marker
            id="orange-arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#ff6b35" />
          </marker>
        </defs>

        {/* 1.2 SVG Transform Group representing the infinite world space */}
        <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.zoom})`}>
          
          {/* Canvas adaptive dots grid inside world space (moves and zooms dynamically) */}
          <rect
            x="-50000"
            y="-50000"
            width="100000"
            height="100000"
            fill="url(#dot-grid-pattern)"
            className="grid-background"
          />

          {elements.map((el) => {
            const isSelected = el.id === selectedId;
            const selectStyle = isSelected ? { stroke: '#ff6b35', strokeWidth: Math.max(1.5, 2.5 / camera.zoom) } : {};

            return (
              <g key={el.id} className="svg-element-group">
                {el.type === 'pen' && (
                  <path
                    d={getSvgPathString(el.points)}
                    fill="none"
                    stroke={el.color}
                    strokeWidth={el.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    {...selectStyle}
                  />
                )}

                {el.type === 'rect' && (
                  <rect
                    x={el.x}
                    y={el.y}
                    width={el.width}
                    height={el.height}
                    fill="rgba(255,255,255,0.05)"
                    stroke={el.color}
                    strokeWidth={Math.max(1, 2 / camera.zoom)}
                    rx={4}
                    ry={4}
                    {...selectStyle}
                  />
                )}

                {el.type === 'circle' && (
                  <circle
                    cx={el.cx}
                    cy={el.cy}
                    r={el.r}
                    fill="rgba(255,255,255,0.05)"
                    stroke={el.color}
                    strokeWidth={Math.max(1, 2 / camera.zoom)}
                    {...selectStyle}
                  />
                )}

                {el.type === 'arrow' && (() => {
                  const paths = getArrowPaths(el);
                  return (
                    <g>
                      <path
                        d={paths.line}
                        fill="none"
                        stroke={el.color}
                        strokeWidth={Math.max(1.5, 2.5 / camera.zoom)}
                        {...selectStyle}
                      />
                      <path
                        d={paths.head}
                        fill={el.color}
                      />
                    </g>
                  );
                })()}

                {el.type === 'text' && (
                  <text
                    x={el.x}
                    y={el.y}
                    fill={el.color}
                    fontSize={el.fontSize}
                    fontWeight="500"
                    fontFamily="Inter, system-ui, -apple-system, sans-serif"
                    style={{ userSelect: 'none' }}
                  >
                    {el.text}
                  </text>
                )}

                {el.type === 'image' && (
                  <g className="image-element-group">
                    <image
                      href={getImageUrl(el.url)}
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      style={{ pointerEvents: 'auto' }}
                      {...selectStyle}
                    />
                    {loadingImages[el.id] && (
                      <foreignObject
                        x={el.x}
                        y={el.y}
                        width={el.width}
                        height={el.height}
                      >
                        <div className="image-loading-container">
                          <div className="loading-spinner-circle" />
                        </div>
                      </foreignObject>
                    )}
                  </g>
                )}

                {el.type === 'stitch' && (
                  <g className={`stitch-element-group ${textEditor?.id === el.id ? 'active-editing' : ''}`}>
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      fill={el.color ? el.color + '1A' : 'rgba(255, 107, 53, 0.05)'}
                      stroke={el.color || '#ff6b35'}
                      strokeWidth={3}
                      strokeDasharray="none"
                      style={{ cursor: 'pointer' }}
                      {...selectStyle}
                    />
                    {/* Color label badge in top-left of box */}
                    <g
                      transform={`translate(${el.x}, ${el.y - 20})`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setSelectedId(el.id);
                      }}
                    >
                      <rect
                        width={60}
                        height={18}
                        rx={4}
                        fill={el.color || '#ff6b35'}
                      />
                      <text
                        x={30}
                        y={12}
                        fill="white"
                        fontSize={10}
                        fontWeight="700"
                        textAnchor="middle"
                        fontFamily="var(--font-main)"
                      >
                        {el.emoji || '🔵'} {el.label || ''}
                      </text>
                    </g>
                    {/* Click on box to select/delete */}
                    {isSelected && (
                      <g
                        transform={`translate(${el.x + el.width - 18}, ${el.y - 20})`}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          pushToHistory();
                          setElements(prev => prev.filter(item =>
                            item.id !== el.id &&
                            !(item.type === 'connection' && item.sourceStitchId === el.id)
                          ));
                          if (selectedId === el.id) setSelectedId(null);
                        }}
                      >
                        <circle cx={9} cy={9} r={9} fill="rgba(186, 26, 26, 0.9)" />
                        <line x1={5} y1={5} x2={13} y2={13} stroke="white" strokeWidth={1.5} />
                        <line x1={13} y1={5} x2={5} y2={13} stroke="white" strokeWidth={1.5} />
                      </g>
                    )}
                  </g>
                )}

                {el.type === 'connection' && (() => {
                  const source = elements.find(item => item.id === el.sourceStitchId);
                  const target = elements.find(item => item.id === el.targetImageId);
                  
                  if (!source || !target) return null;
                  
                  const startX = source.x + source.width;
                  const startY = source.y + source.height / 2;
                  const endX = target.x;
                  const endY = target.y + target.height / 2;
                  
                  const dx = Math.abs(endX - startX) * 0.5;
                  const controlX1 = startX + dx;
                  const controlY1 = startY;
                  const controlX2 = endX - dx;
                  const controlY2 = endY;
                  
                  const pathD = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
                  
                  return (
                    <g key={el.id} className="svg-connection-group">
                      <path
                        d={pathD}
                        fill="none"
                        stroke="#ff6b35"
                        strokeWidth={Math.max(1.5, 2.5 / camera.zoom)}
                        strokeDasharray="4 2"
                        markerEnd="url(#orange-arrowhead)"
                        style={{ cursor: 'pointer' }}
                        {...selectStyle}
                      />
                    </g>
                  );
                })()}

                {el.type === 'note' && (
                  <g>
                    {/* Sticky Note Box */}
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      fill={el.color === '#ff6b35' ? 'rgba(255, 107, 53, 0.18)' : 'rgba(255,255,255,0.08)'}
                      stroke={el.color}
                      strokeWidth={1.5}
                      rx={8}
                      ry={8}
                      className="sticky-note-card"
                      {...selectStyle}
                    />
                    {/* Centered text in Sticky Note */}
                    <text
                      x={el.x + el.width / 2}
                      y={el.y + el.height / 2 + 4}
                      fill="var(--on-surface)"
                      fontSize={13}
                      fontWeight="500"
                      textAnchor="middle"
                      fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      style={{ userSelect: 'none' }}
                    >
                      {el.text}
                    </text>
                  </g>
                )}

                {/* Draw select bounding boxes for complex shapes */}
                {isSelected && el.type !== 'pen' && (() => {
                  const boxX = el.x !== undefined ? el.x : el.cx - el.r;
                  const boxY = el.y !== undefined ? el.y : el.cy - el.r;
                  const boxW = el.width !== undefined ? el.width : el.r * 2;
                  const boxH = el.height !== undefined ? el.height : el.r * 2;
                  const handleSize = Math.max(6, 8 / camera.zoom);
                  const halfSize = handleSize / 2;

                  const positions = [
                    { dir: 'nw', x: boxX - halfSize, y: boxY - halfSize, cursor: 'nwse-resize' },
                    { dir: 'ne', x: boxX + boxW - halfSize, y: boxY - halfSize, cursor: 'nesw-resize' },
                    { dir: 'sw', x: boxX - halfSize, y: boxY + boxH - halfSize, cursor: 'nesw-resize' },
                    { dir: 'se', x: boxX + boxW - halfSize, y: boxY + boxH - halfSize, cursor: 'nwse-resize' },
                  ];

                  return (
                    <g className="resize-handles-group">
                      {/* Bounding box outline */}
                      <rect
                        x={boxX - 2}
                        y={boxY - 2}
                        width={boxW + 4}
                        height={boxH + 4}
                        fill="none"
                        stroke="#ff6b35"
                        strokeWidth={Math.max(0.5, 1 / camera.zoom)}
                        strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
                        style={{ pointerEvents: 'none' }}
                      />
                      {positions.map(pos => (
                        <rect
                          key={pos.dir}
                          x={pos.x}
                          y={pos.y}
                          width={handleSize}
                          height={handleSize}
                          fill="white"
                          stroke="#ff6b35"
                          strokeWidth={Math.max(1, 1.5 / camera.zoom)}
                          style={{ cursor: pos.cursor, pointerEvents: 'auto' }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            startResizing(e, el.id, pos.dir);
                          }}
                        />
                      ))}
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Render temp shapes while drawing */}
          {tempShape && (
            <g className="temp-drawing-shape">
              {tempShape.type === 'stitch' && (
                <rect
                  x={tempShape.x}
                  y={tempShape.y}
                  width={tempShape.width}
                  height={tempShape.height}
                  fill="rgba(59, 130, 246, 0.08)"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                />
              )}
              {tempShape.type === 'rect' && (
                <rect
                  x={tempShape.x}
                  y={tempShape.y}
                  width={tempShape.width}
                  height={tempShape.height}
                  fill="none"
                  stroke={tempShape.color}
                  strokeWidth={Math.max(1, 2 / camera.zoom)}
                  dash={[4, 4]}
                />
              )}
              {tempShape.type === 'circle' && (
                <circle
                  cx={tempShape.cx}
                  cy={tempShape.cy}
                  r={tempShape.r}
                  fill="none"
                  stroke={tempShape.color}
                  strokeWidth={Math.max(1, 2 / camera.zoom)}
                  dash={[4, 4]}
                />
              )}
              {tempShape.type === 'arrow' && (() => {
                const paths = getArrowPaths(tempShape);
                return (
                  <g>
                    <path
                      d={paths.line}
                      fill="none"
                      stroke={tempShape.color}
                      strokeWidth={Math.max(1.5, 2.5 / camera.zoom)}
                      dash={[4, 4]}
                    />
                    <path
                      d={paths.head}
                      fill={tempShape.color}
                    />
                  </g>
                );
              })()}
            </g>
          )}

          {/* Render active pen path drawing */}
          {currentPenPath && (
            <path
              d={getSvgPathString(currentPenPath.points)}
              fill="none"
              stroke={currentPenPath.color}
              strokeWidth={currentPenPath.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Render Text Editor background mask */}
          {textEditor && textEditor.type !== 'stitch' && (
            <foreignObject
              x={textEditor.x}
              y={textEditor.y - 12}
              width={textEditor.type === 'note' ? 160 : 200}
              height={textEditor.type === 'note' ? 120 : 60}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ overflow: 'visible' }}
            >
              <div
                className={`canvas-foreign-input-container ${textEditor.type}`}
                style={{
                  borderColor: strokeColor,
                  background: textEditor.type === 'note'
                    ? 'rgba(255, 165, 0, 0.15)'
                    : 'rgba(0, 0, 0, 0.75)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}
              >
                <textarea
                  autoFocus
                  value={textEditor.text}
                  onChange={(e) => setTextEditor(prev => ({ ...prev, text: e.target.value }))}
                  onBlur={commitTextEditor}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      commitTextEditor();
                    }
                  }}
                  placeholder={textEditor.type === 'note' ? '输入便签内容...' : '输入文字...'}
                  style={{
                    color: '#ffffff',
                    fontSize: textEditor.type === 'note' ? '13px' : '16px',
                  }}
                />
              </div>
            </foreignObject>
          )}
        </g>
      </svg>

      {/* Empty State Centered Overlay (Responsive, Ergonomic & Always Visible) */}
      {elements.length === 0 && (
        <div 
          className="canvas-empty-state-overlay"
          onClick={() => fileInputRef.current?.click()}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 32px',
            borderRadius: '20px',
            border: '2px dashed var(--primary)',
            background: 'var(--surface-container-low)',
            cursor: 'pointer',
            textAlign: 'center',
            width: '380px',
            maxWidth: '90%',
            boxSizing: 'border-box',
            gap: '16px',
            userSelect: 'none',
            boxShadow: 'var(--shadow-3)',
            zIndex: 10
          }}
        >
          <div style={{ 
            padding: '20px', 
            borderRadius: '50%', 
            background: 'rgba(255, 107, 53, 0.08)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(255, 107, 53, 0.15)'
          }}>
            <ImageIcon size={44} style={{ color: 'var(--primary)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--on-surface)' }}>
              开始导入商品素材
            </h3>
            <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              点击此处选择您的商品实拍图导入<br/>
              或直接拖拽图片文件到屏幕任意位置
            </p>
          </div>
          <div 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              marginTop: '8px',
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              background: 'var(--surface-container-high)', 
              padding: '8px 16px', 
              borderRadius: '20px',
              border: '1px solid var(--border-glass)',
              cursor: 'default',
              boxShadow: 'var(--shadow-1)'
            }}
          >
            <input 
              type="checkbox"
              id="empty-state-auto-cutout"
              checked={autoCutout}
              onChange={(e) => setAutoCutout && setAutoCutout(e.target.checked)}
              style={{ cursor: 'pointer', width: '14px', height: '14px', accentColor: 'var(--primary)' }}
            />
            <label 
              htmlFor="empty-state-auto-cutout"
              style={{ 
                fontSize: '0.75rem', 
                fontWeight: 600, 
                color: 'var(--on-surface-variant)', 
                cursor: 'pointer', 
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Cpu size={11} style={{ color: 'var(--primary)' }} fill={autoCutout ? 'var(--primary)' : 'none'} />
              导入图片时自动智能抠图
            </label>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileImport} 
        accept="image/*" 
        multiple
        style={{ display: 'none' }} 
      />

      {/* 2. Floating Glassmorphism Toolbar (Docked at Bottom Center) */}
      <div className="infinite-canvas-toolbar-dock" onPointerDown={(e) => e.stopPropagation()}>
        
        {/* Tool Selector */}
        <div className="toolbar-segment">
          <button
            className={`toolbar-tool-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            title="选择工具 (V)"
          >
            <Move size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'hand' ? 'active' : ''}`}
            onClick={() => setActiveTool('hand')}
            title="手形工具 (H / Space+Drag)"
          >
            <Hand size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => setActiveTool('pen')}
            title="自由画笔 (B)"
          >
            <Pencil size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'rect' ? 'active' : ''}`}
            onClick={() => setActiveTool('rect')}
            title="矩形工具 (R)"
          >
            <Square size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'circle' ? 'active' : ''}`}
            onClick={() => setActiveTool('circle')}
            title="圆形工具 (O)"
          >
            <Circle size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'arrow' ? 'active' : ''}`}
            onClick={() => setActiveTool('arrow')}
            title="箭头连接线"
          >
            <ArrowUpRight size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTool('text')}
            title="文本工具 (T)"
          >
            <Type size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'note' ? 'active' : ''}`}
            onClick={() => setActiveTool('note')}
            title="创意便签 (N)"
          >
            <StickyNote size={15} />
          </button>
          <button
            className={`toolbar-tool-btn ${activeTool === 'stitch' ? 'active' : ''}`}
            onClick={() => setActiveTool('stitch')}
            title="智能框选备注 (S)"
          >
            <MessageSquare size={15} />
          </button>
        </div>

        {/* Layer adjustment controls for selected element */}
        {selectedId && (
          <>
            <div className="toolbar-divider" />
            <div className="toolbar-segment" style={{ display: 'flex', gap: '4px' }}>
              <button
                className="toolbar-tool-btn"
                onClick={() => moveForward(selectedId)}
                title="上移一层"
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="toolbar-tool-btn"
                onClick={() => moveBackward(selectedId)}
                title="下移一层"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </>
        )}

        {/* Color Palette Segment */}
        <div className="toolbar-divider" />
        <div className="toolbar-segment color-palette">
          {[
            { value: '#ff6b35', label: '活力橙' },
            { value: '#0070f3', label: '科技蓝' },
            { value: '#10b981', label: '森林绿' },
            { value: '#8b5cf6', label: '神秘紫' },
            { value: '#ffffff', label: '极简白' }
          ].map((c) => (
            <button
              key={c.value}
              className={`color-dot-btn ${strokeColor === c.value ? 'active' : ''}`}
              style={{ backgroundColor: c.value === '#ffffff' && theme === 'light' ? '#eee' : c.value }}
              onClick={() => setStrokeColor(c.value)}
              title={c.label}
            />
          ))}
        </div>

        {/* Reset & Clear utilities */}
        <div className="toolbar-divider" />
        <div className="toolbar-segment utils">
          <button
            className="toolbar-tool-btn"
            onClick={() => fileInputRef.current?.click()}
            title="导入本地图片"
          >
            <ImageIcon size={15} />
          </button>
          <button
            className="toolbar-tool-btn"
            onClick={handleUndo}
            disabled={past.length === 0}
            title="撤销 (Ctrl+Z / Cmd+Z)"
            style={{ opacity: past.length === 0 ? 0.35 : 1, cursor: past.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            <Undo size={15} />
          </button>
          <button
            className="toolbar-tool-btn"
            onClick={handleRedo}
            disabled={future.length === 0}
            title="重做 (Ctrl+Y / Cmd+Shift+Z)"
            style={{ opacity: future.length === 0 ? 0.35 : 1, cursor: future.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            <Redo size={15} />
          </button>
          <button
            className="toolbar-tool-btn danger"
            onClick={handleClearAll}
            title="清空画布"
          >
            <Trash2 size={15} />
          </button>

        </div>
      </div>

      {/* 3. Floating Zoom Controls (Bottom Right) */}
      <div className="infinite-canvas-zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setCamera(prev => ({ ...prev, zoom: Math.max(prev.zoom - 0.1, 0.1) }))} title="缩小">
          <Minus size={13} />
        </button>
        <span onClick={handleResetCamera} title="点击重置缩放">
          {Math.round(camera.zoom * 100)}%
        </span>
        <button onClick={() => setCamera(prev => ({ ...prev, zoom: Math.min(prev.zoom + 0.1, 8.0) }))} title="放大">
          <Plus size={13} />
        </button>
        <button onClick={handleResetCamera} title="重置视口">
          <Maximize2 size={13} />
        </button>
      </div>

      {/* 4. Right Bottom Floating Helper Tips */}
      <div className="infinite-canvas-title-card">
        <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--on-surface-variant)', lineHeight: '1.4' }}>
          支持拖拽 (Space + 鼠标)、缩放 (Ctrl + 滚轮)， and 自由绘制图形。
        </p>
      </div>

      {/* 5. 常驻侧边栏聊天面板 */}
      <div className="canvas-chat-sidebar" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div className="chat-sidebar-header">
          <h3>
            <MessageSquare size={14} style={{ color: 'var(--primary)' }} />
            对话
          </h3>
          <span className="model-badge">{(() => {
            const label = (evalModel || 'standard').replace(/^eval_/, '');
            return label.charAt(0).toUpperCase() + label.slice(1);
          })()} Live</span>
        </div>

        {/* Stitch 框选提示条 */}
        {elements.filter(el => el.type === 'stitch').length > 0 && (
          <div className="chat-sidebar-stitch-bar">
            <span className="stitch-bar-label">已框选:</span>
            {elements.filter(el => el.type === 'stitch').map((el, idx) => {
              const targetImage = elements.find(img => img.id === el.imageId);
              const imageName = targetImage?.name || '图片';
              return (
                <span
                  key={el.id}
                  className="stitch-bar-chip"
                  style={{ borderColor: el.color, color: el.color }}
                  onClick={() => {
                    setSelectedId(el.id);
                    // Focus camera on the stitch box
                    if (targetImage) {
                      setCamera(prev => ({
                        x: (svgRef.current ? svgRef.current.clientWidth / 2 : 400) - targetImage.x * prev.zoom - (targetImage.width / 2) * prev.zoom,
                        y: (svgRef.current ? svgRef.current.clientHeight / 2 : 300) - targetImage.y * prev.zoom - (targetImage.height / 2) * prev.zoom,
                        zoom: prev.zoom
                      }));
                    }
                  }}
                  title={`点击定位到 ${el.emoji} ${el.label} @${imageName}`}
                >
                  {el.emoji}{el.label}
                </span>
              );
            })}
            <button
              className="stitch-bar-clear-btn"
              onClick={() => {
                const stitchIds = new Set(elements.filter(el => el.type === 'stitch').map(el => el.id));
                pushToHistory();
                setElements(prev => prev.filter(el =>
                  !stitchIds.has(el.id) &&
                  !(el.type === 'connection' && stitchIds.has(el.sourceStitchId))
                ));
                setSelectedId(null);
              }}
              title="清除所有框选"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}

        <div className="chat-sidebar-history">
          {chatMessages.map((msg, index) => {
            const isAi = msg.sender === 'ai';
            const agentKey = msg.agent || 'coordinator';
            const agentInfo = AGENT_CONFIGS[agentKey] || AGENT_CONFIGS.coordinator;

            // Product analysis card
            if (msg.type === 'product_analysis_loading') {
              return (
                <div key={msg.id || index} className="sidebar-msg sidebar-msg--ai">
                  <span className="sidebar-msg__agent" style={{ color: 'var(--primary)' }}>图片分析</span>
                  <div className="sidebar-msg__bubble">{msg.text}</div>
                </div>
              );
            }

            if (msg.type === 'product_analysis' && msg.data) {
              return (
                <div key={msg.id || index} className="sidebar-msg sidebar-msg--ai">
                  <span className="sidebar-msg__agent" style={{ color: 'var(--primary)' }}>
                    图片分析
                  </span>
                  <div className="sidebar-msg__bubble" style={{ padding: 0, background: 'transparent', border: 'none' }}>
                    <ProductAnalysisCard
                      key={`${msg.id || index}-${msg.data.status || 'error'}-${msg.data.product?.product_name || msg.data.error || ''}`}
                      analysis={msg.data}
                      confirmed={Boolean(msg.confirmed || msg.data.status === 'confirmed')}
                      isConfirming={isConfirmingProductAnalysis}
                      onConfirm={(analysis) => onConfirmProductAnalysis?.(analysis, msg.id)}
                      onRetry={() => onRetryProductAnalysis?.(msg.id)}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div key={index} className={`sidebar-msg ${isAi ? 'sidebar-msg--ai' : 'sidebar-msg--user'}`}>
                {isAi && (
                  <span className="sidebar-msg__agent" style={{ color: agentInfo.color }}>
                    {agentInfo.name}
                  </span>
                )}
                <div className="sidebar-msg__bubble">
                  {msg.images && msg.images.length > 0 && (
                    <div className="sidebar-msg__attachments">
                      {msg.images.map((img, i) => (
                        <img key={i} src={getImageUrl(img.url)} alt={img.name} className="sidebar-msg__attachment-thumb" />
                      ))}
                    </div>
                  )}
                  {msg.text}
                  {msg.recommendation && (
                    <div className="sidebar-msg__reco">
                      <div className="sidebar-msg__reco-header">
                        {msg.recommendation.type === 'add_text' ? <Lightbulb size={12} /> :
                         msg.recommendation.type === 'brand_check' ? <ShieldAlert size={12} /> :
                         <ImageIcon size={12} />}
                        <span>智能决策建议</span>
                      </div>
                      <div className="sidebar-msg__reco-body">{msg.recommendation.title}</div>
                      <button className="sidebar-msg__reco-btn" onClick={() => onRecommendationAction?.(msg.recommendation)}>
                        {msg.recommendation.actionText}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {isTyping && (
            <div className="sidebar-msg sidebar-msg--ai">
              <div className="sidebar-msg__bubble sidebar-msg__typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}
        </div>

        {onSendMessage && (
          <div className="chat-sidebar-input-row">
            <div className="chat-quick-actions">
              <label className="chat-quick-btn" title="上传一张只用于提取视觉风格的参考图" style={{ cursor: isGenerating ? 'not-allowed' : 'pointer' }}>
                🎨 风格参考图
                <input
                  type="file"
                  accept="image/*"
                  disabled={isGenerating}
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onAddStyleReference?.(file);
                    event.target.value = '';
                  }}
                />
              </label>
              {attachedImages?.some(image => image.role === 'style_reference') && (
                <button
                  className="chat-quick-btn"
                  disabled={isGenerating}
                  onClick={() => onSendMessage('按照参考图风格，为新产品生成主图、卖点图、详情图', null, { image_types: ['main', 'selling_point', 'detail'] })}
                >
                  <Zap size={11} /> 生成风格套图
                </button>
              )}
              <button
                className="chat-quick-btn"
                title="快速生成：跳过信息收集，直接生图"
                disabled={isGenerating}
                onClick={() => {
                  onSendMessage('直接生成', null, {
                    skip_info_collection: true,
                    skip_design_planning: false,
                  });
                  onInputValueChange?.('');
                }}
              >
                <Zap size={11} /> 快速生成
              </button>
              <button
                className="chat-quick-btn"
                title="跳过设计规划，直接进入生图"
                disabled={isGenerating}
                onClick={() => {
                  onSendMessage('直接生成', null, {
                    skip_info_collection: true,
                    skip_design_planning: true,
                  });
                  onInputValueChange?.('');
                }}
              >
                <Zap size={11} /> 跳过规划
              </button>
              <button
                className="chat-quick-btn"
                title="重新生成当前图片集"
                disabled={isGenerating}
                onClick={() => {
                  onSendMessage('重新生成，换一个更好的风格', null, {
                    refinement_mode: true,
                  });
                  onInputValueChange?.('');
                }}
              >
                <RotateCcw size={11} /> 重新生成
              </button>
            </div>
            {attachedImages && attachedImages.length > 0 && (
              <div className="chat-attachments-bar">
                {attachedImages.map(img => (
                  <div key={img.id} className="attachment-chip">
                    <img src={getImageUrl(img.url)} alt={img.name || '附件'} />
                    <span className="attachment-chip-name">{img.role === 'style_reference' ? '风格参考 · ' : ''}{img.name || '图片'}</span>
                    <button
                      className="attachment-chip-remove"
                      onClick={() => onRemoveAttachedImage?.(img.id)}
                      title="移除附件"
                    ><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="chat-sidebar-input-inner">
            <textarea
              value={chatInputValue || ''}
              onChange={(e) => onInputValueChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const text = (chatInputValue || '').trim();
                  if (text && !isGenerating) {
                    onSendMessage(text);
                    onInputValueChange?.('');
                  }
                }
              }}
              placeholder="输入消息..."
              disabled={isGenerating}
              rows={2}
            />
            <button
              onClick={() => {
                const text = (chatInputValue || '').trim();
                if (text && !isGenerating) {
                  onSendMessage(text);
                  onInputValueChange?.('');
                }
              }}
              disabled={isGenerating || !(chatInputValue || '').trim()}
              className="sidebar-send-btn"
            >
              <Send size={14} />
            </button>
            </div>
          </div>
        )}
      </div>

      {/* 6. 浮动批注面板 */}
      <div className="canvas-comments-accordion" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <Accordion.Root type="single" defaultValue="comments" collapsible>
          <Accordion.Item value="comments" className="accordion-item">
            <Accordion.Header className="accordion-header">
              <Accordion.Trigger className="accordion-trigger">
                <span className="accordion-trigger-label">
                  <Layers size={14} />
                  智能框选修改
                </span>
                <ChevronDownIcon size={14} className="accordion-chevron" aria-hidden />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="accordion-content">
              <div className="accordion-content-inner">
                <div className="comment-list-container">
                  {elements.filter(el => el.type === 'stitch').map((el, idx) => {
                    const targetImage = elements.find(img => img.id === el.imageId);
                    const imageName = targetImage?.name || '未知图片';
                    return (
                      <div key={el.id} className="comment-card-item">
                        <div className="comment-card-header">
                          <span className="comment-badge" style={{ background: el.color }}>
                            {el.emoji} {el.label}
                          </span>
                          <button
                            className="delete-comment-btn"
                            onClick={() => {
                              pushToHistory();
                              setElements(prev => prev.filter(item =>
                                item.id !== el.id &&
                                !(item.type === 'connection' && item.sourceStitchId === el.id)
                              ));
                              if (selectedId === el.id) setSelectedId(null);
                            }}
                          >
                            删除
                          </button>
                        </div>
                        <p className="comment-card-text">
                          框选区域 @{imageName} ({(el.width || 0).toFixed(0)}x{(el.height || 0).toFixed(0)}px)
                        </p>
                      </div>
                    );
                  })}
                  {elements.filter(el => el.type === 'stitch').length === 0 && (
                    <div className="empty-comments-state">
                      <span>暂无框选</span>
                      <p>使用智能框选工具 (S) 在商品图上拖拽，即可框选区域并通过聊天指令让 AI 修改。</p>
                    </div>
                  )}
                </div>

                {/* 参考样板与素材 */}
                <div className="panel-section" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '12px', marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h3 className="panel-title" style={{ margin: 0, fontSize: '0.8rem', fontWeight: 'bold' }}>参考样板与素材</h3>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        background: 'var(--primary)', color: 'white', border: 'none',
                        borderRadius: '4px', padding: '3px 8px', fontSize: '0.65rem',
                        cursor: 'pointer', fontWeight: 600, display: 'flex',
                        alignItems: 'center', gap: '4px'
                      }}
                    >
                      <Plus size={10} /> 上传样板
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                    {elements.filter(isReferenceCanvasImage).map((el, idx) => (
                      <div
                        key={el.id}
                        style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', border: selectedId === el.id ? '2px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.1)', aspectRatio: '1', cursor: 'pointer', background: 'rgba(0,0,0,0.2)' }}
                        onClick={() => {
                          setSelectedId(el.id);
                          setCamera(prev => ({
                            ...prev,
                            x: (svgRef.current ? svgRef.current.clientWidth / 2 : 400) - el.x * prev.zoom - (el.width / 2) * prev.zoom,
                            y: (svgRef.current ? svgRef.current.clientHeight / 2 : 300) - el.y * prev.zoom - (el.height / 2) * prev.zoom
                          }));
                        }}
                        title={el.name || `图片-${idx + 1}`}
                      >
                        <img src={getImageUrl(el.url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                        {selectedId === el.id && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(30,30,30,0.9)', display: 'flex', justifyContent: 'space-around', padding: '3px 0', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <button onClick={(e) => { e.stopPropagation(); moveForward(el.id); }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }} title="上移一层"><ChevronUp size={11} /></button>
                            <button onClick={(e) => { e.stopPropagation(); moveBackward(el.id); }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }} title="下移一层"><ChevronDown size={11} /></button>
                            <button onClick={(e) => { e.stopPropagation(); onAttachImageToChat?.(el); }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }} title="添加到对话框"><Plus size={11} /></button>
                          </div>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); pushToHistory(); setElements(prev => prev.filter(item => item.id !== el.id)); if (selectedId === el.id) setSelectedId(null); }}
                          style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(186, 26, 26, 0.95)', color: 'white', border: 'none', borderRadius: '50%', width: '14px', height: '14px', fontSize: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}
                          title="删除"
                        >✕</button>
                      </div>
                    ))}
                    {elements.filter(isReferenceCanvasImage).length === 0 && (
                      <div style={{ gridColumn: 'span 3', color: 'var(--text-secondary)', fontSize: '0.65rem', textAlign: 'center', padding: '12px 0', opacity: 0.7 }}>
                        暂无已上传的样板图片
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </div>
    </div>
  );
});

export default InfiniteCanvas;
