import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables from .env file manually if exists
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const index = trimmed.indexOf('=');
        if (index !== -1) {
          const key = trimmed.substring(0, index).trim();
          const val = trimmed.substring(index + 1).trim();
          if (key && process.env[key] === undefined) {
            // Explicit process environment values must win over .env. This is
            // required for test isolation (PORT/NODE_ENV) and container deploys.
            process.env[key] = val.replace(/^["']|["']$/g, ''); // strip quotes
          }
        }
      }
    });
    console.log('[Backend Config] Loaded environment variables from .env successfully.');
  } catch (err) {
    console.error('[Backend Config] Error parsing .env file:', err);
  }
}

// Required environment variables check
const provider = process.env.AI_PROVIDER || 'openai';
const REQUIRED_ENV_VARS = ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'JWT_SECRET'];

if (!process.env.AI_API_KEY && !process.env.GEMINI_API_KEY) {
  REQUIRED_ENV_VARS.push('AI_API_KEY');
}

const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  if (process.env.NODE_ENV === 'production') {
    console.error('=======================================================');
    console.error('FATAL CONFIGURATION ERROR:');
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please define these variables in your .env file to run the server.');
    console.error('=======================================================');
    process.exit(1);
  } else {
    console.warn('=======================================================');
    console.warn('[DEV MODE] Missing environment variables (non-fatal):');
    console.warn(`  ${missingVars.join(', ')}`);
    console.warn('Server will start with limited functionality.');
    console.warn('=======================================================');
  }
}

// Validated configuration object
const config = {
  DATABASE_URL: process.env.DATABASE_URL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  DB_SSL: process.env.DB_SSL || 'true',
  API_PROXY_URL: process.env.API_PROXY_URL || null,
  NODE_ENV: process.env.NODE_ENV || 'development',
  EMAILJS_SERVICE_ID: process.env.EMAILJS_SERVICE_ID || null,
  EMAILJS_TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID || null,
  EMAILJS_PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY || null,
  EMAILJS_ACCESS_TOKEN: process.env.EMAILJS_ACCESS_TOKEN || null,

  // Storage configuration
  STORAGE_TYPE: process.env.STORAGE_TYPE || 'local',

  // Generic AI configurations
  AI_PROVIDER: provider,
  AI_API_KEY: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
  AI_BASE_URL: process.env.AI_BASE_URL || '',
  AI_CHAT_MODEL: process.env.AI_CHAT_MODEL || '',
  AI_IMAGE_MODEL: process.env.AI_IMAGE_MODEL || '',

  // DeepSeek & Doubao Configuration
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  DOUBAO_API_KEY: process.env.DOUBAO_API_KEY || '',
  DOUBAO_ENDPOINT_ID: process.env.DOUBAO_ENDPOINT_ID || '',
};

const PORT = parseInt(process.env.PORT, 10) || 3000;

export { config, REQUIRED_ENV_VARS, PORT, projectRoot };
export default config;
