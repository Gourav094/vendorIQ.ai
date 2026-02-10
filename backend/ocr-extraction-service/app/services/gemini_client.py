import os
import json
import logging
import time
import sys
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(backend_dir))

# Load global environment variables
from config.load_env import *

# Configure logging
logging.basicConfig(level=logging.ERROR, format="%(asctime)s - %(levelname)s - %(message)s")

# LLM Provider configuration
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")

# Gemini configuration (production)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# Local LLM configuration (Ollama)
LOCAL_LLM_BASE_URL = os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434")
LOCAL_LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "mistral:latest")


def get_llm_client():
    """
    Returns the appropriate LLM client based on LLM_PROVIDER environment variable.
    
    - LLM_PROVIDER=ollama: Uses Ollama (mistral:latest) for local development
    - LLM_PROVIDER=gemini: Uses Google Gemini API
    
    Returns:
        dict: Configuration for the LLM client
    """
    if LLM_PROVIDER == "ollama":
        logging.info(f"Using local LLM: {LOCAL_LLM_MODEL} at {LOCAL_LLM_BASE_URL}")
        return {
            "type": "ollama",
            "base_url": LOCAL_LLM_BASE_URL,
            "model": LOCAL_LLM_MODEL
        }
    else:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not found for gemini provider")
        logging.info(f"Using Gemini API: {GEMINI_MODEL}")
        return {
            "type": "gemini",
            "api_key": GEMINI_API_KEY,
            "model": GEMINI_MODEL,
            "url": f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
        }


def call_ollama(prompt: str, config: dict, max_retries: int = 2) -> dict:
    """Call Ollama API for local LLM inference."""
    import requests
    
    url = f"{config['base_url']}/api/generate"
    payload = {
        "model": config["model"],
        "prompt": prompt,
        "stream": False,
        "format": "json"  # Request JSON output
    }
    
    retry_count = 0
    base_delay = 2
    
    while retry_count <= max_retries:
        try:
            response = requests.post(url, json=payload, timeout=60)
            response.raise_for_status()
            
            data = response.json()
            response_text = data.get("response", "")
            
            # Try parsing as JSON
            try:
                return json.loads(response_text)
            except json.JSONDecodeError:
                # Extract JSON if wrapped in text
                start = response_text.find("{")
                end = response_text.rfind("}")
                if start != -1 and end != -1:
                    return json.loads(response_text[start:end + 1])
                return {"error": "Invalid JSON returned by Ollama", "retryable": False}
                
        except requests.exceptions.Timeout:
            if retry_count < max_retries:
                delay = base_delay * (2 ** retry_count)
                logging.warning(f"Ollama timeout. Retrying in {delay}s...")
                time.sleep(delay)
                retry_count += 1
                continue
            return {"error": "Ollama timeout", "retryable": True}
        except Exception as e:
            logging.error(f"Ollama API error: {e}")
            return {"error": str(e), "retryable": True}
    
    return {"error": "Max retries exceeded", "retryable": True}


def call_gemini(prompt: str, config: dict, max_retries: int = 3) -> dict:
    """Call Google Gemini API for production inference."""
    import requests
    
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": config["api_key"]
    }
    
    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    
    retry_count = 0
    base_delay = 2
    
    while retry_count <= max_retries:
        try:
            response = requests.post(config["url"], headers=headers, json=payload, timeout=45)
            
            # Handle rate limiting
            if response.status_code == 429:
                if retry_count < max_retries:
                    delay = base_delay * (2 ** retry_count)
                    logging.warning(f"Rate limit hit (429). Retrying in {delay}s...")
                    time.sleep(delay)
                    retry_count += 1
                    continue
                return {"error": "Rate limit exceeded", "retryable": True}
            
            # Handle server errors
            if response.status_code >= 500:
                if retry_count < max_retries:
                    delay = base_delay * (2 ** retry_count)
                    logging.warning(f"Server error ({response.status_code}). Retrying in {delay}s...")
                    time.sleep(delay)
                    retry_count += 1
                    continue
                return {"error": f"Server error: {response.status_code}", "retryable": True}
            
            response.raise_for_status()
            data = response.json()
            
            # Extract model output
            model_output = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            if not model_output:
                return {"error": "Empty response from Gemini", "retryable": False}
            
            # Parse JSON
            try:
                return json.loads(model_output)
            except json.JSONDecodeError:
                start = model_output.find("{")
                end = model_output.rfind("}")
                if start != -1 and end != -1:
                    return json.loads(model_output[start:end + 1])
                return {"error": "Invalid JSON from Gemini", "retryable": False}
                
        except requests.exceptions.Timeout:
            if retry_count < max_retries:
                delay = base_delay * (2 ** retry_count)
                logging.warning(f"Gemini timeout. Retrying in {delay}s...")
                time.sleep(delay)
                retry_count += 1
                continue
            return {"error": "Request timeout", "retryable": True}
        except Exception as e:
            logging.error(f"Gemini API error: {e}")
            return {"error": str(e), "retryable": True}
    
    return {"error": "Max retries exceeded", "retryable": True}


def extract_invoice_json_from_text(extracted_text: str, max_retries: int = 3):
    """
    Send extracted PDF text to LLM and receive structured invoice JSON.
    Uses Ollama or Gemini based on LLM_PROVIDER env variable.
    
    Args:
        extracted_text: The text extracted from the invoice PDF
        max_retries: Maximum number of retry attempts
    
    Returns:
        dict: Parsed invoice JSON or error dict with 'retryable' flag
    """
    
    prompt = f"""Extract structured invoice information from the following text. 
Return output ONLY in JSON format with these fields (no extra explanations):
{{
    "vendor_name": "",
    "invoice_number": "",
    "invoice_date": "",
    "total_amount": "",
    "line_items": [
        {{
            "item_description": "",
            "quantity": "",
            "unit_price": "",
            "amount": ""
        }}
    ]
}}

Text:
{extracted_text}
"""
    
    try:
        llm_config = get_llm_client()
        
        if llm_config["type"] == "ollama":
            return call_ollama(prompt, llm_config, max_retries)
        else:
            return call_gemini(prompt, llm_config, max_retries)
            
    except Exception as e:
        logging.error(f"LLM configuration error: {e}")
        return {"error": str(e), "retryable": False}