import { getStore } from "@/lib/env";
import { renderProfileIcon } from "@/lib/icon-image";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getStore();
    const profile = await store.getProfile();
    return renderProfileIcon({
      name: profile.name || "",
      avatar: profile.avatar || "",
    });
  } catch {
    return renderProfileIcon({ name: "", avatar: "", cache: null });
  }
}
