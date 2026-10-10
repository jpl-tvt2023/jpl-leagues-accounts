import { sanitizeNext } from "@/lib/safe-next";
import { OnboardingClient } from "./OnboardingClient";

/** /onboarding — first sign-in: pick a username (and optionally your FPL ID), then carry on to `next`. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).next;
  return <OnboardingClient next={sanitizeNext(Array.isArray(raw) ? raw[0] : raw)} />;
}
