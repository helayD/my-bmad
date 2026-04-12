import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  {
    ignores: [
      // Default ignores of eslint-config-next:
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Third-party vendored components
      "src/components/animate-ui/**",
      "src/components/reui/**",
      ".agents/**",
      ".claude/**",
      ".windsurf/**",
      "_bmad/**",
      "_bmad-output/**",
    ],
  },
];

export default eslintConfig;
