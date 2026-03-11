import { useMemo, useState } from "react";
import { api } from "./api";
import botIcon from "./Images/chatbot-conversation-vectorart_78370-4107.avif";

function generateSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractLangflowReply(payload) {
  const root = payload?.data ?? payload;
  const candidate =
    root?.outputs?.[0]?.outputs?.[0]?.results?.message?.text ??
    root?.outputs?.[0]?.outputs?.[0]?.results?.text ??
    root?.outputs?.[0]?.outputs?.[0]?.text ??
    root?.message;
  if (candidate) return String(candidate);
  return JSON.stringify(root, null, 2);
}

export default function ChatBotWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    { role: "bot", text: "Hi! Ask me anything and I’ll do my best to help." },
  ]);
  const sessionId = useMemo(() => generateSessionId(), []);

  async function sendMessage(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setBusy(true);

    try {
      const response = await api.runLangflow({
        message: trimmed,
        sessionId,
        inputType: "chat",
        outputType: "chat",
      });
      const reply = extractLangflowReply(response);
      setMessages((prev) => [...prev, { role: "bot", text: reply }]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: error.message || "Something went wrong." },
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
              <strong>Langflow Assistant</strong>
              <div className="chatbot-sub">Powered by your backend</div>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </div>

          <div className="chatbot-output">
            <div className="chatbot-messages">
              {messages.map((msg, idx) => (
                <div key={idx} className={`chatbot-bubble ${msg.role}`}>
                  {msg.text}
                </div>
              ))}
              {busy && <div className="chatbot-bubble bot">Thinking…</div>}
            </div>
          </div>

          <form className="chatbot-form" onSubmit={sendMessage}>
            <input
              className="form-control"
              placeholder="Ask your Langflow assistant"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
              {busy ? "Sending..." : "Send"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
