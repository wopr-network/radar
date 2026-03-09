import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const logFile = process.env.RADAR_LOG_FILE ?? "/data/radar.log";

const consoleTransport = new winston.transports.Console({
  stderrLevels: ["error", "warn", "info", "http", "verbose", "debug", "silly"],
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `${String(timestamp)} ${level}: ${String(message)}${metaStr}`;
    }),
  ),
});

const transports: winston.transport[] = [consoleTransport];

try {
  const fileTransport = new DailyRotateFile({
    filename: logFile,
    datePattern: "YYYY-MM-DD",
    maxFiles: "7d",
    maxSize: "50m",
  });
  // Swallow file transport errors (e.g. /data not writable in test environments)
  fileTransport.on("error", (_err: Error) => {});
  transports.push(fileTransport);
} catch {
  // /data not available (CI, test environments) — console-only logging
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports,
});
