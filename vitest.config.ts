import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			enabled: true,
			provider: "v8",
			include: ["src/**"],
			reporter: ["text", "json-summary"],
			reportOnFailure: true,
		},
	},
});
