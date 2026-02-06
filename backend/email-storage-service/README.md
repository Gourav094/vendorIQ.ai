# Email Storage Service

Email fetching, processing, and Google Drive integration service for VendorIQ.

## Overview

Email Storage Service connects a user's Google account, fetches invoice email attachments from Gmail, and stores them in Google Drive organized by vendor. It exposes endpoints to start Google OAuth, receive the OAuth callback, and fetch/process emails. The service persists Google OAuth tokens and sync metadata in MongoDB.

**🎯 Multi-Vendor Support:** Automatically detects and organizes invoices from popular vendors including Amazon, Flipkart, Zomato, Swiggy, Uber, and more. The intelligent vendor detection system analyzes email addresses and subject lines to accurately categorize invoices.

## Architecture Overview

### Database Separation
This service uses a **separate MongoDB database** from the authentication service:
- **Authentication Service**: Manages user accounts, login sessions, and JWT tokens
- **Email Storage Service**: Manages Google OAuth integrations and email/drive data

### User ID Flow
1. User logs in via **Authentication Service** → receives `auth_user_id` (MongoDB ObjectId)
2. User connects Google account via **Email Storage Service** → creates `GoogleIntegration` record linked by `auth_user_id`
3. All email/drive operations use `auth_user_id` to lookup the Google integration

## Data Models

### GoogleIntegration Model
Stores OAuth tokens and connection status for each user's Google account:

```javascript
{
  _id: ObjectId,                    // Own database ID
  auth_user_id: String,             // User ID from authentication service (required)
  provider: String,                 // "google" (default)
  email: String,                    // Google account email
  access_token: String,             // Google OAuth access token
  refresh_token: String,            // Google OAuth refresh token
  status: String,                   // "CONNECTED" or "DISCONNECTED"
  lastSyncedAt: Date,              // Last successful email fetch
  connected_at: Date,              // When user connected Google
  disconnected_at: Date            // When user disconnected (if applicable)
}
```

**Unique Constraint**: `(auth_user_id + provider)` - prevents duplicate integrations

### Connection Flow

#### Connect Google Account
```
1. Frontend calls: GET /auth/google?userId={auth_user_id}
2. User grants permissions on Google OAuth screen
3. Google redirects to: /auth/google/callback?code=xxx&state={auth_user_id}
4. Backend searches: GoogleIntegration.findOne({ auth_user_id, provider: "google" })
5. IF EXISTS:
     - Update tokens
     - Set status = "CONNECTED"
     - Set connected_at = now
     - Clear disconnected_at
   ELSE:
     - Create new GoogleIntegration record
```

#### Disconnect Google Account
```
POST /api/v1/users/{auth_user_id}/disconnect-google

Updates integration:
- status = "DISCONNECTED"
- access_token = null
- refresh_token = null
- disconnected_at = timestamp
```

## Prerequisites
- Google Cloud project with OAuth 2.0 Client ID (Web application)
- Authorized redirect URI set to `http://localhost:4002/auth/google/callback`
- MongoDB connection string
- Node.js 18+

## Environment Setup
Create `email-storage-service/.env` with the following variables (example values shown for local use):

```
PORT=4002
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<dbName>
GOOGLE_CLIENT_ID=<your_google_client_id>
GOOGLE_CLIENT_SECRET=<your_google_client_secret>
GOOGLE_REDIRECT_URI=http://localhost:4002/auth/google/callback
OCR_SERVICE_BASE_URL=http://localhost:4003
OCR_TRIGGER_TOKEN=<shared_secret>
LOG_LEVEL=info
```

Note: In production, encrypt and store secrets securely. Do not commit real secrets to source control.

## Installation
From the `backend/email-storage-service` directory:

```
npm install
```

## Run
```
npm run dev
```

On startup you should see logs confirming MongoDB connection and the Swagger URL.

## Run with Docker (prebuilt image)

- Pull the Docker Image
  - `docker pull gourav094/vendoriq-email-service:latest`
- Create `.env` from `env.example` and set values safely (do not commit secrets).
- Run the container:
  - `docker run --env-file .env -p 4002:4002 gourav094/vendoriq-email-service:latest`
- Verify:
  - Open `http://localhost:4002/health`
  - Swagger: `http://localhost:4002/api-docs`

- To build the docker image after changes
  - Build `docker build -t gourav094/vendoriq-email-service:latest .`
  
Notes:
- Ensure `PORT=4002` (or map ports accordingly).
- Provide `MONGODB_URI`, `GOOGLE_*`, `JWT_*`, etc., in `.env`.
- For Compose, use the included `docker-compose.yaml` and run `docker compose up -d`.


--- 

## Deploye to K8s
- To start with k8s, we can two ways. One way is using 
  - Docker Desktop Kubernetes: No installation required. Just enable through settings
  - minikube: needs installation

- Using minikube 
  - minikube start (make sure minikube)
  - kubectl get nodes
  - eval $(minikube docker-env) (means using kubernetes CLI) -> verify host `echo $DOCKER_HOST`
  - docker build -t vendoriq-auth-service:latest . (image will be build into kuberenetes)
  - minikube ssh -> docker images | grep vendoriq-auth-service -> after working `exit`
  - Inside your k8s/ folder:
    ``` 
    kubectl apply -f k8s-env.yaml
    kubectl apply -f deployment.yaml
    kubectl apply -f service.yaml 
    ```   
  ! Note: env variables which are declared under secrets, it should be base64 encoded. May use - `echo -n "field_val" | base64
  - Check pods and services
    ```
    kubectl get pods
    kubectl get svc
    kubectl get deploy
    ```
  - Accessing service -> kubectl port-forward svc/auth-service 4001:4001
  - minikube dashboard
  - To check logs `kubectl logs auth-service-6957c58df4-fhvfn`



## Scaling using Docker
- Get service name `kubectl get svc`
- Scale deployement `kubectl scale deployment auth-service --replicas=2`
- kubectl get pods -> now there will be 2 replica for auth-service

- intentionally kill a pod
  - List pod: `kubectl get pods` and pick one like auth-service-57b12
  - Delete it intentionally: kubectl delete pod auth-service-57b12
  - kubectl get pods

-Watch pods in real time: kubectl get pods -w


Note: Create k8s-env.yaml file with environment variable


## OAuth Flow
1. Call `GET http://localhost:4002/auth/google` to receive a JSON payload containing a `url` field.
2. Open the returned URL in a browser and complete Google consent.
3. Google redirects to `GET /auth/google/callback`; the service exchanges the code for tokens, queries Google userinfo, and upserts a User document for the returned email. It stores the Google refresh token and access token in MongoDB. If Google does not return a new refresh token, the service keeps the existing one.
4. A successful callback returns a JSON response with `message` and `email`.

Scopes requested:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/userinfo.email`
- `openid`

## API Endpoints

### Authentication
- `GET /auth/google?userId={auth_user_id}` - Initialize OAuth flow (requires auth_user_id from auth service)
- `GET /auth/google/callback` - OAuth callback handler (internal use by Google)

### User Management
- `GET /api/v1/users/:userId/sync-status` - Get last sync time and connection status
- `DELETE /api/v1/users/:userId/sync-status` - Reset sync status to re-fetch all emails
- `POST /api/v1/users/:userId/disconnect-google` - Disconnect Google integration

### Email Operations
- `POST /api/v1/email/fetch` - Fetch emails and upload attachments to Drive
  ```json
  {
    "userId": "auth_user_id_from_auth_service",
    "fromDate": "2024-01-01",
    "email": "vendor@example.com",
    "onlyPdf": true,
    "forceSync": false,
    "schedule": "manual"
  }
  ```

### Drive Operations
- `GET /api/v1/drive/users/:userId/vendors` - List vendor folders
- `GET /api/v1/drive/users/:userId/vendors/:vendorId/invoices` - List invoices for vendor
- `GET /api/v1/drive/users/:userId/vendors/:vendorId/master` - Get master.json data

### Processing
- `GET /api/v1/processing/jobs/:jobId` - Get job status
- `GET /api/v1/processing/users/:userId/jobs` - List all jobs for user
- `POST /api/v1/processing/jobs/:jobId/retry` - Retry failed job

## Data Model
`User` document fields (relevant subset):
- `email` required and unique
- `googleRefreshToken` Google OAuth refresh token
- `googleAccessToken` Google OAuth access token
- `lastSyncedAt` Date of last successful sync for incremental fetching

### GoogleIntegration Model
Stores OAuth tokens and connection status for each user's Google account:

```javascript
{
  _id: ObjectId,                    // Own database ID
  auth_user_id: String,             // User ID from authentication service (required)
  provider: String,                 // "google" (default)
  email: String,                    // Google account email
  access_token: String,             // Google OAuth access token
  refresh_token: String,            // Google OAuth refresh token
  status: String,                   // "CONNECTED" or "DISCONNECTED"
  lastSyncedAt: Date,              // Last successful email fetch
  connected_at: Date,              // When user connected Google
  disconnected_at: Date            // When user disconnected (if applicable)
}
```

**Unique Constraint**: `(auth_user_id + provider)` - prevents duplicate integrations

## Processing Logic
- Query Gmail using a search string built from `after:<timestamp> has:attachment` plus filename filters and optional `from:` filter
- Retrieve each message and read the `From` header and `Subject` line
- **Intelligent vendor detection:**
  - Checks known vendor patterns (Amazon, Flipkart, Zomato, etc.)
  - Analyzes email domain and username
  - Parses subject line for vendor keywords
  - Falls back to domain-based or username-based detection
- If a vendor filter is provided, skip messages that do not match
- Before uploading, query Drive for an existing file with the same name in the vendor's `invoices` folder to prevent duplicates
- Download allowed attachments and upload to Drive under `invoiceAutomation/<Vendor>/invoices`
- Update `lastSyncedAt` after a successful run to enable incremental sync on later requests

### Automated OCR Hand-off
- Each successful upload triggers a call to the OCR Extraction Service (`OCR_SERVICE_BASE_URL`)
- The service sends the Drive file IDs of newly uploaded invoices grouped by vendor
- OCR service extracts structured JSON, stores `master.json` per vendor folder, and pushes the consolidated file back to Drive without duplicating previous entries
- Failures during OCR trigger logging but do not interrupt email ingestion

### Vendor Detection Examples
| Email From | Subject | Detected Vendor |
|------------|---------|----------------|
| `ship-confirm@amazon.in` | Order Confirmation | **Amazon** |
| `noreply@flipkart.com` | Your Flipkart Order | **Flipkart** |
| `orders@zomato.com` | Order Receipt | **Zomato** |
| `auto-confirm@amazon.com` | - | **Amazon** |
| `hello@myntra.com` | - | **Flipkart** (Myntra is owned by Flipkart) |
| `orders@blinkit.com` | - | **Zomato** (Blinkit is owned by Zomato) |
| `user@gmail.com` | - | **User** (personal email) |
| `billing@acmecorp.com` | - | **Acmecorp** (business domain) |

## Drive Organization
- Root folder: `invoiceAutomation`
- Vendor folder: `invoiceAutomation/<Vendor>` where `Vendor` is a sanitized name from detection
- Invoices subfolder: `invoiceAutomation/<Vendor>/invoices`

## Logging
- A lightweight logger emits request logs and app logs
- Configure verbosity via `LOG_LEVEL` (`error`, `warn`, `info`, `debug`)
- In production (`NODE_ENV=production`) logs are JSON lines suitable for aggregation

## Security and Limits
- Security headers added via `helmet`; `x-powered-by` disabled
- Rate limiting applied on OAuth and API endpoints
- CORS enabled; configure allowed origins and credentials as needed
- Tokens are stored in MongoDB; in production consider encrypting refresh tokens at rest and adding OAuth `state` for CSRF protection

## Troubleshooting
- Redirect URI mismatch: ensure Google Console Authorized redirect URI exactly matches `GOOGLE_REDIRECT_URI`
- No Gmail connected: ensure the user completed OAuth and has a `googleRefreshToken` in MongoDB
- No files uploaded: check `onlyPdf` and ensure attachments exist and match the filters; confirm the Gmail search query is correct
- MongoDB connectivity: verify `MONGO_URI` and network access

## Development Notes
- Swagger UI is served at `/api-docs`
- The fetch endpoint currently accepts filters and implements vendor and sender filtering with support for PDF only or common image types
- To enforce authentication and ownership checks on the fetch endpoint, add a JWT middleware and validate that the token’s user matches the `userId` being requested

## License
This project inherits the repository’s license. See the root LICENSE if present.
