// A public, bounded vocabulary: never serialize the connection itself.
export function databaseDescriptor(client) {
  const names = {sqlite: "sqlite", duckdb: "duckdb", HDB: "HDB", postgres: "postgres"};
  const engine = Object.hasOwn(names, client?.name ?? "") ? names[client.name] : "unknown";
  return {
    engine,
    storage: engine === "HDB" || engine === "postgres" ? "server"
      : client?.path && client.path !== ":memory:" ? "file" : "memory",
    connected: client?.connected === true ||
      (client?.connected === undefined && engine === "sqlite" && client?.sqlite !== undefined),
  };
}
