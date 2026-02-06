Use one MongoDB instance and keep separate collections (tables) per service.
currently email and auth service might use diff instance. 
MongoDB
 └── app_database
      ├── users                (auth service)
      ├── email_integrations   (email service)
      ├── processed_attachments
      ├── documents            (OCR + chat indexing)
      └── analytics



Use only one mongo db instace for all the operations. please change carefully this might break this. 

Flow: User -> Email/Drive Sync -> OCR Service -> MongoDB (documents collection) -> User clicks Sync -> Chat Service -> Vector DB (Chroma)

### Core Principle
OCR extracts data.
Database tracks status.
User triggers sync.
Chat service indexes only new documents.

So, No direct calls between OCR and chat services.

### OCR Service

Purpose: Extract invoice data from PDFs.

Input: PDF file from Drive.

Output: Stored in Drive
/vendor_folder
    invoice.pdf
    master.json

After processing: OCR service upserts document record in MongoDB.
No direct calls to chat service.

MongoDB (Single Source of Truth)
Tracks: OCR status, Indexing status, File locations, Invoice metadata


### Chat Service

Purpose: Index invoice data into vector DB. Serve chat and analytics queries.
Trigger:
Only when: User clicks Sync
Behavior:
Fetch unindexed documents.
Create embeddings.
Store in ChromaDB.
Mark documents as indexed.

MongoDb Index suggestion:
db.documents.createIndex({
  user_id: 1,
  ocr_status: 1,
  indexed: 1
});

## Expected FLow
Step 1: User Syncs Emails

User clicks: Sync Emails
Email-storage service: Fetches emails.
Uploads attachments.
Stores tracking info in MongoDB.

Step 2: OCR Processing

OCR service: Downloads PDF.
Extracts invoice data.
Writes: master.json
Uploads files.
Upserts MongoDB record:
    ocr_status = COMPLETED
    indexed = false


Step 3: User Clicks “Sync” for Chat
Step 4: Chat Service Sync Logic
Query MongoDB
documents where:
    user_id = current user
    ocr_status = COMPLETED
    indexed = false

For each document
Load master.json.
Build embedding text.
Store in ChromaDB.
Update MongoDB: 
    indexed = true
    indexed_at = now()
    index_version += 1

SYNC API DEISNG IN CHAT SERVICE
endpoint: POST /sync
Request: {
  "user_id": "user_42"
}
Response {
  "documents_indexed": 12,
  "status": "completed"
}


### Error Handling Logic
OCR failure
ocr_status = FAILED
indexed = false
Chat service ignores these.

Indexing failure
Keep: indexed = false
Retry on next sync.