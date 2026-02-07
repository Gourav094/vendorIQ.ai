# Chat Service - Simplified v2.0

**RAG-based Q&A service with user isolation and document syncing.**

## 🎯 Overview

Simplified chat service that provides:
- **Document Syncing** - Index OCR-processed invoices from MongoDB/Drive
- **RAG Query** - Ask questions about invoices with user isolation
- **Analytics** - Get spend insights per user
- **User Isolation** - Complete data separation between users

## 🚀 Key Changes from v1.0

### ✅ Added
- **User Isolation** - All data includes `user_id` for complete separation
- **Per-user Delete** - Users can delete only their data
- **Simplified API** - 6 clear endpoints (was 8+ with GraphQL)
- **POST /query** - Changed from GET for better request handling

### ❌ Removed
- GraphQL API (not used by frontend)
- Complex vendor detection logic
- Multi-vendor aggregation fallbacks
- Global reset endpoint (dangerous)
- Local file loading (not needed)
- Safety filter workarounds

### 📊 Results
- **Lines of Code**: 1200 → 500 (~60% reduction)
- **Endpoints**: 8 REST + GraphQL → 6 REST only
- **Complexity**: High → Low
- **User Isolation**: ❌ None → ✅ Full

---

## 📡 API Endpoints

### 1. **POST /api/v1/sync** - Index Documents

Index OCR-processed documents for a user.

**Request:**
```json
{
  "userId": "user123",
  "refreshToken": "optional_token"
}
```

**Response:**
```json
{
  "success": true,
  "documentsIndexed": 15,
  "message": "Indexed 15 documents from 3 vendors"
}
```

**Flow:**
1. Query MongoDB for unindexed documents (`ocrStatus=COMPLETED`, `indexed=false`)
2. Fetch `master.json` per vendor from email-storage-service
3. Generate embeddings with `user_id` in metadata
4. Store in vector DB (user isolated)
5. Mark documents as indexed in MongoDB

---

### 2. **POST /api/v1/query** - Ask Questions

Ask questions using RAG with optional vendor filter.

**Request:**
```json
{
  "userId": "user123",
  "question": "What is my total spend with Acme Corp?",
  "vendorName": "Acme Corp"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "answer": "Your total spend with Acme Corp is ₹45,230.00 across 8 invoices.",
  "sources": [
    {
      "rank": 1,
      "vendor_name": "Acme Corp",
      "invoice_number": "INV-001",
      "invoice_date": "2024-01-15",
      "total_amount": 5000.0,
      "similarity": 0.92,
      "web_view_link": "https://drive.google.com/...",
      "content_excerpt": "Invoice from Acme Corp..."
    }
  ],
  "vendorName": "Acme Corp",
  "message": "ok"
}
```

**Features:**
- ✅ User isolated (only searches user's data)
- ✅ Optional vendor filter
- ✅ Returns top 5 relevant chunks
- ✅ Includes Drive links in sources

---

### 3. **GET /api/v1/analytics** - Get Analytics

Get spend analytics and trends for a user.

**Request:**
```
GET /api/v1/analytics?userId=user123&period=year
```

**Query Params:**
- `userId` (required) - User ID
- `period` (optional) - `month`, `quarter`, `year`, `all` (default: `year`)

**Response:**
```json
{
  "success": true,
  "insights": {
    "highestSpend": {
      "vendor": "Acme Corp",
      "amount": 45230.50
    },
    "averageInvoice": 2850.75,
    "totalSpend": 125000.00,
    "totalInvoices": 44,
    "vendorCount": 8
  },
  "monthlyTrend": [
    {"name": "2024-01", "value": 12500.00},
    {"name": "2024-02", "value": 15000.00}
  ],
  "topVendors": [
    {"name": "Acme Corp", "value": 45230.50},
    {"name": "Tech Inc", "value": 32100.00}
  ],
  "spendByCategory": [...],
  "quarterlyTrend": [...],
  "llmSummary": "Your total spend is ₹125,000 across 44 invoices from 8 vendors. Highest spend is with Acme Corp (₹45,230). Monthly spending shows an increasing trend.",
  "period": "year"
}
```

---

### 4. **DELETE /api/v1/user/{user_id}/data** - Delete User Data

Delete all indexed data for a user from vector DB.

**Request:**
```
DELETE /api/v1/user/user123/data
```

**Response:**
```json
{
  "success": true,
  "message": "User data deleted successfully",
  "mongodbDocsReset": 25
}
```

**Note:** This only affects the vector DB and MongoDB indexed flags. Google Drive files are NOT deleted.

---

### 5. **GET /api/v1/stats** - Get Indexing Stats

Get document statistics for a user.

**Request:**
```
GET /api/v1/stats?userId=user123
```

**Response:**
```json
{
  "total": 50,
  "ocr_completed": 45,
  "indexed": 40,
  "pending_index": 5
}
```

---

### 6. **GET /api/v1/health** - Health Check

Check service and vector DB health.

**Response:**
```json
{
  "status": "ok",
  "service": "chat-service",
  "version": "2.0.0",
  "vectorDb": {
    "total_chunks": 234,
    "collection_name": "vendor_invoices"
  }
}
```

---

## 🔒 User Isolation

### Storage
All chunks stored with `user_id` in metadata:
```python
metadata = {
  "user_id": "user123",  # ← KEY
  "vendor_name": "Acme Corp",
  "invoice_number": "INV-001",
  ...
}
```

### Retrieval
All searches filter by `user_id`:
```python
results = vector_db.query(
  query_embeddings=[embedding],
  where={"user_id": user_id}  # ← MANDATORY
)
```

### Benefits
- ✅ Complete data isolation between users
- ✅ No cross-user data leaks
- ✅ Per-user analytics
- ✅ Per-user deletion

---

## 🏗️ Architecture

```
┌─────────────┐
│  Frontend   │
└──────┬──────┘
       │
       v
┌─────────────────────────────────────┐
│         API Gateway (4000)          │
└──────────────┬──────────────────────┘
               │
               v
┌──────────────────────────────────────┐
│      Chat Service (4005)             │
│  ┌────────────────────────────────┐  │
│  │  POST /sync                    │  │
│  │  POST /query                   │  │
│  │  GET  /analytics               │  │
│  │  DELETE /user/:id/data         │  │
│  └────────────────────────────────┘  │
│                                       │
│  ┌────────────────────────────────┐  │
│  │   VendorKnowledgeOrchestrator  │  │
│  │   - process_direct_dataset     │  │
│  │   - answer_query               │  │
│  │   - get_analytics              │  │
│  │   - delete_user_data           │  │
│  └────────────────────────────────┘  │
└───────┬───────────────────┬──────────┘
        │                   │
        v                   v
┌──────────────┐    ┌──────────────┐
│   MongoDB    │    │   ChromaDB   │
│  (metadata)  │    │  (vectors)   │
└──────────────┘    └──────────────┘
        ^                   ^
        │                   │
        └───────────────────┘
           user_id filter
```

---

## 🛠️ Setup & Run

### 1. Install Dependencies
```bash
cd backend/chat-service
pip install -r requirements.txt
```

### 2. Set Environment Variables
```bash
# .env file
MONGO_URI=mongodb+srv://...
GEMINI_API_KEY=your_key
EMAIL_STORAGE_SERVICE_URL=http://localhost:4002/api/v1
EMBEDDING_MODEL=sentence-transformers/all-mpnet-base-v2
VECTORDB_PERSIST_DIRECTORY=data/vectordb
```

### 3. Run Service
```bash
python -m app.main
# Service runs on http://localhost:4005
```

### 4. API Docs
Visit: http://localhost:4005/docs

---

## 🧪 Testing

### Test Sync
```bash
curl -X POST http://localhost:4005/api/v1/sync \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "refreshToken": "optional"
  }'
```

### Test Query
```bash
curl -X POST http://localhost:4005/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "question": "What is my total spend?",
    "vendorName": null
  }'
```

### Test Analytics
```bash
curl "http://localhost:4005/api/v1/analytics?userId=user123&period=year"
```

### Test Delete
```bash
curl -X DELETE http://localhost:4005/api/v1/user/user123/data
```

---

## 📦 Data Flow

### Sync Flow
```
1. Frontend calls POST /sync
   ↓
2. Query MongoDB (unindexed docs for userId)
   ↓
3. Group by vendor
   ↓
4. Fetch master.json per vendor (email-storage-service)
   ↓
5. Build dataset with userId
   ↓
6. Generate embeddings (metadata includes userId)
   ↓
7. Store in ChromaDB
   ↓
8. Mark docs as indexed in MongoDB
   ↓
9. Return count
```

### Query Flow
```
1. Frontend calls POST /query
   ↓
2. Generate question embedding
   ↓
3. Search ChromaDB
   WHERE user_id = userId
   AND vendor_name = vendorName (if provided)
   ↓
4. Get top 5 chunks
   ↓
5. Build context for LLM
   ↓
6. Generate answer with Gemini
   ↓
7. Return answer + sources
```

---

## 🔧 Configuration

### Embedding Model
Default: `sentence-transformers/all-mpnet-base-v2`
- 768-dimensional embeddings
- Good balance of speed and accuracy

### LLM
Default: `gemini-2.5-flash`
- Fast response times
- Good for RAG tasks

### Vector DB
- **Collection**: `vendor_invoices`
- **Persist**: `data/vectordb/`
- **Backend**: ChromaDB

---

## 🐛 Troubleshooting

### "No relevant documents found"
- Check if sync completed successfully
- Verify MongoDB has `indexed=true` for documents
- Check vector DB stats: `GET /health`

### "Query failed"
- Check Gemini API key is valid
- Check embedding service is working
- Check vector DB has data for user

### Cross-user data leak
- Verify all queries include `where={"user_id": user_id}`
- Check chunk metadata includes `user_id`
- Test with multiple users

---

## 📝 Notes

### Breaking Changes from v1.0
1. **Query API**: Changed from `GET /query?q=...` to `POST /query` with JSON body
2. **GraphQL Removed**: Migrate to REST if used
3. **Reset Removed**: Use `DELETE /user/:id/data` per user instead
4. **User ID Required**: All endpoints now require `userId`

### Migration Steps
1. Reset vector DB (done automatically)
2. Users re-sync their documents
3. Update frontend to use new API

---

## 🎉 Summary

The chat service is now:
- ✅ **50% less code** (500 lines vs 1200)
- ✅ **User isolated** (complete data separation)
- ✅ **Simpler API** (6 clear endpoints)
- ✅ **Production ready** (proper error handling)
- ✅ **Maintainable** (easy to understand and extend)

---

## 📞 Support

For issues or questions, check:
1. API docs: http://localhost:4005/docs
2. Health check: http://localhost:4005/api/v1/health
3. Logs: Check console output for detailed error messages