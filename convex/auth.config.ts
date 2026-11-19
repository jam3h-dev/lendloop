import type { AuthConfig } from "convex/server";

// Clerk session tokens must carry aud "convex" (applicationID below); see the
// session token claims in README step 2. CLERK_JWT_ISSUER_DOMAIN is the Clerk
// Frontend API URL:
//   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://xxx.clerk.accounts.dev
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
