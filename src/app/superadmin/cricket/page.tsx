import { Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SuperadminDashboard } from "../SuperadminDashboard";

/** Superadmin → Cricket: cricket leagues and the tournament data they play on. */
export default function SuperadminCricketPage() {
  return (
    <Suspense fallback={<LoadingScreen variant="cricket" bgClass="bg-gradient-to-b from-slate-900 via-green-900/40 to-slate-900" />}>
      <SuperadminDashboard dashboard="cricket" />
    </Suspense>
  );
}
