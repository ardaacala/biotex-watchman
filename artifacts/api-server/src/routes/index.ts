import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workforceRouter from "./workforce";
import authRouter from "./auth";
import membershipsRouter from "./memberships";
import adminUsersRouter from "./admin-users";
import overtimeRouter from "./overtime";
import storageRouter from "./storage";
import calendarEventsRouter from "./calendar-events";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(membershipsRouter);
router.use(adminUsersRouter);
router.use(overtimeRouter);
router.use(storageRouter);
router.use(calendarEventsRouter);
router.use(workforceRouter);

export default router;
