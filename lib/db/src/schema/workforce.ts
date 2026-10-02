import {
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type WorkDayRecord = {
  date: string;
  dayName: string;
  hours: number;
  type: "work" | "leave" | "rest";
  leaveId?: number | null;
};

export type ScheduleDayRecord = {
  weekday: number;
  dayName: string;
  hours: number;
  plannedStart?: string | null;
  plannedEnd?: string | null;
};

export type LeaveHourSnapshotEntry = {
  date: string;
  hours: number;
};

export const departmentsTable = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    annualLeaveDays: doublePrecision("annual_leave_days").notNull().default(14),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("departments_name_idx").on(table.name)],
);

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeNumber: text("employee_number").notNull().unique(),
  name: text("name").notNull(),
  department: text("department").notNull(),
  role: text("role").notNull(),
  weeklyHours: doublePrecision("weekly_hours").notNull().default(45),
  annualLeaveDays: doublePrecision("annual_leave_days").notNull().default(14),
  annualLeaveDaysOverride: doublePrecision("annual_leave_days_override"),
  hireDate: date("hire_date", { mode: "string" }),
  usedLeaveDays: doublePrecision("used_leave_days").notNull().default(0),
  status: text("status").notNull().default("active"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  avatarColor: text("avatar_color").notNull().default("#2563EB"),
  photoPath: text("photo_path"),
});

export const workPlansTable = pgTable("work_plans", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  days: jsonb("days").$type<WorkDayRecord[]>().notNull(),
});

export const departmentSchedulesTable = pgTable(
  "department_schedules",
  {
    id: serial("id").primaryKey(),
    department: text("department").notNull(),
    days: jsonb("days").$type<ScheduleDayRecord[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("department_schedules_department_idx").on(table.department)],
);

export const specialPeriodsTable = pgTable("special_periods", {
  id: serial("id").primaryKey(),
  department: text("department").notNull(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  days: jsonb("days").$type<ScheduleDayRecord[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeWorkRecordsTable = pgTable(
  "employee_work_records",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    actualHours: doublePrecision("actual_hours"),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    note: text("note").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("employee_work_records_employee_date_idx").on(table.employeeId, table.workDate)],
);

export const employeeWorkRecordRevisionsTable = pgTable(
  "employee_work_record_revisions",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    actualHours: doublePrecision("actual_hours"),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    note: text("note").notNull().default(""),
    operation: text("operation").notNull(),
    changedByUserId: integer("changed_by_user_id"),
    changedByUsername: text("changed_by_username"),
    changedByDisplayName: text("changed_by_display_name"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_work_record_revisions_employee_date_idx").on(table.employeeId, table.workDate),
    index("employee_work_record_revisions_changed_at_idx").on(table.changedAt),
  ],
);

export const workDayBalancesTable = pgTable(
  "work_day_balances",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    plannedHours: doublePrecision("planned_hours").notNull(),
    actualHours: doublePrecision("actual_hours").notNull(),
    plannedStart: text("planned_start"),
    plannedEnd: text("planned_end"),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    missingHours: doublePrecision("missing_hours").notNull(),
    extraHours: doublePrecision("extra_hours").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("work_day_balances_employee_date_idx").on(table.employeeId, table.workDate)],
);

export const overtimeSessionsTable = pgTable("overtime_sessions", {
  id: serial("id").primaryKey(),
  workDate: date("work_date", { mode: "string" }).notNull(),
  scope: text("scope").notNull(),
  department: text("department"),
  departments: text("departments").array().notNull().default([]),
  plannedStart: text("planned_start").notNull(),
  plannedEnd: text("planned_end").notNull(),
  plannedHours: doublePrecision("planned_hours").notNull(),
  note: text("note").notNull().default(""),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const overtimeParticipantsTable = pgTable(
  "overtime_participants",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => overtimeSessionsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
    actualHours: doublePrecision("actual_hours"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("overtime_participants_session_employee_idx").on(table.sessionId, table.employeeId)],
);

export const leavesTable = pgTable("leaves", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  settlementType: text("settlement_type").notNull().default("full"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  days: doublePrecision("days").notNull(),
  annualHourSnapshot: jsonb("annual_hour_snapshot").$type<LeaveHourSnapshotEntry[] | null>(),
  status: text("status").notNull().default("pending"),
  note: text("note").notNull().default(""),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const leaveAttachmentsTable = pgTable("leave_attachments", {
  id: serial("id").primaryKey(),
  leaveId: integer("leave_id")
    .notNull()
    .references(() => leavesTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
});

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tone: text("tone").notNull().default("blue"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
