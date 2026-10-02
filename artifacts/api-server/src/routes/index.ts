import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workforceRouter from "./workforce";
import authRouter from "./auth";
import membershipsRouter from "./memberships";
import overtimeRouter from "./overtime";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(membershipsRouter);
router.use(overtimeRouter);
router.use(storageRouter);
router.use(workforceRouter);

export default router;
