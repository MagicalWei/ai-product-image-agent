// src/components/DatabaseView.jsx
import { useState, useEffect } from 'react';
import { Cpu, Folder, Image, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function DatabaseView() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  let token = null;
  try {
    const auth = useAuth();
    token = auth.token;
  } catch {
    // Context might be missing
  }

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/assets/stats', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setStats(data);
          } else {
            setError(data.message || '获取数据失败');
          }
        } else {
          setError(`请求失败: ${response.status}`);
        }
      } catch (err) {
        setError(`无法连接到服务器: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [token]);

  if (loading) {
    return (
      <div className="database-view-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 110px)', color: 'var(--text-secondary)' }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="database-view-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 110px)', gap: '12px', padding: '20px' }}>
        <Cpu size={32} style={{ opacity: 0.3 }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{error}</span>
      </div>
    );
  }

  return (
    <div className="database-view-container animate-fade-scale" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100vh - 110px)', padding: '10px 0', overflowY: 'auto' }}>

      <div className="glass-panel" style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Image size={14} />
            资产总数
          </span>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary)', fontFamily: 'monospace' }}>
            {stats?.totalAssets ?? 0}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Folder size={14} />
            本月新增
          </span>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--secondary)', fontFamily: 'monospace' }}>
            {stats?.monthlyNew ?? 0}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            AI 生成
          </span>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#8b5cf6', fontFamily: 'monospace' }}>
            {stats?.aiGenerated ?? 0}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={14} />
            用户上传
          </span>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', fontFamily: 'monospace' }}>
            {stats?.userUploaded ?? 0}
          </span>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Folder size={14} />
          资产库说明
        </h3>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          <p>资产库保存您上传的商品实拍图与 AI 生成的创意设计图。所有文件通过安全的云存储进行管理。</p>
          <p style={{ marginTop: '8px' }}>资产数据通过后端 API 从数据库中实时获取，展示您的个人或团队的实际使用情况。</p>
        </div>
      </div>
    </div>
  );
}
