"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface ChatMessage {
  id: number;
  body: string;
  createdAt: string;
  userId: number;
  username: string | null;
  role: string | null;
  avatarUrl: string | null;
}

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

const POLL_INTERVAL = 3000;

export default function PublicChatWidget({
  user,
  onLoginClick,
}: {
  user: AuthUser | null;
  onLoginClick: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback((force = false) => {
    if (force || isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
  }, []);

  const fetchMessages = useCallback(
    async (initial = false) => {
      try {
        const afterParam = initial ? "" : `&after=${lastIdRef.current}`;
        const res = await fetch(`/api/forum/chat?limit=50${afterParam}`);
        if (!res.ok) return;
        const data = await res.json();
        const msgs: ChatMessage[] = data.messages || [];
        setOnlineCount(data.onlineCount || 0);

        if (initial) {
          setMessages(msgs);
          if (msgs.length > 0) lastIdRef.current = msgs[msgs.length - 1].id;
          setTimeout(() => scrollToBottom(true), 50);
        } else if (msgs.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
            if (newMsgs.length === 0) return prev;
            return [...prev, ...newMsgs];
          });
          lastIdRef.current = msgs[msgs.length - 1].id;

          if (minimized) {
            setUnread((prev) => prev + msgs.length);
          } else {
            setTimeout(() => scrollToBottom(), 50);
          }
        }
      } catch {
        /* network error */
      }
    },
    [minimized, scrollToBottom]
  );

  useEffect(() => {
    fetchMessages(true);
  }, [fetchMessages]);

  useEffect(() => {
    const interval = setInterval(() => fetchMessages(false), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    if (!minimized) {
      setUnread(0);
      setTimeout(() => scrollToBottom(true), 100);
    }
  }, [minimized, scrollToBottom]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || !user) return;
    setError("");
    setSending(true);

    try {
      const res = await fetch("/api/forum/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send");
        return;
      }
      if (data.message) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === data.message.id);
          if (exists) return prev;
          return [...prev, data.message];
        });
        lastIdRef.current = Math.max(lastIdRef.current, data.message.id);
      }
      setInput("");
      setTimeout(() => scrollToBottom(true), 50);
    } catch {
      setError("Network error");
    } finally {
      setSending(false);
    }
  }

  const roleBadge = (role: string | null) => {
    if (!role) return null;
    if (role === "admin")
      return (
        <span className="px-1 py-0.5 rounded text-[9px] font-semibold bg-danger/15 text-danger">
          ADMIN
        </span>
      );
    if (role === "moderator")
      return (
        <span className="px-1 py-0.5 rounded text-[9px] font-semibold bg-purple/15 text-purple">
          MOD
        </span>
      );
    return null;
  };

  const timeStr = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="gaming-surface rounded-xl overflow-hidden flex flex-col">
      {/* Chat Header */}
      <button
        onClick={() => setMinimized(!minimized)}
        className="flex items-center justify-between px-4 py-3 bg-bg-secondary/60 border-b border-border/50 hover:bg-bg-hover/50 transition-colors cursor-pointer w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <span className="font-semibold text-sm">Community Chat</span>
          <span className="flex items-center gap-1 text-[10px] text-text-muted">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse inline-block" />
            {onlineCount} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && minimized && (
            <span className="px-1.5 py-0.5 rounded-full bg-accent text-[10px] font-bold text-bg-primary min-w-[18px] text-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          <span
            className={`text-text-muted text-xs transition-transform ${
              minimized ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        </div>
      </button>

      {/* Chat Body */}
      {!minimized && (
        <>
          {/* Messages area */}
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
            style={{ maxHeight: "400px", minHeight: "200px" }}
          >
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-muted text-sm py-8">
                <div className="text-center">
                  <p className="text-2xl mb-2">🎮</p>
                  <p>No messages yet.</p>
                  <p className="text-xs mt-1">
                    {user
                      ? "Be the first to say hello!"
                      : "Login to join the conversation!"}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isOwn = user ? msg.userId === user.id : false;
                return (
                  <div
                    key={msg.id}
                    className={`group flex gap-2 py-1.5 px-2 rounded-lg transition-colors hover:bg-bg-hover/30 ${
                      isOwn ? "bg-accent/5" : ""
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold ${
                        isOwn
                          ? "bg-accent/20 text-accent"
                          : "bg-bg-tertiary text-text-muted"
                      }`}
                    >
                      {(msg.username || "?")[0].toUpperCase()}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-xs font-semibold ${
                            isOwn ? "text-accent" : "text-text-primary"
                          }`}
                        >
                          {msg.username || "Unknown"}
                        </span>
                        {roleBadge(msg.role)}
                        <span className="text-[10px] text-text-muted">
                          {timeStr(msg.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary break-words leading-relaxed">
                        {msg.body}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error display */}
          {error && (
            <div className="px-3 py-1">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}

          {/* Input area — only for logged-in users */}
          {user ? (
            <form
              onSubmit={sendMessage}
              className="flex items-center gap-2 px-3 py-2.5 border-t border-border/50 bg-bg-secondary/30"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                maxLength={1000}
                className="flex-1 px-3 py-2 gaming-chip rounded-lg text-sm placeholder:text-text-muted/60 focus:outline-none focus:ring-1 focus:ring-accent/50"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                {sending ? (
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                ) : (
                  "Send"
                )}
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center px-3 py-3 border-t border-border/50 bg-bg-secondary/30">
              <button
                onClick={onLoginClick}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
              >
                Login to Chat
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
