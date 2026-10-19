# AI Chat frontend

## Configuration

Set `VITE_API_URL` in `.env` to the backend API base URL. For local development:

```env
VITE_API_URL=http://localhost:5000/api
```

## Run locally

```sh
npm install
npm run dev
```

The frontend provides registration/login, authenticated chat, conversation
history, search, and local storage caching. Conversation records are persisted
by the backend.
