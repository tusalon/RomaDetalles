import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { getAdminData } from "@/lib/store";
import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  const data = await getAdminData();
  return <AdminClient initialData={data} userName={user.displayName} />;
}
