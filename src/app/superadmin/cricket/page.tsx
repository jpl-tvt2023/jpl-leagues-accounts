import { Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SuperadminDashboard } from "../SuperadminDashboard";

/** Superadmin → Cricket: cricket leagues and the tournament data they play on. */
export default function SuperadminCricketPage() {
  return (
    <Suspense fallback={<LoadingScreen variant="admin" fullScreen />}>
      <SuperadminDashboard dashboard="cricket" />
    </Suspense>
  );
}
