"use client";

import { useEffect, useState } from "react";

function CountdownSegment({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center px-4">
      <div className="text-4xl sm:text-5xl font-mono font-bold text-white tabular-nums">{String(value).padStart(2, "0")}</div>
      <div className="text-[10px] uppercase tracking-widest text-gray-400 mt-1">{label}</div>
    </div>
  );
}

/** Days / hours / minutes / seconds to a scheduled auction start (the FPL room's countdown). */
export function ScheduledCountdown({ scheduledAt, now: clock }: { scheduledAt: string; now?: () => number }) {
  // Lazy initializer keeps Date.now() out of the render path (React purity rule).
  const [now, setNow] = useState<number>(() => (clock ? clock() : Date.now()));
  useEffect(() => {
    const id = setInterval(() => setNow(clock ? clock() : Date.now()), 1000);
    return () => clearInterval(id);
  }, [clock]);
  const target = new Date(scheduledAt).getTime();
  const diff = target - now;
  if (diff <= 0) {
    return (
      <div className="text-2xl font-bold text-green-300">
        Starting any moment — waiting for admin to open the room
      </div>
    );
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
      {days > 0 && <><CountdownSegment value={days} label="Days" /><div className="text-3xl text-gray-600">:</div></>}
      <CountdownSegment value={hours} label="Hours" />
      <div className="text-3xl text-gray-600">:</div>
      <CountdownSegment value={minutes} label="Minutes" />
      <div className="text-3xl text-gray-600">:</div>
      <CountdownSegment value={seconds} label="Seconds" />
    </div>
  );
}
