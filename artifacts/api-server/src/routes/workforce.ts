import { Router, type IRouter } from "express";
import { hasBookedOverlap, retrospectiveDateError } from "../lib/retrospective-leave";
import { annualCapacityConflict, annualCapacityMessage } from "../lib/annual-leave-capacity";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  activitiesTable,
  db,
  departmentsTable,
  departmentSchedulesTable,
  employeesTable,
  leaveAttachmentsTable,
  employeeWorkRecordRevisionsTable,
  employeeWorkRecordsTable,
  leavesTable,
  specialPeriodsTable,
  workDayBalancesTable,
  type ScheduleDayRecord,
} from "@workspace/db";
import {
  CreateDepartmentBody,
  CreateDepartmentResponse,
  CreateSpecialPeriodBody,
  CreateSpecialPeriodResponse,
  CreateEmployeeBody,
  CreateEmployeeResponse,
  CreateLeaveBody,
  CreateLeaveResponse,
  DeleteSpecialPeriodParams,
  DeleteDepartmentParams,
  GetDashboardSummaryResponse,
  GetDailyWorkRecordsParams,
  GetDailyWorkRecordsResponse,
  GetEmployeeParams,
  GetEmployeeResponse,
  GetEmployeeWorkHistoryParams,
  GetEmployeeWorkHistoryResponse,
  ListActivityResponse,
  ListDepartmentsResponse,
  ListEmployeesQueryParams,
  ListEmployeesResponse,
  ListDepartmentSchedulesResponse,
  ListLeavesQueryParams,
  ListLeavesResponse,
  DownloadLeaveAttachmentParams,
  ListSpecialPeriodsResponse,
  SaveDepartmentScheduleBody,
  SaveDepartmentScheduleResponse,
  SaveDailyWorkRecordsBody,
  SaveDailyWorkRecordsParams,
  SaveDailyWorkRecordsResponse,
  SaveEmployeeWorkRecordBody,
  SaveEmployeeWorkRecordParams,
  SaveEmployeeWorkRecordResponse,
  RenameDepartmentBody,
  RenameDepartmentParams,
  RenameDepartmentResponse,
  UpdateEmployeeBody,
  UpdateEmployeeParams,
  UpdateEmployeeResponse,
  UpdateLeaveStatusBody,
  UpdateLeaveStatusParams,
  UpdateLeaveStatusResponse,
} from "@workspace/api-zod";
import { requireManager, requireWorkforceEditor } from "../lib/auth";
import { deleteEmployeePhoto, validateEmployeePhoto } from "../lib/employeePhotoStorage";
import {
  getLeaveAttachmentFile,
  leaveAttachmentContentTypes,
  safeAttachmentFilename,
  validateUploadedLeaveAttachment,
} from "../lib/leaveAttachmentStorage";
import {
  annualBalance,
  annualBookingError,
  annualCycleBalances,
  annualHourEntries,
  annualQuotaError,
  buildAnnualHourSnapshot,
  deductedAnnualHours,
  effectiveAnnualQuota,
  HOURS_PER_ENTITLEMENT_DAY,
  todayInIstanbul,
} from "./annual-leave";

const router: IRouter = Router();
const avatarColors = ["#2563EB", "#0F766E", "#9333EA", "#C2410C", "#0369A1"];

async function departmentExists(name: string): Promise<boolean> {
  const [department] = await db.select({ id: departmentsTable.id }).from(departmentsTable)
    .where(sql`lower(${departmentsTable.name}) = lower(${name.trim()})`)
    .limit(1);
  return Boolean(department);
}

async function withAnnualBalances(employees: (typeof employeesTable.$inferSelect)[], date = todayInIstanbul()) {
  const [departments, leaves] = await Promise.all([
    db.select().from(departmentsTable),
    db.select().from(leavesTable).where(and(eq(leavesTable.type, "annual"), eq(leavesTable.settlementType, "full"))),
  ]);
  const quotas = new Map(departments.map((dept) => [dept.name, dept.annualLeaveDays]));
  const byEmployee = new Map<number, typeof leaves>();
  for (const leave of leaves) {
    const entries = byEmployee.get(leave.employeeId) ?? [];
    entries.push(leave);
    byEmployee.set(leave.employeeId, entries);
  }
  return employees.map((employee) => annualBalance(
    employee, effectiveAnnualQuota(employee, quotas.get(employee.department)),
    byEmployee.get(employee.id) ?? [], date,
  ));
}

function getMonday(date = new Date()): string {
  const copy = new Date(date);
  const day = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - (day === 0 ? 6 : day - 1));
  return copy.toISOString().slice(0, 10);
}

function isoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function parseIsoDateParam(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function leaveDays(startDate: string | Date, endDate: string | Date): number {
  const start = new Date(`${isoDate(startDate)}T00:00:00Z`);
  const end = new Date(`${isoDate(endDate)}T00:00:00Z`);
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) days += 1;
  }
  return Math.max(days, 1);
}

function scheduleView<T extends { days: ScheduleDayRecord[] }>(schedule: T) {
  const days = schedule.days.map((day) => ({
    ...day,
    plannedStart: day.plannedStart ?? null,
    plannedEnd: day.plannedEnd ?? null,
  }));
  return {
    ...schedule,
    days,
    totalHours: days.reduce((sum, day) => sum + day.hours, 0),
  };
}

function effectiveWeekHours(
  department: string,
  weekStart: string,
  schedule: typeof departmentSchedulesTable.$inferSelect | undefined,
  periods: (typeof specialPeriodsTable.$inferSelect)[],
): number {
  if (!schedule) return 0;
  const start = new Date(`${weekStart}T00:00:00Z`);
  let total = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    const iso = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    const special = periods
      .filter((period) => period.department === department && period.startDate <= iso && period.endDate >= iso)
      .sort((a, b) => b.id - a.id)[0];
    const days = special?.days ?? schedule.days;
    total += days.find((day) => day.weekday === weekday)?.hours ?? 0;
  }
  return total;
}

function effectiveDay(
  employee: typeof employeesTable.$inferSelect,
  date: string,
  schedule: typeof departmentSchedulesTable.$inferSelect | undefined,
  periods: (typeof specialPeriodsTable.$inferSelect)[],
  leave: typeof leavesTable.$inferSelect | undefined,
) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  const weekday = parsedDate.getUTCDay() === 0 ? 7 : parsedDate.getUTCDay();
  const dayName = new Intl.DateTimeFormat("tr-TR", { weekday: "long", timeZone: "UTC" }).format(parsedDate);
  const special = periods
    .filter((period) => period.department === employee.department && period.startDate <= date && period.endDate >= date)
    .sort((a, b) => b.id - a.id)[0];
  const plannedDay = (special?.days ?? schedule?.days ?? []).find((day) => day.weekday === weekday);
  const plannedHours = plannedDay?.hours ?? (!schedule && !special && weekday <= 5 ? employee.weeklyHours / 5 : 0);
  return {
    dayName,
    plannedHours: leave ? 0 : plannedHours,
    plannedStart: leave || plannedHours <= 0 ? null : plannedDay?.plannedStart ?? null,
    plannedEnd: leave || plannedHours <= 0 ? null : plannedDay?.plannedEnd ?? null,
    status: leave ? ("leave" as const) : plannedHours > 0 ? ("work" as const) : ("rest" as const),
  };
}

async function syncWorkBalance(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  employeeId: number,
  workDate: string,
  plannedHours: number,
  actualHours: number | null,
  plannedStart: string | null,
  plannedEnd: string | null,
  checkIn: string | null,
  checkOut: string | null,
) {
  if (actualHours === null) {
    await tx.delete(workDayBalancesTable).where(and(
      eq(workDayBalancesTable.employeeId, employeeId),
      eq(workDayBalancesTable.workDate, workDate),
    ));
    return;
  }
  const values = {
    employeeId,
    workDate,
    plannedHours,
    actualHours,
    plannedStart,
    plannedEnd,
    checkIn,
    checkOut,
    missingHours: Math.max(0, plannedHours - actualHours),
    extraHours: Math.max(0, actualHours - plannedHours),
  };
  await tx.insert(workDayBalancesTable).values(values)
    .onConflictDoUpdate({
      target: [workDayBalancesTable.employeeId, workDayBalancesTable.workDate],
      set: { ...values, updatedAt: new Date() },
    });
}

async function dailyWorkRecords(date: string) {
  const [employees, schedules, periods, leaves, actualRecords] = await Promise.all([
    db.select().from(employeesTable).where(and(eq(employeesTable.status, "active"), isNull(employeesTable.deletedAt))).orderBy(asc(employeesTable.department), asc(employeesTable.name)),
    db.select().from(departmentSchedulesTable),
    db.select().from(specialPeriodsTable).where(and(lte(specialPeriodsTable.startDate, date), gte(specialPeriodsTable.endDate, date))),
    db.select().from(leavesTable).where(and(eq(leavesTable.status, "approved"), lte(leavesTable.startDate, date), gte(leavesTable.endDate, date))),
    db.select().from(employeeWorkRecordsTable).where(eq(employeeWorkRecordsTable.workDate, date)),
  ]);
  const scheduleByDepartment = new Map(schedules.map((schedule) => [schedule.department, schedule]));
  const leaveByEmployee = new Map(leaves.map((leave) => [leave.employeeId, leave]));
  const actualByEmployee = new Map(actualRecords.map((record) => [record.employeeId, record]));
  const balances = new Map((await withAnnualBalances(employees, date)).map((employee) => [employee.id, employee]));
  const parsedDate = new Date(`${date}T00:00:00Z`);
  const dayName = new Intl.DateTimeFormat("tr-TR", { weekday: "long", timeZone: "UTC" }).format(parsedDate);

  return {
    date,
    dayName,
    records: employees.map((employee) => {
      const actual = actualByEmployee.get(employee.id);
      const effective = effectiveDay(
        employee,
        date,
        scheduleByDepartment.get(employee.department),
        periods,
        leaveByEmployee.get(employee.id),
      );
      const actualHours = actual?.actualHours ?? effective.plannedHours;
      const assumeOnTime = actual?.actualHours === null || actual?.actualHours === undefined || actual.actualHours >= effective.plannedHours;
      const checkIn = actual?.checkIn ?? (assumeOnTime ? effective.plannedStart : null);
      const checkOut = actual?.checkOut ?? (assumeOnTime ? effective.plannedEnd : null);
      return {
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        employeeName: employee.name,
        department: employee.department,
        avatarColor: employee.avatarColor,
        photoPath: employee.photoPath,
        date,
        ...effective,
        actualHours,
        checkIn,
        checkOut,
        late: Boolean(checkIn && effective.plannedStart && checkIn > effective.plannedStart),
        earlyLeave: Boolean(checkOut && effective.plannedEnd && checkOut < effective.plannedEnd),
        hoursDifference: actualHours - effective.plannedHours,
        remainingAnnualLeave: balances.get(employee.id)?.remainingAnnualLeaveDays ?? null,
        note: actual?.note ?? "",
      };
    }),
  };
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const weekStart = getMonday();
  const employees = await db.select().from(employeesTable).where(and(eq(employeesTable.status, "active"), isNull(employeesTable.deletedAt)));
  const schedules = await db.select().from(departmentSchedulesTable);
  const periods = await db.select().from(specialPeriodsTable);
  const pending = await db.select().from(leavesTable).where(eq(leavesTable.status, "pending"));
  const approved = await db
    .select()
    .from(leavesTable)
    .where(and(eq(leavesTable.status, "approved"), lte(leavesTable.startDate, weekStart), gte(leavesTable.endDate, weekStart)));
  const archivedIds = new Set((await db.select({ id: employeesTable.id }).from(employeesTable)
    .where(isNotNull(employeesTable.deletedAt))).map(({ id }) => id));
  const currentPending = pending.filter((leave) => !archivedIds.has(leave.employeeId));
  const currentApproved = approved.filter((leave) => !archivedIds.has(leave.employeeId));

  const departmentMap = new Map<string, { employeeCount: number }>();
  for (const employee of employees) {
    const current = departmentMap.get(employee.department) ?? {
      employeeCount: 0,
    };
    current.employeeCount += 1;
    departmentMap.set(employee.department, current);
  }
  const departmentBreakdown = [...departmentMap.entries()].map(([department, item]) => {
    const weeklyHours = effectiveWeekHours(
      department,
      weekStart,
      schedules.find((schedule) => schedule.department === department),
      periods,
    );
    return {
      department,
      employeeCount: item.employeeCount,
      targetHours: weeklyHours * item.employeeCount,
      plannedHours: weeklyHours * item.employeeCount,
    };
  });
  const targetHours = departmentBreakdown.reduce((sum, item) => sum + item.targetHours, 0);
  const plannedHours = departmentBreakdown.reduce((sum, item) => sum + item.plannedHours, 0);

  res.json(
    GetDashboardSummaryResponse.parse({
      weekStart,
      activeEmployees: employees.length,
      plannedHours,
      targetHours,
      approvedLeaveDays: currentApproved.reduce((sum, leave) => sum + leave.days, 0),
      pendingLeaveRequests: currentPending.length,
      employeesOnLeave: new Set(currentApproved.map((leave) => leave.employeeId)).size,
      deficitHours: Math.max(0, targetHours - plannedHours),
      departmentBreakdown,
    }),
  );
});

router.get("/employees", async (req, res): Promise<void> => {
  const parsed = ListEmployeesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  conditions.push(isNull(employeesTable.deletedAt));
  if (parsed.data.status !== "all") conditions.push(eq(employeesTable.status, parsed.data.status ?? "active"));
  if (parsed.data.search) {
    conditions.push(
      or(
        ilike(employeesTable.name, `%${parsed.data.search}%`),
        ilike(employeesTable.employeeNumber, `%${parsed.data.search}%`),
        ilike(employeesTable.department, `%${parsed.data.search}%`),
      )!,
    );
  }
  const employees = await db
    .select()
    .from(employeesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(employeesTable.name));
  res.json(ListEmployeesResponse.parse(await withAnnualBalances(employees)));
});

router.post("/employees", requireWorkforceEditor, async (req, res): Promise<void> => {
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.photoPath != null) {
    try {
      if (!await validateEmployeePhoto(parsed.data.photoPath)) {
        res.status(400).json({ error: "Fotoğraf bulunamadı veya geçerli bir profil fotoğrafı değil." });
        return;
      }
    } catch (error) {
      req.log.error({ err: error }, "Failed to validate employee photo during creation");
      res.status(500).json({ error: "Failed to validate employee photo" });
      return;
    }
  }
  if (!parseIsoDateParam(req.body?.hireDate) || req.body.hireDate > todayInIstanbul()) {
    res.status(400).json({ error: "Geçerli ve gelecekte olmayan bir işe başlama tarihi seçin." });
    return;
  }
  if (!await departmentExists(parsed.data.department)) {
    res.status(400).json({ error: "Geçerli bir departman seçiniz." });
    return;
  }
  const [employee] = await db
    .insert(employeesTable)
    .values({
      ...parsed.data,
      hireDate: isoDate(parsed.data.hireDate),
      annualLeaveDays: parsed.data.annualLeaveDaysOverride ?? 14,
      avatarColor: avatarColors[Math.floor(Math.random() * avatarColors.length)],
    })
    .returning();
  await db.insert(activitiesTable).values({
    type: "employee",
    title: "Yeni çalışan eklendi",
    description: `${employee.name} personel listesine eklendi.`,
    tone: "blue",
  });
  res.status(201).json(CreateEmployeeResponse.parse((await withAnnualBalances([employee]))[0]));
});

router.get("/employees/:id", async (req, res): Promise<void> => {
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [employee] = await db.select().from(employeesTable).where(and(
    eq(employeesTable.id, params.data.id), isNull(employeesTable.deletedAt),
  ));
  if (!employee) {
    res.status(404).json({ error: "Çalışan bulunamadı" });
    return;
  }
  res.json(GetEmployeeResponse.parse((await withAnnualBalances([employee]))[0]));
});

router.patch("/employees/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = UpdateEmployeeParams.safeParse(req.params);
  const body = UpdateEmployeeBody.safeParse(req.body);
  if (!params.success || !body.success || (req.body?.hireDate !== undefined
    && (!parseIsoDateParam(req.body.hireDate) || req.body.hireDate > todayInIstanbul()))) {
    res.status(400).json({ error: "Geçersiz çalışan bilgisi" });
    return;
  }
  if (body.data.photoPath != null) {
    try {
      if (!await validateEmployeePhoto(body.data.photoPath)) {
        res.status(400).json({ error: "Fotoğraf bulunamadı veya geçerli bir profil fotoğrafı değil." });
        return;
      }
    } catch (error) {
      req.log.error({ err: error }, "Failed to validate employee photo during update");
      res.status(500).json({ error: "Failed to validate employee photo" });
      return;
    }
  }
  if (body.data.department && !await departmentExists(body.data.department)) {
    res.status(400).json({ error: "Geçerli bir departman seçiniz." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(employeesTable)
      .where(and(eq(employeesTable.id, params.data.id), isNull(employeesTable.deletedAt))).for("update");
    if (!previous) return null;
    const next = {
      ...previous, ...body.data,
      hireDate: body.data.hireDate ? isoDate(body.data.hireDate) : previous.hireDate,
      annualLeaveDays: body.data.annualLeaveDaysOverride !== undefined
        ? body.data.annualLeaveDaysOverride ?? 14 : previous.annualLeaveDays,
    };
    if (body.data.hireDate !== undefined || body.data.annualLeaveDaysOverride !== undefined
      || body.data.department !== undefined) {
      const [department] = await tx.select().from(departmentsTable)
        .where(eq(departmentsTable.name, next.department));
      const leaves = await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, next.id));
      const error = annualQuotaError(next, effectiveAnnualQuota(next, department?.annualLeaveDays), leaves);
      if (error) return { error };
    }
    const [employee] = await tx.update(employeesTable)
      .set({
        ...body.data,
        hireDate: body.data.hireDate ? isoDate(body.data.hireDate) : undefined,
        annualLeaveDays: body.data.annualLeaveDaysOverride !== undefined
          ? body.data.annualLeaveDaysOverride ?? 14 : undefined,
      })
      .where(eq(employeesTable.id, params.data.id)).returning();
    return { employee, oldPhotoPath: previous.photoPath };
  });
  if (!result) {
    res.status(404).json({ error: "Çalışan bulunamadı" });
    return;
  }
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  if (result.oldPhotoPath && result.oldPhotoPath !== result.employee.photoPath) {
    try {
      const [otherReference] = await db.select({ id: employeesTable.id }).from(employeesTable)
        .where(eq(employeesTable.photoPath, result.oldPhotoPath)).limit(1);
      if (!otherReference) await deleteEmployeePhoto(result.oldPhotoPath);
    } catch (error) {
      req.log.error({ err: error, employeeId: result.employee.id }, "Failed to remove replaced employee photo");
    }
  }
  res.json(UpdateEmployeeResponse.parse((await withAnnualBalances([result.employee]))[0]));
});

router.delete("/employees/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const archived = await db.transaction(async (tx) => {
    const [employee] = await tx.select().from(employeesTable)
      .where(and(eq(employeesTable.id, params.data.id), isNull(employeesTable.deletedAt))).for("update");
    if (!employee) return null;
    await tx.update(employeesTable)
      .set({ deletedAt: new Date(), status: "inactive" })
      .where(eq(employeesTable.id, employee.id));
    await tx.insert(activitiesTable).values({
      type: "employee",
      title: "Çalışan arşivlendi",
      description: `${employee.name} çalışanı arşivlendi; geçmiş kayıtları korundu.`,
      tone: "orange",
    });
    return employee.id;
  });
  if (!archived) {
    res.status(404).json({ error: "Çalışan bulunamadı" });
    return;
  }
  res.status(204).end();
});

router.get("/employees/:id/work-history/:from/:to", async (req, res): Promise<void> => {
  const params = GetEmployeeWorkHistoryParams.safeParse({
    ...req.params,
    from: parseIsoDateParam(req.params.from),
    to: parseIsoDateParam(req.params.to),
  });
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz tarih aralığı" });
    return;
  }
  const from = isoDate(params.data.from);
  const to = isoDate(params.data.to);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (dayCount < 1 || dayCount > 366) {
    res.status(400).json({ error: "Tarih aralığı 1 ile 366 gün arasında olmalıdır." });
    return;
  }

  // Historical work history remains available for archived employees.
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, params.data.id));
  if (!employee) {
    res.status(404).json({ error: "Çalışan bulunamadı" });
    return;
  }
  const [schedule] = await db.select().from(departmentSchedulesTable).where(eq(departmentSchedulesTable.department, employee.department));
  const periods = await db
    .select()
    .from(specialPeriodsTable)
    .where(and(eq(specialPeriodsTable.department, employee.department), lte(specialPeriodsTable.startDate, to), gte(specialPeriodsTable.endDate, from)));
  const leaves = await db
    .select()
    .from(leavesTable)
    .where(and(eq(leavesTable.employeeId, employee.id), eq(leavesTable.status, "approved"), lte(leavesTable.startDate, to), gte(leavesTable.endDate, from)));
  const actualRecords = await db
    .select()
    .from(employeeWorkRecordsTable)
    .where(and(eq(employeeWorkRecordsTable.employeeId, employee.id), gte(employeeWorkRecordsTable.workDate, from), lte(employeeWorkRecordsTable.workDate, to)));
  const actualByDate = new Map(actualRecords.map((record) => [record.workDate, record]));

  const records = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const actual = actualByDate.get(date);
    const leave = leaves.find((item) => item.startDate <= date && item.endDate >= date);
    const effective = effectiveDay(employee, date, schedule, periods, leave);
    const assumeOnTime = actual?.actualHours === null || actual?.actualHours === undefined || actual.actualHours >= effective.plannedHours;
    records.push({
      date,
      ...effective,
      actualHours: actual?.actualHours ?? effective.plannedHours,
      checkIn: actual?.checkIn ?? (assumeOnTime ? effective.plannedStart : null),
      checkOut: actual?.checkOut ?? (assumeOnTime ? effective.plannedEnd : null),
      note: actual?.note ?? "",
    });
  }

  res.json(GetEmployeeWorkHistoryResponse.parse({
    employee: (await withAnnualBalances([employee]))[0],
    from,
    to,
    totalPlannedHours: records.reduce((sum, record) => sum + record.plannedHours, 0),
    totalActualHours: records.reduce((sum, record) => sum + (record.actualHours ?? 0), 0),
    records,
  }));
});

router.put("/employees/:id/work-history/:date", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = SaveEmployeeWorkRecordParams.safeParse({
    ...req.params,
    date: parseIsoDateParam(req.params.date),
  });
  const body = SaveEmployeeWorkRecordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Geçersiz çalışma kaydı" });
    return;
  }
  const date = isoDate(params.data.date);
  const [employee] = await db.select().from(employeesTable).where(and(
    eq(employeesTable.id, params.data.id), isNull(employeesTable.deletedAt),
  ));
  if (!employee) {
    res.status(404).json({ error: "Çalışan bulunamadı" });
    return;
  }
  const [schedule] = await db.select().from(departmentSchedulesTable).where(eq(departmentSchedulesTable.department, employee.department));
  const periods = await db.select().from(specialPeriodsTable).where(and(
    eq(specialPeriodsTable.department, employee.department),
    lte(specialPeriodsTable.startDate, date),
    gte(specialPeriodsTable.endDate, date),
  ));
  const [leave] = await db.select().from(leavesTable).where(and(
    eq(leavesTable.employeeId, employee.id),
    eq(leavesTable.status, "approved"),
    lte(leavesTable.startDate, date),
    gte(leavesTable.endDate, date),
  ));
  const effective = effectiveDay(employee, date, schedule, periods, leave);
  const record = await db.transaction(async (tx) => {
    const [currentEmployee] = await tx.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(eq(employeesTable.id, employee.id), isNull(employeesTable.deletedAt))).for("update");
    if (!currentEmployee) return null;
    const [current] = await tx.select().from(employeeWorkRecordsTable).where(and(
      eq(employeeWorkRecordsTable.employeeId, employee.id),
      eq(employeeWorkRecordsTable.workDate, date),
    ));
    const [existingRevision] = await tx.select({ id: employeeWorkRecordRevisionsTable.id })
      .from(employeeWorkRecordRevisionsTable)
      .where(and(
        eq(employeeWorkRecordRevisionsTable.employeeId, employee.id),
        eq(employeeWorkRecordRevisionsTable.workDate, date),
      ))
      .limit(1);
    if (current && !existingRevision) {
      await tx.insert(employeeWorkRecordRevisionsTable).values({
        employeeId: employee.id,
        workDate: date,
        actualHours: current.actualHours,
        checkIn: current.checkIn,
        checkOut: current.checkOut,
        note: current.note,
        operation: "baseline",
        changedByUserId: null,
      });
    }
    const [saved] = await tx
      .insert(employeeWorkRecordsTable)
      .values({
        employeeId: employee.id,
        workDate: date,
        actualHours: body.data.actualHours,
        checkIn: body.data.checkIn,
        checkOut: body.data.checkOut,
        note: body.data.note,
      })
      .onConflictDoUpdate({
        target: [employeeWorkRecordsTable.employeeId, employeeWorkRecordsTable.workDate],
        set: { ...body.data, updatedAt: new Date() },
      })
      .returning();
    await tx.insert(employeeWorkRecordRevisionsTable).values({
      employeeId: employee.id,
      workDate: date,
      actualHours: saved.actualHours,
      checkIn: saved.checkIn,
      checkOut: saved.checkOut,
      note: saved.note,
      operation: current ? "updated" : "created",
      changedByUserId: res.locals.user.id,
      changedByUsername: res.locals.user.username,
      changedByDisplayName: res.locals.user.displayName,
    });
    const assumeOnTime = saved.actualHours === null || saved.actualHours >= effective.plannedHours;
    await syncWorkBalance(tx, employee.id, date, effective.plannedHours, saved.actualHours,
      effective.plannedStart, effective.plannedEnd, saved.checkIn ?? (assumeOnTime ? effective.plannedStart : null), saved.checkOut ?? (assumeOnTime ? effective.plannedEnd : null));
    return saved;
  });
  if (!record) {
    res.status(404).json({ error: "Çalışan bulunamadı" });
    return;
  }
  res.json(SaveEmployeeWorkRecordResponse.parse({
    date,
    ...effective,
    actualHours: record.actualHours ?? effective.plannedHours,
    checkIn: record.checkIn ?? (record.actualHours === null || record.actualHours >= effective.plannedHours ? effective.plannedStart : null),
    checkOut: record.checkOut ?? (record.actualHours === null || record.actualHours >= effective.plannedHours ? effective.plannedEnd : null),
    note: record.note,
  }));
});

router.get("/daily-work-records/:date", async (req, res): Promise<void> => {
  const params = GetDailyWorkRecordsParams.safeParse({
    ...req.params,
    date: parseIsoDateParam(req.params.date),
  });
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz tarih" });
    return;
  }
  const date = isoDate(params.data.date);
  res.json(GetDailyWorkRecordsResponse.parse(await dailyWorkRecords(date)));
});

router.put("/daily-work-records/:date", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = SaveDailyWorkRecordsParams.safeParse({
    ...req.params,
    date: parseIsoDateParam(req.params.date),
  });
  const body = SaveDailyWorkRecordsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Geçersiz günlük çalışma kayıtları" });
    return;
  }
  const employeeIds = body.data.records.map((record) => record.employeeId);
  if (new Set(employeeIds).size !== employeeIds.length) {
    res.status(400).json({ error: "Aynı personel için birden fazla kayıt gönderilemez" });
    return;
  }
  const activeEmployees = await db.select().from(employeesTable).where(and(
    eq(employeesTable.status, "active"), isNull(employeesTable.deletedAt),
  ));
  const activeIds = new Set(activeEmployees.map((employee) => employee.id));
  if (employeeIds.some((id) => !activeIds.has(id))) {
    res.status(400).json({ error: "Kayıtlarda aktif olmayan veya bulunamayan personel var" });
    return;
  }
  const date = isoDate(params.data.date);
  const [schedules, periods, approvedLeaves] = await Promise.all([
    db.select().from(departmentSchedulesTable),
    db.select().from(specialPeriodsTable).where(and(lte(specialPeriodsTable.startDate, date), gte(specialPeriodsTable.endDate, date))),
    db.select().from(leavesTable).where(and(eq(leavesTable.status, "approved"), lte(leavesTable.startDate, date), gte(leavesTable.endDate, date))),
  ]);
  const schedulesByDepartment = new Map(schedules.map((item) => [item.department, item]));
  const savedRecords = await db.transaction(async (tx) => {
    const lockedEmployees = await tx.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(
        inArray(employeesTable.id, employeeIds),
        eq(employeesTable.status, "active"),
        isNull(employeesTable.deletedAt),
      ))
      .orderBy(asc(employeesTable.id))
      .for("update");
    if (lockedEmployees.length !== employeeIds.length) return false;
    for (const record of body.data.records) {
      const [current] = await tx.select().from(employeeWorkRecordsTable).where(and(
        eq(employeeWorkRecordsTable.employeeId, record.employeeId),
        eq(employeeWorkRecordsTable.workDate, date),
      ));
      const [existingRevision] = await tx.select({ id: employeeWorkRecordRevisionsTable.id })
        .from(employeeWorkRecordRevisionsTable)
        .where(and(
          eq(employeeWorkRecordRevisionsTable.employeeId, record.employeeId),
          eq(employeeWorkRecordRevisionsTable.workDate, date),
        ))
        .limit(1);
      if (current && !existingRevision) {
        await tx.insert(employeeWorkRecordRevisionsTable).values({
          employeeId: record.employeeId,
          workDate: date,
          actualHours: current.actualHours,
          checkIn: current.checkIn,
          checkOut: current.checkOut,
          note: current.note,
          operation: "baseline",
          changedByUserId: null,
        });
      }
      const [saved] = await tx
        .insert(employeeWorkRecordsTable)
        .values({
          employeeId: record.employeeId,
          workDate: date,
          actualHours: record.actualHours,
          checkIn: record.checkIn,
          checkOut: record.checkOut,
          note: record.note,
        })
        .onConflictDoUpdate({
          target: [employeeWorkRecordsTable.employeeId, employeeWorkRecordsTable.workDate],
          set: {
            actualHours: record.actualHours,
            checkIn: record.checkIn,
            checkOut: record.checkOut,
            note: record.note,
            updatedAt: new Date(),
          },
        })
        .returning();
      await tx.insert(employeeWorkRecordRevisionsTable).values({
        employeeId: record.employeeId,
        workDate: date,
        actualHours: saved.actualHours,
        checkIn: saved.checkIn,
        checkOut: saved.checkOut,
        note: saved.note,
        operation: current ? "updated" : "created",
        changedByUserId: res.locals.user.id,
        changedByUsername: res.locals.user.username,
        changedByDisplayName: res.locals.user.displayName,
      });
      const employee = activeEmployees.find((item) => item.id === record.employeeId)!;
      const effective = effectiveDay(
        employee,
        date,
        schedulesByDepartment.get(employee.department),
        periods,
        approvedLeaves.find((item) => item.employeeId === employee.id),
      );
      const assumeOnTime = saved.actualHours === null || saved.actualHours >= effective.plannedHours;
      await syncWorkBalance(tx, employee.id, date, effective.plannedHours, saved.actualHours,
        effective.plannedStart, effective.plannedEnd, saved.checkIn ?? (assumeOnTime ? effective.plannedStart : null), saved.checkOut ?? (assumeOnTime ? effective.plannedEnd : null));
    }
    return true;
  });
  if (!savedRecords) {
    res.status(400).json({ error: "Kayıtlarda aktif olmayan veya bulunamayan personel var" });
    return;
  }
  res.json(SaveDailyWorkRecordsResponse.parse(await dailyWorkRecords(date)));
});

router.get("/departments", async (_req, res): Promise<void> => {
  const departments = await db
    .select({
      id: departmentsTable.id,
      name: departmentsTable.name,
      annualLeaveDays: departmentsTable.annualLeaveDays,
      employeeCount: sql<number>`count(${employeesTable.id})`,
    })
    .from(departmentsTable)
    .leftJoin(employeesTable, and(
      eq(employeesTable.department, departmentsTable.name), isNull(employeesTable.deletedAt),
    ))
    .groupBy(departmentsTable.id)
    .orderBy(asc(departmentsTable.name));
  res.json(ListDepartmentsResponse.parse(departments.map((item) => ({
    ...item,
    employeeCount: Number(item.employeeCount),
  }))));
});

router.post("/departments", requireManager, async (req, res): Promise<void> => {
  const body = CreateDepartmentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Departman adı gereklidir." });
    return;
  }
  const name = body.data.name.trim();
  if (await departmentExists(name)) {
    res.status(409).json({ error: "Bu departman zaten mevcut." });
    return;
  }
  const [department] = await db.insert(departmentsTable).values({ name, annualLeaveDays: body.data.annualLeaveDays ?? 14 }).returning();
  await db.insert(activitiesTable).values({
    type: "department",
    title: "Departman eklendi",
    description: `${name} departmanı eklendi.`,
    tone: "blue",
  });
  res.status(201).json(CreateDepartmentResponse.parse({ ...department, employeeCount: 0 }));
});

router.patch("/departments/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = RenameDepartmentParams.safeParse(req.params);
  const body = RenameDepartmentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Geçersiz departman bilgisi." });
    return;
  }
  const name = body.data.name.trim();
  const [current] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Departman bulunamadı." });
    return;
  }
  const [duplicate] = await db.select({ id: departmentsTable.id }).from(departmentsTable)
    .where(and(sql`lower(${departmentsTable.name}) = lower(${name})`, sql`${departmentsTable.id} <> ${current.id}`))
    .limit(1);
  if (duplicate) {
    res.status(409).json({ error: "Bu departman adı zaten kullanılıyor." });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    if (body.data.annualLeaveDays !== undefined && body.data.annualLeaveDays !== current.annualLeaveDays) {
      const members = await tx.select().from(employeesTable)
        .where(and(eq(employeesTable.department, current.name), isNull(employeesTable.deletedAt))).for("update");
      const leaves = await tx.select().from(leavesTable);
      for (const member of members) {
        if (member.annualLeaveDaysOverride !== null || member.annualLeaveDays !== 14) continue;
        const error = annualQuotaError(member, body.data.annualLeaveDays, leaves.filter((leave) => leave.employeeId === member.id));
        if (error) return { error };
      }
    }
    await tx.update(employeesTable).set({ department: name }).where(and(
      eq(employeesTable.department, current.name), isNull(employeesTable.deletedAt),
    ));
    await tx.update(departmentSchedulesTable).set({ department: name }).where(eq(departmentSchedulesTable.department, current.name));
    await tx.update(specialPeriodsTable).set({ department: name }).where(eq(specialPeriodsTable.department, current.name));
    const [result] = await tx.update(departmentsTable).set({ name, annualLeaveDays: body.data.annualLeaveDays ?? current.annualLeaveDays, updatedAt: new Date() })
      .where(eq(departmentsTable.id, current.id)).returning();
    await tx.insert(activitiesTable).values({
      type: "department",
      title: "Departman adı değiştirildi",
      description: `${current.name} departmanının adı ${name} olarak değiştirildi.`,
      tone: "green",
    });
    return result;
  });
  if ("error" in updated) {
    res.status(400).json({ error: updated.error });
    return;
  }
  const [count] = await db.select({ value: sql<number>`count(*)` }).from(employeesTable).where(and(
    eq(employeesTable.department, name), isNull(employeesTable.deletedAt),
  ));
  res.json(RenameDepartmentResponse.parse({ ...updated, employeeCount: Number(count.value) }));
});

router.delete("/departments/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = DeleteDepartmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz departman." });
    return;
  }
  const [department] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, params.data.id));
  if (!department) {
    res.status(404).json({ error: "Departman bulunamadı." });
    return;
  }
  const [count] = await db.select({ value: sql<number>`count(*)` }).from(employeesTable)
    .where(eq(employeesTable.department, department.name));
  if (Number(count.value) > 0) {
    res.status(409).json({ error: "Personeli bulunan departman silinemez. Önce personelleri başka departmana taşıyın." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(specialPeriodsTable).where(eq(specialPeriodsTable.department, department.name));
    await tx.delete(departmentSchedulesTable).where(eq(departmentSchedulesTable.department, department.name));
    await tx.delete(departmentsTable).where(eq(departmentsTable.id, department.id));
    await tx.insert(activitiesTable).values({
      type: "department",
      title: "Departman silindi",
      description: `${department.name} departmanı silindi.`,
      tone: "orange",
    });
  });
  res.status(204).send();
});

router.get("/department-schedules", async (_req, res): Promise<void> => {
  const schedules = await db.select().from(departmentSchedulesTable).orderBy(asc(departmentSchedulesTable.department));
  res.json(ListDepartmentSchedulesResponse.parse(schedules.map(scheduleView)));
});

router.post("/department-schedules", requireWorkforceEditor, async (req, res): Promise<void> => {
  const parsed = SaveDepartmentScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!await departmentExists(parsed.data.department)) {
    res.status(400).json({ error: "Geçerli bir departman seçiniz." });
    return;
  }
  const days = parsed.data.days as ScheduleDayRecord[];
  const [schedule] = await db
    .insert(departmentSchedulesTable)
    .values({ department: parsed.data.department.trim(), days })
    .onConflictDoUpdate({
      target: departmentSchedulesTable.department,
      set: { days, updatedAt: new Date() },
    })
    .returning();
  await db.insert(activitiesTable).values({
    type: "plan",
    title: "Sabit plan güncellendi",
    description: `${schedule.department} departmanının sabit çalışma planı güncellendi.`,
    tone: "green",
  });
  res.json(SaveDepartmentScheduleResponse.parse(scheduleView(schedule)));
});

router.get("/special-periods", async (_req, res): Promise<void> => {
  const periods = await db.select().from(specialPeriodsTable).orderBy(desc(specialPeriodsTable.startDate));
  res.json(ListSpecialPeriodsResponse.parse(periods.map(scheduleView)));
});

router.post("/special-periods", requireWorkforceEditor, async (req, res): Promise<void> => {
  const parsed = CreateSpecialPeriodBody.safeParse(req.body);
  if (!parsed.success || isoDate(parsed.data.startDate) > isoDate(parsed.data.endDate)) {
    res.status(400).json({ error: "Geçersiz özel dönem bilgisi" });
    return;
  }
  if (!await departmentExists(parsed.data.department)) {
    res.status(400).json({ error: "Geçerli bir departman seçiniz." });
    return;
  }
  const [period] = await db
    .insert(specialPeriodsTable)
    .values({
      department: parsed.data.department.trim(),
      name: parsed.data.name.trim(),
      startDate: isoDate(parsed.data.startDate),
      endDate: isoDate(parsed.data.endDate),
      days: parsed.data.days as ScheduleDayRecord[],
    })
    .returning();
  await db.insert(activitiesTable).values({
    type: "plan",
    title: "Özel dönem eklendi",
    description: `${period.department} için ${period.name} özel dönemi eklendi.`,
    tone: "orange",
  });
  res.status(201).json(CreateSpecialPeriodResponse.parse(scheduleView(period)));
});

router.delete("/special-periods/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = DeleteSpecialPeriodParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz özel dönem" });
    return;
  }
  const [period] = await db.delete(specialPeriodsTable).where(eq(specialPeriodsTable.id, params.data.id)).returning();
  if (!period) {
    res.status(404).json({ error: "Özel dönem bulunamadı" });
    return;
  }
  res.sendStatus(204);
});

router.get("/leaves", async (req, res): Promise<void> => {
  const parsed = ListLeavesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  if (parsed.data.status && parsed.data.status !== "all") conditions.push(eq(leavesTable.status, parsed.data.status));
  if (parsed.data.employeeId) conditions.push(eq(leavesTable.employeeId, parsed.data.employeeId));
  if (parsed.data.month) {
    const start = `${parsed.data.month}-01`;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    conditions.push(and(gte(leavesTable.endDate, start), lte(leavesTable.startDate, end.toISOString().slice(0, 10)))!);
  }
  const rows = await db
    .select({ leave: leavesTable, employee: employeesTable })
    .from(leavesTable)
    .innerJoin(employeesTable, eq(leavesTable.employeeId, employeesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(leavesTable.startDate));
  const employeeById = new Map(rows.map(({ employee }) => [employee.id, employee]));
  const [bookingRows, departments] = rows.length
    ? await Promise.all([
      db.select().from(leavesTable).where(and(
        inArray(leavesTable.employeeId, [...employeeById.keys()]),
        eq(leavesTable.type, "annual"),
        eq(leavesTable.settlementType, "full"),
      )),
      db.select().from(departmentsTable),
    ])
    : [[], []];
  const bookingsByEmployee = new Map<number, typeof bookingRows>();
  for (const booking of bookingRows) {
    const items = bookingsByEmployee.get(booking.employeeId) ?? [];
    items.push(booking);
    bookingsByEmployee.set(booking.employeeId, items);
  }
  const departmentQuotas = new Map(departments.map(({ name, annualLeaveDays }) => [name, annualLeaveDays]));
  const attachmentRows = rows.length
    ? await db.select().from(leaveAttachmentsTable)
      .where(inArray(leaveAttachmentsTable.leaveId, rows.map(({ leave }) => leave.id)))
    : [];
  const attachmentsByLeave = new Map<number, typeof attachmentRows>();
  for (const attachment of attachmentRows) {
    const items = attachmentsByLeave.get(attachment.leaveId) ?? [];
    items.push(attachment);
    attachmentsByLeave.set(attachment.leaveId, items);
  }
  res.json(ListLeavesResponse.parse(rows.map(({ leave, employee }) => ({
    ...leave,
    recordedAt: leave.recordedAt?.toISOString() ?? null,
    employeeName: employee.name,
    deductedAnnualHours: deductedAnnualHours(leave),
    annualHourBreakdown: annualHourEntries(leave),
    annualCycleBalances: leave.type === "annual" && leave.settlementType === "full"
      ? annualCycleBalances(
        employee.hireDate,
        effectiveAnnualQuota(employee, departmentQuotas.get(employee.department)),
        bookingsByEmployee.get(employee.id) ?? [],
        leave.startDate,
        leave.endDate,
      ) : [],
    reviewedAt: leave.reviewedAt?.toISOString() ?? null,
    attachments: (attachmentsByLeave.get(leave.id) ?? []).map(({ id, name, size, contentType }) => ({
      id, name, size, contentType,
    })),
  }))));
});

router.post("/leaves", requireWorkforceEditor, async (req, res): Promise<void> => {
  const parsed = CreateLeaveBody.safeParse(req.body);
  const from = parseIsoDateParam(req.body?.startDate);
  const to = parseIsoDateParam(req.body?.endDate);
  if (!parsed.success || !from || !to || to < from || (to.getTime() - from.getTime()) / 86_400_000 > 365) {
    res.status(400).json({ error: "Geçersiz izin bilgisi" });
    return;
  }
  const note = parsed.data.note.trim();
  if (!note || note.length > 1000) {
    res.status(400).json({ error: "İzin talebi için 1-1000 karakter arasında açıklama yazılmalıdır." });
    return;
  }
  const attachments = parsed.data.attachments ?? [];
  const objectPaths = attachments.map(({ objectPath }) => objectPath);
  if (new Set(objectPaths).size !== objectPaths.length) {
    res.status(400).json({ error: "Aynı dosya birden fazla kez eklenemez." });
    return;
  }
  try {
    for (const attachment of attachments) {
      const valid = await validateUploadedLeaveAttachment(
        attachment.objectPath,
        attachment.name,
        attachment.size,
        attachment.contentType,
      );
      if (!valid) {
        res.status(400).json({ error: "Bir veya daha fazla ek dosya bulunamadı veya dosya bilgileri eşleşmiyor." });
        return;
      }
    }
  } catch (error) {
    req.log.error({ err: error }, "Failed to validate leave attachments");
    res.status(400).json({ error: "Ek dosya bilgileri geçersiz." });
    return;
  }
  if (objectPaths.length) {
    const alreadyAttached = await db.select({ id: leaveAttachmentsTable.id }).from(leaveAttachmentsTable)
      .where(inArray(leaveAttachmentsTable.objectPath, objectPaths)).limit(1);
    if (alreadyAttached.length) {
      res.status(400).json({ error: "Bir veya daha fazla ek dosya daha önce kullanılmış." });
      return;
    }
  }
  const startDate = isoDate(parsed.data.startDate);
  const endDate = isoDate(parsed.data.endDate);
  const today = todayInIstanbul();
  const retrospective = parsed.data.isRetrospective;
  const retrospectiveError = retrospective ? retrospectiveDateError(startDate, endDate, today) : null;
  if (retrospectiveError) {
    res.status(400).json({ error: retrospectiveError });
    return;
  }
  const recordedAt = new Date();
  const result = await db.transaction(async (tx) => {
    // All leave creations/reviews take this lock before row locks. Different
    // employees can otherwise approve a third leave concurrently.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261006, 2)`);
    const [employee] = await tx.select().from(employeesTable)
      .where(eq(employeesTable.id, parsed.data.employeeId)).for("update");
    if (!employee) return { error: "Çalışan bulunamadı", status: 404 } as const;
    if (employee.deletedAt !== null) return { error: "Arşivlenmiş çalışan için yeni izin oluşturulamaz", status: 404 } as const;
    if (parsed.data.type === "annual") {
      const approved = await tx.select().from(leavesTable).where(and(
        eq(leavesTable.type, "annual"), eq(leavesTable.status, "approved"),
        lte(leavesTable.startDate, endDate), gte(leavesTable.endDate, startDate),
      ));
      const conflict = annualCapacityConflict(approved, startDate, endDate, employee.id);
      if (conflict) return { error: annualCapacityMessage(conflict), status: 400 } as const;
    }
    if (retrospective) {
      if (!employee.hireDate) {
        return { error: "Geçmiş izin eklemeden önce personelin işe giriş tarihini kaydedin.", status: 400 } as const;
      }
      if (startDate < employee.hireDate) {
        return { error: "Geçmiş izin işe giriş tarihinden önce başlayamaz.", status: 400 } as const;
      }
      const booked = await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, employee.id));
      if (hasBookedOverlap(booked, startDate, endDate)) {
        return { error: "Bu personelin seçilen tarihlerde bekleyen veya onaylanmış izni var. Aynı izin yeniden eklenemez.", status: 400 } as const;
      }
    }
    const [schedule] = await tx.select().from(departmentSchedulesTable)
      .where(eq(departmentSchedulesTable.department, employee.department));
    const periods = await tx.select().from(specialPeriodsTable).where(and(
      eq(specialPeriodsTable.department, employee.department),
      lte(specialPeriodsTable.startDate, endDate),
      gte(specialPeriodsTable.endDate, startDate),
    ));
    const snapshot = buildAnnualHourSnapshot(employee, startDate, endDate, schedule, periods);
    const annualFull = parsed.data.type === "annual" && parsed.data.settlementType === "full";
    let quota = 14;
    if (parsed.data.type === "annual" && parsed.data.settlementType === "full") {
      const [department] = await tx.select().from(departmentsTable)
        .where(eq(departmentsTable.name, employee.department));
      quota = effectiveAnnualQuota(employee, department?.annualLeaveDays);
      const existing = await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, employee.id));
      const error = annualBookingError(employee, quota,
        existing, startDate, endDate, undefined, snapshot);
      if (error) return { error, status: 400 } as const;
    }
    const [leave] = await tx.insert(leavesTable).values({
      employeeId: parsed.data.employeeId,
      type: parsed.data.type,
      settlementType: parsed.data.settlementType,
      startDate,
      endDate,
      note,
      isLateEntry: startDate < today,
      recordedAt,
      recordedByName: res.locals.user.displayName,
      status: retrospective ? "approved" : "pending",
      reviewedByUserId: retrospective ? res.locals.user.id : null,
      reviewedByName: retrospective ? res.locals.user.displayName : null,
      reviewedAt: retrospective ? recordedAt : null,
      days: annualFull
        ? snapshot.reduce((sum, item) => sum + item.hours, 0) / HOURS_PER_ENTITLEMENT_DAY
        : leaveDays(startDate, endDate),
      annualHourSnapshot: snapshot,
    }).returning();
    if (retrospective && annualFull) {
      await tx.update(employeesTable).set({
        usedLeaveDays: sql`${employeesTable.usedLeaveDays} + ${deductedAnnualHours(leave) / HOURS_PER_ENTITLEMENT_DAY}`,
      }).where(eq(employeesTable.id, employee.id));
    }
    const savedAttachments = attachments.length
      ? await tx.insert(leaveAttachmentsTable).values(attachments.map((attachment) => ({
        leaveId: leave.id,
        objectPath: attachment.objectPath,
        name: attachment.name.trim(),
        size: attachment.size,
        contentType: attachment.contentType,
      }))).returning()
      : [];
    await tx.insert(activitiesTable).values({
      type: "leave",
      title: retrospective ? "Geçmiş izin sonradan eklendi" : "Yeni izin talebi",
      description: retrospective
        ? `${employee.name} için ${startDate} – ${endDate} tarihli ${leave.days} günlük kullanılmış izin ${res.locals.user.displayName} tarafından sonradan eklendi.`
        : `${employee.name} için ${leave.days} günlük izin talebi oluşturuldu.`,
      tone: retrospective ? "green" : "amber",
    });
    const annualBookings = annualFull
      ? await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, employee.id))
      : [];
    return {
      leave,
      employeeName: employee.name,
      employeeHireDate: employee.hireDate,
      annualCycleBalances: annualFull
        ? annualCycleBalances(employee.hireDate, quota, annualBookings, startDate, endDate) : [],
      attachments: savedAttachments,
    };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.status(201).json(CreateLeaveResponse.parse({
    ...result.leave,
    recordedAt: result.leave.recordedAt?.toISOString() ?? null,
    employeeName: result.employeeName,
    deductedAnnualHours: deductedAnnualHours(result.leave),
    annualHourBreakdown: annualHourEntries(result.leave),
    annualCycleBalances: result.annualCycleBalances,
    reviewedAt: result.leave.reviewedAt?.toISOString() ?? null,
    attachments: result.attachments.map(({ id, name, size, contentType }) => ({ id, name, size, contentType })),
  }));
});

router.patch("/leaves/:id/status", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = UpdateLeaveStatusParams.safeParse(req.params);
  const body = UpdateLeaveStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Geçersiz izin bilgisi" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261006, 2)`);
    const [previous] = await tx.select().from(leavesTable)
      .where(eq(leavesTable.id, params.data.id)).for("update");
    if (!previous) return null;
    const [reviewEmployee] = await tx.select().from(employeesTable)
      .where(eq(employeesTable.id, previous.employeeId)).for("update");
    if (!reviewEmployee || reviewEmployee.deletedAt !== null) {
      return { error: "Arşivlenmiş çalışanın izin kaydı güncellenemez", status: 404 } as const;
    }
    if (previous.status === body.data.status) {
      const employee = reviewEmployee;
      const annualFull = previous.type === "annual" && previous.settlementType === "full";
      const [department] = annualFull
        ? await tx.select().from(departmentsTable).where(eq(departmentsTable.name, employee.department))
        : [];
      const bookings = annualFull
        ? await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, employee.id))
        : [];
      return {
        leave: previous,
        employeeName: employee.name,
        employeeHireDate: employee.hireDate,
        annualCycleBalances: annualFull
          ? annualCycleBalances(
            employee.hireDate, effectiveAnnualQuota(employee, department?.annualLeaveDays),
            bookings, previous.startDate, previous.endDate,
          ) : [],
      };
    }
    const [lockedEmployee] = await tx.select().from(employeesTable)
      .where(eq(employeesTable.id, previous.employeeId)).for("update");
    if (previous.type === "annual" && body.data.status === "approved") {
      const approved = await tx.select().from(leavesTable).where(and(
        eq(leavesTable.type, "annual"), eq(leavesTable.status, "approved"),
        lte(leavesTable.startDate, previous.endDate), gte(leavesTable.endDate, previous.startDate),
      ));
      const conflict = annualCapacityConflict(approved, previous.startDate, previous.endDate, previous.employeeId, previous.id);
      if (conflict) return { error: annualCapacityMessage(conflict), status: 400 } as const;
    }
    const annualFull = previous.type === "annual" && previous.settlementType === "full";
    let quota = 14;
    if (annualFull) {
      const [department] = await tx.select().from(departmentsTable)
        .where(eq(departmentsTable.name, lockedEmployee.department));
      quota = effectiveAnnualQuota(lockedEmployee, department?.annualLeaveDays);
      if (body.data.status !== "rejected") {
        const booked = await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, previous.employeeId));
        const error = annualBookingError(lockedEmployee, quota,
          booked, isoDate(previous.startDate), isoDate(previous.endDate), previous.id, previous.annualHourSnapshot ?? undefined);
        if (error) return { error, status: 400 } as const;
      }
    }
    const [leave] = await tx.update(leavesTable).set({
      status: body.data.status,
      reviewedByUserId: body.data.status === "pending" ? null : res.locals.user.id,
      reviewedByName: body.data.status === "pending" ? null : res.locals.user.displayName,
      reviewedAt: body.data.status === "pending" ? null : new Date(),
    }).where(eq(leavesTable.id, params.data.id)).returning();
    const deductedDays = deductedAnnualHours(leave) / HOURS_PER_ENTITLEMENT_DAY;
    const delta =
      leave.type === "annual" && leave.settlementType === "full" && previous.status !== "approved" && leave.status === "approved"
        ? deductedDays
        : leave.type === "annual" && leave.settlementType === "full" && previous.status === "approved" && leave.status !== "approved"
          ? -deductedDays
          : 0;
    if (delta !== 0) {
      await tx.update(employeesTable)
        .set({ usedLeaveDays: sql`GREATEST(0, ${employeesTable.usedLeaveDays} + ${delta})` })
        .where(eq(employeesTable.id, leave.employeeId));
    }
    const [employee] = await tx.select({ name: employeesTable.name }).from(employeesTable)
      .where(eq(employeesTable.id, leave.employeeId));
    await tx.insert(activitiesTable).values({
      type: "leave",
      title: leave.status === "approved" ? "İzin onaylandı" : leave.status === "rejected" ? "İzin reddedildi" : "İzin beklemeye alındı",
      description: `${employee.name} için izin durumu ${res.locals.user.displayName} tarafından güncellendi.`,
      tone: leave.status === "approved" ? "green" : leave.status === "rejected" ? "red" : "amber",
    });
    const annualBookings = annualFull
      ? await tx.select().from(leavesTable).where(eq(leavesTable.employeeId, leave.employeeId))
      : [];
    return {
      leave,
      employeeName: employee.name,
      employeeHireDate: lockedEmployee.hireDate,
      annualCycleBalances: annualFull
        ? annualCycleBalances(lockedEmployee.hireDate, quota, annualBookings, leave.startDate, leave.endDate) : [],
    };
  });
  if (!result) {
    res.status(404).json({ error: "İzin kaydı bulunamadı" });
    return;
  }
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(UpdateLeaveStatusResponse.parse({
    ...result.leave,
    recordedAt: result.leave.recordedAt?.toISOString() ?? null,
    employeeName: result.employeeName,
    deductedAnnualHours: deductedAnnualHours(result.leave),
    annualHourBreakdown: annualHourEntries(result.leave),
    annualCycleBalances: result.annualCycleBalances,
    reviewedAt: result.leave.reviewedAt?.toISOString() ?? null,
    attachments: (await db.select({
      id: leaveAttachmentsTable.id,
      name: leaveAttachmentsTable.name,
      size: leaveAttachmentsTable.size,
      contentType: leaveAttachmentsTable.contentType,
    }).from(leaveAttachmentsTable).where(eq(leaveAttachmentsTable.leaveId, result.leave.id))),
  }));
});

router.get("/leaves/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  const params = DownloadLeaveAttachmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz ek dosya bilgisi" });
    return;
  }
  try {
    const [attachment] = await db.select().from(leaveAttachmentsTable).where(and(
      eq(leaveAttachmentsTable.id, params.data.attachmentId),
      eq(leaveAttachmentsTable.leaveId, params.data.id),
    ));
    if (!attachment) {
      res.status(404).json({ error: "İzin ek dosyası bulunamadı" });
      return;
    }
    const file = await getLeaveAttachmentFile(attachment.objectPath);
    if (!file) {
      res.status(404).json({ error: "İzin ek dosyası bulunamadı" });
      return;
    }
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isInteger(size) || size !== attachment.size
      || metadata.contentType !== attachment.contentType
      || typeof metadata.contentType !== "string"
      || !leaveAttachmentContentTypes.has(metadata.contentType)) {
      res.status(404).json({ error: "İzin ek dosyası kullanılamıyor" });
      return;
    }
    const filename = safeAttachmentFilename(attachment.name);
    res.setHeader("Content-Type", metadata.contentType);
    res.setHeader("Content-Length", String(size));
    res.setHeader("Content-Disposition", `attachment; filename="${filename.fallback}"; filename*=UTF-8''${filename.encoded}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const stream = file.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ err: error, leaveId: params.data.id, attachmentId: params.data.attachmentId }, "Failed to stream leave attachment");
      if (res.headersSent) res.destroy(error);
      else res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error, leaveId: params.data.id, attachmentId: params.data.attachmentId }, "Failed to serve leave attachment");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve leave attachment" });
    else res.destroy(error as Error);
  }
});

router.get("/activity", async (_req, res): Promise<void> => {
  const activities = await db.select().from(activitiesTable).orderBy(desc(activitiesTable.createdAt)).limit(12);
  res.json(ListActivityResponse.parse(activities.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))));
});

export default router;
