// App.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "error" | "loading";
  text: string;
  sources?: Array<{ text: string; metadata?: Record<string, any> }>;
  fileStatus?: "uploading" | "ok" | "error"; // добавлено
  fileError?: string; // для ошибок
};

const ASK_URL = "http://localhost:8081/api/chat/semantics";
const ASK_QUICK_URL = "http://localhost:8081/api/chat/semantics";
const UPLOAD_URL = "http://localhost:8081/api/documents/upload";
const MAX_USER_QUERIES = 5;
const MAX_FILES = 5;
const MAX_TOTAL_SIZE = 60 * 1024 * 1024;

export default function App() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showFileLimitModal, setShowFileLimitModal] = useState(false);
  const [quickSearch, setQuickSearch] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [chatsList, setChatsList] = useState<any[]>([]);
  const [sourcesList, setSourcesList] = useState<any[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const userQueriesCount = useMemo(
    () => messages.filter(m => m.role === "user").length,
    [messages]
  );
  const limitReached = userQueriesCount >= MAX_USER_QUERIES;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch("http://localhost:8081/chats")
      .then(res => res.json())
      .then(data => setChatsList(Array.isArray(data) ? data : data.chats || []))
      .catch(console.error);
  }, []);

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const res = await fetch("http://localhost:8081/get_books");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Object.entries(data).map(([name, link]) => ({
        name,
        link,
      }));
      setSourcesList(list);
    } catch (e) {
      console.error("Ошибка загрузки источников:", e);
      setSourcesList([]);
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const sendAsk = useCallback(async (question: string) => {
    const url = quickSearch ? ASK_QUICK_URL : ASK_URL;

    const user: ChatMsg = { id: crypto.randomUUID(), role: "user", text: question };
    setMessages(prev => [...prev, user]);

    const loading: ChatMsg = { id: crypto.randomUUID(), role: "loading", text: "" };
    setMessages(prev => [...prev, loading]);
    setBusy(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setMessages(prev =>
        prev.filter(m => m.role !== "loading").concat({
          id: crypto.randomUUID(),
          role: "assistant",
          text: String(data.answer ?? "Пустой ответ"),
          sources: Array.isArray(data.sources) ? data.sources : undefined,
        })
      );
    } catch (e: any) {
      setMessages(prev =>
        prev.filter(m => m.role !== "loading").concat({
          id: crypto.randomUUID(),
          role: "error",
          text:
            e?.name === "AbortError"
              ? "Превышено время ожидания"
              : `Ошибка: ${e?.message ?? e}`,
        })
      );
    } finally {
      setBusy(false);
    }
  }, [quickSearch]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || busy) return;
      if (limitReached) {
        setShowLimitModal(true);
        return;
      }
      sendAsk(input.trim());
      setInput("");
    },
    [input, busy, limitReached, sendAsk]
  );

  const openPicker = () => fileInputRef.current?.click();

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const totalFiles = messages.filter(m => m.role === "user").length + arr.length;
      const totalSize =
        messages
          .filter(m => m.role === "user")
          .reduce((s, m) => s + (m.text.length || 0), 0) + arr.reduce((s, f) => s + f.size, 0);

      if (totalFiles > MAX_FILES || totalSize > MAX_TOTAL_SIZE) {
        setShowFileLimitModal(true);
        return;
      }

      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const fileId = crypto.randomUUID();

        // добавляем как сообщение пользователя с текстом "загрузка..."
        setMessages(prev => [
          ...prev,
          { id: fileId, role: "user", text: `📄 ${f.name} (загрузка...)`,  fileStatus: "uploading" },
        ]);

        try {
          const form = new FormData();
          form.append("file", f);

          const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
          if (!res.ok) {
            const errorMsg =
              res.status === 400 ? "Неподдерживаемый формат" : `Ошибка: HTTP ${res.status}`;
            throw new Error(errorMsg);
          }

          const data = await res.json();
          if (data?.status !== "success" && data?.status !== "ok") {
            throw new Error(data?.message || "Ошибка загрузки");
          }

          setMessages(prev =>
            prev.map(m =>
              m.id === fileId ? { ...m, text: `${f.name}`, fileStatus: "ok"  } : m
            )
          );
        } catch (e: any) {
          setMessages(prev =>
            prev.map(m =>
              m.id === fileId
                ? { ...m, text: `${f.name}`, fileStatus: "error" }
                : m
            )
          );
        }
      }
    },
    [messages]
  );

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = "";
  };

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDrag(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!e.relatedTarget || !(e.relatedTarget as Node).isConnected) setDrag(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDrag(false);
      if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploadFiles]);

  const TypingIndicator = () => (
    <div className="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  );

  const resetChat = () => {
    setMessages([]);
  };

  return (
    <div className="app">
      <div className="header">
        ⚔️ WARHAMMER CHAT
        <button
          className="header-btn"
          onClick={() => {
            setShowSources(prev => {
              const newState = !prev;
              if (newState) fetchSources();
              return newState;
            });
          }}
        >
          Источники
        </button>
      </div>

      <div className={`drop-overlay ${drag ? "show" : ""}`}>Перетащите файлы</div>

      <div className="chat" ref={chatRef}>
        {messages.map(m => (
          <div
            key={m.id}
            className={`msg ${m.role} ${m.role === "user" ? "right" : "left"}`}
          >
            {m.role === "loading" ? (
              <TypingIndicator />
            ) : m.fileStatus ? (
              <div className="file">
                <div>📄 {m.text}</div>
                <div className={`status ${m.fileStatus}`}>
                  {m.fileStatus === "uploading" && "Загрузка…"}
                  {m.fileStatus === "ok" && "✓ Загружено"}
                  {m.fileStatus === "error" && `Ошибка: ${m.fileError}`}
                </div>
              </div>
            ) : (
              m.text
            )}
            {m.sources && (
              <div className="sources">
                {m.sources.slice(0, 3).map((s, i) => {
                  const meta = s.metadata || {};
                  return (
                    <span key={i}>
                      {i ? "; " : ""}
                      {meta.source || "неизв."}
                    </span>
                  );
                })}
                {m.sources.length > 3 ? " …" : ""}
              </div>
            )}
          </div>
        ))}

      </div>

      <div className="footer">
        <button className="btn new-chat" onClick={resetChat}>
          Новый чат
        </button>
        <div className="input-row">
          <button
            type="button"
            className={`btn quick-search ${quickSearch ? "active" : ""}`}
            onClick={() => setQuickSearch(prev => !prev)}
            title="Быстрый поиск"
          >
            ⚡
          </button>
          <form className="form" onSubmit={onSubmit}>
            <input
              className="input"
              placeholder="Спросите про Warhammer…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={busy}
            />
            <button type="button" className="btn" onClick={openPicker} disabled={busy}>
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={onFilesPicked}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              ➤
            </button>
          </form>
        </div>
      </div>

      {showChats && (
        <div className="sidebar left">
          <div className="sidebar-header">
            <h2>Чаты</h2>
            <button className="header-btn" onClick={() => setShowChats(false)}>
              Закрыть
            </button>
          </div>
          <ul className="sidebar-list">
            {chatsList.map(chat => (
              <li key={chat.id} className="sidebar-item">
                {chat.title || chat.name || "Без названия"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showSources && (
        <div className="sidebar right">
          <div className="sidebar-header">
            <h2>Источники</h2>
            <button className="header-btn" onClick={() => setShowSources(false)}>
              Закрыть
            </button>
          </div>
          {loadingSources ? (
            <div className="spinner-wrapper">
              <div className="spinner"></div>
            </div>
          ) : (
            <ul className="sidebar-list">
              {sourcesList.map((src, idx) => (
                <li key={idx} className="sidebar-item">
                  <a href={src.link} target="_blank" rel="noopener noreferrer">
                    {src.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showLimitModal && (
        <div className="modal-overlay">
          <div className="modal">
            <p>Лимит сообщений исчерпан</p>
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  setMessages([]);
                  setShowLimitModal(false);
                }}
              >
                Обновить
              </button>
              <button className="btn" onClick={() => setShowLimitModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {showFileLimitModal && (
        <div className="modal-overlay">
          <div className="modal">
            <p>Превышен лимит файлов</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setShowFileLimitModal(false)}>
                Ок
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
