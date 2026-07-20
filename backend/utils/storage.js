import fs from 'fs';
import path from 'path';
import { projectRoot } from '../config.js';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// ─────────────────────────────────────────────────────────────────────────────
// Abstract Storage Provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class defining the storage provider interface.
 * All concrete providers must implement these four methods.
 */
export class StorageProvider {
  /**
   * Save a buffer to storage and return the stored filename/path.
   * @param {Buffer} buffer   File content
   * @param {string} filename Desired filename
   * @returns {Promise<string>} The stored path or key
   */
  // eslint-disable-next-line no-unused-vars
  async saveFile(buffer, filename) {
    throw new Error('saveFile() must be implemented by subclass');
  }

  async saveFileFromPath(filepath, filename) {
    return this.saveFile(await fs.promises.readFile(filepath), filename);
  }

  /**
   * Delete a file from storage.
   * @param {string} filepath Path or key of the file to remove
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async deleteFile(filepath) {
    throw new Error('deleteFile() must be implemented by subclass');
  }

  /**
   * Get a publicly accessible URL for a stored file.
   * @param {string} filename Filename or key
   * @returns {Promise<string>} Public URL
   */
  // eslint-disable-next-line no-unused-vars
  async getFileUrl(filename) {
    throw new Error('getFileUrl() must be implemented by subclass');
  }

  /**
   * Read a file from storage into a Buffer.
   * @param {string} filepath Path or key
   * @returns {Promise<Buffer>}
   */
  // eslint-disable-next-line no-unused-vars
  async getFileBuffer(filepath) {
    throw new Error('getFileBuffer() must be implemented by subclass');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local Disk Storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves files to the local `public/uploads/` directory.
 */
export class LocalStorage extends StorageProvider {
  constructor() {
    super();
    this.uploadsDir = path.join(projectRoot, 'frontend', 'public', 'uploads');
    this.publicDir = path.join(projectRoot, 'frontend', 'public');
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Resolve a user-supplied path and verify it stays within publicDir.
   * Throws if the resolved path escapes the public directory.
   */
  _safePath(filepath) {
    // Strip leading slashes and URL-encoded traversal sequences
    const sanitized = filepath.replace(/^[/\\]+/, '');
    const fullPath = path.resolve(this.publicDir, sanitized);
    if (!fullPath.startsWith(this.publicDir + path.sep) && fullPath !== this.publicDir) {
      throw new Error('Path traversal detected');
    }
    return fullPath;
  }

  async saveFile(buffer, filename) {
    const physicalPath = path.join(this.uploadsDir, filename);
    await fs.promises.writeFile(physicalPath, buffer);
    return `/uploads/${filename}`;
  }

  async saveFileFromPath(filepath, filename) {
    const physicalPath = path.join(this.uploadsDir, filename);
    await fs.promises.copyFile(filepath, physicalPath);
    return `/uploads/${filename}`;
  }

  async deleteFile(filepath) {
    try {
      const fullPath = this._safePath(filepath);
      await fs.promises.access(fullPath);
      await fs.promises.unlink(fullPath);
    } catch (err) {
      // Ignore if file doesn't exist or path is invalid
    }
  }

  async getFileUrl(filename) {
    return `/uploads/${filename}`;
  }

  async getFileBuffer(filepath) {
    const fullPath = this._safePath(filepath);
    return await fs.promises.readFile(fullPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 / R2 Storage (Stub)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub implementation for AWS S3 or Cloudflare R2 object storage.
 *
 * TODO: Install `@aws-sdk/client-s3` and configure the following env vars:
 *   - S3_ENDPOINT       (for R2: https://<account-id>.r2.cloudflarestorage.com)
 *   - S3_REGION         (e.g., "auto" for R2, "us-east-1" for AWS)
 *   - S3_BUCKET         (bucket name)
 *   - S3_ACCESS_KEY_ID
 *   - S3_SECRET_ACCESS_KEY
 *   - S3_PUBLIC_URL     (optional CDN domain for public reads)
 *
 * TODO: Replace each method body with the real S3 SDK calls.
 */
export class S3Storage extends StorageProvider {
  constructor() {
    super();
    const s3Config = {
      region: process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    };
    if (process.env.S3_ENDPOINT) {
      s3Config.endpoint = process.env.S3_ENDPOINT;
      s3Config.forcePathStyle = true;
    }
    this.client = new S3Client(s3Config);
    this.bucket = process.env.S3_BUCKET || 'uploads';
    this.publicUrl = process.env.S3_PUBLIC_URL || null;
  }

  async saveFile(buffer, filename) {
    const key = filename;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: this.getContentType(filename),
    });
    await this.client.send(command);
    return this.getFileUrl(key);
  }

  async saveFileFromPath(filepath, filename) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: filename,
      Body: fs.createReadStream(filepath),
      ContentType: this.getContentType(filename),
    });
    await this.client.send(command);
    return this.getFileUrl(filename);
  }

  getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.mp4') return 'video/mp4';
    if (ext === '.webm') return 'video/webm';
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.m4a') return 'audio/mp4';
    return 'application/octet-stream';
  }

  async deleteFile(filepath) {
    const key = this.getKeyFromPath(filepath);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  getKeyFromPath(filepath) {
    if (filepath.startsWith('http://') || filepath.startsWith('https://')) {
      try {
        const url = new URL(filepath);
        // pathname is '/bucket/key' if path-styled or '/key' if virtual-hosted
        const parts = url.pathname.substring(1).split('/');
        if (process.env.S3_ENDPOINT && parts.length > 1 && parts[0] === this.bucket) {
          return decodeURIComponent(parts.slice(1).join('/'));
        }
        return decodeURIComponent(url.pathname.substring(1));
      } catch (err) {
        return filepath;
      }
    }
    return filepath;
  }

  async getFileUrl(filename) {
    if (this.publicUrl) {
      return `${this.publicUrl}/${filename}`;
    }
    const region = process.env.S3_REGION || 'auto';
    if (process.env.S3_ENDPOINT) {
      return `${process.env.S3_ENDPOINT}/${this.bucket}/${filename}`;
    }
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${filename}`;
  }

  async getFileBuffer(filepath) {
    const key = this.getKeyFromPath(filepath);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and return the appropriate storage provider based on the given type.
 *
 * @param {'local' | 's3'} type  Storage backend identifier
 * @returns {StorageProvider}
 */
export function createStorageProvider(type = 'local') {
  switch (type) {
    case 's3':
      return new S3Storage();
    case 'local':
    default:
      return new LocalStorage();
  }
}

export default createStorageProvider;
