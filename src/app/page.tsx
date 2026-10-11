import { resolveViewer } from "@/lib/viewer";
import { PlayerHome } from "./_home/PlayerHome";
import { PublicHome } from "./_home/PublicHome";

/**
 * `/` — a signed-in person's home (every league they're part of, grouped by sport, with where they
 * stand and what needs doing); everyone else's landing page (every league, grouped by sport).
 *
 * Decided on the server, so neither page flashes up before the other.
 */
export default async function Home() {
  const viewer = await resolveViewer();
  return viewer.authenticated ? <PlayerHome /> : <PublicHome />;
}
