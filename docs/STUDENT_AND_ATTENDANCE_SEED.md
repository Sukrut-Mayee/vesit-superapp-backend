# Student Database & Attendance Seed Specification

This document details the synthetic student database and attendance records designed and implemented by **Tanvi** for the **CampusOne (VESIT Pilot)** system, coordinating schemas and data contracts with **Saumya** and downstream services.

---

## 1. Dataset Overview

- **Total Students**: `3,200` unique student profiles
- **Students Per Academic Year**: Exactly `800` students per year
- **Academic Years (4 Years)**:
  - **First Year (FE)**: Admission Year 2026, Semester 1, Academic Year `2026-2027`
  - **Second Year (SE)**: Admission Year 2025, Semester 3, Academic Year `2026-2027`
  - **Third Year (TE)**: Admission Year 2024, Semester 5, Academic Year `2026-2027`
  - **Final Year (BE)**: Admission Year 2023, Semester 7, Academic Year `2026-2027`
- **Branches & Divisions (12 Divisions per Year = 48 Total)**:
  - **Computer (CMPN)**: 3 divisions (`CMPN-A`, `CMPN-B`, `CMPN-C`)
  - **Information Technology (IT)**: 3 divisions (`IT-A`, `IT-B`, `IT-C`)
  - **Electronics & Telecommunication (EXTC)**: 2 divisions (`EXTC-A`, `EXTC-B`)
  - **Electronics & Computer Science (ECS)**: 1 division (`ECS-A`)
  - **Automation & Robotics (ARO)**: 1 division (`ARO-A`)
  - **Artificial Intelligence & Data Science (AIDS)**: 2 divisions (`AIDS-A`, `AIDS-B`)
- **Total Attendance Records**: `16,000` records (5 core engineering subjects per student)
- **Tenant / College Scope**: `VESIT` (`college_id: 81055c6a-4909-44e3-88a3-be6cff32635a`, domain: `vesit.ves.ac.in`)

---

## 2. Division Allocation Matrix (Exact 800 Per Year, 60–70 Per Division)

To fulfill the constraint that First-Year divisions are generally smaller and Second-Year divisions generally larger while preserving exactly 800 students per year:

| Division | First Year (FE) | Second Year (SE) | Third Year (TE) | Final Year (BE) |
| :--- | :--- | :--- | :--- | :--- |
| **CMPN-A** | 65 | 68 | 67 | 67 |
| **CMPN-B** | 65 | 68 | 67 | 67 |
| **CMPN-C** | 64 | 68 | 67 | 67 |
| **IT-A** | 64 | 68 | 67 | 67 |
| **IT-B** | 63 | 68 | 67 | 67 |
| **IT-C** | 61 *(min)* | 68 | 67 | 66 |
| **EXTC-A** | 69 | 67 | 67 | 67 |
| **EXTC-B** | 69 | 67 | 67 | 67 |
| **ECS-A** | 70 | 65 | 66 | 66 |
| **ARO-A** | 70 | 65 | 66 | 66 |
| **AIDS-A** | 70 | 64 | 66 | 67 |
| **AIDS-B** | 70 | 64 | 66 | 66 |
| **Year Total** | **800** | **800** | **800** | **800** |

- **FE characteristics**: Minimum division size reaches 61, with 6 out of 12 divisions having $\le 65$ students (skewed smaller).
- **SE characteristics**: Minimum division size is 64, with 8 out of 12 divisions having $\ge 67$ students, and all Computer and IT divisions at 68 (skewed larger).
- **TE & BE characteristics**: Evenly distributed around 66–67 students.
- **Strict Compliance**: Every single division count is $\ge 60$ and $\le 70$.

---

## 3. Schema & Data Contract Coordination for Saumya

### 3.1 Student User Profile (`users` table & `students` table)

Every student profile contains:
- `id`: UUID (v4 deterministic RFC4122)
- `college_id`: UUID of VESIT
- `name`: Realistic synthetic Indian name (e.g. *"Aarav Sharma"*, *"Diya Patel"*)
- `email`: Unique college email (e.g. `aarav.sharma.fecmpna01@vesit.ves.ac.in`)
- `password_hash`: Precomputed bcrypt hash for `Password123!` (for login testing)
- `role`: `'student'`
- `trust_score`: Integer between 5 and 20
- `roll_number`: Unique standardized roll string (e.g. `FE-CMPN-A-01`, `SE-IT-B-14`)
- `year`: Academic year name (`'First Year'`, `'Second Year'`, `'Third Year'`, `'Final Year'`)
- `year_code`: Short code (`'FE'`, `'SE'`, `'TE'`, `'BE'`)
- `branch`: Branch name (`'Computer'`, `'IT'`, `'EXTC'`, `'ECS'`, `'ARO'`, `'AIDS'`)
- `branch_code`: Branch code (`'CMPN'`, `'IT'`, `'EXTC'`, `'ECS'`, `'ARO'`, `'AIDS'`)
- `division`: Division string (`'CMPN-A'`, `'IT-B'`, etc.)
- `division_letter`: `'A'`, `'B'`, or `'C'`

#### Sample Student JSON Object:
```json
{
  "id": "53e74ec1-cfc3-4152-a0c9-35d08c5cd93e",
  "college_id": "81055c6a-4909-44e3-88a3-be6cff32635a",
  "name": "Aarav Sharma",
  "email": "aarav.sharma.fecmpna01@vesit.ves.ac.in",
  "password_hash": "$2a$10$etLPbZbHlAtIUswFrsaK5uD4PNTI4Y7A5k6xxhNZGQo4ybYFLMSvG",
  "role": "student",
  "trust_score": 12,
  "roll_number": "FE-CMPN-A-01",
  "year": "First Year",
  "year_code": "FE",
  "branch": "Computer",
  "branch_code": "CMPN",
  "division": "CMPN-A",
  "division_letter": "A",
  "created_at": "2026-09-01T09:00:00.000Z"
}
```

### 3.2 Attendance Record (`attendance` table)

- `id`: Deterministic UUID
- `college_id`: UUID of VESIT
- `student_id`: References `users.id`
- `roll_number`: References student roll number
- `subject`: Core subject name from the branch syllabus
- `attended_classes`: Non-negative integer
- `total_classes`: Non-negative integer (conducted classes)
- `percentage`: Number with 2-decimal precision (`(attended / total) * 100`)
- `semester`: Active semester (`'SEM 1'`, `'SEM 3'`, `'SEM 5'`, `'SEM 7'`)
- `division`: Student's division (e.g. `'CMPN-A'`)
- `academic_year`: `'2026-2027'`
- `constraint check_attended_le_total`: Strictly validated (`attended_classes <= total_classes`)
- `constraint unique_student_subject_sem`: Unique composite index on `(college_id, student_id, subject, semester)`

#### Sample Attendance JSON Object:
```json
{
  "id": "8cb69823-3765-42ec-99bc-3b10b0e50974",
  "college_id": "81055c6a-4909-44e3-88a3-be6cff32635a",
  "student_id": "53e74ec1-cfc3-4152-a0c9-35d08c5cd93e",
  "roll_number": "FE-CMPN-A-01",
  "subject": "Engineering Mathematics I",
  "attended_classes": 32,
  "total_classes": 36,
  "percentage": 88.89,
  "semester": "SEM 1",
  "division": "CMPN-A",
  "academic_year": "2026-2027",
  "created_at": "2026-09-01T09:00:00.000Z",
  "updated_at": "2026-10-31T09:00:00.000Z"
}
```

---

## 4. Subject Curriculum Mapping

| Year & Sem | Branch | Core Subjects (5 per branch) |
| :--- | :--- | :--- |
| **FE (SEM 1)** | All Branches | Engineering Mathematics I, Applied Physics I, Applied Chemistry I, Engineering Mechanics, Basic Electrical & Electronics |
| **SE (SEM 3)** | Computer | Data Structures & Algorithms, Discrete Mathematics, Computer Graphics, Digital Logic & Computer Organization, Object Oriented Programming Java |
| **SE (SEM 3)** | IT | Data Structures & Analysis, Database Management Systems, Principles of Communication Engineering, Automata Theory, Python Programming Lab |
| **SE (SEM 3)** | EXTC | Applied Mathematics III, Electronic Devices & Circuits, Digital System Design, Network Theory, Electronic Instruments & Measurement |
| **SE (SEM 3)** | ECS | Data Structures & Algorithms, Analog Circuits, Digital Logic Design, Signals & Systems, Software Engineering |
| **SE (SEM 3)** | ARO | Kinematics of Machinery, Fluid Mechanics & Pneumatics, Sensors & Transducers, Electrical Machines, Materials & Manufacturing |
| **SE (SEM 3)** | AIDS | Data Structures & Algorithms, Discrete Structures & Graph Theory, Database Management Systems, Linear Algebra for AI, Python for Data Science |
| **TE (SEM 5)** | Computer | Operating Systems, Computer Networks, Theory of Computer Science, Software Engineering, Web Computing |
| **TE (SEM 5)** | IT | Software Engineering & Project Mgmt, Computer Networks & Security, Cloud Computing, Advanced Database Management, Mobile Computing |
| **TE (SEM 5)** | EXTC | Digital Communication, Microcontrollers & Applications, Electromagnetic Waves & Propagation, VLSI Design, Control Systems |
| **TE (SEM 5)** | ECS | Embedded Systems, Internet of Things, Microprocessor & Microcontroller, Signals & DSP, Operating Systems |
| **TE (SEM 5)** | ARO | Robotics Control Systems, Machine Vision & Image Processing, Microcontrollers for Robotics, PLC & Industrial Automation, CAD/CAM |
| **TE (SEM 5)** | AIDS | Machine Learning, Artificial Intelligence, Big Data Analytics, Deep Learning & Neural Networks, Data Warehousing & Mining |
| **BE (SEM 7)** | Computer | Distributed Systems, AI & Soft Computing, Cryptography & System Security, Cloud Computing Applications, High Performance Computing |
| **BE (SEM 7)** | IT | Information & Network Security, Deep Learning, Cloud Architecture & DevOps, Big Data Engineering, Mobile Application Development |
| **BE (SEM 7)** | EXTC | Microwave Engineering, Optical Fiber Communication, Embedded & IoT Systems, Satellite Communication, RF Circuit Design |
| **BE (SEM 7)** | ECS | Autonomous Systems & Robotics, Cyber-Physical Systems, System on Chip Design, Cloud Security & Virtualization, AI in Embedded Systems |
| **BE (SEM 7)** | ARO | Autonomous Mobile Robots, Industrial Robotics & CIM, Digital Twins & Simulation, HMI & SCADA Systems, Applied AI in Robotics |
| **BE (SEM 7)** | AIDS | Natural Language Processing, Reinforcement Learning, Computer Vision, MLOps & Production AI, AI Ethics & Governance |

---

## 5. How to Run & Verify

### 5.1 Regenerate Dataset
To regenerate all seed files with seeded PRNG:
```bash
node scripts/generate_demo_data.js
```
Generated artifacts in `data/`:
- `students_seed.json` (3,200 profiles)
- `attendance_seed.json` (16,000 attendance records)
- `students_summary.json` (verified distribution metadata)
- `students_seed.csv` (tabular CSV)
- `attendance_seed.csv` (tabular CSV)
- `seed_students_and_attendance.sql` (idempotent SQL batch insert)

### 5.2 Run Automated Verification Suite
Run the 15-point verification suite:
```bash
node --test test/student_attendance_seed.test.js
```

Or run all backend unit tests:
```bash
node --test test/*.test.js
```

### 5.3 Seeding into Database
To dry-run or verify data in memory:
```bash
node scripts/seed_database.js --dry-run
```
To verify counts against live database:
```bash
node scripts/seed_database.js --verify-only
```
To run batch insertion into Supabase / PostgreSQL:
```bash
node scripts/seed_database.js --batch-size=200
```
Or paste [`data/seed_students_and_attendance.sql`](../data/seed_students_and_attendance.sql) directly into the Supabase SQL Editor.
