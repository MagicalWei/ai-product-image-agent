// src/components/Sidebar.jsx
import { useState } from 'react';
import { 
  Home, Grid, Archive, Clock, Folder, 
  Pencil, MoreHorizontal, ChevronLeft, ChevronRight, HelpCircle, Video
} from 'lucide-react';

export default function Sidebar({ 
  activeView, 
  onViewChange, 
  isCollapsed, 
  onToggleCollapse, 
  hasActiveSession,
  onHelpDesign
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const mainNavItems = [
    { id: 'portal', icon: Home, label: '首页' },
    { id: 'tools', icon: Grid, label: '工具' },
    { id: 'video-workbench', icon: Video, label: '智能剪辑' },
    { id: 'folders', icon: Archive, label: '仓库' },
  ];

  const secondaryNavItems = [
    { id: 'sessions', icon: Clock, label: '最近打开' },
    { id: 'workspace', icon: Folder, label: '项目', disabled: !hasActiveSession },
    { id: 'database', icon: Archive, label: '资产库' },
    { id: 'help-design', icon: Pencil, label: '帮我设计', action: onHelpDesign },
  ];

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`} onClick={() => showMoreMenu && setShowMoreMenu(false)}>
      {/* 1. Header with Brand & Collapse trigger */}
      <div className="sidebar-header">
        {!isCollapsed ? (
          <div className="sidebar-logo-container">
            <div className="sidebar-logo-icon">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ width: '12px', height: '2px', background: 'white', borderRadius: '1px' }}></span>
                <span style={{ width: '12px', height: '2px', background: 'white', borderRadius: '1px' }}></span>
                <span style={{ width: '8px', height: '2px', background: 'white', borderRadius: '1px' }}></span>
              </div>
            </div>
            <span className="brand-text">AI Studio</span>
          </div>
        ) : (
          <div className="sidebar-logo-icon" style={{ margin: '0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ width: '12px', height: '2px', background: 'white', borderRadius: '1px' }}></span>
              <span style={{ width: '12px', height: '2px', background: 'white', borderRadius: '1px' }}></span>
              <span style={{ width: '8px', height: '2px', background: 'white', borderRadius: '1px' }}></span>
            </div>
          </div>
        )}
        
        <button 
          className="sidebar-collapse-btn" 
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          title={isCollapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* 2. Primary Navigation Group */}
      <div className="sidebar-nav-group">
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              className={`sidebar-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onViewChange(item.id)}
              title={item.label}
            >
              <Icon size={16} />
              {!isCollapsed && <span className="sidebar-item-label">{item.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="sidebar-divider" />

      {/* 3. Secondary Navigation Group */}
      <div className="sidebar-nav-group">
        {secondaryNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const isDisabled = item.disabled;

          return (
            <button
              key={item.id}
              className={`sidebar-item-btn ${isActive ? 'active' : ''}`}
              disabled={isDisabled}
              onClick={() => {
                if (item.action) {
                  item.action();
                } else {
                  onViewChange(item.id);
                }
              }}
              title={isDisabled ? '暂无活跃设计项目，请点击「帮我设计」开始' : item.label}
              style={{ opacity: isDisabled ? 0.4 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
            >
              <Icon size={16} />
              {!isCollapsed && <span className="sidebar-item-label">{item.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="sidebar-divider" />

      {/* 4. Footer Group (More button with dropdown menu) */}
      <div className="sidebar-footer" style={{ position: 'relative' }}>
        <button 
          className="sidebar-item-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowMoreMenu(!showMoreMenu);
          }}
          title="更多选项"
        >
          <MoreHorizontal size={16} />
          {!isCollapsed && <span className="sidebar-item-label">更多</span>}
        </button>

        {showMoreMenu && (
          <div className="sidebar-more-dropdown glass-pane animate-fade-in" onClick={(e) => e.stopPropagation()}>

            <button 
              className="more-dropdown-item"
              onClick={() => {
                window.open('https://github.com', '_blank');
                setShowMoreMenu(false);
              }}
            >
              <HelpCircle size={14} />
              <span>帮助文档</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
