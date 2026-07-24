# Backend Schema
## Animal Care Facility Digital Records System
### University of Windsor – Animal Care Department

**Document Owner:** University of Windsor – Developed by Apurva Shovit

**Status:** Draft v0.1

**Last Updated:** July 2026

**Related Documents**
- PRD.md
- TRD.md
- architecture.md

---

# 1. Purpose

This document defines the backend data model for the Animal Care Facility Digital Records System.

The backend is implemented using **FastAPI**, **Pydantic**, and **MongoDB Atlas**. MongoDB is schemaless, but every collection is governed by strongly typed Pydantic models. The schema prioritizes auditability, extensibility, and long-term maintainability.

Core design principles:

- Business entities only (no UI-only tables)
- Immutable historical records
- Transaction-safe updates
- Soft deletion where appropriate
- Multi-room and multi-facility ready
- Optimized read performance without sacrificing history

---

# 2. Database Collections

```
users
roles
facilities
rooms
tanks
projects
tank_assignments
quarantine_records
census_events
incident_reports
water_quality_logs
food_logs
maintenance_logs
disposition_records
controlled_vocabularies
audit_logs
export_history
settings
```

---

# 3. Common Base Model

Every mutable collection inherits:

```yaml
_id: ObjectId
created_at: datetime
updated_at: datetime
created_by: ObjectId
updated_by: ObjectId
deleted: bool
deleted_at: datetime | null
deleted_by: ObjectId | null
```

Collections containing historical records (audit logs, census events, water quality, incidents, food logs, maintenance logs, disposition records) are immutable and never soft-deleted.

---

# 4. Collections

## 4.1 Users

Purpose:
Authentication and authorization.

Fields

```yaml
_id: ObjectId
email: str (unique)
password_hash: str
first_name: str
last_name: str
role_id: ObjectId
facility_ids: list[ObjectId]
room_ids: list[ObjectId]
assigned_tank_ids: list[ObjectId]
status: enum[pending,active,suspended]
last_login: datetime
```

Indexes

- unique(email)
- role_id

---

## 4.2 Roles

```yaml
_id: ObjectId
name: str
permissions: list[str]
```

---

## 4.3 Facilities

```yaml
_id: ObjectId
name: str
address: str
description: str
active: bool
```

---

## 4.4 Rooms

```yaml
_id: ObjectId
facility_id: ObjectId
room_number: str
description: str
active: bool
```

---

## 4.5 Tanks

Represents only the physical tank.

```yaml
_id: ObjectId
room_id: ObjectId
tank_number: str
status: enum[active,inactive]
notes: str | null
```

Removed from earlier draft:

- tank_capacity
- default_species
- tank_groups

These are either operational data or backend logic, not persistent entities.

---

## 4.6 Projects

Represents an AUPP research project.

```yaml
_id: ObjectId
aupp_number: str
title: str
principal_investigator: str
expiry_date: datetime
rm_number: str
status: enum[active,closed]
```

Validation

```
^\d{2}-\d{2}$
```

Indexes

- unique(aupp_number)

---

## 4.7 Tank Assignments

Purpose

Represents animals belonging to a project currently assigned to a specific tank.

```yaml
_id: ObjectId
project_id: ObjectId
tank_id: ObjectId
species: str
sex: enum[male,female,both]
dob: datetime | null
established_date: datetime
source: str
source_type: enum[external,hatched]
current_count: int
status: enum[active,closed]
```

Rationale

Instead of calculating current fish count by summing every census event, the backend maintains `current_count` transactionally.

Whenever a census event is created:

1. Insert CensusEvent
2. Update TankAssignment.current_count
3. Commit MongoDB transaction

This provides:

- O(1) dashboard reads
- Full historical reconstruction
- Complete auditability

---

## 4.8 Quarantine Records

```yaml
_id: ObjectId
tank_assignment_id: ObjectId
arrival_date: datetime
end_date: datetime
status: str
observations: list[str]
completed: bool
```

Automatically created for externally acquired animals.

---

## 4.9 Census Events

Immutable ledger.

```yaml
_id: ObjectId
tank_assignment_id: ObjectId
tank_id: ObjectId
date: datetime
change: int
reason: enum[
death,
arrival,
transfer_in,
transfer_out,
hatched,
manual_adjustment
]
user_id: ObjectId
```

Never edited.

Never deleted.

Indexes

- tank_assignment_id + date

---

## 4.10 Incident Reports

```yaml
_id: ObjectId
project_id: ObjectId
tank_assignment_id: ObjectId
tank_id: ObjectId
date: datetime
problem: str
comments: str
treatment: str
aquatic_condition_checked: bool
vet_contacted: bool
researcher_notified: bool
created_by: ObjectId
```

No initials are stored. The user relationship replaces paper initials.

---

## 4.11 Water Quality Logs

Represents a single tank reading.

Batch entry is backend logic only.

If the API receives multiple tank IDs, the backend creates one WaterQualityLog per tank.

```yaml
_id: ObjectId
tank_id: ObjectId
project_id: ObjectId | null
type: enum[daily,test_strip]
date: datetime
parameters: object
comments: str
created_by: ObjectId
```

Daily parameters

- pH
- DO
- Temperature

Test strip parameters

- Nitrate
- Nitrite
- Hardness
- Chlorine
- Alkalinity
- Ammonia
- pH

No batch_submission_id is stored.

---

## 4.12 Food Logs

```yaml
_id: ObjectId
tank_id: ObjectId
food_type: str
amount: str
date: datetime
comments: str
created_by: ObjectId
```

Batch feeding is API logic.

---

## 4.13 Maintenance Logs

```yaml
_id: ObjectId
tank_id: ObjectId
date: datetime
description: str
created_by: ObjectId
```

---

## 4.14 Disposition Records

```yaml
_id: ObjectId
project_id: ObjectId
tank_assignment_id: ObjectId
type: enum[
euthanized,
transferred,
adopted,
other
]
date: datetime
reason: str
created_by: ObjectId
```

---

## 4.15 Controlled Vocabularies

```yaml
_id: ObjectId
type: str
value: str
active: bool
created_by: ObjectId
```

Examples

- Species
- Food Type

Users can create new values.

Only Admin/Chair may delete or deactivate values.

---

## 4.16 Audit Logs

Append-only.

```yaml
_id: ObjectId
actor_id: ObjectId
role: str
action: str
entity_type: str
entity_id: ObjectId
before: object
after: object
timestamp: datetime
ip_address: str
device: str
```

Every create/update/delete/export/login/permission change generates an audit record.

---

## 4.17 Export History

```yaml
_id: ObjectId
user_id: ObjectId
date_from: datetime
date_to: datetime
format: str
created_at: datetime
```

---

## 4.18 Settings

```yaml
_id: ObjectId
key: str
value: any
```

Examples

- quarantine_days
- safe_ranges
- backup_schedule

---

# 5. Relationships

```
Facility
└── Room
    └── Tank
        ├── TankAssignment
        │   ├── CensusEvents
        │   ├── WaterQualityLogs
        │   ├── IncidentReports
        │   └── DispositionRecords
        ├── FoodLogs
        └── MaintenanceLogs

Project
└── TankAssignments

User
├── AuditLogs
├── All created_by references
└── ExportHistory
```

---

# 6. Backend Logic (Not Stored)

The following concepts are intentionally handled by application logic rather than persistent collections:

- Batch tank updates
- Batch feeding
- Batch water quality submission
- Current user initials
- Tank grouping

Example batch water quality flow:

1. Client submits list of tank IDs.
2. Backend validates request.
3. Backend creates one WaterQualityLog per tank.
4. MongoDB transaction commits all records together.

---

# 7. Soft Delete Policy

Soft delete:

- Users
- Facilities
- Rooms
- Tanks
- Projects
- Controlled Vocabularies

Immutable:

- Audit Logs
- Census Events
- Incident Reports
- Water Quality Logs
- Food Logs
- Maintenance Logs
- Disposition Records
- Export History

---

# 8. Future Extensions

Designed to support:

- Multiple facilities
- Additional animal species
- SSO/OIDC
- IoT sensors
- Veterinary records
- AI anomaly detection
- Native mobile applications
