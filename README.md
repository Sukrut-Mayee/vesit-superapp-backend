# CampusOne Backend API

Multi-tenant college superapp backend service built with **Node.js**, **Express**, **Supabase (PostgreSQL)**, and **Cloudinary**.

---

## Table of Contents
- [Architecture & Design](#architecture--design)
- [Tech Stack](#tech-stack)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Setup](#local-setup)
- [Database Setup](#database-setup)
- [Deployment (Render)](#deployment-render)
- [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
- [API Reference](#api-reference)
  - [Health Check](#health-check)
  - [Authentication](#authentication)
  - [Timetable](#timetable)
  - [Notes Repository](#notes-repository)
  - [Events & RSVPs](#events--rsvps)
  - [Clubs & Announcements](#clubs--announcements)
  - [Global Announcements](#global-announcements)
  - [Lost & Found](#lost--found)
  - [Internships](#internships)
  - [Placements](#placements)
  - [Resources (Peer-to-Peer Sharing)](#resources-peer-to-peer-sharing)
  - [Borrow Requests](#borrow-requests)
  - [Donations](#donations)
  - [Attendance Module](#attendance-module)
- [Test Accounts & Credentials](#test-accounts--credentials)
- [Postman Collection](#postman-collection)

---

## Architecture & Design

1. **Multi-Tenant College Isolation**:
   - All data is scoped to individual colleges via `college_id`.
   - The backend service client uses the Supabase `service_role` key and enforces tenant isolation on every request using the caller's JWT token (`req.user.collegeId`).
   - Signups validate the email domain against registered colleges in the database.

2. **Custom JWT Token Shape**:
   - Custom JWT tokens include standard Supabase-compatible claims:
     - `sub`: User ID (`users.id`)
     - `role`: `'authenticated'` (for Supabase PostgREST & RLS compatibility)
     - `app_role`: User application role (`student`, `club_head`, `admin`)
     - `college_id`: User's assigned college ID
     - `email`: User's email

3. **Media & File Handling**:
   - Handled via `multer` in-memory storage (20MB limit) and streamed directly to **Cloudinary** (no disk persistence required).

---

## Tech Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Database & Auth**: Supabase / PostgreSQL (pgcrypto, RLS policies)
- **File Storage**: Cloudinary SDK
- **Security & Tokens**: `jsonwebtoken`, `bcryptjs`, `cors`

---

## Environment Variables

Create a `.env` file in the root directory based on `.env.example`:

| Variable | Description | Example / Source |
| :--- | :--- | :--- |
| `PORT` | Local server port | `4000` |
| `SUPABASE_URL` | Supabase Project URL | `https://xyzcompany.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` secret key *(Never expose to clients)* | Supabase Dashboard → Settings → API |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account cloud name | Cloudinary Dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | Cloudinary Dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret | Cloudinary Dashboard |
| `JWT_SECRET` | Secret used to sign & verify JWTs | Long random string / Supabase JWT secret |
| `JWT_EXPIRES_IN` | JWT expiry duration | `7d` |

---

## Getting Started

### Prerequisites
- Node.js (v18 or later)
- npm
- Supabase account & project
- Cloudinary account

### Local Setup

```bash
# 1. Clone repository and navigate to backend directory
cd campusone-backend

# 2. Configure environment variables
cp .env.example .env
# Edit .env with your Supabase, Cloudinary, and JWT credentials

# 3. Install dependencies
npm install

# 4. Start the development server (with auto-reload)
npm run dev
```

The server will start at `http://localhost:4000`. Test the health endpoint:
```bash
curl http://localhost:4000/health
# Response: {"status":"ok"}
```

---

## Database Setup

1. Open your Supabase project dashboard.
2. Navigate to **SQL Editor → New query**.
3. Copy and paste the entire contents of [`supabase_schema.sql`](./supabase_schema.sql).
4. Run the query. This sets up:
   - Required extensions (`pgcrypto`)
   - Tables with constraints and foreign keys (`colleges`, `users`, `timetable`, `notes`, `events`, `event_rsvps`, `clubs`, `club_posts`, `lost_found`, `internships`, `placement`, `resources`, `borrow_requests`)
   - Optimized indexes
   - Row Level Security (RLS) policies
   - Seed data for default colleges (e.g., VESIT)

---

## Deployment (Render)

1. Push the code to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), click **New + → Web Service**.
3. Connect your repository.
4. Configure service settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, add all keys defined in `.env`.
6. Verify deployment by hitting `https://<your-render-app>.onrender.com/health`.

---

## Role-Based Access Control (RBAC)

| Role | Permissions |
| :--- | :--- |
| `student` | View all resources/schedules, upload notes, create lost & found items, RSVP to events, create peer-to-peer resource listings, request to borrow resources. |
| `club_head` | All student capabilities + post updates/announcements for their assigned club (`POST /clubs/:id/posts`). |
| `admin` | Full management: create timetable entries, publish events, delete/post internships and placements, delete peer listings, resolve any lost & found ticket. |

---

## API Reference

All protected endpoints require the following header:
```http
Authorization: Bearer <JWT_TOKEN>
```

### Health Check

#### `GET /health`
Verifies backend server liveness.
- **Auth**: None
- **Response `200 OK`**:
```json
{
  "status": "ok"
}
```

---

### Authentication

#### `POST /auth/signup`
Registers a new user scoped to their registered college domain.
- **Auth**: None
- **Body (`application/json`)**:
```json
{
  "name": "Jane Doe",
  "email": "jane.doe@ves.ac.in",
  "password": "securepassword123"
}
```
- **Response `201 Created`**:
```json
{
  "token": "<jwt_token>",
  "user": {
    "id": "uuid",
    "college_id": "uuid",
    "name": "Jane Doe",
    "email": "jane.doe@ves.ac.in",
    "role": "student",
    "trust_score": 0,
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `POST /auth/login`
Authenticates user with email and password.
- **Auth**: None
- **Body (`application/json`)**:
```json
{
  "email": "jane.doe@ves.ac.in",
  "password": "securepassword123"
}
```
- **Response `200 OK`**:
```json
{
  "token": "<jwt_token>",
  "user": {
    "id": "uuid",
    "college_id": "uuid",
    "name": "Jane Doe",
    "email": "jane.doe@ves.ac.in",
    "role": "student",
    "trust_score": 0,
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `GET /auth/me`
Fetches authenticated user profile.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "user": {
    "id": "uuid",
    "college_id": "uuid",
    "name": "Jane Doe",
    "email": "jane.doe@ves.ac.in",
    "role": "student",
    "trust_score": 0,
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

---

### Timetable

#### `GET /timetable`
Retrieves timetable entries for the caller's college.
- **Auth**: `Bearer <token>`
- **Query Params**: `division` (optional, e.g., `?division=D7A`)
- **Response `200 OK`**:
```json
{
  "timetable": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "division": "D7A",
      "subject": "Distributed Systems",
      "day": "Mon",
      "start_time": "09:00:00",
      "end_time": "10:00:00",
      "room": "Lab 301",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /timetable`
Adds a new timetable schedule slot.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "division": "D7A",
  "subject": "Database Engineering",
  "day": "Mon",
  "start_time": "10:15:00",
  "end_time": "11:15:00",
  "room": "Room 402"
}
```
- **Response `201 Created`**:
```json
{
  "entry": {
    "id": "uuid",
    "college_id": "uuid",
    "division": "D7A",
    "subject": "Database Engineering",
    "day": "Mon",
    "start_time": "10:15:00",
    "end_time": "11:15:00",
    "room": "Room 402",
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

---

### Notes Repository

#### `POST /notes`
Uploads academic notes / study materials.
- **Auth**: `Bearer <token>`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file`: File buffer (max 20 MB, PDF/Images/Documents)
  - `subject`: `string` (required)
  - `year`: `string` (required, e.g., `"FE"`, `"SE"`, `"TE"`, `"BE"`)
  - `topic`: `string` (optional)
- **Response `201 Created`**:
```json
{
  "note": {
    "id": "uuid",
    "college_id": "uuid",
    "uploader_id": "uuid",
    "subject": "Machine Learning",
    "year": "TE",
    "topic": "Neural Networks Chapter 3",
    "file_url": "https://res.cloudinary.com/.../notes/sample.pdf",
    "file_type": "pdf",
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `GET /notes`
Filters notes by subject, year, or topic keyword.
- **Auth**: `Bearer <token>`
- **Query Params**: `subject`, `year`, `topic` (partial search)
- **Response `200 OK`**:
```json
{
  "notes": [ ... ]
}
```

#### `GET /notes/:id/download`
Redirects (302) to the Cloudinary asset download URL.
- **Auth**: `Bearer <token>`

---

### Events & RSVPs

#### `GET /events`
Lists upcoming college events ordered by date and time.
- Each event includes `rsvp_count` and `has_rsvpd` for the caller. RSVP user identities are not returned. These fields persist across refreshes.
- RSVP cancellation is not supported; clients should show an already-registered state after success or HTTP 409.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "events": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "title": "Annual Tech Symposium",
      "description": "Hackathons, workshops and project exhibits.",
      "date": "2026-10-15",
      "time": "10:00:00",
      "venue": "Auditorium",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /events`
Creates a college event.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "title": "Annual Tech Symposium",
  "description": "Hackathons, workshops and project exhibits.",
  "date": "2026-10-15",
  "time": "10:00:00",
  "venue": "Auditorium"
}
```
- **Response `201 Created`**:
```json
{
  "event": { ... }
}
```

#### `POST /events/:id/rsvp`
RSVP to an event for the authenticated user.
- **Auth**: `Bearer <token>`
- **Response `201 Created`**:
```json
{
  "rsvp": {
    "id": "uuid",
    "event_id": "uuid",
    "user_id": "uuid",
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```
*(Returns `409 Conflict` if the user has already RSVP'd).*

#### `GET /events/:id/rsvp-count`
Gets the total number of attendees who RSVP'd.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "event_id": "uuid",
  "count": 42
}
```

---

### Clubs & Announcements

#### `GET /clubs`
Lists registered clubs for the college.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "clubs": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "name": "Robotics Club",
      "description": "Hardware and robotics enthusiasts",
      "head_id": "uuid",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /clubs/:id/posts`
Publishes an announcement for a club.
- **Auth**: `Bearer <token>` (`club_head` of this specific club only)
- **Body (`application/json`)**:
```json
{
  "title": "Robotics Workshop registrations open",
  "body": "Join us this Friday in Lab 204 for an introductory session."
}
```
- **Response `201 Created`**:
```json
{
  "post": {
    "id": "uuid",
    "club_id": "uuid",
    "college_id": "uuid",
    "title": "Robotics Workshop registrations open",
    "body": "Join us this Friday in Lab 204 for an introductory session.",
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `GET /clubs/:id/posts`
Lists all posts/updates for a specific club.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "posts": [ ... ]
}
```

---

### Global Announcements

#### `GET /announcements`
Fetches global announcements for the college, ordered by newest first.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "announcements": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "title": "Semester Exams Updated",
      "body": "Please check the updated timetable on the portal.",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /announcements`
Creates a global announcement.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "title": "Campus Maintenance",
  "body": "Main gate will be closed this weekend."
}
```
- **Response `201 Created`**:
```json
{
  "announcement": {
    "id": "uuid",
    "college_id": "uuid",
    "title": "Campus Maintenance",
    "body": "Main gate will be closed this weekend.",
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `PATCH /announcements/:id`
Updates an existing global announcement.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "title": "Campus Maintenance - Rescheduled"
}
```
- **Response `200 OK`**:
```json
{
  "announcement": {
    "id": "uuid",
    "college_id": "uuid",
    "title": "Campus Maintenance - Rescheduled",
    "body": "Main gate will be closed this weekend.",
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `DELETE /announcements/:id`
Deletes a global announcement.
- **Auth**: `Bearer <token>` (`admin` only)
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Announcement deleted successfully"
}
```

---

### Lost & Found

#### `GET /lost-found`
Lists college-scoped lost and found listings (open by default).
- **Auth**: `Bearer <token>`
- **Query Params**: `type` (`"lost"` or `"found"`), `status` (`"open"`, `"resolved"`, or `"all"`; default `"open"`). Use `status=all` for client-side status/history filters.
- **Response `200 OK`**:
```json
{
  "listings": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "poster_id": "uuid",
      "type": "lost",
      "description": "Blue water bottle left in Room 301",
      "photo_url": "https://res.cloudinary.com/.../image.jpg",
      "status": "open",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /lost-found`
Creates a lost or found report.
- **Auth**: `Bearer <token>`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `type`: `"lost"` or `"found"` (required)
  - `description`: `string` (required)
  - `photo`: File (optional, max 20 MB)
- **Response `201 Created`**:
```json
{
  "listing": { ... }
}
```

#### `PATCH /lost-found/:id/resolve`
Marks a lost/found listing as resolved.
- **Auth**: `Bearer <token>` (poster only, including for admin accounts)
- For a lost post, the poster confirms recovery. For a found post, the poster confirms handover to its owner. A different student or unrelated admin receives 403; cross-college/missing listings receive 404. Repeating resolution as the poster returns 200 without another update.
- **Response `200 OK`**:
```json
{
  "listing": {
    "id": "uuid",
    "status": "resolved"
  }
}
```

---

### Internships

#### `GET /internships`
Lists available internship openings, ordered by earliest deadline.
- **Auth**: `Bearer <token>`
- **Query Params**: `department`, `year_eligible`, `company` (partial match)
- **Response `200 OK`**:
```json
{
  "internships": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "title": "Software Engineering Intern",
      "company": "Tech Corp",
      "department": "Computer Science",
      "year_eligible": "TE",
      "deadline": "2026-11-01T00:00:00Z",
      "apply_link": "https://careers.techcorp.example/apply",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /internships`
Posts a new internship opportunity.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "title": "Frontend Engineer Intern",
  "company": "StartUp Hub",
  "department": "IT",
  "year_eligible": "TE",
  "deadline": "2026-10-30",
  "apply_link": "https://example.com/apply"
}
```
- **Response `201 Created`**:
```json
{
  "internship": { ... }
}
```

#### `DELETE /internships/:id`
Deletes an internship posting.
- **Auth**: `Bearer <token>` (`admin` only)
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Internship deleted successfully"
}
```

---

### Placements

#### `GET /placement`
Retrieves placement drive records ordered by visit date.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "placement": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "company": "Google",
      "eligibility": "B.E CMPN/INFT >= 8.5 CGPA",
      "visit_date": "2026-11-15T00:00:00Z",
      "created_at": "2026-09-12T12:00:00Z"
    }
  ]
}
```

#### `POST /placement`
Creates a placement drive entry.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "company": "Microsoft",
  "eligibility": "B.E All branches >= 8.0 CGPA",
  "visit_date": "2026-11-20"
}
```
- **Response `201 Created`**:
```json
{
  "placement": { ... }
}
```

---

### Resources (Peer-to-Peer Sharing)

#### `GET /resources`
Browses peer-to-peer shareable resources within the authenticated student's college.
- **Auth**: `Bearer <token>`
- **Query Params**:
  - `category` (e.g., `"Electronics"`, `"Calculators"`, `"Books"`, `"Lab Equipment"`)
  - `listing_type` (`"lend"` or `"donate"`)
  - `status` (defaults to `"AVAILABLE"`, or pass specific status like `"REQUESTED"`, or `"all"`)
  - `search` / `query` (matches text against resource title)
- **Response `200 OK`**:
```json
{
  "resources": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "owner_id": "uuid",
      "title": "Arduino Uno Rev3 + Sensor Kit",
      "category": "Electronics",
      "condition": "Like New",
      "listing_type": "lend",
      "status": "AVAILABLE",
      "image_urls": ["https://res.cloudinary.com/.../arduino.jpg"],
      "created_at": "2026-09-12T12:00:00Z",
      "owner": {
        "id": "uuid",
        "name": "Jane Doe",
        "email": "jane.doe@ves.ac.in",
        "trust_score": 15
      }
    }
  ]
}
```

#### `GET /resources/:id`
Retrieves detailed information for a specific resource by ID.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "resource": {
    "id": "uuid",
    "college_id": "uuid",
    "owner_id": "uuid",
    "title": "Scientific Calculator FX-991EX",
    "category": "Calculators",
    "condition": "Excellent",
    "listing_type": "lend",
    "status": "AVAILABLE",
    "image_urls": [
      "https://res.cloudinary.com/.../calc_front.jpg"
    ],
    "created_at": "2026-09-12T12:00:00Z",
    "owner": {
      "id": "uuid",
      "name": "Alex Smith",
      "email": "alex.smith@ves.ac.in",
      "trust_score": 25
    }
  }
}
```

#### `POST /resources`
Creates a peer-to-peer resource listing. Supports both `multipart/form-data` with direct image uploads streamed to Cloudinary, and `application/json` with existing image URLs.
- **Auth**: `Bearer <token>` (`student` or `admin`)
- **Option A: `multipart/form-data`**:
  - `title`: `string` (required)
  - `category`: `string` (required)
  - `listing_type`: `"lend"` | `"donate"` (required)
  - `condition`: `string` (optional, e.g. `"Like New"`, `"Good"`)
  - `images`: File array (optional, up to 5 images, max 20MB each)
- **Option B: `application/json`**:
```json
{
  "title": "Scientific Calculator FX-991EX",
  "category": "Calculators",
  "condition": "Good",
  "listing_type": "lend",
  "image_urls": ["https://res.cloudinary.com/.../calc.jpg"]
}
```
- **Response `201 Created`**:
```json
{
  "resource": {
    "id": "uuid",
    "college_id": "uuid",
    "owner_id": "uuid",
    "title": "Scientific Calculator FX-991EX",
    "category": "Calculators",
    "condition": "Good",
    "listing_type": "lend",
    "status": "AVAILABLE",
    "image_urls": ["https://res.cloudinary.com/.../image.jpg"],
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```
*(Note: If `listing_type` is `"donate"`, a corresponding record in `donations` table is automatically registered).*

#### `PATCH /resources/:id`
Updates resource details (owner or admin only). Supports updating text fields and appending uploaded images.
- **Auth**: `Bearer <token>` (Listing owner or `admin`)
- **Body (`application/json` or `multipart/form-data`)**:
```json
{
  "title": "Scientific Calculator FX-991EX (Updated)",
  "condition": "Like New"
}
```
- **Response `200 OK`**:
```json
{
  "resource": { ... }
}
```

#### `DELETE /resources/:id`
Deletes a resource listing. Only allowed for the listing owner or an admin, and only if there are no active/pending borrow requests.
- **Auth**: `Bearer <token>` (Listing owner or `admin`)
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Resource removed successfully"
}
```

---

### Borrow Requests

#### `POST /borrow-requests`
Creates a request to borrow an available resource using optimistic locking.
- **Auth**: `Bearer <token>` (`student` role)
- **Body (`application/json`)**:
```json
{
  "resource_id": "uuid",
  "start_date": "2026-10-01",
  "end_date": "2026-10-10"
}
```
- **Response `201 Created`**:
```json
{
  "request": {
    "id": "uuid",
    "resource_id": "uuid",
    "borrower_id": "uuid",
    "start_date": "2026-10-01",
    "end_date": "2026-10-10",
    "status": "REQUESTED",
    "created_at": "2026-09-12T12:00:00Z",
    "resource": {
      "id": "uuid",
      "title": "Scientific Calculator FX-991EX",
      "category": "Calculators"
    }
  },
  "resource": {
    "id": "uuid",
    "status": "REQUESTED"
  }
}
```

#### `GET /borrow-requests/my-requests`
Retrieves all borrow requests initiated by the authenticated user.
- **Auth**: `Bearer <token>`
- **Query Params**: `status` (optional, e.g. `?status=REQUESTED`)
- **Response `200 OK`**:
```json
{
  "requests": [
    {
      "id": "uuid",
      "resource_id": "uuid",
      "borrower_id": "uuid",
      "start_date": "2026-10-01",
      "end_date": "2026-10-10",
      "status": "REQUESTED",
      "resource": {
        "id": "uuid",
        "title": "Scientific Calculator FX-991EX",
        "category": "Calculators",
        "image_urls": ["..."],
        "owner": {
          "id": "uuid",
          "name": "Jane Doe",
          "email": "jane.doe@ves.ac.in",
          "trust_score": 15
        }
      }
    }
  ]
}
```

#### `GET /borrow-requests/received`
Retrieves all incoming borrow requests for items listed by the authenticated user.
- **Auth**: `Bearer <token>`
- **Query Params**: `status` (optional)
- **Response `200 OK`**:
```json
{
  "requests": [
    {
      "id": "uuid",
      "resource_id": "uuid",
      "borrower_id": "uuid",
      "start_date": "2026-10-01",
      "end_date": "2026-10-10",
      "status": "REQUESTED",
      "borrower": {
        "id": "uuid",
        "name": "Bob Taylor",
        "email": "bob.taylor@ves.ac.in",
        "trust_score": 8
      },
      "resource": {
        "id": "uuid",
        "title": "Scientific Calculator FX-991EX",
        "category": "Calculators"
      }
    }
  ]
}
```

#### `PATCH /borrow-requests/:id/approve`
Approves a borrow request (Resource Owner only). Transitions request status to `APPROVED`, resource status to `APPROVED`, and auto-rejects other competing pending requests for that item.
- **Auth**: `Bearer <token>` (Resource owner)
- **Response `200 OK`**:
```json
{
  "request": {
    "id": "uuid",
    "status": "APPROVED"
  },
  "resource_status": "APPROVED"
}
```

#### `PATCH /borrow-requests/:id/reject`
Rejects a borrow request (Resource Owner only). Transitions request to `REJECTED` and resets resource status to `AVAILABLE`.
- **Auth**: `Bearer <token>` (Resource owner)
- **Response `200 OK`**:
```json
{
  "request": {
    "id": "uuid",
    "status": "REJECTED"
  },
  "resource_status": "AVAILABLE"
}
```

#### `PATCH /borrow-requests/:id/return`
Marks a borrowed item as returned. Can be invoked by borrower or owner. Transitions request status to `RETURNED`, resets resource status to `AVAILABLE`, and automatically awards +2 trust score to the borrower.
- **Auth**: `Bearer <token>` (Borrower, Resource Owner, or `admin`)
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Resource marked as returned and is now AVAILABLE",
  "request": {
    "id": "uuid",
    "status": "RETURNED"
  },
  "resource_status": "AVAILABLE"
}
```

---

### Donations & Admin Verification

#### `POST /donations`
Registers a resource for college-wide donation.
- **Auth**: `Bearer <token>`
- **Body (`application/json`)**:
```json
{
  "resource_id": "uuid"
}
```
- **Response `201 Created`**:
```json
{
  "donation": {
    "id": "uuid",
    "college_id": "uuid",
    "donor_id": "uuid",
    "resource_id": "uuid",
    "verified": false,
    "created_at": "2026-09-12T12:00:00Z"
  }
}
```

#### `GET /donations`
Lists college donations.
- **Auth**: `Bearer <token>`
- **Query Params**: `verified` (`true` | `false`), `donor_id`
- **Response `200 OK`**:
```json
{
  "donations": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "donor_id": "uuid",
      "resource_id": "uuid",
      "verified": false,
      "donor": {
        "id": "uuid",
        "name": "Jane Doe",
        "email": "jane.doe@ves.ac.in",
        "trust_score": 15
      },
      "resource": {
        "id": "uuid",
        "title": "Engineering Mechanics Textbook",
        "category": "Books",
        "status": "AVAILABLE"
      }
    }
  ]
}
```

#### `GET /donations/my-donations`
Returns donation history for the authenticated user.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "donations": [ ... ]
}
```

#### `PATCH /donations/:id/verify`
Verifies a donation (Admin only). Sets `verified = true`, assigns `verified_by = admin_id`, marks the resource status as `COMPLETED`, and awards +10 trust score points to the donor.
- **Auth**: `Bearer <token>` (`admin` role)
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Donation verified successfully. Donor awarded +10 trust score.",
  "donation": {
    "id": "uuid",
    "verified": true,
    "verified_by": "admin-uuid"
  },
  "donor_updated_trust_score": 25
}
```

---

### Attendance Module

#### `GET /attendance/me`
Retrieves the logged-in student's attendance records across all subjects with computed metrics.
- **Auth**: `Bearer <token>` (`student` or authenticated user)
- **Query Params**: `semester` (e.g. `?semester=SEM 5`), `academic_year`
- **Response `200 OK`**:
```json
{
  "attendance": [
    {
      "id": "uuid",
      "college_id": "uuid",
      "student_id": "uuid",
      "subject": "Operating Systems",
      "attended_classes": 27,
      "total_classes": 30,
      "percentage": 90.00,
      "semester": "SEM 5",
      "division": "D7A",
      "academic_year": "2026-2027",
      "updated_at": "2026-10-06T12:00:00Z"
    }
  ],
  "summary": {
    "total_subjects": 1,
    "total_attended_classes": 27,
    "total_conducted_classes": 30,
    "overall_percentage": 90.00,
    "low_attendance_subjects_count": 0,
    "is_defaulter": false
  }
}
```

#### `GET /attendance/me/:subject`
Retrieves attendance for a specific subject for the logged-in student.
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "attendance": {
    "id": "uuid",
    "subject": "Operating Systems",
    "attended_classes": 27,
    "total_classes": 30,
    "percentage": 90.00,
    "semester": "SEM 5"
  }
}
```

#### `GET /attendance`
Admin endpoint: Lists attendance records for the college with optional filters.
- **Auth**: `Bearer <token>` (`admin` only)
- **Query Params**: `division`, `semester`, `subject`, `student_id`, `academic_year`
- **Response `200 OK`**:
```json
{
  "attendance": [
    {
      "id": "uuid",
      "student_id": "uuid",
      "subject": "Operating Systems",
      "attended_classes": 27,
      "total_classes": 30,
      "percentage": 90.00,
      "student": {
        "id": "uuid",
        "name": "Aditya Menon",
        "email": "aditya.menon@vesit.ves.ac.in"
      }
    }
  ]
}
```

#### `POST /attendance`
Admin endpoint: Creates an attendance entry for a student. Automatically validates that `attended_classes <= total_classes` and calculates `percentage` on backend.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "student_id": "uuid",
  "subject": "Operating Systems",
  "attended_classes": 27,
  "total_classes": 30,
  "semester": "SEM 5",
  "division": "D7A",
  "academic_year": "2026-2027"
}
```
- **Response `201 Created`**:
```json
{
  "attendance": {
    "id": "uuid",
    "student_id": "uuid",
    "subject": "Operating Systems",
    "attended_classes": 27,
    "total_classes": 30,
    "percentage": 90.00
  }
}
```
*(Returns `400 Bad Request` if `attended_classes > total_classes`)*.

#### `PATCH /attendance/:id`
Admin endpoint: Updates attendance figures or metadata. Recalculates `percentage` on the backend.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "attended_classes": 28,
  "total_classes": 30
}
```
- **Response `200 OK`**:
```json
{
  "attendance": {
    "id": "uuid",
    "attended_classes": 28,
    "total_classes": 30,
    "percentage": 93.33
  }
}
```

#### `POST /attendance/bulk`
Admin endpoint: Bulk import attendance records for a division or subject batch.
- **Auth**: `Bearer <token>` (`admin` only)
- **Body (`application/json`)**:
```json
{
  "records": [
    {
      "student_id": "uuid",
      "subject": "Operating Systems",
      "attended_classes": 25,
      "total_classes": 30,
      "semester": "SEM 5",
      "division": "D7A"
    }
  ]
}
```
- **Response `201 Created`**:
```json
{
  "success": true,
  "count": 1,
  "records": [ ... ]
}
```

---

## Test Accounts & Credentials

The following pre-configured test accounts are ready for testing on the live/local database:

| Role | Email | Password | College Domain |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@vesit.ves.ac.in` | `AdminPassword123!` | `vesit.ves.ac.in` / `ves.ac.in` |
| **Student 1** | `student@vesit.ves.ac.in` | `Password123!` | `vesit.ves.ac.in` |
| **Student 2** | `aditya.menon@vesit.ves.ac.in` | `Password123!` | `vesit.ves.ac.in` |
| **Club Head** | `riya.shah@vesit.ves.ac.in` | `Password123!` | `vesit.ves.ac.in` |
| **Other College Student** | `student@testb.edu` | `Password123!` | `testb.edu` *(Tenant isolation)* |

---

## Postman Collection

A complete Postman Collection is included at [`postman_collection.json`](./postman_collection.json).
Import it into Postman to test all endpoints with pre-configured requests, environment variables, and authentication flows.


