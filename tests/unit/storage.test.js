/**
 * Unit tests for storage abstraction layer.
 * Tests cover: LocalStorage, StorageProvider interface, factory function.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_ROOT = '/tmp/ai-product-image-test-storage';

// Ensure test directory exists before mock is evaluated
fs.mkdirSync(path.join(TEST_ROOT, 'frontend', 'public', 'uploads'), { recursive: true });

// ─── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../backend/config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret',
    DATABASE_URL: 'postgresql://mock',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    GEMINI_API_KEY: 'mock-key',
    STORAGE_TYPE: 'local',
  },
  PORT: 3000,
  projectRoot: '/tmp/ai-product-image-test-storage',
}));

import {
  StorageProvider,
  LocalStorage,
  S3Storage,
  createStorageProvider,
} from '../../backend/utils/storage.js';

// ═══════════════════════════════════════════════════════════════════════════
// StorageProvider (Abstract Base Class)
// ═══════════════════════════════════════════════════════════════════════════

describe('StorageProvider (abstract)', () => {
  it('should throw when async methods are called directly on the base class', async () => {
    const provider = new StorageProvider();

    await expect(provider.saveFile(Buffer.from('test'), 'test.txt')).rejects.toThrow(
      'saveFile() must be implemented by subclass'
    );
    await expect(provider.deleteFile('test.txt')).rejects.toThrow(
      'deleteFile() must be implemented by subclass'
    );
    await expect(provider.getFileUrl('test.txt')).rejects.toThrow(
      'getFileUrl() must be implemented by subclass'
    );
    await expect(provider.getFileBuffer('test.txt')).rejects.toThrow(
      'getFileBuffer() must be implemented by subclass'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LocalStorage
// ═══════════════════════════════════════════════════════════════════════════

describe('LocalStorage', () => {
  let storage;
  let uploadsDir;

  beforeEach(() => {
    storage = new LocalStorage();
    uploadsDir = path.join(TEST_ROOT, 'frontend', 'public', 'uploads');
  });

  afterEach(() => {
    // Clean up test files in uploads dir
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const f of files) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }
  });

  it('should save a file to the uploads directory', async () => {
    const buffer = Buffer.from('Hello, World!', 'utf8');
    const filename = 'test-file.txt';

    const result = await storage.saveFile(buffer, filename);

    const savedPath = path.join(uploadsDir, filename);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath, 'utf8')).toBe('Hello, World!');
    expect(result).toBe(`uploads/${filename}`);
  });

  it('should return a relative URL path for saved files', async () => {
    const buffer = Buffer.from('test data');
    const filename = 'image.png';

    const url = await storage.saveFile(buffer, filename);

    expect(typeof url).toBe('string');
    expect(url).toBe('uploads/image.png');
  });

  it('should delete a file from disk', async () => {
    const filename = 'to-delete.txt';
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, 'delete me');

    expect(fs.existsSync(filePath)).toBe(true);

    await storage.deleteFile(`uploads/${filename}`);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('should not throw when deleting a non-existent file', async () => {
    await expect(storage.deleteFile('uploads/non-existent.txt')).resolves.toBeUndefined();
  });

  it('should return a relative file URL', async () => {
    const url = await storage.getFileUrl('test.png');
    expect(typeof url).toBe('string');
    expect(url).toBe('uploads/test.png');
  });

  it('should read a file buffer from the uploads directory', async () => {
    const filename = 'read-test.txt';
    const content = 'read me back';
    fs.writeFileSync(path.join(uploadsDir, filename), content);

    const buffer = await storage.getFileBuffer(`uploads/${filename}`);
    expect(buffer.toString('utf8')).toBe(content);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S3Storage (Stub)
// ═══════════════════════════════════════════════════════════════════════════

describe('S3Storage', () => {
  it('should instantiate without errors', () => {
    const s3 = new S3Storage();
    expect(s3).toBeDefined();
    expect(s3).toBeInstanceOf(StorageProvider);
  });

  it('should call S3Client.send for saveFile', async () => {
    const s3 = new S3Storage();
    const mockSend = vi.spyOn(s3.client, 'send').mockResolvedValue({});
    const url = await s3.saveFile(Buffer.from('hello'), 'test.txt');
    expect(mockSend).toHaveBeenCalled();
    expect(url).toContain('test.txt');
  });

  it('should call S3Client.send for deleteFile', async () => {
    const s3 = new S3Storage();
    const mockSend = vi.spyOn(s3.client, 'send').mockResolvedValue({});
    await s3.deleteFile('test.txt');
    expect(mockSend).toHaveBeenCalled();
  });

  it('should call S3Client.send for getFileBuffer', async () => {
    const s3 = new S3Storage();
    const mockSend = vi.spyOn(s3.client, 'send').mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array([104, 101, 108, 108, 111])
      }
    });
    const buffer = await s3.getFileBuffer('test.txt');
    expect(mockSend).toHaveBeenCalled();
    expect(buffer.toString('utf8')).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════

describe('createStorageProvider', () => {
  it('should return a LocalStorage instance for "local"', () => {
    const provider = createStorageProvider('local');
    expect(provider).toBeInstanceOf(LocalStorage);
  });

  it('should return an S3Storage instance for "s3"', () => {
    const provider = createStorageProvider('s3');
    expect(provider).toBeInstanceOf(S3Storage);
  });

  it('should default to LocalStorage for unknown types', () => {
    const provider = createStorageProvider('unknown');
    expect(provider).toBeInstanceOf(LocalStorage);
  });

  it('should default to LocalStorage when no type is given', () => {
    const provider = createStorageProvider();
    expect(provider).toBeInstanceOf(LocalStorage);
  });
});
