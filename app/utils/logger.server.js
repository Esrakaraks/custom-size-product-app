const logs = [];

export function logEvent(entry) {
  const now = new Date().toISOString();

  logs.push({
    time: now,
    ...entry,
  });

  console.log("LOG EVENT:", { time: now, ...entry });
}

export function getLogs(limit = 100) {
  if (logs.length <= limit) return logs;
  return logs.slice(logs.length - limit);
}
export function checkErrorAlarm() {
  const tenMinAgo = Date.now() - 10 * 60 * 1000;

  const recentErrors = logs.filter(
    (log) =>
      log.level === "error" &&
      new Date(log.time).getTime() >= tenMinAgo
  );

  if (recentErrors.length >= 5) {
    console.warn(
      "5+ errors occurred in the last 10 minutes.",
      recentErrors.length
    );

    logs.push({
      time: new Date().toISOString(),
      level: "alarm",
      type: "error_spike",
      message: `${recentErrors.length} errors occurred in the last 10 minutes.`,
    });
  }
}
