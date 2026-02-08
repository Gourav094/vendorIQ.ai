<div align="center">

# 📁 VendorIQ.AI  
### 🤖 AI-Powered Invoice Automation Platform for SMBs

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/BITSSAP2025AugAPIBP3Sections/APIBP-20242YA-Team-1)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/BITSSAP2025AugAPIBP3Sections/APIBP-20242YA-Team-1/pulls)

[Overview](#-overview) • [Architecture](#-system-architecture) • [Setup](#-getting-started) • [APIs](#-api-endpoints) • [Tech Stack](#-tech-stack) • [Implementation](#-implementation-highlights)

</div>

---

## Overview

### 📌 The Problem
Small and medium businesses (SMBs) handle hundreds of vendor invoices every month.  
They arrive scattered across emails, PDFs, and attachments — making tax audits, reconciliation, and analytics **slow and error-prone**.

### 💡 The Solution
**VendorIQ.AI** is an end-to-end **AI-powered invoice automation system** that:
- Fetches invoices automatically from Gmail
- Categorizes them by **vendor** into Google Drive
- Extracts structured data using **OCR + AI (Google Gemini)**
- Provides **Real-time Analytics** with AI-generated insights
- Allows querying and insights using a **RAG-based Chatbot**

---

### 🏗️ System Architecture

VendorIQ.AI uses a **microservices architecture** with an **API Gateway** pattern for centralized routing, authentication, and logging.

### 🧩 Services Overview

| Service | Description | Key Tech | Port |
|---------|-------------|----------|------|
| **API Gateway** | Central entry point for all services. Handles routing, JWT verification, rate limiting, and request logging. | Node.js, Express, http-proxy-middleware | 4000 |
| **Authentication Service** | Google OAuth login, email/password registration, JWT tokens, and user profile management. | Python, Flask, JWT, Google OAuth, MongoDB | 4001 |
| **Email & Storage Service** | Fetches invoices from Gmail, detects vendor from sender, uploads to Drive with vendor-organized folders. Triggers OCR processing. | Node.js, Express, MongoDB, Google Gmail/Drive APIs | 4002 |
| **OCR Extraction Service** | Extracts text from PDF invoices and structures data (vendor, date, amount, items) using Google Gemini API. | Python, FastAPI, Google Gemini API, pdfminer.six | 4003 |
| **Chat Service (RAG)** | Vector-based knowledge retrieval for natural language queries. Provides real-time analytics with AI-generated insights. | Python, FastAPI, ChromaDB, Embeddings | 4005 |
| **Frontend** | React-based dashboard for invoice management, analytics, and chat interface. | React, Vite, TypeScript, Tailwind CSS | 8000 |

---

## 🔄 System Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐
│   Frontend  │────▶│ API Gateway │────▶│ Authentication Svc  │
│  (Port 8000)│     │ (Port 4000) │     │    (Port 4001)      │
└─────────────┘     └──────┬──────┘     └─────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Email Storage │  │ OCR Extraction│  │ Chat Service  │
│  (Port 4002)  │  │  (Port 4003)  │  │  (Port 4005)  │
└───────┬───────┘  └───────┬───────┘  └───────────────┘
        │                  │
        ▼                  ▼
   ┌─────────┐      ┌─────────────┐
   │ Gmail + │      │Google Gemini│
   │ Drive   │      │    API      │
   └─────────┘      └─────────────┘
```

### Processing Pipeline

1. **User authenticates** via API Gateway → Authentication Service (Google OAuth or Email/Password)
2. **Email Fetch**: Email Storage Service connects to Gmail, fetches invoice emails, uploads PDFs to Google Drive in vendor-organized folders (`invoiceAutomation/<Vendor>/invoices/`)
3. **OCR Processing**: User triggers document processing → OCR Service extracts structured data from PDFs using Google Gemini API → Stores JSON results
4. **AI Indexing**: Chat Service syncs OCR-processed documents → Creates vector embeddings → Stores in ChromaDB (user-isolated)
5. **Query & Analytics**: User queries via RAG chatbot or views AI-generated analytics

---

## ✨ Features

### Core Features
- 📩 **Gmail Invoice Fetching** (OAuth + scheduled automation)
- 📂 **Google Drive Storage** (vendor-wise folders: `invoiceAutomation/<Vendor>/invoices`)
- 🧾 **AI-Powered OCR** (Google Gemini API with automatic retry)
- 📊 **Real-time Analytics** (AI-generated insights and spending trends)
- 💬 **RAG Chatbot** (natural language queries with vector search)
- 🔐 **Centralized API Gateway** (routing, JWT auth, rate limiting, logging)

### 🔧 Additional Features
- **Google OAuth 2.0** + **Email/Password Authentication**
- **JWT Token Management** (access + refresh tokens with httpOnly cookies)
- **User Data Isolation** (all queries scoped to user)
- **Document Processing Pipeline** with retry capability
- **Reset APIs** for data management (email sync, OCR, AI database)
- **Swagger/OpenAPI** documentation for all services
- **Docker Compose** for easy deployment
- **Kubernetes-ready** configuration

---

## 🛠️ Tech Stack

<div align="center">

| Category | Technologies |
|----------|--------------|
| **API Gateway** | Node.js, Express, http-proxy-middleware, JWT |
| **Backend Languages** | Node.js (ES Modules), Python 3.x |
| **Backend Frameworks** | Express.js, Flask, FastAPI |
| **AI/OCR** | Google Gemini API, pdfminer.six |
| **APIs** | Google Gmail API, Google Drive API |
| **Database** | MongoDB (Mongoose), ChromaDB (Vector Store) |
| **Auth** | Google OAuth 2.0, JWT (PyJWT, jsonwebtoken) |
| **AI/Chatbot** | Vector Embeddings, ChromaDB, RAG Architecture |
| **Security** | Helmet, Express Rate Limit, httpOnly Cookies |
| **Logging** | Custom Logger (Winston-style), Morgan |
| **Documentation** | Swagger UI, Flasgger, OpenAPI |
| **Frontend** | React, Vite, Tailwind CSS, TypeScript |
| **Containerization** | Docker, Docker Compose, Kubernetes |

</div>

---

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- Python 3.10+ (for local development)
- Google Cloud Project with Gmail & Drive APIs enabled
- MongoDB instance (local or Atlas)

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/BITSSAP2025AugAPIBP3Sections/APIBP-20242YA-Team-1.git
cd APIBP-20242YA-Team-1
```

### 2️⃣ Folder Structure

```
VendorIQ.AI/
├── docker-compose.yml          # Full stack deployment
├── Frontend/                   # React + Vite frontend
└── backend/
    ├── api-gateway/            # Central API Gateway (Express.js)
    ├── authentication-service/ # Auth & User Management (Flask)
    ├── email-storage-service/  # Gmail fetch & Drive storage (Express.js)
    ├── ocr-extraction-service/ # OCR + AI extraction (FastAPI + Gemini)
    └── chat-service/           # RAG chatbot & analytics (FastAPI)
```

### 3️⃣ Environment Setup

Each service requires its own `.env` file. Create them based on the examples:

```bash
# API Gateway
cp backend/api-gateway/.env.example backend/api-gateway/.env

# Authentication Service
cp backend/authentication-service/.env.example backend/authentication-service/.env

# Email Storage Service
cp backend/email-storage-service/.env.example backend/email-storage-service/.env

# OCR Extraction Service
cp backend/ocr-extraction-service/.env.example backend/ocr-extraction-service/.env

# Chat Service
cp backend/chat-service/.env.example backend/chat-service/.env
```

### 4️⃣ Run with Docker Compose

```bash
# Build and start all services
docker-compose up --build

# Or run in detached mode
docker-compose up -d --build
```

### 5️⃣ Access the Application

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:8000 |
| **API Gateway** | http://localhost:4000 |
| **Auth Docs** | http://localhost:4001/docs |
| **Email Docs** | http://localhost:4002/api-docs |
| **OCR Docs** | http://localhost:4003/docs |
| **Chat Docs** | http://localhost:4005/docs |

---

## 📡 API Endpoints

All requests go through the **API Gateway** (Port 4000). The gateway strips the service prefix and forwards to the appropriate service.

### 🔐 Authentication (`/auth/*` → Port 4001)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/api/v1/auth/google/login` | GET | Get Google OAuth authorization URL |
| `/auth/auth/callback` | GET | Google OAuth callback handler |
| `/auth/api/v1/auth/login` | POST | Email/password login |
| `/auth/api/v1/auth/register` | POST | Create new user account |
| `/auth/api/v1/auth/refresh` | POST | Refresh JWT access token |
| `/auth/api/v1/auth/me` | GET | Get current user profile |
| `/auth/api/v1/auth/logout` | POST | Logout and clear cookies |

### 📧 Email & Storage (`/email/*` → Port 4002)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/email/health` | GET | Service health check |
| `/email/auth/google` | GET | Get Gmail OAuth consent URL |
| `/email/auth/google/callback` | GET | Gmail OAuth callback |
| `/email/api/v1/email/fetch` | POST | Fetch emails and upload to Drive |
| `/email/api/v1/drive/users/:userId/vendors` | GET | List vendor folders |
| `/email/api/v1/drive/users/:userId/vendors/:vendorId/invoices` | GET | List invoices for vendor |
| `/email/api/v1/documents/process` | POST | Trigger OCR processing |
| `/email/api/v1/documents/status/:userId` | GET | Get processing status |
| `/email/api/v1/reset/:userId/hard-reset` | POST | Hard reset all user data |

### 🔍 OCR Extraction (`/ocr/*` → Port 4003)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ocr/api/v1/health` | GET | Service health check |
| `/ocr/api/v1/invoice/extract` | POST | Extract structured invoice data |
| `/ocr/api/v1/text-to-json` | POST | Convert text to JSON via Gemini |

### 💬 Chat Service (`/chat/*` → Port 4005)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat/api/v1/health` | GET | Service health check |
| `/chat/api/v1/sync` | POST | Sync & index OCR-processed documents |
| `/chat/api/v1/query` | POST | Ask questions with RAG |
| `/chat/api/v1/analytics` | GET | Get spend analytics |
| `/chat/api/v1/stats` | GET | Get indexing stats |
| `/chat/api/v1/user/:userId/data` | DELETE | Delete user's indexed data |

---

## 🧩 Example Flow

```bash
# 1️⃣ Register a new user
curl -X POST http://localhost:4000/auth/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret","username":"john"}'

# 2️⃣ Login and get tokens (stored in cookies)
curl -X POST http://localhost:4000/auth/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret"}' \
  -c cookies.txt

# 3️⃣ Connect Gmail (redirect user to this URL)
curl http://localhost:4000/email/auth/google

# 4️⃣ Fetch emails and upload to Drive
curl -X POST http://localhost:4000/email/api/v1/email/fetch \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"userId":"USER_ID","fromDate":"2024-01-01"}'

# 5️⃣ Process documents with OCR
curl -X POST http://localhost:4000/email/api/v1/documents/process \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"userId":"USER_ID"}'

# 6️⃣ Sync documents to Chat Service
curl -X POST http://localhost:4000/chat/api/v1/sync \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"userId":"USER_ID"}'

# 7️⃣ Query the chatbot
curl -X POST http://localhost:4000/chat/api/v1/query \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"userId":"USER_ID","question":"What is my total spend with Amazon?"}'

# 8️⃣ Get analytics
curl "http://localhost:4000/chat/api/v1/analytics?userId=USER_ID&period=year" \
  -b cookies.txt
```

---

## 🌿 Branching Strategy

```bash
main                → stable production-ready branch  
dev                 → integration/testing branch  
feature/<name>      → new features  
fix/<name>          → bug fixes  
chore/<name>        → maintenance or config changes

Examples:
feature/gmail-fetch
fix/drive-upload-bug
```

---

## 🎯 Implementation Highlights

### 🔒 Security Features
- **API Gateway** with centralized JWT verification
- **Helmet** middleware for security headers
- **Rate limiting** on auth and API endpoints
- **httpOnly cookies** for token storage (no JS access)
- **User data isolation** (all queries scoped to authenticated user)
- **OAuth 2.0** with minimal scopes (gmail.readonly, drive.file)

### 📊 Data Management
- **Incremental sync** using `lastSyncedAt` timestamps
- **Vendor detection** from email sender with sanitization
- **Document status tracking** (PENDING → PROCESSING → COMPLETED/FAILED)
- **SHA256 hashing** for duplicate detection in vector DB
- **Reset APIs** for granular data management

### 🤖 AI/ML Features
- **Vector embeddings** for semantic search
- **RAG architecture** (Retrieval-Augmented Generation)
- **Google Gemini API** for intelligent text extraction
- **ChromaDB** for vector storage and similarity search
- **User-isolated** vector collections

### 🐳 Containerization
- **Docker Compose** for full-stack deployment
- **Health checks** for all services
- **Volume persistence** for vector DB and processed files
- **Kubernetes configs** for production deployment

---

## 🔮 Future Enhancements

* 📦 Integration with Tally / QuickBooks
* 📊 Expense Trend Visualization Dashboard
* 🔐 Multi-Tenant SaaS Deployment
* 🧾 Automatic Payment Reminder Emails
* 🤖 GPT Fine-tuning for domain-specific invoice Q&A
* 🔄 Kafka-based event-driven pipeline

---

## Project History
This project was originally developed as part of a team under an organization repository.
For collaboration history including issues and pull requests, see:
Original Organization Repository: https://github.com/BITSSAP2025AugAPIBP3Sections/APIBP-20242YA-Team-1

---

## 🙌 Acknowledgments

* [Google Cloud APIs](https://console.cloud.google.com/apis/dashboard)
* [Google Gemini API](https://ai.google.dev/)
* [Swagger UI](https://swagger.io/tools/swagger-ui/)
* [Node.js](https://nodejs.org/)
* [Express.js](https://expressjs.com/)
* [FastAPI](https://fastapi.tiangolo.com/)
* [Flask](https://flask.palletsprojects.com/)
* [ChromaDB](https://www.trychroma.com/)

---

<div align="center">

### 🌟 Empowering Businesses through Automation

Built with ❤️ by the **VendorIQ.AI** Team

</div>
