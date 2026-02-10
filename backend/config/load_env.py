import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

node_env = os.getenv("NODE_ENV", "development")

# In production (Docker), env variables are injected by docker-compose env_file
if node_env == "production":
    print(f"Running in production mode - using environment variables from Docker")
else:
    # For local development, load from .env.local file
    env_file = BASE_DIR / ".env.local"
    
    if env_file.exists():
        load_dotenv(env_file)
        print(f"Loaded environment from: {env_file.name} (NODE_ENV: {node_env})")
    else:
        print(f"⚠️  Warning: Could not load {env_file.name} from {env_file}")