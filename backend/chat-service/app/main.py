from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from app.routes import chat
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="VendorIQ Chat Service",
    description=(
        "### Overview\n"
        "Chat service with RAG-based Q&A, document syncing, and analytics.\n\n"
        "**Core Endpoints:**\n"
        "- POST /api/v1/sync - Index OCR-processed documents\n"
        "- POST /api/v1/query - Ask questions with RAG\n"
        "- GET /api/v1/analytics - Get spend analytics\n"
        "- DELETE /api/v1/user/{user_id}/data - Delete user's data\n"
        "- GET /api/v1/stats - Get indexing stats\n"
        "- GET /api/v1/health - Health check\n"
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST router
app.include_router(chat.router, prefix="/api/v1")

logger.info("Chat service initialized!")

@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "Welcome to VendorIQ Chat Service",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/api/v1/health"
    }

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=4005, reload=True)