import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    globals: false,
    hookTimeout: 60_000,
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
    // All test files share ONE in-memory Mongo replica set (started once in
    // vitest.setup.ts) and one process.env — running files in parallel
    // workers would each need their own Mongo instance and wouldn't share
    // the MONGODB_URI set at setup time.
    fileParallelism: false,
  },
});
