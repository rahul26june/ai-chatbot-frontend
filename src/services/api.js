const API_URL = import.meta.env.VITE_API_URL || "/api";

async function request(path, { token, ...options } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error ?? `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function registerAccount({ name, email, password }) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export async function loginAccount({ email, password }) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function createConversation(token) {
  const data = await request("/conversations", {
    method: "POST",
    token,
  });
  return data.conversation;
}

export async function listConversations(token, search = "") {
  const query = search.trim()
    ? `?q=${encodeURIComponent(search.trim())}`
    : "";
  const data = await request(`/conversations${query}`, { token });
  return data.conversations;
}

export async function getConversation(token, conversationId) {
  const data = await request(`/conversations/${encodeURIComponent(conversationId)}`, {
    token,
  });
  return data.conversation;
}

export async function deleteConversation(token, conversationId) {
  return request(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    token,
  });
}

export async function startAgentWorkflow({ task, provider }, token) {
  const data = await request("/agents/workflows", {
    method: "POST",
    token,
    body: JSON.stringify({
      task,
      ...(provider ? { provider } : {}),
    }),
  });
  return data.workflow;
}

export async function getAgentWorkflow(token, workflowId) {
  const data = await request(`/agents/workflows/${encodeURIComponent(workflowId)}`, {
    token,
  });
  return data.workflow;
}

export async function listAgentWorkflows(token) {
  const data = await request("/agents", { token });
  return data.workflows;
}

export async function sendMessage(message, history = [], token, conversationId) {
  const context = history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-19)
    .map(({ role, text }) => ({ role, text }));
  const data = await request("/chat", {
    method: "POST",
    token,
    body: JSON.stringify({ message, history: context, conversationId }),
  });

  return data;
}

export async function streamMessage(
  message,
  history = [],
  token,
  conversationId,
  { signal, onEvent } = {},
) {
  const context = history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-19)
    .map(({ role, text }) => ({ role, text }));
  const response = await fetch(`${API_URL}/chat/stream`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ message, history: context, conversationId }),
  });

  if (!response.ok) {
    const data = await response.json();
    const error = new Error(data.error ?? `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!response.body) {
    throw new Error("Streaming is not supported by this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let conversation;

  function dispatchFrame(frame) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;

    const event = JSON.parse(dataLines.join("\n"));
    onEvent?.(event);
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "done") conversation = event.conversation;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      frames.forEach(dispatchFrame);
      if (done) break;
    }
    if (buffer.trim()) dispatchFrame(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  if (!conversation) {
    throw new Error("The chat stream ended before completion.");
  }
  return { conversation };
}
