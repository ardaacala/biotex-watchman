import { date, index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Informational calendar events; these never create leave or affect balances.
export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [index("calendar_events_dates_idx").on(table.startDate, table.endDate)]);
