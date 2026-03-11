import { useMemo, useState } from "react";
import { api } from "./api";
import botIcon from "./Images/chatbot-conversation-vectorart_78370-4107.avif";

const KNOWN_CURRENCIES = ["USD", "KES", "EUR", "GBP", "TZS", "UGX", "RWF", "ZAR"];

function extractQuoted(input) {
  const matches = input.match(/"([^"]+)"|'([^']+)'/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

function extractUrl(input) {
  const match = input.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0].replace(/[),.]+$/, "") : "";
}

function extractId(input) {
  const match = input.match(/\bid\s*=\s*(\d+)\b/i);
  if (match) return match[1];
  const hash = input.match(/competitor\s*#?\s*(\d+)/i);
  return hash ? hash[1] : "";
}

function extractCurrency(input) {
  const match = input.match(/\b([A-Z]{3})\b/);
  if (match && KNOWN_CURRENCIES.includes(match[1])) return match[1];
  const lowerMatch = input.match(/\b([a-z]{3})\b/);
  if (lowerMatch && KNOWN_CURRENCIES.includes(lowerMatch[1].toUpperCase())) {
    return lowerMatch[1].toUpperCase();
  }
  return "";
}

function extractName(input) {
  const quoted = extractQuoted(input).find((q) => !/^https?:\/\//i.test(q));
  if (quoted) return quoted;
  const match = input.match(/name\s*[:=]\s*([^\s,]+)/i);
  if (match) return match[1];
  const afterNamed = input.match(/named\s+([^\s,]+)/i);
  if (afterNamed) return afterNamed[1];
  return "";
}

function extractQuery(input) {
  const quoted = extractQuoted(input).find((q) => !/^https?:\/\//i.test(q));
  if (quoted) return quoted;
  const forMatch = input.match(/\bfor\s+(.+)$/i);
  if (forMatch) return forMatch[1];
  const searchMatch = input.match(/\bsearch\s+(.+)$/i);
  if (searchMatch) return searchMatch[1];
  return "";
}

function cleanQuery(raw, input) {
  if (!raw) return "";
  let cleaned = raw;
  const url = extractUrl(input);
  if (url) cleaned = cleaned.replace(url, "");
  const currency = extractCurrency(input);
  if (currency) cleaned = cleaned.replace(new RegExp(`\\b${currency}\\b`, "i"), "");
  cleaned = cleaned
    .replace(/\bcompetitor\b/gi, "")
    .replace(/\bwith\b/gi, "")
    .replace(/\busing\b/gi, "")
    .replace(/\bid\s*=\s*\d+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function findCompetitorByName(input, competitors) {
  const lower = input.toLowerCase();
  const sorted = [...competitors].sort((a, b) => b.name.length - a.name.length);
  return sorted.find((c) => lower.includes(c.name.toLowerCase()));
}

function interpretInput(input) {
  const text = input.trim();
  if (!text) return { error: "Enter a request." };
  const lower = text.toLowerCase();
  const url = extractUrl(text);

  if (lower.includes("list") && lower.includes("competitor")) {
    return { type: "list_competitors" };
  }
  if ((lower.includes("add") || lower.includes("create") || lower.includes("new")) && lower.includes("competitor")) {
    return { type: "add_competitor" };
  }
  if ((lower.includes("update") || lower.includes("edit")) && lower.includes("competitor")) {
    return { type: "update_competitor" };
  }
  if ((lower.includes("delete") || lower.includes("remove")) && lower.includes("competitor")) {
    return { type: "delete_competitor" };
  }
  if (lower.includes("search")) {
    return { type: "search_competitor" };
  }
  if (lower.includes("scrape") || (url && url.includes("/collections/"))) {
    return { type: "scrape_collection" };
  }
  return { error: "I could not match that to a system action." };
}

export default function ChatBotWidget() {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState([]);

  const examples = useMemo(
    () => [
      'Add competitor Zara with https://www.zara.com and USD',
      "Search Vivo for dresses",
      "Scrape https://example.com/collections/dresses with USD",
      "Delete competitor Zara",
      "Update competitor Nalani website https://nalaniwomen.com currency KES",
      "List competitors",
    ],
    []
  );

  async function runCommand(e) {
    e.preventDefault();
    const intent = interpretInput(command);
    if (intent.error) {
      setOutput((prev) => [{ type: "error", message: intent.error }, ...prev]);
      return;
    }

    setBusy(true);
    try {
      const competitors = await api.getCompetitors();
      let result = null;
      switch (intent.type) {
        case "list_competitors":
          result = competitors;
          break;
        case "add_competitor":
          {
            const name = extractName(command);
            const website = extractUrl(command);
            const currency = extractCurrency(command);
            if (!name || !website) {
              throw new Error("Please include name and website.");
            }
            result = await api.addCompetitor({
              name,
              website,
              currency,
            });
          }
          break;
        case "update_competitor":
          {
            const id = extractId(command);
            let competitorId = id;
            if (!competitorId) {
              const match = findCompetitorByName(command, competitors);
              competitorId = match ? String(match.id) : "";
            }
            if (!competitorId) {
              throw new Error("Please specify which competitor to update.");
            }
            const name = extractName(command);
            const website = extractUrl(command);
            const currency = extractCurrency(command);
            if (!name && !website && !currency) {
              throw new Error("Provide at least one field to update.");
            }
            result = await api.updateCompetitor(competitorId, {
              name,
              website,
              currency,
            });
          }
          break;
        case "delete_competitor":
          {
            const id = extractId(command);
            let competitorId = id;
            if (!competitorId) {
              const match = findCompetitorByName(command, competitors);
              competitorId = match ? String(match.id) : "";
            }
            if (!competitorId) {
              throw new Error("Please specify which competitor to delete.");
            }
            result = await api.deleteCompetitor(competitorId);
          }
          break;
        case "search_competitor":
          {
            const id = extractId(command);
            let competitorId = id;
            let competitorCurrency = "";
            if (!competitorId) {
              const match = findCompetitorByName(command, competitors);
              competitorId = match ? String(match.id) : "";
              competitorCurrency = match?.currency || "";
            }
            if (!competitorId) {
              throw new Error("Please specify which competitor to search.");
            }
            const rawQuery = extractQuery(command);
            const query = cleanQuery(rawQuery, command);
            if (!query) {
              throw new Error("Please provide a search query.");
            }
            result = await api.searchCompetitor(competitorId, query);
            if (competitorCurrency && result?.data) {
              result.data = result.data.map((item) => ({
                ...item,
                currency: item.currency || competitorCurrency,
              }));
            }
          }
          break;
        case "scrape_collection":
          {
            const urlToScrape = extractUrl(command);
            if (!urlToScrape) {
              throw new Error("Please provide a collection URL.");
            }
            const currency = extractCurrency(command);
            result = await api.scrapeCollection({
              url: urlToScrape,
              currency,
            });
          }
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
    <div className="chatbot-shell">
      <button className="chatbot-fab" type="button" onClick={() => setOpen((v) => !v)}>
        <img src={botIcon} alt="Chat bot" />
      </button>

      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div>
              <strong>Command Bot</strong>
              <div className="chatbot-sub">Safe commands only</div>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </div>

          <form className="chatbot-form" onSubmit={runCommand}>
            <input
              className="form-control"
              placeholder='e.g. "Search Vivo for dresses"'
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Running..." : "Run"}
            </button>
          </form>

          <div className="chatbot-examples">
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

          <div className="chatbot-output">
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
      )}
    </div>
  );
}
