import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function requireAdminApi() {
  return getChatGPTUser();
}
