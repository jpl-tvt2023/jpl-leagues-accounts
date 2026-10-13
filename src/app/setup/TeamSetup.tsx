"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AppNav } from "@/components/AppNav";
import { PartnerInvitePanel, fetchTeamInfo, type TeamInfo } from "@/components/PartnerInvitePanel";
import { FplTeamPicker, defaultFplPick, type FplTeamOption } from "@/components/FplTeamPicker";

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
  /** What setup asks for (src/lib/sports/registry.ts). "name-only" = auction-style: just the team name. */
  setupMode?: "fpl-players" | "name-only" | "none";
  clubAuctionEnabled: boolean;
  memberCount: number;
  maxMembers: number;
  ownerName: string | null;
  mySlot: Slot | null;
  openSlots: Slot[];
  canAddSlot: boolean;
  /** Your name in the league: your display name. */
  myName: string;
  /** Your saved FPL teams, each marked if it already plays for another team in this league. */
  fplTeams: FplTeamOption[];
  /** Set once the league's FPL teams are fixed (its first gameweek deadline has passed). */
  lock: { gw: number; deadline: string } | null;
}

interface Errors {
  teamName?: string;
  fplId?: string;
  global?: string;
}

type Step = "team" | "me" | "partner";

/** "new" = a fresh FPL slot rather than one of the team's unlinked ones. */
const NEW_SLOT = "new";

const INPUT = "w-full rounded-lg border border-white/20 bg-black/40 px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-400 focus:outline-none";

/**
 * Team setup at /[leagueSlug]/setup: each person sets up only their own part of the team.
 * - TVT / Continental owner: team name → pick which of your saved FPL teams plays here → invite
 *   your partner (or, for a partner who won't sign in, enter their details).
 * - TVT / Continental partner (joined with the team link, or added by an admin): pick your FPL
 *   team, taking over the slot the owner filled in for you if there is one.
 * - Auction: the name only.
 * You play under your display name. Your primary FPL team is picked by default; you can add one
 * here without leaving. Every API call names the league; the team key is internal.
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
  const [fplTeams, setFplTeams] = useState<FplTeamOption[]>([]);
  const [pickedFpl, setPickedFpl] = useState<string | null>(null);
  const [slotChoice, setSlotChoice] = useState<string>(NEW_SLOT);
  const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);

  const isAuction = info?.leagueFormat === "auction";
  // Auction-style formats (FPL auction, cricket) ask only for a name — no FPL team, no partner.
  const isNameOnly = info?.setupMode ? info.setupMode === "name-only" : isAuction;
  const hideTeamName = isAuction && !!info?.clubAuctionEnabled;
  const isOwner = info?.role === "owner";
  // The owner's steps: name the team, add yourself, then bring in your partner (unless they're
  // already on the team). A partner only adds themselves; auction is the name alone.
  const steps: Step[] = !info ? ["team"] : isNameOnly ? ["team"] : !isOwner ? ["me"] : info.memberCount < info.maxMembers ? ["team", "me", "partner"] : ["team", "me"];
  const stepIndex = Math.max(0, steps.indexOf(step));

  /** The FPL team to pick for a slot choice: the slot's own, if it's one of yours; else your primary. */
  const pickFor = (s: SetupInfo, teams: FplTeamOption[], choice: string) => {
    const slot = s.openSlots.find((o) => o.id === choice);
    if (slot && teams.some((t) => t.fplEntryId === slot.fplId)) return slot.fplId;
    return defaultFplPick(teams);
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
        setStep((s.setupMode ? s.setupMode !== "name-only" : s.leagueFormat !== "auction") && s.role !== "owner" ? "me" : "team");
        setFplTeams(s.fplTeams);
        // Which slot is yours: an unlinked one playing as one of your FPL teams; else a new one if
        // there's room; else the first unlinked one (e.g. the details your owner entered for you).
        const mine = new Set(s.fplTeams.map((t) => t.fplEntryId));
        const match = s.openSlots.find((o) => mine.has(o.fplId));
        const choice = s.mySlot ? s.mySlot.id : match ? match.id : s.canAddSlot ? NEW_SLOT : (s.openSlots[0]?.id ?? NEW_SLOT);
        setSlotChoice(choice);
        setPickedFpl(s.mySlot ? s.mySlot.fplId : pickFor(s, s.fplTeams, choice));
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

  const chooseSlot = (choice: string) => {
    if (!info) return;
    setSlotChoice(choice);
    setPickedFpl(pickFor(info, fplTeams, choice));
  };

  /** A newly saved FPL team joins the list and is picked. */
  const addedFplTeam = (team: FplTeamOption) => {
    setFplTeams((prev) => (prev.some((t) => t.id === team.id) ? prev : [...prev, team]));
    setPickedFpl(team.fplEntryId);
    setErrors((prev) => ({ ...prev, fplId: undefined }));
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
    if (!pickedFpl) newErrors.fplId = "Pick the FPL team you'll play with";
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

  /** Save this person's part: auction name, or (TVT / Continental) your FPL team (+ team name if you own it). */
  const handleSave = async () => {
    if (isNameOnly ? !validateTeamStep() : !validateMeStep()) return;

    setIsSubmitting(true);
    try {
      const body = isNameOnly
        ? { teamName: hideTeamName ? info?.currentName : teamName }
        : { teamName: isOwner ? teamName : undefined, fplId: pickedFpl, slotId: slotChoice === NEW_SLOT ? null : slotChoice };
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
  const isLastInputStep = isNameOnly || step === "me";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "flow" }} activeKey="" brandHref="/" brandLabel="JPL India" title="Team setup" />
      <div className="mx-auto max-w-md w-full px-4 py-6 sm:py-8 sm:px-6">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-3xl font-bold text-white mb-2">
            {!isOwner && !isNameOnly ? `Join ${info.currentName}` : "Complete Your Profile"}
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm">
            {isNameOnly
              ? "Step 1 of 1 — Manager profile"
              : !isOwner
                ? `${info.ownerName ? `With ${info.ownerName} · ` : ""}pick the FPL team you'll play with`
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
                  <span className="font-semibold text-white">{takingOverSlot.name}</span> · FPL {takingOverSlot.fplId}.
                  {info.lock
                    ? ` The league has started, so this slot keeps FPL ${takingOverSlot.fplId}: add it to your FPL teams below if it isn't there.`
                    : " Pick your FPL team below."}
                </p>
              )}

              <div>
                <h2 className="text-sm font-semibold text-white">Your FPL team</h2>
                <p className="mt-1 mb-3 text-xs text-gray-400">
                  Which of your FPL teams plays in this league, as {info.myName || "you"}. You can switch to another one until the
                  league&apos;s first gameweek deadline.
                </p>
                <FplTeamPicker teams={fplTeams} selected={pickedFpl} onSelect={setPickedFpl} onAdded={addedFplTeam} />
                {errors.fplId && <p className="text-red-400 text-xs mt-2">{errors.fplId}</p>}
              </div>

              {isOwner && steps.includes("partner") && (
                <p className="text-gray-500 text-xs">Just yours: your partner picks theirs when they join.</p>
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
