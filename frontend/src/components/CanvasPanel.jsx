import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Rect, Group, Image, Text, Transformer } from 'react-konva';
import useImage from 'use-image';
import { ImageIcon, Monitor, Layers, Type, Trash, Cpu, Move, Paintbrush, Eraser, RotateCcw, Hand, ZoomIn, ZoomOut, Maximize, Sliders, Eye, BarChart2, Plus, Minus, Upload, CheckCircle, FileText, CheckCircle2, ChevronRight, Check, MessageSquare, ChevronLeft, ChevronUp } from 'lucide-react';
import CloseButton from './CloseButton';

const CanvasPanel = forwardRef(({ 
  currentVersion, 
  versions = [], 
  onSelectVersion, 
  isGenerating, 
  adText,
  onUpdateAdText,
  genModel = 'gen_quality',
  titlePos,
  descPos,
  tagPos,
  titleStyle,
  descStyle,
  tagStyle,
  aspect,
  fidelity,
  syncFidelity,
  globalFidelity,
  onCommitPositions,
  onCommitStyles,
  onCommitAspect,
  onCommitFidelity,
  onToggleSyncFidelity,
  onToggleMattingDisplay,
  showDashboard,
  onToggleDashboard,
  
  // New Commercialized Custom Upload and Matting props
  productImage,
  productCutout,
  onUpdateProductCutout,
  onUpdateBackgroundImage,
  productTransform,
  onCommitProductTransform,
  canvasType = 'header', // 'header' | 'detail'
  onCommitCanvasType,
  onSwitchMode,
  showLayersPanel,
  onToggleLayersPanel,
  showChatPanel = true,
  onToggleChatPanel,
  workspaceMode = 'cowork',
  onUndo,
  annotations = [],
  onUpdateAnnotations,
  onSendMessage
}, ref) => {
  const [showOverlay, setShowOverlay] = useState(true);
  const [activeMode, setActiveMode] = useState('layout'); // 'layout' | 'brush'
  const [draggingLayer, setDraggingLayer] = useState(null); // 'title' | 'desc' | 'tag' | 'product' | null
  const [selectedLayer, setSelectedLayer] = useState(null); // 'title' | 'desc' | 'tag' | 'product' | null
  
  // Viewport zoom & pan states
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 150, y: 120 }); 
  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'brush' | 'pan'
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef(null);
  const cardGroupRef = useRef(null);
  const productNodeRef = useRef(null);
  const transformerRef = useRef(null);
  const konvaImageRef = useRef(null);
  
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [showParameters, setShowParameters] = useState(false);
  const [showRefineDropdown, setShowRefineDropdown] = useState(false);
  const [cardPos, setCardPos] = useState({ x: 400, y: 300 });
  const [bgPos, setBgPos] = useState({ x: 16, y: 16 });
  
  // Custom Matting Wizard Modal States
  const [showMattingModal, setShowMattingModal] = useState(false);
  const [mattingStep, setMattingStep] = useState('idle'); // 'idle' | 'scanning' | 'complete'
  const [mattingProgress, setMattingProgress] = useState(0);
  const [mattingQuality, setMattingQuality] = useState('refined'); // 'quick' | 'refined'
  const [tempCustomImage, setTempCustomImage] = useState(null);
  const [tempFileName, setTempFileName] = useState('');

  // Stitch Bounding Box Annotation States
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStart, setBoxStart] = useState({ x: 0, y: 0 });
  const [tempBox, setTempBox] = useState(null);
  const [activeBoxInput, setActiveBoxInput] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  
  // Viewport size detection
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!viewportRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const w = entry.contentRect.width || entry.target.clientWidth;
        const h = entry.contentRect.height || entry.target.clientHeight;
        setViewportSize({ width: w, height: h });
        // Only set initial cardPos if it's currently at default or not dragged yet
        setCardPos(prev => {
          if (prev.x === 400 && prev.y === 300) return { x: w / 2, y: h / 2 };
          return prev;
        });
      }
    });
    resizeObserver.observe(viewportRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Keyboard shortcut listeners (V, B, H, D, P, Space, Delete and Ctrl+Z)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' || 
        e.target.tagName === 'TEXTAREA' || 
        e.target.isContentEditable
      ) {
        return;
      }

      // Check for Ctrl + Z / Cmd + Z (Undo)
      if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'z') {
        if (onUndo) {
          onUndo();
          e.preventDefault();
          return;
        }
      }

      // Check for Delete / Backspace (Delete Layer)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayer === 'product') {
          if (onUpdateProductCutout) onUpdateProductCutout(null);
          setSelectedLayer(null);
          e.preventDefault();
          return;
        }
      }

      if (e.code === 'Space') {
        setIsSpacePressed(true);
        e.preventDefault();
      } else if (e.code === 'KeyV') {
        setActiveTool('select');
      } else if (e.code === 'KeyB') {
        setActiveTool('brush');
      } else if (e.code === 'KeyH') {
        setActiveTool('pan');
      } else if (e.code === 'KeyS') {
        setActiveTool('stitch');
      } else if (e.code === 'KeyD') {
        if (onToggleDashboard) onToggleDashboard();
      } else if (e.code === 'KeyP') {
        setShowParameters(prev => !prev);
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
  }, [onToggleDashboard, selectedLayer, onUndo, onUpdateProductCutout, onUpdateAdText, adText]);

  // Bind transformer node
  useEffect(() => {
    if (selectedLayer === 'product' && transformerRef.current && productNodeRef.current) {
      transformerRef.current.nodes([productNodeRef.current]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedLayer, currentVersion, aspect]);

  // Handle stage mouse events for zoom & panning & brush drawing
  const handleStageMouseDown = (e) => {
    const nativeEvent = e.evt;
    const isMiddleClick = nativeEvent.button === 1;
    
    // Close matting refinement dropdown if open
    setShowRefineDropdown(false);

    // Pan if spacebar pressed, active tool is pan, middle mouse button clicked, or clicking empty stage area
    let clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'grid-bg';
    
    if (activeMode === 'layout') {
      const isInteractive = 
        e.target.name() === 'product-cutout-node' ||
        e.target.className === 'Transformer' ||
        e.target.getParent()?.className === 'Transformer';
      // Do not set clickedOnEmpty = !isInteractive here, because that makes card-bg drag pan the stage!
    }
    
    if (activeTool === 'pan' || isSpacePressed || isMiddleClick || clickedOnEmpty) {
      setIsPanning(true);
      panStartRef.current = { x: nativeEvent.clientX, y: nativeEvent.clientY };
      panOffsetStartRef.current = { ...pan };
    } else if (activeTool === 'stitch') {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (cardGroupRef.current) {
        const transform = cardGroupRef.current.getAbsoluteTransform().copy().invert();
        const localCardPos = transform.point(pointer);
        const imgX = localCardPos.x - imgOriginX;
        const imgY = localCardPos.y - imgOriginY;
        
        // Ensure click starts inside the e-commerce image bounds
        if (imgX >= 0 && imgX <= imageWidth && imgY >= 0 && imgY <= imageHeight) {
          setIsDrawingBox(true);
          setBoxStart({ x: imgX, y: imgY });
          setTempBox({ x: imgX, y: imgY, width: 0, height: 0 });
          setActiveBoxInput(null);
          setCommentText('');
        }
      }
    } else if (activeMode === 'brush') {
      setIsDrawing(true);
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (cardGroupRef.current) {
        const transform = cardGroupRef.current.getAbsoluteTransform().copy().invert();
        const localCardPos = transform.point(pointer);
        const canvasX = localCardPos.x - imgOriginX;
        const canvasY = localCardPos.y - imgOriginY;
        
        const canvas = maskCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx.beginPath();
          ctx.moveTo(canvasX, canvasY);
          lastPosRef.current = { x: canvasX, y: canvasY };
          setHasMask(true);
        }
      }
    }
  };

  const handleStageMouseMove = (e) => {
    const nativeEvent = e.evt;
    if (isPanning) {
      const dx = nativeEvent.clientX - panStartRef.current.x;
      const dy = nativeEvent.clientY - panStartRef.current.y;
      setPan({
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy
      });
    } else if (isDrawingBox && activeTool === 'stitch') {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (cardGroupRef.current) {
        const transform = cardGroupRef.current.getAbsoluteTransform().copy().invert();
        const localCardPos = transform.point(pointer);
        const imgX = Math.max(0, Math.min(imageWidth, localCardPos.x - imgOriginX));
        const imgY = Math.max(0, Math.min(imageHeight, localCardPos.y - imgOriginY));
        
        const x = Math.min(boxStart.x, imgX);
        const y = Math.min(boxStart.y, imgY);
        const w = Math.abs(boxStart.x - imgX);
        const h = Math.abs(boxStart.y - imgY);
        
        setTempBox({ x, y, width: w, height: h });
      }
    } else if (isDrawing && activeMode === 'brush') {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (cardGroupRef.current) {
        const transform = cardGroupRef.current.getAbsoluteTransform().copy().invert();
        const localCardPos = transform.point(pointer);
        const canvasX = localCardPos.x - imgOriginX;
        const canvasY = localCardPos.y - imgOriginY;
        
        const canvas = maskCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx.lineTo(canvasX, canvasY);
          ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : 'rgba(239, 68, 68, 0.45)';
          ctx.lineWidth = brushSize;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
          ctx.stroke();
          
          lastPosRef.current = { x: canvasX, y: canvasY };
          setHasMask(true);
          if (konvaImageRef.current) {
            konvaImageRef.current.getLayer()?.batchDraw();
          }
        }
      }
    }
  };

  const handleStageMouseUp = () => {
    setIsPanning(false);
    setIsDrawing(false);
    if (isDrawingBox && activeTool === 'stitch') {
      setIsDrawingBox(false);
      if (tempBox && tempBox.width > 5 && tempBox.height > 5) {
        setActiveBoxInput({ ...tempBox });
      } else {
        setTempBox(null);
      }
    }
  };

  const handleStageWheel = (e) => {
    e.evt.preventDefault();
    const nativeEvent = e.evt;
    
    // Only zoom if Ctrl/Cmd key is pressed (Standard design tool behavior)
    if (nativeEvent.ctrlKey || nativeEvent.metaKey) {
      const zoomIntensity = 0.04;
      const rect = viewportRef.current.getBoundingClientRect();
      const mouseX = nativeEvent.clientX - rect.left;
      const mouseY = nativeEvent.clientY - rect.top;
      
      let newZoom;
      if (nativeEvent.deltaY < 0) {
        newZoom = Math.min(zoom + zoomIntensity, 3.0); // max 300%
      } else {
        newZoom = Math.max(zoom - zoomIntensity, 0.2); // min 20%
      }
      
      const zoomFactor = newZoom / zoom;
      setPan(prev => ({
        x: mouseX - (mouseX - prev.x) * zoomFactor,
        y: mouseY - (mouseY - prev.y) * zoomFactor
      }));
      setZoom(newZoom);
    } else {
      // Normal scroll wheel: pan the stage (Figma/Canva style)
      const scrollSpeed = 1.0;
      if (nativeEvent.shiftKey) {
        // Shift + scroll: horizontal pan
        setPan(prev => ({
          ...prev,
          x: prev.x - nativeEvent.deltaY * scrollSpeed
        }));
      } else {
        // Regular scroll: vertical and horizontal pan
        setPan(prev => ({
          x: prev.x - nativeEvent.deltaX * scrollSpeed,
          y: prev.y - nativeEvent.deltaY * scrollSpeed
        }));
      }
    }
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    if (aspect === '1:1') {
      setPan({ x: 250, y: 150 });
    } else if (aspect === 'detail') {
      setPan({ x: 250, y: 30 });
    } else {
      setPan({ x: 150, y: 120 });
    }
  };

  // Center canvas on load or when ratio changes
  useEffect(() => {
    handleResetZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);

  // Sync activeMode with activeTool
  useEffect(() => {
    if (activeTool === 'select') setActiveMode('layout');
    else if (activeTool === 'brush') setActiveMode('brush');
    else if (activeTool === 'pan') setActiveMode('pan');
    else if (activeTool === 'stitch') setActiveMode('stitch');
  }, [activeTool]);
  

  // Brush mask states
  const [maskCanvas] = useState(() => (
    typeof document !== 'undefined' ? document.createElement('canvas') : null
  ));
  const maskCanvasRef = useRef(maskCanvas);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(24);
  const [isEraser, setIsEraser] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  // Local temporary fidelity state for responsive range dragging
  const [localFidelity, setLocalFidelity] = useState(85);


  // Sync local fidelity state when prop changes
  useEffect(() => {
    if (fidelity !== undefined) {
      setLocalFidelity(fidelity);
    }
  }, [fidelity]);

  const isDetail = aspect === 'detail';
  const imageWidth = aspect === '1:1' ? 380 : 320;
  const imageHeight = aspect === '1:1' ? 380 : isDetail ? 640 : 426;
  const cardWidth = imageWidth + 32;
  const cardHeight = imageHeight + 32;

  const imgOriginX = workspaceMode === 'cowork' ? bgPos.x : 16;
  const imgOriginY = workspaceMode === 'cowork' ? bgPos.y : 16;

  // Initialize and size canvas on mode change or aspect ratio change
  useEffect(() => {
    const canvas = maskCanvasRef.current || document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    maskCanvasRef.current = canvas;
    setHasMask(false);
    if (konvaImageRef.current) {
      konvaImageRef.current.getLayer()?.batchDraw();
    }
  }, [imageWidth, imageHeight, currentVersion, aspect]);

  // Expose canvas utilities to parent via ref
  useImperativeHandle(ref, () => ({
    hasMask: () => hasMask,
    getMaskDataUrl: () => {
      if (maskCanvasRef.current) {
        return maskCanvasRef.current.toDataURL();
      }
      return null;
    },
    clearMask: () => {
      clearMask();
    }
  }), [hasMask]);


  // Drag & Transform handlers for Product Cutout layer
  const handleProductDragMove = (e) => {
    if (draggingLayer !== 'product') setDraggingLayer('product');
  };

  const handleProductDragEnd = (e) => {
    const node = e.target;
    setDraggingLayer(null);
    if (onCommitProductTransform) {
      onCommitProductTransform({
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation()
      });
    }
  };

  const handleProductTransformEnd = (e) => {
    const node = e.target;
    if (onCommitProductTransform) {
      onCommitProductTransform({
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation()
      });
    }
  };

  function clearMask() {
    if (maskCanvasRef.current) {
      const canvas = maskCanvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasMask(false);
      if (konvaImageRef.current) {
        konvaImageRef.current.getLayer()?.batchDraw();
      }
    }
  }

  const handleDeleteAnnotation = (id) => {
    const updated = annotations.filter(ann => ann.id !== id);
    onUpdateAnnotations(updated);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  };

  const handleSendAnnotationToAi = async (ann) => {
    // 1. Create offscreen canvas of background image size
    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, imageWidth, imageHeight);
    
    // 2. Draw solid mask inside the bounding box
    ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
    
    const maskDataUrl = canvas.toDataURL('image/png');
    
    // 3. Trigger inpainting
    if (onSendMessage) {
      onSendMessage(ann.text, maskDataUrl);
      // Auto-delete the annotation box after submitting to keep it clean
      handleDeleteAnnotation(ann.id);
    }
  };

  // Click on background scene image to toggle matting view
  const handleImageClick = (e) => {
    if (activeMode !== 'layout') return;
    if (e.target.name() === 'product-cutout-node') {
      setSelectedLayer('product');
      return;
    }
    
    // Clicking elsewhere clears product selection
    if (selectedLayer === 'product') {
      setSelectedLayer(null);
    }
    
    if (currentVersion && (currentVersion.aiMatting || currentVersion.refinedMatting)) {
      onToggleMattingDisplay();
    }
  };


  // Fidelity slider scale values
  const currentFidelity = syncFidelity ? globalFidelity : localFidelity;

  const handleFidelityChange = (e) => {
    const val = parseInt(e.target.value);
    setLocalFidelity(val);
    if (syncFidelity) {
      onCommitFidelity(val);
    }
  };

  const handleFidelityMouseUp = () => {
    if (!syncFidelity) {
      onCommitFidelity(localFidelity);
    }
  };

  const handleSyncToggleChange = (e) => {
    const checked = e.target.checked;
    onToggleSyncFidelity(checked);
    if (checked) {
      setLocalFidelity(globalFidelity);
      onCommitFidelity(globalFidelity);
    }
  };

  // Onboard Custom Image uploads
  const handleMattingUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setTempFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setTempCustomImage(reader.result); // base64
    };
    reader.readAsDataURL(file);
  };

  // Client side Chroma Keying Matting logic
  const executeMatting = () => {
    if (!tempCustomImage) return;
    setMattingStep('scanning');
    setMattingProgress(0);

    // Animate scanning progress bar
    const interval = setInterval(() => {
      setMattingProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          
          // Execute chroma key extraction on canvas
          const img = window.document.createElement('img');
          img.src = tempCustomImage;
          img.onload = () => {
            const canvas = window.document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;

            // Extract corner background pixels to average color
            const corners = [
              { r: data[0], g: data[1], b: data[2] },
              { r: data[(canvas.width - 1) * 4], g: data[(canvas.width - 1) * 4 + 1], b: data[(canvas.width - 1) * 4 + 2] },
              { r: data[(canvas.height - 1) * canvas.width * 4], g: data[(canvas.height - 1) * canvas.width * 4 + 1], b: data[(canvas.height - 1) * canvas.width * 4 + 2] },
              { r: data[(canvas.height * canvas.width - 1) * 4], g: data[(canvas.height * canvas.width - 1) * 4 + 1], b: data[(canvas.height * canvas.width - 1) * 4 + 2] }
            ];

            const bgR = Math.round(corners.reduce((sum, c) => sum + c.r, 0) / 4);
            const bgG = Math.round(corners.reduce((sum, c) => sum + c.g, 0) / 4);
            const bgB = Math.round(corners.reduce((sum, c) => sum + c.b, 0) / 4);

            const threshold = mattingQuality === 'refined' ? 35 : 20;

            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i+1];
              const b = data[i+2];

              const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
              if (dist < threshold) {
                data[i+3] = 0; // Transparent
              }
            }

            ctx.putImageData(imgData, 0, 0);
            
            // Scan bounding box of non-transparent pixels (alpha > 0)
            let minX = canvas.width;
            let minY = canvas.height;
            let maxX = 0;
            let maxY = 0;
            let hasVisiblePixels = false;

            for (let y = 0; y < canvas.height; y++) {
              for (let x = 0; x < canvas.width; x++) {
                const idx = (y * canvas.width + x) * 4;
                const alpha = data[idx + 3];
                if (alpha > 0) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                  hasVisiblePixels = true;
                }
              }
            }

            let cutoutBase64 = '';
            if (hasVisiblePixels) {
              // Add a small safety padding (e.g. 4px) and clamp to canvas bounds
              const padding = 4;
              minX = Math.max(0, minX - padding);
              minY = Math.max(0, minY - padding);
              maxX = Math.min(canvas.width - 1, maxX + padding);
              maxY = Math.min(canvas.height - 1, maxY + padding);

              const croppedWidth = maxX - minX + 1;
              const croppedHeight = maxY - minY + 1;

              // Create new canvas for cropping
              const cropCanvas = window.document.createElement('canvas');
              cropCanvas.width = croppedWidth;
              cropCanvas.height = croppedHeight;
              const cropCtx = cropCanvas.getContext('2d');

              // Copy matted pixel data from original canvas
              const croppedData = ctx.getImageData(minX, minY, croppedWidth, croppedHeight);
              cropCtx.putImageData(croppedData, 0, 0);

              cutoutBase64 = cropCanvas.toDataURL('image/png');
            } else {
              cutoutBase64 = canvas.toDataURL('image/png');
            }

            setTempCustomImage(cutoutBase64);
            setMattingStep('complete');
          };
          
          return 100;
        }
        return p + 5;
      });
    }, 80);
  };

  const handleConfirmImportCutout = () => {
    if (onUpdateProductCutout) {
      onUpdateProductCutout(tempCustomImage);
    }
    if (onCommitProductTransform) {
      onCommitProductTransform(null);
    }
    setShowMattingModal(false);
    setTempCustomImage(null);
    setMattingStep('idle');
  };

  const handleConfirmImportBackground = () => {
    if (onUpdateBackgroundImage) {
      onUpdateBackgroundImage(tempCustomImage);
    }
    setShowMattingModal(false);
    setTempCustomImage(null);
    setMattingStep('idle');
  };


  // Image Loader via hook
  const displayImageName = (
    currentVersion?.displayMattingState === 'ai_standard'
      ? currentVersion.aiMatting 
      : currentVersion?.refinedMatting
  ) || currentVersion?.image;

  const getImageUrl = (imageName) => {
    if (!imageName || typeof imageName !== 'string') return '';
    return imageName.startsWith('data:image') ? imageName : `assets/${imageName}`;
  };

  // Load Background scene image
  const [backgroundImg] = useImage(getImageUrl(displayImageName));
  
  // Load Product Cutout image
  const [productCutoutImg] = useImage(productCutout || getImageUrl(productImage));



  // Clip path for rounded image corners inside Konva card
  const clipFunc = (ctx) => {
    const r = 8;
    const x = 16;
    const y = 16;
    const w = imageWidth;
    const h = imageHeight;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };


  // Initializing default product transform values
  let defaultScale = isDetail ? 0.7 : 0.85;
  if (productCutoutImg) {
    const maxProdWidth = imageWidth * 0.6;
    const maxProdHeight = imageHeight * 0.6;
    const scaleX = maxProdWidth / productCutoutImg.width;
    const scaleY = maxProdHeight / productCutoutImg.height;
    defaultScale = Math.min(scaleX, scaleY, 1);
  }
  const prodX = productTransform?.x ?? (16 + imageWidth / 2);
  const prodY = productTransform?.y ?? (16 + (isDetail ? 180 : imageHeight / 2));
  const prodScaleX = productTransform?.scaleX ?? defaultScale;
  const prodScaleY = productTransform?.scaleY ?? defaultScale;
  const prodRotation = productTransform?.rotation ?? 0;

  // Render empty state if version hasn't generated yet
  if (!currentVersion) {
    if (isGenerating) {
      return (
        <div ref={viewportRef} className="infinite-canvas-viewport">
          <div className="infinite-canvas-grid" />
          <div className="infinite-canvas-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <div className="canvas-image-card" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: aspect === '1:1' ? '380px' : '320px', minHeight: aspect === '1:1' ? '380px' : '426px', position: 'absolute' }}>
              <div className="canvas-container-aspect" style={{ aspectRatio: aspect === '1:1' ? '1 / 1' : '3 / 4', width: '100%', position: 'relative', overflow: 'hidden', borderRadius: '8px', boxShadow: 'inset 0 0 1px rgba(255,255,255,0.15)' }}>
                <div className="canvas-loading-overlay animate-fade-in" style={{ zIndex: 30, background: 'rgba(24, 25, 30, 0.95)' }}>
                  <Layers className="logo-icon" size={32} style={{ animation: 'pulseGlow 1.5s infinite ease-in-out', color: 'var(--primary)' }} />
                  <div className="scanner-bar"></div>
                  <div className="loading-text" style={{ fontSize: '0.75rem', padding: '0 12px', color: 'rgba(255,255,255,0.8)' }}>
                    正在为您生成首版创意商品图与排版...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div 
      ref={viewportRef}
      className={`infinite-canvas-viewport ${workspaceMode === 'cowork' ? 'cowork-mode' : ''}`}
    >
      {/* 1. Infinite dots grid */}
      <div className="infinite-canvas-grid" />

      {/* 2. Konva Stage */}
      <Stage
        width={viewportSize.width}
        height={viewportSize.height}
        x={pan.x}
        y={pan.y}
        scaleX={zoom}
        scaleY={zoom}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onWheel={handleStageWheel}
        onTouchStart={handleStageMouseDown}
        onTouchMove={handleStageMouseMove}
        onTouchEnd={handleStageMouseUp}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Layer>
          {/* Card Group */}
          <Group
            x={cardPos.x}
            y={cardPos.y}
            offsetX={cardWidth / 2}
            offsetY={cardHeight / 2}
            ref={cardGroupRef}
            onClick={handleImageClick}
            onTap={handleImageClick}
            draggable={activeMode === 'layout'}
            onDragMove={(e) => {
              if (e.target === cardGroupRef.current) {
                setCardPos({ x: e.target.x(), y: e.target.y() });
              }
            }}
            onDragEnd={(e) => {
              if (e.target === cardGroupRef.current) {
                setCardPos({ x: e.target.x(), y: e.target.y() });
              }
            }}
          >
            {/* 1. Card background Rect (Artboard Frame) */}
            <Rect
              x={0}
              y={0}
              width={cardWidth}
              height={cardHeight}
              fill="#ffffff"
              stroke={workspaceMode === 'cowork' ? 'var(--primary)' : 'rgba(0, 0, 0, 0.05)'}
              strokeWidth={workspaceMode === 'cowork' ? 1.5 : 1}
              cornerRadius={12}
              shadowColor="black"
              shadowBlur={30}
              shadowOpacity={0.12}
              shadowOffset={{ x: 0, y: 8 }}
              name="card-bg"
            />

            {/* Figma-style Artboard Frame Title */}
            {workspaceMode === 'cowork' && (
              <Text
                x={8}
                y={-22}
                text={`🎨 主图创意画布 (${aspect === '1:1' ? '800 × 800 px' : aspect === '3:4' ? '600 × 800 px' : '320 × 640 px'})`}
                fontSize={11}
                fill="var(--primary)"
                fontStyle="bold"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
              />
            )}

            {/* 2. Main E-commerce layout group with rounded clip path */}
            <Group clipFunc={clipFunc}>
              
              {/* Header Image Mode or Long Detail Page Mode */}
              {!isDetail ? (
                // --- 2.1 HEADER / SQUARE VIEW ---
                <>
                  {/* Background Scene */}
                  {backgroundImg && (
                    <Image
                      image={backgroundImg}
                      x={workspaceMode === 'cowork' ? bgPos.x : 16}
                      y={workspaceMode === 'cowork' ? bgPos.y : 16}
                      width={imageWidth}
                      height={imageHeight}
                      name="product-image"
                      draggable={workspaceMode === 'cowork' && activeMode === 'layout'}
                      onDragEnd={(e) => {
                        if (workspaceMode === 'cowork') {
                          setBgPos({ x: e.target.x(), y: e.target.y() });
                        }
                      }}
                    />
                  )}
                  
                  {/* Separate Product Cutout Layer (If loaded) */}
                  {productCutoutImg && (
                    <Image
                      image={productCutoutImg}
                      x={prodX}
                      y={prodY}
                      scaleX={prodScaleX}
                      scaleY={prodScaleY}
                      rotation={prodRotation}
                      offsetX={productCutoutImg.width / 2}
                      offsetY={productCutoutImg.height / 2}
                      draggable={activeMode === 'layout'}
                      onDragMove={handleProductDragMove}
                      onDragEnd={handleProductDragEnd}
                      onTransformEnd={handleProductTransformEnd}
                      name="product-cutout-node"
                      ref={productNodeRef}
                    />
                  )}
                </>
              ) : (
                // --- 2.2 VERTICAL LONG DETAIL PAGE VIEW (1:2 aspect) ---
                <>
                  {/* Top Scene Background (320x320 Square) */}
                  {backgroundImg && (
                    <Image
                      image={backgroundImg}
                      x={workspaceMode === 'cowork' ? bgPos.x : 16}
                      y={workspaceMode === 'cowork' ? bgPos.y : 16}
                      width={320}
                      height={320}
                      name="product-image"
                      draggable={workspaceMode === 'cowork' && activeMode === 'layout'}
                      onDragEnd={(e) => {
                        if (workspaceMode === 'cowork') {
                          setBgPos({ x: e.target.x(), y: e.target.y() });
                        }
                      }}
                    />
                  )}

                  {/* Top Product Cutout inside Detail Hero */}
                  {productCutoutImg && (
                    <Image
                      image={productCutoutImg}
                      x={prodX}
                      y={prodY}
                      scaleX={prodScaleX}
                      scaleY={prodScaleY}
                      rotation={prodRotation}
                      offsetX={productCutoutImg.width / 2}
                      offsetY={productCutoutImg.height / 2}
                      draggable={activeMode === 'layout'}
                      onDragMove={handleProductDragMove}
                      onDragEnd={handleProductDragEnd}
                      onTransformEnd={handleProductTransformEnd}
                      name="product-cutout-node"
                      ref={productNodeRef}
                    />
                  )}

                  {/* Middle highlights container */}
                  {workspaceMode !== 'cowork' && (
                    <>
                      <Rect
                        x={16}
                        y={336}
                        width={320}
                        height={130}
                        fill="rgba(255, 255, 255, 0.03)"
                        stroke="rgba(255, 255, 255, 0.05)"
                        strokeWidth={1}
                        cornerRadius={6}
                      />
                      <Text
                        x={28}
                        y={348}
                        text="🌟 电商爆款卖点解析 (Features)"
                        fontSize={12}
                        fill="var(--primary)"
                        fontStyle="bold"
                        fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      />
                      <Text
                        x={28}
                        y={372}
                        text={`• 主体特色: ${adText.title || '法式优雅商用精品'}`}
                        fontSize={10}
                        fill="#ffffff"
                        fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      />
                      <Text
                        x={28}
                        y={394}
                        text={`• 营销卖点: ${adText.desc || '黄金光影呈现与材质细节'}`}
                        fontSize={10}
                        fill="rgba(255,255,255,0.7)"
                        fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      />
                      <Text
                        x={28}
                        y={416}
                        text="• 测款分析: 算法推荐，已通过品牌VI色系一致性安全审核"
                        fontSize={10}
                        fill="rgba(255,255,255,0.7)"
                        fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      />

                      {/* Bottom specifications table container */}
                      <Rect
                        x={16}
                        y={466}
                        width={320}
                        height={158}
                        fill="rgba(255, 255, 255, 0.01)"
                        stroke="rgba(255, 255, 255, 0.05)"
                        strokeWidth={1}
                        cornerRadius={6}
                      />
                      <Text
                        x={28}
                        y={478}
                        text="📁 官方规格说明 (Specifications)"
                        fontSize={12}
                        fill="#ffffff"
                        fontStyle="bold"
                        fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      />

                      {/* Specs Grid Rows */}
                      <LineDraw x1={28} y1={502} x2={324} y2={502} color="rgba(255,255,255,0.08)" />
                      <Text x={28} y={510} text="商品品类" fontSize={9} fill="rgba(255,255,255,0.5)" />
                      <Text x={120} y={510} text="AI 生成服饰/美妆/商用高定" fontSize={9} fill="#ffffff" />

                      <LineDraw x1={28} y1={532} x2={324} y2={532} color="rgba(255,255,255,0.08)" />
                      <Text x={28} y={540} text="核心材质" fontSize={9} fill="rgba(255,255,255,0.5)" />
                      <Text x={120} y={540} text="环保材质 / 智能纤维 / 高光玻璃" fontSize={9} fill="#ffffff" />

                      <LineDraw x1={28} y1={562} x2={324} y2={562} color="rgba(255,255,255,0.08)" />
                      <Text x={28} y={570} text="安全级别" fontSize={9} fill="rgba(255,255,255,0.5)" />
                      <Text x={120} y={570} text="国家A类母婴安全级标准" fontSize={9} fill="#ffffff" />
                    </>
                  )}
                </>
              )}

              {/* 3. Mask overlay drawing */}
              <Image
                image={maskCanvas}
                x={workspaceMode === 'cowork' ? bgPos.x : 16}
                y={workspaceMode === 'cowork' ? bgPos.y : 16}
                width={imageWidth}
                height={imageHeight}
                ref={konvaImageRef}
                listening={false}
                name="mask-image"
              />

              {/* confirmed annotations */}
              {annotations.map((ann, idx) => (
                <Group key={ann.id}>
                  {/* Bounding Box Rect */}
                  <Rect
                    x={ann.x + imgOriginX}
                    y={ann.y + imgOriginY}
                    width={ann.width}
                    height={ann.height}
                    stroke="#FF6B35"
                    strokeWidth={Math.max(1, 2 / zoom)}
                    dash={[4, 4]}
                    fill={selectedAnnotationId === ann.id ? "rgba(255, 107, 53, 0.2)" : "rgba(255, 107, 53, 0.08)"}
                    onClick={(e) => {
                      e.cancelBubble = true; // prevent clicks from bubbling up to clear selection
                      setSelectedAnnotationId(ann.id);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      setSelectedAnnotationId(ann.id);
                    }}
                  />
                  {/* Badge Container */}
                  <Group
                    x={ann.x + imgOriginX}
                    y={ann.y + imgOriginY - Math.max(12, 18 / zoom)}
                  >
                    <Rect
                      width={Math.max(36, 48 / zoom)}
                      height={Math.max(12, 16 / zoom)}
                      fill="#FF6B35"
                      cornerRadius={2}
                    />
                    <Text
                      text={`💬 #${idx + 1}`}
                      fontSize={Math.max(8, 10 / zoom)}
                      fill="#ffffff"
                      fontStyle="bold"
                      align="center"
                      verticalAlign="middle"
                      width={Math.max(36, 48 / zoom)}
                      height={Math.max(12, 16 / zoom)}
                      fontFamily="Inter, system-ui, -apple-system, sans-serif"
                    />
                  </Group>
                </Group>
              ))}

              {/* Bounding Box dragging temp display */}
              {tempBox && (
                <Rect
                  x={tempBox.x + imgOriginX}
                  y={tempBox.y + imgOriginY}
                  width={tempBox.width}
                  height={tempBox.height}
                  stroke="#FF6B35"
                  strokeWidth={Math.max(1, 1.5 / zoom)}
                  dash={[4, 4]}
                  fill="rgba(255, 107, 53, 0.05)"
                  listening={false}
                />
              )}
            </Group>



            {/* 5. Transform controls for product cutout image layer */}
            {selectedLayer === 'product' && activeMode === 'layout' && (
              <Transformer
                ref={transformerRef}
                keepRatio={true}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 40 || newBox.height < 40) return oldBox;
                  return newBox;
                }}
              />
            )}

          </Group>
        </Layer>
      </Stage>

      {/* 3. HTML Overlay Elements */}

      {/* Loading overlay tracked to image position */}
      {isGenerating && (
        <div 
          className="canvas-loading-overlay animate-fade-in" 
          style={{ 
            position: 'absolute',
            left: `${pan.x + (viewportSize.width / 2 - cardWidth / 2 + 16) * zoom}px`,
            top: `${pan.y + (viewportSize.height / 2 - cardHeight / 2 + 16) * zoom}px`,
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            zIndex: 30,
            borderRadius: `${8 * zoom}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(24, 25, 30, 0.82)',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none'
          }}
        >
          <Layers className="logo-icon" size={Math.max(16, 32 * zoom)} style={{ animation: 'pulseGlow 1.5s infinite ease-in-out', color: 'var(--primary)' }} />
          <div className="scanner-bar" style={{ height: `${2 * zoom}px` }}></div>
          <div className="loading-text" style={{ fontSize: `${Math.max(0.5, 0.75 * zoom)}rem`, padding: '0 12px', marginTop: '12px' }}>
            {hasMask ? '正在进行二阶段抠图处理...' : '正在为您微调背景画面并重构...'}
          </div>
        </div>
      )}

      {/* Top-Right floating Cpu Refinement Icon & Dropdown overlay */}
      {currentVersion && (currentVersion.aiMatting || currentVersion.refinedMatting) && (
        <div 
          style={{
            position: 'absolute',
            left: `${pan.x + (cardPos.x + cardWidth / 2 + 16) * zoom}px`,
            top: `${pan.y + (cardPos.y - cardHeight / 2 - 16) * zoom}px`,
            transform: `translate(0, 0) scale(${Math.max(0.7, Math.min(1.2, zoom))})`,
            transformOrigin: 'bottom left',
            zIndex: 150,
          }}
        >
          <button
            className="matting-refine-trigger-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowRefineDropdown(!showRefineDropdown);
            }}
            title="精修模式选择"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'rgba(24, 25, 30, 0.85)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: 'white',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.2s ease',
            }}
          >
            <Cpu size={16} style={{ color: currentVersion.displayMattingState === 'refined' ? '#22c55e' : '#eab308' }} />
          </button>

          {showRefineDropdown && (
            <div
              className="matting-refine-dropdown glass-panel"
              style={{
                position: 'absolute',
                top: '38px',
                right: 0,
                width: '160px',
                background: 'rgba(24, 25, 30, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '6px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                zIndex: 160,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className={`refine-option-btn ${currentVersion.displayMattingState === 'ai_standard' ? 'active' : ''}`}
                onClick={() => {
                  onToggleMattingDisplay('ai_standard');
                  setShowRefineDropdown(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: currentVersion.displayMattingState === 'ai_standard' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  border: 'none',
                  color: 'white',
                  fontSize: '0.75rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', background: '#eab308', borderRadius: '50%' }}></span>
                  AI 原始抠图
                </span>
                {currentVersion.displayMattingState === 'ai_standard' && <Check size={12} style={{ color: '#eab308' }} />}
              </button>
              <button
                className={`refine-option-btn ${currentVersion.displayMattingState === 'refined' ? 'active' : ''}`}
                onClick={() => {
                  onToggleMattingDisplay('refined');
                  setShowRefineDropdown(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: currentVersion.displayMattingState === 'refined' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  border: 'none',
                  color: 'white',
                  fontSize: '0.75rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', background: '#22c55e', borderRadius: '50%' }}></span>
                  算法精修
                </span>
                {currentVersion.displayMattingState === 'refined' && <Check size={12} style={{ color: '#22c55e' }} />}
              </button>
            </div>
          )}
        </div>
      )}



      {/* Floating Toolbar for Inpaint Brush Mode */}
      {activeMode === 'brush' && (
        <div className="canvas-floating-toolbar animate-fade-in" style={{ borderColor: 'rgba(239, 68, 68, 0.25)', left: '16px', top: '16px', zIndex: 110 }} onClick={(e) => e.stopPropagation()}>
          <div className="toolbar-group">
            <span className="brush-indicator-badge">
              <Paintbrush size={10} />
              <span>抠图画笔已激活</span>
            </span>

            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', marginLeft: '12px' }}>粗细:</span>
            <input 
              type="range" 
              min="8" 
              max="50" 
              className="canvas-control-slider"
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              style={{ width: '70px', height: '6px' }}
            />
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'white' }}>{brushSize}px</span>
          </div>

          <div className="toolbar-group" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '12px', marginLeft: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', userSelect: 'none' }}>
              <input 
                type="checkbox" 
                className="canvas-control-checkbox"
                checked={syncFidelity} 
                onChange={handleSyncToggleChange}
              />
              <span>同步全局</span>
            </label>
            
            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', marginLeft: '8px' }}>保真度:</span>
            <input 
              type="range" 
              min="10" 
              max="100" 
              className="canvas-control-slider"
              value={currentFidelity}
              onChange={handleFidelityChange}
              onMouseUp={handleFidelityMouseUp}
              onTouchEnd={handleFidelityMouseUp}
              style={{ width: '70px', height: '6px' }}
            />
            <span style={{ fontSize: '0.7rem', fontWeight: 600, minWidth: '30px', color: 'white' }}>{currentFidelity}%</span>
          </div>

          <div className="toolbar-group">
            <button
              className={`canvas-control-btn ${isEraser ? 'active' : ''}`}
              onClick={() => setIsEraser(!isEraser)}
              title="擦除已圈选/涂抹的区域"
            >
              <Eraser size={12} />
              <span>橡皮擦</span>
            </button>

            <button
              className="canvas-control-btn danger"
              onClick={clearMask}
              title="清空当前所有圈选/涂抹区域"
            >
              <RotateCcw size={12} />
              <span>清除区域</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Right vertical tool-palette */}
      <div className="tool-palette-floating" onClick={(e) => e.stopPropagation()}>
        {/* Tool Group 1: Navigation & Drawing Mode */}
        <div className="tool-group-floating">
          <button 
            className={`tool-btn-floating ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            title="选择与排版拖拽 (V)"
          >
            <Move size={16} />
          </button>
          <button 
            className={`tool-btn-floating ${activeTool === 'brush' ? 'active' : ''}`}
            onClick={() => setActiveTool('brush')}
            title="局部抠图画笔 (B)"
          >
            <Paintbrush size={16} />
          </button>
          <button 
            className={`tool-btn-floating ${activeTool === 'stitch' ? 'active' : ''}`}
            onClick={() => setActiveTool('stitch')}
            title="智能框选备注 (S)"
          >
            <MessageSquare size={16} />
          </button>
          <button 
            className={`tool-btn-floating ${activeTool === 'pan' ? 'active' : ''}`}
            onClick={() => setActiveTool('pan')}
            title="平移手势手抓 (H / Hold Space)"
          >
            <Hand size={16} />
          </button>
        </div>

        {/* Tool Group 2: Ratio & Settings overlay */}
        <div className="tool-group-floating">
          <button 
            className="tool-btn-floating"
            onClick={() => {
              // Cycle through 1:1 -> 3:4 -> detail
              const nextAspect = aspect === '1:1' ? '3:4' : aspect === '3:4' ? 'detail' : '1:1';
              onCommitAspect(nextAspect);
            }}
            title={`当前画布规格为: ${aspect === '1:1' ? '1:1 (方图主图)' : aspect === '3:4' ? '3:4 (竖屏主图)' : '商品详情页长图'}`}
          >
            <span style={{ fontSize: '0.6rem', fontWeight: 800 }}>
              {aspect === 'detail' ? '详情' : aspect}
            </span>
          </button>
          
          {/* Matting cabin entry */}
          <button 
            className="tool-btn-floating"
            onClick={() => setShowMattingModal(true)}
            title="智能抠图舱 (一键抠图)"
          >
            <Upload size={16} />
          </button>

          <button 
            className={`tool-btn-floating ${showOverlay ? 'active' : ''}`}
            onClick={() => setShowOverlay(!showOverlay)}
            title="文案图层显示开关"
          >
            <Layers size={16} />
          </button>
          {currentVersion && (currentVersion.aiMatting || currentVersion.refinedMatting) && (
            <button 
              className="tool-btn-floating"
              onClick={onToggleMattingDisplay}
              title={`抠图状态: ${currentVersion.displayMattingState === 'refined' ? '精修 (点击切为AI原图)' : 'AI原图 (点击切为精修)'}`}
            >
              <Eye size={16} style={{ color: currentVersion.displayMattingState === 'refined' ? '#22c55e' : '#eab308' }} />
            </button>
          )}
        </div>

        {/* Tool Group 3: Metric Dashboard Overlay Toggle */}
        <div className="tool-group-floating">
          <button 
            className={`tool-btn-floating ${showDashboard ? 'active' : ''}`}
            onClick={onToggleDashboard}
            title="显示预测决策看板 (D)"
          >
            <BarChart2 size={16} />
          </button>
          <button 
            className={`tool-btn-floating ${showParameters ? 'active' : ''}`}
            onClick={() => setShowParameters(!showParameters)}
            title="生图引擎参数面板 (P)"
          >
            <Sliders size={16} />
          </button>
        </div>

        {/* Tool Group 4: Reset Camera */}
        <div className="tool-group-floating">
          <button 
            className="tool-btn-floating"
            onClick={handleResetZoom}
            title="还原视口与缩放"
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>

      {/* Floating Parameters Panel */}
      {showParameters && (
        <div 
          className="nanobanana-settings-panel glass-panel animate-fade-in" 
          style={{ 
            position: 'absolute',
            top: '16px',
            right: showDashboard ? '440px' : '64px',
            width: '320px',
            zIndex: 120,
            borderRadius: '12px',
            padding: '16px',
            pointerEvents: 'auto'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>
              <Cpu size={14} className="logo-icon" />
              <span>
                {genModel === 'gen_quality' && '智能融合调节舱'}
                {genModel === 'gen_artistic' && 'AI 创意渲染舱'}
                {genModel === 'gen_ultrahd' && 'AI 风格精修舱'}
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {genModel === 'gen_quality' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                      <span>主体形体锁定 (Geometry Lock)</span>
                      <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>98%</span>
                    </div>
                    <input type="range" min="0" max="100" defaultValue="98" className="canvas-control-slider" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                      <span>环境光感融合强度 (Illumination Blend)</span>
                      <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>85%</span>
                    </div>
                    <input type="range" min="0" max="100" defaultValue="85" className="canvas-control-slider" />
                  </div>
                </>
              )}
              
              {genModel === 'gen_artistic' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                      <span>画风权重 (Stylize Parameter)</span>
                      <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>--s 750</span>
                    </div>
                    <input type="range" min="0" max="1000" defaultValue="750" className="canvas-control-slider" />
                  </div>
                </>
              )}

              {genModel === 'gen_ultrahd' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                      <span>提示词引导系数 (CFG Scale)</span>
                      <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>7.5</span>
                    </div>
                    <input type="range" min="1" max="20" step="0.5" defaultValue="7.5" className="canvas-control-slider" />
                  </div>
                </>
              )}

            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-glass-tint)', paddingTop: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--on-surface-variant)' }}>生成规格 (Resolution)</span>
                <select className="canvas-control-select" defaultValue="4K UltraHD (Banana Pro)">
                  <option value="1080p">1080p FHD Standard</option>
                  <option value="2K">2K QHD Studio</option>
                  <option value="4K UltraHD (Banana Pro)">4K UltraHD (AI Pro)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Right Layers Toggle Button */}
      <button 
        className={`floating-layers-btn ${showLayersPanel ? 'active' : ''}`}
        onClick={() => onToggleLayersPanel && onToggleLayersPanel()}
        title="查看当前设计图层大纲"
      >
        <Layers size={14} />
        <span>图层大纲</span>
      </button>

      {/* Floating Bottom Right Zoom Badge */}
      <div className="zoom-badge-floating" onClick={(e) => e.stopPropagation()}>
        <button className="zoom-action-btn" onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.2))}><Minus size={12} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="zoom-action-btn" onClick={() => setZoom(prev => Math.min(prev + 0.1, 3.0))}><Plus size={12} /></button>
      </div>

      {/* Version History Thumbnails Floating (overlay at bottom left) */}
      <div 
        className="version-history-floating" 
        onClick={(e) => e.stopPropagation()}
      >
        <span className="version-label" style={{ color: 'var(--on-surface-variant)', fontSize: '0.7rem' }}>历史版本:</span>
        <div className="version-list" style={{ marginTop: '4px', gap: '6px' }}>
          {versions.map((ver, index) => {
            const isCtrHigh = ver.metrics.ctr >= 5.0;
            const isCtrMed = ver.metrics.ctr >= 3.5 && ver.metrics.ctr < 5.0;
            
            const displayImage = ver.displayMattingState === 'ai_standard'
              ? (ver.aiMatting || ver.image)
              : (ver.refinedMatting || ver.image);
            
            return (
              <div
                key={ver.id}
                className={`version-item ${currentVersion.id === ver.id ? 'active' : ''}`}
                onClick={() => onSelectVersion(index)}
                title={`版本 V${index + 1} (${ver.name}) - CTR: ${ver.metrics.ctr.toFixed(2)}%`}
              >
                <img src={getImageUrl(displayImage)} className="version-img" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <span 
                  className={`version-badge ${isCtrHigh ? 'ctr-high' : isCtrMed ? 'ctr-med' : 'ctr-low'}`}
                  style={{ fontSize: '0.55rem', padding: '1px 3px', bottom: '2px', right: '2px' }}
                >
                  V{index + 1}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Interactive E-commerce Matting cabin Modal Overlay */}
      {showMattingModal && (
        <div className="onboarding-modal-overlay" style={{ zIndex: 200 }}>
          <div className="onboarding-modal-content glass-panel animate-fade-scale" style={{ maxWidth: '520px', width: '90%', padding: '20px' }}>
            <CloseButton onClick={() => setShowMattingModal(false)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', borderBottom: '1px solid var(--border-glass-tint)', paddingBottom: '8px' }}>
              <Cpu size={18} className="logo-icon" style={{ color: 'var(--primary)' }} />
              <h3 className="matting-modal-title" style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>AI 商品智能抠图舱 (Matting Cabin)</h3>
            </div>

            {mattingStep === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="file-upload-zone-matting">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleMattingUpload}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                  />
                  {tempCustomImage ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle2 size={24} style={{ color: '#22c55e' }} />
                      <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 600 }}>图片载入成功: {tempFileName}</span>
                      <div style={{ width: '80px', height: '80px', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)', marginTop: '4px' }}>
                        <img src={tempCustomImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload size={24} style={{ margin: '0 auto 8px', color: 'var(--outline)' }} />
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--on-surface)' }}>选择或拖拽上传一张新的商品照片</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--on-surface-variant)', marginTop: '2px' }}>我们将基于四角色彩平均进行智能背景色相去除</div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>抠图渲染精度 (Accuracy)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      className={`canvas-control-btn ${mattingQuality === 'quick' ? 'active' : ''}`}
                      onClick={() => setMattingQuality('quick')}
                      style={{ fontSize: '0.7rem', padding: '6px 0', justifyContent: 'center' }}
                    >
                      AI 快速分割 (粗糙)
                    </button>
                    <button
                      type="button"
                      className={`canvas-control-btn ${mattingQuality === 'refined' ? 'active' : ''}`}
                      onClick={() => setMattingQuality('refined')}
                      style={{ fontSize: '0.7rem', padding: '6px 0', justifyContent: 'center' }}
                    >
                      算法边缘精修 (细腻)
                    </button>
                  </div>
                </div>

                <button
                  className="submit-btn gradient-bg"
                  disabled={!tempCustomImage}
                  onClick={executeMatting}
                  style={{ padding: '8px 0', border: 'none', margin: '4px 0 0', opacity: tempCustomImage ? 1 : 0.5 }}
                >
                  启动 AI 边缘抠图提取
                </button>
              </div>
            )}

            {mattingStep === 'scanning' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: '16px' }}>
                <div style={{ position: 'relative', width: '150px', height: '150px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)' }}>
                  <img src={tempCustomImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div 
                    className="scanner-bar"
                    style={{ 
                      position: 'absolute', 
                      width: '100%', 
                      height: '3px', 
                      background: 'var(--primary)',
                      boxShadow: '0 0 8px var(--primary)',
                      animation: 'scanVertical 1.5s infinite linear' 
                    }}
                  />
                </div>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                    <span>
                      {mattingProgress < 30 && '🔍 正在分析图片色彩分布与边界特征...'}
                      {mattingProgress >= 30 && mattingProgress < 75 && '✂️ 正在剥离背景并提取商品边缘...'}
                      {mattingProgress >= 75 && '✨ 正在平滑边缘并渲染透明遮罩图层...'}
                    </span>
                    <span>{mattingProgress}%</span>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: 'var(--border-glass-tint)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${mattingProgress}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.1s ease-out' }} />
                  </div>
                </div>
              </div>
            )}

            {mattingStep === 'complete' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  {/* Before / After preview */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--on-surface-variant)', marginBottom: '4px' }}>原始素材</div>
                    <div style={{ width: '120px', height: '120px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-glass)' }}>
                      <img src={tempCustomImage.startsWith('data:image/png;base64') ? tempCustomImage : tempCustomImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'var(--bg-main)' }} />
                    </div>
                  </div>
                  <ChevronRight size={20} style={{ alignSelf: 'center', color: 'var(--outline)' }} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: '#22c55e', marginBottom: '4px' }}>✨ 抠图提取完成</div>
                    <div className="matting-checkerboard">
                      <img src={tempCustomImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  </div>
                </div>

                 <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px', width: '100%' }}>
                  <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                    <button
                      type="button"
                      className="settings-btn save gradient-bg"
                      style={{ flex: 1, padding: '8px 0', fontSize: '0.8rem', border: 'none', background: 'linear-gradient(135deg, var(--primary), var(--secondary))', color: 'white', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}
                      onClick={handleConfirmImportBackground}
                    >
                      🖼️ 导入为背景图层
                    </button>
                    <button
                      type="button"
                      className="settings-btn save"
                      style={{ flex: 1, padding: '8px 0', fontSize: '0.8rem', border: '1px solid var(--border-glass)', background: 'var(--surface-container-low)', color: 'var(--on-surface)', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}
                      onClick={handleConfirmImportCutout}
                    >
                      🧥 导入为商品图层
                    </button>
                  </div>
                  <button
                    type="button"
                    className="settings-btn cancel"
                    style={{ width: '100%', padding: '6px 0', fontSize: '0.75rem', cursor: 'pointer', borderRadius: '8px', border: '1px solid var(--outline-variant)', background: 'transparent' }}
                    onClick={() => {
                      setTempCustomImage(null);
                      setMattingStep('idle');
                    }}
                  >
                    重新上传
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Minimized AI Decision Assistant Trigger Button (保留的最小化按钮) */}
      {workspaceMode === 'cowork' && !showChatPanel && (
        <div 
          onClick={() => onToggleChatPanel && onToggleChatPanel()}
          className="ai-decision-assistant-minimized-btn animate-fade-in"
          style={{ 
            position: 'absolute', 
            top: '24px', 
            left: '24px', 
            zIndex: 100, 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'var(--glass-bg-light)',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--border-glass)',
            boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
            userSelect: 'none',
            transition: 'all 0.2s ease'
          }}
          title="对话"
        >
          <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
          <span className="comment-orange-dot" style={{ position: 'absolute', top: '10px', right: '10px', width: '6px', height: '6px', background: '#FF6B35', borderRadius: '50%' }} />
        </div>
      )}

      {/* Bottom Left Floating History/Log Panel (Stitch Style) - 历史版本与AI决策助手融合 */}
      {workspaceMode === 'cowork' && (
        <div className="history-panel-floating-card" style={{ position: 'absolute', bottom: '24px', left: '24px', width: '288px', maxHeight: '420px', overflowY: 'auto', zIndex: 100, pointerEvents: 'auto', background: 'var(--glass-bg-light)', backdropFilter: 'blur(20px)', borderRadius: '16px', padding: '12px', border: '1px solid var(--border-glass)', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--on-surface)', borderBottom: '1px solid var(--border-glass-tint)', paddingBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageSquare size={14} style={{ color: '#FF6B35' }} />
            <span>智能修改批注 (Stitch)</span>
          </div>
          
          <div className="history-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {annotations.length === 0 ? (
              <div style={{ fontSize: '0.65rem', color: 'var(--outline)', textAlign: 'center', marginTop: '4px', fontStyle: 'italic', padding: '0 4px', lineHeight: '1.4' }}>
                提示：切换右侧 💬 智能框选备注工具，在画布上框选目标区域即可新增批注
              </div>
            ) : (
              annotations.map((ann, idx) => (
                <div 
                  key={ann.id}
                  className="history-item-row" 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column',
                    gap: '6px', 
                    fontSize: '0.7rem', 
                    color: 'var(--on-surface)', 
                    background: selectedAnnotationId === ann.id ? 'rgba(255, 107, 53, 0.08)' : 'var(--surface-container-lowest)', 
                    padding: '8px 10px', 
                    borderRadius: '8px', 
                    border: selectedAnnotationId === ann.id ? '1px solid #FF6B35' : '1px solid var(--border-glass-tint)', 
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                  onClick={() => setSelectedAnnotationId(ann.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, color: '#FF6B35' }}>
                    <span>💬 批注 #{idx + 1}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAnnotation(ann.id);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--outline)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="删除批注"
                    >
                      <Trash size={12} className="hover:text-red-500" />
                    </button>
                  </div>
                  <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.65rem', lineHeight: '1.4' }}>
                    "{ann.text}"
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSendAnnotationToAi(ann);
                      }}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.6rem',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                        color: 'white',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Cpu size={10} />
                      <span>送去 AI 修改</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {!showChatPanel && (
            <div 
              className={`agent-log-toggle-btn ${showChatPanel ? 'active' : ''}`}
              onClick={() => onToggleChatPanel && onToggleChatPanel()}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'var(--on-surface)',
                background: 'var(--surface-container-low)',
                border: '1px solid var(--border-glass)',
                borderRadius: '10px',
                transition: 'all 0.2s',
                cursor: 'pointer',
                marginTop: '4px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MessageSquare size={14} style={{ color: 'var(--primary)' }} />
                <span>对话</span>
              </div>
              <ChevronUp size={14} className="toggle-icon-arrow" style={{ transform: showChatPanel ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--outline)' }} />
            </div>
          )}
        </div>
      )}

      {/* Stitch Bounding Box Comment Popover */}
      {activeBoxInput && (
        <div 
          className="stitch-comment-popover glass-panel animate-fade-in"
          style={{
            position: 'absolute',
            left: `${Math.min(viewportSize.width - 240, Math.max(16, pan.x + (cardPos.x - cardWidth / 2 + imgOriginX + activeBoxInput.x) * zoom))}px`,
            top: `${Math.min(viewportSize.height - 180, Math.max(16, pan.y + (cardPos.y - cardHeight / 2 + imgOriginY + activeBoxInput.y + activeBoxInput.height) * zoom + 8))}px`,
            width: '220px',
            zIndex: 160,
            background: 'var(--glass-bg-light)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-glass)',
            borderRadius: '12px',
            padding: '12px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.15)',
            pointerEvents: 'auto'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '8px' }}>
            <MessageSquare size={14} />
            <span>添加 AI 修改备注</span>
          </div>
          <textarea
            autoFocus
            rows={2}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="例如：把这里换成一束红玫瑰，背景光影调亮"
            className="canvas-control-textarea"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--border-glass-tint)',
              borderRadius: '6px',
              padding: '6px 8px',
              fontSize: '0.7rem',
              color: 'var(--on-surface)',
              resize: 'none',
              marginBottom: '8px',
              outline: 'none'
            }}
          />
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                setActiveBoxInput(null);
                setTempBox(null);
              }}
              style={{
                padding: '4px 8px',
                fontSize: '0.65rem',
                borderRadius: '6px',
                border: '1px solid var(--outline-variant)',
                background: 'transparent',
                color: 'var(--on-surface-variant)',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              disabled={!commentText.trim()}
              onClick={() => {
                const newAnnotation = {
                  id: 'ann-' + Date.now(),
                  x: activeBoxInput.x,
                  y: activeBoxInput.y,
                  width: activeBoxInput.width,
                  height: activeBoxInput.height,
                  text: commentText.trim()
                };
                const updatedAnnotations = [...annotations, newAnnotation];
                onUpdateAnnotations(updatedAnnotations);
                setActiveBoxInput(null);
                setTempBox(null);
                setCommentText('');
              }}
              style={{
                padding: '4px 8px',
                fontSize: '0.65rem',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: commentText.trim() ? 1 : 0.5
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// Helper component to draw simple grid lines in Konva Specs Table
function LineDraw({ x1, y1, x2, y2, color }) {
  const points = [x1, y1, x2, y2];
  return (
    <Text 
      text=""
      visible={false}
      ref={(node) => {
        if (node) {
          const parent = node.getParent();
          // Find or create Konva.Line node
          let line = parent.findOne('#line-' + x1 + '-' + y1);
          if (!line) {
            line = new window.Konva.Line({
              id: 'line-' + x1 + '-' + y1,
              points: points,
              stroke: color,
              strokeWidth: 1,
              listening: false
            });
            parent.add(line);
            line.moveToBottom();
          }
        }
      }}
    />
  );
}

export default CanvasPanel;
