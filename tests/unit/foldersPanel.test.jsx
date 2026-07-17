// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: null,
    isAuthenticated: false,
    isAuthLoading: true,
  },
  fetchAssets: vi.fn(),
}));

vi.mock('../../frontend/src/context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../frontend/src/lib/reliableFetch', () => ({
  fetchJsonWithRetry: (...args) => mocks.fetchAssets(...args),
}));

import FoldersPanel from '../../frontend/src/components/FoldersPanel';

describe('FoldersPanel asset loading', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.fetchAssets.mockReset();
    mocks.auth = {
      currentUser: null,
      isAuthenticated: false,
      isAuthLoading: true,
    };
  });

  it('waits for authentication and then loads the user assets', async () => {
    mocks.fetchAssets.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        assets: [{ id: 'asset-1', name: '商品主图.png', url: '/uploads/product.png', source: 'user_uploaded' }],
      },
    });

    const { rerender } = render(<FoldersPanel onSelectAsset={vi.fn()} />);
    expect(mocks.fetchAssets).not.toHaveBeenCalled();

    mocks.auth = {
      currentUser: { uid: 'user-1' },
      isAuthenticated: true,
      isAuthLoading: false,
    };
    rerender(<FoldersPanel onSelectAsset={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('商品主图.png')).toBeDefined());
    expect(mocks.fetchAssets).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('本分类下暂无文件')).toBeNull();
  });

  it('shows a retryable error instead of claiming the warehouse is empty', async () => {
    mocks.auth = {
      currentUser: { uid: 'user-1' },
      isAuthenticated: true,
      isAuthLoading: false,
    };
    mocks.fetchAssets.mockRejectedValue(new Error('network error'));

    render(<FoldersPanel onSelectAsset={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/素材数据仍然保留/)).toBeDefined());
    expect(screen.getByText('素材暂未加载成功，文件没有被删除')).toBeDefined();
    expect(screen.queryByText('本分类下暂无文件')).toBeNull();
  });
});
