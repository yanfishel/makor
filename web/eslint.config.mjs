import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

// eslint-config-next 16 ships flat configs directly; the FlatCompat shim earlier versions
// needed cannot load them (it tries to JSON-stringify the plugin objects and hits a cycle).
const eslintConfig = [
  ...coreWebVitals,
  ...typescriptConfig,
  {
    // New in eslint-plugin-react-hooks 7, which arrived with eslint-config-next 16. It fires on
    // twelve deliberate mount-time patterns across nine client components (the UTC-then-local
    // timestamp, the media-query hook, the elapsed clock, the panels' first fetch): each needs
    // its own rewrite and its own check in a browser, which does not belong in a framework
    // upgrade. Off until they are rewritten, rather than twelve suppressions in the components.
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
