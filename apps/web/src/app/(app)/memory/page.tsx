import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { MemoryPageClient } from "./MemoryPageClient";
import { listUserMemories } from "./memory-client";

export default async function MemoryPage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await listUserMemories(token);
  const initialData = result.kind === "ok" ? result.data : null;
  const initialError = result.kind === "error" ? result.message : null;

  // Title + description are rendered once, by MemoryPageClient (issue #252):
  // previously both this shell AND the client rendered them, duplicating the
  // heading and copy on screen.
  return (
    <main className="kin-page">
      <MemoryPageClient initialData={initialData} initialError={initialError} />
    </main>
  );
}
