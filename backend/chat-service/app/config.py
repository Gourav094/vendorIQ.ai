import sys
from pathlib import Path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(backend_dir))
from config.load_env import *
from dotenv import load_dotenv
import os

load_dotenv()

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-mpnet-base-v2")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash")
VECTORDB_PERSIST_DIRECTORY = os.getenv("VECTORDB_PERSIST_DIRECTORY", "data/vectordb")
VENDOR_DATA_DIRECTORY = os.getenv("VENDOR_DATA_DIRECTORY", "sample-data")

# Email Storage Service URL (to fetch master.json)
EMAIL_STORAGE_SERVICE_URL = os.getenv("EMAIL_STORAGE_SERVICE_URL", "http://localhost:4002/api/v1")

# Local LLM Configuration (Ollama)
USE_LOCAL_LLM = os.getenv("USE_LOCAL_LLM", "false").lower() in ("true", "1", "yes")
LOCAL_LLM_BASE_URL = os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434")
LOCAL_LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "phi3:mini")
LOCAL_LLM_TEMPERATURE = float(os.getenv("LOCAL_LLM_TEMPERATURE", "0.7"))
LOCAL_LLM_MAX_TOKENS = int(os.getenv("LOCAL_LLM_MAX_TOKENS", "512"))