import { useEffect, useRef, useState } from "react";
import "./App.css";
import { useAuth } from "./contexts/auth-context";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  loginAccount,
  registerAccount,
  streamMessage,
} from "./services/api";

const CONVERSATIONS_STORAGE_KEY = "ai-chatbot.conversations";
const EMPTY_MESSAGES = [];

function readConversations(userId) {
  try {
    const saved = localStorage.getItem(`${CONVERSATIONS_STORAGE_KEY}.${userId}`);
    const conversations = saved ? JSON.parse(saved) : [];
    return Array.isArray(conversations) ? conversations : [];
  } catch (error) {
    console.error("Unable to load saved conversations:", error);
    return [];
  }
}

function AuthPage({ mode, onModeChange, onSubmit, error, loading }) {
  const isRegistering = mode === "register";

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="brand auth-brand" href="/" aria-label="AI Chat home">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span>AI Chat</span>
        </a>
        <p className="auth-eyebrow">YOUR PERSONAL AI ASSISTANT</p>
        <h1 id="auth-title">{isRegistering ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-subtitle">
          {isRegistering
            ? "Sign up to start conversations and keep your chat history."
            : "Log in to continue your conversations."}
        </p>
        <form className="auth-form" onSubmit={onSubmit}>
          {isRegistering && (
            <label>
              Name
              <input
                name="name"
                type="text"
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={isRegistering ? "new-password" : "current-password"}
              minLength={isRegistering ? 8 : undefined}
              maxLength={128}
              required
            />
            {isRegistering && <span className="field-hint">Use at least 8 characters.</span>}
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? "Please wait…"
              : isRegistering
                ? "Create account"
                : "Log in"}
          </button>
        </form>
        <p className="auth-switch">
          {isRegistering ? "Already have an account?" : "New to AI Chat?"}
          <button
            type="button"
            onClick={() => onModeChange(isRegistering ? "login" : "register")}
          >
            {isRegistering ? "Log in" : "Create an account"}
          </button>
        </p>
      </section>
    </main>
  );
}

function App() {
  const { auth, setAuth, logout } = useAuth();
  const currentUserIdRef = useRef(auth?.user.id ?? null);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [conversations, setConversations] = useState(EMPTY_MESSAGES);
  const [loadedUserId, setLoadedUserId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationError, setConversationError] = useState("");
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loadingConversationId, setLoadingConversationId] = useState(null);
  const [streamingActive, setStreamingActive] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const streamAbortControllerRef = useRef(null);
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const messages = activeConversation?.messages ?? EMPTY_MESSAGES;
  const loading = loadingConversationId === activeConversationId;

  useEffect(() => {
    const userId = auth?.user.id ?? null;
    currentUserIdRef.current = userId;
    setConversations(userId ? readConversations(userId) : EMPTY_MESSAGES);
    setActiveConversationId(null);
    setLoadedUserId(userId);
    setConversationError("");
  }, [auth?.user.id]);

  useEffect(() => {
    if (!auth) return undefined;
    let cancelled = false;
    const userId = auth.user.id;
    const timer = window.setTimeout(async () => {
      setConversationsLoading(true);
      setConversationError("");
      try {
        const remoteConversations = await listConversations(auth.token, conversationSearch);
        if (cancelled || currentUserIdRef.current !== userId) return;
        const cachedById = new Map(
          readConversations(userId).map((conversation) => [conversation.id, conversation]),
        );
        setConversations(remoteConversations.map((conversation) => ({
          ...cachedById.get(conversation.id),
          ...conversation,
          messages: cachedById.get(conversation.id)?.messages ?? [],
        })));
      } catch (error) {
        if (cancelled || currentUserIdRef.current !== userId) return;
        if (error?.status === 401) {
          logout();
          setAuthError("Your session expired. Please log in again.");
        } else {
          setConversationError(
            error instanceof Error ? error.message : "Unable to load conversations.",
          );
        }
      } finally {
        if (!cancelled && currentUserIdRef.current === userId) {
          setConversationsLoading(false);
        }
      }
    }, conversationSearch ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [auth, conversationSearch, logout]);

  useEffect(() => {
    if (!auth || loadedUserId !== auth.user.id || conversationSearch) return;
    try {
      localStorage.setItem(
        `${CONVERSATIONS_STORAGE_KEY}.${auth.user.id}`,
        JSON.stringify(conversations),
      );
    } catch (error) {
      console.error("Unable to save conversations:", error);
    }
  }, [auth, conversations, conversationSearch, loadedUserId]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    const formData = new FormData(event.currentTarget);
    const credentials = Object.fromEntries(formData.entries());

    try {
      const result = authMode === "register"
        ? await registerAccount(credentials)
        : await loginAccount(credentials);
      const nextAuth = { token: result.token, user: result.user };
      currentUserIdRef.current = nextAuth.user.id;
      setAuth(nextAuth);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    currentUserIdRef.current = null;
    logout();
    setConversations(EMPTY_MESSAGES);
    setActiveConversationId(null);
    setPrompt("");
    setLoadingConversationId(null);
    setStreamingActive(false);
    setConversationsLoading(false);
    setAuthError("");
    setConversationError("");
    setConversationSearch("");
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const startNewConversation = () => {
    setActiveConversationId(null);
    setPrompt("");
    setConversationSearch("");
    setConversationError("");
    setIsSidebarOpen(false);
  };

  const handleDeleteConversation = (event, conversationId) => {
    event.stopPropagation();
    const requestUserId = auth.user.id;
    setConversationError("");
    deleteConversation(auth.token, conversationId)
      .then(() => {
        if (currentUserIdRef.current !== requestUserId) return;
        setConversations((current) => current.filter(
          (conversation) => conversation.id !== conversationId,
        ));
        try {
          localStorage.setItem(
            `${CONVERSATIONS_STORAGE_KEY}.${auth.user.id}`,
            JSON.stringify(readConversations(auth.user.id).filter(
              (conversation) => conversation.id !== conversationId,
            )),
          );
        } catch (error) {
          console.error("Unable to update saved conversations:", error);
        }
        if (activeConversationId === conversationId) {
          setActiveConversationId(null);
        }
      })
      .catch((error) => {
        if (currentUserIdRef.current !== requestUserId) return;
        if (error?.status === 401) {
          handleLogout();
          setAuthError("Your session expired. Please log in again.");
          return;
        }
        setConversationError(
          error instanceof Error ? error.message : "Unable to delete conversation.",
        );
      });
  };

  const handleSelectConversation = async (conversationId) => {
    const requestUserId = auth.user.id;
    setConversationError("");
    try {
      const conversation = await getConversation(auth.token, conversationId);
      if (currentUserIdRef.current !== requestUserId) return;
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversationId),
      ]);
      setActiveConversationId(conversationId);
      setIsSidebarOpen(false);
    } catch (error) {
      if (currentUserIdRef.current !== requestUserId) return;
      if (error?.status === 401) {
        handleLogout();
        setAuthError("Your session expired. Please log in again.");
        return;
      }
      setConversationError(
        error instanceof Error ? error.message : "Unable to load conversation.",
      );
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || loadingConversationId) return;

    const requestUserId = auth.user.id;
    let requestConversationId = activeConversationId;
    const abortController = new AbortController();
    setPrompt("");
    setLoadingConversationId(requestConversationId ?? "creating");

    try {
      if (!requestConversationId) {
        const conversation = await createConversation(auth.token);
        if (currentUserIdRef.current !== requestUserId) return;
        requestConversationId = conversation.id;
        setConversations((current) => [conversation, ...current]);
        setActiveConversationId(requestConversationId);
      }

      const existingConversation = conversations.find(
        (conversation) => conversation.id === requestConversationId,
      );
      const userMessage = { role: "user", text: message };
      setConversations((current) => current.map((conversation) => (
        conversation.id === requestConversationId
          ? { ...conversation, messages: [...(conversation.messages ?? []), userMessage] }
          : conversation
      )));
      setLoadingConversationId(requestConversationId);
      streamAbortControllerRef.current = abortController;
      setStreamingActive(true);

      const result = await streamMessage(
        message,
        existingConversation?.messages ?? [],
        auth.token,
        requestConversationId,
        {
          signal: abortController.signal,
          onEvent: (streamEvent) => {
            if (
              streamEvent.type !== "delta"
              || currentUserIdRef.current !== requestUserId
            ) return;
            setConversations((current) => current.map((conversation) => {
              if (conversation.id !== requestConversationId) return conversation;
              const currentMessages = conversation.messages ?? [];
              const lastMessage = currentMessages.at(-1);
              const nextMessages = lastMessage?.role === "assistant"
                ? [
                    ...currentMessages.slice(0, -1),
                    { ...lastMessage, text: lastMessage.text + streamEvent.text },
                  ]
                : [
                    ...currentMessages,
                    { role: "assistant", text: streamEvent.text },
                  ];
              return { ...conversation, messages: nextMessages };
            }));
          },
        },
      );
      if (currentUserIdRef.current !== requestUserId) return;
      setConversations((current) => [
        result.conversation,
        ...current.filter((conversation) => conversation.id !== requestConversationId),
      ]);
    } catch (error) {
      if (currentUserIdRef.current !== requestUserId) return;
      if (abortController.signal.aborted) return;
      if (error?.status === 401) {
        handleLogout();
        setAuthError("Your session expired. Please log in again.");
        return;
      }
      setConversationError(
        error instanceof Error ? error.message : "Unable to send your message.",
      );
      setConversations((current) => current.map((conversation) => (
        conversation.id === requestConversationId
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                {
                  role: "error",
                  text: error instanceof Error
                    ? error.message
                    : "The response could not be generated. Please try again.",
                },
              ],
              updatedAt: Date.now(),
            }
          : conversation
      )));
    } finally {
      if (streamAbortControllerRef.current === abortController) {
        streamAbortControllerRef.current = null;
      }
      if (currentUserIdRef.current === requestUserId) {
        setLoadingConversationId(null);
        setStreamingActive(false);
      }
    }
  };

  const handleStop = () => {
    streamAbortControllerRef.current?.abort();
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  if (!auth) {
    return (
      <AuthPage
        mode={authMode}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError("");
        }}
        onSubmit={handleAuthSubmit}
        error={authError}
        loading={authLoading}
      />
    );
  }

  return (
    <main className="chat-app">
      <aside className={`sidebar ${isSidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-heading">
          <a className="brand" href="/" aria-label="AI Chat home">
            <span className="brand-mark" aria-hidden="true">✦</span>
            <span>AI Chat</span>
          </a>
        </div>

        <button
          className="new-chat-button"
          type="button"
          onClick={startNewConversation}
          disabled={Boolean(loadingConversationId)}
        >
          <span aria-hidden="true">＋</span>
          New chat
        </button>

        <div className="history-section">
          <p className="section-label">Your conversations</p>
          <input
            className="conversation-search"
            aria-label="Search conversations"
            placeholder="Search conversations"
            type="search"
            maxLength={100}
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
          />
          {conversationError && (
            <p className="conversation-error" role="alert">{conversationError}</p>
          )}
          {conversationsLoading && (
            <p className="history-empty" role="status">Loading conversations…</p>
          )}
          {conversations.length === 0 ? (
            !conversationsLoading && (
              <p className="history-empty">
                {conversationSearch
                  ? "No conversations match your search."
                  : "Your chat history will appear here."}
              </p>
            )
          ) : (
            <ul className="conversation-list">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <div className="conversation-row">
                    <button
                      className={`conversation-item ${
                        conversation.id === activeConversationId ? "is-active" : ""
                      }`}
                      type="button"
                      onClick={() => handleSelectConversation(conversation.id)}
                      title={conversation.title}
                    >
                      <span className="conversation-title">{conversation.title}</span>
                    </button>
                    <button
                      className="delete-conversation"
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      title="Delete conversation"
                      onClick={(event) => handleDeleteConversation(event, conversation.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sidebar-footer">
          <span className="memory-indicator" aria-hidden="true" />
          <span>Signed in as {auth.user.name}</span>
          <button className="logout-button" type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>
      {isSidebarOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close conversation history"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <section className="chat-panel" aria-label="Chat">
        <header className="chat-header">
          <button
            className="icon-button mobile-history-toggle"
            type="button"
            aria-label="Open conversation history"
            aria-expanded={isSidebarOpen}
            onClick={() => setIsSidebarOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16M4 12h16M4 19h16" />
            </svg>
          </button>
          <div>
            <p className="header-eyebrow">PERSONAL AI ASSISTANT</p>
            <h1>{activeConversation?.title ?? "AI Chat"}</h1>
          </div>
          <span className="model-badge">
            <span className="online-dot" />
            Gemini
          </span>
        </header>

        <div className={`messages-area ${messages.length === 0 ? "is-empty" : ""}`}>
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon" aria-hidden="true">✦</div>
              <p className="welcome-kicker">A little help goes a long way</p>
              <h2>What can I help you with?</h2>
              <p className="welcome-copy">
                Ask a question, explore an idea, or get help with something you’re working on.
              </p>
              <div className="suggestion-list" aria-label="Prompt ideas">
                {[
                  "Explain a tricky topic simply",
                  "Help me brainstorm an idea",
                  "Write or improve a piece of text",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="suggestion"
                    type="button"
                    onClick={() => setPrompt(suggestion)}
                  >
                    <span aria-hidden="true">↗</span>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => (
                <article className={`message message-${message.role}`} key={`${index}-${message.role}`}>
                  <div className="message-avatar" aria-hidden="true">
                    {message.role === "user" ? "Y" : "✦"}
                  </div>
                  <div className="message-content">
                    <p className="message-author">
                      {message.role === "user" ? "You" : message.role === "error" ? "Notice" : "AI"}
                    </p>
                    <p className="message-text">{message.text}</p>
                  </div>
                </article>
              ))}
              {loading && (
                <article className="message message-assistant">
                  <div className="message-avatar" aria-hidden="true">✦</div>
                  <div className="message-content">
                    <p className="message-author">AI</p>
                    <p className="thinking"><span /><span /><span /></p>
                  </div>
                </article>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <form className="composer" onSubmit={handleSend}>
            <textarea
              aria-label="Message"
              placeholder="Message AI Chat..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              maxLength={4000}
              rows={1}
              disabled={Boolean(loadingConversationId)}
            />
            {streamingActive ? (
              <button
                className="send-button stop-button"
                type="button"
                aria-label="Stop generating"
                title="Stop generating"
                onClick={handleStop}
              >
                <span aria-hidden="true" />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                title="Send message"
                disabled={!prompt.trim()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5m-7 7 7-7 7 7" />
                </svg>
              </button>
            )}
          </form>
          <div className="composer-caption">
            <span>Enter to send · Shift + Enter for a new line</span>
            <span>Remembers the last 20 messages in this chat</span>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
