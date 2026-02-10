const path = require('path');

function loadGlobalEnv(dotenv) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // In production (Docker), env variables are injected by docker-compose env_file
  if (nodeEnv === 'production') {
    console.log(`Running in production mode - using environment variables from Docker`);
    return { parsed: process.env };
  }

  // For local development, load from .env.local file
  const envFile = '.env.local';
  const envPath = path.resolve(__dirname, '..', envFile);

  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.warn(`⚠️  Warning: Could not load ${envFile} from ${envPath}`);
  } else {
    console.log(`Loaded environment from: ${envFile} (NODE_ENV: ${nodeEnv})`);
  }
  return result;
}

module.exports = { loadGlobalEnv };

