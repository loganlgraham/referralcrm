import nextConfig from "eslint-config-next";
import prettierConfig from "eslint-config-prettier";
import tailwindcss from "eslint-plugin-tailwindcss";

const eslintConfig = [
  ...nextConfig,
  prettierConfig,
  {
    plugins: {
      tailwindcss,
    },
    rules: {
      "tailwindcss/classnames-order": "warn",
      "tailwindcss/no-custom-classname": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
      "dist/**",
    ],
  },
];

export default eslintConfig;
