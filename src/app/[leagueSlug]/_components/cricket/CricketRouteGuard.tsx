"use client";

import type { ReactNode } from "react";
import { redirect, usePathname } from "next/navigation";
import { cricketRedirectTarget } from "@/lib/sports/cricket/routes";

/**
 * Keeps a cricket league on its own pages. Rendered by the league layout for cricket leagues only:
 * any FPL page (which would otherwise fall back to TVT) redirects to its cricket counterpart before
 * it renders, so no FPL component mounts and no FPL API is called for a cricket league.
 */
export function CricketRouteGuard({ slug, children }: { slug: string; children: ReactNode }) {
  const pathname = usePathname();
  const target = cricketRedirectTarget(slug, pathname);
  if (target) redirect(target);
  return <>{children}</>;
}
