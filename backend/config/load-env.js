const path = require('path');

function loadGlobalEnv(dotenv) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envFile = nodeEnv === 'production' ? '.env.production' : '.env.local';
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

