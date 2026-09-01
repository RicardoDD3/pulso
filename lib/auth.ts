import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv, envFlags } from "@/lib/env";

/**
 * Better Auth (spec doc 04): email+password always on, optional social OAuth,
 * TOTP 2FA, open signups unless SIGNUPS_DISABLED, uuid ids so every data
 * table can FK users.id with ON DELETE CASCADE.
 */
function socialProviders() {
  const env = getEnv();
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  }
  return providers;
}

export const auth = betterAuth({
  baseURL: getEnv().APP_URL,
  secret: getEnv().AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    usePlural: true,
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
      twoFactors: schema.twoFactors,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: envFlags.requireEmailVerification(),
  },
  socialProviders: socialProviders(),
  plugins: [twoFactor()],
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
});

export type Session = typeof auth.$Infer.Session;
