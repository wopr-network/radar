import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		env: {
			RADAR_LOG_FILE: "/tmp/radar-test.log",
		},
		coverage: {
			provider: "v8",
			include: ["src/**"],
			reporter: ["text", "json-summary"],
			reportOnFailure: true,
		},
	},
});
