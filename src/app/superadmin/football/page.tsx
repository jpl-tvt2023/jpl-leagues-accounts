import { Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SuperadminDashboard } from "../SuperadminDashboard";

/** Superadmin → Football: FPL leagues, gameweek operations, PL standings and score adjustments. */
export default function SuperadminFootballPage() {
  return (
    <Suspense fallback={<LoadingScreen variant="admin" fullScreen />}>
      <SuperadminDashboard dashboard="football" />
    </Suspense>
  );
}
