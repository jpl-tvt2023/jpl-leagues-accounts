import type { ReactNode } from "react";

/** One sport's leagues ("⚽ Football"), on the landing page and the signed-in home page. */
export function SportSection({ sport, label, icon, children }: { sport: string; label: string; icon: string; children: ReactNode }) {
  const headingId = `sport-${sport}`;
  return (
    <section aria-labelledby={headingId} className="mb-10 sm:mb-14">
      <h2 id={headingId} className="mb-4 flex items-center gap-2 text-xl sm:text-2xl font-bold text-white">
        <span aria-hidden="true">{icon}</span>
        {label}
      </h2>
      {children}
    </section>
  );
}

/** "Your leagues" / "Other leagues" inside a sport. `id` must be unique on the page. */
export function SportSubsection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-6 last:mb-0">
      <h3 id={id} className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</h3>
      {children}
    </section>
  );
}
