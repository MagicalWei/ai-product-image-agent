// src/components/FoldersPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Folder, FolderOpen, FileImage, Plus, Trash2, Upload, FileCode, Search, ImagePlus, AlertTriangle, RefreshCw, Video } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { resolveAssetUrl } from '../lib/utils';
import { fetchJsonWithRetry } from '../lib/reliableFetch';

const assetCacheKey = (uid) => `asset_warehouse_cache:${uid}`;

function readAssetCache(uid) {
  if (!uid) return [];
  try {
    const cached = JSON.parse(localStorage.getItem(assetCacheKey(uid)) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function writeAssetCache(uid, assets) {
  if (!uid) return;
  try {
    localStorage.setItem(assetCacheKey(uid), JSON.stringify(assets));
  } catch {
    // Storage can be unavailable in privacy mode. The server remains authoritative.
  }
}

export default function FoldersPanel({ versions, setVersions, onSelectAsset }) {
  const auth = useAuth();
  const { currentUser, isAuthenticated, isAuthLoading } = auth;
  const userId = currentUser?.uid || currentUser?.id;

  const [activeCategory, setActiveCategory] = useState('all'); // 'all' | 'ai_generated' | 'user_uploaded'
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [brokenAssets, setBrokenAssets] = useState(new Set());

  // Fetch assets from server
  const fetchAssets = useCallback(async () => {
    if (isAuthLoading) return;
    if (!isAuthenticated || !userId) {
      setLoading(false);
      setLoadError('登录状态尚未恢复，暂时无法读取素材。');
      return;
    }

    const cachedAssets = readAssetCache(userId);
    if (cachedAssets.length > 0) {
      setAssets((current) => current.length > 0 ? current : cachedAssets);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setLoadError('');
    try {
      const { response, data } = await fetchJsonWithRetry('/api/assets', {
        credentials: 'include'
      }, {
        attempts: 4,
        timeoutMs: 30000,
      });
      if (response.ok && data.success) {
        const nextAssets = Array.isArray(data.assets) ? data.assets : [];
        setAssets(nextAssets);
        setBrokenAssets(new Set());
        writeAssetCache(userId, nextAssets);
        return;
      }

      const message = response.status === 401 || response.status === 403
        ? '登录状态已失效，请重新登录后重试。'
        : data.message || data.error || data.detail || '素材库暂时加载失败，请重试。';
      setLoadError(message);
    } catch (err) {
      console.warn('Failed to fetch assets:', err);
      setLoadError('网络连接不稳定，素材数据仍然保留，可点击重试。');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isAuthLoading, userId]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const reader = new FileReader();
      const base64Url = await new Promise((resolve) => {
        reader.onload = (ev) => resolve(ev.target.result);
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: file.name,
          data: base64Url
        }),
        credentials: 'include'
      });

      const data = await res.json();
      if (res.ok && data.success) {
        await fetchAssets(); // re-fetch full list
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      e.target.value = ''; // reset file input
    }
  };

  // Classify each asset by source field
  const aiGeneratedItems = assets.filter(a => a.source === 'ai_generated');
  const userUploadedItems = assets.filter(a => a.source === 'user_uploaded');

  const allItems = assets;

  let filteredItems = activeCategory === 'all'
    ? allItems
    : activeCategory === 'ai_generated'
      ? aiGeneratedItems
      : userUploadedItems;

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredItems = filteredItems.filter(item => (item.name || '').toLowerCase().includes(q));
  }

  const handleDeleteFile = async (id) => {
    // Optimistic UI update
    setAssets(prev => prev.filter(f => f.id !== id));
    try {
      const response = await fetch(`/api/assets/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        await fetchAssets(); // revert on failure
      }
    } catch (err) {
      console.error('Failed to delete asset:', err);
      await fetchAssets();
    }
  };

  const handleSaveRename = (item) => {
    if (!editingName.trim()) return;
    const newName = editingName.trim();
    setAssets(prev => prev.map(a => a.id === item.id ? { ...a, name: newName } : a));
    setEditingId(null);
  };

  return (
    <div className="folders-panel-container animate-fade-scale" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '20px', height: 'calc(100vh - 110px)', padding: '10px 0' }}>

      {/* Categories Sidebar */}
      <div className="folders-sidebar glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '8px', color: 'var(--on-surface)' }}>
          📁 资产媒体库
        </h3>
        {[
          { id: 'all', name: '全部资产', count: allItems.length },
          { id: 'ai_generated', name: 'AI生成内容', count: aiGeneratedItems.length },
          { id: 'user_uploaded', name: '商拍原图/上传', count: userUploadedItems.length },
        ].map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: 'none',
              padding: '10px 12px',
              borderRadius: '8px',
              background: activeCategory === cat.id ? 'var(--surface-container-highest)' : 'transparent',
              color: activeCategory === cat.id ? 'var(--primary)' : 'var(--on-surface-variant)',
              fontWeight: activeCategory === cat.id ? 600 : 500,
              fontSize: '0.8rem',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeCategory === cat.id ? <FolderOpen size={16} /> : <Folder size={16} />}
              <span>{cat.name}</span>
            </div>
            <span style={{ fontSize: '0.7rem', padding: '1px 6px', background: 'rgba(0,0,0,0.05)', borderRadius: '10px' }}>
              {cat.count}
            </span>
          </button>
        ))}
      </div>

      {/* Main Files Grid */}
      <div className="folders-grid-area glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>

        {/* Top bar with search and upload button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
          <div style={{ position: 'relative', width: '250px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--outline)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="搜索媒体资产文件..."
              style={{ fontSize: '0.75rem', padding: '6px 12px 6px 30px' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div>
            <label className="settings-btn save" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '6px 16px', fontSize: '0.8rem' }}>
              <Upload size={14} />
              <span>{uploading ? '上传中...' : '上传新素材'}</span>
              <input type="file" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} accept="image/*" />
            </label>
          </div>
        </div>

        {/* Files Grid */}
        {loadError && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(224, 85, 85, 0.08)',
            border: '1px solid rgba(224, 85, 85, 0.22)',
            color: 'var(--on-surface)',
            fontSize: '0.76rem'
          }} role="alert">
            <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <AlertTriangle size={15} color="#e05555" />
              {loadError}
            </span>
            <button
              type="button"
              onClick={fetchAssets}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                flexShrink: 0,
                padding: '5px 9px',
                borderRadius: '6px',
                border: '1px solid var(--outline-variant)',
                background: 'var(--surface)',
                color: 'var(--primary)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        )}
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            加载中...
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 160px)',
            gap: '16px',
            flex: 1
          }}>
            {filteredItems.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)', fontSize: '0.8rem', gap: '8px' }}>
                {loadError ? <AlertTriangle size={32} style={{ opacity: 0.5 }} /> : <FileCode size={32} style={{ opacity: 0.3 }} />}
                <span>{loadError ? '素材暂未加载成功，文件没有被删除' : '本分类下暂无文件'}</span>
              </div>
            ) : (
              filteredItems.map(item => {
                const isVideo = item.metrics?.asset_role === 'video' || /\.(mp4|webm|mov)$/i.test(item.url || item.name || '');
                return (
                <div
                  key={item.id}
                  className="glass-pane glass-pane-interactive"
                  style={{
                    width: '160px',
                    height: '215px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-glass)',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    cursor: 'pointer'
                  }}
                >
                  {/* Thumb preview */}
                  <div style={{ height: '110px', background: '#eef0fc', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderBottom: '1px solid var(--border-light)' }}>
                    {item.url && !brokenAssets.has(item.id) ? isVideo ? (
                      <video
                        src={resolveAssetUrl(item.url)}
                        muted
                        preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#111' }}
                        onError={() => setBrokenAssets(prev => new Set([...prev, item.id]))}
                      />
                    ) : (
                      <img
                        src={resolveAssetUrl(item.url)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        alt=""
                        onError={() => setBrokenAssets(prev => new Set([...prev, item.id]))}
                      />
                    ) : (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        width: '100%',
                        height: '100%',
                        color: brokenAssets.has(item.id) ? '#e05555' : 'var(--text-muted)',
                        opacity: brokenAssets.has(item.id) ? 0.9 : 0.5
                      }}>
                        {brokenAssets.has(item.id) ? <AlertTriangle size={24} /> : <FileImage size={36} />}
                        {brokenAssets.has(item.id) && (
                          <span style={{ fontSize: '0.6rem', textAlign: 'center', padding: '0 4px' }}>文件已丢失</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '2px', height: '104px', justifyContent: 'flex-start' }}>
                    {editingId === item.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(item);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            border: '1px solid var(--primary)',
                            background: 'white',
                            color: 'black',
                            width: '100%',
                            outline: 'none'
                          }}
                        />
                        <button
                          onClick={() => handleSaveRename(item)}
                          style={{ border: 'none', background: 'transparent', color: 'green', cursor: 'pointer', display: 'flex', padding: '2px', fontSize: '0.8rem' }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{ border: 'none', background: 'transparent', color: 'red', cursor: 'pointer', display: 'flex', padding: '2px', fontSize: '0.8rem' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div
                          style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--on-surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
                          title={item.name}
                        >
                          {item.name}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(item.id);
                            setEditingName(item.name);
                          }}
                          style={{
                            border: '1px solid var(--outline-variant)',
                            background: 'rgba(0, 0, 0, 0.03)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '2px 5px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease',
                            marginLeft: '6px'
                          }}
                          className="rename-action-btn"
                          title="修改名称"
                        >
                          <span style={{ display: 'inline-block', transform: 'scaleX(-1)', fontSize: '0.65rem' }}>✏️</span>
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      <span>{item.size}</span>
                      <span>{item.date}</span>
                    </div>

                    {/* Send to Canvas Button */}
                    <button
                      onClick={() => isVideo
                        ? window.open(resolveAssetUrl(item.url), '_blank', 'noopener,noreferrer')
                        : onSelectAsset?.(item)}
                      className="send-to-canvas-btn"
                      title={isVideo ? '预览并下载视频' : '发送到画布'}
                      style={{
                        marginTop: '6px',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '5px 10px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        border: '1px solid var(--primary)',
                        borderRadius: '6px',
                        background: 'var(--primary)',
                        color: '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {isVideo ? <><Video size={13} /> 预览视频</> : <><ImagePlus size={13} /> 添加到画布</>}
                    </button>
                  </div>

                  {/* Hover Delete Action (allow delete for all) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(item.id); }}
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: 'rgba(255,255,255,0.8)',
                      border: 'none',
                      borderRadius: '50%',
                      padding: '4px',
                      cursor: 'pointer',
                      color: 'var(--error)',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="删除资产"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                );
              })
            )}
          </div>
        )}

      </div>
    </div>
  );
}
