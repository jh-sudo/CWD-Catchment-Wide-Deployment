import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deploymentsRouter from "./deployments";
import managerRouter from "./manager";
import crewRouter from "./crew";
import authRouter from "./auth";
import pushRouter from "./push";
import wlsRouter from "./wls";
import crmsRouter from "./crms";
import { rosterPlanRouter } from "./rosterPlan";
import { leaveRequestRouter } from "./leaveRequests";
import { phRosterRouter } from "./phRoster";
import { inspectionsRouter } from "./inspections";
import { lightningRouter, lightningPublicRouter } from "./lightning";
import { getSingaporeTide } from "../tide";

const router: IRouter = Router();

router.use(healthRouter);
router.use(deploymentsRouter);
router.use(pushRouter);
router.use(wlsRouter);
router.use(crmsRouter);
router.use(rosterPlanRouter);
router.use(leaveRequestRouter);
router.use(phRosterRouter);
router.use(inspectionsRouter);
router.use(lightningRouter);

router.get("/tide", async (_req, res) => {
  try {
    res.json(await getSingaporeTide());
  } catch (e) {
    res.status(500).json({ error: "Tide data unavailable" });
  }
});

export default router;

// Manager dashboard served at /manager, crew dashboard at /crew (outside /api prefix)
export { managerRouter, crewRouter, authRouter, lightningPublicRouter };
export { deploymentsReady } from "./deployments";
