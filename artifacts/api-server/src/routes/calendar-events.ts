import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { calendarEventsTable, db } from "@workspace/db";
import {
  CreateCalendarEventBody, CreateCalendarEventResponse,
  DeleteCalendarEventParams, ListCalendarEventsResponse,
  UpdateCalendarEventParams, UpdateCalendarEventResponse,
} from "@workspace/api-zod";
import { requireWorkforceEditor } from "../lib/authorization";
import { calendarEventDateError } from "../lib/calendar-event-validation";

const router: IRouter = Router();

function parseEventInput(body: unknown) {
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const datesError = calendarEventDateError(raw.startDate, raw.endDate);
  if (datesError) return { error: datesError } as const;
  const parsed = CreateCalendarEventBody.safeParse({
    ...raw,
    title: typeof raw.title === "string" ? raw.title.trim() : raw.title,
    description: typeof raw.description === "string" ? raw.description.trim() : raw.description,
  });
  if (!parsed.success) return { error: "Etkinlik başlığı gerekli (en fazla 160 karakter); açıklama en fazla 2000 karakter olabilir." } as const;
  return {
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? "",
      startDate: parsed.data.startDate.toISOString().slice(0, 10),
      endDate: parsed.data.endDate.toISOString().slice(0, 10),
    },
  } as const;
}

router.get("/calendar-events", async (_req, res): Promise<void> => {
  const events = await db.select().from(calendarEventsTable)
    .orderBy(asc(calendarEventsTable.startDate), asc(calendarEventsTable.id));
  res.json(ListCalendarEventsResponse.parse(events));
});

router.post("/calendar-events", requireWorkforceEditor, async (req, res): Promise<void> => {
  const input = parseEventInput(req.body);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const [event] = await db.insert(calendarEventsTable).values({
    ...input.data,
    createdByName: res.locals.user.displayName,
  }).returning();
  res.status(201).json(CreateCalendarEventResponse.parse(event));
});

router.patch("/calendar-events/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = UpdateCalendarEventParams.safeParse(req.params);
  const input = parseEventInput(req.body);
  if (!params.success || params.data.id < 1) {
    res.status(400).json({ error: "Geçerli bir etkinlik seçin." });
    return;
  }
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const [event] = await db.update(calendarEventsTable)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(calendarEventsTable.id, params.data.id)).returning();
  if (!event) {
    res.status(404).json({ error: "Etkinlik bulunamadı." });
    return;
  }
  res.json(UpdateCalendarEventResponse.parse(event));
});

router.delete("/calendar-events/:id", requireWorkforceEditor, async (req, res): Promise<void> => {
  const params = DeleteCalendarEventParams.safeParse(req.params);
  if (!params.success || params.data.id < 1) {
    res.status(400).json({ error: "Geçerli bir etkinlik seçin." });
    return;
  }
  const deleted = await db.delete(calendarEventsTable)
    .where(eq(calendarEventsTable.id, params.data.id)).returning({ id: calendarEventsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Etkinlik bulunamadı." });
    return;
  }
  res.status(204).end();
});

export default router;
