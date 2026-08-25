import { Router } from "express";
import { requireAdmin } from "./auth";
import {
  PRESET_LOCATIONS,
  CATCHMENT_LABELS,
  CATCHMENT_COLORS,
  LOCATION_CATCHMENT,
  FRA_COLOR,
  FRA_CLUSTERS,
  FLOOD_DOTS,
} from "../data/apaFraData";

const router = Router();

// GET /api/apa/fra-data — deployment points, flood-risk-area clusters, and
// flood dot coordinates for the apa (APA1 Operations FRA Map) frontend.
// requireAdmin, not requireManager — apa has no non-admin role (see
// LoginScreen's "Admin access required"), and this data was previously
// shipped unauthenticated in apa's static JS bundle regardless of the
// login screen. See
// .scratch/full-repo-review/issues/08-apa-data-exposed-in-public-bundle.md.
router.get("/apa/fra-data", requireAdmin, (_req, res) => {
  res.json({
    presetLocations: PRESET_LOCATIONS,
    catchmentLabels: CATCHMENT_LABELS,
    catchmentColors: CATCHMENT_COLORS,
    locationCatchment: LOCATION_CATCHMENT,
    fraColor: FRA_COLOR,
    fraClusters: FRA_CLUSTERS,
    floodDots: FLOOD_DOTS,
  });
});

export default router;
