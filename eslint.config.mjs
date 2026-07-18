import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Section 3 layering, enforced with no-restricted-imports:
//   app/ & features/*/components -> features actions / api handlers
//   actions & handlers           -> server/services
//   services                     -> repositories (+ other services)
//   repositories                 -> database/models
// FORBIDDEN: components importing services/repositories/models directly;
// services importing React/next/navigation; cross-feature imports.
const modelsAndRepos = [
  {
    group: ["@/database/models/*", "@/server/repositories/*"],
    message:
      "Only server/repositories/** may import database/models directly, and only server/services/** may import repositories. Go through the service layer.",
  },
];

const noDbAtAll = [
  {
    group: ["@/database/models/*", "@/server/repositories/*", "@/server/services/*"],
    message:
      "Client/shared components never touch the data layer. Call a Server Action (features/*/actions.ts) instead.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

  // Section 10.7 — no dangerouslySetInnerHTML anywhere.
  { rules: { "react/no-danger": "error" } },

  // Law 10 — no console.log in committed application code. console.error/
  // warn stay allowed (error boundaries, legitimate warnings). scripts/**
  // are CLI tools whose whole purpose is console output, so they're exempt
  // below.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-console": ["error", { allow: ["warn", "error"] }] },
  },

  // components/shared and components/ui never touch the data layer.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: noDbAtAll }],
    },
  },
  // Feature *components* (client-facing) never touch the data layer either
  // — only that feature's actions.ts may.
  {
    files: ["src/features/*/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: noDbAtAll }],
    },
  },
  // Feature actions.ts calls services, never repositories/models directly.
  {
    files: ["src/features/*/actions.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: modelsAndRepos }],
    },
  },
  // Route handlers: same rule as actions — call services, not repos/models.
  {
    files: ["src/app/api/**/route.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: modelsAndRepos }],
    },
  },
  // Services own the DB transaction and call repositories; they must never
  // import models directly, or anything React/browser-only.
  {
    files: ["src/server/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "Services are pure server logic — no React." },
            {
              name: "next/navigation",
              message: "Services are pure server logic — no next/navigation.",
            },
          ],
          patterns: [
            {
              group: ["@/database/models/*"],
              message: "Services call repositories, not models, directly.",
            },
          ],
        },
      ],
    },
  },
  // Repositories are the ONLY files importing models — nothing to restrict
  // on the import side, but they must not import other repositories'
  // business-rule-bearing services (kept as a documented convention; no
  // additional lint rule needed since repositories have no reason to
  // import services in the first place).

  // No cross-feature imports. Extend this list as new features/* land.
  ...["auth", "clients", "payments", "accounts", "expenses", "credits", "notifications", "audit", "settings", "profile"].map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [`@/features/!(${feature})/**`],
              message:
                "Features never import from other features. Move shared code to components/shared or server/services.",
            },
          ],
        },
      ],
    },
  })),
]);

export default eslintConfig;
