import { Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SuperadminDashboard } from "./SuperadminDashboard";

/** Superadmin → General: admins, every JPL member, and feedback, across sports. */
export default function SuperadminGeneralPage() {
  return (
    <Suspense fallback={<LoadingScreen variant="admin" fullScreen />}>
      <SuperadminDashboard dashboard="general" />
    </Suspense>
  );
}
