/**
 * useAgentStream — SSE event handler hook for agent chat-stream.
 *
 * Extracted from App.jsx to reduce component size and improve testability.
 * Each event type has a dedicated handler for clear separation of concerns.
 */

import { useCallback, useRef } from 'react';

const TOOL_LABELS = {
  generate_image: '正在生成图片...',
  evaluate_image: '正在评估图片质量...',
  query_canvas: '正在查询画布状态...',
  search_knowledge: '正在搜索知识库...',
  update_plan: '正在更新设计方案...',
  finish_task: '任务完成',
};

/**
 * Create SSE event handlers bound to React state setters.
 *
 * @param {Object} deps — state setters and refs
 * @param {Function} deps.setChatMessages
 * @param {Function} deps.setProductInfo
 * @param {Function} deps.setCurrentUser
 * @param {Object} deps.streamingResult — mutable ref for collecting results
 * @param {Object} deps.infiniteCanvasRef — ref to InfiniteCanvas instance
 * @param {Function} deps.saveCanvasState
 * @param {string} deps.currentSessionId
 * @param {Object} deps.IMAGE_TYPE_LABELS
 * @returns {Object} { handleSSEEvent, createSSEBody }
 */
export function useAgentStream(deps) {
  const {
    setChatMessages,
    setProductInfo,
    setCurrentUser,
    streamingResult,
    infiniteCanvasRef,
    saveCanvasState,
    currentSessionId,
    IMAGE_TYPE_LABELS,
  } = deps;

  const handleSSEEvent = useCallback((event) => {
    switch (event.event) {
      // ── Agent text messages ──
      case 'agent_message':
        setChatMessages(prev => [...prev, {
          sender: 'ai',
          agent: event.agent || 'coordinator',
          text: event.text,
        }]);
        break;

      case 'chitchat_reply':
        if (event.text) {
          setChatMessages(prev => [...prev, {
            sender: 'ai',
            agent: 'coordinator',
            text: event.text,
          }]);
        }
        break;

      case 'new_design_started':
        if (event.text) {
          setChatMessages(prev => [...prev, {
            sender: 'ai',
            agent: 'coordinator',
            text: event.text,
          }]);
        }
        break;

      // ── Phase events ──
      case 'info_complete': {
        const chatHistory = event.chat_history || [];
        const lastMsg = chatHistory[chatHistory.length - 1];
        if (lastMsg?.role === 'assistant') {
          setChatMessages(prev => [...prev, {
            sender: 'ai',
            agent: 'planner',
            text: lastMsg.content,
          }]);
        }
        break;
      }

      case 'phase_complete':
        if (streamingResult) {
          streamingResult.product_name = event.product_name || '';
          streamingResult.selling_points = event.selling_points || '';
          streamingResult.image_types = event.image_types || [];
          streamingResult.style_preference = event.style_preference || '';
        }
        break;

      // ── Image generation events ──
      case 'image_progress':
        if (streamingResult) {
          streamingResult.generated_images[event.image_type] = event.url;
        }
        {
          const imgType = event.image_type || '图片';
          const imgLabel = IMAGE_TYPE_LABELS?.[imgType]
            ? `${IMAGE_TYPE_LABELS[imgType].name}`
            : `${imgType}`;
          infiniteCanvasRef?.current?.insertImageLayer(event.url, imgLabel);
        }
        break;

      case 'image_done':
        if (streamingResult) {
          streamingResult.generated_images = event.all_images || {};
        }
        if (event.warning) {
          setChatMessages(prev => [...prev, {
            sender: 'ai',
            agent: 'coordinator',
            text: `部分图片生成遇到问题: ${event.warning}`,
          }]);
        }
        // Ensure all generated images are on canvas
        {
          const canvasEls = infiniteCanvasRef?.current?.getElements?.() || [];
          const canvasUrls = new Set(canvasEls.filter(e => e.type === 'image').map(e => e.url));
          const allImages = event.all_images || {};
          Object.entries(allImages).forEach(([imgType, imgUrl]) => {
            if (!canvasUrls.has(imgUrl)) {
              const cfg = IMAGE_TYPE_LABELS?.[imgType];
              const label = cfg ? cfg.name : imgType;
              infiniteCanvasRef?.current?.insertImageLayer(imgUrl, `${label}（已生成）`);
            }
          });
          // Delay canvas state save for image loading
          setTimeout(() => {
            const els = infiniteCanvasRef?.current?.getElements?.() || [];
            const cam = infiniteCanvasRef?.current?.getCamera?.() || { x: 400, y: 300, zoom: 1.0 };
            saveCanvasState?.(currentSessionId, { elements: els, camera: cam });
          }, 2000);
        }
        break;

      case 'images_saved':
        if (event.images && streamingResult) {
          const prevImages = { ...streamingResult.generated_images };
          streamingResult.generated_images = { ...prevImages, ...event.images };
          Object.entries(event.images).forEach(([imgType, localUrl]) => {
            const oldUrl = prevImages[imgType];
            if (oldUrl && oldUrl !== localUrl) {
              infiniteCanvasRef?.current?.replaceImageUrl?.(oldUrl, localUrl);
            }
          });
        }
        if (event.remainingCredits != null) {
          setCurrentUser?.(prev => ({ ...prev, remainingCredits: event.remainingCredits }));
        }
        break;

      // ── ReAct Agent events ──
      case 'agent_thinking':
        if (event.text) {
          setChatMessages(prev => [...prev, {
            sender: 'ai',
            agent: 'react_agent',
            text: `${event.text.slice(0, 200)}`,
          }]);
        }
        break;

      case 'agent_tool_start': {
        const label = TOOL_LABELS[event.tool] || `正在执行: ${event.tool}`;
        setChatMessages(prev => [...prev, {
          sender: 'ai',
          agent: 'react_agent',
          text: `${label}`,
        }]);
        break;
      }

      // ── Flow control events ──
      case 'flow_decision':
        if (event.text) {
          setChatMessages(prev => [...prev, {
            sender: 'ai',
            agent: 'coordinator',
            text: `${event.text}`,
          }]);
        }
        break;

      case 'intent_detected':
        // Debug only — log to console
        console.log(`[Intent] Detected: ${event.intent}, sub: ${event.sub_intent || '-'}, phase: ${event.current_phase}`);
        break;

      // ── Memory events ──
      case 'memory_updated':
        if (event.agent_memory) {
          const mem = event.agent_memory;
          if (mem.product_name) {
            setProductInfo?.(prev => ({
              ...prev,
              name: mem.product_name || prev.name,
              sellingPoints: mem.selling_points || prev.sellingPoints,
              styleId: mem.style_preference || prev.styleId,
            }));
          }
        }
        break;

      // ── Internal events (no UI action) ──
      case 'evaluation_progress':
      case 'design_plan':
      case 'phase_start':
        break;

      // ── Terminal events ──
      case 'error':
        throw new Error(event.message || 'Stream processing error');

      case 'done':
        break;

      default:
        console.warn(`[useAgentStream] Unknown event: ${event.event}`);
    }
  }, [
    setChatMessages,
    setProductInfo,
    setCurrentUser,
    streamingResult,
    infiniteCanvasRef,
    saveCanvasState,
    currentSessionId,
    IMAGE_TYPE_LABELS,
  ]);

  return { handleSSEEvent };
}
