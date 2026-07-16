import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/", error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form action={login} className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input type="hidden" name="from" value={from} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          autoFocus
          className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {error && <p className="text-sm text-red-600">Incorrect password.</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
