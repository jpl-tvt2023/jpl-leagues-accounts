"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AppNav } from "@/components/AppNav";
import { PartnerInvitePanel, fetchTeamInfo, type TeamInfo } from "@/components/PartnerInvitePanel";

interface Slot {
  id: string;
  name: string;
  fplId: string;
}

/** What GET /api/team/setup returns (the fields this wizard uses). */
interface SetupInfo {
  currentName: string;
  needsSetup: boolean;
  role: "owner" | "member";
  leagueFormat: string;
  clubAuctionEnabled: boolean;
  memberCount: number;
  maxMembers: number;
  ownerName: string | null;
  mySlot: Slot | null;
  openSlots: Slot[];
  canAddSlot: boolean;
  defaults: { name: string; fplId: string } | null;
}

interface Errors {
  teamName?: string;
  name?: string;
  fplId?: string;
  global?: string;
}

type Step = "team" | "me" | "partner";

/** "new" = a fresh FPL slot rather than one of the team's unlinked ones. */
const NEW_SLOT = "new";

const INPUT = "w-full rounded-lg border border-white/20 bg-black/40 px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-400 focus:outline-none";

/**
 * Team setup at /[leagueSlug]/setup: each person sets up only their own part of the team.
 * - TVT / Continental owner: team name → your own name and FPL ID → invite your partner (or,
 *   for a partner who won't sign in, enter their details).
 * - TVT / Continental partner (joined with the team link, or added by an admin): your own name and
 *   FPL ID, taking over the slot the owner filled in for you if there is one.
 * - Auction: the name only.
 * Every API call names the league. There is no login ID to choose; the team key is internal.
 */
export function TeamSetup({ leagueSlug }: { leagueSlug: string }) {
  const router = useRouter();
  const withLeague = (url: string) => `${url}${url.includes("?") ? "&" : "?"}league=${encodeURIComponent(leagueSlug)}`;
  const dashboardPath = `/${leagueSlug}/dashboard`;

  const [isLoading, setIsLoading] = useState(true);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [step, setStep] = useState<Step>("team");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [nameCheckLoading, setNameCheckLoading] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [myName, setMyName] = useState("");
  const [myFplId, setMyFplId] = useState("");
  const [slotChoice, setSlotChoice] = useState<string>(NEW_SLOT);
  const [fplPreview, setFplPreview] = useState<string | null>(null);
  const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);

  const isAuction = info?.leagueFormat === "auction";
  const hideTeamName = isAuction && !!info?.clubAuctionEnabled;
  const isOwner = info?.role === "owner";
  // The owner's steps: name the team, add yourself, then bring in your partner (unless they're
  // already on the team). A partner only adds themselves; auction is the name alone.
  const steps: Step[] = !info ? ["team"] : isAuction ? ["team"] : !isOwner ? ["me"] : info.memberCount < info.maxMembers ? ["team", "me", "partner"] : ["team", "me"];
  const stepIndex = Math.max(0, steps.indexOf(step));

  /** Your details for a slot choice: the slot's, unless your profile has a different FPL ID (you know your own ID best). */
  const prefillFor = (s: SetupInfo, choice: string) => {
    const slot = s.openSlots.find((o) => o.id === choice);
    const profile = s.defaults ?? { name: "", fplId: "" };
    if (slot && !(profile.fplId && profile.fplId !== slot.fplId)) return { name: slot.name, fplId: slot.fplId };
    return { name: profile.name, fplId: profile.fplId };
  };

  // Load this person's setup state.
  useEffect(() => {
    const load = async () => {
      try {
        const setupRes = await fetch(withLeague("/api/team/setup"));
        if (setupRes.status === 401) {
          router.push(`/signin?next=${encodeURIComponent(`/${leagueSlug}/setup`)}`);
          return;
        }
        if (!setupRes.ok) {
          router.push(`/${leagueSlug}`); // not on a team in this league
          return;
        }
        const s: SetupInfo = await setupRes.json();
        if (!s.needsSetup) {
          router.push(dashboardPath);
          return;
        }
        setInfo(s);
        setTeamName(s.currentName);
        setStep(s.leagueFormat !== "auction" && s.role !== "owner" ? "me" : "team");
        // Which slot is yours: the unlinked one with your FPL ID; else a new one if there's room;
        // else the first unlinked one (e.g. the details your owner entered for you).
        const match = s.openSlots.find((o) => !!s.defaults?.fplId && o.fplId === s.defaults.fplId);
        const choice = s.mySlot ? s.mySlot.id : match ? match.id : s.canAddSlot ? NEW_SLOT : (s.openSlots[0]?.id ?? NEW_SLOT);
        setSlotChoice(choice);
        const prefill = s.mySlot ? { name: s.mySlot.name, fplId: s.mySlot.fplId } : prefillFor(s, choice);
        setMyName(prefill.name);
        setMyFplId(prefill.fplId);
      } catch (err) {
        console.error("Setup load error:", err);
        router.push("/signin");
      } finally {
        setIsLoading(false);
      }
    };

    load();
    // withLeague and dashboardPath derive from leagueSlug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, leagueSlug]);

  const reloadTeamInfo = async () => {
    const result = await fetchTeamInfo(leagueSlug);
    if ("info" in result) setTeamInfo(result.info);
  };

  const handleTeamNameBlur = async (value: string) => {
    if (!value.trim() || value === info?.currentName) return;

    setNameCheckLoading(true);
    try {
      const res = await fetch(withLeague(`/api/team/setup?checkName=${encodeURIComponent(value)}`));
      const data = await res.json();
      if (!data.available) {
        setErrors((prev) => ({ ...prev, teamName: isAuction ? "Name is already taken" : "Team name is already taken" }));
      } else {
        setErrors((prev) => ({ ...prev, teamName: undefined }));
      }
    } catch (err) {
      console.error("Name check error:", err);
    } finally {
      setNameCheckLoading(false);
    }
  };

  const checkFpl = async () => {
    setFplPreview(null);
    const id = myFplId.trim();
    if (!id) return;
    const res = await fetch(`/api/me/profile?checkFplEntry=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (res?.found) setFplPreview(`${res.teamName} — ${res.managerName}`);
    else if (res?.problem) setFplPreview(res.problem);
  };

  const chooseSlot = (choice: string) => {
    if (!info) return;
    setSlotChoice(choice);
    const prefill = prefillFor(info, choice);
    setMyName(prefill.name);
    setMyFplId(prefill.fplId);
    setFplPreview(null);
  };

  const validateTeamStep = () => {
    const newErrors: Errors = {};
    // Club-auction leagues override the manager name with the owned PL club's name everywhere,
    // so we skip the name field — the admin-assigned default (currentName) is sent on submit.
    if (!hideTeamName && !teamName.trim()) {
      newErrors.teamName = isAuction ? "Name is required" : "Team name is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateMeStep = () => {
    const newErrors: Errors = {};
    if (!myName.trim()) newErrors.name = "Your name is required";
    if (!myFplId.trim()) newErrors.fplId = "Your FPL ID is required";
    else if (!/^\d+$/.test(myFplId.trim())) newErrors.fplId = "Must be numeric";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === "team" && validateTeamStep()) {
      setStep("me");
      setErrors({});
    }
  };

  const handleBack = () => {
    if (stepIndex > 0 && step !== "partner") {
      setStep(steps[stepIndex - 1]);
      setErrors({});
    }
  };

  /** Save this person's part: auction name, or (TVT / Continental) your own details (+ team name if you own it). */
  const handleSave = async () => {
    if (isAuction ? !validateTeamStep() : !validateMeStep()) return;

    setIsSubmitting(true);
    try {
      const body = isAuction
        ? { teamName: hideTeamName ? info?.currentName : teamName }
        : { teamName: isOwner ? teamName : undefined, name: myName, fplId: myFplId, slotId: slotChoice === NEW_SLOT ? null : slotChoice };
      const res = await fetch(withLeague("/api/team/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrors({ global: data.error || "Setup failed" });
        return;
      }

      if (steps.includes("partner")) {
        await reloadTeamInfo();
        setStep("partner");
        setErrors({});
        return;
      }
      router.push(dashboardPath);
    } catch (err) {
      console.error("Setup error:", err);
      setErrors({ global: "Failed to complete setup" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !info) {
    return <LoadingScreen variant="standings" fullScreen />;
  }

  // Which unlinked slot is yours: only asked when there's a real choice.
  const slotOptions = info.mySlot ? [] : [...info.openSlots.map((s) => ({ id: s.id, label: `${s.name} · FPL ${s.fplId}` })), ...(info.canAddSlot ? [{ id: NEW_SLOT, label: "Neither, I'm new to this team" }] : [])];
  const takingOverSlot = !info.mySlot && slotOptions.length === 1 && slotChoice !== NEW_SLOT ? info.openSlots.find((s) => s.id === slotChoice) : null;
  const isLastInputStep = isAuction || step === "me";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "flow" }} activeKey="" brandHref="/" brandLabel="JPL India" title="Team setup" />
      <div className="mx-auto max-w-md w-full px-4 py-6 sm:py-8 sm:px-6">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-3xl font-bold text-white mb-2">
            {!isOwner && !isAuction ? `Join ${info.currentName}` : "Complete Your Profile"}
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm">
            {isAuction
              ? "Step 1 of 1 — Manager profile"
              : !isOwner
                ? `${info.ownerName ? `With ${info.ownerName} · ` : ""}add your own name and FPL ID`
                : `Step ${stepIndex + 1} of ${steps.length}`}
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex gap-2 mb-8 sm:mb-12">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-gradient-to-r from-yellow-400 to-orange-500" : "bg-white/10"
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {errors.global && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 text-sm">
            {errors.global}
          </div>
        )}

        {/* Form */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-8 backdrop-blur">
          {step === "team" && (
            <div className="space-y-6">
              {hideTeamName ? (
                <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-200">
                  Your team will display as the PL club you buy in the club auction — no display name needed.
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">{isAuction ? "Your Name" : "Team Name"}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      onBlur={(e) => handleTeamNameBlur(e.target.value)}
                      placeholder={isAuction ? "Rahul Gupta" : "DM — Rahul"}
                      className={`flex-1 ${INPUT}`}
                    />
                    {nameCheckLoading && <span className="text-xs text-gray-400">Checking...</span>}
                  </div>
                  {errors.teamName && <p className="text-red-400 text-xs mt-1">{errors.teamName}</p>}
                  <p className="text-gray-500 text-xs mt-2">
                    Your display name. Must be unique within the league.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === "me" && (
            <div className="space-y-6">
              {slotOptions.length > 1 && (
                <fieldset>
                  <legend className="block text-sm font-semibold text-white mb-2">Which of these is you?</legend>
                  <div className="space-y-2">
                    {slotOptions.map((o) => (
                      <label key={o.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-200">
                        <input type="radio" name="slot" value={o.id} checked={slotChoice === o.id} onChange={() => chooseSlot(o.id)} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {takingOverSlot && (
                <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-xs text-gray-300">
                  {isOwner ? "Your team already has these details" : `${info.ownerName ?? "Your teammate"} entered you as`}:{" "}
                  <span className="font-semibold text-white">{takingOverSlot.name}</span> · FPL {takingOverSlot.fplId}. Check them below.
                </p>
              )}

              <div>
                <label htmlFor="setup-name" className="block text-sm font-semibold text-white mb-2">Your Name</label>
                <input
                  id="setup-name"
                  type="text"
                  value={myName}
                  onChange={(e) => setMyName(e.target.value)}
                  maxLength={60}
                  placeholder="John Doe"
                  className={INPUT}
                />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="setup-fpl" className="block text-sm font-semibold text-white mb-2">Your FPL Team ID</label>
                <input
                  id="setup-fpl"
                  type="text"
                  value={myFplId}
                  onChange={(e) => setMyFplId(e.target.value.replace(/\D/g, ""))}
                  onBlur={checkFpl}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="1234567"
                  className={INPUT}
                />
                {errors.fplId && <p className="text-red-400 text-xs mt-1">{errors.fplId}</p>}
                <p className="text-gray-500 text-xs mt-2">
                  {fplPreview ?? (
                    <>
                      The number in your FPL team&apos;s web address at{" "}
                      <a href="https://fantasy.premierleague.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                        fantasy.premierleague.com
                      </a>
                    </>
                  )}
                </p>
              </div>

              {isOwner && steps.includes("partner") && (
                <p className="text-gray-500 text-xs">Only your own details: your partner adds theirs when they join.</p>
              )}
            </div>
          )}

          {step === "partner" && (
            teamInfo ? (
              <PartnerInvitePanel leagueSlug={leagueSlug} info={teamInfo} onChanged={reloadTeamInfo} autoCreate />
            ) : (
              <p className="text-sm text-gray-400">Loading your team…</p>
            )
          )}
        </div>

        {/* Navigation buttons */}
        <div className="mt-6 sm:mt-8 flex gap-3 sm:gap-4">
          {step === "partner" ? (
            <button
              onClick={() => router.push(dashboardPath)}
              className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-r from-green-400 to-emerald-500 text-white font-bold hover:from-green-300 hover:to-emerald-400 transition"
            >
              {teamInfo?.isProfileComplete ? "Go to dashboard" : "Done for now"}
            </button>
          ) : (
            <>
              {steps.length > 1 && (
                <button
                  onClick={handleBack}
                  disabled={stepIndex === 0}
                  className="flex-1 px-6 py-3 rounded-lg border border-white/20 text-white font-semibold hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Back
                </button>
              )}
              {isLastInputStep ? (
                <button
                  onClick={handleSave}
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-r from-green-400 to-emerald-500 text-white font-bold hover:from-green-300 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {isSubmitting ? "Saving..." : steps.includes("partner") ? "Save & continue" : "Complete Setup"}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 text-slate-900 font-bold hover:from-yellow-300 hover:to-orange-400 transition"
                >
                  Next
                </button>
              )}
            </>
          )}
        </div>
        {step === "partner" && !teamInfo?.isProfileComplete && (
          <p className="mt-3 text-center text-xs text-gray-500">Your team shows as pending until your partner adds their details.</p>
        )}
      </div>
    </div>
  );
}
