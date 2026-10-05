import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db, departmentsTable, departmentSchedulesTable, employeesTable, leavesTable, overtimeParticipantsTable, overtimeSessionsTable,
  specialPeriodsTable, workDayBalancesTable,
} from "@workspace/db";
import {
  CreateOvertimeBody, CreateOvertimeResponse, DeleteOvertimeParams, ListOvertimeResponse,
  ListWorkDebtsResponse, SaveOvertimeHoursBody, SaveOvertimeHoursParams, SaveOvertimeHoursResponse,
} from "@workspace/api-zod";
import { requireWorkforceEditor } from "../lib/auth";

const router: IRouter = Router();

function dateString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && dateString(parsed) === value;
}

function monday(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const offset = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - offset);
  return dateString(parsed);
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function sessions() {
  const [items, participants] = await Promise.all([
    db.select().from(overtimeSessionsTable).orderBy(desc(overtimeSessionsTable.workDate), desc(overtimeSessionsTable.id)),
    db.select({
      sessionId: overtimeParticipantsTable.sessionId,
      employeeId: employeesTable.id,
      employeeName: employeesTable.name,
      employeeNumber: employeesTable.employeeNumber,
      actualHours: overtimeParticipantsTable.actualHours,
    }).from(overtimeParticipantsTable)
      .innerJoin(employeesTable, eq(overtimeParticipantsTable.employeeId, employeesTable.id))
      .orderBy(asc(employeesTable.name)),
  ]);
  const bySession = new Map<number, typeof participants>();
  for (const person of participants) {
    const list = bySession.get(person.sessionId) ?? [];
    list.push(person);
    bySession.set(person.sessionId, list);
  }
  return items.map((item) => ({
    ...item,
    departments: item.departments.length ? item.departments : item.department ? [item.department] : [],
    scope: item.scope as "department" | "individual" | "combined",
    participants: (bySession.get(item.id) ?? []).map(({ sessionId: _, ...person }) => person),
  }));
}

router.get("/overtime", async (_req, res): Promise<void> => {
  res.json(ListOvertimeResponse.parse(await sessions()));
});

router.post("/overtime", requireWorkforceEditor, async (req, res): Promise<void> => {
  const parsed = CreateOvertimeBody.safeParse(req.body);
  if (!parsed.success || !validDate(req.body?.workDate)) {
    res.status(400).json({ error: "Geçersiz ek mesai bilgisi" });
    return;
  }
  const body = parsed.data;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(body.plannedStart) || !time.test(body.plannedEnd)) {
    res.status(400).json({ error: "Saatler SS:DD biçiminde olmalı" });
    return;
  }
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  let minutes = toMinutes(body.plannedEnd) - toMinutes(body.plannedStart);
  if (minutes < 0) minutes += 1440;
  if (minutes <= 0 || minutes > 960) {
    res.status(400).json({ error: "Ek mesai süresi 0 ile 16 saat arasında olmalı" });
    return;
  }
  if (body.scope === "department" && (!body.department?.trim() || body.employeeIds?.length)) {
    res.status(400).json({ error: "Departman seçin" });
    return;
  }
  if (body.scope === "individual" && (!body.employeeIds?.length || body.department)) {
    res.status(400).json({ error: "En az bir personel seçin" });
    return;
  }
  const requestedDepartments = (body.departments ?? []).map((department) => department.trim());
  if (body.scope === "combined" && (
    body.department !== undefined
    || requestedDepartments.some((department) => !department)
  )) {
    res.status(400).json({ error: "Departman ve personel seçimlerini kontrol edin" });
    return;
  }
  const selectedDepartments = [...new Set(requestedDepartments)];
  if (body.scope === "combined" && selectedDepartments.length) {
    const departments = await db.select({ name: departmentsTable.name }).from(departmentsTable);
    const existingDepartments = new Set(departments.map(({ name }) => name));
    if (selectedDepartments.some((department) => !existingDepartments.has(department))) {
      res.status(400).json({ error: "Seçilen departmanlardan biri geçersiz" });
      return;
    }
  }
  const all = await db.select().from(employeesTable).where(and(
    eq(employeesTable.status, "active"), isNull(employeesTable.deletedAt),
  ));
  const employeeIds = body.employeeIds ?? [];
  const activeById = new Map(all.map((employee) => [employee.id, employee]));
  let selected: typeof all;
  if (body.scope === "department") {
    selected = all.filter((employee) => employee.department === body.department);
  } else if (body.scope === "individual") {
    selected = all.filter((employee) => employeeIds.includes(employee.id));
  } else {
    const selectedIndividuals = [...new Set(employeeIds)].map((id) => activeById.get(id));
    if (selectedIndividuals.some((employee) => !employee)) {
      res.status(400).json({ error: "Personel seçimi geçersiz" });
      return;
    }
    const participantIds = new Set([
      ...all.filter((employee) => selectedDepartments.includes(employee.department)).map((employee) => employee.id),
      ...selectedIndividuals.map((employee) => employee!.id),
    ]);
    selected = [...participantIds].map((id) => activeById.get(id)!);
  }
  if (!selected.length || (body.scope === "individual" && selected.length !== new Set(employeeIds).size)) {
    if (body.scope === "combined" && !selected.length) {
      res.status(400).json({ error: "En az bir aktif personel seçin" });
      return;
    }
    res.status(400).json({ error: "Seçilen departmanda aktif personel yok veya personel seçimi geçersiz" });
    return;
  }
  const createdId = await db.transaction(async (tx) => {
    const lockedEmployees = await tx.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(
        inArray(employeesTable.id, selected.map((employee) => employee.id)),
        eq(employeesTable.status, "active"),
        isNull(employeesTable.deletedAt),
      ))
      .orderBy(asc(employeesTable.id))
      .for("update");
    if (lockedEmployees.length !== selected.length) return null;
    const [session] = await tx.insert(overtimeSessionsTable).values({
      workDate: dateString(body.workDate),
      scope: body.scope,
      department: body.scope === "department" ? body.department!.trim() : null,
      departments: body.scope === "combined" ? selectedDepartments : body.scope === "department" ? [body.department!.trim()] : [],
      plannedStart: body.plannedStart,
      plannedEnd: body.plannedEnd,
      plannedHours: round(minutes / 60),
      note: body.note?.trim() ?? "",
      createdByName: res.locals.user.displayName,
    }).returning();
    await tx.insert(overtimeParticipantsTable).values(
      selected.map((employee) => ({ sessionId: session.id, employeeId: employee.id })),
    );
    return session.id;
  });
  if (createdId === null) {
    res.status(400).json({ error: "Personel listesi değişti; yeniden deneyin." });
    return;
  }
  const created = (await sessions()).find((item) => item.id === createdId)!;
  res.status(201).json(CreateOvertimeResponse.parse(created));
});

router.patch("/overtime/:id/participants/:employeeId", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = SaveOvertimeHoursParams.safeParse(req.params);
  const body = SaveOvertimeHoursBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.actualHours !== null && !Number.isFinite(body.data.actualHours))) {
    res.status(400).json({ error: "Geçersiz gerçekleşen ek mesai süresi" });
    return;
  }
  const [session] = await db.select().from(overtimeSessionsTable).where(eq(overtimeSessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Ek mesai bulunamadı" });
    return;
  }
  const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(
    eq(employeesTable.id, params.data.employeeId),
    isNull(employeesTable.deletedAt),
  ));
  if (!employee) {
    res.status(404).json({ error: "Arşivlenmiş veya bulunamayan çalışan için ek mesai güncellenemez" });
    return;
  }
  const [updated] = await db.update(overtimeParticipantsTable)
    .set({ actualHours: body.data.actualHours, updatedAt: new Date() })
    .where(and(
      eq(overtimeParticipantsTable.sessionId, params.data.id),
      eq(overtimeParticipantsTable.employeeId, params.data.employeeId),
    )).returning();
  if (!updated) {
    res.status(404).json({ error: "Ek mesai personeli bulunamadı" });
    return;
  }
  const current = (await sessions()).find((item) => item.id === params.data.id)!;
  res.json(SaveOvertimeHoursResponse.parse(current));
});

router.delete("/overtime/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = DeleteOvertimeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz ek mesai" });
    return;
  }
  const [deleted] = await db.delete(overtimeSessionsTable).where(eq(overtimeSessionsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Ek mesai bulunamadı" });
    return;
  }
  res.status(204).end();
});

router.get("/work-debts", async (_req, res): Promise<void> => {
  const [balances, leaves, credits, employees, schedules, periods] = await Promise.all([
    db.select({
      employeeId: workDayBalancesTable.employeeId,
      employeeName: employeesTable.name,
      department: employeesTable.department,
      photoPath: employeesTable.photoPath,
      workDate: workDayBalancesTable.workDate,
      plannedHours: workDayBalancesTable.plannedHours,
      actualHours: workDayBalancesTable.actualHours,
      plannedStart: workDayBalancesTable.plannedStart,
      plannedEnd: workDayBalancesTable.plannedEnd,
      checkIn: workDayBalancesTable.checkIn,
      checkOut: workDayBalancesTable.checkOut,
      missingHours: workDayBalancesTable.missingHours,
      extraHours: workDayBalancesTable.extraHours,
    }).from(workDayBalancesTable)
      .innerJoin(employeesTable, eq(workDayBalancesTable.employeeId, employeesTable.id))
      .orderBy(asc(workDayBalancesTable.workDate), asc(workDayBalancesTable.id)),
    db.select().from(leavesTable),
    db.select({
      employeeId: overtimeParticipantsTable.employeeId,
      workDate: overtimeSessionsTable.workDate,
      actualHours: overtimeParticipantsTable.actualHours,
      sessionId: overtimeSessionsTable.id,
    }).from(overtimeParticipantsTable)
      .innerJoin(overtimeSessionsTable, eq(overtimeParticipantsTable.sessionId, overtimeSessionsTable.id))
      .orderBy(asc(overtimeSessionsTable.workDate), asc(overtimeSessionsTable.id)),
    db.select().from(employeesTable),
    db.select().from(departmentSchedulesTable),
    db.select().from(specialPeriodsTable),
  ]);
  const leaveDates = leaves.map((leave) => ({
    ...leave,
    start: typeof leave.startDate === "string" ? leave.startDate : dateString(leave.startDate),
    end: typeof leave.endDate === "string" ? leave.endDate : dateString(leave.endDate),
  }));
  const fullApproved = leaveDates.filter((leave) => leave.settlementType === "full" && leave.status === "approved");
  const debtLeaves = leaveDates.filter((leave) => leave.settlementType === "debt" && leave.status !== "rejected");
  const covers = (leave: (typeof leaveDates)[number], employeeId: number, date: string) =>
    leave.employeeId === employeeId && leave.start <= date && leave.end >= date;
  const usable = balances.filter((item) =>
    !fullApproved.some((leave) => covers(leave, item.employeeId, item.workDate))
    && !debtLeaves.some((leave) => covers(leave, item.employeeId, item.workDate)),
  );
  type Day = {
    employeeId: number; employeeName: string; department: string; photoPath: string | null; workDate: string; weekStart: string;
    source: "attendance" | "debt_leave"; leaveStatus: "pending" | "approved" | null;
    plannedHours: number; actualHours: number; missingHours: number;
    plannedStart: string | null; plannedEnd: string | null; checkIn: string | null; checkOut: string | null;
    coveredByRegularHours: number; coveredByOvertimeHours: number; outstandingHours: number;
  };
  const days: Day[] = usable.filter((item) => item.missingHours > 0).map((item) => ({
    employeeId: item.employeeId, employeeName: item.employeeName, department: item.department, photoPath: item.photoPath,
    workDate: item.workDate, weekStart: monday(item.workDate), source: "attendance", leaveStatus: null,
    plannedHours: item.plannedHours, actualHours: item.actualHours, missingHours: item.missingHours,
    plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, checkIn: item.checkIn, checkOut: item.checkOut,
    coveredByRegularHours: 0, coveredByOvertimeHours: 0, outstandingHours: item.missingHours,
  }));
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const schedulesByDepartment = new Map(schedules.map((schedule) => [schedule.department, schedule]));
  const seen = new Set<string>();
  for (const leave of debtLeaves) {
    const employee = employeesById.get(leave.employeeId);
    if (!employee) continue;
    for (let cursor = new Date(`${leave.start}T00:00:00Z`); dateString(cursor) <= leave.end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const workDate = dateString(cursor);
      const key = `${employee.id}:${workDate}`;
      if (seen.has(key) || fullApproved.some((item) => covers(item, employee.id, workDate))) continue;
      const weekday = cursor.getUTCDay() || 7;
      const special = periods
        .filter((item) => item.department === employee.department && item.startDate <= workDate && item.endDate >= workDate)
        .sort((a, b) => b.id - a.id)[0];
      const schedule = schedulesByDepartment.get(employee.department);
      const plannedDay = (special?.days ?? schedule?.days ?? []).find((item) => item.weekday === weekday);
      const plannedHours = plannedDay?.hours ?? (!schedule && !special && weekday <= 5 ? employee.weeklyHours / 5 : 0);
      if (plannedHours <= 0) continue;
      seen.add(key);
      days.push({
        employeeId: employee.id, employeeName: employee.name, department: employee.department, photoPath: employee.photoPath,
        workDate, weekStart: monday(workDate), source: "debt_leave",
        leaveStatus: leave.status as "pending" | "approved",
        plannedHours, actualHours: 0, missingHours: plannedHours,
        plannedStart: plannedDay?.plannedStart ?? null, plannedEnd: plannedDay?.plannedEnd ?? null,
        checkIn: null, checkOut: null, coveredByRegularHours: 0, coveredByOvertimeHours: 0,
        outstandingHours: plannedHours,
      });
    }
  }
  days.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.employeeId - b.employeeId);
  const weekExtra = new Map<string, number>();
  for (const item of usable) {
    const key = `${item.employeeId}:${monday(item.workDate)}`;
    weekExtra.set(key, (weekExtra.get(key) ?? 0) + item.extraHours);
  }
  for (const day of days) {
    const key = `${day.employeeId}:${day.weekStart}`;
    const offset = Math.min(day.outstandingHours, weekExtra.get(key) ?? 0);
    day.coveredByRegularHours = round(offset);
    day.outstandingHours = round(day.outstandingHours - offset);
    weekExtra.set(key, round((weekExtra.get(key) ?? 0) - offset));
  }
  for (const credit of credits) {
    let remaining = credit.actualHours ?? 0;
    if (!Number.isFinite(remaining) || remaining <= 0) continue;
    for (const day of days) {
      if (day.employeeId !== credit.employeeId || day.weekStart > credit.workDate || day.outstandingHours <= 0) continue;
      const offset = Math.min(remaining, day.outstandingHours);
      day.coveredByOvertimeHours = round(day.coveredByOvertimeHours + offset);
      day.outstandingHours = round(day.outstandingHours - offset);
      remaining = round(remaining - offset);
      if (remaining <= 0) break;
    }
  }
  const employeeSummaries = new Map(employees.map((employee) => [employee.id, {
    employeeId: employee.id,
    totalCompletedOvertimeHours: 0,
    totalDebtHours: 0,
    outstandingDebtHours: 0,
  }]));
  for (const credit of credits) {
    const summary = employeeSummaries.get(credit.employeeId);
    if (summary && credit.actualHours !== null && Number.isFinite(credit.actualHours) && credit.actualHours > 0) {
      summary.totalCompletedOvertimeHours += credit.actualHours;
    }
  }
  for (const day of days) {
    const summary = employeeSummaries.get(day.employeeId);
    if (!summary) continue;
    summary.totalDebtHours += day.missingHours;
    summary.outstandingDebtHours += day.outstandingHours;
  }
  res.json(ListWorkDebtsResponse.parse({
    totalMissingHours: round(days.reduce((sum, day) => sum + day.missingHours, 0)),
    totalCoveredByRegularHours: round(days.reduce((sum, day) => sum + day.coveredByRegularHours, 0)),
    totalCoveredByOvertimeHours: round(days.reduce((sum, day) => sum + day.coveredByOvertimeHours, 0)),
    totalOutstandingHours: round(days.reduce((sum, day) => sum + day.outstandingHours, 0)),
    employeeSummaries: [...employeeSummaries.values()].map((summary) => ({
      employeeId: summary.employeeId,
      totalCompletedOvertimeHours: round(summary.totalCompletedOvertimeHours),
      totalDebtHours: round(summary.totalDebtHours),
      outstandingDebtHours: round(summary.outstandingDebtHours),
    })),
    days: days.reverse(),
  }));
});

export default router;