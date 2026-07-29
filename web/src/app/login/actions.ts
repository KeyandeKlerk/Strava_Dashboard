"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkSitePassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

// Only a same-origin relative path is a safe redirect target — anything else
// (absolute URL, protocol-relative "//host", a bare scheme) risks sending a
// freshly-authenticated user off-site via a crafted `from` link.
export function sanitizeRedirectTarget(path: string): string {
  if (path.startsWith("/") && !path.startsWith("//")) return path;
  return "/";
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const from = sanitizeRedirectTarget(String(formData.get("from") ?? "/"));

  if (!checkSitePassword(password)) {
    redirect(`/login?error=1&from=${encodeURIComponent(from)}`);
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect(from);
}
