// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from '../../frontend/src/components/Sidebar';
import LayersOutlinePanel from '../../frontend/src/components/LayersOutlinePanel';

describe('Sidebar Component', () => {
  const defaultProps = {
    activeView: 'portal',
    onViewChange: vi.fn(),
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
    hasActiveSession: true,
    onHelpDesign: vi.fn()
  };

  it('renders Sidebar menu items correctly when expanded', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('AI Studio')).toBeDefined();
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('工具')).toBeDefined();
    expect(screen.getByText('仓库')).toBeDefined();
    expect(screen.getByText('资产库')).toBeDefined();
  });

  it('triggers onViewChange callback when clicking nav items', () => {
    render(<Sidebar {...defaultProps} />);
    const toolsBtn = screen.getByText('工具').closest('button');
    fireEvent.click(toolsBtn);
    expect(defaultProps.onViewChange).toHaveBeenCalledWith('tools');
  });

  it('triggers onToggleCollapse when collapse button clicked', () => {
    render(<Sidebar {...defaultProps} />);
    const collapseBtn = screen.getByTitle('折叠侧边栏');
    fireEvent.click(collapseBtn);
    expect(defaultProps.onToggleCollapse).toHaveBeenCalled();
  });
});

describe('LayersOutlinePanel Component', () => {
  const mockVersion = {
    image: 'bg_sunset.png',
    productCutout: 'cutout.png',
    adText: {
      title: '主图标题文本',
      desc: '副标题文本',
      tag: '促销爆款'
    }
  };

  const defaultProps = {
    currentVersion: mockVersion,
    onInsertRef: vi.fn(),
    onClose: vi.fn()
  };

  it('does not render when currentVersion is null', () => {
    const { container } = render(<LayersOutlinePanel {...defaultProps} currentVersion={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all layer types based on current version data', () => {
    render(<LayersOutlinePanel {...defaultProps} />);
    expect(screen.getByText('背景图层')).toBeDefined();
    expect(screen.getByText('商品主体图层')).toBeDefined();
    expect(screen.getByText('主标题文本图层')).toBeDefined();
    expect(screen.getByText('副标题文本图层')).toBeDefined();
    expect(screen.getByText('促销标签图层')).toBeDefined();
  });

  it('triggers onInsertRef when quoting a layer', () => {
    render(<LayersOutlinePanel {...defaultProps} />);
    const quoteButtons = screen.getAllByTitle(/引用此图层/);
    expect(quoteButtons.length).toBeGreaterThan(0);
    fireEvent.click(quoteButtons[0]);
    expect(defaultProps.onInsertRef).toHaveBeenCalled();
  });

  it('collapses body when header is clicked', () => {
    render(<LayersOutlinePanel {...defaultProps} />);
    const header = screen.getByText('图层大纲').closest('.layers-panel-header');
    fireEvent.click(header);
    
    expect(screen.queryByText('背景图层')).toBeNull();
  });
});
