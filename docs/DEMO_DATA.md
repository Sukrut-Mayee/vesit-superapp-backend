# CampusOne Demo Data Setup Guide

This document explains how to safely populate dummy/demo data for the CampusOne Junior Showcase using existing backend APIs.

## 1. Purpose
* **Demo-Only Data**: This procedure is strictly for the college showcase.
* **Privacy**: **NEVER** use real student information, real phone numbers, or real emails. Use dummy values (e.g., `student1@demo.com`).

## 2. Safety Rules
* **Tenant Isolation**: Use the intended demo college/tenant only.
* **No Infrastructure Changes**: Do not modify college IDs or email domains in the database.
* **No Destructive Actions**: Do not run destructive SQL commands or delete existing production data.
* **Authentication**: All requests must use a valid Admin JWT belonging to the demo college to ensure correct `college_id` scoping.

## 3. Demo Data Setup Order
Populate data in the following sequence to maintain relational integrity:

1. **Users/Students**: Create demo users via the existing signup/admin flows.
2. **Resources**: Populate the marketplace.
3. **Donations**: Link existing resources as donations.
4. **Internships**: Post available opportunities.
5. **Placements**: Add company visit schedules.
6. **Events**: Schedule campus events.
7. **Announcements**: Post general notices.
8. **Attendance**: Bulk upload attendance records.

## 4. API Payload Examples

### Resources (`POST /resources`)
```json
{
  "title": "Engineering Drawing Board",
  "category": "Stationery",
  "condition": "Good",
  "listing_type": "lend"
}
```

### Donations (`POST /donations`)
```json
{
  "resource_id": "resource-uuid-here"
}
```

### Internships (`POST /internships`)
```json
{
  "title": "Software Engineering Intern",
  "company": "TechCorp",
  "department": "CS",
  "year_eligible": "3rd Year",
  "deadline": "2026-12-31",
  "apply_link": "https://example.com/apply"
}
```

### Placements (`POST /placement`)
```json
{
  "company": "Global Systems",
  "eligibility": "CGPA > 7.5",
  "visit_date": "2026-11-15"
}
```

### Events (`POST /events`)
```json
{
  "title": "Annual Tech Fest",
  "description": "The biggest tech event of the year",
  "date": "2026-12-01",
  "time": "10:00",
  "venue": "Main Auditorium"
}
```

### Announcements (`POST /announcements`)
```json
{
  "title": "Holiday Notice",
  "body": "The college will remain closed on Friday for the festival."
}
```

## 5. Attendance Bulk Import
Attendance is populated using the `/attendance/bulk` endpoint.

**Payload Format:**
```json
[
  {
    "student_id": "demo-student-uuid",
    "subject": "Mathematics",
    "attended_classes": 15,
    "total_classes": 20,
    "semester": "5"
  }
]
```

### Upsert Logic
The bulk import is an **UPSERT**. It creates a new record or updates an existing one based on the following composite unique key:
`(college_id, student_id, subject, semester)`

## 6. Verification Checklist
Ensure the following after populating data:
- [ ] **Admin Action**: Admin successfully created/updated a record.
- [ ] **Admin Visibility**: Admin can see the record in the Admin Panel.
- [ ] **Student Visibility**: The target student sees only their own appropriate record.
- [ ] **Tenant Check**: Records are scoped to the correct `college_id` (not visible to other colleges).
- [ ] **Privacy Check**: No real personal data is present in any field.
