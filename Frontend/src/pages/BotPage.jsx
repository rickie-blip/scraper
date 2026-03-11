import { useMemo, useState } from "react";
import { api } from "../api";

function tokenize(input) {
  const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function parseKeyValues(tokens) {
  const args = {};
  for (const token of tokens) {
    const idx = token.indexOf("=");
    if (idx === -1) continue;
    const key = token.slice(0, idx).trim();
    const value = token.slice(idx + 1).trim();
    if (!key) continue;
    args[key] = value;
  }
  return args;
}

function parseCommand(input) {
  const tokens = tokenize(input.trim());
  const [verb, noun, ...rest] = tokens;
  if (!verb) return { error: "Enter a command." };

  const args = parseKeyValues(rest);
  const action = `${verb}${noun ? ` ${noun}` : ""}`.toLowerCase();

  switch (action) {
    case "list competitors":
      return { type: "list_competitors" };
    case "add competitor":
      return { type: "add_competitor", args };
    case "update competitor":
      return { type: "update_competitor", args };
    case "delete competitor":
      return { type: "delete_competitor", args };
    case "search competitor":
      return { type: "search_competitor", args };
    case "scrape collection":
      return { type: "scrape_collection", args };
    default:
      return { error: `Unknown command: ${action}` };
  }
}

export default function BotPage() {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState([]);

  const examples = useMemo(
    () => [
      'list competitors',
      'add competitor name="Example" website="https://example.com" currency=USD',
      'update competitor id=1 name="Example Store" website="https://example.com" currency=USD',
      "delete competitor id=1",
      'search competitor id=1 q="dresses"',
      'scrape collection url="https://example.com/collections/dresses" currency=USD',
    ],
    []
  );

  async function runCommand(e) {
    e.preventDefault();
    const parsed = parseCommand(command);
    if (parsed.error) {
      setOutput((prev) => [{ type: "error", message: parsed.error }, ...prev]);
      return;
    }

    setBusy(true);
    try {
      let result = null;
      switch (parsed.type) {
        case "list_competitors":
          result = await api.getCompetitors();
          break;
        case "add_competitor":
          result = await api.addCompetitor({
            name: parsed.args.name,
            website: parsed.args.website,
            currency: parsed.args.currency || "",
          });
          break;
        case "update_competitor":
          result = await api.updateCompetitor(parsed.args.id, {
            name: parsed.args.name,
            website: parsed.args.website,
            currency: parsed.args.currency || "",
          });
          break;
        case "delete_competitor":
          result = await api.deleteCompetitor(parsed.args.id);
          break;
        case "search_competitor":
          result = await api.searchCompetitor(parsed.args.id, parsed.args.q || parsed.args.query);
          break;
        case "scrape_collection":
          result = await api.scrapeCollection({
            url: parsed.args.url,
            currency: parsed.args.currency,
          });
          break;
        default:
          throw new Error("Unsupported command.");
      }

      setOutput((prev) => [
        { type: "success", message: command, data: result },
        ...prev,
      ]);
      setCommand("");
    } catch (err) {
      setOutput((prev) => [
        { type: "error", message: err.message || "Command failed." },
        ...prev,
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Command Bot</h2>
          <p>Run safe, system-specific commands in real time.</p>
        </div>
      </div>

      <form className="grid-row" onSubmit={runCommand}>
        <input
          className="form-control"
          placeholder='e.g. search competitor id=1 q="dresses"'
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Running..." : "Run"}
        </button>
      </form>

      <div className="card-block mt-3">
        <h5>Examples</h5>
        <div className="d-flex flex-wrap gap-2">
          {examples.map((item) => (
            <button
              key={item}
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setCommand(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="card-block mt-3">
        <h5>Output</h5>
        {!output.length && <div className="text-muted">No commands run yet.</div>}
        {output.map((entry, idx) => (
          <div key={idx} className={`alert ${entry.type === "error" ? "alert-danger" : "alert-success"} mt-2`}>
            <div>{entry.message}</div>
            {entry.data && (
              <pre className="mt-2 mb-0" style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(entry.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
