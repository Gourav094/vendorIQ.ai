from typing import List, Optional
import os
import logging
import google.generativeai as genai
import httpx
import json

logger = logging.getLogger(__name__)

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash")

class GeminiLLM:
    def __init__(self, model_name: str = GEMINI_MODEL_NAME, temperature: float = 0.7, max_tokens: int = 256):
        self.model_name = model_name
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.api_key: Optional[str] = None
        self._configure()
        self._load_model()

    def _configure(self):
        # Resolve API key at runtime
        self.api_key = (os.getenv("GEMINI_API_KEY"))
        if not self.api_key:
            available = {k: ("SET" if os.getenv(k) else "NOT SET") for k in ["GOOGLE_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]}
            raise EnvironmentError(f"Missing Gemini API key. Expected one of GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY / GOOGLE_API_KEY. Status: {available}")
        genai.configure(api_key=self.api_key)

    def _load_model(self):
        logger.info(f"Loading Gemini model: {self.model_name} (temp={self.temperature}, max_tokens={self.max_tokens})")
        self.generation_config = {
            "temperature": self.temperature,
            "max_output_tokens": self.max_tokens,
        }
        self.model = genai.GenerativeModel(self.model_name, generation_config=self.generation_config)

    def generate(self, prompt: str, system: Optional[str] = None) -> str:
        # Combine system + user prompt into a single instruction block; Gemini supports system instruction via model.start_chat but here we inline.
        full_prompt = f"System: {system}\nUser: {prompt}" if system else prompt
        try:
            response = self.model.generate_content(full_prompt)
            # Handle safety or empty parts gracefully before accessing response.text
            if hasattr(response, "candidates") and response.candidates:
                for c in response.candidates:
                    # Gemini SDK uses finish_reason (enum) - map known numeric codes
                    fr = getattr(c, "finish_reason", None) or getattr(c, "finishReason", None)
                    # Common finish reasons (approx): 0=STOP,1=MAX_TOKENS,2=SAFETY,3=RECITATION,4=OTHER
                    if fr in (2, "SAFETY") and (not c.content or not getattr(c.content, "parts", [])):
                        return ("Response blocked by safety filters. Please rephrase the question to be strictly factual about vendor invoices/invoice data without requesting disallowed content.")
            if hasattr(response, "text") and response.text:
                return response.text.strip()
            # Fallback: concatenate parts
            if hasattr(response, "candidates"):
                for c in response.candidates:
                    if c.content and c.content.parts:
                        texts = []
                        for p in c.content.parts:
                            if hasattr(p, "text") and p.text:
                                texts.append(p.text)
                        if texts:
                            return "\n".join(t.strip() for t in texts if t).strip()
            return str(response)
        except Exception as e:
            logger.error(f"Gemini generation error: {e}")
            return f"Error generating content: {e}".strip()

    def chat(self, messages: List[dict]) -> str:
        # Build history for Gemini chat if needed; last user message used for response
        system_prompt = next((m["content"] for m in messages if m.get("role") == "system"), "")
        user_messages = [m["content"] for m in messages if m.get("role") == "user"]
        if not user_messages:
            return "No user message provided."
        # For simplicity, merge user messages; could map to chat history parts for richer context.
        user_prompt = "\n".join(user_messages)
        return self.generate(user_prompt, system_prompt)


class OllamaLLM:
    """Local LLM implementation using Ollama API"""
    
    def __init__(self, base_url: str, model: str, temperature: float = 0.7, max_tokens: int = 512):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self._verify_connection()
    
    def _verify_connection(self):
        """Verify Ollama is running and model is available"""
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(f"{self.base_url}/api/tags")
                if response.status_code == 200:
                    models = response.json().get("models", [])
                    model_names = [m.get("name") for m in models]
                    if self.model not in model_names:
                        logger.warning(f"Model '{self.model}' not found in Ollama. Available: {model_names}")
                        logger.warning(f"Run: ollama pull {self.model}")
                    else:
                        logger.info(f"Ollama connected: {self.base_url} | Model: {self.model}")
                else:
                    logger.warning(f"Ollama API returned status {response.status_code}")
        except Exception as e:
            logger.warning(f"Could not connect to Ollama at {self.base_url}")
            logger.warning(f"Error: {e}")
    
    def generate(self, prompt: str, system: Optional[str] = None) -> str:
        """Generate text using Ollama API"""
        try:
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": self.temperature,
                    "num_predict": self.max_tokens,
                }
            }
            
            if system:
                payload["system"] = system
            
            with httpx.Client(timeout=60.0) as client:
                response = client.post(
                    f"{self.base_url}/api/generate",
                    json=payload
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result.get("response", "").strip()
                else:
                    return f"Error: Ollama API returned status {response.status_code}"
                    
        except httpx.TimeoutException:
            return "Error: Request to Ollama timed out. The model may be too slow or overloaded."
        except Exception as e:
            logger.error(f"Ollama generation error: {e}")
            return f"Error generating content with Ollama: {str(e)}"
    
    def chat(self, messages: List[dict]) -> str:
        """Chat interface for Ollama"""
        system_prompt = next((m["content"] for m in messages if m.get("role") == "system"), "")
        user_messages = [m["content"] for m in messages if m.get("role") == "user"]
        
        if not user_messages:
            return "No user message provided."
        
        user_prompt = "\n".join(user_messages)
        return self.generate(user_prompt, system_prompt)


def get_llm_instance():
    """Factory function to get the appropriate LLM instance based on configuration"""
    from app.config import (
        LLM_PROVIDER, 
        LOCAL_LLM_BASE_URL, 
        LOCAL_LLM_MODEL,
        LOCAL_LLM_TEMPERATURE,
        LOCAL_LLM_MAX_TOKENS,
        GEMINI_MODEL_NAME
    )
    
    if LLM_PROVIDER == "ollama":
        logger.info(f"Using LOCAL LLM (Ollama): {LOCAL_LLM_MODEL}")
        return OllamaLLM(
            base_url=LOCAL_LLM_BASE_URL,
            model=LOCAL_LLM_MODEL,
            temperature=LOCAL_LLM_TEMPERATURE,
            max_tokens=LOCAL_LLM_MAX_TOKENS
        )
    else:
        logger.info(f"Using CLOUD LLM (Gemini): {GEMINI_MODEL_NAME}")
        return GeminiLLM()
